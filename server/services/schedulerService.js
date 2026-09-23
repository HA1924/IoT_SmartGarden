// Chế độ 'schedule': tưới theo lịch hẹn giờ.
//
// Giờ trong bảng WateringSchedules là GIỜ VIỆT NAM (UTC+7). Ở đây quy đổi từ
// Date.now() sang giờ VN chứ không đọc đồng hồ local của máy chủ — để lịch 6:00
// luôn chạy lúc 6:00 giờ VN dù server đặt ở Nhật, ở VPS nước ngoài hay ở nhà.
const { query } = require('../db');
const config = require('../config');
const pumpService = require('./pumpService');
const irrigationService = require('./irrigationService');

// Chống chạy trùng: nhớ các lịch đã kích hoạt trong phút hiện tại.
let lastMinuteKey = null;
const firedThisMinute = new Set();

/** Thời gian hiện tại quy về giờ Việt Nam. */
function nowInVN() {
  const shifted = new Date(Date.now() + config.tzOffsetMinutes * 60 * 1000);
  return {
    dayOfWeek: shifted.getUTCDay(),      // 0 = Chủ nhật
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

async function getActiveSchedules() {
  const result = await query(
    `SELECT Id, Zone, DaysOfWeek, StartTime, DurationSec
       FROM dbo.WateringSchedules WHERE Enabled = 1`
  );
  return result.recordset;
}

/** StartTime từ mssql về dạng Date (mốc 1970) → lấy giờ/phút theo UTC. */
function parseStartTime(value) {
  if (value instanceof Date) {
    return { hour: value.getUTCHours(), minute: value.getUTCMinutes() };
  }
  const [h, m] = String(value).split(':');
  return { hour: parseInt(h, 10), minute: parseInt(m, 10) };
}

async function tick() {
  const vn = nowInVN();
  const minuteKey = `${vn.dayOfWeek}-${vn.hour}-${vn.minute}`;
  if (minuteKey !== lastMinuteKey) {
    lastMinuteKey = minuteKey;
    firedThisMinute.clear();
  }

  const schedules = await getActiveSchedules();

  for (const s of schedules) {
    if (firedThisMinute.has(s.Id)) continue;

    // DaysOfWeek là bitmask: bit i ứng với thứ i (0 = Chủ nhật)
    if (!(s.DaysOfWeek & (1 << vn.dayOfWeek))) continue;

    const t = parseStartTime(s.StartTime);
    if (t.hour !== vn.hour || t.minute !== vn.minute) continue;

    const pump = pumpService.get(s.Zone);
    if (!pump || pump.Mode !== 'schedule') continue;          // zone không ở chế độ lịch
    if (pumpService.hasActiveTimedRun(s.Zone)) continue;       // đang bị ghi đè tay

    firedThisMinute.add(s.Id);
    await irrigationService.start(s.Zone, {
      durationSec: s.DurationSec,
      trigger: 'schedule',
      by: 'scheduler',
    });
  }
}

function startLoop() {
  setInterval(() => {
    tick().catch((err) => console.error('[schedulerService] tick:', err.message));
  }, config.schedulerTickMs);
}

module.exports = { tick, startLoop, nowInVN };
