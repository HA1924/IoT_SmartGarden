# Hướng dẫn nạp firmware cho 10 node ESP32

Mỗi zone có 1 ESP32 riêng, cả 10 con **nạp chung một file** `zone-node/zone-node.ino`,
chỉ khác 2 dòng cấu hình. Không có thiết bị master.

---

## PHẦN 1 — Chuẩn bị Arduino IDE

### Bước 1: Cài Arduino IDE 2.x
Tải tại https://www.arduino.cc/en/software (chọn **Windows Installer**).

### Bước 2: Thêm board ESP32
1. **File → Preferences** → ô *Additional boards manager URLs*, dán:
   ```
   https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
   ```
2. **Tools → Board → Boards Manager** → tìm `esp32` → cài **esp32 by Espressif Systems**
   (mất vài phút, khoảng 200MB).

### Bước 3: Cài thư viện
**Tools → Manage Libraries**, tìm và cài:

| Tìm kiếm | Thư viện |
|---|---|
| `DHT sensor library` | **DHT sensor library** by Adafruit |
| `Adafruit Unified Sensor` | **Adafruit Unified Sensor** by Adafruit |
| `ArduinoJson` | **ArduinoJson** by Benoit Blanchon (bản 7.x) |

`WiFi`, `HTTPClient`, `Preferences` đã có sẵn trong core ESP32.

---

## PHẦN 2 — Đấu nối 1 node

| Chức năng | GPIO | Ghi chú |
|---|---|---|
| Cảm biến đất chậu 1 | **32** | ADC1 |
| Cảm biến đất chậu 2 | **33** | ADC1 |
| Cảm biến đất chậu 3 | **34** | ADC1, input-only |
| DHT22 DATA | **4** | cần điện trở kéo 10kΩ lên 3V3 |
| Relay bơm | **25** | output, active-LOW |

**Quy tắc bắt buộc**
- Khi WiFi bật, analog **chỉ đọc được trên ADC1 = GPIO 32–39**. Dùng ADC2 sẽ ra số rác.
- GPIO 34–39 là input-only, không có pull-up nội — chỉ dùng cho cảm biến đọc vào.
- Tránh chân strapping: 0, 2, 12, 15.
- **Nguồn cho bơm phải lấy riêng**, không lấy từ chân 5V của ESP32 — dòng khởi động của
  bơm sẽ làm ESP32 reset liên tục.
- Nối chung GND giữa nguồn bơm và ESP32.

---

## PHẦN 3 — Cấu hình từng node

Mở `firmware/zone-node/zone-node.ino`, sửa phần đầu file:

```cpp
#define ZONE_ID      1                              // ← 1..10, mỗi node một số khác nhau
#define API_KEY      "aqcp-z01-3f7a9c2e5b1d"        // ← key riêng của node này

#define WIFI_SSID    "TEN_WIFI"
#define WIFI_PASS    "MAT_KHAU_WIFI"
#define SERVER_BASE  "http://192.168.1.50:5000"     // ← IP máy chủ
```

**API key lấy ở đâu**: mỗi node có key riêng, nằm ở cột `ApiKey` bảng `Devices`.
Xem phần seed ở cuối `db/schema.sql`, hoặc chạy trong SSMS:
```sql
SELECT DeviceId, Zone, ApiKey FROM dbo.Devices ORDER BY Zone;
```
Node dùng key của zone khác sẽ bị server từ chối — đó là chủ ý, để phát hiện nạp nhầm firmware.

**Lấy IP máy chủ**: mở PowerShell trên máy chạy server, gõ `ipconfig`, lấy dòng *IPv4 Address*.
Không dùng `localhost` vì với ESP32 thì localhost là chính nó.

**Nếu server chạy HTTPS** (có domain, qua Cloudflare Tunnel...): `HTTPClient` thường sẽ lỗi `-1`.
Phải đổi sang `WiFiClientSecure` + `client.setInsecure()`, hoặc để ESP32 gọi thẳng IP nội bộ
qua HTTP còn trình duyệt mới đi qua domain HTTPS.

---

## PHẦN 4 — Nạp và kiểm tra

1. **Tools → Board** → *ESP32 Dev Module*, chọn đúng **Port**.
2. Bấm **Upload**.
3. Mở **Serial Monitor**, tốc độ **115200**.

Node chạy đúng sẽ in:
```
[Boot] AquaControl Pro - Node Zone 1 (fw 2.0.0)
[NVS] Nguong da nho: 30.0% (hys 15.0%, maxrun 5 phut)
[WiFi] Connected: 192.168.1.101
[Telemetry] 200 OK | soil=45/52/38% T=28.4C H=62%
```

Gặp `LOI HTTP 401` → sai `API_KEY`.
Gặp `LOI HTTP -1` → sai IP/cổng, hoặc firewall máy chủ chưa mở cổng 5000, hoặc đang gọi HTTPS.

---

## PHẦN 5 — Hiệu chỉnh cảm biến độ ẩm đất

Giá trị mặc định trong code chỉ là ước lượng, **phải đo lại theo cảm biến thật**:

1. Nạp firmware, mở Serial Monitor.
2. Để cảm biến **khô ngoài không khí** → ghi lại số ADC.
3. **Nhúng vào nước** (chỉ ngập phần cảm biến, không ngập mạch) → ghi lại số ADC.
4. Điền vào đầu file:
   ```cpp
   #define SOIL_RAW_DRY  3200   // số đo khi khô
   #define SOIL_RAW_WET  1500   // số đo khi ngập nước
   ```
5. Nạp lại. Kiểm tra: khô phải ra ~0%, ngập nước ra ~100%.

Không hiệu chỉnh thì ngưỡng 30% trên web sẽ không tương ứng với độ ẩm thật.

---

## PHẦN 6 — Ba cơ chế an toàn (đừng gỡ khi sửa code)

| Cơ chế | Cách hoạt động | Bảo vệ khỏi |
|---|---|---|
| **Tự đếm ngược** | Server gửi `remainingSec`, node tự đếm và tự tắt | Mất mạng giữa lúc đang tưới |
| **Cắt quá giờ** | Bơm chạy quá `MaxRunMinutes` là cắt, không cần lệnh | Server treo, lệnh kẹt, relay dính |
| **Failsafe mất server** | Quá 3 phút không liên lạc được → tắt bơm | Server chết trong lúc bơm đang chạy |

Ngoài ra node nhớ ngưỡng vào NVS: mất mạng mà zone đang ở chế độ ngưỡng thì vẫn tự tưới
từng đợt 60 giây, để cây không chết trong lúc mạng hỏng.

---

## PHẦN 7 — Nạp cho 10 node

Làm lần lượt từng con, mỗi lần chỉ đổi **2 dòng** `ZONE_ID` và `API_KEY`:

| Node | ZONE_ID | DeviceId | Key lấy từ |
|---|---|---|---|
| 1 | 1 | AQ-ZONE-01 | `SELECT ApiKey FROM Devices WHERE Zone=1` |
| 2 | 2 | AQ-ZONE-02 | ... |
| ... | ... | ... | ... |
| 10 | 10 | AQ-ZONE-10 | ... |

**Mẹo**: dán nhãn số zone lên vỏ từng node ngay sau khi nạp. Sau này gỡ ra sửa mà không
biết con nào là zone mấy sẽ rất mất thời gian.

**Gợi ý**: đặt DHCP Reservation trên router cho từng node để IP không đổi sau khi mất điện —
tiện khi cần kiểm tra hoặc làm OTA về sau.
