// Trang Sensors: bảng dữ liệu mới nhất 10 zone × 3 chậu + xuất CSV.
(function () {
  const { api, toast, ZONES } = window.AC;
  const latest = {};
  const rules = {};

  function fmt(v, u = '') {
    return v == null ? '<span class="text-on-surface-variant">--</span>' : `${v}${u}`;
  }

  function threshold(zone) {
    return rules[zone]?.SoilThreshold ?? 30;
  }

  function soilCell(v, zone) {
    if (v == null) return '<span class="text-on-surface-variant">--</span>';
    const dry = v < threshold(zone);
    return `<span class="${dry ? 'text-error font-bold' : ''}">${Math.round(v)}%</span>`;
  }

  function timeAgo(ts) {
    if (!ts) return '--';
    return new Date(ts).toLocaleString('vi-VN');
  }

  function render() {
    const tbody = document.getElementById('sensor-tbody');
    tbody.innerHTML = ZONES.map((z) => {
      const d = latest[z] || {};
      return `<tr class="hover:bg-surface-container-low/50">
        <td class="px-5 py-3 font-bold text-primary">Zone ${z}</td>
        <td class="px-5 py-3">${fmt(d.Temperature, '°C')}</td>
        <td class="px-5 py-3">${fmt(d.AirHumidity, '%')}</td>
        <td class="px-5 py-3">${soilCell(d.Soil1, z)}</td>
        <td class="px-5 py-3">${soilCell(d.Soil2, z)}</td>
        <td class="px-5 py-3">${soilCell(d.Soil3, z)}</td>
        <td class="px-5 py-3 font-bold">${soilCell(d.SoilMin, z)}</td>
        <td class="px-5 py-3 text-label-sm text-on-surface-variant">${timeAgo(d.CreatedAt)}</td>
      </tr>`;
    }).join('');
  }

  function exportParams() {
    const from = document.getElementById('exp-from').value;
    const to = document.getElementById('exp-to').value;
    const zone = document.getElementById('exp-zone').value;
    const params = new URLSearchParams();
    if (from) params.set('from', new Date(from).toISOString());
    if (to) params.set('to', new Date(to).toISOString());
    if (zone && zone !== '0') params.set('zone', zone);
    return params;
  }

  function doExport() {
    // Mở qua link tải; server gửi attachment
    window.location.href = `/api/export/csv?${exportParams().toString()}`;
    toast('Generating CSV file...', 'info');
  }

  function previewRow(r) {
    const time = r.CreatedAt ? new Date(r.CreatedAt).toLocaleString('vi-VN') : '--';
    return `<tr class="hover:bg-surface-container-low/50">
      <td class="px-4 py-2 text-on-surface-variant">${time}</td>
      <td class="px-4 py-2 font-bold text-primary">Zone ${r.Zone}</td>
      <td class="px-4 py-2">${fmt(r.Temperature, '°C')}</td>
      <td class="px-4 py-2">${fmt(r.AirHumidity, '%')}</td>
      <td class="px-4 py-2">${soilCell(r.Soil1, r.Zone)}</td>
      <td class="px-4 py-2">${soilCell(r.Soil2, r.Zone)}</td>
      <td class="px-4 py-2">${soilCell(r.Soil3, r.Zone)}</td>
      <td class="px-4 py-2 font-bold">${soilCell(r.SoilMin, r.Zone)}</td>
    </tr>`;
  }

  async function doPreview() {
    const wrap = document.getElementById('preview-wrap');
    const tbody = document.getElementById('preview-tbody');
    const summary = document.getElementById('preview-summary');
    wrap.classList.remove('hidden');
    tbody.innerHTML = '<tr><td colspan="8" class="px-4 py-6 text-center text-on-surface-variant">Loading...</td></tr>';
    try {
      const { total, rows } = await api(`/api/export/preview?${exportParams().toString()}`);
      if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="8" class="px-4 py-6 text-center text-on-surface-variant">No data matches the filter.</td></tr>';
        summary.textContent = '0 rows';
        return;
      }
      tbody.innerHTML = rows.map(previewRow).join('');
      summary.textContent = total > rows.length
        ? `Total ${total} rows — showing latest ${rows.length}`
        : `${total} rows will be exported`;
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="8" class="px-4 py-6 text-center text-error">Error: ${e.message}</td></tr>`;
      summary.textContent = '';
    }
  }

  async function init() {
    document.getElementById('exp-zone').innerHTML =
      '<option value="0">All zones</option>' +
      ZONES.map((z) => `<option value="${z}">Zone ${z}</option>`).join('');

    const [data, ruleList] = await Promise.all([
      api('/api/telemetry/latest').catch(() => ({ zones: [] })),
      api('/api/rules').catch(() => ({ rules: [] })),
    ]);
    for (const r of data.zones) latest[r.Zone] = r;
    for (const r of ruleList.rules) rules[r.Zone] = r;
    render();

    document.getElementById('exp-btn').addEventListener('click', doExport);
    document.getElementById('preview-btn').addEventListener('click', doPreview);

    if (window.appSocket) {
      window.appSocket.on('telemetry', (t) => {
        latest[t.zone] = {
          Zone: t.zone, Temperature: t.temperature, AirHumidity: t.airHumidity,
          Soil1: t.soil1, Soil2: t.soil2, Soil3: t.soil3, SoilMin: t.soilMin,
          CreatedAt: t.receivedAt,
        };
        render();
      });
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
