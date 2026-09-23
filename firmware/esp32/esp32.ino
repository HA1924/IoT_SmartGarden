// ============================================================
//  AquaControl Pro — ESP32 Controller Firmware
//  Chức năng: đọc cảm biến 3 zone → gửi telemetry, nhận lệnh → điều khiển relay.
//  Bám sát hợp đồng dữ liệu trong firmware/PLAN.md.
// ============================================================

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <DHT.h>

// ============================================================
//  CẤU HÌNH — SỬA 3 DÒNG NÀY TRƯỚC KHI NẠP
// ============================================================
#define WIFI_SSID    "DVC"
#define WIFI_PASS    "123456789"
// IP máy tính đang chạy server (lấy bằng ipconfig, KHÔNG dùng localhost)
#define SERVER_BASE  "http://118.27.193.242"   // VPS — đổi thành https://ai-lab.io.vn khi có SSL

// Phải trùng với DEVICE_API_KEY trong file .env của server
#define API_KEY      "esp32-iot-garden-key-2026"
#define DEVICE_ID    "AQ-ESP-0922"

// ============================================================
//  GPIO — Relay active-LOW (LOW=BẬT, HIGH=TẮT)
// ============================================================
#define RELAY_PUMP1  25
#define RELAY_PUMP2  26
#define RELAY_PUMP3  27
#define RELAY_LED    14

// ============================================================
//  GPIO — Cảm biến (chỉ dùng ADC1 = GPIO 32-39 khi WiFi bật)
// ============================================================
#define PIN_SOIL1    32   // Độ ẩm đất Zone 1
#define PIN_SOIL2    33   // Độ ẩm đất Zone 2
#define PIN_SOIL3    34   // Độ ẩm đất Zone 3 (input-only, không pull-up)
#define PIN_LIGHT    35   // Cảm biến ánh sáng LDR (input-only)
#define PIN_DHT      4    // DHT22 DATA (cần điện trở kéo 10kΩ lên 3V3)
#define DHT_TYPE     DHT22

// ============================================================
//  CALIBRATION cảm biến đất — đo thực tế rồi chỉnh lại
//  Capacitive sensor: khô → ADC cao, ướt → ADC thấp
// ============================================================
#define SOIL_RAW_DRY  3200   // ADC khi cảm biến trong không khí khô — ĐO THỰC TẾ rồi chỉnh
#define SOIL_RAW_WET  1500   // ADC khi cảm biến ngập nước    — ĐO THỰC TẾ rồi chỉnh

// ============================================================
//  CHU KỲ (ms)
// ============================================================
#define INTERVAL_TELEMETRY  5000   // Gửi telemetry mỗi 5s
#define INTERVAL_COMMAND    2000   // Poll lệnh mỗi 2s
#define INTERVAL_DHT        2500   // Đọc DHT22 mỗi 2.5s (max ~0.5Hz)
#define HTTP_TIMEOUT        3000   // Timeout HTTP (ms)

// ============================================================
//  Biến toàn cục
// ============================================================
DHT dht(PIN_DHT, DHT_TYPE);

// Cache giá trị DHT (đọc chậm hơn, tránh NaN)
float lastTemp  = 25.0;
float lastHumid = 60.0;

unsigned long lastTelemetry = 0;
unsigned long lastCommand   = 0;
unsigned long lastDHT       = 0;
// ============================================================
//  Hàm tiện ích
// ============================================================

// Đọc độ ẩm đất từ ADC, quy đổi sang % (0–100)
float readSoil(int pin) {
  int raw = analogRead(pin);
  // Capacitive sensor: khô=cao, ướt=thấp → đảo ngược để 100% = ướt
  float pct = map(raw, SOIL_RAW_DRY, SOIL_RAW_WET, 0, 100);
  return constrain(pct, 0.0f, 100.0f);
}

// Đọc ánh sáng LDR, quy đổi sang lux gần đúng (0–2000)
int readLight() {
  int raw = analogRead(PIN_LIGHT);
  // LDR: sáng → điện trở thấp → ADC cao → lux cao
  return (int)map(raw, 0, 4095, 0, 2000);
}

// Kết nối lại WiFi nếu bị mất
void reconnectWifi() {
  if (WiFi.status() == WL_CONNECTED) return;
  Serial.print("[WiFi] Mất kết nối, đang reconnect");
  WiFi.reconnect();
  unsigned long t = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t < 10000) {
    delay(500);
    Serial.print(".");
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println(" OK: " + WiFi.localIP().toString());
  } else {
    Serial.println(" THẤT BẠI");
  }
}

// Đặt relay theo state (đảo logic active-LOW)
// state=true → BẬT → LOW; state=false → TẮT → HIGH
void setRelay(int pin, bool state) {
  digitalWrite(pin, state ? LOW : HIGH);
}

// Áp dụng lệnh từ server lên các relay
void applyActuators(JsonObject actuators) {
  if (actuators.containsKey("pump1")) setRelay(RELAY_PUMP1, actuators["pump1"]["state"].as<bool>());
  if (actuators.containsKey("pump2")) setRelay(RELAY_PUMP2, actuators["pump2"]["state"].as<bool>());
  if (actuators.containsKey("pump3")) setRelay(RELAY_PUMP3, actuators["pump3"]["state"].as<bool>());
  if (actuators.containsKey("led"))   setRelay(RELAY_LED,   actuators["led"]["state"].as<bool>());

  Serial.printf("[Commands] pump1=%d pump2=%d pump3=%d led=%d\n",
    (int)actuators["pump1"]["state"].as<bool>(),
    (int)actuators["pump2"]["state"].as<bool>(),
    (int)actuators["pump3"]["state"].as<bool>(),
    (int)actuators["led"]["state"].as<bool>()
  );
}

