# Hướng dẫn Deploy AquaControl Pro lên VPS Windows Server 2019 + Domain

> **Mục tiêu:** Đưa hệ thống lên Windows Server VPS (tenten Plan 2) có domain riêng,
> điều khiển vườn tưới từ xa qua phòng lab.

---

## Kiến trúc sau khi deploy

```
[Phòng lab / bất kỳ đâu]
    Browser → https://yourdomain.vn
                       │
               [DNS tenten → IP VPS]
                       │
          [VPS Windows Server 2019 — tenten]
          ┌────────────────────────────────────┐
          │  Nginx for Windows :80/:443 (SSL)  │
          │       ↓                  ↓         │
          │  Node.js :3000    AI-service :5001  │
          │  SQL Server Express :1433 (nội bộ) │
          └────────────────────────────────────┘
                       │
          [Internet / mạng 4G/WiFi vườn]
                       │
             [ESP32 trong nhà kính]
           POST /api/telemetry mỗi 5s
           GET  /api/commands  mỗi 2s
```

> **Lưu ý camera:** ESP32-Cam phát stream từ mạng nội bộ vườn. Xem Bước 15
> để tunnel camera ra internet nếu cần xem live từ phòng lab.

---

## Yêu cầu chuẩn bị

| Thứ | Chi tiết |
|-----|---------|
| VPS | tenten Cloud Server Windows, Plan 2 (≥ 2 GB RAM, ≥ 40 GB SSD) |
| OS | Windows Server 2019 |
| Domain | Mua tại tenten.vn (hướng dẫn Bước 1) |
| Code | Project push lên GitHub (private repo) |

---

## Bước 0 — Push code lên GitHub

> Bỏ qua nếu đã có repo GitHub.

Thực hiện trên máy tính cá nhân (không phải VPS):

```powershell
# Trong thư mục project
git add .
git commit -m "production ready"
```

Tạo repo **private** tại github.com → copy URL, rồi:

```powershell
git remote add origin https://github.com/YOUR_USERNAME/IoT_SmartGarden.git
git push -u origin master
```

---

## Bước 1 — Mua domain tại tenten.vn

1. Truy cập **tenten.vn** → đăng ký tài khoản (nếu chưa có).
2. Tìm kiếm tên domain, VD: `aquacontrol.vn` hoặc `garden.io.vn`.
3. Thêm vào giỏ → thanh toán (`.vn` ~250.000 đ/năm, `.com` ~350.000 đ/năm).
4. Sau khi mua, vào **Quản lý domain → DNS** — sẽ trỏ về IP VPS ở Bước 13.

---

## Bước 2 — Mua Cloud Server Windows tại tenten

1. Vào tenten.vn → **Cloud Server** → chọn **Plan 2**.
2. **Operating System:** Windows Server 2019.
3. Xác nhận mua, thanh toán.
4. Tenten sẽ gửi email gồm:
   - **IP công khai** của VPS (VD: `203.0.113.50`) — lưu lại
   - **Username:** `Administrator`
   - **Password:** mật khẩu Administrator — lưu lại

---

## Bước 3 — Kết nối VPS qua Remote Desktop (RDP)

**Trên Windows (máy cá nhân):**

1. Nhấn `Win + R` → gõ `mstsc` → Enter.
2. **Computer:** nhập IP VPS (`203.0.113.50`).
3. Bấm **Connect** → nhập `Administrator` + mật khẩu.

**Trên macOS:**
- Cài **Microsoft Remote Desktop** (App Store) → thêm PC mới với IP VPS.

Sau khi kết nối thành công, bạn thấy màn hình Windows Server 2019 của VPS.

---

## Bước 4 — Cài SQL Server 2022 Express (miễn phí)

Thực hiện **trong cửa sổ RDP** (trên VPS):

1. Mở **Edge/Internet Explorer** → tìm "SQL Server 2022 Express download microsoft".
2. Tải file `SQL2022-SSEI-Expr.exe` từ microsoft.com.
3. Chạy file tải về → chọn **Basic** → chọn thư mục cài → **Install**.
4. Đợi cài xong, ghi lại **Connection String** hiển thị (thường `localhost\SQLEXPRESS`).

