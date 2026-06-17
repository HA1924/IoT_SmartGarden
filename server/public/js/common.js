// Layout dùng chung: sidebar + topbar, auth guard, Socket.IO, tiện ích.
// Mỗi trang đặt: <body data-page="overview" data-title="Irrigation Dashboard">

const NAV_ITEMS = [
  { page: 'overview', href: '/', icon: 'dashboard', label: 'Overview' },
  { page: 'sensors', href: '/sensors', icon: 'sensors', label: 'Sensors' },
  { page: 'control', href: '/control', icon: 'toggle_on', label: 'Control' },
  { page: 'camera', href: '/camera', icon: 'videocam', label: 'Camera' },
  { page: 'logs', href: '/logs', icon: 'history', label: 'Logs' },
  { page: 'configuration', href: '/configuration', icon: 'settings_input_component', label: 'Configuration' },
];

function buildSidebar(active) {
  const links = NAV_ITEMS.map((it) => {
    const on = it.page === active;
    const cls = on
      ? 'bg-primary-container text-on-primary-container font-semibold'
      : 'text-on-surface-variant hover:bg-surface-variant/50';
    return `<a href="${it.href}" class="flex items-center gap-3 px-3 py-2.5 ${cls} transition-colors rounded-lg">
      <span class="material-symbols-outlined ${on ? 'fill-icon' : ''}">${it.icon}</span>
      <span class="text-body-md">${it.label}</span>
    </a>`;
  }).join('');

  return `<aside id="app-sidebar" class="fixed left-0 top-0 h-screen w-[260px] bg-white/70 backdrop-blur-xl border-r border-white/20 shadow-sm z-50 flex flex-col p-4 gap-2 transform -translate-x-full lg:translate-x-0 transition-transform duration-300 ease-in-out">
    <div class="mb-8 px-2">
      <h1 class="text-title-md font-bold text-primary">AquaControl Pro</h1>
      <p class="text-label-sm text-on-surface-variant">IoT Greenhouse</p>
    </div>
    <nav class="flex-1 space-y-1">${links}</nav>
    <div class="pt-4 border-t border-outline-variant/30 space-y-1">
      <div class="px-3 py-2 mb-2">
        <span id="system-status" class="inline-flex items-center gap-2 px-2 py-1 rounded-full bg-secondary-container text-on-secondary-container text-[10px] font-bold uppercase tracking-wider">
          <span class="w-2 h-2 bg-secondary rounded-full animate-pulse"></span> System: Online
        </span>
      </div>
      <button id="logout-btn" class="w-full flex items-center gap-3 px-3 py-2 text-on-surface-variant hover:bg-surface-variant/50 transition-colors rounded-lg">
        <span class="material-symbols-outlined">logout</span>
        <span class="text-body-md">Logout</span>
      </button>
    </div>
  </aside>
  <div id="sidebar-backdrop" class="fixed inset-0 bg-black/40 z-40 opacity-0 pointer-events-none transition-opacity duration-300 lg:hidden"></div>`;
}

function buildTopbar(title) {
  return `<header class="fixed top-0 right-0 left-0 lg:left-[260px] h-16 bg-white/70 backdrop-blur-xl border-b border-white/20 shadow-sm z-40 flex items-center justify-between px-4 lg:px-6">
    <div class="flex items-center gap-2 min-w-0">
      <button id="sidebar-toggle" aria-label="Open menu" class="lg:hidden p-2 -ml-2 text-on-surface-variant hover:text-primary transition-colors">
        <span class="material-symbols-outlined">menu</span>
      </button>
      <h2 class="text-title-md sm:text-headline-lg font-bold text-on-surface truncate">${title || ''}</h2>
    </div>
    <div class="flex items-center gap-4">
      <div id="wifi-chip" class="hidden md:flex items-center gap-2 bg-surface-container-high px-3 py-1.5 rounded-full">
        <span class="material-symbols-outlined text-primary text-sm">wifi</span>
        <span id="wifi-rssi" class="text-label-sm text-on-surface-variant">-- dBm</span>
      </div>
      <button class="p-2 text-on-surface-variant hover:text-primary transition-colors relative">
        <span class="material-symbols-outlined">notifications</span>
        <span id="notif-dot" class="hidden absolute top-2 right-2 w-2 h-2 bg-error rounded-full"></span>
      </button>
      <div class="flex items-center gap-3 pl-4 border-l border-outline-variant/30">
        <div class="text-right">
          <p id="user-name" class="text-body-md font-semibold leading-tight">Admin</p>
          <p class="text-label-sm text-on-surface-variant">Administrator</p>
        </div>
        <div class="w-10 h-10 rounded-full bg-primary-container text-on-primary-container flex items-center justify-center font-bold">A</div>
      </div>
    </div>
  </header>`;
}

