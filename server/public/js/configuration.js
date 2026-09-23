// Trang Configuration: ngưỡng tưới + các chặn an toàn cho 10 zone.
(function () {
  const { api, toast, ZONES } = window.AC;
  let rules = {};

  function field(zone, key, label, hint, value, attrs) {
    return `<div>
      <label class="text-label-sm font-semibold uppercase text-on-surface-variant">${label}</label>
      <p class="text-label-sm text-on-surface-variant mb-1">${hint}</p>
      <input type="number" ${attrs} data-${key}="${zone}" value="${value}"
        class="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-3 py-2 text-body-md focus:ring-2 focus:ring-primary outline-none" />
    </div>`;
  }

  function card(zone) {
    const r = rules[zone] || {
      SoilThreshold: 30, HysteresisPct: 15, MaxRunMinutes: 5, MinRestMinutes: 20, Enabled: true,
    };
    const enabled = !!r.Enabled;

    return `<div class="glass-card lift p-5 rounded-2xl flex flex-col gap-4">
      <div class="flex items-center justify-between">
        <h3 class="text-title-md font-bold text-primary">Zone ${zone}</h3>
        <label class="switch">
          <input type="checkbox" data-enabled="${zone}" ${enabled ? 'checked' : ''} />
          <span class="switch-slider"></span>
        </label>
      </div>

      ${field(zone, 'soil', 'Soil threshold (%)', 'Pump turns ON when the driest pot falls below this.', r.SoilThreshold, 'min="0" max="100" step="1"')}
      ${field(zone, 'hys', 'Hysteresis (%)', 'Pump turns OFF only above threshold + this margin.', r.HysteresisPct, 'min="0" max="50" step="1"')}
      ${field(zone, 'maxrun', 'Max runtime (minutes)', 'Safety cut-off. The pump is stopped after this no matter what.', r.MaxRunMinutes, 'min="1" max="120" step="1"')}
      ${field(zone, 'minrest', 'Min rest (minutes)', 'Wait at least this long before watering again.', r.MinRestMinutes, 'min="0" max="240" step="1"')}

      <button data-save="${zone}" class="bg-primary text-on-primary rounded-lg py-2.5 font-bold hover:opacity-90 transition-opacity">
        Save Zone ${zone}
      </button>
    </div>`;
  }

  function render() {
    document.getElementById('rules-grid').innerHTML = ZONES.map(card).join('');
  }

  function num(selector) {
    const el = document.querySelector(selector);
    const v = parseFloat(el.value);
    return Number.isFinite(v) ? v : null;
  }

  async function save(zone) {
    const body = {
      soilThreshold: num(`[data-soil="${zone}"]`),
      hysteresisPct: num(`[data-hys="${zone}"]`),
      maxRunMinutes: num(`[data-maxrun="${zone}"]`),
      minRestMinutes: num(`[data-minrest="${zone}"]`),
      enabled: document.querySelector(`[data-enabled="${zone}"]`).checked,
    };
    try {
      const { rule } = await api(`/api/rules/${zone}`, { method: 'PUT', body: JSON.stringify(body) });
      rules[zone] = rule;
      toast(`Saved Zone ${zone}`, 'success');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  // Áp giá trị của zone 1 cho 9 zone còn lại - đỡ phải gõ 10 lần khi cấu hình giống nhau
  async function applyToAll() {
    if (!window.confirm('Copy Zone 1 settings to all other zones?')) return;
    const body = {
      soilThreshold: num('[data-soil="1"]'),
      hysteresisPct: num('[data-hys="1"]'),
      maxRunMinutes: num('[data-maxrun="1"]'),
      minRestMinutes: num('[data-minrest="1"]'),
      enabled: document.querySelector('[data-enabled="1"]').checked,
    };
    try {
      for (const z of ZONES) {
        const { rule } = await api(`/api/rules/${z}`, { method: 'PUT', body: JSON.stringify(body) });
        rules[z] = rule;
      }
      render();
      toast('Applied Zone 1 settings to all zones', 'success');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function init() {
    try {
      const { rules: list } = await api('/api/rules');
      for (const r of list) rules[r.Zone] = r;
    } catch (e) {
      toast(e.message, 'error');
    }
    render();

    document.getElementById('rules-grid').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-save]');
      if (btn) save(Number(btn.dataset.save));
    });
    document.getElementById('apply-all-btn').addEventListener('click', applyToAll);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
