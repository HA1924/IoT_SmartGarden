# AquaControl Pro — Web Dashboard Vườn Tưới Thông Minh ESP32

Hệ thống giám sát & điều khiển nhà kính tưới tự động dùng ESP32:
- **3 khu (Zone 1/2/3)**: mỗi khu có cảm biến độ ẩm đất + 1 máy bơm.
- **DHT22** (nhiệt độ + độ ẩm KK), **cảm biến ánh sáng** + **dải đèn LED**.
- **3 ESP32-Cam** (mỗi zone 1 camera): đo kích thước tán lá + phát hiện sâu bệnh (AI/OpenCV).
- Dashboard có **đăng nhập admin**, dữ liệu **realtime**, **xuất CSV**, giao diện **responsive**.

### Tính năng dashboard
- **Overview**: thẻ 3 zone realtime, biểu đồ nhiệt độ/độ ẩm KK, **biểu đồ độ ẩm đất theo zone** (chọn Zone 1/2/3), sức khoẻ ESP32.
- **Sensors**: bảng số liệu mới nhất + **xem trước dữ liệu** trước khi xuất CSV (theo bộ lọc thời gian/zone).
- **Control**: bật/tắt 3 bơm + đèn, chế độ auto/manual.
- **Camera**: chọn **zone (3 camera)** → stream + **nút chụp ảnh** + kết quả AI + lịch sử (có thumbnail) tương ứng từng zone.
- **Logs**: lọc theo mức, **phân trang**, **xoá toàn bộ nhật ký**.
- **Configuration**: chỉnh luật tưới/đèn theo zone.

## Công nghệ
| Lớp | Công nghệ |
|-----|-----------|
| Backend | Node.js + Express + Socket.IO |
| Database | SQL Server (driver `mssql`) |
| Auth | express-session + bcrypt |
| Frontend | HTML/CSS/JS + Tailwind (CDN) + Chart.js |
| AI camera | Python + Flask + OpenCV (microservice riêng) |
| Firmware | ESP32 / ESP32-Cam (Arduino) — giao tiếp HTTP REST |

## Cấu trúc thư mục
```
server/        Backend Node (routes, services, public/ = front-end)
ai-service/    Microservice Python phân tích camera
firmware/      Code mẫu ESP32 + ESP32-Cam
db/schema.sql  Tạo database + bảng (chạy bằng SSMS)
stitch-export/ Thiết kế gốc (tham chiếu)
```

## Cài đặt & chạy

### 1) Database (SQL Server)
- Mở **SSMS**, mở `db/schema.sql`, bấm **Execute (F5)**.
  → Tạo database `AquaControl` + 7 bảng + seed (bơm/đèn/luật/thiết bị).
- *(Nếu dùng đường dẫn file .mdf/.ldf tùy chỉnh: tạo sẵn thư mục đích trước khi chạy.)*
- **Đã có DB cũ và muốn cập nhật mà không mất dữ liệu?** Chạy `db/migration_camera_zone.sql`
  trong SSMS để thêm cột `Zone` cho bảng `CameraAnalysis` (3 camera/zone). **Đừng** chạy lại
  `schema.sql` vì nó sẽ DROP toàn bộ bảng.

### 2) Backend Node
```bash
cp .env.example .env       # rồi sửa thông tin DB, mật khẩu...
npm install
npm run seed               # tạo admin mặc định: admin / admin123
npm run dev                # chạy với nodemon (hoặc: npm start)
```
Mở http://localhost:3000 → đăng nhập `admin` / `admin123`.

### 3) Giả lập ESP32 (test khi chưa có phần cứng)
```bash
npm run simulate           # đẩy dữ liệu 3 zone mỗi 5s
```
→ Mở dashboard sẽ thấy số liệu cập nhật realtime, bơm tự bật khi soil < ngưỡng.

