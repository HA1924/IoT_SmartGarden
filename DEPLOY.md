# Hướng dẫn deploy AquaControl Pro lên máy mới (từ con số 0)

Áp dụng cho Windows 10/11 hoặc Windows Server. Từ máy trắng chưa cài gì đến hệ thống chạy được,
mất khoảng **60–90 phút**, phần lớn là thời gian chờ cài SQL Server.

Thứ tự: kiểm tra tool → cài thiếu → cấu hình SQL → lấy code → tạo DB → chạy → mở mạng → chạy nền.

---

# PHẦN 0 — Kiểm tra máy đã có đủ tool chưa

Mở **PowerShell** (không cần quyền admin cho bước kiểm tra) và dán **nguyên khối** dưới đây:

```powershell
Write-Host "`n===== KIEM TRA MOI TRUONG AQUACONTROL PRO =====`n"

# 1. Node.js - bat buoc >= 18 vi code dung fetch() co san
$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) {
    $v = (node -v).TrimStart('v').Split('.')[0]
    if ([int]$v -ge 18) { Write-Host "OK     Node.js $(node -v)" -ForegroundColor Green }
    else { Write-Host "CAN NANG CAP  Node.js $(node -v) - can >= 18" -ForegroundColor Yellow }
} else { Write-Host "THIEU  Node.js" -ForegroundColor Red }

# 2. npm
$npm = Get-Command npm -ErrorAction SilentlyContinue
if ($npm) { Write-Host "OK     npm $(npm -v)" -ForegroundColor Green }
else { Write-Host "THIEU  npm" -ForegroundColor Red }

# 3. Git (chi can neu lay code bang git clone)
$git = Get-Command git -ErrorAction SilentlyContinue
if ($git) { Write-Host "OK     $(git --version)" -ForegroundColor Green }
else { Write-Host "THIEU  Git (bo qua neu copy code bang USB)" -ForegroundColor Yellow }

# 4. Dich vu SQL Server
$sqlSvc = Get-Service | Where-Object { $_.Name -like 'MSSQL$*' -or $_.Name -eq 'MSSQLSERVER' }
if ($sqlSvc) {
    foreach ($s in $sqlSvc) { Write-Host "OK     $($s.Name) - dang $($s.Status)" -ForegroundColor Green }
} else { Write-Host "THIEU  SQL Server" -ForegroundColor Red }

# 5. SSMS - bat buoc de chay schema.sql (file dung GO batch)
#    SSMS 18/19 nam o Program Files (x86), SSMS 20/21 nam o Program Files
$ssmsPaths = @(
    "C:\Program Files (x86)\Microsoft SQL Server Management Studio*\Common7\IDE\Ssms.exe",
    "C:\Program Files\Microsoft SQL Server Management Studio*\Common7\IDE\Ssms.exe"
)
$ssms = Get-ChildItem $ssmsPaths -ErrorAction SilentlyContinue | Select-Object -First 1
if ($ssms) { Write-Host "OK     SSMS: $($ssms.FullName)" -ForegroundColor Green }
else { Write-Host "THIEU  SSMS (SQL Server Management Studio)" -ForegroundColor Red }

# 6. SQL Server co nghe cong 1433 khong
$tcp = Test-NetConnection -ComputerName localhost -Port 1433 -InformationLevel Quiet -WarningAction SilentlyContinue
if ($tcp) { Write-Host "OK     SQL Server dang nghe cong 1433" -ForegroundColor Green }
else { Write-Host "CHUA   Cong 1433 chua mo - xem PHAN 2 buoc 3" -ForegroundColor Yellow }

# 7. Cong 5000 con trong khong
$busy = Get-NetTCPConnection -LocalPort 5000 -State Listen -ErrorAction SilentlyContinue
if ($busy) { Write-Host "BAN    Cong 5000 dang bi PID $($busy[0].OwningProcess) chiem" -ForegroundColor Yellow }
else { Write-Host "OK     Cong 5000 con trong" -ForegroundColor Green }

Write-Host "`n==============================================`n"
```

Đọc kết quả:

| Dòng | Nghĩa là |
|---|---|
| `THIEU Node.js` / `npm` | Làm Phần 1 bước 1 |
| `CAN NANG CAP Node.js` | Bản quá cũ, `fetch()` chưa có sẵn → `npm run simulate` sẽ lỗi. Cài lại bản 20 LTS |
| `THIEU Git` | Bỏ qua được nếu copy code bằng USB |
| `THIEU SQL Server` / `SSMS` | Làm Phần 1 bước 2 và 3 |
| `CHUA cong 1433` | SQL đã cài nhưng chưa bật TCP/IP → Phần 2 bước 3 |
| `BAN cong 5000` | Có ứng dụng khác chiếm cổng → đổi `PORT` trong `.env`, hoặc tắt tiến trình đó |

