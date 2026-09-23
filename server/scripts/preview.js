// Chế độ XEM THỬ giao diện — KHÔNG cần SQL Server, KHÔNG cần đăng nhập.
//
// Dùng:  npm run preview   ->  http://localhost:3100
//
// Mọi dữ liệu nằm trong RAM và reset mỗi lần khởi động lại. Dùng để xem và bấm thử
// giao diện trước khi tạo database thật. KHÔNG dùng file này để chạy thật:
// không có xác thực, không có lớp an toàn nào của irrigationService.
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const PORT = parseInt(process.env.PREVIEW_PORT, 10) || 3100;
const ZONE_COUNT = 10;
const ZONES = Array.from({ length: ZONE_COUNT }, (_, i) => i + 1);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());

// ============================================================
//  Dữ liệu giả trong RAM
// ============================================================
const state = {
  telemetry: {},   // zone -> số liệu mới nhất
  pumps: {},       // zone -> trạng thái bơm
  devices: {},     // zone -> thiết bị
  rules: {},       // zone -> ngưỡng
  schedules: [],
  logs: [],
  history: [],     // các mốc lịch sử để vẽ biểu đồ
};
let logId = 1;
let scheduleId = 1;

function rand(min, max) {
  return Math.round((min + Math.random() * (max - min)) * 10) / 10;
}

for (const z of ZONES) {
  const soil = [rand(28, 65), rand(25, 60), rand(20, 58)];
  state.telemetry[z] = {
    Zone: z,
    Temperature: rand(25, 32),
    AirHumidity: rand(50, 75),
    Soil1: soil[0], Soil2: soil[1], Soil3: soil[2],
    SoilMin: Math.min(...soil),
    CreatedAt: new Date().toISOString(),
  };
  state.pumps[z] = {
    Zone: z, State: false,
    // Trộn 3 chế độ để nhìn thấy cả 3 kiểu hiển thị
    Mode: z % 3 === 0 ? 'schedule' : z % 3 === 1 ? 'threshold' : 'manual',
    RunUntilUtc: null, Source: null,
    UpdatedBy: 'demo', UpdatedAt: new Date().toISOString(),
    remainingSec: 0,
  };
  state.devices[z] = {
    DeviceId: `AQ-ZONE-${String(z).padStart(2, '0')}`,
    Zone: z, Name: `ESP32 Zone ${z}`, Type: 'zone-node',
    // Để zone 7 offline cho thấy giao diện lúc mất kết nối
    IsOnline: z !== 7,
    Rssi: -50 - Math.round(Math.random() * 25),
    Uptime: 3600 * 24 * 3 + z * 97,
    Voltage: rand(11.8, 12.6), FwVersion: '2.0.0-demo',
    LastSeen: new Date().toISOString(),
  };
  state.rules[z] = {
    Zone: z, SoilThreshold: 30, HysteresisPct: 15,
    MaxRunMinutes: 5, MinRestMinutes: 20, Enabled: true,
  };
}

state.schedules.push(
  { Id: scheduleId++, Zone: 3, DaysOfWeek: 127, StartTime: '06:00', DurationSec: 60, Enabled: true },
  { Id: scheduleId++, Zone: 6, DaysOfWeek: 62, StartTime: '17:30', DurationSec: 120, Enabled: true },
  { Id: scheduleId++, Zone: 9, DaysOfWeek: 65, StartTime: '07:00', DurationSec: 60, Enabled: false }
);

// Dựng sẵn 24h lịch sử, mỗi mốc 5 phút, để biểu đồ có gì đó để vẽ
(function seedHistory() {
  const now = Date.now();
  for (let i = 288; i >= 0; i--) {
    const t = new Date(now - i * 5 * 60 * 1000);
    const dayFactor = Math.sin((t.getHours() / 24) * Math.PI * 2 - Math.PI / 2);
    for (const z of ZONES) {
      state.history.push({
        Zone: z,
        Bucket: t.toISOString(),
        Temperature: 28 + dayFactor * 4 + (z % 3),
        AirHumidity: 62 - dayFactor * 10 + (z % 5),
        // Độ ẩm đất giảm dần rồi nhảy lên khi "được tưới"
        SoilMin: 25 + ((i * 7 + z * 13) % 45),
      });
    }
  }
})();

function addLog(level, source, message) {
  const row = {
    Id: logId++, Level: level, Source: source, Message: message,
    CreatedAt: new Date().toISOString(),
  };
  state.logs.unshift(row);
  io.emit('log', row);
  return row;
}

addLog('info', 'system', 'Preview mode started with demo data');

function emitPump(zone) {
  io.emit('pump', { ...state.pumps[zone] });
}

