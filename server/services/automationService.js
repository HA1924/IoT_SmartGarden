// Chế độ 'threshold': tưới theo độ ẩm đất của CHẬU KHÔ NHẤT trong zone.
// Mỗi zone có 1 bơm chung cho 3 chậu, nên lấy min(soil1,soil2,soil3) làm căn cứ —
// chậu khô nhất được tưới đủ thì 2 chậu kia chắc chắn không thiếu nước.
//
// Chỉ tác động lên zone có Mode = 'threshold'. Zone ở 'schedule'/'manual' bỏ qua hoàn toàn.
const { query } = require('../db');
const pumpService = require('./pumpService');
const irrigationService = require('./irrigationService');

async function getRules() {
  const result = await query(
    `SELECT Zone, SoilThreshold, HysteresisPct, MinRestMinutes, Enabled
       FROM dbo.AutomationRules`
  );
  const map = {};
  for (const r of result.recordset) map[r.Zone] = r;
  return map;
}

/**
 * @param {Array<{zone:number, soilMin:number|null}>} zones - dữ liệu vừa nhận
 * Trả về danh sách thay đổi đã thực hiện.
 */
async function evaluate(zones) {
  if (!Array.isArray(zones) || !zones.length) return [];

  const rules = await getRules();
  const lastEnd = await irrigationService.getLastRunEndMap();
  const changes = [];
  const now = Date.now();

  for (const z of zones) {
    const rule = rules[z.zone];
    if (!rule || !rule.Enabled) continue;
    if (z.soilMin == null) continue; // cảm biến lỗi → không quyết định gì

    const pump = pumpService.get(z.zone);
    if (!pump || pump.Mode !== 'threshold') continue;

    // Đang trong lượt tưới có hẹn giờ (admin bấm "Water 60s") → nhường quyền, không can thiệp
    if (pumpService.hasActiveTimedRun(z.zone)) continue;

    // Hysteresis: bật khi dưới ngưỡng, chỉ tắt khi đã vượt ngưỡng + biên.
    // Không có biên này thì bơm nhấp nháy liên tục khi cảm biến dao động quanh ngưỡng.
    const threshold = Number(rule.SoilThreshold);
    const margin = Number(rule.HysteresisPct);
    const shouldOn = pump.State
      ? z.soilMin < threshold + margin
      : z.soilMin < threshold;

    if (shouldOn === pump.State) continue;

    if (shouldOn) {
      // Nghỉ đủ lâu chưa? Nước cần thời gian thấm xuống trước khi đo lại,
      // không có bước này thì bơm sẽ tưới dồn liên tục và gây úng.
      const last = lastEnd[z.zone];
      if (last) {
        const restedMin = (now - new Date(last).getTime()) / 60000;
        if (restedMin < rule.MinRestMinutes) continue;
      }
      await irrigationService.start(z.zone, { trigger: 'threshold', by: 'auto' });
      changes.push({ zone: z.zone, state: true });
    } else {
      await irrigationService.stop(z.zone, { reason: 'threshold', by: 'auto' });
      changes.push({ zone: z.zone, state: false });
    }
  }

  return changes;
}

module.exports = { getRules, evaluate };
