// /api/camera  - nhận kết quả phân tích từ AI-service và cấp dữ liệu cho trang Camera.
const fs = require('fs');
const path = require('path');
const express = require('express');
const { requireApiKey, requireLogin } = require('../middleware/auth');
const { query } = require('../db');
const realtime = require('../realtime');
const logService = require('../services/logService');
const config = require('../config');

const router = express.Router();

// Thư mục lưu ảnh chụp (được phục vụ tĩnh qua /captures trong app.js)
const CAPTURE_DIR = path.join(__dirname, '..', 'public', 'captures');

// Chuẩn hoá zone về 1..3 (mặc định 1)
function normZone(v) {
  const z = parseInt(v, 10);
  return z >= 1 && z <= 3 ? z : 1;
}

// POST /api/camera/analysis  (AI-service gửi về - dùng API key)
// body: { zone, imagePath, canopyWidth, canopyHeight, pestDetected, pestLabel, confidence }
router.post('/analysis', requireApiKey, async (req, res) => {
  const b = req.body || {};
  const zone = normZone(b.zone);
  try {
    const result = await query(
      `INSERT INTO dbo.CameraAnalysis
         (Zone, ImagePath, CanopyWidth, CanopyHeight, PestDetected, PestLabel, Confidence)
       OUTPUT inserted.*
       VALUES (@zone, @img, @w, @h, @pest, @label, @conf)`,
      {
        zone,
        img: b.imagePath ?? null,
        w: b.canopyWidth ?? null,
        h: b.canopyHeight ?? null,
        pest: b.pestDetected ? 1 : 0,
        label: b.pestLabel ?? null,
        conf: b.confidence ?? null,
      }
    );
    const row = result.recordset[0];
    realtime.emit('camera', row);

    if (b.pestDetected) {
      await logService.warning(
        'camera',
        `Zone ${zone}: pest detected: ${b.pestLabel || 'unknown'} (confidence ${b.confidence ?? '?'})`
      );
    }
    res.json({ ok: true, analysis: row });
  } catch (err) {
    console.error('[camera] save error:', err.message);
    res.status(400).json({ error: err.message });
  }
});

// GET /api/camera/latest?zone=  (dashboard) - mặc định zone 1
router.get('/latest', requireLogin, async (req, res) => {
  const zone = normZone(req.query.zone);
  try {
    const result = await query(
      `SELECT TOP 1 * FROM dbo.CameraAnalysis WHERE Zone = @zone ORDER BY CreatedAt DESC`,
      { zone }
    );
    res.json({
      zone,
      analysis: result.recordset[0] || null,
      streamUrl: config.esp32camStreamUrls?.[zone] || '',
      streamUrls: config.esp32camStreamUrls,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/camera/capture?zone=N  (admin bấm nút -> chụp 1 ảnh tĩnh từ ESP32-Cam)
// Tải ảnh từ endpoint /capture của camera, lưu vào public/captures, ghi DB + realtime.
router.post('/capture', requireLogin, async (req, res) => {
  const zone = normZone(req.query.zone ?? (req.body && req.body.zone));
  const captureUrl = config.esp32camCaptureUrls?.[zone];
  if (!captureUrl) {
    return res.status(400).json({ error: `Camera not configured for zone ${zone}` });
  }

  // 1) Tải ảnh từ ESP32-Cam (có timeout để không treo khi camera mất kết nối)
  let buffer;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(captureUrl, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    buffer = Buffer.from(await r.arrayBuffer());
    if (!buffer.length) throw new Error('empty image');
  } catch (err) {
    const msg = err.name === 'AbortError' ? 'timed out' : err.message;
    console.error('[camera] capture lỗi:', msg);
    await logService.error('camera', `Zone ${zone}: capture failed (${msg})`);
    return res.status(502).json({ error: `Cannot reach camera zone ${zone}: ${msg}` });
  }

  // 2) Lưu ảnh ra ổ đĩa
  const filename = `zone${zone}-${Date.now()}.jpg`;
  const webPath = `/captures/${filename}`;
  try {
    fs.mkdirSync(CAPTURE_DIR, { recursive: true });
    fs.writeFileSync(path.join(CAPTURE_DIR, filename), buffer);
  } catch (err) {
    console.error('[camera] lưu ảnh lỗi:', err.message);
    return res.status(500).json({ error: 'Cannot save image: ' + err.message });
  }

  // 3) Ghi DB + phát realtime + log
  try {
    const result = await query(
      `INSERT INTO dbo.CameraAnalysis (Zone, ImagePath)
       OUTPUT inserted.*
       VALUES (@zone, @img)`,
      { zone, img: webPath }
    );
    const row = result.recordset[0];
    realtime.emit('camera', row);
    await logService.info('camera', `Zone ${zone}: image captured (${webPath})`);
    res.json({ ok: true, imagePath: webPath, analysis: row });
  } catch (err) {
    console.error('[camera] ghi DB lỗi:', err.message);
    // Ảnh đã lưu thành công nên vẫn trả path để client hiển thị
    res.status(500).json({ error: err.message, imagePath: webPath });
  }
});

// GET /api/camera/history?zone=&limit=
router.get('/history', requireLogin, async (req, res) => {
  const zone = normZone(req.query.zone);
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const result = await query(
      `SELECT TOP (@limit) * FROM dbo.CameraAnalysis WHERE Zone = @zone ORDER BY CreatedAt DESC`,
      { zone, limit }
    );
    res.json({ data: result.recordset });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
