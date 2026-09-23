# Hướng dẫn chạy `schema.sql` an toàn

`db/schema.sql` **XOÁ toàn bộ bảng cũ rồi tạo lại** theo cấu trúc 10 zone.
Làm đúng thứ tự dưới đây thì kể cả chạy sai vẫn khôi phục lại được.

Thời gian: khoảng 10 phút.

---

## Bước 0 — Sao lưu database hiện tại (làm trước tiên)

Kể cả khi bạn không cần dữ liệu 3 zone cũ, vẫn nên backup: có bản `.bak` thì mọi sai sót
sau đó đều quay lui được.

### Cách A — bằng giao diện SSMS
1. Mở SSMS, kết nối tới server.
2. Chuột phải database **AquaControl** → **Tasks → Back Up...**
3. Backup type: **Full**. Ghi nhớ đường dẫn ở mục *Destination* (mặc định thư mục `Backup`
   của SQL Server).
4. Bấm **OK**, đợi thông báo *"The backup ... completed successfully"*.

### Cách B — bằng câu lệnh (nhanh hơn)
Mở **New Query** trong SSMS, chạy:
```sql
BACKUP DATABASE AquaControl
TO DISK = 'C:\SQLBackup\AquaControl_truoc_v2.bak'
WITH FORMAT, NAME = 'AquaControl truoc khi nang cap v2';
```
> Tạo sẵn thư mục `C:\SQLBackup` trước khi chạy, nếu không sẽ lỗi *Cannot open backup device*.
> Nếu SQL Server báo không có quyền ghi, đổi sang thư mục mà tài khoản dịch vụ SQL ghi được,
> ví dụ `C:\Program Files\Microsoft SQL Server\MSSQL16.SQLEXPRESS\MSSQL\Backup\`.

**Chỉ đi tiếp khi đã thấy thông báo backup thành công.**

---

## Bước 1 — Kiểm tra đang đứng đúng server

Trong cửa sổ New Query của SSMS, chạy:
```sql
SELECT @@SERVERNAME AS ServerHienTai, DB_NAME() AS DatabaseHienTai;
```
`ServerHienTai` phải khớp với `DB_SERVER` trong file `.env` của bạn.
Đang có nhiều instance mà chạy nhầm cái khác là mất công dò rất lâu.

Xem trước những gì sắp bị xoá:
```sql
USE AquaControl;
SELECT name AS BangHienCo FROM sys.tables ORDER BY name;
SELECT COUNT(*) AS SoDongTelemetry FROM dbo.Telemetry;
```

---

## Bước 2 — Chạy schema

1. **File → Open → File...** → chọn `db\schema.sql`.
2. Đọc lướt phần đầu file: khối `CREATE DATABASE ... ON PRIMARY` đang bị chú thích, nghĩa là
   SQL Server sẽ tự chọn thư mục chứa file dữ liệu. Nếu database `AquaControl` **đã tồn tại**
   thì file giữ nguyên chỗ cũ, không tạo lại.
3. Kiểm tra thanh công cụ đang trỏ đúng server, rồi bấm **Execute (F5)**.

Chạy đúng thì khung **Messages** kết thúc bằng:
```
Schema AquaControl v2 (10 zone) da tao xong.
Buoc tiep theo: chay `npm run seed` de tao tai khoan admin.
```

> Vài dòng cảnh báo kiểu *"Warning: The join order has been enforced"* là bình thường.
> Chỉ cần để ý các dòng **Msg ... Level ... State ...** màu đỏ.

---

## Bước 3 — Kiểm tra kết quả

Chạy đoạn này trong SSMS để xác nhận, đừng tin mỗi dòng thông báo:

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

Thiếu bảng hoặc số dòng không phải 10 → xem phần **Xử lý lỗi** bên dưới, đừng chạy tiếp.

---

## Bước 4 — Tạo tài khoản admin

Bảng `Users` vừa bị xoá nên tài khoản cũ không còn. Mở PowerShell tại thư mục dự án:

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
[server] AquaControl Pro chạy tại http://127.0.0.1:3000
```

Mở terminal thứ hai, đổ dữ liệu giả vào:
```powershell
npm run simulate -- --fast
```

Vào http://localhost:3000, đăng nhập `admin` / `admin123` → trang Overview phải hiện
đủ 10 zone và số liệu tự nhảy sau vài giây.

---

## Xử lý lỗi thường gặp

| Thông báo | Nguyên nhân | Cách xử lý |
|---|---|---|
| `Cannot drop database ... currently in use` | Server Node hoặc SSMS đang mở kết nối tới DB | Dừng `npm run dev` (Ctrl+C), đóng các tab query khác, chạy lại |
| `CREATE DATABASE permission denied` | Login không đủ quyền | Kết nối lại bằng Windows Authentication, hoặc cấp quyền: `ALTER SERVER ROLE sysadmin ADD MEMBER <login>` |
| `Cannot open backup device` | Thư mục backup chưa tồn tại hoặc SQL không có quyền ghi | Tạo thư mục trước, hoặc backup vào thư mục `Backup` mặc định của SQL Server |
| `Invalid object name 'dbo.PumpState'` khi chạy `npm run dev` | Schema chưa chạy, hoặc chạy nhầm database khác | Làm lại Bước 1–3, kiểm tra `DB_DATABASE` trong `.env` |
| `Login failed for user` khi chạy `npm run dev` | Sai `DB_USER`/`DB_PASSWORD`, hoặc chưa bật SQL Server Authentication | SSMS → chuột phải server → Properties → Security → chọn *SQL Server and Windows Authentication mode* → restart service |
| Bảng tạo xong nhưng `PumpState` rỗng | Phần seed cuối file bị lỗi hoặc chưa chạy hết | Bôi đen riêng phần `INSERT` cuối file rồi bấm F5 để chạy lại |

---

## Khôi phục nếu cần quay lui

```sql
USE master;
ALTER DATABASE AquaControl SET SINGLE_USER WITH ROLLBACK IMMEDIATE;

RESTORE DATABASE AquaControl
FROM DISK = 'C:\SQLBackup\AquaControl_truoc_v2.bak'
WITH REPLACE;

ALTER DATABASE AquaControl SET MULTI_USER;
```
Nhớ dừng `npm run dev` trước khi restore, nếu không sẽ báo database đang được sử dụng.

---

## Sau khi xong

Ghi lại 10 API key ở Bước 3 — mỗi node ESP32 cần đúng key của zone mình khi nạp firmware
(xem `firmware/HUONG_DAN.md`). Dùng nhầm key của zone khác thì server sẽ từ chối dữ liệu,
đó là chủ ý để phát hiện nạp nhầm.
