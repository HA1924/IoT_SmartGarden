// Trang Schedules: CRUD lịch tưới. Giờ nhập là giờ Việt Nam (UTC+7).
(function () {
  const { api, toast, ZONES } = window.AC;

  // bit i ứng với getDay(): 0 = Chủ nhật
  const DAYS = [
    { bit: 1, label: 'Sun' },
    { bit: 2, label: 'Mon' },
    { bit: 4, label: 'Tue' },
    { bit: 8, label: 'Wed' },
    { bit: 16, label: 'Thu' },
    { bit: 32, label: 'Fri' },
    { bit: 64, label: 'Sat' },
  ];

  let schedules = [];
  let selectedDays = 127; // mặc định: mọi ngày
  let editingId = null;

  function daysText(mask) {
    if (mask === 127) return 'Every day';
    if (mask === 62) return 'Mon–Fri';
    if (mask === 65) return 'Sat & Sun';
    return DAYS.filter((d) => mask & d.bit).map((d) => d.label).join(', ') || '--';
  }

  function renderDayPicker() {
    document.getElementById('sch-days').innerHTML = DAYS.map((d) => {
      const on = (selectedDays & d.bit) !== 0;
      return `<button type="button" data-day="${d.bit}"
        class="px-3 py-1.5 rounded-lg text-label-sm font-bold border transition-colors ${on ? 'bg-primary text-on-primary border-transparent' : 'text-on-surface-variant border-outline-variant hover:bg-surface-container'}">${d.label}</button>`;
    }).join('');
  }

  function renderTable() {
    const tbody = document.getElementById('schedules-tbody');
    if (!schedules.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="px-5 py-8 text-center text-on-surface-variant">No schedules yet. Add one above.</td></tr>';
      return;
    }
    tbody.innerHTML = schedules.map((s) => `<tr class="hover:bg-surface-container-low/50">
      <td class="px-5 py-3 font-bold text-primary">Zone ${s.Zone}</td>
      <td class="px-5 py-3 font-mono">${s.StartTime}</td>
      <td class="px-5 py-3">${s.DurationSec}s</td>
      <td class="px-5 py-3 text-on-surface-variant">${daysText(s.DaysOfWeek)}</td>
      <td class="px-5 py-3">
        <button data-toggle="${s.Id}" class="px-2 py-0.5 text-[10px] font-bold rounded uppercase ${s.Enabled ? 'bg-secondary/10 text-secondary' : 'bg-surface-container text-on-surface-variant'}">
          ${s.Enabled ? 'Enabled' : 'Disabled'}
        </button>
      </td>
      <td class="px-5 py-3 text-right whitespace-nowrap">
        <button data-edit="${s.Id}" class="text-primary font-semibold text-label-sm hover:underline">Edit</button>
        <span class="text-outline-variant mx-1">·</span>
        <button data-delete="${s.Id}" class="text-error font-semibold text-label-sm hover:underline">Delete</button>
      </td>
    </tr>`).join('');
  }

  async function load() {
    try {
      const { schedules: list } = await api('/api/schedules');
      schedules = list;
      renderTable();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  function resetForm() {
    editingId = null;
    selectedDays = 127;
    document.getElementById('sch-id').value = '';
    document.getElementById('sch-time').value = '06:00';
    document.getElementById('sch-duration').value = '60';
    document.getElementById('sch-zone').value = '1';
    document.getElementById('form-title').textContent = 'Add a schedule';
    document.getElementById('cancel-edit').classList.add('hidden');
    renderDayPicker();
  }

  function startEdit(id) {
    const s = schedules.find((x) => x.Id === id);
    if (!s) return;
    editingId = id;
    selectedDays = s.DaysOfWeek;
    document.getElementById('sch-id').value = id;
    document.getElementById('sch-zone').value = String(s.Zone);
    document.getElementById('sch-time').value = s.StartTime;
    document.getElementById('sch-duration').value = String(s.DurationSec);
    document.getElementById('form-title').textContent = `Edit schedule #${id}`;
    document.getElementById('cancel-edit').classList.remove('hidden');
    renderDayPicker();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function save(e) {
    e.preventDefault();
    if (!selectedDays) {
      toast('Pick at least one day', 'error');
      return;
    }
    const body = {
      zone: Number(document.getElementById('sch-zone').value),
      startTime: document.getElementById('sch-time').value,
      durationSec: Number(document.getElementById('sch-duration').value),
      daysOfWeek: selectedDays,
      enabled: true,
    };
    try {
      if (editingId) {
        await api(`/api/schedules/${editingId}`, { method: 'PUT', body: JSON.stringify(body) });
        toast('Schedule updated', 'success');
      } else {
        await api('/api/schedules', { method: 'POST', body: JSON.stringify(body) });
        toast('Schedule added', 'success');
      }
      resetForm();
      await load();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function toggleEnabled(id) {
    const s = schedules.find((x) => x.Id === id);
    if (!s) return;
    try {
      await api(`/api/schedules/${id}`, {
        method: 'PUT',
        body: JSON.stringify({
          zone: s.Zone,
          startTime: s.StartTime,
          durationSec: s.DurationSec,
          daysOfWeek: s.DaysOfWeek,
          enabled: !s.Enabled,
        }),
      });
      await load();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function remove(id) {
    if (!window.confirm(`Delete schedule #${id}?`)) return;
    try {
      await api(`/api/schedules/${id}`, { method: 'DELETE' });
      toast('Schedule deleted', 'success');
      await load();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function init() {
    document.getElementById('sch-zone').innerHTML =
      ZONES.map((z) => `<option value="${z}">Zone ${z}</option>`).join('');
    renderDayPicker();

    document.getElementById('sch-days').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-day]');
      if (!btn) return;
      selectedDays ^= Number(btn.dataset.day);
      renderDayPicker();
    });

    document.querySelectorAll('[data-preset]').forEach((b) => {
      b.addEventListener('click', () => {
        selectedDays = Number(b.dataset.preset);
        renderDayPicker();
      });
    });

    document.getElementById('schedule-form').addEventListener('submit', save);
    document.getElementById('cancel-edit').addEventListener('click', resetForm);

    document.getElementById('schedules-tbody').addEventListener('click', (e) => {
      const ed = e.target.closest('[data-edit]');
      if (ed) return startEdit(Number(ed.dataset.edit));
      const del = e.target.closest('[data-delete]');
      if (del) return remove(Number(del.dataset.delete));
      const tg = e.target.closest('[data-toggle]');
      if (tg) return toggleEnabled(Number(tg.dataset.toggle));
    });

    load();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
