// Trang Sensors: bảng dữ liệu mới nhất theo zone + xuất CSV.
(function () {
  const { api, toast } = window.AC;
  const latest = {};

  function fmt(v, u = '') {
    return v == null ? '<span class="text-on-surface-variant">--</span>' : `${v}${u}`;
  }

  function timeAgo(ts) {
    if (!ts) return '--';
    return new Date(ts).toLocaleString('vi-VN');
  }

  function render() {
    const tbody = document.getElementById('sensor-tbody');
    tbody.innerHTML = [1, 2, 3]
      .map((z) => {
        const d = latest[z] || {};
        const low = d.SoilMoisture != null && d.SoilMoisture < 30;
        return `<tr class="hover:bg-surface-container-low/50">
        <td class="px-5 py-3 font-bold text-primary">Zone ${z}</td>
        <td class="px-5 py-3">${fmt(d.Temperature, '°C')}</td>
        <td class="px-5 py-3">${fmt(d.AirHumidity, '%')}</td>
        <td class="px-5 py-3">${fmt(d.Light, ' lx')}</td>
        <td class="px-5 py-3 font-bold ${low ? 'text-error' : ''}">${fmt(d.SoilMoisture, '%')}</td>
        <td class="px-5 py-3 text-label-sm text-on-surface-variant">${timeAgo(d.CreatedAt)}</td>
      </tr>`;
      })
      .join('');
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
    const low = r.SoilMoisture != null && r.SoilMoisture < 30;
    return `<tr class="hover:bg-surface-container-low/50">
      <td class="px-4 py-2 text-on-surface-variant">${time}</td>
      <td class="px-4 py-2 font-bold text-primary">Zone ${r.Zone}</td>
      <td class="px-4 py-2">${fmt(r.Temperature, '°C')}</td>
      <td class="px-4 py-2">${fmt(r.AirHumidity, '%')}</td>
      <td class="px-4 py-2">${fmt(r.Light, ' lx')}</td>
      <td class="px-4 py-2 font-bold ${low ? 'text-error' : ''}">${fmt(r.SoilMoisture, '%')}</td>
    </tr>`;
  }

  async function doPreview() {
    const wrap = document.getElementById('preview-wrap');
    const tbody = document.getElementById('preview-tbody');
    const summary = document.getElementById('preview-summary');
    wrap.classList.remove('hidden');
    tbody.innerHTML = '<tr><td colspan="6" class="px-4 py-6 text-center text-on-surface-variant">Loading...</td></tr>';
    try {
      const { total, rows } = await api(`/api/export/preview?${exportParams().toString()}`);
      if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="px-4 py-6 text-center text-on-surface-variant">No data matches the filter.</td></tr>';
        summary.textContent = '0 rows';
        return;
      }
      tbody.innerHTML = rows.map(previewRow).join('');
      summary.textContent = total > rows.length
        ? `Total ${total} rows — showing latest ${rows.length}`
        : `${total} rows will be exported`;
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="6" class="px-4 py-6 text-center text-error">Error: ${e.message}</td></tr>`;
      summary.textContent = '';
    }
  }

  async function init() {
    try {
      const { zones } = await api('/api/telemetry/latest');
      for (const r of zones) latest[r.Zone] = r;
    } catch (e) { /* trống */ }
    render();

    document.getElementById('exp-btn').addEventListener('click', doExport);
    document.getElementById('preview-btn').addEventListener('click', doPreview);

    if (window.appSocket) {
      window.appSocket.on('telemetry', (snap) => {
        for (const z of snap.zones || []) {
          latest[z.zone] = {
            Zone: z.zone, Temperature: z.temperature, AirHumidity: z.airHumidity,
            Light: z.light, SoilMoisture: z.soilMoisture, CreatedAt: snap.receivedAt,
          };
        }
        render();
      });
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
