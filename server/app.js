// Điểm khởi động: Express + Socket.IO + session + định tuyến.
const path = require('path');
const http = require('http');
const express = require('express');
const session = require('express-session');
const { Server } = require('socket.io');

const config = require('./config');
const realtime = require('./realtime');
const { requireLogin } = require('./middleware/auth');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
realtime.setIo(io);

// ----- Middleware chung -----
app.use(express.json({ limit: '10mb' })); // 10mb cho ảnh base64 nếu cần
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
app.use('/api', require('./routes/commands')); // /api/commands, /api/control
app.use('/api/camera', require('./routes/camera'));
app.use('/api/export', require('./routes/export'));
app.use('/api/rules', require('./routes/rules'));
app.use('/api/logs', require('./routes/logs'));

// ----- Phục vụ trang tĩnh (có bảo vệ) -----
// /login công khai; các trang còn lại yêu cầu đăng nhập.
app.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.sendFile(path.join(PUBLIC_DIR, 'login.html'));
});

// Tài nguyên tĩnh không nhạy cảm (css/js/ảnh) cho phép truy cập tự do.
app.use('/css', express.static(path.join(PUBLIC_DIR, 'css')));
app.use('/js', express.static(path.join(PUBLIC_DIR, 'js')));
app.use('/assets', express.static(path.join(PUBLIC_DIR, 'assets')));

// Ảnh chụp từ camera: chỉ cho client đã đăng nhập xem.
app.use('/captures', requireLogin, express.static(path.join(PUBLIC_DIR, 'captures')));

// Các trang HTML dashboard: bảo vệ bằng requireLogin.
const PAGES = {
  '/': 'index.html',
  '/sensors': 'sensors.html',
  '/control': 'control.html',
  '/camera': 'camera.html',
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

server.listen(config.port, config.host, () => {
  console.log(`[server] AquaControl Pro chạy tại http://${config.host}:${config.port}`);
  console.log(`[server] Public URL: ${config.publicUrl}`);
});

module.exports = { app, server, io };
