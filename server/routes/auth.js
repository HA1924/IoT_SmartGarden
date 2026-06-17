// Đăng nhập / đăng xuất admin (session + bcrypt).
const express = require('express');
const bcrypt = require('bcryptjs');
const { query } = require('../db');

const router = express.Router();

// POST /login  { username, password }
router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Missing username or password' });
  }
  try {
    const result = await query(
      'SELECT TOP 1 Id, Username, PasswordHash, Role FROM dbo.Users WHERE Username = @u',
      { u: username }
    );
    const user = result.recordset[0];
    if (!user) {
      return res.status(401).json({ error: 'Incorrect username or password' });
    }
    const ok = await bcrypt.compare(password, user.PasswordHash);
    if (!ok) {
      return res.status(401).json({ error: 'Incorrect username or password' });
    }
    req.session.user = { id: user.Id, username: user.Username, role: user.Role };
    res.json({ ok: true, redirect: '/' });
  } catch (err) {
    console.error('[auth] login error:', err.message);
    res.status(500).json({ error: 'Server error during login' });
  }
});

// POST /logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true, redirect: '/login' });
  });
});

// GET /api/me  - thông tin user hiện tại (cho front-end hiển thị)
router.get('/api/me', (req, res) => {
  if (req.session && req.session.user) {
    return res.json({ user: req.session.user });
  }
  res.status(401).json({ error: 'Not logged in' });
});

module.exports = router;
