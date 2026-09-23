// ============================================================
//  AquaControl Pro v2 — Firmware node 1 zone
//
//  Nạp CHUNG cho cả 10 node. Mỗi con chỉ sửa 2 thứ ở phần CẤU HÌNH:
//    - ZONE_ID   (1..10)
//    - API_KEY   (key riêng của node đó, xem bảng Devices trong DB)
//
//  Phần cứng 1 node:
//    - 3 cảm biến độ ẩm đất (3 chậu)
//    - 1 DHT22 (nhiệt độ + độ ẩm không khí)
//    - 1 relay điều khiển 1 bơm (tưới chung cho 3 chậu)
//
//  BA CƠ CHẾ AN TOÀN (đừng bỏ khi sửa code):
//    1. Lệnh tưới kèm remainingSec → node TỰ đếm ngược và TỰ tắt bơm.
//       Mất mạng giữa chừng bơm vẫn tắt đúng giờ.
//    2. Quá FAILSAFE_TIMEOUT không liên lạc được server → tắt bơm.
//    3. Ngưỡng độ ẩm được nhớ lại → mất mạng vẫn tưới theo ngưỡng cục bộ.
// ============================================================

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <DHT.h>
#include <Preferences.h>

// ============================================================
//  CẤU HÌNH — SỬA PHẦN NÀY CHO TỪNG NODE
// ============================================================
#define ZONE_ID      1                                  // ← 1..10, mỗi node một số
#define API_KEY      "aqcp-z01-3f7a9c2e5b1d"            // ← key riêng của node này

#define WIFI_SSID    "TEN_WIFI"
#define WIFI_PASS    "MAT_KHAU_WIFI"
#define SERVER_BASE  "http://192.168.1.50:3000"         // ← IP máy chủ (hoặc domain)

#define FW_VERSION   "2.0.0"

// ============================================================
//  GPIO
//  Chỉ dùng ADC1 (GPIO 32-39) cho analog khi WiFi bật.
//  GPIO 34-39 là input-only, không có pull-up nội.
// ============================================================
#define PIN_SOIL1    32   // Cảm biến chậu 1
#define PIN_SOIL2    33   // Cảm biến chậu 2
#define PIN_SOIL3    34   // Cảm biến chậu 3 (input-only)
#define PIN_DHT      4    // DHT22 DATA (cần trở kéo 10kΩ lên 3V3)
#define PIN_RELAY    25   // Relay bơm — active-LOW
#define DHT_TYPE     DHT22

// Relay phổ thông là active-LOW: LOW = đóng tiếp điểm = BƠM CHẠY
#define RELAY_ON     LOW
#define RELAY_OFF    HIGH

// ============================================================
//  CALIBRATION cảm biến đất — ĐO THỰC TẾ rồi chỉnh lại
//  Capacitive: để ngoài không khí → ADC cao; nhúng nước → ADC thấp
// ============================================================
#define SOIL_RAW_DRY  3200
#define SOIL_RAW_WET  1500

// ============================================================
//  CHU KỲ (ms)
// ============================================================
#define INTERVAL_TELEMETRY  30000   // Gửi dữ liệu mỗi 30s
#define INTERVAL_COMMAND     5000   // Hỏi lệnh mỗi 5s
#define INTERVAL_DHT         2500   // Đọc DHT22 (tối đa ~0.5Hz)
#define HTTP_TIMEOUT         4000
#define FAILSAFE_TIMEOUT   180000   // 3 phút mất liên lạc → tắt bơm

// ============================================================
//  Biến toàn cục
// ============================================================
DHT dht(PIN_DHT, DHT_TYPE);
Preferences prefs;

float lastTemp  = NAN;
float lastHumid = NAN;

bool  pumpOn          = false;
unsigned long pumpOffAt = 0;      // millis() mốc tự tắt (0 = không hẹn)

// Ngưỡng cục bộ, nhớ vào NVS để mất mạng vẫn tưới đúng
float localThreshold  = 30.0;
float localHysteresis = 15.0;
int   localMaxRunMin  = 5;
bool  localModeThreshold = true;  // node có tự tưới theo ngưỡng khi mất mạng không

unsigned long lastTelemetry = 0;
unsigned long lastCommand   = 0;
unsigned long lastDHT       = 0;
unsigned long lastServerOk  = 0;
unsigned long pumpStartedAt = 0;

// ============================================================
//  Tiện ích
// ============================================================

// Đọc độ ẩm đất từ ADC, quy đổi sang % (100% = ướt)
float readSoil(int pin) {
  int raw = analogRead(pin);
  float pct = map(raw, SOIL_RAW_DRY, SOIL_RAW_WET, 0, 100);
  return constrain(pct, 0.0f, 100.0f);
}

