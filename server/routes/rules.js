// /api/rules  - đọc / cập nhật luật tưới tự động theo zone (chế độ 'threshold').
const express = require('express');
const { requireLogin } = require('../middleware/auth');
const { query } = require('../db');
const config = require('../config');
const logService = require('../services/logService');

const router = express.Router();

// GET /api/rules
router.get('/', requireLogin, async (req, res) => {
  try {
    const result = await query(
      `SELECT Zone, SoilThreshold, HysteresisPct, MaxRunMinutes, MinRestMinutes, Enabled
         FROM dbo.AutomationRules ORDER BY Zone`
    );
    res.json({ rules: result.recordset });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/rules/:zone  { soilThreshold, hysteresisPct, maxRunMinutes, minRestMinutes, enabled }
router.put('/:zone', requireLogin, async (req, res) => {
  const zone = parseInt(req.params.zone, 10);
  if (!Number.isInteger(zone) || zone < 1 || zone > config.zoneCount) {
    return res.status(400).json({ error: `Zone must be between 1 and ${config.zoneCount}` });
  }
  const { soilThreshold, hysteresisPct, maxRunMinutes, minRestMinutes, enabled } = req.body || {};

  // Chặn an toàn: MaxRunMinutes = 0 nghĩa là bơm không bao giờ bị cắt → không cho phép.
  if (maxRunMinutes != null && (maxRunMinutes < 1 || maxRunMinutes > 120)) {
    return res.status(400).json({ error: 'maxRunMinutes must be between 1 and 120' });
  }
  if (soilThreshold != null && (soilThreshold < 0 || soilThreshold > 100)) {
    return res.status(400).json({ error: 'soilThreshold must be between 0 and 100' });
  }

  try {
    const result = await query(
      `UPDATE dbo.AutomationRules
          SET SoilThreshold  = COALESCE(@soil, SoilThreshold),
              HysteresisPct  = COALESCE(@hys, HysteresisPct),
              MaxRunMinutes  = COALESCE(@maxRun, MaxRunMinutes),
              MinRestMinutes = COALESCE(@minRest, MinRestMinutes),
              Enabled        = COALESCE(@enabled, Enabled)
        OUTPUT inserted.Zone, inserted.SoilThreshold, inserted.HysteresisPct,
               inserted.MaxRunMinutes, inserted.MinRestMinutes, inserted.Enabled
        WHERE Zone = @zone`,
      {
        zone,
        soil: soilThreshold ?? null,
        hys: hysteresisPct ?? null,
        maxRun: maxRunMinutes ?? null,
        minRest: minRestMinutes ?? null,
        enabled: typeof enabled === 'boolean' ? (enabled ? 1 : 0) : null,
      }
    );
    const row = result.recordset[0];
    if (!row) return res.status(404).json({ error: 'Zone not found' });
    await logService.info('rules', `${req.session.user.username} updated Zone ${zone} rule`);
    res.json({ ok: true, rule: row });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
