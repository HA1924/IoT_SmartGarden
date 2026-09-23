# CLAUDE.md — AquaControl Pro v2

Hướng dẫn cho Claude Code khi tiếp tục dự án này trên máy khác.

## Dự án là gì
Web dashboard giám sát + điều khiển **hệ thống vườn tưới thông minh ESP32**, quy mô **10 zone**:
- **Mỗi zone**: 1 ESP32 riêng + 1 DHT22 + **3 cảm biến độ ẩm đất (3 chậu)** + 1 relay + 1 bơm.
- Bơm tưới chung cho cả 3 chậu → quyết định tưới dựa trên **chậu khô nhất** (`min` của 3 cảm biến).
- **Không có master**: 10 node độc lập, mỗi con tự gửi dữ liệu và tự điều khiển zone của mình.
- Có **đăng nhập admin**, dữ liệu **realtime**, **xuất CSV**.

**3 chế độ tưới, mỗi zone chọn 1 (loại trừ nhau)**:
| Mode | Ai điều khiển |
|---|---|
| `threshold` | `automationService` — tưới khi chậu khô nhất dưới ngưỡng |
| `schedule` | `schedulerService` — tưới theo lịch trong `WateringSchedules` |
| `manual` | Chỉ admin bấm trên web |

**Ghi đè tạm thời**: nút "Water 60s" dùng được ở mọi chế độ. Nó chỉ đặt `RunUntilUtc`,
**không đổi `Mode`**; trong lúc đó automation/scheduler bỏ qua zone, hết giờ thì zone tự quay
về chế độ cũ.

> Đã bỏ hẳn so với v1: cảm biến ánh sáng, dải đèn LED, camera ESP32-Cam, AI-service Python.

## Tech stack
| Lớp | Công nghệ |
|-----|-----------|
| Backend | Node.js + Express + Socket.IO |
| Database | SQL Server (driver `mssql`) |
| Auth | express-session + bcryptjs (web) · API key riêng từng node (thiết bị) |
| Frontend | HTML/CSS/JS thuần + Tailwind (CDN) + Chart.js |
| Firmware | ESP32 (Arduino IDE, người dùng tự nạp) |

> Người dùng chỉ thạo HTML/CSS/JS, Node.js, SQL Server. Giữ giải pháp đơn giản, ưu tiên stack này.

## Cấu trúc thư mục
```
server/
  app.js              Express + Socket.IO + session + định tuyến + khởi động vòng lặp nền
  config.js           Đọc .env + hằng số hệ thống (zoneCount, tzOffsetMinutes, chu kỳ tick)
  db.js               Pool mssql (lazy) + helper query(text, params)
  realtime.js         Giữ io, hàm emit(event, payload)
  middleware/auth.js  requireLogin (session) + requireApiKey (tra Devices.ApiKey)
  routes/             auth, telemetry, commands, export, rules, schedules, stats, logs
  services/           pump, irrigation, automation, scheduler, device, telemetry, csv, log
  scripts/            seedAdmin.js (tạo admin), simulate.js (giả lập 10 node)
  public/             Frontend: *.html + js/ (theme.js, common.js, <page>.js) + css/app.css
firmware/zone-node/   zone-node.ino — nạp chung cho cả 10 node, chỉ đổi ZONE_ID + API_KEY
db/schema.sql         Tạo DB AquaControl + 8 bảng + seed 10 zone (chạy bằng SSMS)
stitch-export/        Thiết kế gốc (design system + màn hình HTML tham chiếu)
PLAN_V2.md            Kế hoạch nâng cấp 10 zone (các quyết định đã chốt)
```

## Database (SQL Server) — 8 bảng
`Users`, `Devices`, `Telemetry`, `PumpState`, `AutomationRules`, `WateringSchedules`,
`WateringRuns`, `EventLog`.

Điểm cần nhớ:
- `Telemetry` lưu `Soil1/Soil2/Soil3` + `SoilMin` (tính sẵn), **không còn** `SoilMoisture` hay `Light`.
- `PumpState` khoá theo `Zone` (không phải tên actuator), có `Mode` + `RunUntilUtc` + `Source`.
- `WateringRuns` ghi từng lượt tưới → phục vụ thống kê và điều tra sự cố (`StopReason`).
- `Devices.ApiKey`: **mỗi node 1 key riêng**. Node gửi sai zone của mình sẽ bị từ chối.
- Seed sẵn 10 `PumpState`, 10 `AutomationRules`, 10 `Devices` (`AQ-ZONE-01`…`AQ-ZONE-10`).
- Tài khoản admin KHÔNG seed bằng SQL (cần hash bcrypt) → tạo bằng `npm run seed`.
- `db/schema.sql` dùng `GO` batch → **chỉ chạy bằng SSMS/Azure Data Studio**, không chạy qua Node.
- Dữ liệu **giữ vĩnh viễn, không có job xoá** → mọi truy vấn biểu đồ phải downsample bằng SQL.

