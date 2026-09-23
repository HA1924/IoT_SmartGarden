// Trang Overview: 10 zone trên cùng 1 màn hình + biểu đồ + tưới nhanh 60s.
(function () {
  const { api, toast, ZONES } = window.AC;

  const zoneState = {};   // zone -> { temperature, airHumidity, soil1..3, soilMin }
  const pumpState = {};   // zone -> { State, Mode, remainingSec }
  const deviceState = {}; // zone -> { IsOnline }
  const rules = {};       // zone -> { SoilThreshold }

  let thChart = null;
  let soilChart = null;
  // 10 đường một lúc thì không đọc được gì, mặc định hiện 3 zone đầu
  const visibleZones = new Set([1, 2, 3]);

  const MODE_LABEL = { threshold: 'Auto', schedule: 'Timer', manual: 'Manual' };
  const ZONE_COLORS = [
    '#003d9b', '#006e2f', '#B45309', '#7C3AED', '#DC2626',
    '#0891B2', '#CA8A04', '#DB2777', '#4338CA', '#15803D',
  ];

  function fmt(v, unit = '') {
    return v == null ? '--' : `${v}${unit}`;
  }

  function threshold(zone) {
    return rules[zone]?.SoilThreshold ?? 30;
  }

  function isDry(zone) {
    const s = zoneState[zone]?.soilMin;
    return s != null && s < threshold(zone);
  }

  // ---------- Card 1 zone ----------
  function potBar(value, dry) {
    const w = value == null ? 0 : Math.max(0, Math.min(100, value));
    const color = value == null ? 'bg-outline-variant' : dry ? 'bg-error' : 'bg-primary';
    return `<div class="flex-1">
      <div class="w-full bg-surface-container rounded-full h-1.5"><div class="${color} h-1.5 rounded-full transition-all" style="width:${w}%"></div></div>
      <p class="text-[10px] text-center mt-1 ${dry ? 'text-error font-bold' : 'text-on-surface-variant'}">${value == null ? '--' : Math.round(value) + '%'}</p>
    </div>`;
  }

  function card(z) {
    const d = zoneState[z] || {};
    const p = pumpState[z] || { State: false, Mode: 'threshold', remainingSec: 0 };
    const online = deviceState[z]?.IsOnline;
    const dry = isDry(z);
    const thr = threshold(z);
    const running = !!p.State;

    const pots = [d.soil1, d.soil2, d.soil3]
      .map((v) => potBar(v, v != null && v < thr))
      .join('');

    return `<div class="glass-card lift p-4 rounded-2xl flex flex-col gap-3 ${dry ? 'ring-1 ring-error/40' : ''}">
      <div class="flex items-center justify-between">
        <h3 class="text-title-md font-bold text-primary">Zone ${z}</h3>
        <span class="flex items-center gap-1 text-[10px] font-bold uppercase ${online ? 'text-secondary' : 'text-on-surface-variant'}">
          <span class="w-1.5 h-1.5 rounded-full ${online ? 'bg-secondary' : 'bg-outline-variant'}"></span>${online ? 'Online' : 'Offline'}
        </span>
      </div>

      <div class="flex items-center gap-4 text-body-md">
        <span class="flex items-center gap-1"><span class="material-symbols-outlined text-[18px] text-on-surface-variant">thermostat</span><b data-cell="${z}-temp">${fmt(d.temperature, '°C')}</b></span>
        <span class="flex items-center gap-1"><span class="material-symbols-outlined text-[18px] text-on-surface-variant">humidity_mid</span><b data-cell="${z}-hum">${fmt(d.airHumidity, '%')}</b></span>
      </div>

      <div>
        <div class="flex items-center justify-between mb-1.5">
          <p class="text-label-sm text-on-surface-variant uppercase font-bold">Soil — 3 pots</p>
          <span class="text-label-sm ${dry ? 'text-error font-bold' : 'text-on-surface-variant'}">min ${fmt(d.soilMin == null ? null : Math.round(d.soilMin), '%')}</span>
        </div>
        <div class="flex gap-2" data-cell="${z}-soil">${pots}</div>
      </div>

      <div class="flex items-center justify-between pt-2 border-t border-outline-variant/30">
        <div>
          <p class="text-[10px] uppercase font-bold text-on-surface-variant">Pump</p>
          <p class="text-label-sm font-bold ${running ? 'text-secondary' : 'text-on-surface-variant'}">
            ${running ? 'ON' : 'OFF'}
            <span class="font-normal text-on-surface-variant">· ${MODE_LABEL[p.Mode] || p.Mode}</span>
            ${running && p.remainingSec > 0 ? `<span data-countdown="${z}" class="font-mono text-primary">${p.remainingSec}s</span>` : ''}
          </p>
        </div>
        ${running
          ? `<button data-stop="${z}" class="bg-error/10 text-error rounded-lg px-3 py-1.5 text-label-sm font-bold hover:bg-error/20 transition-colors">Stop</button>`
          : `<button data-water="${z}" class="bg-primary text-on-primary rounded-lg px-3 py-1.5 text-label-sm font-bold hover:opacity-90 transition-opacity">Water 60s</button>`}
      </div>
    </div>`;
  }

  function renderZones() {
    document.getElementById('zone-grid').innerHTML = ZONES.map(card).join('');
  }

  function renderKpis() {
    const online = ZONES.filter((z) => deviceState[z]?.IsOnline).length;
    const pumps = ZONES.filter((z) => pumpState[z]?.State).length;
    const dry = ZONES.filter(isDry);
    const temps = ZONES.map((z) => zoneState[z]?.temperature).filter((v) => v != null);

    document.getElementById('kpi-online').textContent = `${online}/${ZONES.length}`;
    document.getElementById('kpi-pumps').textContent = String(pumps);
    document.getElementById('kpi-dry').textContent = String(dry.length);
    document.getElementById('kpi-temp').textContent = temps.length
      ? `${(temps.reduce((s, v) => s + v, 0) / temps.length).toFixed(1)}°C`
      : '--';

    const banner = document.getElementById('alert-banner');
    const text = document.getElementById('alert-text');
    const offline = ZONES.filter((z) => deviceState[z] && !deviceState[z].IsOnline);
    const parts = [];
    if (dry.length) parts.push(`Low soil moisture in Zone ${dry.join(', ')}`);
    if (offline.length) parts.push(`No data from Zone ${offline.join(', ')}`);

    if (parts.length) {
      text.textContent = parts.join('. ') + '.';
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

  // ---------- Đếm ngược thời gian tưới còn lại ----------
  function tickCountdowns() {
    let needRender = false;
    for (const z of ZONES) {
      const p = pumpState[z];
      if (!p || !p.State || !p.remainingSec) continue;
      p.remainingSec = Math.max(0, p.remainingSec - 1);
      const el = document.querySelector(`[data-countdown="${z}"]`);
      if (el) el.textContent = `${p.remainingSec}s`;
      // Hết giờ: server sẽ gửi event 'pump', nhưng vẽ lại luôn cho mượt
      if (p.remainingSec === 0) needRender = true;
    }
    if (needRender) renderZones();
  }

  // ---------- Biểu đồ ----------
  async function loadCharts(range) {
    const { data } = await api(`/api/telemetry/history?range=${range}`);

    // Gom theo mốc thời gian đã downsample sẵn ở server
    const buckets = {};
    for (const r of data) {
      const t = new Date(r.Bucket).getTime();
      buckets[t] = buckets[t] || { temp: [], hum: [], zones: {} };
      if (r.Temperature != null) buckets[t].temp.push(Number(r.Temperature));
      if (r.AirHumidity != null) buckets[t].hum.push(Number(r.AirHumidity));
      if (r.SoilMin != null) buckets[t].zones[r.Zone] = Number(r.SoilMin);
    }
    const times = Object.keys(buckets).map(Number).sort((a, b) => a - b);
    const labels = times.map((t) => {
      const d = new Date(t);
      return range === '24h'
        ? d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
        : d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
    });
    const avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);

    if (thChart) thChart.destroy();
    thChart = new Chart(document.getElementById('th-chart'), {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'Temperature (°C)', data: times.map((t) => avg(buckets[t].temp)), borderColor: '#003d9b', backgroundColor: 'rgba(0,61,155,0.08)', tension: 0.4, fill: true, pointRadius: 0 },
          { label: 'Air Humidity (%)', data: times.map((t) => avg(buckets[t].hum)), borderColor: '#006e2f', backgroundColor: 'rgba(0,110,47,0.08)', tension: 0.4, fill: true, pointRadius: 0 },
        ],
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top' } } },
    });

    const datasets = ZONES.map((z) => ({
      label: `Zone ${z}`,
      data: times.map((t) => buckets[t].zones[z] ?? null),
      borderColor: ZONE_COLORS[z - 1],
      backgroundColor: 'transparent',
      tension: 0.4,
      spanGaps: true,
      pointRadius: 0,
      hidden: !visibleZones.has(z),
    }));

    if (soilChart) soilChart.destroy();
    soilChart = new Chart(document.getElementById('soil-chart'), {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, max: 100, title: { display: true, text: '% soil moisture' } } },
      },
    });
  }

  function renderZoneToggles() {
    document.getElementById('soil-zone-toggles').innerHTML = ZONES.map((z) => {
      const on = visibleZones.has(z);
      return `<button data-toggle-zone="${z}"
        class="px-2.5 py-1 rounded-lg text-label-sm font-bold border transition-colors ${on ? 'text-on-primary border-transparent' : 'text-on-surface-variant border-outline-variant'}"
        style="${on ? `background:${ZONE_COLORS[z - 1]}` : ''}">${z}</button>`;
    }).join('');
  }

  // ---------- Hành động ----------
  async function water(zone) {
    try {
      await api('/api/control/water', {
        method: 'POST',
        body: JSON.stringify({ zone, durationSec: 60 }),
      });
      toast(`Zone ${zone}: watering for 60s`, 'success');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function stop(zone) {
    try {
      await api('/api/control/stop', { method: 'POST', body: JSON.stringify({ zone }) });
      toast(`Zone ${zone}: pump stopped`, 'info');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function init() {
    // Tải song song cho nhanh
    const [latest, control, devices, ruleList] = await Promise.all([
      api('/api/telemetry/latest').catch(() => ({ zones: [] })),
      api('/api/control').catch(() => ({ pumps: [] })),
      api('/api/devices').catch(() => ({ devices: [] })),
      api('/api/rules').catch(() => ({ rules: [] })),
    ]);

    for (const r of latest.zones) {
      zoneState[r.Zone] = {
        temperature: r.Temperature, airHumidity: r.AirHumidity,
        soil1: r.Soil1, soil2: r.Soil2, soil3: r.Soil3, soilMin: r.SoilMin,
      };
    }
    for (const p of control.pumps) pumpState[p.Zone] = p;
    for (const d of devices.devices) if (d.Zone) deviceState[d.Zone] = d;
    for (const r of ruleList.rules) rules[r.Zone] = r;

    renderZones();
    renderKpis();
    renderZoneToggles();
    loadCharts('24h').catch(() => {});

    document.getElementById('range-select').addEventListener('change', (e) => {
      loadCharts(e.target.value).catch(() => {});
    });

    document.getElementById('soil-zone-toggles').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-toggle-zone]');
      if (!btn) return;
      const z = Number(btn.dataset.toggleZone);
      if (visibleZones.has(z)) visibleZones.delete(z);
      else visibleZones.add(z);
      renderZoneToggles();
      if (soilChart) {
        const ds = soilChart.data.datasets.find((d) => d.label === `Zone ${z}`);
        if (ds) {
          ds.hidden = !visibleZones.has(z);
          soilChart.update();
        }
      }
    });

    document.getElementById('zone-grid').addEventListener('click', (e) => {
      const w = e.target.closest('[data-water]');
      if (w) return water(Number(w.dataset.water));
      const s = e.target.closest('[data-stop]');
      if (s) return stop(Number(s.dataset.stop));
    });

    setInterval(tickCountdowns, 1000);

    if (window.appSocket) {
      window.appSocket.on('telemetry', (t) => {
        zoneState[t.zone] = {
          temperature: t.temperature, airHumidity: t.airHumidity,
          soil1: t.soil1, soil2: t.soil2, soil3: t.soil3, soilMin: t.soilMin,
        };
        if (deviceState[t.zone]) deviceState[t.zone].IsOnline = true;
        renderZones();
        renderKpis();
        ['temp', 'hum', 'soil'].forEach((k) => flash(`${t.zone}-${k}`));
      });
      window.appSocket.on('pump', (p) => {
        pumpState[p.Zone] = p;
        renderZones();
        renderKpis();
      });
      window.appSocket.on('device', (d) => {
        if (d.Zone) deviceState[d.Zone] = { ...deviceState[d.Zone], ...d };
        renderZones();
        renderKpis();
      });
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
