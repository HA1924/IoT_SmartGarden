// Đọc biến môi trường từ .env và gom thành object cấu hình.
require('dotenv').config();

// Suy ra URL chụp ảnh tĩnh (/capture, port 80) từ URL stream (…:81/stream).
// ESP32-Cam (example CameraWebServer): web server ở port 80 có sẵn /capture.
function deriveCaptureUrl(streamUrl) {
  if (!streamUrl) return '';
  try {
    const u = new URL(streamUrl);
    return `${u.protocol}//${u.hostname}/capture`;
  } catch {
    return '';
  }
}

const config = {
  host: process.env.HOST || '127.0.0.1',
  port: parseInt(process.env.PORT, 10) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  publicUrl: process.env.PUBLIC_URL || 'http://localhost:3000',

  sessionSecret: process.env.SESSION_SECRET || 'change-me',
  cookieSecure: process.env.COOKIE_SECURE === 'true',

  // API key cho ESP32 / ESP32-Cam / AI-service
  deviceApiKey: process.env.DEVICE_API_KEY || 'esp32-secret-key-doi-di',

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

  aiServiceUrl: process.env.AI_SERVICE_URL || 'http://localhost:5001',
  // Giữ tương thích biến cũ (xem như zone 1)
  esp32camStreamUrl: process.env.ESP32CAM_STREAM_URL || '',
  // 3 camera quan sát theo từng zone
  esp32camStreamUrls: {
    1: process.env.ESP32CAM_STREAM_URL_1 || process.env.ESP32CAM_STREAM_URL || '',
    2: process.env.ESP32CAM_STREAM_URL_2 || '',
    3: process.env.ESP32CAM_STREAM_URL_3 || '',
  },
  // URL chụp ảnh tĩnh cho từng zone (ưu tiên env, nếu không có thì suy ra từ stream URL)
  esp32camCaptureUrls: {
    1: process.env.ESP32CAM_CAPTURE_URL_1 ||
      deriveCaptureUrl(process.env.ESP32CAM_STREAM_URL_1 || process.env.ESP32CAM_STREAM_URL),
    2: process.env.ESP32CAM_CAPTURE_URL_2 || deriveCaptureUrl(process.env.ESP32CAM_STREAM_URL_2),
    3: process.env.ESP32CAM_CAPTURE_URL_3 || deriveCaptureUrl(process.env.ESP32CAM_STREAM_URL_3),
  },
};

module.exports = config;
