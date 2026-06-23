# PLAN FIRMWARE — AquaControl Pro

Kế hoạch nạp firmware thật cho hệ thống vườn tưới thông minh ESP32.
Bám sát hợp đồng dữ liệu của backend (đã kiểm tra trong code) — firmware **phải khớp y hệt**.

> Tài liệu này là plan/checklist. Code `.ino` sẽ viết sau khi chốt sơ đồ chân & phần cứng.

---

## 1. Mục tiêu & phạm vi

Có **2 loại thiết bị firmware**: 1 controller + **3 camera** (mỗi zone 1 cam).

| Thiết bị | deviceId | Vai trò | Trạng thái |
|----------|----------|---------|------------|
| **Controller** | `AQ-ESP-0922` | Đọc cảm biến 3 zone + điều khiển 3 bơm + 1 đèn LED | ⬜ Cần code |
| **Camera Zone 1–3** | `AQ-CAM-0101/0102/0103` | 3 ESP32-CAM stream MJPEG (mỗi zone 1 cam) cho AI-service kéo frame | ⬜ Nạp example có sẵn |

Controller là phần chính cần lập trình. 3 camera khuyến nghị nạp sketch mẫu **CameraWebServer** (không cần code nhiều), mỗi cam ứng 1 zone.

---

## 2. Phần cứng cần chuẩn bị

### Controller (ESP32 DevKit)
- 1 × ESP32 DevKit (38 chân, ESP32-WROOM-32)
- 3 × cảm biến độ ẩm đất (khuyến nghị **capacitive** v1.2 — bền hơn loại điện trở)
- 1 × DHT22 (AM2302) — nhiệt độ + độ ẩm không khí (dùng chung 3 zone)
- 1 × cảm biến ánh sáng: LDR + điện trở 10kΩ (chia áp) **hoặc** module BH1750 (I2C, cho lux chính xác)
- 1 × module relay 4 kênh (3 bơm + 1 đèn) — loại **active-LOW** phổ biến
- 3 × máy bơm (5V/12V tùy thiết kế) + 1 × dải đèn LED
- Nguồn riêng cho bơm/đèn (KHÔNG lấy từ chân 5V của ESP32)
- Điện trở kéo 10kΩ cho chân DATA của DHT22

### Camera (×3 — mỗi zone 1 cam)
- **3 × ESP32-CAM (AI Thinker)** + module nạp FTDI (hoặc ESP32-CAM-MB)
- Nên đặt IP tĩnh / DHCP reserve cho từng cam để URL stream không đổi sau reboot

---

## 3. Sơ đồ chân đề xuất (Controller)

> **Quy tắc bắt buộc:** khi WiFi bật, chỉ đọc analog trên **ADC1 = GPIO 32–39**.
> GPIO 34/35/36/39 là **input-only** (không có pull-up nội, chỉ dùng cho cảm biến đọc).
> Tránh chân strapping: 0, 2, 12, 15.

| Chức năng | GPIO | Ghi chú |
|-----------|------|---------|
| Soil moisture Zone 1 | **GPIO 32** | ADC1, analog in |
| Soil moisture Zone 2 | **GPIO 33** | ADC1, analog in |
| Soil moisture Zone 3 | **GPIO 34** | ADC1, input-only |
| Cảm biến ánh sáng (LDR) | **GPIO 35** | ADC1, input-only |
| DHT22 DATA | **GPIO 4** | digital + điện trở kéo 10kΩ lên 3V3 |
| Relay Bơm 1 (`pump1`) | **GPIO 25** | output, active-LOW |
| Relay Bơm 2 (`pump2`) | **GPIO 26** | output, active-LOW |
| Relay Bơm 3 (`pump3`) | **GPIO 27** | output, active-LOW |
| Relay Đèn LED (`led`) | **GPIO 14** | output, active-LOW |

> Nếu dùng **BH1750 (I2C)** thay LDR: SDA = GPIO 21, SCL = GPIO 22 — khi đó GPIO 35 để trống.

**Lưu ý relay active-LOW:** `digitalWrite(pin, LOW)` = BẬT, `HIGH` = TẮT. Phải đảo logic trong code. Khi khởi động đặt tất cả về `HIGH` (TẮT) trước khi `pinMode` để tránh bơm chạy bất ngờ.