### 4) AI-service (tuỳ chọn, cho phần camera)
```bash
cd ai-service
python -m venv venv && venv\Scripts\activate     # Windows
pip install -r requirements.txt
set NODE_URL=http://localhost:3000
set DEVICE_API_KEY=esp32-secret-key-doi-di
python app.py              # chạy cổng 5001
```
Gửi thử 1 ảnh: `POST http://localhost:5001/analyze` (multipart field `image`).

### 5) Firmware ESP32
- `firmware/esp32_sensors/` : cảm biến + 3 bơm + đèn (sửa WiFi, `serverUrl`, `API_KEY`).
- `firmware/esp32cam/`      : ESP32-Cam (sửa WiFi, `aiServiceUrl`).

## API chính
| Method | Route | Mô tả | Bảo vệ |
|--------|-------|-------|--------|
| POST | `/login` `/logout` | Đăng nhập/xuất | session |
| POST | `/api/telemetry` | ESP32 đẩy dữ liệu 3 zone | x-api-key |
| GET | `/api/commands` | ESP32 poll lệnh bơm/đèn | x-api-key |
| POST | `/api/control` | Bật/tắt bơm/đèn, auto/manual | session |
| GET | `/api/telemetry/latest` `/history` | Số liệu dashboard | session |
| POST | `/api/camera/analysis` | AI-service gửi kết quả (kèm `zone`) | x-api-key |
| POST | `/api/camera/capture` | Admin chụp ảnh tĩnh từ ESP32-Cam theo `?zone=` (1–3) | session |
| GET | `/api/camera/latest` `/history` | Dữ liệu camera theo `?zone=` (1–3) | session |
| GET | `/api/export/preview` | Xem trước dữ liệu sẽ xuất (từ/đến/zone) | session |
| GET | `/api/export/csv` | Tải CSV | session |
| GET/PUT | `/api/rules` | Luật tự động | session |
| GET | `/api/logs` | Nhật ký | session |
| DELETE | `/api/logs` | Xoá toàn bộ nhật ký | session |

## Triển khai lên IP tĩnh
Chỉ cần sửa `.env` và firmware, **không sửa code**:
- `.env`: `HOST=0.0.0.0`, `PUBLIC_URL=http://<ip-tinh>:3000`, đổi `SESSION_SECRET` & `DEVICE_API_KEY`.
- Firmware ESP32: đổi `serverUrl` / `aiServiceUrl` sang IP tĩnh.
- Mạng: NAT/port-forward cổng 3000 (và 5001 nếu AI ở máy khác). Khuyến nghị đặt Nginx + HTTPS phía trước.

## Ghi chú
- **Camera 3 zone**: đặt 3 stream trong `.env` — `ESP32CAM_STREAM_URL_1/2/3` (ứng với Zone 1/2/3).
  Biến cũ `ESP32CAM_STREAM_URL` vẫn dùng được, xem như camera Zone 1.
  Để dữ liệu AI tách đúng zone, AI-service cần gửi kèm `zone` trong `POST /api/camera/analysis`
  (mặc định `zone=1` nếu không gửi).
- **Chụp ảnh (capture)**: nút *Chụp ảnh* trên trang Camera gọi `POST /api/camera/capture?zone=N`,
  server tải ảnh tĩnh từ `http://<ip-cam>/capture` (port 80) → lưu vào `server/public/captures/`
  → ghi `CameraAnalysis.ImagePath` + realtime. URL chụp tự suy ra từ stream, hoặc override bằng
  `ESP32CAM_CAPTURE_URL_1/2/3`. Test nhanh không cần phần cứng: trỏ biến này tới một URL trả JPEG
  bất kỳ (vd `https://picsum.photos/640/480`). Thư mục `captures/` đã được `.gitignore`.
- Phát hiện sâu bệnh hiện dùng heuristic OpenCV (đốm màu bất thường) — nâng cấp bằng model học máy khi có dữ liệu ảnh thực.
- Hệ số `PIXELS_PER_CM` trong `ai-service/detector.py` cần hiệu chỉnh theo khoảng cách lắp camera.
- Tài khoản `admin/admin123` chỉ để dev — đổi ngay khi dùng thật (`npm run seed <user> <pass>`).