// ============================================================
//  Gửi telemetry lên server
// ============================================================
void sendTelemetry() {
  if (WiFi.status() != WL_CONNECTED) return;

  // Đọc cảm biến
  float soil1 = readSoil(PIN_SOIL1);
  float soil2 = readSoil(PIN_SOIL2);
  float soil3 = readSoil(PIN_SOIL3);
  int   light = readLight();
  long  rssi  = WiFi.RSSI();
  long  uptime = millis() / 1000;

  // Build JSON
  JsonDocument doc;
  doc["deviceId"] = DEVICE_ID;
  doc["rssi"]     = rssi;
  doc["uptime"]   = uptime;
  doc["voltage"]  = 12.2;   // Đặt giá trị thực nếu có mạch đo điện áp

  JsonArray zones = doc["zones"].to<JsonArray>();

  // 3 zone dùng chung temperature/airHumidity (1 DHT22)
  // Light chỉ có 1 cảm biến → cả 3 zone dùng cùng giá trị
  for (int z = 1; z <= 3; z++) {
JsonObject zObj = zones.add<JsonObject>();
    zObj["zone"]         = z;
    zObj["temperature"]  = lastTemp;
    zObj["airHumidity"]  = lastHumid;
    zObj["light"]        = light;
    zObj["soilMoisture"] = (z == 1) ? soil1 : (z == 2) ? soil2 : soil3;
  }

  String body;
  serializeJson(doc, body);

  HTTPClient http;
  http.begin(String(SERVER_BASE) + "/api/telemetry");
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-api-key", API_KEY);
  http.setTimeout(HTTP_TIMEOUT);

  int code = http.POST(body);
  if (code == 200) {
    Serial.printf("[Telemetry] 200 OK | soil=%.1f/%.1f/%.1f%% light=%dlx T=%.1fC H=%.1f%%\n",
      soil1, soil2, soil3, light, lastTemp, lastHumid);
  } else {
    Serial.printf("[Telemetry] LỖI HTTP %d\n", code);
  }
  http.end();
}

// ============================================================
//  Lấy lệnh từ server và áp lên relay
// ============================================================
void fetchCommands() {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  http.begin(String(SERVER_BASE) + "/api/commands");
  http.addHeader("x-api-key", API_KEY);
  http.setTimeout(HTTP_TIMEOUT);

  int code = http.GET();
  if (code == 200) {
    String payload = http.getString();
    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, payload);
    if (!err && doc["actuators"].is<JsonObject>()) {
      applyActuators(doc["actuators"].as<JsonObject>());
    } else {
      Serial.println("[Commands] Lỗi parse JSON");
    }
  } else {
    Serial.printf("[Commands] LỖI HTTP %d\n", code);
  }
  http.end();
}

// ============================================================
//  setup()
// ============================================================
void setup() {
  Serial.begin(115200);
  Serial.println("\n[Boot] AquaControl Pro Controller");

  // Đặt relay HIGH (TẮT) TRƯỚC khi pinMode để tránh bơm chạy khi khởi động
  digitalWrite(RELAY_PUMP1, HIGH);
  digitalWrite(RELAY_PUMP2, HIGH);
  digitalWrite(RELAY_PUMP3, HIGH);
  digitalWrite(RELAY_LED,   HIGH);
  pinMode(RELAY_PUMP1, OUTPUT);
  pinMode(RELAY_PUMP2, OUTPUT);
  pinMode(RELAY_PUMP3, OUTPUT);
  pinMode(RELAY_LED,   OUTPUT);

  dht.begin();

  // Kết nối WiFi
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("[WiFi] Đang kết nối");
  unsigned long t = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t < 30000) {
    delay(500);
    Serial.print(".");
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[WiFi] Connected: " + WiFi.localIP().toString());
  } else {
    Serial.println("\n[WiFi] KHÔNG kết nối được — sẽ retry trong loop");
  }
}

// ============================================================
//  loop()
// ============================================================
void loop() {
  unsigned long now = millis();

  // Kiểm tra và reconnect WiFi nếu cần
  reconnectWifi();
// Đọc DHT22 theo chu kỳ (cache để dùng trong telemetry)
  if (now - lastDHT >= INTERVAL_DHT) {
    lastDHT = now;
    float t = dht.readTemperature();
    float h = dht.readHumidity();
    if (!isnan(t) && !isnan(h)) {
      lastTemp  = t;
      lastHumid = h;
    }
    // Nếu NaN → giữ giá trị cũ, không cập nhật
  }

  // Gửi telemetry mỗi 5s
  if (now - lastTelemetry >= INTERVAL_TELEMETRY) {
    lastTelemetry = now;
    sendTelemetry();
  }

  // Poll lệnh mỗi 2s
  if (now - lastCommand >= INTERVAL_COMMAND) {
    lastCommand = now;
    fetchCommands();
  }
}