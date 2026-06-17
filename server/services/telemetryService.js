// Lưu dữ liệu cảm biến ESP32 gửi về, cập nhật trạng thái thiết bị,
// phát realtime và chạy đánh giá tự động.
const { query, getPool, sql } = require('../db');
const realtime = require('../realtime');
const automationService = require('./automationService');

/**
 * @param {Object} payload
 *   { deviceId, rssi, uptime, voltage, zones: [{zone,temperature,airHumidity,light,soilMoisture}] }
 */
async function saveTelemetry(payload) {
  const { deviceId, rssi, uptime, voltage, zones } = payload;
  if (!deviceId || !Array.isArray(zones) || zones.length === 0) {
    throw new Error('Invalid payload: deviceId and zones[] required');
  }

  const pool = await getPool();

  // 1) Chèn từng zone
  for (const z of zones) {
    await pool
      .request()
      .input('deviceId', sql.NVarChar(50), deviceId)
      .input('zone', sql.TinyInt, z.zone)
      .input('temperature', sql.Decimal(5, 2), z.temperature ?? null)
      .input('airHumidity', sql.Decimal(5, 2), z.airHumidity ?? null)
      .input('light', sql.Int, z.light ?? null)
      .input('soilMoisture', sql.Decimal(5, 2), z.soilMoisture ?? null)
      .query(
        `INSERT INTO dbo.Telemetry (DeviceId, Zone, Temperature, AirHumidity, Light, SoilMoisture)
         VALUES (@deviceId, @zone, @temperature, @airHumidity, @light, @soilMoisture)`
      );
  }

  // 2) Cập nhật trạng thái thiết bị (sức khỏe ESP32)
  await query(
    `UPDATE dbo.Devices
       SET LastSeen = SYSUTCDATETIME(),
           Rssi = @rssi, Uptime = @uptime, Voltage = @voltage
     WHERE DeviceId = @deviceId`,
    {
      deviceId,
      rssi: rssi ?? null,
      uptime: uptime ?? null,
      voltage: voltage ?? null,
    }
  );

  // 3) Phát realtime cho dashboard
  const snapshot = {
    deviceId,
    rssi,
    uptime,
    voltage,
    zones,
    receivedAt: new Date().toISOString(),
  };
  realtime.emit('telemetry', snapshot);

  // 4) Đánh giá tự động (bơm/đèn)
  const changes = await automationService.evaluate(zones);

  return { saved: zones.length, changes };
}

/**
 * Số liệu mới nhất của mỗi zone (render lần đầu khi mở dashboard).
 */
async function getLatestByZone() {
  const result = await query(
    `WITH ranked AS (
       SELECT *, ROW_NUMBER() OVER (PARTITION BY Zone ORDER BY CreatedAt DESC) AS rn
       FROM dbo.Telemetry
     )
     SELECT Zone, Temperature, AirHumidity, Light, SoilMoisture, CreatedAt
     FROM ranked WHERE rn = 1 ORDER BY Zone`
  );
  return result.recordset;
}

/**
 * Lịch sử cho biểu đồ.
 * @param {number} zone - 0 = tất cả
 * @param {string} range - '24h' | '7d' | '30d'
 */
async function getHistory(zone, range = '24h') {
  const map = { '24h': 1, '7d': 7, '30d': 30 };
  const days = map[range] || 1;
  const params = { days };
  let where = `CreatedAt >= DATEADD(DAY, -@days, SYSUTCDATETIME())`;
  if (zone && zone >= 1 && zone <= 3) {
    where += ` AND Zone = @zone`;
    params.zone = zone;
  }
  const result = await query(
    `SELECT Zone, Temperature, AirHumidity, Light, SoilMoisture, CreatedAt
       FROM dbo.Telemetry
      WHERE ${where}
      ORDER BY CreatedAt ASC`,
    params
  );
  return result.recordset;
}

module.exports = { saveTelemetry, getLatestByZone, getHistory };
