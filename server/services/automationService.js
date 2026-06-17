// Logic tự động: dựa trên AutomationRules + dữ liệu cảm biến mới nhất,
// bật/tắt 3 bơm (theo độ ẩm đất từng zone) và 1 đèn LED (theo ánh sáng trung bình).
// Chỉ tác động lên cơ cấu đang ở Mode = 'auto'. Cơ cấu 'manual' do admin tự điều khiển.
const { query } = require('../db');
const actuatorService = require('./actuatorService');
const logService = require('./logService');

async function getRules() {
  const result = await query(
    `SELECT Zone, SoilThreshold, LightThreshold, Enabled FROM dbo.AutomationRules`
  );
  const map = {};
  for (const r of result.recordset) map[r.Zone] = r;
  return map;
}

/**
 * @param {Array<{zone:number, soilMoisture:number, light:number}>} zones
 * Đánh giá và cập nhật cơ cấu khi cần. Trả về danh sách thay đổi.
 */
async function evaluate(zones) {
  const rules = await getRules();
  const states = await actuatorService.getCommandMap();
  const changes = [];

  // --- Bơm theo từng zone ---
  for (const z of zones) {
    const rule = rules[z.zone];
    if (!rule || !rule.Enabled) continue;
    const pump = `pump${z.zone}`;
    const current = states[pump];
    if (!current || current.mode !== 'auto') continue;
    if (z.soilMoisture == null) continue;

    const shouldOn = z.soilMoisture < rule.SoilThreshold;
    if (shouldOn !== current.state) {
      await actuatorService.setState(pump, { state: shouldOn, updatedBy: 'auto' });
      changes.push({ actuator: pump, state: shouldOn });
      await logService.info(
        'automation',
        `Auto ${shouldOn ? 'ON' : 'OFF'} ${pump} (Zone ${z.zone} soil ${z.soilMoisture}% / threshold ${rule.SoilThreshold}%)`
      );
    }
  }

  // --- Đèn LED theo ánh sáng trung bình các zone có rule bật ---
  const led = states.led;
  if (led && led.mode === 'auto') {
    const lit = zones
      .filter((z) => z.light != null && rules[z.zone] && rules[z.zone].Enabled)
      .map((z) => ({ light: z.light, thr: rules[z.zone].LightThreshold }));
    if (lit.length) {
      const avgLight = lit.reduce((s, x) => s + x.light, 0) / lit.length;
      const avgThr = lit.reduce((s, x) => s + x.thr, 0) / lit.length;
      const shouldOn = avgLight < avgThr;
      if (shouldOn !== led.state) {
        await actuatorService.setState('led', { state: shouldOn, updatedBy: 'auto' });
        changes.push({ actuator: 'led', state: shouldOn });
        await logService.info(
          'automation',
          `Auto ${shouldOn ? 'ON' : 'OFF'} LED strip (avg light ${Math.round(avgLight)}lx / threshold ${Math.round(avgThr)}lx)`
        );
      }
    }
  }

  return changes;
}

module.exports = { getRules, evaluate };