### Cài SQL Server Management Studio (SSMS)

1. Trong cùng cửa sổ cài SQL Server → bấm **Install SSMS**.
2. Trình duyệt mở trang download SSMS → tải `SSMS-Setup-ENU.exe`.
3. Cài đặt, khởi động lại nếu cần.

### Bật SQL Server Authentication (SA login)

1. Mở **SSMS** → kết nối `localhost\SQLEXPRESS` bằng Windows Authentication.
2. Chuột phải vào tên server → **Properties → Security** → chọn **SQL Server and Windows Authentication mode** → OK.
3. Mở **Security → Logins → SA** → chuột phải → **Properties**:
   - Tab **General:** đặt password SA (VD: `AquaCtrl@2026!`) — **lưu lại**
   - Tab **Status:** Login = **Enabled**
4. Khởi động lại SQL Server: mở **Services** (`services.msc`) → **SQL Server (SQLEXPRESS)** → **Restart**.

---

## Bước 5 — Khởi tạo database bằng SSMS

Schema có hardcode đường dẫn Windows cục bộ, cần tạo thư mục data trước:

```powershell
# Mở PowerShell trên VPS
New-Item -ItemType Directory -Force -Path "C:\Data\AquaControl"
```

Trong SSMS, tạo **New Query** → paste đoạn sau để tạo database:

```sql
CREATE DATABASE AquaControl
ON PRIMARY (
    NAME = AquaControl_Data,
    FILENAME = 'C:\Data\AquaControl\AquaControl_Data.mdf',
    SIZE = 50MB, MAXSIZE = 500MB, FILEGROWTH = 10MB
)
LOG ON (
    NAME = AquaControl_Log,
    FILENAME = 'C:\Data\AquaControl\AquaControl_Log.ldf',
    SIZE = 20MB, MAXSIZE = 200MB, FILEGROWTH = 5MB
);
GO
```

Bấm **Execute (F5)**. Sau đó mở file `db\schema.sql` trong SSMS:

- **File → Open → File...** → chọn file `schema.sql` trong project
- **Xóa đoạn** `CREATE DATABASE ... LOG ON (...)` đầu file (vừa tạo rồi)
- Bấm **Execute (F5)** để tạo toàn bộ bảng + seed data

---

## Bước 6 — Cài Node.js 20 LTS

1. Tải `node-v20.x.x-x64.msi` từ nodejs.org.
2. Chạy installer → Next liên tục → **Install**.
3. Kiểm tra trong PowerShell:

```powershell
node --version   # phải ra v20.x.x
npm --version
```

---

## Bước 7 — Cài Python 3.11

1. Tải `python-3.11.x-amd64.exe` từ python.org.
2. Chạy installer → **tích "Add Python to PATH"** → **Install Now**.
3. Kiểm tra:

```powershell
python --version   # Python 3.11.x
pip --version
```

---

## Bước 8 — Cài Git for Windows

1. Tải `Git-x.x.x-64-bit.exe` từ git-scm.com.
2. Cài với cài đặt mặc định.

---

## Bước 9 — Clone code + cấu hình .env

```powershell
# Clone repo vào C:\aquacontrol
git clone https://github.com/YOUR_USERNAME/IoT_SmartGarden.git C:\aquacontrol

# Cài Node.js dependencies
cd C:\aquacontrol
npm install --production

# Cài Python dependencies cho AI service
cd C:\aquacontrol\ai-service
python -m venv venv
.\venv\Scripts\activate
# Dùng opencv-python-headless (không cần Qt/display trên server)
pip install flask flask-cors requests
pip install opencv-python-headless numpy
deactivate
cd C:\aquacontrol
```

### Tạo file .env production

```powershell
Copy-Item .env.example .env
notepad .env
```

Sửa các giá trị sau trong Notepad:

```env
HOST=0.0.0.0
PORT=3000
NODE_ENV=production
PUBLIC_URL=https://yourdomain.vn

SESSION_SECRET=thay_bang_chuoi_ngau_nhien_dai_it_nhat_64_ky_tu
COOKIE_SECURE=true

DEVICE_API_KEY=thay_bang_key_bi_mat_cho_esp32

DB_USER=SA
DB_PASSWORD=AquaCtrl@2026!
DB_SERVER=localhost\SQLEXPRESS
DB_DATABASE=AquaControl
DB_PORT=1433
DB_ENCRYPT=false
DB_TRUST_CERT=true

AI_SERVICE_URL=http://localhost:5001

# Để trống nếu chưa có ESP32-Cam thật
ESP32CAM_STREAM_URL_1=
ESP32CAM_STREAM_URL_2=
ESP32CAM_STREAM_URL_3=
```

> **Tạo SESSION_SECRET ngẫu nhiên:**
> ```powershell
> node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
> ```
> Copy output và dán vào `SESSION_SECRET=`.

---

## Bước 10 — Tạo tài khoản admin

```powershell
cd C:\aquacontrol
npm run seed
# hoặc npm run seed admin matkhau_manh
```

---

## Bước 11 — PM2 (process manager tự khởi động)

```powershell
# Cài PM2 và module tự khởi động cùng Windows
npm install -g pm2
npm install -g pm2-windows-startup
pm2-windows-startup install
```

### Tạo script khởi động AI service

```powershell
notepad C:\aquacontrol\ai-service\start.bat
```

Nội dung file `start.bat`:

```batch
@echo off
cd /d C:\aquacontrol\ai-service
call venv\Scripts\activate.bat
python app.py
```

### Tạo file ecosystem.config.js

```powershell
notepad C:\aquacontrol\ecosystem.config.js
```

Nội dung:

```js
module.exports = {
  apps: [
    {
      name: 'aquacontrol',
      cwd: 'C:\\aquacontrol',
      script: 'server/app.js',
      env: { NODE_ENV: 'production' },
      restart_delay: 5000,
      max_restarts: 10,
      log_date_format: 'YYYY-MM-DD HH:mm:ss'
    },
    {
      name: 'ai-service',
      cwd: 'C:\\aquacontrol\\ai-service',
      script: 'start.bat',
      interpreter: 'none',
      restart_delay: 5000,
      max_restarts: 5
    }
  ]
};
```

```powershell
# Khởi động cả hai process
cd C:\aquacontrol
pm2 start ecosystem.config.js

# Lưu để tự khởi động sau reboot
pm2 save

# Kiểm tra
pm2 status
pm2 logs aquacontrol --lines 30
```

---

## Bước 12 — Nginx for Windows + chạy như Service

### Tải và cài Nginx

1. Truy cập nginx.org/en/download.html → tải **nginx/Windows** (file `.zip`, phiên bản Stable).
2. Giải nén vào `C:\nginx`.

### Cấu hình Nginx

```powershell
notepad C:\nginx\conf\nginx.conf
```

Thay **toàn bộ nội dung** bằng:

```nginx
worker_processes  1;

events {
    worker_connections  1024;
}

http {
    include       mime.types;
    default_type  application/octet-stream;
    sendfile      on;
    keepalive_timeout  65;

    server {
        listen 80;
        server_name yourdomain.vn www.yourdomain.vn;

        location / {
            proxy_pass         http://127.0.0.1:3000;
            proxy_http_version 1.1;
            proxy_set_header   Upgrade    $http_upgrade;
            proxy_set_header   Connection "upgrade";
            proxy_set_header   Host       $host;
            proxy_set_header   X-Real-IP  $remote_addr;
            proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
            proxy_set_header   X-Forwarded-Proto $scheme;
            proxy_read_timeout 86400s;
        }
    }
}
```

> Thay `yourdomain.vn` bằng domain thật của bạn.

### Kiểm tra cú pháp và chạy thử

```powershell
cd C:\nginx
.\nginx.exe -t          # kiểm tra config
.\nginx.exe             # chạy thử
# Mở browser trên VPS → http://localhost → phải thấy trang login
.\nginx.exe -s stop     # dừng lại để cài Service
```

### Cài Nginx như Windows Service (dùng NSSM)