---

# PHẦN 1 — Cài những thứ còn thiếu

### 1. Node.js 20 LTS
Tải tại https://nodejs.org → **Windows Installer (.msi)** → cài mặc định.
Đóng PowerShell rồi mở lại, kiểm tra: `node -v` phải ra `v20.x.x`.

### 2. SQL Server Express (miễn phí)
Tải tại https://www.microsoft.com/sql-server/sql-server-downloads → mục **Express** → kiểu cài **Basic**.

**Bản 2019, 2022 hay 2025 đều dùng được** — dự án chỉ dùng T-SQL tiêu chuẩn. Trang tải thường
chỉ để bản mới nhất, cứ lấy bản đó.

Cài xong màn hình cuối có ghi **Connection String** và tên instance, thường là `SQLEXPRESS` — ghi lại.

> **Riêng bản 2022 trở lên**: nếu lúc cài bạn bật tuỳ chọn **Force Strict Encryption** (TDS 8.0)
> thì phải sửa `.env` thành `DB_ENCRYPT=true` và `DB_TRUST_CERT=true`, nếu không Node sẽ báo lỗi
> kết nối dù SQL vẫn chạy. Không bật thì để nguyên `DB_ENCRYPT=false`.

### 3. SSMS (SQL Server Management Studio)
Tải riêng tại https://aka.ms/ssmsfullsetup.
**Bắt buộc phải có**: `db/schema.sql` dùng cú pháp `GO` batch nên chỉ chạy được bằng SSMS,
không chạy qua Node hay công cụ khác được.

SSMS phiên bản nào cũng mở được database do SQL Server 2019–2025 tạo ra, nhưng nên lấy bản mới nhất.

### 4. Git (bỏ qua nếu copy code bằng USB)
Tải tại https://git-scm.com → cài mặc định.

---

# PHẦN 2 — Cấu hình SQL Server

Đây là phần hay sai nhất. Làm đủ 3 bước.

### Bước 1: Bật đăng nhập bằng user/mật khẩu
1. Mở SSMS, kết nối bằng **Windows Authentication**.
2. Chuột phải tên server (nút gốc trên cùng) → **Properties → Security**.
3. Chọn **SQL Server and Windows Authentication mode** → OK.

### Bước 2: Tạo user cho ứng dụng
SSMS → **New Query**, chạy:
```sql
CREATE LOGIN aquacontrol WITH PASSWORD = 'DatMatKhauManh@2026';
ALTER SERVER ROLE sysadmin ADD MEMBER aquacontrol;
```
> Đổi mật khẩu thành chuỗi của bạn và **ghi lại** — lát nữa điền vào `.env`.

