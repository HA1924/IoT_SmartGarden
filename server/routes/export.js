// /api/export  - xuất dữ liệu telemetry ra file CSV để tải về máy.
const express = require('express');
const { requireLogin } = require('../middleware/auth');
const csvService = require('../services/csvService');
const logService = require('../services/logService');

const router = express.Router();

// GET /api/export/preview?from=&to=&zone=&limit=  (xem trước trước khi tải)
router.get('/preview', requireLogin, async (req, res) => {
  try {
    const zone = parseInt(req.query.zone, 10) || 0;
    const result = await csvService.telemetryPreview({
      from: req.query.from,
      to: req.query.to,
      zone,
      limit: req.query.limit,
    });
    res.json(result);
  } catch (err) {
    console.error('[export] preview error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/export/csv?from=&to=&zone=
router.get('/csv', requireLogin, async (req, res) => {
  try {
    const zone = parseInt(req.query.zone, 10) || 0;
    const csv = await csvService.telemetryCsv({
      from: req.query.from,
      to: req.query.to,
      zone,
    });

    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const filename = `telemetry_${stamp}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);

    await logService.info('export', `${req.session.user.username} exported CSV (${filename})`);
  } catch (err) {
    console.error('[export] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
