# Hướng dẫn tạo database trên máy mới

Dành cho máy **chưa từng cài AquaControl** — tạo database `AquaControl` từ đầu.
Mất khoảng 5 phút. Phần cài SQL Server và SSMS xem `DEPLOY.md` Phần 1–2.

> Nếu máy đã có database `AquaControl` với dữ liệu cần giữ thì **đừng dùng tài liệu này** —
> `schema.sql` sẽ xoá toàn bộ bảng cũ. Hãy sao lưu trước.

---

## Bước 1 — Kiểm tra đang đứng đúng server

Mở SSMS → **New Query**, chạy:
```sql
SELECT @@SERVERNAME AS ServerHienTai, SUSER_NAME() AS DangDangNhapBang;
```
`ServerHienTai` phải khớp với `DB_SERVER` trong file `.env`.
Máy có nhiều instance mà chạy nhầm cái khác là mất rất nhiều thời gian để phát hiện.

---

## Bước 2 — Chạy schema

1. **File → Open → File...** → chọn `db\schema.sql`.
2. Đọc lướt phần đầu file: khối `CREATE DATABASE ... ON PRIMARY` đang bị chú thích, nghĩa là
   SQL Server tự chọn thư mục chứa file dữ liệu — chạy được trên mọi máy, không cần tạo thư mục trước.
   Muốn đặt file `.mdf` vào ổ riêng thì bỏ chú thích khối đó và sửa đường dẫn (nhớ tạo thư mục trước).
3. Bấm **Execute (F5)**.

Chạy đúng thì khung **Messages** kết thúc bằng:
```
Schema AquaControl v2 (10 zone) da tao xong.
Buoc tiep theo: chay `npm run seed` de tao tai khoan admin.
```

> Vài dòng cảnh báo là bình thường. Chỉ cần để ý các dòng **Msg ... Level ... State ...** màu đỏ.

---

## Bước 3 — Kiểm tra kết quả

Đừng tin mỗi dòng thông báo, chạy đoạn này để xác nhận:

```sql
USE AquaControl;

-- Phải ra đúng 8 bảng: AutomationRules, Devices, EventLog, PumpState,
-- Telemetry, Users, WateringRuns, WateringSchedules
SELECT name FROM sys.tables ORDER BY name;

-- Cả 3 dòng đều phải ra 10
SELECT 'PumpState' AS Bang, COUNT(*) AS SoDong FROM dbo.PumpState
UNION ALL SELECT 'AutomationRules', COUNT(*) FROM dbo.AutomationRules
UNION ALL SELECT 'Devices', COUNT(*) FROM dbo.Devices;

-- Ngưỡng mặc định: 30% / hysteresis 15% / cắt ở 5 phút / nghỉ 20 phút
SELECT TOP 3 * FROM dbo.AutomationRules ORDER BY Zone;

-- API key của 10 node - lát nữa điền vào firmware từng con
SELECT DeviceId, Zone, ApiKey FROM dbo.Devices ORDER BY Zone;
```

Thiếu bảng hoặc số dòng không phải 10 → xem phần **Xử lý lỗi**, đừng chạy tiếp.

---

## Bước 4 — Tạo tài khoản admin

Mật khẩu cần hash bcrypt nên không seed bằng SQL được. Mở PowerShell tại thư mục dự án:

```powershell
npm run seed
```

Thành công sẽ in: `✔ Đã tạo/cập nhật admin: admin / admin123`

Muốn đặt tài khoản khác: `npm run seed tenban matkhaumoi`

---

## Bước 5 — Chạy thử

```powershell
npm run dev
```

Đạt khi terminal in đủ 3 dòng:
```
[db] Đã kết nối SQL Server: ... / AquaControl
[init] Đã nạp trạng thái 10 bơm và danh sách API key thiết bị
[server] AquaControl Pro chạy tại http://127.0.0.1:5000
```

Mở terminal thứ hai, đổ dữ liệu giả vào:
```powershell
npm run simulate -- --fast
```

Vào http://localhost:5000, đăng nhập `admin` / `admin123` → trang Overview phải hiện
đủ 10 zone và số liệu tự nhảy sau vài giây.

---

## Xử lý lỗi thường gặp

| Thông báo | Nguyên nhân | Cách xử lý |
|---|---|---|
| `CREATE DATABASE permission denied` | Login không đủ quyền | Kết nối lại bằng Windows Authentication, hoặc cấp quyền: `ALTER SERVER ROLE sysadmin ADD MEMBER <login>` |
| `Cannot drop database ... currently in use` | Đang có kết nối mở tới DB | Dừng `npm run dev` (Ctrl+C), đóng các tab query khác trong SSMS, chạy lại |
| `Invalid object name 'dbo.PumpState'` khi `npm run dev` | Schema chưa chạy, hoặc chạy nhầm database | Làm lại Bước 1–3, kiểm tra `DB_DATABASE` trong `.env` |
| `Login failed for user` khi `npm run dev` | Sai `DB_USER`/`DB_PASSWORD`, hoặc chưa bật SQL Server Authentication | SSMS → chuột phải server → Properties → Security → chọn *SQL Server and Windows Authentication mode* → restart service |
| `Failed to connect to localhost:1433` | TCP/IP chưa bật hoặc chưa restart service | Xem `DEPLOY.md` Phần 2 bước 3 |
| Bảng tạo xong nhưng `PumpState` rỗng | Phần seed cuối file chưa chạy hết | Bôi đen riêng phần `INSERT` cuối file rồi bấm F5 |
| `Incorrect syntax near the keyword '...'` | Tên cột trùng từ khoá dành riêng của SQL Server (`Trigger`, `Key`, `User`, `File`...) | Đổi tên cột, hoặc bọc trong ngoặc vuông `[Trigger]`. Lỗi này kéo theo dòng `Cannot find the object` ngay sau đó vì bảng không tạo được |

---

## Sau khi xong

Ghi lại 10 API key lấy ở Bước 3 — mỗi node ESP32 cần đúng key của zone mình khi nạp firmware
(xem `firmware/HUONG_DAN.md`). Dùng nhầm key của zone khác thì server sẽ từ chối dữ liệu,
đó là chủ ý để phát hiện nạp nhầm.

Chạy lại `schema.sql` lần nữa sẽ **xoá sạch và tạo lại** toàn bộ bảng, kể cả tài khoản admin.
