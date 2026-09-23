// /api/logs  - đọc / xoá nhật ký hệ thống (trang Logs).
const express = require('express');
const { requireLogin } = require('../middleware/auth');
const { query } = require('../db');
const logService = require('../services/logService');

const router = express.Router();

// GET /api/logs?level=&limit=&offset=
router.get('/', requireLogin, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const level = req.query.level;

    const params = { limit, offset };
    let where = '';
    if (level && ['info', 'warning', 'error'].includes(level)) {
      where = 'WHERE Level = @level';
      params.level = level;
    }

    const countResult = await query(`SELECT COUNT(*) AS total FROM dbo.EventLog ${where}`, params);

    const result = await query(
      `SELECT Id, Level, Source, Message, CreatedAt
         FROM dbo.EventLog ${where}
        ORDER BY CreatedAt DESC
        OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`,
      params
    );

    res.json({
      logs: result.recordset,
      total: countResult.recordset[0]?.total ?? 0,
      limit,
      offset,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/logs  - xoá toàn bộ nhật ký
router.delete('/', requireLogin, async (req, res) => {
  try {
    const result = await query('DELETE FROM dbo.EventLog');
    const deleted = result.rowsAffected?.[0] ?? 0;
    // Ghi lại 1 dòng kiểm toán (ai xoá, xoá bao nhiêu)
    await logService.info('logs', `${req.session.user.username} cleared all logs (${deleted} rows)`);
    res.json({ ok: true, deleted });
  } catch (err) {
    console.error('[logs] delete error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
