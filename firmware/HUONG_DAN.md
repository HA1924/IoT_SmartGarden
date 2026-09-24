# Hướng dẫn nạp firmware cho 10 node ESP32

Mỗi zone có 1 ESP32 riêng, cả 10 con **nạp chung một file** `zone-node/zone-node.ino`,
chỉ khác 2 dòng cấu hình. Không có thiết bị master.

> **Làm bước 1 trước khi đụng phần cứng**: chạy `npm run simulate -- --fast` và xác nhận
> dashboard hiện đủ 10 zone. Nếu phần server chưa thông thì ESP32 có nạp cũng không gửi được gì,
> mà lúc đó rất khó biết lỗi nằm ở đâu.

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

### Bước 4: Driver USB
Cắm ESP32 vào máy, mở **Tools → Port**. Không thấy cổng COM nào thì thiếu driver:

| Chip USB trên board | Driver cần cài |
|---|---|
| CP2102 | CP210x VCP Driver (Silicon Labs) |
| CH340 / CH9102 | CH341SER (WCH) |

Nhìn con chip vuông nhỏ cạnh cổng USB để biết loại.

---

## PHẦN 2 — Đấu nối một node

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
- **Nối chung GND** giữa nguồn bơm và ESP32, nếu không relay sẽ đóng cắt thất thường.

---

## PHẦN 3 — Cấu hình từng node

Mở `firmware/zone-node/zone-node.ino`, sửa phần đầu file:

```cpp
#define ZONE_ID      1                              // ← 1..10, mỗi node một số khác nhau
#define API_KEY      "aqcp-z01-3f7a9c2e5b1d"        // ← key riêng của node này

#define WIFI_SSID    "TEN_WIFI"
#define WIFI_PASS    "MAT_KHAU_WIFI"
#define SERVER_BASE  "http://192.168.24.30:5000"    // ← IP máy chủ
```

**Lấy IP máy chủ**: mở PowerShell trên máy chạy server, gõ `ipconfig`, lấy dòng *IPv4 Address*.
Không dùng `localhost` — với ESP32 thì localhost là chính nó.

> File trong repo để sẵn IP mẫu `192.168.1.50`, nhớ đổi thành IP thật của máy bạn.

**WiFi phải là băng tần 2.4GHz.** ESP32 không bắt được 5GHz. Router phát cả hai băng tần cùng
một tên mạng thì nên tách tên riêng cho băng 2.4GHz.

### Bảng API key của 10 node

Mỗi node có key riêng, nằm ở cột `ApiKey` bảng `Devices`. Lấy bằng SSMS:
```sql
SELECT DeviceId, Zone, ApiKey FROM dbo.Devices ORDER BY Zone;
```

Bộ key mặc định do `schema.sql` seed sẵn:

| ZONE_ID | DeviceId | API_KEY |
|---|---|---|
| 1 | AQ-ZONE-01 | `aqcp-z01-3f7a9c2e5b1d` |
| 2 | AQ-ZONE-02 | `aqcp-z02-8d4b1e6a0c93` |
| 3 | AQ-ZONE-03 | `aqcp-z03-5c2f8a1b7e40` |
| 4 | AQ-ZONE-04 | `aqcp-z04-9e6d3b0f2a85` |
| 5 | AQ-ZONE-05 | `aqcp-z05-1a8c4f7d6b23` |
| 6 | AQ-ZONE-06 | `aqcp-z06-7b3e0d5c9f14` |
| 7 | AQ-ZONE-07 | `aqcp-z07-2f9a6b4e8c07` |
| 8 | AQ-ZONE-08 | `aqcp-z08-6d1c8e3a5b92` |
| 9 | AQ-ZONE-09 | `aqcp-z09-4e7b2d9f0a16` |
| 10 | AQ-ZONE-10 | `aqcp-z10-0c5f1b8d7e34` |

`DeviceId` firmware tự ghép từ `ZONE_ID`, không cần khai báo.

Node dùng key của zone khác sẽ bị server từ chối — đó là chủ ý, để phát hiện nạp nhầm firmware
giữa 10 con giống hệt nhau.

> Bộ key trên nằm trong `db/schema.sql` đã push lên GitHub. Nếu hệ thống chạy thật và repo công khai
> thì nên đổi: chạy `UPDATE dbo.Devices SET ApiKey = ... WHERE Zone = ...` trong SSMS rồi điền key mới
> vào firmware. Firmware và database phải khớp nhau, lệch là node báo `401`.

---

## PHẦN 4 — Nạp node đầu tiên

**Chỉ nạp 1 con trước.** Nạp cả 10 rồi mới phát hiện sai một dòng cấu hình thì phải tháo ra làm lại từng con.

1. **Tools → Board** → *ESP32 Dev Module*
2. **Tools → Port** → chọn cổng COM vừa hiện ra
3. Bấm **Upload**

Một số board phải **giữ nút BOOT** lúc dòng `Connecting......` xuất hiện, thả ra khi bắt đầu ghi.

### Kiểm tra

Mở **Serial Monitor**, đặt tốc độ **115200**. Chạy đúng sẽ thấy:
```
[Boot] AquaControl Pro - Node Zone 1 (fw 2.0.0)
[NVS] Nguong da nho: 30.0% (hys 15.0%, maxrun 5 phut)
[WiFi] Connected: 192.168.24.101
[Telemetry] 200 OK | soil=45/52/38% T=28.4C H=62%
```