---

## 4. Hợp đồng dữ liệu (đã verify trong backend)

### 4.1 Đẩy telemetry — `POST /api/telemetry`
- Header: `Content-Type: application/json`, `x-api-key: <DEVICE_API_KEY>`
- Chu kỳ: **mỗi 5 giây**
- Body (3 zone gửi chung temperature/airHumidity vì 1 DHT22; light + soilMoisture riêng từng zone):

```json
{
  "deviceId": "AQ-ESP-0922",
  "rssi": -62,
  "uptime": 12345,
  "voltage": 12.2,
  "zones": [
    { "zone": 1, "temperature": 28.4, "airHumidity": 62, "light": 850, "soilMoisture": 45 },
    { "zone": 2, "temperature": 28.4, "airHumidity": 62, "light": 1200, "soilMoisture": 26 },
    { "zone": 3, "temperature": 28.4, "airHumidity": 62, "light": 900, "soilMoisture": 52 }
  ]
}
```

- **Bắt buộc:** `deviceId` (string) + `zones[]` (≥1 phần tử). Thiếu → server trả 400.
- Các field còn lại có thể null nhưng nên gửi đủ.
- Kiểu dữ liệu server lưu: temperature/airHumidity/soilMoisture = số thập phân; light = **số nguyên (Int)**.
- Server trả về: `{ "ok": true, "saved": 3, "changes": [...] }` (changes = cơ cấu auto vừa đổi).

### 4.2 Lấy lệnh điều khiển — `GET /api/commands`
- Header: `x-api-key: <DEVICE_API_KEY>`
- Chu kỳ: **mỗi 2 giây**
- Server trả:

```json
{
  "actuators": {
    "pump1": { "state": false, "mode": "auto" },
    "pump2": { "state": true,  "mode": "manual" },
    "pump3": { "state": false, "mode": "auto" },
    "led":   { "state": false, "mode": "auto" }
  }
}
```

- Firmware **chỉ cần áp `state` lên relay** (true = bật bơm/đèn). Trường `mode` để server tự xử lý automation — firmware không cần dùng, nhưng có thể đọc để hiển thị/log.
- Logic auto/manual nằm ở **server** (`automationService.js`), không nằm ở firmware. Firmware là "tay chân": đọc cảm biến → gửi; nhận state → đóng/ngắt relay.

---

## 5. Hiệu chỉnh cảm biến (calibration) — QUAN TRỌNG

ADC của ESP32 trả giá trị thô **0–4095**. Phải quy đổi sang đơn vị server cần.

### Độ ẩm đất (→ % , 0–100)
Cảm biến capacitive: **khô = giá trị ADC cao**, **ướt = thấp** (ngược trực giác). Cần đo 2 mốc:
- Để cảm biến trong không khí khô → ghi lại `RAW_DRY` (vd ~3000)
- Nhúng ngập nước → ghi lại `RAW_WET` (vd ~1200)
- Quy đổi: `soil% = map(raw, RAW_DRY, RAW_WET, 0, 100)` rồi `constrain(0,100)`

### Ánh sáng (→ light)
- Nếu LDR chia áp: đọc raw 0–4095, map tạm về thang lux gần đúng (`map(raw,0,4095,0,2000)`), gửi **số nguyên**.
- Nếu BH1750: đọc lux thật bằng thư viện → gửi trực tiếp (chính xác hơn, khuyến nghị).

### Điện áp nguồn (`voltage`)
- Nếu đo nguồn 12V: dùng mạch chia áp (vd 10kΩ/2.2kΩ) đưa về < 3.3V rồi đọc ADC + nhân hệ số. Nếu không có mạch đo, gửi giá trị cố định danh nghĩa (vd 12.2) hoặc bỏ qua (null).

> Ghi các hằng số calibration thành `#define` đầu file để dễ chỉnh khi lắp thật.

---

## 6. Cấu trúc code Controller (`AquaControl_Controller.ino`)

