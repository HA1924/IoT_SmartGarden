// Trang Camera: 3 camera quan sát theo zone. Chọn zone -> stream + kết quả AI tương ứng.
(function () {
  const { api } = window.AC;
  let currentZone = 1;

  const ACTIVE = 'bg-primary text-on-primary shadow-sm';
  const INACTIVE = 'text-on-surface-variant hover:bg-surface-variant/50';

  function setActiveTab(zone) {
    document.querySelectorAll('#zone-tabs .zone-tab').forEach((btn) => {
      const on = Number(btn.dataset.zone) === zone;
      btn.className = `zone-tab px-4 py-2 rounded-lg text-body-md font-semibold transition-colors ${on ? ACTIVE : INACTIVE}`;
    });
  }

  function resetAnalysis() {
    document.getElementById('canopy-w').textContent = '-- cm';
    document.getElementById('canopy-h').textContent = '-- cm';
    document.getElementById('cam-time').textContent = '--';
    const pestStatus = document.getElementById('pest-status');
    pestStatus.textContent = 'No';
    pestStatus.className = 'text-title-md font-bold text-secondary';
    document.getElementById('pest-alert').classList.add('hidden');
  }

  function applyAnalysis(a) {
    if (!a) {
      resetAnalysis();
      return;
    }
    document.getElementById('canopy-w').textContent = a.CanopyWidth != null ? `${a.CanopyWidth} cm` : '-- cm';
    document.getElementById('canopy-h').textContent = a.CanopyHeight != null ? `${a.CanopyHeight} cm` : '-- cm';
    document.getElementById('cam-time').textContent = a.CreatedAt ? new Date(a.CreatedAt).toLocaleString('vi-VN') : '--';

    const pestStatus = document.getElementById('pest-status');
    const alertBox = document.getElementById('pest-alert');
    if (a.PestDetected) {
      pestStatus.textContent = 'Yes';
      pestStatus.className = 'text-title-md font-bold text-error';
      document.getElementById('pest-label').textContent = `Detected: ${a.PestLabel || 'pest'}`;
      document.getElementById('pest-conf').textContent = `Confidence: ${a.Confidence ?? '?'}`;
      alertBox.classList.remove('hidden');
    } else {
      pestStatus.textContent = 'No';
      pestStatus.className = 'text-title-md font-bold text-secondary';
      alertBox.classList.add('hidden');
    }
  }

  // Hiển thị ảnh chụp gần nhất (lấy ImagePath từ bản ghi phân tích)
  function updateCapture(a) {
    const card = document.getElementById('last-capture-card');
    if (a && a.ImagePath) {
      document.getElementById('last-capture-img').src = a.ImagePath;
      document.getElementById('last-capture-link').href = a.ImagePath;
      document.getElementById('last-capture-time').textContent = a.CreatedAt
        ? new Date(a.CreatedAt).toLocaleString('vi-VN')
        : '';
      card.classList.remove('hidden');
    } else {
      card.classList.add('hidden');
    }
  }

  function setStream(url) {
    const img = document.getElementById('cam-stream');
    const placeholder = document.getElementById('cam-placeholder');
    if (url) {
      img.src = url;
      img.classList.remove('hidden');
      placeholder.classList.add('hidden');
    } else {
      img.removeAttribute('src');
      img.classList.add('hidden');
      placeholder.classList.remove('hidden');
    }
  }

  function rowHtml(a) {
    const thumb = a.ImagePath
      ? `<a href="${a.ImagePath}" target="_blank" rel="noopener"><img src="${a.ImagePath}" class="h-10 w-14 object-cover rounded-md" alt="capture" /></a>`
      : '<span class="text-on-surface-variant">--</span>';
    return `<tr class="hover:bg-surface-container-low/50">
      <td class="py-2">${thumb}</td>
      <td class="py-2 text-label-sm">${new Date(a.CreatedAt).toLocaleString('vi-VN')}</td>
      <td class="py-2">${a.CanopyWidth ?? '--'}</td>
      <td class="py-2">${a.CanopyHeight ?? '--'}</td>
      <td class="py-2">${a.PestDetected ? `<span class="text-error font-bold">${a.PestLabel || 'Yes'}</span>` : '<span class="text-secondary">No</span>'}</td>
      <td class="py-2">${a.Confidence ?? '--'}</td>
    </tr>`;
  }

  async function loadZone(zone) {
    currentZone = zone;
    setActiveTab(zone);

    // Stream + kết quả mới nhất
    try {
      const { analysis, streamUrl } = await api(`/api/camera/latest?zone=${zone}`);
      setStream(streamUrl);
      applyAnalysis(analysis);
      updateCapture(analysis);
    } catch (e) {
      setStream('');
      resetAnalysis();
      updateCapture(null);
    }

    // Lịch sử theo zone
    const tbody = document.getElementById('cam-history');
    try {
      const { data } = await api(`/api/camera/history?zone=${zone}&limit=20`);
      tbody.innerHTML = data.map(rowHtml).join('') ||
        '<tr><td colspan="6" class="py-6 text-center text-on-surface-variant">No data for this zone yet.</td></tr>';
    } catch (e) {
      tbody.innerHTML = '';
    }
  }

  // Chụp ảnh từ camera của zone đang xem
  async function doCapture() {
    const btn = document.getElementById('capture-btn');
    const icon = document.getElementById('capture-icon');
    const label = document.getElementById('capture-label');
    if (!btn || btn.disabled) return;
    btn.disabled = true;
    icon.classList.add('animate-spin');
    icon.textContent = 'progress_activity';
    label.textContent = 'Capturing...';
    try {
      const res = await api(`/api/camera/capture?zone=${currentZone}`, { method: 'POST' });
      // Ghi DB + realtime 'camera' sẽ tự cập nhật bảng/ảnh; vẫn hiện ngay cho chắc.
      if (res.imagePath) {
        updateCapture({ ImagePath: res.imagePath, CreatedAt: res.analysis && res.analysis.CreatedAt });
      }
      window.AC.toast(`Captured zone ${currentZone}`, 'success');
    } catch (e) {
      window.AC.toast(e.message || 'Capture failed', 'error');
    } finally {
      btn.disabled = false;
      icon.classList.remove('animate-spin');
      icon.textContent = 'photo_camera';
      label.textContent = 'Capture';
    }
  }

  async function init() {
    document.querySelectorAll('#zone-tabs .zone-tab').forEach((btn) => {
      btn.addEventListener('click', () => loadZone(Number(btn.dataset.zone)));
    });

    const captureBtn = document.getElementById('capture-btn');
    if (captureBtn) captureBtn.addEventListener('click', doCapture);

    await loadZone(1);

    // Realtime: chỉ cập nhật nếu đúng zone đang xem
    if (window.appSocket) {
      window.appSocket.on('camera', (a) => {
        if (Number(a.Zone) !== currentZone) return;
        applyAnalysis(a);
        updateCapture(a);
        const tbody = document.getElementById('cam-history');
        if (tbody.children.length === 1 && tbody.querySelector('td[colspan]')) tbody.innerHTML = '';
        tbody.insertAdjacentHTML('afterbegin', rowHtml(a));
      });
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
