// Ghi nhật ký hệ thống vào bảng EventLog và phát realtime cho trang Logs.
const { query } = require('../db');
const realtime = require('../realtime');

/**
 * @param {'info'|'warning'|'error'} level
 * @param {string} source - nguồn (vd 'telemetry', 'control', 'auth')
 * @param {string} message
 */
async function log(level, source, message) {
  try {
    const result = await query(
      `INSERT INTO dbo.EventLog (Level, Source, Message)
       OUTPUT inserted.Id, inserted.Level, inserted.Source, inserted.Message, inserted.CreatedAt
       VALUES (@l, @s, @m)`,
      { l: level, s: source, m: message }
    );
    const row = result.recordset[0];
    realtime.emit('log', row);
    return row;
  } catch (err) {
    // Không để lỗi ghi log làm hỏng luồng chính
    console.error('[logService]', err.message);
  }
}

module.exports = {
  log,
  info: (source, msg) => log('info', source, msg),
  warning: (source, msg) => log('warning', source, msg),
  error: (source, msg) => log('error', source, msg),
};
