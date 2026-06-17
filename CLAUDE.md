# CLAUDE.md — AquaControl Pro

Hướng dẫn cho Claude Code khi tiếp tục dự án này trên máy khác.

## Dự án là gì
Web dashboard giám sát + điều khiển **hệ thống vườn tưới thông minh ESP32** trong nhà kính:
- **3 khu (Zone 1/2/3)**: mỗi khu có cảm biến độ ẩm đất + 1 máy bơm.
- **1 DHT22** dùng chung (nhiệt độ + độ ẩm không khí), **1 cảm biến ánh sáng** + **1 dải đèn LED**.
- **1 ESP32-Cam**: đo kích thước tán lá + phát hiện sâu bệnh (qua AI-service).
- Có **đăng nhập admin**, dữ liệu **realtime**, **xuất CSV**.

## Tech stack
| Lớp | Công nghệ |
|-----|-----------|
| Backend | Node.js + Express + Socket.IO |
| Database | SQL Server (driver `mssql`) |
| Auth | express-session + bcryptjs |
| Frontend | HTML/CSS/JS thuần + Tailwind (CDN) + Chart.js |
| AI camera | Python + Flask + OpenCV (microservice riêng, cổng 5001) |
| Firmware | ESP32 / ESP32-Cam (Arduino IDE, người dùng tự code/nạp) |

> Người dùng chỉ thạo HTML/CSS/JS, Node.js, SQL Server. Giữ giải pháp đơn giản, ưu tiên stack này.

## Cấu trúc thư mục
```
server/
  app.js              Express + Socket.IO + session + định tuyến + phục vụ static
  config.js           Đọc .env
  db.js               Pool mssql (lazy) + helper query(text, params)
  realtime.js         Giữ io, hàm emit(event, payload)
  middleware/auth.js  requireLogin (session) + requireApiKey (header x-api-key)
  routes/             auth, telemetry, commands, camera, export, rules, logs
  services/           telemetryService, automationService, actuatorService, csvService, logService
  scripts/            seedAdmin.js (tạo admin), simulate.js (giả lập ESP32)
  public/             Frontend: *.html + js/ (theme.js, common.js, <page>.js) + css/app.css
ai-service/           app.py (Flask /analyze, /health) + detector.py (OpenCV) + requirements.txt
db/schema.sql         Tạo DB AquaControl + 7 bảng + seed (chạy bằng SSMS)
stitch-export/        Thiết kế gốc (design system + 5 màn hình HTML tham chiếu)
.env.example          Mẫu cấu hình
```

## Database (SQL Server) — 7 bảng
`Users`, `Devices`, `Telemetry`, `ActuatorState`, `AutomationRules`, `CameraAnalysis`, `EventLog`.
- Seed sẵn: 4 cơ cấu (`pump1/2/3`, `led`), 3 luật (zone 1/2/3), 2 thiết bị (`AQ-ESP-0922`, `AQ-CAM-0101`).
- Tài khoản admin KHÔNG seed bằng SQL (cần hash bcrypt) → tạo bằng `npm run seed`.
- `db/schema.sql` dùng `GO` batch → **chỉ chạy bằng SSMS/Azure Data Studio**, không chạy qua Node.

## API chính
| Method | Route | Mô tả | Bảo vệ |
|--------|-------|-------|--------|
| POST | `/login`, `/logout` | Đăng nhập/xuất | session |
| GET | `/api/me` | User hiện tại | session |
| POST | `/api/telemetry` | ESP32 đẩy dữ liệu 3 zone | x-api-key |
| GET | `/api/telemetry/latest`, `/history` | Số liệu dashboard | session |
| GET | `/api/commands` | ESP32 poll lệnh bơm/đèn | x-api-key |
| GET/POST | `/api/control` | Bật/tắt bơm/đèn, auto/manual | session |
| POST | `/api/camera/analysis` | AI-service gửi kết quả | x-api-key |
| POST | `/api/camera/capture` | Admin chụp ảnh tĩnh từ ESP32-Cam theo zone (`?zone=N`) | session |
| GET | `/api/camera/latest`, `/history` | Dữ liệu trang Camera | session |
| GET | `/api/export/csv` | Tải CSV | session |
| GET/PUT | `/api/rules`, `/api/rules/:zone` | Luật tự động | session |
| GET | `/api/logs` | Nhật ký | session |

