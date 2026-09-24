// /api/stats  - thống kê lượt tưới từ bảng WateringRuns.
const express = require('express');
const { requireLogin } = require('../middleware/auth');
const { query } = require('../db');

const router = express.Router();

// GET /api/stats/watering?days=7
// Tổng hợp theo zone + theo ngày: số lượt tưới và tổng số giây bơm chạy.
router.get('/watering', requireLogin, async (req, res) => {
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 7, 1), 365);
  try {
    const byZone = await query(
      `SELECT Zone,
              COUNT(*) AS Runs,
              SUM(COALESCE(DurationSec, 0)) AS TotalSec,
              SUM(CASE WHEN StopReason = 'max-runtime' THEN 1 ELSE 0 END) AS ForceStops
         FROM dbo.WateringRuns
        WHERE StartedAt >= DATEADD(DAY, -@days, SYSUTCDATETIME())
        GROUP BY Zone ORDER BY Zone`,
      { days }
    );

    const byDay = await query(
      `SELECT CAST(StartedAt AS DATE) AS Day, Zone,
              COUNT(*) AS Runs,
              SUM(COALESCE(DurationSec, 0)) AS TotalSec
         FROM dbo.WateringRuns
        WHERE StartedAt >= DATEADD(DAY, -@days, SYSUTCDATETIME())
        GROUP BY CAST(StartedAt AS DATE), Zone
        ORDER BY Day ASC, Zone`,
      { days }
    );

    const byTrigger = await query(
      `SELECT TriggerType, COUNT(*) AS Runs, SUM(COALESCE(DurationSec, 0)) AS TotalSec
         FROM dbo.WateringRuns
        WHERE StartedAt >= DATEADD(DAY, -@days, SYSUTCDATETIME())
        GROUP BY TriggerType`,
      { days }
    );

    res.json({
      days,
      byZone: byZone.recordset,
      byDay: byDay.recordset,
      byTrigger: byTrigger.recordset,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/stats/runs?zone=&limit=  - danh sách lượt tưới gần nhất
router.get('/runs', requireLogin, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const zone = parseInt(req.query.zone, 10) || 0;
  try {
    const params = { limit };
    let where = '';
    if (zone) {
      where = 'WHERE Zone = @zone';
      params.zone = zone;
    }
    const result = await query(
      `SELECT TOP (@limit) Id, Zone, StartedAt, EndedAt, DurationSec, TriggerType, TriggeredBy, StopReason
         FROM dbo.WateringRuns ${where} ORDER BY StartedAt DESC`,
      params
    );
    res.json({ runs: result.recordset });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