```
1. #include WiFi.h, HTTPClient.h, ArduinoJson.h, DHT.h
2. Cấu hình (#define / const):
   - WIFI_SSID, WIFI_PASS
   - SERVER_BASE   = "http://<IP-máy-chạy-server>:3000"   (KHÔNG dùng localhost)
   - API_KEY       = DEVICE_API_KEY (khớp .env của server)
   - DEVICE_ID     = "AQ-ESP-0922"
   - Sơ đồ chân + hằng số calibration
3. setup():
   - Đặt relay HIGH (tắt) -> pinMode OUTPUT
   - dht.begin()
   - WiFi.begin() + chờ kết nối (có timeout + retry)
4. loop() dùng millis() (KHÔNG delay() chặn):
   - mỗi 5000ms: đọc cảm biến -> build JSON -> POST /api/telemetry
   - mỗi 2000ms: GET /api/commands -> parse -> applyActuators()
   - kiểm tra WiFi, tự reconnect nếu rớt
5. Hàm phụ:
   - readSoil(pin), readLight(), readDHT()
   - applyActuators(json): set relay theo state (nhớ đảo logic active-LOW)
```

### Lưu ý kỹ thuật
- **Dùng `millis()`**, tránh `delay()` dài làm trễ vòng poll.
- ArduinoJson: cấp `JsonDocument` đủ lớn (telemetry ~512B, commands ~256B).
- DHT22 đọc tối đa ~0.5Hz → cache giá trị, không đọc mỗi vòng loop.
- Nếu đọc DHT lỗi (NaN) → giữ giá trị cũ, không gửi NaN.
- Thêm `Serial.println` debug ở mỗi bước để soi qua Serial Monitor 115200.
- HTTP timeout ngắn (vd 3s) để không treo loop khi server offline.

---

## 7. Firmware Camera — 3 × ESP32-CAM (mỗi zone 1 camera)

Hệ thống dùng **3 camera quan sát**, mỗi cam đặt ở 1 zone. Không cần tự code nhiều — nạp example **CameraWebServer** cho từng cam:
1. Arduino IDE → Examples → ESP32 → Camera → **CameraWebServer**
2. Chọn board: **AI Thinker ESP32-CAM**
3. Sửa `ssid` / `password` WiFi (3 cam có thể chung WiFi)
4. Nạp (giữ GPIO0 nối GND khi nạp, nạp xong tháo ra reset)
5. Mở Serial Monitor lấy IP **từng cam** → stream tại `http://<ip-cam>:81/stream`
6. Đặt **3 URL** vào `.env` server, mỗi URL ứng 1 zone:
   - `ESP32CAM_STREAM_URL_1=http://<ip-cam-zone1>:81/stream`
   - `ESP32CAM_STREAM_URL_2=http://<ip-cam-zone2>:81/stream`
   - `ESP32CAM_STREAM_URL_3=http://<ip-cam-zone3>:81/stream`
   *(Biến cũ `ESP32CAM_STREAM_URL` vẫn dùng được, xem như camera Zone 1.)*
7. AI-service (Python) tự kéo frame từ 3 URL để phân tích — ESP32-CAM **không** tự gọi `/api/camera/analysis`.
8. Sketch **CameraWebServer** mặc định tự động serve **2 endpoint**:
   - `http://<ip-cam>:81/stream` — MJPEG stream (AI-service kéo frame)
   - `http://<ip-cam>/capture` (port 80) — ảnh tĩnh JPEG (server Node.js gọi khi admin nhấn nút **"Capture"** trên trang Camera)
   Không cần code thêm — nạp example mặc định là đủ cho cả 2 chức năng này.

> **Quan trọng (mới):** khi AI-service gửi kết quả về `POST /api/camera/analysis`, phải kèm trường
> **`zone` (1–3)** để backend lưu đúng zone và trang Camera hiển thị theo từng camera.
> Thiếu `zone` → backend mặc định lưu **zone 1**.
> AI-service mới là bên gọi `POST /api/camera/analysis` (kèm x-api-key), không phải firmware cam.

---

## 8. Cấu hình mạng & .env (điều kiện để firmware chạy được)

Trên máy chạy Node server, sửa `.env`:
- `HOST=0.0.0.0` ← bắt buộc để ESP32 trong LAN truy cập được (mặc định `127.0.0.1` chỉ máy đó).
- `DEVICE_API_KEY=...` ← phải **trùng y hệt** `API_KEY` hardcode trong firmware.
- Mở firewall Windows cho port 3000 (inbound).
- ESP32 và máy server phải **chung mạng LAN/WiFi**.
- Lấy IP máy server bằng `ipconfig` → dùng IP đó làm `SERVER_BASE` trong firmware (vd `http://192.168.1.50:3000`).