## API chính
| Method | Route | Mô tả | Bảo vệ |
|--------|-------|-------|--------|
| POST | `/login`, `/logout` | Đăng nhập/xuất | session |
| GET | `/api/me` | User hiện tại | session |
| POST | `/api/telemetry` | Node đẩy dữ liệu 1 zone | x-api-key |
| GET | `/api/telemetry/latest`, `/history` | Số liệu dashboard (history đã gom nhóm) | session |
| GET | `/api/commands?zone=N` | Node poll lệnh bơm + ngưỡng + serverTime | x-api-key |
| GET/POST | `/api/control` | Trạng thái 10 bơm / đổi Mode | session |
| POST | `/api/control/water` | Tưới tay `{zone, durationSec}` | session |
| POST | `/api/control/stop` | Dừng bơm | session |
| GET | `/api/devices` | Trạng thái online 10 node | session |
| GET/POST/PUT/DELETE | `/api/schedules` | CRUD lịch tưới | session |
| GET/PUT | `/api/rules`, `/api/rules/:zone` | Ngưỡng + chặn an toàn | session |
| GET | `/api/stats/watering`, `/runs` | Thống kê lượt tưới | session |
| GET | `/api/export/csv`, `/preview` | Tải CSV | session |
| GET/DELETE | `/api/logs` | Nhật ký (có phân trang) | session |

### Hợp đồng dữ liệu thiết bị (firmware phải khớp y hệt)
`POST /api/telemetry` (header `x-api-key` = key riêng của node):
```json
{ "deviceId":"AQ-ZONE-01", "rssi":-62, "uptime":12345, "fwVersion":"2.0.0",
  "zones":[{ "zone":1, "temperature":28.4, "airHumidity":62, "soil":[45,52,38] }] }
```
Mảng `zones[]` luôn giữ dạng mảng dù node chỉ gửi 1 zone — để sau này nếu đổi sang kiến trúc
có master (gửi 10 zone 1 lần) thì backend không phải sửa.

`GET /api/commands?zone=N` trả:
```json
{ "zone":1, "pump":{"state":true,"mode":"threshold","remainingSec":45},
  "rules":{"SoilThreshold":30,"HysteresisPct":15,"MaxRunMinutes":5},
  "serverTime":"2026-09-23T09:00:00.000Z" }
```

## Realtime (Socket.IO)
Event: `telemetry` (1 zone/lần), `pump` (kèm `remainingSec`), `device` (online/offline), `log`.
Chỉ client đã đăng nhập mới nhận (session chia sẻ qua `io.engine.use(sessionMiddleware)`).
Frontend: `common.js` khởi tạo `io()` → `window.appSocket`.

## Các bất biến quan trọng (đừng phá khi sửa code)
1. **`irrigationService` là cửa duy nhất bật/tắt bơm.** Không route/service nào được `UPDATE PumpState`
   để bật tắt trực tiếp — làm vậy là mất lớp an toàn và mất bản ghi `WateringRuns`.
2. **`irrigationService.tick()` cắt bơm quá `MaxRunMinutes`.** Đây là thứ duy nhất ngăn bơm chạy
   vĩnh viễn khi cảm biến hỏng đọc mãi giá trị khô. Không bỏ, không cho đặt `MaxRunMinutes = 0`.
3. **Lịch tưới tính theo giờ VN (UTC+7)**, quy đổi từ `Date.now()` trong `schedulerService.nowInVN()`,
   **không đọc đồng hồ local của máy chủ** (server có thể đặt ở Nhật hoặc ở nhà).
4. **`telemetryService` lọc giá trị cảm biến ngoài khoảng hợp lệ thành `null`** trước khi lưu và
   trước khi đưa vào automation.
5. **`pumpService` giữ cache RAM**; 10 node poll liên tục nên không được đọc DB mỗi lần poll.
   Mọi thay đổi phải đi qua `pumpService.update()` để cache không lệch.
6. **Biểu đồ luôn dùng dữ liệu đã downsample** từ `getHistory()`, không trả dòng thô.

