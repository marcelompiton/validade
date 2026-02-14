const express = require('express');
const Database = require('better-sqlite3');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');

const app = express();
const PORT = 3457;

app.use(cors());
app.use(express.json({ limit: '5mb' }));

// Basic rate limiting for auth endpoints
const authAttempts = new Map();
function rateLimit(ip, maxAttempts = 10, windowMs = 60000) {
  const now = Date.now();
  const entry = authAttempts.get(ip);
  if (!entry || now - entry.start > windowMs) {
    authAttempts.set(ip, { start: now, count: 1 });
    return false;
  }
  entry.count++;
  if (entry.count > maxAttempts) return true;
  return false;
}
// Clean up old entries every 5 min
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of authAttempts) {
    if (now - entry.start > 300000) authAttempts.delete(ip);
  }
}, 300000);

// Serve frontend
app.use(express.static(path.join(__dirname, '..')));

// Database setup
const db = new Database('/root/.openclaw/workspace/validade/api/validade.db');
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    phone TEXT NOT NULL,
    password TEXT NOT NULL,
    premium INTEGER DEFAULT 0,
    token TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    data TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

function genToken() { return crypto.randomBytes(32).toString('hex'); }

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Token required' });
  const user = db.prepare('SELECT * FROM users WHERE token = ?').get(token);
  if (!user) return res.status(401).json({ error: 'Invalid token' });
  req.user = user;
  next();
}

// Register
app.post('/api/register', (req, res) => {
  if (rateLimit(req.ip, 5)) return res.status(429).json({ error: 'Too many attempts. Try again later.' });
  const { name, email, phone, password } = req.body;
  if (!name || !email || !phone || !password) return res.status(400).json({ error: 'All fields required' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (existing) return res.status(409).json({ error: 'Email already registered' });

  const hash = bcrypt.hashSync(password, 10);
  const token = genToken();
  const result = db.prepare('INSERT INTO users (name, email, phone, password, token) VALUES (?, ?, ?, ?, ?)')
    .run(name, email.toLowerCase(), phone, hash, token);

  res.json({ token, user: { id: result.lastInsertRowid, name, email: email.toLowerCase(), phone, premium: false } });
});

// Login
app.post('/api/login', (req, res) => {
  if (rateLimit(req.ip, 10)) return res.status(429).json({ error: 'Too many attempts. Try again later.' });
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = genToken();
  db.prepare('UPDATE users SET token = ? WHERE id = ?').run(token, user.id);
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, phone: user.phone, premium: !!user.premium } });
});

// Get user info
app.get('/api/me', authMiddleware, (req, res) => {
  const u = req.user;
  res.json({ id: u.id, name: u.name, email: u.email, phone: u.phone, premium: !!u.premium });
});

// Sync items (save)
app.post('/api/items', authMiddleware, (req, res) => {
  const { data } = req.body;
  if (!data) return res.status(400).json({ error: 'Data required' });
  
  const existing = db.prepare('SELECT id FROM items WHERE user_id = ?').get(req.user.id);
  if (existing) {
    db.prepare('UPDATE items SET data = ?, updated_at = datetime("now") WHERE user_id = ?').run(JSON.stringify(data), req.user.id);
  } else {
    db.prepare('INSERT INTO items (user_id, data) VALUES (?, ?)').run(req.user.id, JSON.stringify(data));
  }
  res.json({ ok: true });
});

// Sync items (load)
app.get('/api/items', authMiddleware, (req, res) => {
  const row = db.prepare('SELECT data FROM items WHERE user_id = ?').get(req.user.id);
  res.json({ data: row ? JSON.parse(row.data) : null });
});

// Gemini AI proxy — keeps API key server-side
const GEMINI_KEY = process.env.GEMINI_KEY || 'AIzaSyBnqalI_0KRLZK7ccZ8_vaQSpvhLU_tP5k';
app.post('/api/gemini', authMiddleware, async (req, res) => {
  if (rateLimit(req.ip, 20, 60000)) return res.status(429).json({ error: 'Rate limit exceeded' });
  try {
    const { contents, generationConfig } = req.body;
    if (!contents) return res.status(400).json({ error: 'contents required' });
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents, generationConfig })
    });
    const data = await resp.json();
    res.json(data);
  } catch (e) {
    console.error('Gemini proxy error:', e);
    res.status(500).json({ error: 'AI service error' });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Validade API running on port ${PORT}`);
});
