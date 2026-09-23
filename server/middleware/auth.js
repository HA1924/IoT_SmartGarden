// Middleware xác thực.
const deviceService = require('../services/deviceService');

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
 * Xác thực thiết bị bằng header x-api-key.
 * Mỗi node có key riêng (cột Devices.ApiKey) → tra ra được request đến từ node nào,
 * gắn vào req.device để route kiểm tra node có gửi đúng zone của nó không.
 */
async function requireApiKey(req, res, next) {
  try {
    const device = await deviceService.findByApiKey(req.get('x-api-key'));
    if (!device) {
      return res.status(401).json({ error: 'Invalid API key' });
    }
    req.device = device;
    return next();
  } catch (err) {
    console.error('[auth] lỗi tra API key:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
}

module.exports = { requireLogin, requireApiKey };
