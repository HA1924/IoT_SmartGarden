// /api/rules  - đọc / cập nhật luật tự động (ngưỡng tưới & đèn theo zone).
const express = require('express');
const { requireLogin } = require('../middleware/auth');
const { query } = require('../db');
const logService = require('../services/logService');

const router = express.Router();

// GET /api/rules
router.get('/', requireLogin, async (req, res) => {
  try {
    const result = await query(
      `SELECT Zone, SoilThreshold, LightThreshold, Enabled
         FROM dbo.AutomationRules ORDER BY Zone`
    );
    res.json({ rules: result.recordset });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/rules/:zone  { soilThreshold, lightThreshold, enabled }
router.put('/:zone', requireLogin, async (req, res) => {
  const zone = parseInt(req.params.zone, 10);
  if (![1, 2, 3].includes(zone)) {
    return res.status(400).json({ error: 'Zone must be 1, 2 or 3' });
  }
  const { soilThreshold, lightThreshold, enabled } = req.body || {};
  try {
    const result = await query(
      `UPDATE dbo.AutomationRules
          SET SoilThreshold = COALESCE(@soil, SoilThreshold),
              LightThreshold = COALESCE(@light, LightThreshold),
              Enabled = COALESCE(@enabled, Enabled)
        OUTPUT inserted.Zone, inserted.SoilThreshold, inserted.LightThreshold, inserted.Enabled
        WHERE Zone = @zone`,
      {
        zone,
        soil: soilThreshold ?? null,
        light: lightThreshold ?? null,
        enabled: typeof enabled === 'boolean' ? (enabled ? 1 : 0) : null,
      }
    );
    const row = result.recordset[0];
    await logService.info(
      'rules',
      `${req.session.user.username} updated Zone ${zone} rule`
    );
    res.json({ ok: true, rule: row });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