### Hợp đồng dữ liệu thiết bị (firmware phải khớp y hệt)
`POST /api/telemetry` (header `x-api-key`):
```json
{ "deviceId":"AQ-ESP-0922","rssi":-62,"uptime":12345,"voltage":12.2,
  "zones":[{"zone":1,"temperature":28.4,"airHumidity":62,"light":850,"soilMoisture":45}, ...3 zone] }
```
`GET /api/commands` trả: `{"actuators":{"pump1":{"state":false,"mode":"auto"}, ..., "led":{...}}}`.
- 1 DHT22 dùng chung → 3 zone gửi cùng temperature/airHumidity; light + soilMoisture riêng.

## Realtime (Socket.IO)
Server emit các event (xem `realtime.emit`): `telemetry`, `actuator`, `camera`, `log`.
Chỉ client đã đăng nhập mới nhận (session chia sẻ qua `io.engine.use(sessionMiddleware)` trong app.js).
Frontend: `common.js` khởi tạo `io()` → `window.appSocket`; mỗi trang lắng nghe event tương ứng.

## Logic tự động (automationService.js)
Khi nhận telemetry, với cơ cấu đang `mode='auto'`:
- Bơm zone N **bật** khi `soilMoisture < SoilThreshold` (mặc định 30%).
- Đèn LED **bật** khi ánh sáng trung bình các zone < ngưỡng trung bình (mặc định 300 lux).
- Cơ cấu `mode='manual'` do admin tự điều khiển, automation bỏ qua.

## Chạy dự án (lần đầu, theo thứ tự)
```bash
# 1. SSMS: chạy db/schema.sql (tạo DB + bảng)
# 2. Cấu hình:
cp .env.example .env        # sửa DB_USER, DB_PASSWORD, DB_SERVER cho khớp SQL Server
npm install
npm run seed                # tạo admin / admin123
# 3. Chạy:
npm run dev                 # nodemon, http://localhost:3000
npm run simulate            # (terminal 2) giả lập ESP32 đẩy dữ liệu để test
```
Đăng nhập: `admin` / `admin123` (đổi bằng `npm run seed <user> <pass>`).

## Biến môi trường (.env) quan trọng
- `HOST` (dev `127.0.0.1`; để ESP32/LAN truy cập → đổi `0.0.0.0`), `PORT` (3000), `PUBLIC_URL`.
- `SESSION_SECRET`, `COOKIE_SECURE` (true khi có HTTPS).
- `DEVICE_API_KEY` — phải trùng với header `x-api-key` của ESP32/AI-service.
- `DB_USER/DB_PASSWORD/DB_SERVER/DB_DATABASE/DB_PORT`, `DB_ENCRYPT`, `DB_TRUST_CERT`.
  - SQL Server Auth (user/pass). Nếu instance dạng `localhost\SQLEXPRESS` → `DB_SERVER=localhost\\SQLEXPRESS`.
