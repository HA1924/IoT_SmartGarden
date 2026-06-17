// Trang Control: render & điều khiển 3 bơm + đèn LED, đổi auto/manual.
(function () {
  const { api, toast } = window.AC;

  const META = {
    pump1: { label: 'Pump Zone 1', icon: 'water_pump', desc: 'Irrigate zone 1' },
    pump2: { label: 'Pump Zone 2', icon: 'water_pump', desc: 'Irrigate zone 2' },
    pump3: { label: 'Pump Zone 3', icon: 'water_pump', desc: 'Irrigate zone 3' },
    led: { label: 'LED Strip', icon: 'lightbulb', desc: 'Supplemental greenhouse lighting' },
  };
  const ORDER = ['pump1', 'pump2', 'pump3', 'led'];
  let state = {};

  function card(a) {
    const m = META[a];
    const s = state[a] || { State: false, Mode: 'auto' };
    const on = !!s.State;
    const isAuto = s.Mode === 'auto';
    return `<div class="glass-card lift p-6 rounded-2xl flex flex-col gap-5">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="w-11 h-11 rounded-xl flex items-center justify-center ${on ? 'bg-secondary-container text-on-secondary-container' : 'bg-surface-container text-on-surface-variant'}">
            <span class="material-symbols-outlined">${m.icon}</span>
          </div>
          <div>
            <h3 class="text-title-md font-bold">${m.label}</h3>
            <p class="text-label-sm text-on-surface-variant">${m.desc}</p>
          </div>
        </div>
        <span class="px-2 py-0.5 text-[10px] font-bold rounded uppercase ${on ? 'bg-secondary/10 text-secondary' : 'bg-surface-container text-on-surface-variant'}">${on ? 'ON' : 'OFF'}</span>
      </div>

      <div class="flex items-center justify-between pt-2 border-t border-outline-variant/30">
        <div>
          <p class="text-label-sm text-on-surface-variant uppercase font-bold mb-1">On / Off</p>
          <label class="switch">
            <input type="checkbox" data-toggle="${a}" ${on ? 'checked' : ''} ${isAuto ? 'disabled' : ''} />
            <span class="switch-slider"></span>
          </label>
        </div>
        <div class="flex flex-col items-end gap-1">
          <p class="text-label-sm text-on-surface-variant uppercase font-bold">Mode</p>
          <div class="flex bg-surface-container rounded-lg p-1">
            <button data-mode="${a}:auto" class="px-3 py-1 rounded-md text-label-sm font-bold ${isAuto ? 'bg-primary text-on-primary' : 'text-on-surface-variant'}">Auto</button>
            <button data-mode="${a}:manual" class="px-3 py-1 rounded-md text-label-sm font-bold ${!isAuto ? 'bg-primary text-on-primary' : 'text-on-surface-variant'}">Manual</button>
          </div>
        </div>
      </div>
      ${isAuto ? '<p class="text-label-sm text-on-surface-variant italic">In auto mode — the system controls based on sensor thresholds.</p>' : ''}
    </div>`;
  }

  function render() {
    document.getElementById('actuator-grid').innerHTML = ORDER.map(card).join('');
  }

  async function setControl(actuator, payload) {
    try {
      await api('/api/control', { method: 'POST', body: JSON.stringify({ actuator, ...payload }) });
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  function bind() {
    document.getElementById('actuator-grid').addEventListener('click', (e) => {
      const modeBtn = e.target.closest('[data-mode]');
      if (modeBtn) {
        const [actuator, mode] = modeBtn.dataset.mode.split(':');
        setControl(actuator, { mode });
      }
    });
    document.getElementById('actuator-grid').addEventListener('change', (e) => {
      const tg = e.target.closest('[data-toggle]');
      if (tg) {
        setControl(tg.dataset.toggle, { state: tg.checked });
      }
    });
  }

  async function init() {
    try {
      const { actuators } = await api('/api/control');
      for (const r of actuators) state[r.Actuator] = r;
    } catch (e) { toast(e.message, 'error'); }
    render();
    bind();

    if (window.appSocket) {
      window.appSocket.on('actuator', (row) => {
        state[row.Actuator] = row;
        render();
      });
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
