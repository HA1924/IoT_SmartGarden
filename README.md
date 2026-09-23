# AquaControl Pro — Web Dashboard Vườn Tưới Thông Minh ESP32

Hệ thống giám sát & điều khiển nhà kính tưới tự động, quy mô **10 zone**:
- **Mỗi zone**: 1 ESP32 riêng + 1 DHT22 + **3 cảm biến độ ẩm đất (3 chậu)** + 1 relay + 1 bơm.
- Bơm tưới chung cho cả 3 chậu → hệ thống quyết định tưới theo **chậu khô nhất**.
- **10 node độc lập, không có master** — mỗi con tự gửi dữ liệu và tự điều khiển zone của mình.
- Dashboard có **đăng nhập admin**, dữ liệu **realtime**, **xuất CSV**, giao diện **responsive**.

### 3 chế độ tưới (mỗi zone chọn 1)
| Chế độ | Cách hoạt động |
|---|---|
| **Threshold** | Tưới khi chậu khô nhất xuống dưới ngưỡng của zone |
| **Schedule** | Tưới theo lịch hẹn giờ (giờ Việt Nam, chọn thứ trong tuần) |
| **Manual** | Chỉ tưới khi admin bấm nút |

Nút **Water 60s** dùng được ở mọi chế độ: tưới ngay rồi zone tự quay lại chế độ cũ,
không cần đổi mode qua lại.

### Tính năng dashboard
- **Overview**: 10 zone trên cùng một màn hình — 3 chậu mỗi zone, trạng thái bơm kèm đếm ngược,
  nút tưới nhanh, 4 ô tổng quan (node online, bơm đang chạy, zone thiếu nước, nhiệt độ TB).
- **Sensors**: bảng 10 zone × 3 chậu + xem trước dữ liệu trước khi xuất CSV.
- **Control**: 10 thẻ bơm, đổi chế độ, tưới tay 30/60/120 giây, nút dừng.
- **Schedules**: thêm/sửa/xoá lịch tưới theo zone, giờ và thứ trong tuần.
- **Configuration**: ngưỡng độ ẩm, hysteresis, thời gian chạy tối đa, thời gian nghỉ tối thiểu.
- **Logs**: lọc theo mức, phân trang, xoá toàn bộ nhật ký.

### Ba lớp an toàn cho bơm
1. **Giới hạn thời gian chạy** (`MaxRunMinutes`) — cảm biến hỏng đọc mãi giá trị khô thì bơm vẫn bị cắt.
2. **Node tự đếm ngược** — mất mạng giữa lúc đang tưới, bơm vẫn tắt đúng giờ.
3. **Failsafe mất server** — node không liên lạc được server quá 3 phút thì tự tắt bơm.

## Công nghệ
| Lớp | Công nghệ |
|-----|-----------|
| Backend | Node.js + Express + Socket.IO |
| Database | SQL Server (driver `mssql`) |
| Auth | express-session + bcrypt (web) · API key riêng từng node (thiết bị) |
| Frontend | HTML/CSS/JS + Tailwind (CDN) + Chart.js |
| Firmware | ESP32 (Arduino) — giao tiếp HTTP REST |

## Cấu trúc thư mục
```
server/               Backend Node (routes, services, public/ = front-end)
firmware/zone-node/   Firmware ESP32, nạp chung cho cả 10 node
db/schema.sql         Tạo database + 8 bảng + seed 10 zone (chạy bằng SSMS)
stitch-export/        Thiết kế gốc (tham chiếu)
PLAN_V2.md            Kế hoạch nâng cấp 10 zone + các quyết định đã chốt
```

## Cài đặt & chạy

### 1) Database (SQL Server)
Mở **SSMS** → mở `db/schema.sql` → **Execute (F5)**.
Tạo database `AquaControl` + 8 bảng + seed sẵn 10 zone.