void setPump(bool on, const char* why) {
  if (pumpOn == on) return;
  pumpOn = on;
  digitalWrite(PIN_RELAY, on ? RELAY_ON : RELAY_OFF);
  if (on) pumpStartedAt = millis();
  else    pumpOffAt = 0;
  Serial.printf("[Pump] %s (%s)\n", on ? "BAT" : "TAT", why);
}

void loadPrefs() {
  prefs.begin("aquacontrol", true);
  localThreshold  = prefs.getFloat("thr", 30.0);
  localHysteresis = prefs.getFloat("hys", 15.0);
  localMaxRunMin  = prefs.getInt("maxrun", 5);
  localModeThreshold = prefs.getBool("modeThr", true);
  prefs.end();
  Serial.printf("[NVS] Nguong da nho: %.1f%% (hys %.1f%%, maxrun %d phut)\n",
                localThreshold, localHysteresis, localMaxRunMin);
}

void savePrefs() {
  prefs.begin("aquacontrol", false);
  prefs.putFloat("thr", localThreshold);
  prefs.putFloat("hys", localHysteresis);
  prefs.putInt("maxrun", localMaxRunMin);
  prefs.putBool("modeThr", localModeThreshold);
  prefs.end();
}

void reconnectWifi() {
  if (WiFi.status() == WL_CONNECTED) return;
  Serial.print("[WiFi] Mat ket noi, dang reconnect");
  WiFi.reconnect();
  unsigned long t = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t < 10000) {
    delay(500);
    Serial.print(".");
  }
  Serial.println(WiFi.status() == WL_CONNECTED
                 ? " OK: " + WiFi.localIP().toString()
                 : " THAT BAI");
}

// ============================================================
//  Gửi dữ liệu cảm biến
// ============================================================
void sendTelemetry(float s1, float s2, float s3) {
  if (WiFi.status() != WL_CONNECTED) return;

  JsonDocument doc;
  doc["deviceId"]  = "AQ-ZONE-" + String(ZONE_ID < 10 ? "0" : "") + String(ZONE_ID);
  doc["rssi"]      = WiFi.RSSI();
  doc["uptime"]    = millis() / 1000;
  doc["fwVersion"] = FW_VERSION;

  JsonArray zones = doc["zones"].to<JsonArray>();
  JsonObject z = zones.add<JsonObject>();
  z["zone"] = ZONE_ID;
  // DHT lỗi trả NaN — gửi null để server biết là thiếu, đừng gửi số rác
  if (!isnan(lastTemp))  z["temperature"] = lastTemp;  else z["temperature"] = nullptr;
  if (!isnan(lastHumid)) z["airHumidity"] = lastHumid; else z["airHumidity"] = nullptr;
  JsonArray soil = z["soil"].to<JsonArray>();
  soil.add(s1);
  soil.add(s2);
  soil.add(s3);

  String body;
  serializeJson(doc, body);

  HTTPClient http;
  http.begin(String(SERVER_BASE) + "/api/telemetry");
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-api-key", API_KEY);
  http.setTimeout(HTTP_TIMEOUT);

  int code = http.POST(body);
  if (code == 200) {
    lastServerOk = millis();
    Serial.printf("[Telemetry] 200 OK | soil=%.0f/%.0f/%.0f%% T=%.1fC H=%.0f%%\n",
                  s1, s2, s3, lastTemp, lastHumid);
  } else {
    Serial.printf("[Telemetry] LOI HTTP %d\n", code);
  }
  http.end();
}

// ============================================================
//  Lấy lệnh từ server
// ============================================================
void fetchCommands() {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  http.begin(String(SERVER_BASE) + "/api/commands?zone=" + String(ZONE_ID));
  http.addHeader("x-api-key", API_KEY);
  http.setTimeout(HTTP_TIMEOUT);

  int code = http.GET();
  if (code != 200) {
    Serial.printf("[Commands] LOI HTTP %d\n", code);
    http.end();
    return;
  }

  String payload = http.getString();
  http.end();

  JsonDocument doc;
  if (deserializeJson(doc, payload)) {
    Serial.println("[Commands] Loi parse JSON");
    return;
  }
  lastServerOk = millis();

  // Cập nhật ngưỡng để dùng khi mất mạng
  if (doc["rules"].is<JsonObject>()) {
    JsonObject r = doc["rules"];
    float thr = r["SoilThreshold"] | localThreshold;
    float hys = r["HysteresisPct"] | localHysteresis;
    int   mx  = r["MaxRunMinutes"] | localMaxRunMin;
    if (thr != localThreshold || hys != localHysteresis || mx != localMaxRunMin) {
      localThreshold = thr;
      localHysteresis = hys;
      localMaxRunMin = mx;
      savePrefs();
      Serial.printf("[Rules] Cap nhat: nguong %.1f%%, hys %.1f%%, maxrun %d phut\n", thr, hys, mx);
    }
  }

  if (!doc["pump"].is<JsonObject>()) return;
  JsonObject pump = doc["pump"];
  bool wantOn = pump["state"] | false;
  int  remain = pump["remainingSec"] | 0;

  const char* mode = pump["mode"] | "threshold";
  bool newModeThr = (strcmp(mode, "threshold") == 0);
  if (newModeThr != localModeThreshold) {
    localModeThreshold = newModeThr;
    savePrefs();
  }

  if (wantOn) {
    // remainingSec > 0 nghĩa là lượt tưới có hẹn giờ → node tự đếm để không phụ thuộc mạng
    pumpOffAt = remain > 0 ? millis() + (unsigned long)remain * 1000UL : 0;
    setPump(true, remain > 0 ? "lenh server (co hen gio)" : "lenh server");
  } else {
    setPump(false, "lenh server");
  }
}