---

## 9. Thư viện Arduino cần cài

| Thư viện | Nguồn | Dùng cho |
|----------|-------|----------|
| DHT sensor library | Adafruit | Đọc DHT22 |
| Adafruit Unified Sensor | Adafruit | Phụ thuộc của DHT |
| ArduinoJson | Benoit Blanchon (v6/v7) | Build/parse JSON |
| BH1750 *(tùy chọn)* | Christopher Laws | Nếu dùng cảm biến lux I2C |
| WiFi / HTTPClient | có sẵn trong core ESP32 | Mạng + HTTP |

Cài qua **Library Manager** của Arduino IDE. Board Manager: cài **esp32 by Espressif**.

---

## 10. Quy trình test (theo thứ tự)

1. **Test mạng trước:** chạy server (`npm run dev` với `HOST=0.0.0.0`), từ điện thoại/máy khác mở `http://<ip-server>:3000` → vào được login là OK.
2. **Test telemetry bằng tay:** dùng Postman/curl POST thử payload mẫu (mục 4.1) kèm `x-api-key` → server trả `{ok:true}`, dashboard nhảy số.
3. **Nạp Controller** → mở Serial Monitor → xem log POST/GET có 200 không.
4. **Đối chiếu dashboard:** số liệu 3 zone trên web khớp cảm biến thật.
5. **Test điều khiển:** trên web đặt `pump1` = manual + bật → trong 2s relay phải đóng (nghe tiếng "tách"), bơm chạy.
6. **Test automation:** đặt pump về `auto`, làm đất khô (< ngưỡng 30%) → server tự bật bơm, web + relay phản ánh.
7. **Nạp 3 Camera** → kiểm tra stream `:81/stream` của **từng cam** mở được trên trình duyệt → đặt 3 URL vào `.env` → trên trang Camera đổi tab **Zone 1/2/3** thấy đúng stream + kết quả từng cam (AI-service phải gửi kèm `zone`).

---

## 11. Checklist hoàn thành

- [ ] Chốt sơ đồ chân thực tế + loại cảm biến ánh sáng (LDR hay BH1750)
- [ ] Lắp mạch, đảm bảo nguồn bơm/đèn riêng, relay active-LOW
- [ ] Hiệu chỉnh `RAW_DRY` / `RAW_WET` cho 3 cảm biến đất
- [ ] Viết `AquaControl_Controller.ino` theo cấu trúc mục 6
- [ ] Cấu hình `.env`: `HOST=0.0.0.0`, `DEVICE_API_KEY` khớp, mở firewall
- [ ] Test telemetry → control → automation theo mục 10
- [ ] Nạp **3 ESP32-CAM** + đặt `ESP32CAM_STREAM_URL_1/2/3` (mỗi zone 1 cam)
- [ ] Chạy AI-service (gửi kèm `zone`), kiểm tra trang Camera đổi tab Zone 1/2/3 đúng dữ liệu
- [ ] Chạy `db/migration_camera_zone.sql` nếu DB cũ chưa có cột `Zone`

---

## 12. Rủi ro / lưu ý thường gặp

- **Bơm chạy khi khởi động:** do relay active-LOW chưa set HIGH trước `pinMode` → đặt mức an toàn TRƯỚC.
- **Đọc analog = 0 hoặc nhiễu:** dùng nhầm ADC2 (GPIO 0,2,4,12–15,25–27) khi WiFi bật → chỉ dùng ADC1 (32–39).
- **`localhost` trong firmware:** sai hoàn toàn — ESP32 hiểu localhost là chính nó. Phải dùng IP LAN của máy server.
- **401 Unauthorized:** sai/thiếu header `x-api-key` hoặc key không khớp `.env`.
- **400 Bad Request:** thiếu `deviceId` hoặc `zones[]`, hoặc JSON sai định dạng.
- **DHT22 trả NaN:** thiếu điện trở kéo, dây dài, hoặc đọc quá nhanh (< 2s/lần).
- **IP ESP32 đổi sau reboot:** cân nhắc đặt IP tĩnh hoặc reserve DHCP cho ổn định.
```