> File này **DROP toàn bộ bảng cũ** rồi tạo lại. Có dữ liệu cần giữ thì backup trước.
> Không chỉ định đường dẫn file `.mdf` nên chạy được trên mọi máy; muốn đặt ổ riêng thì
> bỏ chú thích khối `CREATE DATABASE ... ON PRIMARY` ở đầu file.

### 2) Backend Node
```bash
cp .env.example .env       # rồi sửa thông tin DB
npm install
npm run seed               # tạo admin mặc định: admin / admin123
npm run dev                # chạy với nodemon (hoặc: npm start)
```
Mở http://localhost:3000 → đăng nhập `admin` / `admin123`.

### 3) Giả lập 10 node (test khi chưa có phần cứng)
```bash
npm run simulate                 # 10 node, chu kỳ 30s như thật
npm run simulate -- --fast       # chu kỳ 3s, xem kết quả nhanh khi dev
npm run simulate -- --dry 3      # ép zone 3 khô dần: test tưới tự động + cắt an toàn
```

### 4) Firmware ESP32
Xem `firmware/HUONG_DAN.md`. Cả 10 node nạp chung file `firmware/zone-node/zone-node.ino`,
mỗi con chỉ đổi `ZONE_ID` và `API_KEY`.

Lấy API key của từng node:
```sql
SELECT DeviceId, Zone, ApiKey FROM dbo.Devices ORDER BY Zone;
```

## API chính
| Method | Route | Mô tả | Bảo vệ |
|--------|-------|-------|--------|
| POST | `/login` `/logout` | Đăng nhập/xuất | session |
| POST | `/api/telemetry` | Node đẩy dữ liệu 1 zone | x-api-key |
| GET | `/api/commands?zone=N` | Node poll lệnh bơm + ngưỡng | x-api-key |
| GET/POST | `/api/control` | Trạng thái 10 bơm / đổi chế độ | session |
| POST | `/api/control/water` | Tưới tay `{zone, durationSec}` | session |
| POST | `/api/control/stop` | Dừng bơm | session |
| GET | `/api/telemetry/latest` `/history` | Số liệu dashboard | session |
| GET | `/api/devices` | Trạng thái online 10 node | session |
| GET/POST/PUT/DELETE | `/api/schedules` | Lịch tưới | session |
| GET/PUT | `/api/rules` `/api/rules/:zone` | Ngưỡng + chặn an toàn | session |
| GET | `/api/stats/watering` `/runs` | Thống kê lượt tưới | session |
| GET | `/api/export/preview` `/csv` | Xem trước & tải CSV | session |
| GET/DELETE | `/api/logs` | Nhật ký | session |

## Triển khai
Chỉ cần sửa `.env` và firmware, **không sửa code**:
- `.env`: `HOST=0.0.0.0`, `PUBLIC_URL=http://<ip-hoặc-domain>`, đổi `SESSION_SECRET`,
  bật `COOKIE_SECURE=true` khi đã có HTTPS.
- Firmware: đổi `SERVER_BASE` sang IP/domain máy chủ.
- Mạng: mở cổng 3000, hoặc đặt reverse proxy + HTTPS phía trước.

## Ghi chú
- Dữ liệu cảm biến được **giữ vĩnh viễn** (không có job xoá). Biểu đồ luôn gom nhóm bằng SQL
  trước khi trả về nên vẫn nhanh khi bảng lớn dần.
- Lịch tưới tính theo **giờ Việt Nam (UTC+7)**, không phụ thuộc đồng hồ máy chủ.
- Mỗi node có **API key riêng**; node dùng key của zone khác sẽ bị từ chối — giúp phát hiện
  nạp nhầm firmware. `DEVICE_API_KEY` trong `.env` là key dự phòng dành cho `simulate.js`.
- Cảm biến độ ẩm đất **phải hiệu chỉnh** `SOIL_RAW_DRY` / `SOIL_RAW_WET` theo thực tế,
  nếu không ngưỡng 30% trên web sẽ không tương ứng với độ ẩm thật.
- Tài khoản `admin/admin123` chỉ để dev — đổi ngay khi dùng thật (`npm run seed <user> <pass>`).
