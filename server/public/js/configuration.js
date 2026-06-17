// Trang Configuration: chỉnh ngưỡng tự động (soil/light) cho 3 zone.
(function () {
  const { api, toast } = window.AC;
  let rules = {};

  function card(zone) {
    const r = rules[zone] || { SoilThreshold: 30, LightThreshold: 300, Enabled: true };
    const enabled = !!r.Enabled;
    return `<div class="glass-card lift p-6 rounded-2xl flex flex-col gap-5">
      <div class="flex items-center justify-between">
        <h3 class="text-title-md font-bold text-primary">Zone ${zone}</h3>
        <label class="switch">
          <input type="checkbox" data-enabled="${zone}" ${enabled ? 'checked' : ''} />
          <span class="switch-slider"></span>
        </label>
      </div>

      <div>
        <label class="text-label-sm font-semibold uppercase text-on-surface-variant flex items-center gap-1">
          <span class="material-symbols-outlined text-sm">potted_plant</span> Soil moisture threshold (%)
        </label>
        <p class="text-label-sm text-on-surface-variant mb-1">Pump turns ON when soil moisture is below this value.</p>
        <input type="number" min="0" max="100" step="1" data-soil="${zone}" value="${r.SoilThreshold}"
          class="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-3 py-2 text-body-md focus:ring-2 focus:ring-primary outline-none" />
      </div>

      <div>
        <label class="text-label-sm font-semibold uppercase text-on-surface-variant flex items-center gap-1">
          <span class="material-symbols-outlined text-sm">light_mode</span> Light threshold (lux)
        </label>
        <p class="text-label-sm text-on-surface-variant mb-1">Light turns ON when brightness is below this value.</p>
        <input type="number" min="0" step="10" data-light="${zone}" value="${r.LightThreshold}"
          class="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-3 py-2 text-body-md focus:ring-2 focus:ring-primary outline-none" />
      </div>

      <button data-save="${zone}" class="bg-primary text-on-primary rounded-lg py-2.5 font-bold hover:opacity-90 transition-opacity">
        Save Zone ${zone}
      </button>
    </div>`;
  }

  function render() {
    document.getElementById('rules-grid').innerHTML = [1, 2, 3].map(card).join('');
  }

  async function save(zone) {
    const soil = parseFloat(document.querySelector(`[data-soil="${zone}"]`).value);
    const light = parseInt(document.querySelector(`[data-light="${zone}"]`).value, 10);
    const enabled = document.querySelector(`[data-enabled="${zone}"]`).checked;
    try {
      await api(`/api/rules/${zone}`, {
        method: 'PUT',
        body: JSON.stringify({ soilThreshold: soil, lightThreshold: light, enabled }),
      });
      toast(`Saved Zone ${zone} rule`, 'success');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  function bind() {
    document.getElementById('rules-grid').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-save]');
      if (btn) save(parseInt(btn.dataset.save, 10));
    });
  }

  async function init() {
    try {
      const { rules: list } = await api('/api/rules');
      for (const r of list) rules[r.Zone] = r;
    } catch (e) { toast(e.message, 'error'); }
    render();
    bind();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
