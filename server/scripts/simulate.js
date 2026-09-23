// Giả lập 10 node ESP32 đẩy telemetry để test mà chưa cần phần cứng.
//
// Dùng:  npm run simulate                 -> 10 zone, chu kỳ 30s (như thật)
//        npm run simulate -- --fast       -> chu kỳ 3s, xem kết quả nhanh khi dev
//        npm run simulate -- --dry 3      -> ép zone 3 khô dần để test tưới tự động
//
// Dùng DEVICE_API_KEY (key dự phòng) nên gửi được mọi zone bằng 1 key.
const config = require('../config');

const BASE = config.publicUrl || `http://127.0.0.1:${config.port}`;
const API_KEY = config.deviceApiKey;

const args = process.argv.slice(2);
const FAST = args.includes('--fast');
const INTERVAL = FAST ? 3000 : 30000;
const dryIdx = args.indexOf('--dry');
const DRY_ZONE = dryIdx >= 0 ? parseInt(args[dryIdx + 1], 10) : 0;

// Mỗi zone 1 node, mỗi node 3 chậu. Giá trị nền khác nhau cho dễ phân biệt.
const nodes = [];
for (let z = 1; z <= config.zoneCount; z++) {
  nodes.push({
    zone: z,
    deviceId: `AQ-ZONE-${String(z).padStart(2, '0')}`,
    temp: 26 + (z % 4),
    hum: 55 + (z % 10),
    // 3 chậu bắt đầu ở mức ẩm khác nhau
    soil: [45 + (z % 8), 52 - (z % 6), 38 + (z % 5)],
    uptime: 1000 + z * 37,
  });
}

function jitter(v, amp) {
  return Math.round((v + (Math.random() - 0.5) * amp) * 10) / 10;
}

async function sendOne(node) {
  // Đất khô dần (cây hút nước), thỉnh thoảng tăng (vừa được tưới).
  // Zone bị --dry thì khô nhanh và không bao giờ tự ẩm lại -> dùng để test ngưỡng + cắt an toàn.
  node.soil = node.soil.map((s) => {
    const drift = DRY_ZONE === node.zone ? -1.5 : (Math.random() - 0.55) * 2;
    return Math.max(5, Math.min(90, s + drift));
  });
  node.uptime += INTERVAL / 1000;

  const payload = {
    deviceId: node.deviceId,
    rssi: -55 - Math.round(Math.random() * 20),
    uptime: node.uptime,
    voltage: jitter(12.2, 0.4),
    fwVersion: 'sim-2.0',
    zones: [
      {
        zone: node.zone,
        temperature: jitter(node.temp, 1.5),
        airHumidity: jitter(node.hum, 4),
        soil: node.soil.map((s) => Math.round(s)),
      },
    ],
  };

  try {
    const res = await fetch(`${BASE}/api/telemetry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error(`[sim] zone ${node.zone} lỗi:`, res.status, data.error);
      return null;
    }
    return data.changes || [];
  } catch (err) {
    console.error(`[sim] zone ${node.zone} không gọi được server:`, err.message);
    return null;
  }
}

async function tick() {
  const results = await Promise.all(nodes.map(sendOne));
  const ok = results.filter((r) => r !== null).length;
  const changes = results.flat().filter(Boolean);

  const soils = nodes.map((n) => `Z${n.zone}:${Math.round(Math.min(...n.soil))}`).join(' ');
  console.log(
    `[sim] ${ok}/${nodes.length} node OK | soil thấp nhất mỗi zone: ${soils}` +
      (changes.length ? ` | auto: ${JSON.stringify(changes)}` : '')
  );
}

console.log(`[sim] Giả lập ${nodes.length} node ESP32 -> ${BASE}/api/telemetry`);
console.log(`[sim] Chu kỳ ${INTERVAL / 1000}s${DRY_ZONE ? ` | ép zone ${DRY_ZONE} khô dần` : ''} (Ctrl+C để dừng)`);
tick();
setInterval(tick, INTERVAL);