1. Tải `nssm-2.24.zip` từ nssm.cc → giải nén → copy `win64\nssm.exe` vào `C:\nginx\`.

```powershell
cd C:\nginx
.\nssm.exe install nginx C:\nginx\nginx.exe
.\nssm.exe set nginx AppDirectory C:\nginx
.\nssm.exe set nginx Description "Nginx Web Server for AquaControl"
Start-Service nginx
Get-Service nginx   # phải thấy Running
```

---

## Bước 13 — SSL với Win-ACME (Let's Encrypt miễn phí)

> **Thực hiện bước này SAU KHI** đã trỏ DNS xong (Bước 14) và DNS đã lan truyền.

1. Tải `wacs.exe` từ github.com/win-acme/win-acme/releases → giải nén vào `C:\wacs\`.

```powershell
cd C:\wacs
.\wacs.exe
```

Làm theo menu tương tác:
- Chọn **N** (New certificate)
- Chọn **1** (Manual input)
- Nhập domain: `yourdomain.vn` và `www.yourdomain.vn`
- Validation: chọn **http-01** (Nginx đang chạy cổng 80)
- Win-ACME tự cấu hình Nginx thêm block HTTPS và chứng chỉ

Sau khi xong, Nginx tự reload với HTTPS. Win-ACME tạo Windows Scheduled Task để **tự gia hạn** mỗi 60 ngày.

---

## Bước 14 — Trỏ DNS tenten.vn về VPS

1. Đăng nhập **tenten.vn → Quản lý tên miền → Quản lý DNS**.
2. Xóa bản ghi A cũ (nếu có).
3. Thêm bản ghi:

| Loại | Host | Giá trị | TTL |
|------|------|---------|-----|
| A | @ | `203.0.113.50` (IP VPS thật) | 300 |
| A | www | `203.0.113.50` (IP VPS thật) | 300 |

4. Lưu lại. DNS lan truyền mất **5–30 phút**.
5. Kiểm tra từ máy cá nhân:

```powershell
ping yourdomain.vn   # phải trả về IP VPS
```

---

## Bước 15 — Cấu hình Windows Firewall

```powershell
# Cho phép Nginx nhận kết nối từ internet
netsh advfirewall firewall add rule name="Nginx HTTP"  dir=in action=allow protocol=TCP localport=80
netsh advfirewall firewall add rule name="Nginx HTTPS" dir=in action=allow protocol=TCP localport=443

# Đảm bảo các port nội bộ KHÔNG lộ ra ngoài (mặc định đã chặn, kiểm tra cho chắc)
# Port 3000 (Node.js), 5001 (AI), 1433 (SQL Server) chỉ dùng nội bộ
```

---

## Bước 16 — Cập nhật firmware ESP32

ESP32 giờ gửi data về domain thay vì IP local. Cập nhật firmware:

```cpp
// Dùng WiFiClientSecure thay vì WiFiClient
#include <WiFiClientSecure.h>
#include <HTTPClient.h>

const char* API_BASE = "https://yourdomain.vn";
const char* API_KEY  = "DEVICE_API_KEY_giong_file_.env";

WiFiClientSecure client;

void setup() {
    // ...WiFi connect...
    client.setInsecure();  // bỏ qua xác minh cert (dùng tạm khi dev)
}

// Gửi telemetry
void sendTelemetry() {
    HTTPClient http;
    http.begin(client, String(API_BASE) + "/api/telemetry");
    http.addHeader("Content-Type", "application/json");
    http.addHeader("x-api-key", API_KEY);
    // ...http.POST(payload)...
}

// Poll lệnh
void pollCommands() {
    HTTPClient http;
    http.begin(client, String(API_BASE) + "/api/commands");
    http.addHeader("x-api-key", API_KEY);
    // ...http.GET()...
}
```

> Thư viện `WiFiClientSecure` có sẵn trong ESP32 Arduino core, không cài thêm.

---

## Bước 17 — Camera stream từ xa (tùy chọn)

Stream từ ESP32-Cam (`http://192.168.x.x:81/stream`) là địa chỉ nội bộ vườn — **trình duyệt phòng lab không xem được trực tiếp**. Dùng Cloudflare Tunnel để relay:

Trên **máy tính trong vườn** (cùng mạng WiFi với ESP32-Cam):

```powershell
# Tải cloudflared.exe từ github.com/cloudflare/cloudflared/releases
# Chạy tunnel (thay IP camera thật)
.\cloudflared.exe tunnel --url http://192.168.1.144:81
# Cloudflare in ra URL: https://abc123.trycloudflare.com
```

