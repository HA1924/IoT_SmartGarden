// /api/commands  - node ESP32 poll lấy lệnh hiện tại.
// /api/control   - admin điều khiển bơm và đổi chế độ.
// /api/devices   - trạng thái online của 10 node.
const express = require('express');
const { requireApiKey, requireLogin } = require('../middleware/auth');
const config = require('../config');
const pumpService = require('../services/pumpService');
const irrigationService = require('../services/irrigationService');
const deviceService = require('../services/deviceService');
const automationService = require('../services/automationService');
const logService = require('../services/logService');

const router = express.Router();

// GET /api/commands?zone=N  (node poll mỗi ~5s, dùng API key)
// Trả lệnh + ngưỡng để node tự chạy được khi mất mạng, kèm serverTime để node chỉnh đồng hồ.
router.get('/commands', requireApiKey, async (req, res) => {
  try {
    const map = pumpService.getCommandMap();
    // Node có key riêng thì chỉ trả lệnh của zone nó, tránh lộ trạng thái cả vườn.
    const zone = req.device.zone ?? parseInt(req.query.zone, 10);

    if (zone) {
      const rules = await automationService.getRules();
      return res.json({
        zone,
        pump: map[zone] || null,
        rules: rules[zone] || null,
        serverTime: new Date().toISOString(),
      });
    }
    res.json({ pumps: map, serverTime: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/control  (dashboard - trạng thái 10 bơm)
router.get('/control', requireLogin, (req, res) => {
  const now = Date.now();
  const pumps = pumpService.getAll().map((p) => ({
    ...p,
    remainingSec: p.RunUntilUtc
      ? Math.max(0, Math.round((new Date(p.RunUntilUtc).getTime() - now) / 1000))
      : 0,
  }));
  res.json({ pumps });
});

// POST /api/control  { zone, mode }  - đổi chế độ của 1 zone
router.post('/control', requireLogin, async (req, res) => {
  const { zone, mode } = req.body || {};
  if (!pumpService.isValidZone(Number(zone))) {
    return res.status(400).json({ error: 'Invalid zone' });
  }
  if (!pumpService.MODES.includes(mode)) {
    return res.status(400).json({ error: `mode must be one of: ${pumpService.MODES.join(', ')}` });
  }
  try {
    const row = await pumpService.update(Number(zone), {
      mode,
      updatedBy: req.session.user.username,
    });
    await logService.info(
      'control',
      `${req.session.user.username} set Zone ${zone} mode to ${mode}`
    );
    res.json({ ok: true, pump: row });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/control/water  { zone, durationSec }  - nút tưới tay
// Dùng được ở MỌI chế độ: ghi đè tạm thời rồi zone tự quay lại chế độ cũ.
router.post('/control/water', requireLogin, async (req, res) => {
  const zone = Number(req.body?.zone);
  const durationSec = Math.min(
    Math.max(parseInt(req.body?.durationSec, 10) || config.manualWaterSec, 5),
    600
  );
  if (!pumpService.isValidZone(zone)) {
    return res.status(400).json({ error: 'Invalid zone' });
  }
  try {
    const row = await irrigationService.start(zone, {
      durationSec,
      trigger: 'manual',
      by: req.session.user.username,
    });
    res.json({ ok: true, pump: row, durationSec });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/control/stop  { zone }
router.post('/control/stop', requireLogin, async (req, res) => {
  const zone = Number(req.body?.zone);
  if (!pumpService.isValidZone(zone)) {
    return res.status(400).json({ error: 'Invalid zone' });
  }
  try {
    const row = await irrigationService.stop(zone, {
      reason: 'manual-stop',
      by: req.session.user.username,
    });
    res.json({ ok: true, pump: row });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/devices  - trạng thái 10 node cho dashboard
router.get('/devices', requireLogin, async (req, res) => {
  try {
    res.json({ devices: await deviceService.getAll() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
