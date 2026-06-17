// /api/commands  - ESP32 poll lấy lệnh điều khiển hiện tại.
// /api/control   - admin bật/tắt bơm/đèn hoặc đổi chế độ auto/manual.
const express = require('express');
const { requireApiKey, requireLogin } = require('../middleware/auth');
const actuatorService = require('../services/actuatorService');
const logService = require('../services/logService');

const router = express.Router();

// GET /api/commands  (ESP32 poll ~2s, dùng API key)
// Trả map { pump1:{state,mode}, ... } để ESP32 áp dụng lên relay/đèn.
router.get('/commands', requireApiKey, async (req, res) => {
  try {
    const map = await actuatorService.getCommandMap();
    res.json({ actuators: map });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/control  (dashboard - trạng thái đầy đủ để render)
router.get('/control', requireLogin, async (req, res) => {
  try {
    const rows = await actuatorService.getAll();
    res.json({ actuators: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/control  { actuator, state?, mode? }  (admin)
router.post('/control', requireLogin, async (req, res) => {
  const { actuator, state, mode } = req.body || {};
  if (!actuator) return res.status(400).json({ error: 'Missing actuator' });
  if (mode && !['auto', 'manual'].includes(mode)) {
    return res.status(400).json({ error: 'mode must be auto or manual' });
  }
  try {
    const row = await actuatorService.setState(actuator, {
      state: typeof state === 'boolean' ? state : undefined,
      mode,
      updatedBy: req.session.user.username,
    });
    if (!row) return res.status(404).json({ error: 'Actuator not found' });

    const parts = [];
    if (typeof state === 'boolean') parts.push(state ? 'ON' : 'OFF');
    if (mode) parts.push(`mode ${mode}`);
    await logService.info(
      'control',
      `${req.session.user.username} set ${actuator}: ${parts.join(', ')}`
    );
    res.json({ ok: true, actuator: row });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
