// Trạng thái 10 bơm. Giữ bản sao trong RAM vì 10 node poll /api/commands liên tục —
// không để mỗi lần poll là một query xuống SQL Server.
const { query } = require('../db');
const config = require('../config');
const realtime = require('../realtime');

const MODES = ['threshold', 'schedule', 'manual'];

// zone (number) -> row PumpState
const cache = new Map();

function isValidZone(zone) {
  return Number.isInteger(zone) && zone >= 1 && zone <= config.zoneCount;
}

/** Nạp toàn bộ trạng thái từ DB vào cache. Gọi 1 lần lúc khởi động. */
async function load() {
  const result = await query(
    `SELECT Zone, State, Mode, RunUntilUtc, Source, UpdatedBy, UpdatedAt
       FROM dbo.PumpState ORDER BY Zone`
  );
  cache.clear();
  for (const r of result.recordset) {
    cache.set(r.Zone, { ...r, State: !!r.State });
  }
  return cache.size;
}

function getAll() {
  return [...cache.values()].sort((a, b) => a.Zone - b.Zone);
}

function get(zone) {
  return cache.get(Number(zone)) || null;
}

/**
 * Map gọn cho ESP32 poll: { "1": {state, mode, remainingSec}, ... }
 * remainingSec để node tự đếm ngược và tự tắt khi mất mạng.
 */
function getCommandMap() {
  const now = Date.now();
  const map = {};
  for (const p of getAll()) {
    const remaining = p.RunUntilUtc
      ? Math.max(0, Math.round((new Date(p.RunUntilUtc).getTime() - now) / 1000))
      : 0;
    map[p.Zone] = { state: !!p.State, mode: p.Mode, remainingSec: remaining };
  }
  return map;
}

/** Zone đang trong một lượt tưới có hẹn giờ → automation & scheduler bỏ qua. */
function hasActiveTimedRun(zone) {
  const p = get(zone);
  if (!p || !p.RunUntilUtc) return false;
  return new Date(p.RunUntilUtc).getTime() > Date.now();
}

/**
 * Cập nhật trạng thái 1 bơm (ghi DB + cache + phát realtime).
 * Chỉ truyền field nào muốn đổi; truyền runUntil = null để xoá mốc hẹn tắt.
 */
async function update(zone, { state, mode, runUntil, source, updatedBy } = {}) {
  const z = Number(zone);
  if (!isValidZone(z)) throw new Error(`Invalid zone: ${zone}`);
  if (mode && !MODES.includes(mode)) throw new Error(`Invalid mode: ${mode}`);

  const sets = [];
  const params = { zone: z };
  if (typeof state === 'boolean') {
    sets.push('State = @state');
    params.state = state ? 1 : 0;
  }
  if (mode) {
    sets.push('Mode = @mode');
    params.mode = mode;
  }
  if (runUntil !== undefined) {
    sets.push('RunUntilUtc = @runUntil');
    params.runUntil = runUntil;
  }
  if (source !== undefined) {
    sets.push('Source = @source');
    params.source = source;
  }
  sets.push('UpdatedBy = @by');
  params.by = updatedBy || 'system';
  sets.push('UpdatedAt = SYSUTCDATETIME()');

  const result = await query(
    `UPDATE dbo.PumpState SET ${sets.join(', ')}
      OUTPUT inserted.Zone, inserted.State, inserted.Mode, inserted.RunUntilUtc,
             inserted.Source, inserted.UpdatedBy, inserted.UpdatedAt
      WHERE Zone = @zone`,
    params
  );
  const row = result.recordset[0];
  if (!row) return null;

  const normalized = { ...row, State: !!row.State };
  cache.set(normalized.Zone, normalized);
  realtime.emit('pump', {
    ...normalized,
    remainingSec: normalized.RunUntilUtc
      ? Math.max(0, Math.round((new Date(normalized.RunUntilUtc).getTime() - Date.now()) / 1000))
      : 0,
  });
  return normalized;
}

module.exports = {
  MODES,
  isValidZone,
  load,
  getAll,
  get,
  getCommandMap,
  hasActiveTimedRun,
  update,
};
