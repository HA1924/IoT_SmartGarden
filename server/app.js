// Điểm khởi động: Express + Socket.IO + session + định tuyến + các vòng lặp nền.
const path = require('path');
const http = require('http');
const express = require('express');
const session = require('express-session');
const { Server } = require('socket.io');

const config = require('./config');
const realtime = require('./realtime');
const { requireLogin } = require('./middleware/auth');

const pumpService = require('./services/pumpService');
const deviceService = require('./services/deviceService');
const irrigationService = require('./services/irrigationService');
const schedulerService = require('./services/schedulerService');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
realtime.setIo(io);

// ----- Middleware chung -----
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

const sessionMiddleware = session({
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: config.cookieSecure,
    maxAge: 1000 * 60 * 60 * 8, // 8 giờ
  },
});
app.use(sessionMiddleware);

const PUBLIC_DIR = path.join(__dirname, 'public');

// ----- Routes API & auth -----
app.use('/', require('./routes/auth'));
app.use('/api/telemetry', require('./routes/telemetry'));
app.use('/api', require('./routes/commands')); // /api/commands, /api/control, /api/devices
app.use('/api/export', require('./routes/export'));
app.use('/api/rules', require('./routes/rules'));
app.use('/api/schedules', require('./routes/schedules'));
app.use('/api/stats', require('./routes/stats'));
app.use('/api/logs', require('./routes/logs'));

// ----- Phục vụ trang tĩnh (có bảo vệ) -----
// /login công khai; các trang còn lại yêu cầu đăng nhập.
app.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.sendFile(path.join(PUBLIC_DIR, 'login.html'));
});

// Tài nguyên tĩnh không nhạy cảm (css/js) cho phép truy cập tự do.
app.use('/css', express.static(path.join(PUBLIC_DIR, 'css')));
app.use('/js', express.static(path.join(PUBLIC_DIR, 'js')));
app.use('/assets', express.static(path.join(PUBLIC_DIR, 'assets')));

// Các trang HTML dashboard: bảo vệ bằng requireLogin.
const PAGES = {
  '/': 'index.html',
  '/sensors': 'sensors.html',
  '/control': 'control.html',
  '/schedules': 'schedules.html',
  '/logs': 'logs.html',
  '/configuration': 'configuration.html',
};
for (const [route, file] of Object.entries(PAGES)) {
  app.get(route, requireLogin, (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, file));
  });
}

// ----- Chia sẻ session cho Socket.IO (chỉ client đã login mới nhận realtime) -----
io.engine.use(sessionMiddleware);
io.on('connection', (socket) => {
  const sess = socket.request.session;
  if (!sess || !sess.user) {
    socket.disconnect(true);
    return;
  }
  console.log('[socket] client kết nối:', sess.user.username);
});

// ----- 404 -----
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ----- Error handler -----
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[error]', err);
  res.status(500).json({ error: 'Server error' });
});

/**
 * Nạp dữ liệu vào cache rồi mới mở cổng — tránh trường hợp node ESP32 poll trúng
 * lúc server vừa lên và nhận về map lệnh rỗng (bơm sẽ bị tắt oan).
 */
async function start() {
  const pumps = await pumpService.load();
  await deviceService.loadKeys();
  console.log(`[init] Đã nạp trạng thái ${pumps} bơm và danh sách API key thiết bị`);

  // Các vòng lặp nền
  irrigationService.startLoop();  // cắt bơm hết giờ / quá giờ
  schedulerService.startLoop();   // dò lịch tưới
  deviceService.startMonitor();   // phát hiện node offline

  server.listen(config.port, config.host, () => {
    console.log(`[server] AquaControl Pro chạy tại http://${config.host}:${config.port}`);
    console.log(`[server] Public URL: ${config.publicUrl}`);
    console.log(`[server] ${config.zoneCount} zone | lịch tưới theo giờ VN (UTC+7)`);
  });
}

start().catch((err) => {
  console.error('[server] Không khởi động được:', err.message);
  console.error('        Kiểm tra kết nối SQL Server trong .env và đã chạy db/schema.sql chưa.');
  process.exit(1);
});

module.exports = { app, server, io };