// ---------- Tiện ích gọi API ----------
async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (res.status === 401) {
    window.location.href = '/login';
    throw new Error('Not logged in');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

// ---------- Toast nhỏ ----------
function toast(message, type = 'info') {
  let host = document.getElementById('toast-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toast-host';
    host.className = 'fixed bottom-6 right-6 z-[100] flex flex-col gap-2';
    document.body.appendChild(host);
  }
  const colors = {
    info: 'bg-primary text-on-primary',
    success: 'bg-secondary text-on-secondary',
    error: 'bg-error text-on-error',
    warning: 'bg-[#F59E0B] text-white',
  };
  const el = document.createElement('div');
  el.className = `${colors[type] || colors.info} px-4 py-2.5 rounded-xl shadow-lg text-body-md font-semibold`;
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ---------- Khởi tạo trang ----------
let socket = null;
function initLayout() {
  const body = document.body;
  const active = body.dataset.page;
  const title = body.dataset.title;

  const sidebarRoot = document.getElementById('sidebar-root');
  const topbarRoot = document.getElementById('topbar-root');
  if (sidebarRoot) sidebarRoot.innerHTML = buildSidebar(active);
  if (topbarRoot) topbarRoot.innerHTML = buildTopbar(title);

  // Sidebar thu gọn trên màn nhỏ / khi zoom (hamburger + backdrop)
  const sidebar = document.getElementById('app-sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  const toggleBtn = document.getElementById('sidebar-toggle');
  const openSidebar = () => {
    sidebar?.classList.remove('-translate-x-full');
    backdrop?.classList.remove('opacity-0', 'pointer-events-none');
  };
  const closeSidebar = () => {
    sidebar?.classList.add('-translate-x-full');
    backdrop?.classList.add('opacity-0', 'pointer-events-none');
  };
  if (toggleBtn) toggleBtn.addEventListener('click', openSidebar);
  if (backdrop) backdrop.addEventListener('click', closeSidebar);
  // Bấm vào mục điều hướng thì đóng sidebar (trên mobile)
  sidebar?.querySelectorAll('nav a').forEach((a) => a.addEventListener('click', closeSidebar));
  // Khi giãn ra desktop, đảm bảo backdrop tắt
  window.addEventListener('resize', () => {
    if (window.innerWidth >= 1024) closeSidebar();
  });

  // Logout
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      await api('/logout', { method: 'POST' });
      window.location.href = '/login';
    });
  }

  // Hiển thị tên user
  api('/api/me')
    .then((d) => {
      const el = document.getElementById('user-name');
      if (el && d.user) el.textContent = d.user.username;
    })
    .catch(() => {});

  // Socket.IO realtime
  if (window.io) {
    socket = io();
    socket.on('telemetry', (snap) => {
      const rssi = document.getElementById('wifi-rssi');
      if (rssi && snap.rssi != null) rssi.textContent = `${snap.rssi} dBm`;
    });
    window.appSocket = socket;
  }
}

document.addEventListener('DOMContentLoaded', initLayout);

window.AC = { api, toast };
