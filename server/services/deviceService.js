// Quản lý 10 node ESP32: tra API key riêng của từng con, cập nhật nhịp tim,
// và phát hiện node mất kết nối.
const { query } = require('../db');
const config = require('../config');
const realtime = require('../realtime');
const logService = require('./logService');

// Cache key -> thông tin thiết bị. 10 node poll liên tục nên không tra DB mỗi request.
let keyCache = null;

async function loadKeys() {
  const result = await query(
    `SELECT DeviceId, Zone, Type, ApiKey FROM dbo.Devices`
  );
  keyCache = new Map();
  for (const r of result.recordset) {
    keyCache.set(r.ApiKey, { deviceId: r.DeviceId, zone: r.Zone, type: r.Type });
  }
  return keyCache;
}

// Gọi sau khi thêm/sửa thiết bị để lần tra sau nạp lại từ DB
function invalidateKeys() {
  keyCache = null;
}

/**
 * Tra thiết bị theo header x-api-key.
 * Key dự phòng trong .env được chấp nhận cho mọi zone (dùng cho simulate.js / test).
 * @returns {Promise<{deviceId:string, zone:number|null, isMaster:boolean}|null>}
 */
async function findByApiKey(key) {
  if (!key) return null;
  if (key === config.deviceApiKey) {
    return { deviceId: 'MASTER-KEY', zone: null, isMaster: true };
  }
  if (!keyCache) await loadKeys();
  const found = keyCache.get(key);
  return found ? { ...found, isMaster: false } : null;
}

/**
 * Cập nhật sức khỏe thiết bị mỗi lần nhận telemetry.
 */
async function heartbeat(deviceId, { rssi, uptime, voltage, fwVersion } = {}) {
  const result = await query(
    `UPDATE dbo.Devices
        SET LastSeen = SYSUTCDATETIME(),
            IsOnline = 1,
            Rssi = COALESCE(@rssi, Rssi),
            Uptime = COALESCE(@uptime, Uptime),
            Voltage = COALESCE(@voltage, Voltage),
            FwVersion = COALESCE(@fw, FwVersion)
      OUTPUT inserted.DeviceId, inserted.Zone, inserted.IsOnline, inserted.Rssi,
             inserted.Uptime, inserted.Voltage, inserted.LastSeen
      WHERE DeviceId = @deviceId`,
    {
      deviceId,
      rssi: rssi ?? null,
      uptime: uptime ?? null,
      voltage: voltage ?? null,
      fw: fwVersion ?? null,
    }
  );
  const row = result.recordset[0];
  // Node vừa online trở lại sau khi bị đánh dấu offline
  if (row) realtime.emit('device', row);
  return row;
}

async function getAll() {
  const result = await query(
    `SELECT DeviceId, Zone, Name, Type, LastSeen, IsOnline, Rssi, Uptime, Voltage, FwVersion
       FROM dbo.Devices ORDER BY Zone`
  );
  return result.recordset;
}

/**
 * Đánh dấu offline những thiết bị im lặng quá lâu. Chạy định kỳ.
 */
async function checkOffline() {
  const result = await query(
    `UPDATE dbo.Devices
        SET IsOnline = 0
      OUTPUT inserted.DeviceId, inserted.Zone, inserted.IsOnline, inserted.LastSeen
      WHERE IsOnline = 1
        AND (LastSeen IS NULL OR LastSeen < DATEADD(SECOND, -@sec, SYSUTCDATETIME()))`,
    { sec: config.deviceOfflineSec }
  );
  for (const row of result.recordset) {
    realtime.emit('device', row);
    await logService.warning(
      'device',
      `${row.DeviceId} (Zone ${row.Zone}) went offline - no data for over ${config.deviceOfflineSec}s`
    );
  }
  return result.recordset.length;
}

function startMonitor() {
  setInterval(() => {
    checkOffline().catch((err) => console.error('[deviceService] checkOffline:', err.message));
  }, config.deviceMonitorMs);
}

module.exports = {
  loadKeys,
  invalidateKeys,
  findByApiKey,
  heartbeat,
  getAll,
  checkOffline,
  startMonitor,
};