### Bước 3: Bật TCP/IP và cố định cổng 1433
Làm bước này để `.env` dùng được `DB_SERVER=localhost`, tránh hẳn rắc rối với tên instance có dấu `\`.

1. Mở **SQL Server Configuration Manager** (gõ vào ô tìm kiếm Windows).
2. **SQL Server Network Configuration → Protocols for SQLEXPRESS** → chuột phải **TCP/IP** → **Enable**.
3. Chuột phải **TCP/IP** → **Properties → IP Addresses**, kéo xuống cuối mục **IPAll**:
   - `TCP Dynamic Ports`: **xoá trống**
   - `TCP Port`: **1433**
4. **SQL Server Services** → chuột phải **SQL Server (SQLEXPRESS)** → **Restart**.
5. Vẫn ở đó: **Properties → Service → Start Mode = Automatic** (để SQL tự chạy khi bật máy).

**Kiểm tra lại**:
```powershell
Test-NetConnection -ComputerName localhost -Port 1433 -InformationLevel Quiet
```
Phải ra `True`. Ra `False` thì quay lại bước 3, thường là quên Restart service.

---

# PHẦN 3 — Lấy code về máy

### Cách A — Git (khuyến nghị, sau này cập nhật dễ)
```powershell
mkdir C:\aquacontrol
cd C:\aquacontrol
git clone https://github.com/HA1924/IoT_SmartGarden.git .
npm install
```
> Repo private thì Git hỏi đăng nhập — dùng **Personal Access Token** thay mật khẩu
> (GitHub → Settings → Developer settings → Personal access tokens).

### Cách B — Copy bằng USB (khi máy đích không có internet)
1. Trên máy nguồn, copy cả thư mục dự án **trừ `node_modules`** (thư mục này rất nặng và
   phụ thuộc hệ điều hành).
2. Dán vào `C:\aquacontrol` trên máy đích.
3. Chạy `npm install` (vẫn cần internet một lần để tải thư viện).

> Máy đích **hoàn toàn không có internet**: copy luôn cả `node_modules` từ máy nguồn,
> miễn là cả hai cùng là Windows và cùng dòng Node.js.

---

# PHẦN 4 — Tạo file `.env`

`.env` nằm trong `.gitignore` nên **không có sẵn khi clone**, phải tạo tay.

```powershell
cd C:\aquacontrol
Copy-Item .env.example .env
notepad .env
```

Sửa tối thiểu 3 dòng cho khớp Phần 2:
```ini
DB_USER=aquacontrol
DB_PASSWORD=DatMatKhauManh@2026
DB_SERVER=localhost
```

Chạy thật thì đổi thêm:
```ini
NODE_ENV=production
SESSION_SECRET=<chuỗi ngẫu nhiên dài, không để nguyên mẫu>
DEVICE_API_KEY=<chuỗi ngẫu nhiên khác>
HOST=0.0.0.0                       # để máy khác và ESP32 truy cập được
PUBLIC_URL=http://192.168.1.50:5000
```

Sinh nhanh chuỗi ngẫu nhiên:
```powershell
-join ((48..57) + (97..122) | Get-Random -Count 40 | ForEach-Object { [char]$_ })
```

---

# PHẦN 5 — Tạo database

Làm theo **`db/HUONG_DAN_CHAY_DB.md`**.

Tóm tắt: mở `db\schema.sql` bằng SSMS → **Execute (F5)** → kiểm tra:
```sql
USE AquaControl;
SELECT name FROM sys.tables ORDER BY name;        -- phải ra đúng 8 bảng
SELECT COUNT(*) FROM dbo.PumpState;               -- phải ra 10
SELECT DeviceId, Zone, ApiKey FROM dbo.Devices;   -- 10 API key cho 10 node ESP32
```

Rồi tạo tài khoản admin:
```powershell
npm run seed
```

---

# PHẦN 6 — Chạy và kiểm tra

### 6.1 Xem giao diện trước, chưa cần DB
```powershell
npm run preview
```
→ http://localhost:3100, không cần đăng nhập, dữ liệu giả.
Dùng để xác nhận Node đã chạy được, tách biệt hẳn với chuyện SQL Server.

### 6.2 Chạy thật
```powershell
npm run dev
```
Đạt khi in đủ 3 dòng:
```
[db] Đã kết nối SQL Server: localhost / AquaControl
[init] Đã nạp trạng thái 10 bơm và danh sách API key thiết bị
[server] AquaControl Pro chạy tại http://0.0.0.0:5000
```

### 6.3 Đổ dữ liệu giả để kiểm tra toàn tuyến
Mở PowerShell thứ hai:
```powershell
cd C:\aquacontrol
npm run simulate -- --fast
```

Mở http://localhost:5000 → đăng nhập `admin` / `admin123`:

| Kiểm tra | Đạt khi |
|---|---|
| Trang Overview | Hiện đủ 10 zone, số liệu tự nhảy (không cần F5) |
| Trang Control | Bấm *Water 60s* → bơm bật, đếm ngược, tự tắt sau 60s |
| Trang Logs | Có dòng ghi lại lượt tưới vừa rồi |
| Trang Sensors | Bấm *Download CSV* → file tải về mở được bằng Excel |

Thử luôn cơ chế an toàn:
```powershell
npm run simulate -- --dry 3
```
Zone 3 sẽ khô dần → bơm tự bật (nếu zone đang ở chế độ Threshold) → và bị **cắt sau 5 phút**
với log mức `error` ghi `exceeded max runtime`. Đây là lớp bảo vệ chống cảm biến hỏng.

---

# PHẦN 7 — Cho máy khác và ESP32 truy cập

```powershell
# Lay IP noi bo cua may nay
ipconfig     # ghi lai dong IPv4 Address, vi du 192.168.1.50

# Mo cong 5000 tren Windows Firewall (can PowerShell quyen Admin)
netsh advfirewall firewall add rule name="AquaControl 5000" dir=in action=allow protocol=TCP localport=5000

# Mang dang o che do Public thi firewall chan gan het - doi sang Private
Get-NetConnectionProfile
Set-NetConnectionProfile -InterfaceAlias "Ethernet" -NetworkCategory Private
```

**Đặt IP cố định**: vào trang quản trị router → **DHCP Reservation** → gán cứng IP theo địa chỉ MAC
của máy này. Bắt buộc, vì IP đổi là 10 node ESP32 mất kết nối hết.

**Kiểm tra**: lấy điện thoại **tắt 4G**, cùng WiFi, mở `http://192.168.1.50:5000` — phải thấy trang đăng nhập.

