// /api/schedules  - CRUD lịch tưới (chế độ 'schedule').
// Giờ nhập vào là giờ Việt Nam, lưu nguyên như vậy; schedulerService tự quy đổi khi so sánh.
const express = require('express');
const { requireLogin } = require('../middleware/auth');
const { query } = require('../db');
const config = require('../config');
const logService = require('../services/logService');

const router = express.Router();

// "06:30" hoặc "06:30:00" -> hợp lệ?
function isValidTime(v) {
  return typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(v);
}

function validate(body) {
  const zone = Number(body?.zone);
  if (!Number.isInteger(zone) || zone < 1 || zone > config.zoneCount) {
    return { error: 'Invalid zone' };
  }
  if (!isValidTime(body?.startTime)) {
    return { error: 'startTime must be HH:MM' };
  }
  const days = Number(body?.daysOfWeek ?? 127);
  if (!Number.isInteger(days) || days < 1 || days > 127) {
    return { error: 'daysOfWeek must be a bitmask between 1 and 127' };
  }
  const durationSec = Number(body?.durationSec ?? config.manualWaterSec);
  if (!Number.isInteger(durationSec) || durationSec < 5 || durationSec > 3600) {
    return { error: 'durationSec must be between 5 and 3600' };
  }
  return {
    value: {
      zone,
      startTime: body.startTime.length === 5 ? `${body.startTime}:00` : body.startTime,
      daysOfWeek: days,
      durationSec,
      enabled: body?.enabled === undefined ? true : !!body.enabled,
    },
  };
}

// GET /api/schedules
router.get('/', requireLogin, async (req, res) => {
  try {
    const result = await query(
      `SELECT Id, Zone, DaysOfWeek, CONVERT(VARCHAR(5), StartTime, 108) AS StartTime,
              DurationSec, Enabled, CreatedAt
         FROM dbo.WateringSchedules ORDER BY Zone, StartTime`
    );
    res.json({ schedules: result.recordset });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/schedules  { zone, startTime, daysOfWeek, durationSec, enabled }
router.post('/', requireLogin, async (req, res) => {
  const { error, value } = validate(req.body);
  if (error) return res.status(400).json({ error });
  try {
    const result = await query(
      `INSERT INTO dbo.WateringSchedules (Zone, DaysOfWeek, StartTime, DurationSec, Enabled)
       OUTPUT inserted.Id, inserted.Zone, inserted.DaysOfWeek,
              CONVERT(VARCHAR(5), inserted.StartTime, 108) AS StartTime,
              inserted.DurationSec, inserted.Enabled
       VALUES (@zone, @days, @start, @dur, @enabled)`,
      {
        zone: value.zone,
        days: value.daysOfWeek,
        start: value.startTime,
        dur: value.durationSec,
        enabled: value.enabled ? 1 : 0,
      }
    );
    const row = result.recordset[0];
    await logService.info(
      'schedule',
      `${req.session.user.username} added schedule for Zone ${value.zone} at ${value.startTime} (${value.durationSec}s)`
    );
    res.json({ ok: true, schedule: row });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /api/schedules/:id
router.put('/:id', requireLogin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid id' });
  const { error, value } = validate(req.body);
  if (error) return res.status(400).json({ error });
  try {
    const result = await query(
      `UPDATE dbo.WateringSchedules
          SET Zone = @zone, DaysOfWeek = @days, StartTime = @start,
              DurationSec = @dur, Enabled = @enabled
        OUTPUT inserted.Id, inserted.Zone, inserted.DaysOfWeek,
               CONVERT(VARCHAR(5), inserted.StartTime, 108) AS StartTime,
               inserted.DurationSec, inserted.Enabled
        WHERE Id = @id`,
      {
        id,
        zone: value.zone,
        days: value.daysOfWeek,
        start: value.startTime,
        dur: value.durationSec,
        enabled: value.enabled ? 1 : 0,
      }
    );
    const row = result.recordset[0];
    if (!row) return res.status(404).json({ error: 'Schedule not found' });
    await logService.info(
      'schedule',
      `${req.session.user.username} updated schedule #${id} (Zone ${value.zone})`
    );
    res.json({ ok: true, schedule: row });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/schedules/:id
router.delete('/:id', requireLogin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid id' });
  try {
    const result = await query(`DELETE FROM dbo.WateringSchedules WHERE Id = @id`, { id });
    if (!result.rowsAffected[0]) return res.status(404).json({ error: 'Schedule not found' });
    await logService.info('schedule', `${req.session.user.username} deleted schedule #${id}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
