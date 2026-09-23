// Nhận dữ liệu cảm biến từ node ESP32, lưu DB, phát realtime, chạy đánh giá tự động.
const { query, getPool, sql } = require('../db');
const config = require('../config');
const realtime = require('../realtime');
const deviceService = require('./deviceService');
const automationService = require('./automationService');

// Khoảng hợp lệ của cảm biến. Giá trị ngoài khoảng (NaN, -999, 32767...) là dấu hiệu
// cảm biến hỏng hoặc đứt dây — loại bỏ, tuyệt đối không cho vào logic điều khiển bơm.
const RANGE = {
  temperature: [-40, 85],
  airHumidity: [0, 100],
  soil: [0, 100],
};

function clean(value, [min, max]) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return Math.round(n * 100) / 100;
}

/**
 * Chuẩn hoá 1 zone trong payload.
 * Chấp nhận cả `soil: [a,b,c]` lẫn `soil1/soil2/soil3` cho linh hoạt phía firmware.
 */
function normalizeZone(z) {
  const zone = Number(z.zone);
  if (!Number.isInteger(zone) || zone < 1 || zone > config.zoneCount) return null;

  const raw = Array.isArray(z.soil) ? z.soil : [z.soil1, z.soil2, z.soil3];
  const soils = [0, 1, 2].map((i) => clean(raw[i], RANGE.soil));
  const valid = soils.filter((v) => v != null);

  return {
    zone,
    temperature: clean(z.temperature, RANGE.temperature),
    airHumidity: clean(z.airHumidity, RANGE.airHumidity),
    soil1: soils[0],
    soil2: soils[1],
    soil3: soils[2],
    soilMin: valid.length ? Math.min(...valid) : null,
  };
}

/**
 * @param {Object} payload { deviceId, rssi, uptime, voltage, fwVersion, zones:[...] }
 * @param {Object} device  req.device từ middleware (để chặn node gửi hộ zone khác)
 */
async function saveTelemetry(payload, device = null) {
  const { deviceId, rssi, uptime, voltage, fwVersion, zones } = payload || {};
  if (!deviceId || !Array.isArray(zones) || zones.length === 0) {
    throw new Error('Invalid payload: deviceId and zones[] required');
  }

  const parsed = zones.map(normalizeZone).filter(Boolean);
  if (!parsed.length) throw new Error('No valid zone data in payload');

  // Node dùng key của zone mình thì chỉ được gửi dữ liệu zone đó.
  // Key dự phòng (simulate.js) có device.zone = null nên được gửi mọi zone.
  if (device && !device.isMaster && device.zone != null) {
    const wrong = parsed.find((z) => z.zone !== device.zone);
    if (wrong) {
      throw new Error(`Device is registered for zone ${device.zone}, cannot send zone ${wrong.zone}`);
    }
  }

  const pool = await getPool();
  for (const z of parsed) {
    await pool
      .request()
      .input('deviceId', sql.NVarChar(50), deviceId)
      .input('zone', sql.TinyInt, z.zone)
      .input('temperature', sql.Decimal(5, 2), z.temperature)
      .input('airHumidity', sql.Decimal(5, 2), z.airHumidity)
      .input('soil1', sql.Decimal(5, 2), z.soil1)
      .input('soil2', sql.Decimal(5, 2), z.soil2)
      .input('soil3', sql.Decimal(5, 2), z.soil3)
      .input('soilMin', sql.Decimal(5, 2), z.soilMin)
      .query(
        `INSERT INTO dbo.Telemetry (DeviceId, Zone, Temperature, AirHumidity, Soil1, Soil2, Soil3, SoilMin)
         VALUES (@deviceId, @zone, @temperature, @airHumidity, @soil1, @soil2, @soil3, @soilMin)`
      );
  }

  await deviceService.heartbeat(deviceId, { rssi, uptime, voltage, fwVersion });

  const receivedAt = new Date().toISOString();
  for (const z of parsed) {
    realtime.emit('telemetry', { deviceId, rssi, uptime, voltage, receivedAt, ...z });
  }

  const changes = await automationService.evaluate(parsed);
  return { saved: parsed.length, changes };
}

/** Số liệu mới nhất của mỗi zone (render lần đầu khi mở dashboard). */
async function getLatestByZone() {
  const result = await query(
    `WITH ranked AS (
       SELECT *, ROW_NUMBER() OVER (PARTITION BY Zone ORDER BY CreatedAt DESC) AS rn
       FROM dbo.Telemetry
     )
     SELECT Zone, Temperature, AirHumidity, Soil1, Soil2, Soil3, SoilMin, CreatedAt
     FROM ranked WHERE rn = 1 ORDER BY Zone`
  );
  return result.recordset;
}

// Dữ liệu được giữ vĩnh viễn nên số dòng thô rất lớn (~28.800 dòng/ngày).
// Luôn gom nhóm bằng SQL trước khi trả về, nếu không biểu đồ sẽ kéo cả trăm nghìn
// dòng về trình duyệt và treo trang.
const BUCKETS = {
  '24h': { days: 1, minutes: 5 },
  '7d': { days: 7, minutes: 30 },
  '30d': { days: 30, minutes: 60 },
  '90d': { days: 90, minutes: 180 },
  '1y': { days: 365, minutes: 720 },
};

/**
 * Lịch sử đã gom nhóm cho biểu đồ.
 * @param {number} zone - 0 = tất cả
 * @param {string} range - khoá trong BUCKETS
 */
async function getHistory(zone, range = '24h') {
  const b = BUCKETS[range] || BUCKETS['24h'];
  const params = { days: b.days, mins: b.minutes };

  let zoneFilter = '';
  if (zone && zone >= 1 && zone <= config.zoneCount) {
    zoneFilter = ' AND Zone = @zone';
    params.zone = zone;
  }

  // Gom theo mốc thời gian: quy CreatedAt về số phút kể từ 1970 rồi chia theo bucket.
  const result = await query(
    `SELECT Zone,
            DATEADD(MINUTE, (DATEDIFF(MINUTE, '1970-01-01', CreatedAt) / @mins) * @mins, '1970-01-01') AS Bucket,
            AVG(Temperature) AS Temperature,
            AVG(AirHumidity) AS AirHumidity,
            AVG(SoilMin)     AS SoilMin,
            AVG(Soil1)       AS Soil1,
            AVG(Soil2)       AS Soil2,
            AVG(Soil3)       AS Soil3
       FROM dbo.Telemetry
      WHERE CreatedAt >= DATEADD(DAY, -@days, SYSUTCDATETIME())${zoneFilter}
      GROUP BY Zone, DATEDIFF(MINUTE, '1970-01-01', CreatedAt) / @mins
      ORDER BY Bucket ASC`,
    params
  );
  return result.recordset;
}

module.exports = { saveTelemetry, getLatestByZone, getHistory, BUCKETS };