## Chạy dự án (lần đầu, theo thứ tự)
```bash
# 1. SSMS: chạy db/schema.sql (tạo DB + 8 bảng + seed 10 zone)
# 2. Cấu hình:
cp .env.example .env        # sửa DB_USER, DB_PASSWORD, DB_SERVER cho khớp SQL Server
npm install
npm run seed                # tạo admin / admin123
# 3. Chạy:
npm run dev                 # nodemon, http://localhost:5000
npm run simulate            # (terminal 2) giả lập 10 node
npm run simulate -- --fast          # chu kỳ 3s thay vì 30s, xem kết quả nhanh
npm run simulate -- --dry 3         # ép zone 3 khô dần để test tưới tự động + cắt an toàn
```
Đăng nhập: `admin` / `admin123` (đổi bằng `npm run seed <user> <pass>`).

## Biến môi trường (.env) quan trọng
- `HOST` (dev `127.0.0.1`; để ESP32/LAN truy cập → đổi `0.0.0.0`), `PORT` (5000), `PUBLIC_URL`.
- `SESSION_SECRET`, `COOKIE_SECURE` (true khi có HTTPS).
- `DEVICE_API_KEY` — **key dự phòng**, chấp nhận cho mọi zone, dùng cho `simulate.js` và test.
  Thiết bị thật dùng key riêng ở cột `Devices.ApiKey`.
- `DB_USER/DB_PASSWORD/DB_SERVER/DB_DATABASE/DB_PORT`, `DB_ENCRYPT`, `DB_TRUST_CERT`.
  - Nên bật TCP/IP + cố định cổng 1433 rồi dùng `DB_SERVER=localhost`, thay vì `localhost\SQLEXPRESS`.

## Firmware ESP32 (xem `firmware/HUONG_DAN.md`)
- 10 node nạp **chung 1 file** `firmware/zone-node/zone-node.ino`, chỉ đổi `ZONE_ID` + `API_KEY`.
- POST `/api/telemetry` mỗi 30s, GET `/api/commands` mỗi 5s.
- Ba cơ chế an toàn phía node: tự đếm ngược `remainingSec`, cắt khi quá `MaxRunMinutes`,
  tắt bơm khi mất server quá 3 phút. Ngưỡng nhớ vào NVS để mất mạng vẫn tưới được.
- Analog chỉ dùng ADC1 (GPIO 32–39) khi WiFi bật. Relay thường active-LOW (đảo logic).
- Thư viện: DHT sensor library (Adafruit) + Adafruit Unified Sensor, ArduinoJson 7.x.

## Quy ước & lưu ý khi sửa code
- Giao diện bám **design system "HydroLogic Intelligence"** (xem `stitch-export/design.md`):
  glassmorphism (`.glass-card`), Inter + JetBrains Mono, primary `#003d9b`, secondary green `#006e2f`.
  Tailwind config nằm ở `public/js/theme.js`; style chung ở `public/css/app.css`.
- Mỗi trang HTML đặt `<body data-page="..." data-title="...">`; `common.js` tự dựng sidebar/topbar
  + auth + socket. Số zone lấy từ `window.AC.ZONES`, không hardcode 1–10 trong từng trang.
- Route thiết bị dùng `requireApiKey`; route web dùng `requireLogin`. Giữ nguyên quy ước này.
- `db.query(text, params)` tự bind tham số — luôn dùng tham số hoá, không nối chuỗi SQL.
- **Ngôn ngữ (QUAN TRỌNG):**
  - **Tiếng Anh** cho mọi text **hiển thị cho người dùng**: UI frontend (nhãn, nút, placeholder,
    tiêu đề, alt/aria, toast), thông báo lỗi API trả qua `res.json({ error })`, và nội dung log
    ghi vào `EventLog` qua `logService` (vì hiện trên trang Logs).
  - **Tiếng Việt** cho phần **dev/không hiển thị**: comment trong code (`//`, `/* */`, `<!-- -->`)
    và `console.log/console.error` (chỉ ra terminal).
  - Thương hiệu: **"AquaControl Pro"**, phụ đề **"IoT Greenhouse"**.

## Trạng thái hiện tại (2026-09-23)
- ✅ Phase 1–6 của `PLAN_V2.md` đã code xong: DB, backend, frontend, firmware, tài liệu.
- ⬜ **Chưa chạy `db/schema.sql` trên SQL Server** → server chưa khởi động được
  (lỗi `Invalid object name 'dbo.PumpState'`). Đây là bước tiếp theo, phải làm bằng SSMS.
- ⬜ Chưa chạy thử với `npm run simulate`, chưa test 10 kịch bản ở Mục 9 của `PLAN_V2.md`.
- ⬜ Firmware chưa nạp lên phần cứng thật.
- ⬜ `HOSTING.md` vẫn còn phần camera + AI-service của v1, cần dọn.
- ⚠️ Người dùng yêu cầu **hỏi trước khi chỉnh sửa file**.