// ============================================================
//  An toàn: chạy mỗi vòng loop, KHÔNG phụ thuộc mạng
// ============================================================
void safetyCheck(float soilMin) {
  unsigned long now = millis();

  // 1) Hết thời lượng đã hẹn → tự tắt
  if (pumpOn && pumpOffAt != 0 && now >= pumpOffAt) {
    setPump(false, "het thoi luong hen");
    return;
  }

  // 2) Chạy quá lâu → cắt (phòng khi server treo hoặc lệnh kẹt)
  if (pumpOn && (now - pumpStartedAt) > (unsigned long)localMaxRunMin * 60000UL) {
    setPump(false, "vuot max runtime");
    return;
  }

  // 3) Mất liên lạc server quá lâu → tắt bơm cho an toàn
  bool lostServer = (now - lastServerOk) > FAILSAFE_TIMEOUT;
  if (pumpOn && lostServer && pumpOffAt == 0) {
    setPump(false, "mat ket noi server");
    return;
  }

  // 4) Mất mạng nhưng zone đang ở chế độ ngưỡng → tự tưới theo ngưỡng đã nhớ,
  //    để cây không chết trong lúc mạng hỏng.
  if (lostServer && localModeThreshold && soilMin >= 0) {
    if (!pumpOn && soilMin < localThreshold) {
      setPump(true, "offline: dat kho hon nguong");
      pumpOffAt = now + 60000UL;   // offline chỉ tưới từng đợt 60s cho an toàn
    } else if (pumpOn && soilMin >= localThreshold + localHysteresis) {
      setPump(false, "offline: dat da du am");
    }
  }
}

// ============================================================
//  setup()
// ============================================================
void setup() {
  Serial.begin(115200);
  Serial.printf("\n[Boot] AquaControl Pro - Node Zone %d (fw %s)\n", ZONE_ID, FW_VERSION);

  // Đặt mức TẮT TRƯỚC khi pinMode để bơm không giật 1 nhịp lúc khởi động
  digitalWrite(PIN_RELAY, RELAY_OFF);
  pinMode(PIN_RELAY, OUTPUT);
  digitalWrite(PIN_RELAY, RELAY_OFF);

  loadPrefs();
  dht.begin();

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("[WiFi] Dang ket noi");
  unsigned long t = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t < 30000) {
    delay(500);
    Serial.print(".");
  }
  Serial.println(WiFi.status() == WL_CONNECTED
                 ? "\n[WiFi] Connected: " + WiFi.localIP().toString()
                 : "\n[WiFi] KHONG ket noi duoc - se retry trong loop");

  lastServerOk = millis();   // cho node thời gian ân hạn trước khi failsafe kích hoạt
}

// ============================================================
//  loop()
// ============================================================
void loop() {
  unsigned long now = millis();

  reconnectWifi();

  // Đọc DHT22 theo chu kỳ, giữ giá trị cũ nếu lỗi
  if (now - lastDHT >= INTERVAL_DHT) {
    lastDHT = now;
    float t = dht.readTemperature();
    float h = dht.readHumidity();
    if (!isnan(t) && !isnan(h)) {
      lastTemp  = t;
      lastHumid = h;
    }
  }

  float s1 = readSoil(PIN_SOIL1);
  float s2 = readSoil(PIN_SOIL2);
  float s3 = readSoil(PIN_SOIL3);
  float soilMin = min(s1, min(s2, s3));

  // An toàn chạy mỗi vòng, không chờ mạng
  safetyCheck(soilMin);

  if (now - lastTelemetry >= INTERVAL_TELEMETRY) {
    lastTelemetry = now;
    sendTelemetry(s1, s2, s3);
  }

  if (now - lastCommand >= INTERVAL_COMMAND) {
    lastCommand = now;
    fetchCommands();
  }

  delay(50);
}
