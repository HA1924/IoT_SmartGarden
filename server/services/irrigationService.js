// Cửa DUY NHẤT để bật/tắt bơm. Cả 3 chế độ (tay / lịch / ngưỡng) đều đi qua đây,
// không nơi nào được ghi thẳng vào bảng PumpState.
//
// Nhiệm vụ quan trọng nhất: tick() cắt bơm chạy quá MaxRunMinutes.
// Nếu cảm biến đất hỏng và đọc mãi 5%, đây là thứ duy nhất ngăn bơm chạy vĩnh viễn.
const { query } = require('../db');
const config = require('../config');
const pumpService = require('./pumpService');
const logService = require('./logService');

const TRIGGERS = ['manual', 'schedule', 'threshold'];

/** Lấy MaxRunMinutes của từng zone (đọc mỗi lần tick, số lượng nhỏ). */
async function getMaxRunMap() {
  const result = await query(`SELECT Zone, MaxRunMinutes FROM dbo.AutomationRules`);
  const map = {};
  for (const r of result.recordset) map[r.Zone] = r.MaxRunMinutes;
  return map;
}

/**
 * Bật bơm 1 zone.
 * @param {number} zone
 * @param {Object} opts
 *   durationSec - tự tắt sau bao nhiêu giây (bỏ trống = chạy tới khi có lệnh tắt,
 *                 dùng cho chế độ ngưỡng vì việc tắt do độ ẩm quyết định)
 *   trigger     - 'manual' | 'schedule' | 'threshold'
 *   by          - username hoặc 'auto'
 */
async function start(zone, { durationSec, trigger = 'manual', by = 'auto' } = {}) {
  const z = Number(zone);
  if (!pumpService.isValidZone(z)) throw new Error(`Invalid zone: ${zone}`);
  if (!TRIGGERS.includes(trigger)) throw new Error(`Invalid trigger: ${trigger}`);

  const current = pumpService.get(z);

  // Đang chạy rồi: lượt tưới tay/lịch mới sẽ thay lượt cũ, còn ngưỡng thì bỏ qua.
  if (current && current.State) {
    if (trigger === 'threshold') return current;
    await closeRun(z, 'superseded');
  }

  const runUntil = durationSec ? new Date(Date.now() + durationSec * 1000) : null;

  await query(
    `INSERT INTO dbo.WateringRuns (Zone, Trigger, TriggeredBy) VALUES (@zone, @trigger, @by)`,
    { zone: z, trigger, by }
  );

  const row = await pumpService.update(z, {
    state: true,
    runUntil,
    source: trigger,
    updatedBy: by,
  });

  const forText = durationSec ? ` for ${durationSec}s` : '';
  await logService.info('irrigation', `Zone ${z}: pump ON${forText} (${trigger}, by ${by})`);
  return row;
}

/** Đóng lượt tưới đang mở trong WateringRuns (nếu có). */
async function closeRun(zone, reason) {
  await query(
    `UPDATE dbo.WateringRuns
        SET EndedAt = SYSUTCDATETIME(),
            DurationSec = DATEDIFF(SECOND, StartedAt, SYSUTCDATETIME()),
            StopReason = @reason
      WHERE Id = (SELECT TOP 1 Id FROM dbo.WateringRuns
                   WHERE Zone = @zone AND EndedAt IS NULL
                   ORDER BY StartedAt DESC)`,
    { zone: Number(zone), reason }
  );
}

/**
 * Tắt bơm 1 zone.
 * @param {string} reason 'normal' | 'max-runtime' | 'manual-stop' | 'threshold' | 'superseded'
 */
async function stop(zone, { reason = 'normal', by = 'auto' } = {}) {
  const z = Number(zone);
  if (!pumpService.isValidZone(z)) throw new Error(`Invalid zone: ${zone}`);

  const current = pumpService.get(z);
  if (current && !current.State) return current; // đã tắt sẵn

  await closeRun(z, reason);
  const row = await pumpService.update(z, {
    state: false,
    runUntil: null,
    source: null,
    updatedBy: by,
  });

  if (reason === 'max-runtime') {
    await logService.error(
      'irrigation',
      `Zone ${z}: pump force-stopped - exceeded max runtime. Check the soil sensor and valve.`
    );
  } else {
    await logService.info('irrigation', `Zone ${z}: pump OFF (${reason}, by ${by})`);
  }
  return row;
}

/** Thời điểm kết thúc lượt tưới gần nhất của mỗi zone (cho MinRestMinutes). */
async function getLastRunEndMap() {
  const result = await query(
    `SELECT Zone, MAX(EndedAt) AS LastEnd FROM dbo.WateringRuns
      WHERE EndedAt IS NOT NULL GROUP BY Zone`
  );
  const map = {};
  for (const r of result.recordset) map[r.Zone] = r.LastEnd;
  return map;
}

/**
 * Vòng lặp an toàn, chạy mỗi vài giây:
 *  1) tắt bơm đã hết thời lượng hẹn
 *  2) cắt bơm chạy vượt MaxRunMinutes (bất kể vì lý do gì)
 */
async function tick() {
  const running = pumpService.getAll().filter((p) => p.State);
  if (!running.length) return;

  const maxRun = await getMaxRunMap();
  // Lấy mốc bắt đầu thật từ WateringRuns, không dùng PumpState.UpdatedAt
  // (UpdatedAt đổi theo mọi thao tác, ví dụ admin đổi mode giữa lúc đang tưới).
  const open = await query(
    `SELECT Zone, StartedAt FROM dbo.WateringRuns WHERE EndedAt IS NULL`
  );
  const startedMap = {};
  for (const r of open.recordset) startedMap[r.Zone] = r.StartedAt;

  const now = Date.now();

  for (const p of running) {
    if (p.RunUntilUtc && new Date(p.RunUntilUtc).getTime() <= now) {
      await stop(p.Zone, { reason: 'normal' });
      continue;
    }
    const limitMin = maxRun[p.Zone] ?? 5;
    const startedAt = new Date(startedMap[p.Zone] ?? p.UpdatedAt).getTime();
    if (now - startedAt > limitMin * 60 * 1000) {
      await stop(p.Zone, { reason: 'max-runtime' });
    }
  }
}

function startLoop() {
  setInterval(() => {
    tick().catch((err) => console.error('[irrigationService] tick:', err.message));
  }, config.irrigationTickMs);
}

module.exports = { TRIGGERS, start, stop, tick, startLoop, getLastRunEndMap };
