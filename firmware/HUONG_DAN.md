# Hướng dẫn: Nạp firmware Arduino + Chạy AI-service

---

## PHẦN 1 — Nạp firmware lên ESP32 bằng Arduino IDE

### Bước 1: Cài Arduino IDE 2.x
Tải tại: https://www.arduino.cc/en/software (chọn **Windows Installer**)

### Bước 2: Thêm board ESP32
1. Mở Arduino IDE → **File → Preferences**
2. Ở ô *Additional boards manager URLs*, dán vào:
   ```
   https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
   ```
3. **Tools → Board → Boards Manager** → tìm `esp32` → cài **esp32 by Espressif Systems**
   *(mất vài phút, khoảng 200MB)*

### Bước 3: Cài thư viện
Vào **Tools → Manage Libraries**, tìm và cài lần lượt:

| Tìm kiếm | Tên thư viện cần cài |
|---|---|
| `DHT sensor library` | **DHT sensor library** by Adafruit |
| `Adafruit Unified Sensor` | **Adafruit Unified Sensor** by Adafruit |
| `ArduinoJson` | **ArduinoJson** by Benoit Blanchon |

### Bước 4: Mở file .ino và sửa cấu hình
Mở file `AquaControl_Controller.ino`, sửa **3 dòng** ở đầu file:

```cpp
#define WIFI_SSID    "TEN_WIFI_CUA_BAN"         // ← đổi thành tên WiFi thật
#define WIFI_PASS    "MAT_KHAU_WIFI"             // ← đổi thành mật khẩu WiFi
#define SERVER_BASE  "http://192.168.x.x:3000"   // ← đổi thành IP máy tính (xem bên dưới)
```

**Cách lấy IP máy tính để điền vào SERVER_BASE:**
1. Mở PowerShell → gõ lệnh:
   ```
   ipconfig
   ```
2. Tìm dòng **IPv4 Address** dưới adapter WiFi đang dùng, ví dụ: `192.168.1.50`
3. Điền vào: `"http://192.168.1.50:3000"`

> ⚠️ **KHÔNG dùng `localhost` hay `127.0.0.1`** — ESP32 sẽ tự hiểu là địa chỉ của chính nó, không phải máy tính.

`API_KEY` đã đặt sẵn là `aqcp-device-key-2026` (khớp với file `.env` của server, **không cần đổi**).

### Bước 5: Chọn board và cổng COM
- **Tools → Board → esp32 → ESP32 Dev Module**
- Cắm ESP32 vào máy tính bằng cáp USB (cáp có dây data, không phải cáp sạc)
- **Tools → Port** → chọn cổng COM xuất hiện (ví dụ `COM3`, `COM4`)

> Nếu không thấy cổng COM: cài driver chip USB-Serial trên board.
> Thường là **CP2102** (tải tại silabs.com) hoặc **CH340** (tải tại wch.cn).

### Bước 6: Nạp code
- Bấm nút **Upload** (biểu tượng →) hoặc nhấn `Ctrl+U`
- Chờ compile + nạp (~30–60 giây), thanh tiến trình hiện ở dưới
- Sau khi xong: **Tools → Serial Monitor**, đặt baud **115200**
- Thấy dòng sau là thành công:
  ```
  [WiFi] Connected: 192.168.1.xxx
  [Telemetry] 200 OK | soil=...% light=...lx T=...C H=...%
  [Commands] pump1=0 pump2=0 pump3=0 led=0
  ```

### Bước 7: Cho phép ESP32 kết nối vào server

**Sửa file `.env`** ở thư mục gốc project, đổi dòng HOST:
```env
HOST=0.0.0.0
```
*(Mặc định `127.0.0.1` chỉ cho máy tính tự kết nối, `0.0.0.0` mở cho cả mạng LAN)*

**Mở firewall Windows cho port 3000:**
1. Tìm kiếm "Windows Defender Firewall with Advanced Security"
2. **Inbound Rules → New Rule**
3. Chọn **Port** → **TCP** → điền `3000` → **Allow the connection** → đặt tên tùy ý → Finish

---

## PHẦN 2 — Chạy AI-service (Python/OpenCV)

### Bước 1: Mở terminal trong thư mục ai-service
```powershell
cd "e:\PROJECT\IoT_SmartGarden\ai-service"
```

### Bước 2: Tạo môi trường ảo — chỉ làm 1 lần
```powershell
python -m venv venv
```

### Bước 3: Kích hoạt venv
```powershell
venv\Scripts\activate
```
Dấu nhắc sẽ hiện `(venv)` ở đầu dòng — phải thấy dấu này trước khi tiếp tục.

### Bước 4: Cài thư viện — chỉ làm 1 lần
```powershell
pip install -r requirements.txt
```
*(Cài opencv, flask, numpy, requests — mất vài phút)*

### Bước 5: Đặt URL stream camera rồi chạy

Sau khi nạp sketch **CameraWebServer** lên ESP32-CAM, mở Serial Monitor lấy IP của từng camera.
Sau đó chạy AI-service với lệnh sau trong PowerShell:

```powershell
# Thay IP thật của từng ESP32-CAM vào đây
$env:PULL_STREAM_URL_1 = "http://192.168.x.x:81/stream"   # Zone 1
$env:PULL_STREAM_URL_2 = "http://192.168.x.y:81/stream"   # Zone 2
$env:PULL_STREAM_URL_3 = "http://192.168.x.z:81/stream"   # Zone 3

# Hai dòng dưới không cần đổi nếu server chạy trên cùng máy
$env:DEVICE_API_KEY = "aqcp-device-key-2026"
$env:NODE_URL       = "http://localhost:3000"

python app.py
```

**Nếu chỉ có 1 camera (zone 1):**
```powershell
$env:PULL_STREAM_URL_1 = "http://192.168.x.x:81/stream"
$env:DEVICE_API_KEY   = "aqcp-device-key-2026"
$env:NODE_URL         = "http://localhost:3000"
python app.py
```

Log khi chạy thành công:
```
[ai] Zone 1: tự kéo stream http://192.168.x.x:81/stream mỗi 10s
 * Running on http://0.0.0.0:5001
```

### Bước 6: Cập nhật URL vào .env server
Sau khi có IP thật của các ESP32-CAM, mở file `.env` ở **thư mục gốc project** và sửa:
```env
ESP32CAM_STREAM_URL_1=http://<ip-cam-zone1>:81/stream
ESP32CAM_STREAM_URL_2=http://<ip-cam-zone2>:81/stream
ESP32CAM_STREAM_URL_3=http://<ip-cam-zone3>:81/stream
```
Các URL này dùng để hiển thị **live stream** trực tiếp trên trang Camera của dashboard.

---

## Thứ tự khởi động mỗi lần dùng

| Bước | Lệnh | Terminal |
|---|---|---|
| 1 | `npm run dev` | Terminal 1 (thư mục gốc project) |
| 2 | Activate venv + set env + `python app.py` | Terminal 2 (thư mục `ai-service/`) |
| 3 | Bật ESP32 Controller | — |
| 4 | Mở `http://localhost:3000` → đăng nhập `admin / admin123` | Trình duyệt |

> Phải chạy Node server **trước** AI-service và ESP32, vì cả hai đều kết nối vào server.
