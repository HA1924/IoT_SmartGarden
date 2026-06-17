/* ============================================================
   AquaControl Pro - Schema SQL Server (chạy bằng SSMS)
   Cách chạy:
     - Mở SQL Server Management Studio (SSMS)
     - Mở file này, bấm Execute (F5). File tự tạo database AquaControl.
   Lưu ý: mật khẩu admin KHÔNG seed ở đây (cần hash bcrypt).
           Sau khi chạy file này, chạy `npm run seed` để tạo tài khoản admin.
   ============================================================ */


CREATE DATABASE AquaControl
ON 
PRIMARY (
    NAME = AquaControl_Data,
    FILENAME = 'D:\PROJECT\DATABASE\AquaControl_Data.mdf',  -- đường dẫn ổ cứng
    SIZE = 50MB,                                 -- dung lượng khởi tạo
    MAXSIZE = 500MB,                             -- dung lượng tối đa
    FILEGROWTH = 10MB                            -- dung lượng tăng thêm mỗi lần
)
LOG ON (
    NAME = AquaControl_Log,
    FILENAME = 'D:\PROJECT\DATABASE\AquaControl_Log.ldf',   -- đường dẫn ổ cứng cho log
    SIZE = 20MB,
    MAXSIZE = 200MB,
    FILEGROWTH = 5MB
);


USE AquaControl;
GO

/* ---------- Xoá bảng cũ (nếu chạy lại) theo thứ tự phụ thuộc ---------- */
IF OBJECT_ID('dbo.EventLog', 'U')        IS NOT NULL DROP TABLE dbo.EventLog;
IF OBJECT_ID('dbo.CameraAnalysis', 'U')  IS NOT NULL DROP TABLE dbo.CameraAnalysis;
IF OBJECT_ID('dbo.AutomationRules', 'U') IS NOT NULL DROP TABLE dbo.AutomationRules;
IF OBJECT_ID('dbo.ActuatorState', 'U')   IS NOT NULL DROP TABLE dbo.ActuatorState;
IF OBJECT_ID('dbo.Telemetry', 'U')       IS NOT NULL DROP TABLE dbo.Telemetry;
IF OBJECT_ID('dbo.Devices', 'U')         IS NOT NULL DROP TABLE dbo.Devices;
IF OBJECT_ID('dbo.Users', 'U')           IS NOT NULL DROP TABLE dbo.Users;
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

/* ---------- Thiết bị (ESP32 controller / ESP32-Cam) ---------- */
CREATE TABLE dbo.Devices (
    Id       INT IDENTITY PRIMARY KEY,
    DeviceId NVARCHAR(50)  NOT NULL UNIQUE,   -- vd 'AQ-ESP-0922'
    Name     NVARCHAR(100) NULL,
    Type     NVARCHAR(20)  NULL,              -- 'controller' | 'camera'
    LastSeen DATETIME2     NULL,
    Rssi     INT           NULL,              -- Wi-Fi dBm
    Uptime   BIGINT        NULL,              -- giây
    Voltage  DECIMAL(5,2)  NULL
);
GO

/* ---------- Dữ liệu cảm biến theo từng khu (3 zone) ---------- */
CREATE TABLE dbo.Telemetry (
    Id           BIGINT IDENTITY PRIMARY KEY,
    DeviceId     NVARCHAR(50) NOT NULL,
    Zone         TINYINT      NOT NULL,        -- 1,2,3
    Temperature  DECIMAL(5,2) NULL,            -- DHT22 °C
    AirHumidity  DECIMAL(5,2) NULL,            -- DHT22 %
    Light        INT          NULL,            -- lux
    SoilMoisture DECIMAL(5,2) NULL,            -- %
    CreatedAt    DATETIME2    NOT NULL DEFAULT SYSUTCDATETIME()
);
GO
CREATE INDEX IX_Telemetry_Zone_Time ON dbo.Telemetry (Zone, CreatedAt DESC);
CREATE INDEX IX_Telemetry_Time      ON dbo.Telemetry (CreatedAt DESC);
GO

/* ---------- Trạng thái cơ cấu chấp hành (3 bơm + 1 dải đèn) ---------- */
CREATE TABLE dbo.ActuatorState (
    Id        INT IDENTITY PRIMARY KEY,
    Actuator  NVARCHAR(20) NOT NULL UNIQUE,    -- 'pump1','pump2','pump3','led'
    State     BIT          NOT NULL DEFAULT 0, -- 0 off / 1 on
    Mode      NVARCHAR(10) NOT NULL DEFAULT 'auto', -- 'auto' | 'manual'
    UpdatedBy NVARCHAR(50) NULL,
    UpdatedAt DATETIME2    NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

/* ---------- Luật tự động theo zone (ngưỡng tưới / đèn) ---------- */
CREATE TABLE dbo.AutomationRules (
    Id             INT IDENTITY PRIMARY KEY,
    Zone           TINYINT      NOT NULL UNIQUE,
    SoilThreshold  DECIMAL(5,2) NOT NULL DEFAULT 30, -- bơm khi soil < ngưỡng
    LightThreshold INT          NOT NULL DEFAULT 300,-- bật đèn khi light < ngưỡng (lux)
    Enabled        BIT          NOT NULL DEFAULT 1
);
GO

/* ---------- Kết quả phân tích camera (tán lá + sâu bệnh) ----------
   LƯU Ý: cột Zone (3 camera quan sát theo zone) được thêm ở đây cho CÀI MỚI.
   Nếu DB AquaControl ĐÃ TỒN TẠI và đang có dữ liệu, ĐỪNG chạy lại file này
   (nó sẽ DROP toàn bộ bảng). Thay vào đó chạy: db/migration_camera_zone.sql
   để thêm cột Zone mà không mất dữ liệu.                                      */
CREATE TABLE dbo.CameraAnalysis (
    Id           BIGINT IDENTITY PRIMARY KEY,
    Zone         TINYINT       NOT NULL DEFAULT 1, -- 1,2,3 (3 camera quan sát)
    ImagePath    NVARCHAR(255) NULL,
    CanopyWidth  DECIMAL(6,2)  NULL,           -- cm
    CanopyHeight DECIMAL(6,2)  NULL,           -- cm
    PestDetected BIT           NOT NULL DEFAULT 0,
    PestLabel    NVARCHAR(100) NULL,
    Confidence   DECIMAL(4,3)  NULL,
    CreatedAt    DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
);
GO
CREATE INDEX IX_CameraAnalysis_Zone_Time ON dbo.CameraAnalysis (Zone, CreatedAt DESC);
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
   SEED dữ liệu mặc định (không bao gồm mật khẩu admin)
   ============================================================ */

-- 4 cơ cấu chấp hành: 3 bơm + 1 đèn
INSERT INTO dbo.ActuatorState (Actuator, State, Mode) VALUES
    ('pump1', 0, 'auto'),
    ('pump2', 0, 'auto'),
    ('pump3', 0, 'auto'),
    ('led',   0, 'auto');
GO

-- Luật tự động cho 3 zone
INSERT INTO dbo.AutomationRules (Zone, SoilThreshold, LightThreshold, Enabled) VALUES
    (1, 30, 300, 1),
    (2, 30, 300, 1),
    (3, 30, 300, 1);
GO

-- Thiết bị mẫu
INSERT INTO dbo.Devices (DeviceId, Name, Type) VALUES
    ('AQ-ESP-0922', N'ESP32 Controller chính', 'controller'),
    ('AQ-CAM-0101', N'ESP32-Cam nhà kính',     'camera');
GO

PRINT 'Schema AquaControl da tao xong. Chay `npm run seed` de tao tai khoan admin.';
GO
