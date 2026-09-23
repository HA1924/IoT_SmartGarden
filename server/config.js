// Đọc biến môi trường từ .env và gom thành object cấu hình.
require('dotenv').config();

const config = {
  host: process.env.HOST || '127.0.0.1',
  port: parseInt(process.env.PORT, 10) || 5000,
  nodeEnv: process.env.NODE_ENV || 'development',
  publicUrl: process.env.PUBLIC_URL || 'http://localhost:5000',

  sessionSecret: process.env.SESSION_SECRET || 'change-me',
  cookieSecure: process.env.COOKIE_SECURE === 'true',

  // Key dự phòng: dùng cho simulate.js và công cụ test, được chấp nhận cho mọi zone.
  // Thiết bị thật dùng key riêng lưu ở cột Devices.ApiKey.
  deviceApiKey: process.env.DEVICE_API_KEY || 'aqcp-master-key-doi-di',

  // ----- Thông số hệ thống vườn -----
  zoneCount: 10,

  // Lịch tưới luôn tính theo giờ Việt Nam, không phụ thuộc đồng hồ máy chủ
  // (server có thể đặt ở Nhật, ở VPS nước ngoài, hoặc PC ở nhà).
  tzOffsetMinutes: 7 * 60,

  // Thiết bị không gửi dữ liệu quá ngưỡng này (giây) thì coi như mất kết nối
  deviceOfflineSec: 120,

  // Chu kỳ các vòng lặp nền (ms)
  irrigationTickMs: 5000,   // kiểm tra tắt bơm hết giờ / quá giờ
  schedulerTickMs: 20000,   // dò lịch tưới
  deviceMonitorMs: 30000,   // dò thiết bị offline

  // Thời lượng mặc định khi bấm nút tưới tay (giây)
  manualWaterSec: 60,

  // SQL Server (driver mssql)
  db: {
    user: process.env.DB_USER || 'sa',
    password: process.env.DB_PASSWORD || '',
    server: process.env.DB_SERVER || 'localhost',
    database: process.env.DB_DATABASE || 'AquaControl',
    port: parseInt(process.env.DB_PORT, 10) || 1433,
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
    options: {
      encrypt: process.env.DB_ENCRYPT === 'true',
      trustServerCertificate: process.env.DB_TRUST_CERT !== 'false',
    },
  },
};

module.exports = config;
