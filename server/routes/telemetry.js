// /api/telemetry  - nhận dữ liệu cảm biến (node ESP32) và cấp dữ liệu cho dashboard.
const express = require('express');
const { requireApiKey, requireLogin } = require('../middleware/auth');
const telemetryService = require('../services/telemetryService');
const logService = require('../services/logService');

const router = express.Router();

// POST /api/telemetry  (node ESP32 đẩy lên - dùng API key riêng của node)
router.post('/', requireApiKey, async (req, res) => {
  try {
    const result = await telemetryService.saveTelemetry(req.body, req.device);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[telemetry] save error:', err.message);
    // Node gửi sai zone là dấu hiệu nhầm firmware hoặc key bị dùng sai chỗ → ghi log
    if (err.message.includes('cannot send zone')) {
      await logService.warning('telemetry', `${req.device?.deviceId}: ${err.message}`);
    }
    res.status(400).json({ error: err.message });
  }
});

// GET /api/telemetry/latest  (dashboard - cần đăng nhập)
router.get('/latest', requireLogin, async (req, res) => {
  try {
    const data = await telemetryService.getLatestByZone();
    res.json({ zones: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/telemetry/history?zone=&range=
router.get('/history', requireLogin, async (req, res) => {
  try {
    const zone = parseInt(req.query.zone, 10) || 0;
    const range = req.query.range || '24h';
    const data = await telemetryService.getHistory(zone, range);
    res.json({ range, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
