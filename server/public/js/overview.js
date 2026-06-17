// Trang Overview: render 3 zone, biểu đồ, ESP32 health; cập nhật realtime.
(function () {
  const { api } = window.AC;
  const zoneState = {}; // { 1: {...}, 2: {...}, 3: {...} }
  let thChart = null;
  let soilChart = null;
  const SOIL_COLORS = { 1: '#003d9b', 2: '#006e2f', 3: '#B45309' };
  const zoneVisible = { 1: true, 2: true, 3: true };

  function fmt(v, unit = '') {
    return v == null ? '--' : `${v}${unit}`;
  }

  function statusBadge(zone) {
    const soil = zoneState[zone]?.soilMoisture;
    if (soil == null) return { text: 'No data', cls: 'bg-surface-container text-on-surface-variant' };
    if (soil < 30) return { text: 'Warning', cls: 'bg-error/10 text-error' };
    return { text: 'Stable', cls: 'bg-secondary/10 text-secondary' };
  }

  function renderZones() {
    const grid = document.getElementById('zone-grid');
    grid.innerHTML = [1, 2, 3]
      .map((z) => {
        const d = zoneState[z] || {};
        const badge = statusBadge(z);
        const soilLow = d.soilMoisture != null && d.soilMoisture < 30;
        return `<div class="glass-card lift p-6 rounded-2xl flex flex-col gap-4">
        <div class="flex justify-between items-center">
          <h3 class="text-title-md font-bold text-primary">Zone ${z}</h3>
          <span class="px-2 py-0.5 ${badge.cls} text-[10px] font-bold rounded uppercase">${badge.text}</span>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div class="p-3 bg-surface-container rounded-xl">
            <p class="text-label-sm text-on-surface-variant flex items-center gap-1"><span class="material-symbols-outlined text-sm">thermostat</span> Temperature</p>
            <p class="text-headline-lg font-bold" data-cell="${z}-temp">${fmt(d.temperature, '°C')}</p>
          </div>
          <div class="p-3 bg-surface-container rounded-xl">
            <p class="text-label-sm text-on-surface-variant flex items-center gap-1"><span class="material-symbols-outlined text-sm">humidity_mid</span> Air Humidity</p>
            <p class="text-headline-lg font-bold" data-cell="${z}-hum">${fmt(d.airHumidity, '%')}</p>
          </div>
          <div class="p-3 bg-surface-container rounded-xl">
            <p class="text-label-sm text-on-surface-variant flex items-center gap-1"><span class="material-symbols-outlined text-sm">light_mode</span> Light</p>
            <p class="text-headline-lg font-bold" data-cell="${z}-light">${fmt(d.light, ' lx')}</p>
          </div>
          <div class="p-3 ${soilLow ? 'bg-error-container' : 'bg-secondary-container'} rounded-xl">
            <p class="text-label-sm ${soilLow ? 'text-on-error-container' : 'text-on-secondary-container'} flex items-center gap-1 font-semibold"><span class="material-symbols-outlined text-sm">potted_plant</span> Soil Moisture</p>
            <p class="text-headline-lg font-bold ${soilLow ? 'text-error' : 'text-on-secondary-container'}" data-cell="${z}-soil">${fmt(d.soilMoisture, '%')}</p>
          </div>
        </div>
      </div>`;
      })
      .join('');
  }

  function renderSoilBars() {
    const host = document.getElementById('soil-bars');
    const vals = [1, 2, 3].map((z) => zoneState[z]?.soilMoisture);
    host.innerHTML = [1, 2, 3]
      .map((z) => {
        const v = vals[z - 1];
        const low = v != null && v < 30;
        const w = v == null ? 0 : Math.max(0, Math.min(100, v));
        return `<div>
        <div class="flex justify-between text-label-sm mb-2"><span>Zone ${z}</span><span class="font-bold ${low ? 'text-error' : ''}">${fmt(v, '%')}</span></div>
        <div class="w-full bg-surface-container rounded-full h-2.5"><div class="${low ? 'bg-error' : 'bg-primary'} h-2.5 rounded-full transition-all" style="width:${w}%"></div></div>
      </div>`;
      })
      .join('');

    const present = vals.filter((v) => v != null);
    const analysis = document.getElementById('soil-analysis');
    if (present.length) {
      const avg = (present.reduce((s, v) => s + v, 0) / present.length).toFixed(1);
      const warnZones = [1, 2, 3].filter((z) => zoneState[z]?.soilMoisture < 30);
      analysis.textContent = warnZones.length
        ? `Average moisture ${avg}%. Zone ${warnZones.join(', ')} needs attention (below 30%).`
        : `Average moisture ${avg}%. All zones stable.`;
    } else {
      analysis.textContent = 'No soil moisture data yet.';
    }
  }

  function updateAlert() {
    const banner = document.getElementById('alert-banner');
    const text = document.getElementById('alert-text');
    const warn = [1, 2, 3].filter((z) => zoneState[z]?.soilMoisture != null && zoneState[z].soilMoisture < 30);
    if (warn.length) {
      text.textContent = `Warning: low soil moisture in Zone ${warn.join(', ')} (<30%).`;
      banner.classList.remove('hidden');
    } else {
      banner.classList.add('hidden');
    }
  }

  function flash(cell) {
    const el = document.querySelector(`[data-cell="${cell}"]`);
    if (el) {
      el.classList.remove('value-flash');
      void el.offsetWidth;
      el.classList.add('value-flash');
    }
  }

  function applyZone(z, d) {
    zoneState[z] = { ...zoneState[z], ...d };
  }

  function fmtUptime(sec) {
    if (sec == null) return '--';
    const dys = Math.floor(sec / 86400);
    const hrs = Math.floor((sec % 86400) / 3600);
    return `${dys}d ${hrs}h`;
  }

  function updateHealth(snap) {
    if (snap.rssi != null) document.getElementById('health-rssi').textContent = `${snap.rssi} dBm`;
    if (snap.voltage != null) document.getElementById('health-voltage').textContent = `${snap.voltage} V`;
    if (snap.uptime != null) document.getElementById('health-uptime').textContent = fmtUptime(snap.uptime);
  }

  // ----- Biểu đồ -----
  async function loadChart(range) {
    const { data } = await api(`/api/telemetry/history?range=${range}`);
    // gộp theo timestamp: trung bình temp/hum các zone
    const byTime = {};
    for (const r of data) {
      const t = new Date(r.CreatedAt).getTime();
      byTime[t] = byTime[t] || { temp: [], hum: [] };
      if (r.Temperature != null) byTime[t].temp.push(r.Temperature);
      if (r.AirHumidity != null) byTime[t].hum.push(r.AirHumidity);
    }
    const times = Object.keys(byTime).map(Number).sort((a, b) => a - b);
    const labels = times.map((t) => new Date(t).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }));
    const avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
    const tempData = times.map((t) => avg(byTime[t].temp));
    const humData = times.map((t) => avg(byTime[t].hum));

    const ctx = document.getElementById('th-chart');
    if (thChart) thChart.destroy();
    thChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'Temperature (°C)', data: tempData, borderColor: '#003d9b', backgroundColor: 'rgba(0,61,155,0.08)', tension: 0.4, fill: true },
          { label: 'Air Humidity (%)', data: humData, borderColor: '#006e2f', backgroundColor: 'rgba(0,110,47,0.08)', tension: 0.4, fill: true },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'top' } },
        scales: { y: { beginAtZero: false } },
      },
    });
  }

  // ----- Biểu đồ độ ẩm đất theo zone -----
  async function loadSoilChart(range) {
    const { data } = await api(`/api/telemetry/history?range=${range}`);
    // gộp 3 zone theo cùng mốc thời gian (làm tròn theo phút)
    const buckets = {};
    for (const r of data) {
      const d = new Date(r.CreatedAt);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()} ${d.getHours()}:${d.getMinutes()}`;
      buckets[key] = buckets[key] || { t: d.getTime(), z: { 1: [], 2: [], 3: [] } };
      if (r.SoilMoisture != null && buckets[key].z[r.Zone]) buckets[key].z[r.Zone].push(r.SoilMoisture);
    }
    const keys = Object.keys(buckets).sort((a, b) => buckets[a].t - buckets[b].t);
    const labels = keys.map((k) => new Date(buckets[k].t).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }));
    const avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
    const datasets = [1, 2, 3].map((z) => ({
      label: `Zone ${z}`,
      data: keys.map((k) => avg(buckets[k].z[z])),
      borderColor: SOIL_COLORS[z],
      backgroundColor: 'transparent',
      tension: 0.4,
      spanGaps: true,
      hidden: !zoneVisible[z],
    }));

    const ctx = document.getElementById('soil-chart');
    if (soilChart) soilChart.destroy();
    soilChart = new Chart(ctx, {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'top' } },
        scales: { y: { beginAtZero: true, max: 100, title: { display: true, text: '% soil moisture' } } },
      },
    });
  }

  async function init() {
    // Số liệu mới nhất
    try {
      const { zones } = await api('/api/telemetry/latest');
      for (const r of zones) {
        applyZone(r.Zone, {
          temperature: r.Temperature, airHumidity: r.AirHumidity,
          light: r.Light, soilMoisture: r.SoilMoisture,
        });
      }
    } catch (e) { /* DB trống */ }

    renderZones();
    renderSoilBars();
    updateAlert();
    loadChart('24h').catch(() => {});
    loadSoilChart('24h').catch(() => {});

    document.getElementById('range-select').addEventListener('change', (e) => {
      loadChart(e.target.value).catch(() => {});
      loadSoilChart(e.target.value).catch(() => {});
    });

    // Checkbox chọn zone cho biểu đồ độ ẩm đất
    document.querySelectorAll('#soil-zone-toggles input[data-zone]').forEach((cb) => {
      cb.addEventListener('change', () => {
        const z = Number(cb.dataset.zone);
        zoneVisible[z] = cb.checked;
        if (soilChart) {
          const ds = soilChart.data.datasets.find((d) => d.label === `Zone ${z}`);
          if (ds) {
            ds.hidden = !cb.checked;
            soilChart.update();
          }
        }
      });
    });

    // Realtime
    if (window.appSocket) {
      window.appSocket.on('telemetry', (snap) => {
        for (const z of snap.zones || []) {
          applyZone(z.zone, z);
        }
        renderZones();
        renderSoilBars();
        updateAlert();
        updateHealth(snap);
        for (const z of snap.zones || []) {
          ['temp', 'hum', 'light', 'soil'].forEach((k) => flash(`${z.zone}-${k}`));
        }
      });
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
