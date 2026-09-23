/* ============================================================
   AquaControl Pro v2 - Schema SQL Server (chạy bằng SSMS)

   Hệ thống: 10 zone, mỗi zone 3 chậu cây
     - 1 ESP32 / zone  (phương án A: 10 node độc lập, không master)
     - 1 DHT22 / zone  (nhiệt độ + độ ẩm không khí)
     - 3 cảm biến độ ẩm đất / zone (1 chậu 1 cảm biến)
     - 1 relay + 1 bơm / zone (tưới chung cho cả 3 chậu)

   Cách chạy:
     - Mở SQL Server Management Studio (SSMS)
     - Mở file này, bấm Execute (F5). File tự tạo database AquaControl.
     - Sau đó chạy `npm run seed` để tạo tài khoản admin (cần hash bcrypt).

   CẢNH BÁO: file này DROP toàn bộ bảng cũ. Dữ liệu 3 zone trước đây sẽ mất.
   ============================================================ */


/* ---------- Tạo database ----------
   Không chỉ định FILENAME → SQL Server tự đặt file vào thư mục mặc định của instance,
   nhờ vậy file này chạy được trên MỌI máy (máy dev, VPS, PC host) mà không cần sửa.
   Muốn đặt file vào ổ riêng thì dùng khối ON PRIMARY bị chú thích bên dưới.        */
IF DB_ID('AquaControl') IS NULL
    CREATE DATABASE AquaControl;
GO

/*  -- Tuỳ chọn: đặt file DB vào thư mục riêng (nhớ tạo thư mục trước khi chạy)
CREATE DATABASE AquaControl
ON PRIMARY (
    NAME = AquaControl_Data,
    FILENAME = 'C:\SQLData\AquaControl_Data.mdf',
    SIZE = 100MB, MAXSIZE = UNLIMITED, FILEGROWTH = 50MB
)
LOG ON (
    NAME = AquaControl_Log,
    FILENAME = 'C:\SQLData\AquaControl_Log.ldf',
    SIZE = 20MB, MAXSIZE = 1GB, FILEGROWTH = 10MB
);
GO
*/

USE AquaControl;
GO

/* Giữ hết dữ liệu, không xoá theo thời gian → cho file dữ liệu lớn tự do.
   Với chu kỳ gửi 30s: ~28.800 dòng/ngày ≈ 90MB/tháng ≈ 1GB/năm.
   Tên file logic khác nhau tuỳ DB được tạo mới hay đã có từ bản cũ (AquaControl_Data),
   nên tra tên thật trong sys.database_files rồi mới ALTER.                        */
DECLARE @dataFile SYSNAME = (SELECT TOP 1 name FROM sys.database_files WHERE type_desc = 'ROWS');
DECLARE @sql NVARCHAR(500) =
    N'ALTER DATABASE AquaControl MODIFY FILE (NAME = [' + @dataFile + N'], MAXSIZE = UNLIMITED, FILEGROWTH = 50MB)';
EXEC sp_executesql @sql;
GO

/* ---------- Xoá bảng cũ (nếu chạy lại) theo thứ tự phụ thuộc ---------- */
IF OBJECT_ID('dbo.EventLog', 'U')          IS NOT NULL DROP TABLE dbo.EventLog;
IF OBJECT_ID('dbo.WateringRuns', 'U')      IS NOT NULL DROP TABLE dbo.WateringRuns;
IF OBJECT_ID('dbo.WateringSchedules', 'U') IS NOT NULL DROP TABLE dbo.WateringSchedules;
IF OBJECT_ID('dbo.AutomationRules', 'U')   IS NOT NULL DROP TABLE dbo.AutomationRules;
IF OBJECT_ID('dbo.PumpState', 'U')         IS NOT NULL DROP TABLE dbo.PumpState;
IF OBJECT_ID('dbo.Telemetry', 'U')         IS NOT NULL DROP TABLE dbo.Telemetry;
IF OBJECT_ID('dbo.Devices', 'U')           IS NOT NULL DROP TABLE dbo.Devices;
IF OBJECT_ID('dbo.Users', 'U')             IS NOT NULL DROP TABLE dbo.Users;
/* Bảng của phiên bản cũ - không còn dùng */
IF OBJECT_ID('dbo.ActuatorState', 'U')     IS NOT NULL DROP TABLE dbo.ActuatorState;
IF OBJECT_ID('dbo.CameraAnalysis', 'U')    IS NOT NULL DROP TABLE dbo.CameraAnalysis;
GO