Đồng thời trên dashboard, Zone 1 phải chuyển sang **Online** và có số liệu.

| Lỗi trên Serial | Nguyên nhân | Xử lý |
|---|---|---|
| `LOI HTTP 401` | Sai `API_KEY`, hoặc key của zone khác | Đối chiếu bảng key ở Phần 3 |
| `LOI HTTP -1` | Sai IP/cổng, firewall chưa mở, server chưa chạy, hoặc đang gọi HTTPS | Kiểm tra `SERVER_BASE`, xem mục cuối |
| `LOI HTTP 400` | Payload sai định dạng | Firmware đã sửa lệch khỏi hợp đồng dữ liệu |
| `[WiFi] KHONG ket noi duoc` | Sai SSID/mật khẩu, hoặc WiFi 5GHz | ESP32 chỉ bắt 2.4GHz |
| Serial ra ký tự loạn | Sai tốc độ baud | Đặt lại 115200 |

Chỉ khi con này chạy trơn tru mới nạp 9 con còn lại.

---

## PHẦN 5 — Hiệu chỉnh cảm biến độ ẩm đất

**Bắt buộc, không phải tuỳ chọn.** Giá trị mặc định trong code chỉ là ước lượng; chưa hiệu chỉnh
thì ngưỡng 30% trên web không tương ứng với độ ẩm thật, và bơm sẽ tưới sai hoàn toàn.

1. Nạp firmware, mở Serial Monitor.
2. Để cảm biến **khô ngoài không khí** → ghi lại số ADC.
3. **Nhúng vào nước** (chỉ ngập phần cảm biến, không ngập mạch) → ghi lại số ADC.
4. Điền vào đầu file:
   ```cpp
   #define SOIL_RAW_DRY  3200   // số đo khi khô
   #define SOIL_RAW_WET  1500   // số đo khi ngập nước
   ```
5. Nạp lại. Kiểm tra: khô phải ra ~0%, ngập nước ra ~100%.

Cảm biến khác lô có thể lệch nhau, nên đo bằng chính con cảm biến sẽ lắp.

---

## PHẦN 6 — Chạy thử an toàn

Lần thử đầu tiên nên **tháo ống nước ra khỏi bơm**, hoặc khoá van tổng.
Nghe tiếng relay tách là đủ biết mạch điều khiển đúng, không cần nước chảy thật.

Lý do: nếu đấu nhầm loại relay (active-HIGH thay vì active-LOW) thì bơm sẽ chạy **ngay khi cấp nguồn**.
Lúc đó chưa có nước là may.

Cách thử: vào trang Control trên dashboard, bấm **Water 30s** cho zone đang thử.
Relay phải tách ngay và nhả sau 30 giây.

---

## PHẦN 7 — Nạp 9 node còn lại

Mỗi con chỉ đổi **2 dòng**: `ZONE_ID` và `API_KEY` (theo bảng ở Phần 3).

**Dán nhãn số zone lên vỏ từng con ngay sau khi nạp.** Mười con giống hệt nhau, sau này gỡ ra
mà không biết con nào là zone mấy sẽ rất mất thời gian.

**Đặt DHCP Reservation** trên router cho từng node để IP không đổi sau khi mất điện — tiện khi
cần kiểm tra hoặc làm OTA về sau.

Nạp xong cả 10, dashboard phải hiện **10/10 nodes online**.

---

## PHẦN 8 — Ba cơ chế an toàn (đừng gỡ khi sửa code)

| Cơ chế | Cách hoạt động | Bảo vệ khỏi |
|---|---|---|
| **Tự đếm ngược** | Server gửi `remainingSec`, node tự đếm và tự tắt | Mất mạng giữa lúc đang tưới |
| **Cắt quá giờ** | Bơm chạy quá `MaxRunMinutes` là cắt, không cần lệnh | Server treo, lệnh kẹt, relay dính |
| **Failsafe mất server** | Quá 3 phút không liên lạc được → tắt bơm | Server chết trong lúc bơm đang chạy |

Ngoài ra node nhớ ngưỡng vào NVS: mất mạng mà zone đang ở chế độ ngưỡng thì vẫn tự tưới
từng đợt 60 giây, để cây không chết trong lúc mạng hỏng.

---

## Lưu ý: ESP32 và HTTPS

Firmware dùng `HTTPClient` thường, chỉ gọi được `http://`. Nếu sau này bạn cho server chạy sau
domain HTTPS (Cloudflare Tunnel, reverse proxy...) thì node sẽ báo lỗi `-1`.

Cách xử lý tốt nhất: **để ESP32 gọi thẳng IP nội bộ**, còn trình duyệt mới đi qua domain HTTPS.

```cpp
#define SERVER_BASE  "http://192.168.24.30:5000"   // node di trong LAN
```

Lợi ích lớn hơn việc né lỗi: **mất internet thì vườn vẫn tưới bình thường**, chỉ là tạm thời
không xem được từ xa.

Nếu bắt buộc phải gọi HTTPS thì đổi sang `WiFiClientSecure` + `client.setInsecure()`.