- `AI_SERVICE_URL` (http://localhost:5001).
- `ESP32CAM_STREAM_URL_1/2/3` (http://<ip-cam>:81/stream) — 3 camera quan sát theo zone.
- `ESP32CAM_CAPTURE_URL_1/2/3` (tuỳ chọn) — URL chụp ảnh tĩnh. Nếu bỏ trống, server tự suy ra
  `http://<ip-cam>/capture` (port 80) từ URL stream tương ứng.

## AI-service (Python, tuỳ chọn)
```bash
cd ai-service && python -m venv venv && venv\Scripts\activate
pip install -r requirements.txt
python app.py               # cổng 5001; đặt NODE_URL, DEVICE_API_KEY, PULL_STREAM_URL nếu cần
```
`detector.py`: đo tán lá bằng HSV mask + bounding box (`PIXELS_PER_CM` cần hiệu chỉnh theo lắp đặt);
phát hiện sâu bệnh bằng tỉ lệ đốm nâu/vàng (heuristic, nâng cấp model sau).

## Firmware ESP32 (người dùng tự code trên Arduino IDE)
- Controller (`deviceId=AQ-ESP-0922`): POST `/api/telemetry` mỗi 5s, GET `/api/commands` mỗi 2s.
- Cam (`deviceId=AQ-CAM-0101`): khuyến nghị nạp example **CameraWebServer** (board AI Thinker ESP32-CAM),
  đặt `ESP32CAM_STREAM_URL` → AI-service tự kéo frame phân tích.
- Analog chỉ dùng ADC1 (GPIO 32–39) khi WiFi bật. Module relay thường active-LOW (đảo logic).
- Thư viện cần: DHT sensor library (Adafruit) + Adafruit Unified Sensor, ArduinoJson. WiFi/HTTPClient có sẵn trong core ESP32.

## Quy ước & lưu ý khi sửa code
- Giao diện bám **design system "HydroLogic Intelligence"** (xem `stitch-export/design.md`):
  glassmorphism (`.glass-card`), Inter + JetBrains Mono, primary `#003d9b`, secondary green `#006e2f`.
  Tailwind config nằm ở `public/js/theme.js`; style chung ở `public/css/app.css`.
- Mỗi trang HTML đặt `<body data-page="..." data-title="...">`; `common.js` tự dựng sidebar/topbar + auth + socket.
- Route thiết bị (ESP32/AI) dùng `requireApiKey`; route web dùng `requireLogin`. Giữ nguyên quy ước này.
- `db.query(text, params)` tự bind tham số — luôn dùng tham số hoá, không nối chuỗi SQL.
- **Ngôn ngữ (QUAN TRỌNG):**
  - **Tiếng Anh** cho mọi text **hiển thị cho người dùng**: UI frontend (HTML/JS: nhãn, nút, placeholder,
    tiêu đề, alt/aria, toast), thông báo lỗi API trả qua `res.json({ error })`, và nội dung log ghi vào
    `EventLog` qua `logService` (vì hiện trên trang Logs).
  - **Tiếng Việt** cho phần **dev/không hiển thị**: comment trong code (`//`, `/* */`, `<!-- -->`) và
    `console.log/console.error` (chỉ ra terminal).
  - Khi thêm tính năng mới: viết text hiển thị bằng tiếng Anh, comment vẫn bằng tiếng Việt.
  - Thương hiệu: tên sản phẩm **"AquaControl Pro"**, phụ đề **"IoT Greenhouse"** (không dùng "ESP32 Irrigation System").

## Trạng thái hiện tại (2026-06-17)
- ✅ Backend, frontend (login + 6 trang), AI-service, DB, scripts: HOÀN CHỈNH, chạy local OK.
- ✅ Đã test: login, auth guard, telemetry qua simulate, realtime, control, export CSV.
- ✅ Trang Camera: thêm nút **Chụp ảnh** (`POST /api/camera/capture`) — tải ảnh tĩnh từ ESP32-Cam,
  lưu `server/public/captures/`, ghi `CameraAnalysis.ImagePath`, hiện ảnh + lịch sử có thumbnail.
- ✅ Đã chuyển **toàn bộ text hiển thị (UI + thông báo API + log) sang tiếng Anh**; comment + `console.*`
  giữ tiếng Việt (xem quy ước Ngôn ngữ ở trên).
- ⬜ Firmware thật chưa nạp (đang ở bước này). Plan firmware: xem phần ADDENDUM trong file plan của Claude.
- ⚠️ Người dùng yêu cầu **hỏi trước khi chỉnh sửa file**.