Không vào được thì theo thứ tự: firewall (lệnh trên), network profile (Private), rồi `HOST=0.0.0.0` trong `.env`.

> Muốn truy cập từ **ngoài internet** (4G, mạng khác) thì cần thêm Cloudflare Tunnel hoặc
> port forwarding — phần đó tách riêng, không nằm trong tài liệu này.

---

# PHẦN 8 — Chạy nền 24/7

```powershell
npm install -g pm2 pm2-windows-startup
cd C:\aquacontrol
pm2 start server/app.js --name aquacontrol
pm2 save
pm2-startup install

# Cam may ngu / ngu dong
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
powercfg /hibernate off
```

Lệnh hay dùng: `pm2 status`, `pm2 logs aquacontrol`, `pm2 restart aquacontrol`.

**Phép thử quan trọng nhất**: `Restart-Computer`, **không đăng nhập Windows**, đợi 3 phút rồi
mở web từ máy khác. Vào được nghĩa là máy đã thật sự chạy như một server, không phải chỉ là
"máy cá nhân đang mở app".

---

# PHẦN 9 — Nạp firmware cho 10 node

Xem `firmware/HUONG_DAN.md`. Tóm tắt: cả 10 con nạp chung file
`firmware/zone-node/zone-node.ino`, mỗi con chỉ đổi 2 dòng:

```cpp
#define ZONE_ID      1                        // 1..10
#define API_KEY      "aqcp-z01-..."           // key rieng lay tu bang Devices
#define SERVER_BASE  "http://192.168.1.50:5000"   // IP may chu o Phan 7
```

---

# PHẦN 10 — Cập nhật code về sau

```powershell
cd C:\aquacontrol
git pull
npm install          # chi khi package.json co thay doi
pm2 restart aquacontrol
```

`.env` và database **không bị `git pull` ghi đè**. Nếu bản cập nhật có đổi cấu trúc bảng thì
sẽ có file migration riêng trong thư mục `db/` — đọc ghi chú của bản đó trước khi chạy.

---

# Checklist nghiệm thu

Đánh dấu đủ 10 mục là deploy xong:

- [ ] Khối lệnh Phần 0 chạy lại, tất cả đều `OK`
- [ ] `Test-NetConnection localhost -Port 1433` ra `True`
- [ ] SSMS chạy `schema.sql` xong, đếm được **8 bảng** và **10 dòng** `PumpState`
- [ ] `npm run seed` báo tạo admin thành công
- [ ] `npm run dev` in đủ 3 dòng khởi động, không lỗi
- [ ] Đăng nhập được, trang Overview hiện đủ **10 zone**
- [ ] `npm run simulate -- --fast` → số liệu tự nhảy trên web
- [ ] Bấm *Water 60s* → bơm bật, đếm ngược, tự tắt
- [ ] Máy khác trong LAN mở được `http://<IP>:5000`
- [ ] Khởi động lại máy, **không đăng nhập Windows**, web vẫn vào được

---

# Lỗi thường gặp

| Thông báo | Nguyên nhân | Cách xử lý |
|---|---|---|
| `Login failed for user 'aquacontrol'` | Chưa bật SQL Server Authentication, hoặc sai mật khẩu | Phần 2 bước 1 và 2 |
| `Failed to connect to localhost:1433` | TCP/IP chưa bật hoặc chưa restart service | Phần 2 bước 3 |
| `Invalid object name 'dbo.PumpState'` | Chưa chạy `schema.sql`, hoặc sai `DB_DATABASE` | Phần 5 |
| `EADDRINUSE :::5000` | Cổng 5000 đã bị chiếm | Đổi `PORT` trong `.env`, hoặc tắt tiến trình chiếm cổng |
| `fetch is not defined` khi `npm run simulate` | Node.js cũ hơn 18 | Cài lại Node 20 LTS |
| Máy khác không vào được web | Firewall / network Public / `HOST` sai | Phần 7 |
| Đăng nhập xong bị đá ra ngay | Chạy HTTPS mà `COOKIE_SECURE=false`, hoặc ngược lại | Sửa `COOKIE_SECURE` trong `.env` |
| ESP32 báo HTTP `401` | Sai `API_KEY` | Đối chiếu `SELECT ApiKey FROM Devices WHERE Zone = <n>` |
| ESP32 báo HTTP `-1` | Sai IP/cổng, firewall, hoặc đang gọi HTTPS bằng HTTPClient thường | Phần 7, và xem `firmware/HUONG_DAN.md` |

---

*Tài liệu này dành cho bản v2 (10 zone). `HOSTING.md` là bản cũ cho VPS v1, còn mô tả camera và
AI-service đã bị gỡ bỏ — đừng dùng lẫn.*