/* ---------- Người dùng admin ---------- */
CREATE TABLE dbo.Users (
    Id           INT IDENTITY PRIMARY KEY,
    Username     NVARCHAR(50)  NOT NULL UNIQUE,
    PasswordHash NVARCHAR(255) NOT NULL,
    Role         NVARCHAR(20)  NOT NULL DEFAULT 'admin',
    CreatedAt    DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

/* ---------- Thiết bị: 10 ESP32, mỗi con phụ trách 1 zone ----------
   ApiKey: mỗi node 1 key riêng → lộ 1 con chỉ cần thu hồi con đó.
   Server tra key này để biết request đến từ node nào (middleware/auth.js). */
CREATE TABLE dbo.Devices (
    Id        INT IDENTITY PRIMARY KEY,
    DeviceId  NVARCHAR(50)  NOT NULL UNIQUE,   -- vd 'AQ-ZONE-01'
    Zone      TINYINT       NULL,              -- 1..10  (NULL nếu là thiết bị không gắn zone)
    Name      NVARCHAR(100) NULL,
    Type      NVARCHAR(20)  NOT NULL DEFAULT 'zone-node',  -- 'zone-node' | 'master'
    ApiKey    NVARCHAR(64)  NOT NULL UNIQUE,
    LastSeen  DATETIME2     NULL,
    IsOnline  BIT           NOT NULL DEFAULT 0,
    Rssi      INT           NULL,              -- Wi-Fi dBm
    Uptime    BIGINT        NULL,              -- giây
    Voltage   DECIMAL(5,2)  NULL,
    FwVersion NVARCHAR(20)  NULL
);
GO

/* ---------- Dữ liệu cảm biến: 1 dòng = 1 zone 1 lần gửi ----------
   Soil1/2/3 = 3 chậu trong zone. SoilMin lưu sẵn giá trị nhỏ nhất
   (chậu khô nhất) vì logic tưới và biểu đồ đều dùng tới, tính sẵn để khỏi
   phải so sánh 3 cột mỗi lần truy vấn.                                  */
CREATE TABLE dbo.Telemetry (
    Id          BIGINT IDENTITY PRIMARY KEY,
    DeviceId    NVARCHAR(50) NOT NULL,
    Zone        TINYINT      NOT NULL,        -- 1..10
    Temperature DECIMAL(5,2) NULL,            -- DHT22 °C
    AirHumidity DECIMAL(5,2) NULL,            -- DHT22 %
    Soil1       DECIMAL(5,2) NULL,            -- chậu 1 (%)
    Soil2       DECIMAL(5,2) NULL,            -- chậu 2 (%)
    Soil3       DECIMAL(5,2) NULL,            -- chậu 3 (%)
    SoilMin     DECIMAL(5,2) NULL,            -- min(Soil1..3) - chậu khô nhất
    CreatedAt   DATETIME2    NOT NULL DEFAULT SYSUTCDATETIME()
);
GO
CREATE INDEX IX_Telemetry_Zone_Time ON dbo.Telemetry (Zone, CreatedAt DESC);
CREATE INDEX IX_Telemetry_Time      ON dbo.Telemetry (CreatedAt DESC);
GO

/* ---------- Trạng thái bơm của từng zone ----------
   Mode: 3 chế độ loại trừ nhau, mỗi zone chọn 1
     'threshold' - automationService tưới theo độ ẩm chậu khô nhất
     'schedule'  - schedulerService tưới theo lịch trong WateringSchedules
     'manual'    - chỉ admin bấm trên web
   RunUntilUtc: mốc tự tắt bơm. Khác NULL nghĩa là đang trong một lượt tưới có
   hẹn giờ - lúc đó automation/scheduler BỎ QUA zone này (cơ chế ghi đè tạm thời
   khi admin bấm nút "Water 60s" ở bất kỳ chế độ nào).                          */
CREATE TABLE dbo.PumpState (
    Zone        TINYINT      NOT NULL PRIMARY KEY,   -- 1..10
    State       BIT          NOT NULL DEFAULT 0,     -- 0 tắt / 1 bật
    Mode        NVARCHAR(10) NOT NULL DEFAULT 'threshold',
    RunUntilUtc DATETIME2    NULL,
    Source      NVARCHAR(10) NULL,                   -- 'manual'|'schedule'|'threshold'
    UpdatedBy   NVARCHAR(50) NULL,
    UpdatedAt   DATETIME2    NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT CK_PumpState_Mode CHECK (Mode IN ('threshold', 'schedule', 'manual'))
);
GO

/* ---------- Luật tưới tự động theo zone (chế độ 'threshold') ----------
   SoilThreshold  : bật bơm khi chậu khô nhất < ngưỡng này
   HysteresisPct  : đang bật thì chỉ tắt khi độ ẩm >= SoilThreshold + biên này
                    (chống bơm nhấp nháy khi cảm biến dao động quanh ngưỡng)
   MaxRunMinutes  : chặn an toàn - bơm chạy quá lâu sẽ bị cắt dù vì lý do gì
                    (cảm biến hỏng đọc mãi 5% là trường hợp nguy hiểm nhất)
   MinRestMinutes : nghỉ tối thiểu giữa 2 lần tưới, để nước kịp thấm xuống     */
CREATE TABLE dbo.AutomationRules (
    Zone           TINYINT      NOT NULL PRIMARY KEY,   -- 1..10
    SoilThreshold  DECIMAL(5,2) NOT NULL DEFAULT 30,
    HysteresisPct  DECIMAL(5,2) NOT NULL DEFAULT 15,
    MaxRunMinutes  INT          NOT NULL DEFAULT 5,
    MinRestMinutes INT          NOT NULL DEFAULT 20,
    Enabled        BIT          NOT NULL DEFAULT 1
);
GO

/* ---------- Lịch tưới (chế độ 'schedule') ----------
   DaysOfWeek: bitmask, bit i ứng với JS getDay()
     bit0=1   Chủ nhật      bit4=16  Thứ năm
     bit1=2   Thứ hai       bit5=32  Thứ sáu
     bit2=4   Thứ ba        bit6=64  Thứ bảy
     bit3=8   Thứ tư
     => 127 = tất cả các ngày;  62 = thứ hai đến thứ sáu
   StartTime: giờ VIỆT NAM (UTC+7). Server tự quy đổi, không đọc đồng hồ máy chủ,
   để lịch chạy đúng dù server đặt ở Nhật hay ở nhà.                              */
CREATE TABLE dbo.WateringSchedules (
    Id          INT IDENTITY PRIMARY KEY,
    Zone        TINYINT      NOT NULL,        -- 1..10
    DaysOfWeek  TINYINT      NOT NULL DEFAULT 127,
    StartTime   TIME(0)      NOT NULL,
    DurationSec INT          NOT NULL DEFAULT 60,
    Enabled     BIT          NOT NULL DEFAULT 1,
    CreatedAt   DATETIME2    NOT NULL DEFAULT SYSUTCDATETIME()
);
GO
CREATE INDEX IX_Schedules_Zone ON dbo.WateringSchedules (Zone, Enabled);
GO

/* ---------- Nhật ký từng lượt tưới (phục vụ thống kê lượng nước + kiểm toán) ----------
   StopReason: 'normal'      - hết thời lượng đã hẹn
               'max-runtime' - bị cắt vì chạy quá MaxRunMinutes (dấu hiệu hỏng hóc)
               'manual-stop' - admin bấm Stop
               'threshold'   - đất đã đủ ẩm (chế độ threshold)                         */
CREATE TABLE dbo.WateringRuns (
    Id          BIGINT IDENTITY PRIMARY KEY,
    Zone        TINYINT      NOT NULL,
    StartedAt   DATETIME2    NOT NULL DEFAULT SYSUTCDATETIME(),
    EndedAt     DATETIME2    NULL,             -- NULL = đang chạy
    DurationSec INT          NULL,             -- điền khi kết thúc
    Trigger     NVARCHAR(10) NOT NULL,         -- 'manual'|'schedule'|'threshold'
    TriggeredBy NVARCHAR(50) NULL,             -- username, hoặc 'auto'
    StopReason  NVARCHAR(20) NULL
);
GO
CREATE INDEX IX_WateringRuns_Zone_Time ON dbo.WateringRuns (Zone, StartedAt DESC);
GO

/* ---------- Nhật ký hệ thống (trang Logs) ---------- */
CREATE TABLE dbo.EventLog (
    Id        BIGINT IDENTITY PRIMARY KEY,
    Level     NVARCHAR(10)  NOT NULL DEFAULT 'info', -- info/warning/error
    Source    NVARCHAR(50)  NULL,
    Message   NVARCHAR(500) NOT NULL,
    CreatedAt DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
);
GO
CREATE INDEX IX_EventLog_Time ON dbo.EventLog (CreatedAt DESC);
GO

/* ============================================================
   SEED dữ liệu mặc định cho 10 zone (không bao gồm mật khẩu admin)
   ============================================================ */

/* 10 bơm, mặc định tắt và chạy theo ngưỡng độ ẩm */
INSERT INTO dbo.PumpState (Zone, Mode) VALUES
    (1,'threshold'),(2,'threshold'),(3,'threshold'),(4,'threshold'),(5,'threshold'),
    (6,'threshold'),(7,'threshold'),(8,'threshold'),(9,'threshold'),(10,'threshold');
GO

/* 10 luật tưới: tưới khi chậu khô nhất dưới 30%, cắt an toàn ở 5 phút, nghỉ 20 phút */
INSERT INTO dbo.AutomationRules (Zone) VALUES
    (1),(2),(3),(4),(5),(6),(7),(8),(9),(10);
GO

/* 10 thiết bị ESP32, mỗi con 1 API key riêng.
   ĐỔI các key này thành chuỗi ngẫu nhiên của bạn trước khi dùng thật,
   rồi điền đúng key vào biến API_KEY trong firmware của từng node.      */
INSERT INTO dbo.Devices (DeviceId, Zone, Name, Type, ApiKey) VALUES
    ('AQ-ZONE-01',  1, N'ESP32 Zone 1',  'zone-node', 'aqcp-z01-3f7a9c2e5b1d'),
    ('AQ-ZONE-02',  2, N'ESP32 Zone 2',  'zone-node', 'aqcp-z02-8d4b1e6a0c93'),
    ('AQ-ZONE-03',  3, N'ESP32 Zone 3',  'zone-node', 'aqcp-z03-5c2f8a1b7e40'),
    ('AQ-ZONE-04',  4, N'ESP32 Zone 4',  'zone-node', 'aqcp-z04-9e6d3b0f2a85'),
    ('AQ-ZONE-05',  5, N'ESP32 Zone 5',  'zone-node', 'aqcp-z05-1a8c4f7d6b23'),
    ('AQ-ZONE-06',  6, N'ESP32 Zone 6',  'zone-node', 'aqcp-z06-7b3e0d5c9f14'),
    ('AQ-ZONE-07',  7, N'ESP32 Zone 7',  'zone-node', 'aqcp-z07-2f9a6b4e8c07'),
    ('AQ-ZONE-08',  8, N'ESP32 Zone 8',  'zone-node', 'aqcp-z08-6d1c8e3a5b92'),
    ('AQ-ZONE-09',  9, N'ESP32 Zone 9',  'zone-node', 'aqcp-z09-4e7b2d9f0a16'),
    ('AQ-ZONE-10', 10, N'ESP32 Zone 10', 'zone-node', 'aqcp-z10-0c5f1b8d7e34');
GO

PRINT 'Schema AquaControl v2 (10 zone) da tao xong.';
PRINT 'Buoc tiep theo: chay `npm run seed` de tao tai khoan admin.';
GO