// ============================================================
//  Bơm giả: đếm ngược và tự tắt, giống irrigationService thật
// ============================================================
setInterval(() => {
  const now = Date.now();
  for (const z of ZONES) {
    const p = state.pumps[z];
    if (!p.State || !p.RunUntilUtc) continue;
    const remain = Math.max(0, Math.round((new Date(p.RunUntilUtc).getTime() - now) / 1000));
    p.remainingSec = remain;
    if (remain === 0) {
      p.State = false;
      p.RunUntilUtc = null;
      p.Source = null;
      addLog('info', 'irrigation', `Zone ${z}: pump OFF (normal, by demo)`);
      emitPump(z);
    }
  }
}, 1000);

// ============================================================
//  Số liệu giả cập nhật mỗi 5s để thấy realtime hoạt động
// ============================================================
setInterval(() => {
  for (const z of ZONES) {
    if (!state.devices[z].IsOnline) continue;
    const t = state.telemetry[z];
    const pumping = state.pumps[z].State;
    // Đang tưới thì đất ẩm lên, không thì khô dần
    const drift = pumping ? 3 : -0.4;
    const soil = [t.Soil1, t.Soil2, t.Soil3].map((v) =>
      Math.max(8, Math.min(92, Math.round((v + drift + (Math.random() - 0.5)) * 10) / 10))
    );
    t.Soil1 = soil[0];
    t.Soil2 = soil[1];
    t.Soil3 = soil[2];
    t.SoilMin = Math.min(...soil);
    t.Temperature = Math.round((t.Temperature + (Math.random() - 0.5) * 0.4) * 10) / 10;
    t.AirHumidity = Math.round((t.AirHumidity + (Math.random() - 0.5) * 1.5) * 10) / 10;
    t.CreatedAt = new Date().toISOString();

    io.emit('telemetry', {
      deviceId: state.devices[z].DeviceId,
      rssi: state.devices[z].Rssi,
      uptime: state.devices[z].Uptime,
      receivedAt: t.CreatedAt,
      zone: z,
      temperature: t.Temperature,
      airHumidity: t.AirHumidity,
      soil1: t.Soil1, soil2: t.Soil2, soil3: t.Soil3,
      soilMin: t.SoilMin,
    });

    // Chế độ threshold: bật bơm khi chậu khô nhất dưới ngưỡng
    const p = state.pumps[z];
    if (p.Mode === 'threshold' && !p.RunUntilUtc) {
      const thr = state.rules[z].SoilThreshold;
      const hys = state.rules[z].HysteresisPct;
      if (!p.State && t.SoilMin < thr) {
        p.State = true;
        p.Source = 'threshold';
        addLog('info', 'irrigation', `Zone ${z}: pump ON (threshold, by auto)`);
        emitPump(z);
      } else if (p.State && t.SoilMin >= thr + hys) {
        p.State = false;
        p.Source = null;
        addLog('info', 'irrigation', `Zone ${z}: pump OFF (threshold, by auto)`);
        emitPump(z);
      }
    }
  }
}, 5000);

// ============================================================
//  API giả — khớp hợp đồng với server thật
// ============================================================
app.get('/api/me', (req, res) => res.json({ user: { username: 'preview', role: 'admin' } }));
app.post('/logout', (req, res) => res.json({ ok: true, redirect: '/login' }));

app.get('/api/telemetry/latest', (req, res) =>
  res.json({ zones: ZONES.map((z) => state.telemetry[z]) }));

app.get('/api/telemetry/history', (req, res) => {
  const zone = parseInt(req.query.zone, 10) || 0;
  const data = zone ? state.history.filter((r) => r.Zone === zone) : state.history;
  res.json({ range: req.query.range || '24h', data });
});

app.get('/api/devices', (req, res) =>
  res.json({ devices: ZONES.map((z) => state.devices[z]) }));

app.get('/api/control', (req, res) =>
  res.json({ pumps: ZONES.map((z) => state.pumps[z]) }));

app.post('/api/control', (req, res) => {
  const { zone, mode } = req.body || {};
  const p = state.pumps[zone];
  if (!p) return res.status(400).json({ error: 'Invalid zone' });
  p.Mode = mode;
  p.UpdatedAt = new Date().toISOString();
  addLog('info', 'control', `preview set Zone ${zone} mode to ${mode}`);
  emitPump(zone);
  res.json({ ok: true, pump: p });
});

app.post('/api/control/water', (req, res) => {
  const zone = Number(req.body?.zone);
  const durationSec = Number(req.body?.durationSec) || 60;
  const p = state.pumps[zone];
  if (!p) return res.status(400).json({ error: 'Invalid zone' });
  p.State = true;
  p.Source = 'manual';
  p.RunUntilUtc = new Date(Date.now() + durationSec * 1000).toISOString();
  p.remainingSec = durationSec;
  addLog('info', 'irrigation', `Zone ${zone}: pump ON for ${durationSec}s (manual, by preview)`);
  emitPump(zone);
  res.json({ ok: true, pump: p, durationSec });
});

