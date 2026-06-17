// Middleware xác thực.
const config = require('../config');

/**
 * Chặn truy cập trang/web API nếu chưa đăng nhập (session).
 * - Request HTML  -> redirect về /login
 * - Request API   -> trả 401 JSON
 */
function requireLogin(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }
  const wantsJson =
    req.xhr ||
    req.originalUrl.startsWith('/api/') ||
    (req.headers.accept || '').includes('application/json');
  if (wantsJson) {
    return res.status(401).json({ error: 'Not logged in' });
  }
  return res.redirect('/login');
}

/**
 * Xác thực thiết bị (ESP32 / ESP32-Cam / AI-service) bằng header x-api-key.
 */
function requireApiKey(req, res, next) {
  const key = req.get('x-api-key');
  if (key && key === config.deviceApiKey) {
    return next();
  }
  return res.status(401).json({ error: 'Invalid API key' });
}

module.exports = { requireLogin, requireApiKey };
