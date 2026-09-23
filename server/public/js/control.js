// Trang Control: 10 bơm, đổi chế độ (Threshold / Schedule / Manual), tưới tay có chọn thời lượng.
(function () {
  const { api, toast, ZONES } = window.AC;

  const MODES = [
    { key: 'threshold', label: 'Threshold', hint: 'Waters when the driest pot drops below the threshold' },
    { key: 'schedule', label: 'Schedule', hint: 'Waters at the times set on the Schedules page' },
    { key: 'manual', label: 'Manual', hint: 'Nothing automatic — you control it from here' },
  ];

  const pumps = {};
  const devices = {};

  function card(z) {
    const p = pumps[z] || { State: false, Mode: 'threshold', remainingSec: 0 };
    const online = devices[z]?.IsOnline;
    const on = !!p.State;

    const modeBtns = MODES.map((m) => {
      const active = p.Mode === m.key;
      return `<button data-mode="${z}:${m.key}" title="${m.hint}"
        class="px-2.5 py-1 rounded-md text-label-sm font-bold transition-colors ${active ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:bg-surface-container-high'}">${m.label}</button>`;
    }).join('');

    const hint = MODES.find((m) => m.key === p.Mode)?.hint || '';

    return `<div class="glass-card lift p-5 rounded-2xl flex flex-col gap-4">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl flex items-center justify-center ${on ? 'bg-secondary-container text-on-secondary-container' : 'bg-surface-container text-on-surface-variant'}">
            <span class="material-symbols-outlined">water_pump</span>
          </div>
          <div>
            <h3 class="text-title-md font-bold">Zone ${z}</h3>
            <p class="text-label-sm flex items-center gap-1 ${online ? 'text-secondary' : 'text-on-surface-variant'}">
              <span class="w-1.5 h-1.5 rounded-full ${online ? 'bg-secondary' : 'bg-outline-variant'}"></span>${online ? 'Online' : 'Offline'}
            </p>
          </div>
        </div>
        <span class="px-2 py-0.5 text-[10px] font-bold rounded uppercase ${on ? 'bg-secondary/10 text-secondary' : 'bg-surface-container text-on-surface-variant'}">
          ${on ? 'ON' : 'OFF'}${on && p.remainingSec > 0 ? ` · <span data-countdown="${z}">${p.remainingSec}s</span>` : ''}
        </span>
      </div>

      <div>
        <p class="text-label-sm text-on-surface-variant uppercase font-bold mb-1.5">Mode</p>
        <div class="inline-flex bg-surface-container rounded-lg p-1 gap-0.5">${modeBtns}</div>
        <p class="text-label-sm text-on-surface-variant italic mt-2">${hint}</p>
      </div>

      <div class="pt-3 border-t border-outline-variant/30">
        <p class="text-label-sm text-on-surface-variant uppercase font-bold mb-2">Water now</p>
        <div class="flex items-center gap-2">
          <button data-water="${z}:30" class="flex-1 bg-surface-container-high rounded-lg py-2 text-label-sm font-bold hover:bg-surface-container transition-colors">30s</button>
          <button data-water="${z}:60" class="flex-1 bg-primary text-on-primary rounded-lg py-2 text-label-sm font-bold hover:opacity-90 transition-opacity">60s</button>
          <button data-water="${z}:120" class="flex-1 bg-surface-container-high rounded-lg py-2 text-label-sm font-bold hover:bg-surface-container transition-colors">120s</button>
          <button data-stop="${z}" ${on ? '' : 'disabled'} class="flex-1 bg-error/10 text-error rounded-lg py-2 text-label-sm font-bold hover:bg-error/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">Stop</button>
        </div>
        <p class="text-label-sm text-on-surface-variant mt-2">Works in any mode — the zone returns to its mode afterwards.</p>
      </div>
    </div>`;
  }

  function render() {
    document.getElementById('actuator-grid').innerHTML = ZONES.map(card).join('');
  }

  function tickCountdowns() {
    for (const z of ZONES) {
      const p = pumps[z];
      if (!p || !p.State || !p.remainingSec) continue;
      p.remainingSec = Math.max(0, p.remainingSec - 1);
      const el = document.querySelector(`[data-countdown="${z}"]`);
      if (el) el.textContent = `${p.remainingSec}s`;
    }
  }

  async function setMode(zone, mode) {
    try {
      await api('/api/control', { method: 'POST', body: JSON.stringify({ zone, mode }) });
      toast(`Zone ${zone}: mode set to ${mode}`, 'success');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function water(zone, durationSec) {
    try {
      await api('/api/control/water', { method: 'POST', body: JSON.stringify({ zone, durationSec }) });
      toast(`Zone ${zone}: watering for ${durationSec}s`, 'success');
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

  function bind() {
    document.getElementById('actuator-grid').addEventListener('click', (e) => {
      const m = e.target.closest('[data-mode]');
      if (m) {
        const [zone, mode] = m.dataset.mode.split(':');
        return setMode(Number(zone), mode);
      }
      const w = e.target.closest('[data-water]');
      if (w) {
        const [zone, dur] = w.dataset.water.split(':');
        return water(Number(zone), Number(dur));
      }
      const s = e.target.closest('[data-stop]');
      if (s) return stop(Number(s.dataset.stop));
    });
  }

  async function init() {
    const [control, devList] = await Promise.all([
      api('/api/control').catch(() => ({ pumps: [] })),
      api('/api/devices').catch(() => ({ devices: [] })),
    ]);
    for (const p of control.pumps) pumps[p.Zone] = p;
    for (const d of devList.devices) if (d.Zone) devices[d.Zone] = d;

    render();
    bind();
    setInterval(tickCountdowns, 1000);

    if (window.appSocket) {
      window.appSocket.on('pump', (p) => {
        pumps[p.Zone] = p;
        render();
      });
      window.appSocket.on('device', (d) => {
        if (d.Zone) devices[d.Zone] = { ...devices[d.Zone], ...d };
        render();
      });
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