Cập nhật `.env` trên VPS:

```env
ESP32CAM_STREAM_URL_1=https://abc123.trycloudflare.com/stream
```

```powershell
pm2 restart aquacontrol
```

> URL Cloudflare Tunnel miễn phí thay đổi mỗi lần restart. Để có URL cố định, đăng ký tài khoản Cloudflare miễn phí và tạo Named Tunnel.

---

## Kiểm tra tổng thể

```powershell
# Trên VPS (qua RDP)
pm2 status                          # aquacontrol + ai-service đều "online"
pm2 logs aquacontrol --lines 50     # không có lỗi kết nối DB
Get-Service nginx                   # Running

# Từ máy phòng lab (PowerShell hoặc browser)
# 1. Mở browser → https://yourdomain.vn → thấy trang login (có khóa HTTPS)
# 2. Đăng nhập admin / admin123 → dashboard load, realtime hoạt động
# 3. Test API
Invoke-WebRequest -Uri "https://yourdomain.vn/api/me" -UseBasicParsing
# Kết quả: {"error":"Not authenticated"} → backend OK

# 4. Test gửi telemetry như ESP32
$body = '{"deviceId":"AQ-ESP-0922","rssi":-60,"uptime":100,"voltage":12.0,"zones":[{"zone":1,"temperature":28,"airHumidity":60,"light":800,"soilMoisture":40},{"zone":2,"temperature":28,"airHumidity":60,"light":750,"soilMoisture":35},{"zone":3,"temperature":28,"airHumidity":60,"light":820,"soilMoisture":50}]}'
Invoke-WebRequest -Uri "https://yourdomain.vn/api/telemetry" -Method POST -ContentType "application/json" -Headers @{"x-api-key"="DEVICE_API_KEY"} -Body $body -UseBasicParsing
# Kết quả: {"success":true} → telemetry + realtime hoạt động
```

---

## Cập nhật code khi có thay đổi

```powershell
# Trên máy cá nhân
git add . && git commit -m "fix: ..." && git push

# RDP vào VPS
cd C:\aquacontrol
git pull
npm install --production   # chỉ khi có thay đổi package.json
pm2 restart aquacontrol
```

---

## Troubleshoot

| Triệu chứng | Kiểm tra |
|------------|---------|
| Không vào được domain | `ping domain` từ lab — nếu không ra IP VPS → DNS chưa lan truyền, đợi thêm 30 phút |
| HTTPS lỗi cert | Chạy lại `wacs.exe` → **More options → Renew specific** |
| App crash liên tục | `pm2 logs aquacontrol` — thường là `.env` sai (DB_SERVER, DB_PASSWORD) |
| SQL Server không kết nối | Kiểm tra `DB_SERVER=localhost\SQLEXPRESS` (dấu `\`) + SA login đã bật chưa |
| Socket.IO không realtime | Nginx config phải có `Upgrade` + `Connection "upgrade"` header — xem lại Bước 12 |
| ESP32 không gửi được | Kiểm tra `DEVICE_API_KEY` khớp `.env`, dùng `WiFiClientSecure` + `setInsecure()` |
| AI service không start | Kiểm tra `C:\aquacontrol\ai-service\start.bat` và venv đã cài requirements chưa |
| Nginx không start | `C:\nginx\nginx.exe -t` kiểm tra cú pháp config |

---

## Chi phí ước tính (hàng tháng)

| Dịch vụ | Chi phí |
|---------|---------|
| Domain `.vn` (tenten.vn) | ~21.000 đ/tháng (~250.000 đ/năm) |
| Cloud Server Windows Plan 2 (tenten) | Theo giá tenten (thường 200.000–400.000 đ/tháng) |
| SSL Let's Encrypt (Win-ACME) | **Miễn phí** |
| Cloudflare Tunnel (camera) | **Miễn phí** |

---

*Tài liệu này dành riêng cho dự án AquaControl Pro — IoT Greenhouse.*
*Stack: Node.js + SQL Server Express + Python/OpenCV trên Windows Server 2019.*
*Cập nhật: 2026-06-23*
