// Sinh chuỗi CSV từ dữ liệu Telemetry.
const { Parser } = require('json2csv');
const { query } = require('../db');
const config = require('../config');

// Dựng mệnh đề WHERE + tham số dùng chung cho xuất CSV và xem trước.
function buildFilter({ from, to, zone } = {}) {
  const params = {};
  const conds = [];
  if (from) {
    conds.push('CreatedAt >= @from');
    params.from = new Date(from);
  }
  if (to) {
    conds.push('CreatedAt <= @to');
    params.to = new Date(to);
  }
  if (zone && zone >= 1 && zone <= config.zoneCount) {
    conds.push('Zone = @zone');
    params.zone = zone;
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  return { where, params };
}

const COLUMNS = `Id, DeviceId, Zone, Temperature, AirHumidity, Soil1, Soil2, Soil3, SoilMin, CreatedAt`;

/**
 * Xem trước dữ liệu sẽ xuất: tổng số dòng + N dòng gần nhất.
 */
async function telemetryPreview({ from, to, zone, limit = 50 } = {}) {
  const { where, params } = buildFilter({ from, to, zone });

  const countResult = await query(
    `SELECT COUNT(*) AS total FROM dbo.Telemetry ${where}`,
    params
  );
  const total = countResult.recordset[0]?.total ?? 0;

  const rowsResult = await query(
    `SELECT TOP (@limit) ${COLUMNS}
       FROM dbo.Telemetry
       ${where}
       ORDER BY CreatedAt DESC`,
    { ...params, limit: Math.min(parseInt(limit, 10) || 50, 200) }
  );

  return { total, rows: rowsResult.recordset };
}

/**
 * Lấy dữ liệu telemetry theo khoảng thời gian / zone và trả về chuỗi CSV.
 */
async function telemetryCsv({ from, to, zone } = {}) {
  const { where, params } = buildFilter({ from, to, zone });

  const result = await query(
    `SELECT ${COLUMNS} FROM dbo.Telemetry ${where} ORDER BY CreatedAt ASC`,
    params
  );

  const fields = [
    { label: 'Id', value: 'Id' },
    { label: 'DeviceId', value: 'DeviceId' },
    { label: 'Zone', value: 'Zone' },
    { label: 'Temperature(C)', value: 'Temperature' },
    { label: 'AirHumidity(%)', value: 'AirHumidity' },
    { label: 'Soil1(%)', value: 'Soil1' },
    { label: 'Soil2(%)', value: 'Soil2' },
    { label: 'Soil3(%)', value: 'Soil3' },
    { label: 'SoilMin(%)', value: 'SoilMin' },
    { label: 'CreatedAt(UTC)', value: 'CreatedAt' },
  ];
  const parser = new Parser({ fields, withBOM: true }); // BOM để Excel đọc đúng UTF-8
  return parser.parse(result.recordset);
}

module.exports = { telemetryCsv, telemetryPreview };
