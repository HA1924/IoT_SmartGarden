// Đọc / ghi trạng thái cơ cấu chấp hành (pump1..3, led).
const { query } = require('../db');
const realtime = require('../realtime');

const VALID = ['pump1', 'pump2', 'pump3', 'led'];

async function getAll() {
  const result = await query(
    `SELECT Actuator, State, Mode, UpdatedBy, UpdatedAt FROM dbo.ActuatorState`
  );
  return result.recordset;
}

/**
 * Lấy map { pump1: {state, mode}, ... } để ESP32 poll nhanh.
 */
async function getCommandMap() {
  const rows = await getAll();
  const map = {};
  for (const r of rows) {
    map[r.Actuator] = { state: !!r.State, mode: r.Mode };
  }
  return map;
}

/**
 * Cập nhật trạng thái 1 cơ cấu. Trả về true nếu có thay đổi thực sự.
 */
async function setState(actuator, { state, mode, updatedBy } = {}) {
  if (!VALID.includes(actuator)) {
    throw new Error(`Invalid actuator: ${actuator}`);
  }
  // Xây câu update động theo field truyền vào
  const sets = [];
  const params = { a: actuator };
  if (typeof state === 'boolean') {
    sets.push('State = @state');
    params.state = state ? 1 : 0;
  }
  if (mode) {
    sets.push('Mode = @mode');
    params.mode = mode;
  }
  sets.push('UpdatedBy = @by');
  params.by = updatedBy || 'system';
  sets.push('UpdatedAt = SYSUTCDATETIME()');

  const result = await query(
    `UPDATE dbo.ActuatorState SET ${sets.join(', ')}
     OUTPUT inserted.Actuator, inserted.State, inserted.Mode, inserted.UpdatedBy, inserted.UpdatedAt
     WHERE Actuator = @a`,
    params
  );
  const row = result.recordset[0];
  if (row) realtime.emit('actuator', row);
  return row;
}

module.exports = { VALID, getAll, getCommandMap, setState };