app.post('/api/control/stop', (req, res) => {
  const zone = Number(req.body?.zone);
  const p = state.pumps[zone];
  if (!p) return res.status(400).json({ error: 'Invalid zone' });
  p.State = false;
  p.RunUntilUtc = null;
  p.Source = null;
  p.remainingSec = 0;
  addLog('info', 'irrigation', `Zone ${zone}: pump OFF (manual-stop, by preview)`);
  emitPump(zone);
  res.json({ ok: true, pump: p });
});

app.get('/api/rules', (req, res) =>
  res.json({ rules: ZONES.map((z) => state.rules[z]) }));

app.put('/api/rules/:zone', (req, res) => {
  const zone = parseInt(req.params.zone, 10);
  const r = state.rules[zone];
  if (!r) return res.status(404).json({ error: 'Zone not found' });
  const b = req.body || {};
  if (b.soilThreshold != null) r.SoilThreshold = b.soilThreshold;
  if (b.hysteresisPct != null) r.HysteresisPct = b.hysteresisPct;
  if (b.maxRunMinutes != null) r.MaxRunMinutes = b.maxRunMinutes;
  if (b.minRestMinutes != null) r.MinRestMinutes = b.minRestMinutes;
  if (typeof b.enabled === 'boolean') r.Enabled = b.enabled;
  addLog('info', 'rules', `preview updated Zone ${zone} rule`);
  res.json({ ok: true, rule: r });
});

app.get('/api/schedules', (req, res) => res.json({ schedules: state.schedules }));

app.post('/api/schedules', (req, res) => {
  const b = req.body || {};
  const row = {
    Id: scheduleId++,
    Zone: Number(b.zone),
    DaysOfWeek: Number(b.daysOfWeek ?? 127),
    StartTime: String(b.startTime || '06:00').slice(0, 5),
    DurationSec: Number(b.durationSec ?? 60),
    Enabled: b.enabled !== false,
  };
  state.schedules.push(row);
  addLog('info', 'schedule', `preview added schedule for Zone ${row.Zone} at ${row.StartTime}`);
  res.json({ ok: true, schedule: row });
});

app.put('/api/schedules/:id', (req, res) => {
  const row = state.schedules.find((s) => s.Id === parseInt(req.params.id, 10));
  if (!row) return res.status(404).json({ error: 'Schedule not found' });
  const b = req.body || {};
  row.Zone = Number(b.zone);
  row.DaysOfWeek = Number(b.daysOfWeek);
  row.StartTime = String(b.startTime).slice(0, 5);
  row.DurationSec = Number(b.durationSec);
  row.Enabled = b.enabled !== false;
  res.json({ ok: true, schedule: row });
});

app.delete('/api/schedules/:id', (req, res) => {
  const idx = state.schedules.findIndex((s) => s.Id === parseInt(req.params.id, 10));
  if (idx < 0) return res.status(404).json({ error: 'Schedule not found' });
  state.schedules.splice(idx, 1);
  res.json({ ok: true });
});

app.get('/api/logs', (req, res) => {
  const level = req.query.level;
  const list = level ? state.logs.filter((l) => l.Level === level) : state.logs;
  res.json({ logs: list.slice(0, 500), total: list.length, limit: 500, offset: 0 });
});

app.delete('/api/logs', (req, res) => {
  const deleted = state.logs.length;
  state.logs.length = 0;
  res.json({ ok: true, deleted });
});

app.get('/api/export/preview', (req, res) => {
  const rows = ZONES.map((z) => ({ ...state.telemetry[z] }));
  res.json({ total: rows.length, rows });
});

app.get('/api/export/csv', (req, res) => {
  res.status(400).json({ error: 'CSV export is disabled in preview mode' });
});

// ============================================================
//  Trang tĩnh — không chặn đăng nhập
// ============================================================
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PAGES = {
  '/': 'index.html',
  '/sensors': 'sensors.html',
  '/control': 'control.html',
  '/schedules': 'schedules.html',
  '/logs': 'logs.html',
  '/configuration': 'configuration.html',
};
app.use('/css', express.static(path.join(PUBLIC_DIR, 'css')));
app.use('/js', express.static(path.join(PUBLIC_DIR, 'js')));
for (const [route, file] of Object.entries(PAGES)) {
  app.get(route, (req, res) => res.sendFile(path.join(PUBLIC_DIR, file)));
}
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

server.listen(PORT, '127.0.0.1', () => {
  console.log('======================================================');
  console.log('  CHE DO XEM THU - du lieu gia, khong dung SQL Server');
  console.log(`  Mo: http://localhost:${PORT}`);
  console.log('  Khong can dang nhap. Du lieu mat khi tat (Ctrl+C).');
  console.log('======================================================');
  console.log('  Zone 7 de OFFLINE de xem giao dien luc mat ket noi.');
  console.log('  Che do: zone 1,4,7,10=threshold | 3,6,9=schedule | 2,5,8=manual');
});
