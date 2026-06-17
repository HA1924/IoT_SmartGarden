// Trang Logs: bảng nhật ký + lọc theo mức + phân trang + xoá + realtime.
(function () {
  const { api, toast } = window.AC;

  const LEVEL = {
    info: 'bg-primary/10 text-primary',
    warning: 'bg-[#F59E0B]/15 text-[#B45309]',
    error: 'bg-error/10 text-error',
  };
  const PAGE_SIZE = 15;

  let allLogs = [];   // toàn bộ log đã tải (theo bộ lọc hiện tại)
  let currentPage = 1;

  function rowHtml(l) {
    const cls = LEVEL[l.Level] || LEVEL.info;
    return `<tr class="hover:bg-surface-container-low/50">
      <td class="px-5 py-3 text-label-sm text-on-surface-variant">${new Date(l.CreatedAt).toLocaleString('vi-VN')}</td>
      <td class="px-5 py-3"><span class="px-2 py-0.5 ${cls} text-[10px] font-bold rounded uppercase">${l.Level}</span></td>
      <td class="px-5 py-3 text-label-sm font-semibold">${l.Source || '--'}</td>
      <td class="px-5 py-3">${l.Message}</td>
    </tr>`;
  }

  function totalPages() {
    return Math.max(1, Math.ceil(allLogs.length / PAGE_SIZE));
  }

  function render() {
    const tbody = document.getElementById('logs-tbody');
    const pager = document.getElementById('logs-pager');

    if (!allLogs.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="px-5 py-8 text-center text-on-surface-variant">No logs yet.</td></tr>';
      pager.classList.add('hidden');
      return;
    }

    const pages = totalPages();
    if (currentPage > pages) currentPage = pages;
    const start = (currentPage - 1) * PAGE_SIZE;
    const slice = allLogs.slice(start, start + PAGE_SIZE);
    tbody.innerHTML = slice.map(rowHtml).join('');

    // Thanh phân trang (chỉ hiện khi > 1 trang)
    if (allLogs.length > PAGE_SIZE) {
      pager.classList.remove('hidden');
      document.getElementById('pager-info').textContent =
        `${start + 1}–${start + slice.length} / ${allLogs.length} rows`;
      document.getElementById('pager-pages').textContent = `Page ${currentPage}/${pages}`;
      document.getElementById('pager-prev').disabled = currentPage <= 1;
      document.getElementById('pager-next').disabled = currentPage >= pages;
    } else {
      pager.classList.add('hidden');
    }
  }

  async function load() {
    const level = document.getElementById('level-filter').value;
    const q = level ? `?level=${level}&limit=500` : '?limit=500';
    try {
      const { logs } = await api(`/api/logs${q}`);
      allLogs = logs;
      currentPage = 1;
      render();
    } catch (e) { /* trống */ }
  }

  async function clearLogs() {
    if (!window.confirm('Delete ALL logs? This action cannot be undone.')) return;
    try {
      const { deleted } = await api('/api/logs', { method: 'DELETE' });
      toast(`Deleted ${deleted} log rows.`, 'success');
      await load();
    } catch (e) {
      toast(`Delete error: ${e.message}`, 'error');
    }
  }

  async function init() {
    await load();
    document.getElementById('level-filter').addEventListener('change', load);
    document.getElementById('clear-logs-btn').addEventListener('click', clearLogs);
    document.getElementById('pager-prev').addEventListener('click', () => {
      if (currentPage > 1) { currentPage--; render(); }
    });
    document.getElementById('pager-next').addEventListener('click', () => {
      if (currentPage < totalPages()) { currentPage++; render(); }
    });

    if (window.appSocket) {
      window.appSocket.on('log', (l) => {
        const filter = document.getElementById('level-filter').value;
        if (filter && filter !== l.Level) return;
        allLogs.unshift(l);
        render();
      });
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
