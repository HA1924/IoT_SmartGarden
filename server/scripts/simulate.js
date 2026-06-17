// Giả lập ESP32 đẩy telemetry để test dashboard mà chưa cần phần cứng.
// Dùng:  npm run simulate
// Gửi dữ liệu 3 zone mỗi 5s tới /api/telemetry (kèm x-api-key).
const config = require('../config');

const BASE = config.publicUrl || `http://127.0.0.1:${config.port}`;
const API_KEY = config.deviceApiKey;
const DEVICE_ID = 'AQ-ESP-0922';

// Trạng thái giả lập từng zone (dao động quanh giá trị nền)
const zones = [
  { zone: 1, temp: 28, hum: 62, light: 850, soil: 45 },
  { zone: 2, temp: 31, hum: 55, light: 1200, soil: 26 },
  { zone: 3, temp: 28, hum: 65, light: 900, soil: 52 },
];

function jitter(v, amp) {
  return Math.round((v + (Math.random() - 0.5) * amp) * 10) / 10;
}

let uptime = 1043200;

async function tick() {
  uptime += 5;
  const payload = {
    deviceId: DEVICE_ID,
    rssi: -55 - Math.round(Math.random() * 15),
    uptime,
    voltage: jitter(12.2, 0.4),
    zones: zones.map((z) => {
      // soil giảm dần (cây hút nước), thỉnh thoảng tăng (đã tưới)
      z.soil = Math.max(10, Math.min(80, z.soil + (Math.random() - 0.55) * 2));
      return {
        zone: z.zone,
        temperature: jitter(z.temp, 1.5),
        airHumidity: jitter(z.hum, 4),
        light: Math.round(jitter(z.light, 120)),
        soilMoisture: Math.round(z.soil),
      };
    }),
  };

  try {
    const res = await fetch(`${BASE}/api/telemetry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      console.log(`[sim] gửi OK - soil:`, payload.zones.map((z) => z.soilMoisture).join('/'),
        data.changes && data.changes.length ? `| auto: ${JSON.stringify(data.changes)}` : '');
    } else {
      console.error('[sim] lỗi:', res.status, data.error);
    }
  } catch (err) {
    console.error('[sim] không gọi được server:', err.message);
  }
}

console.log(`[sim] Giả lập ESP32 -> ${BASE}/api/telemetry (Ctrl+C để dừng)`);
tick();
setInterval(tick, 5000);
