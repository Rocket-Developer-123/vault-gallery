const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const path = require('path');

const { JWT_SECRET, MASTER_PASS, ADMIN_PASS, DATABASE_URL, FRIEND_CODES, REQUIRE_APP } = process.env;
if (!JWT_SECRET || !MASTER_PASS || !ADMIN_PASS || !DATABASE_URL) {
  console.error('Set JWT_SECRET, MASTER_PASS, ADMIN_PASS and DATABASE_URL in Render.');
  process.exit(1);
}

// FRIEND_CODES="Riya:code1,Sam:code2" gives each friend a personal code (shown as a watermark)
const friends = (FRIEND_CODES || '').split(',').map(s => s.trim().split(':')).filter(p => p[0] && p[1]);
const same = (a, b) => {
  const h = v => crypto.createHash('sha256').update(String(v)).digest();
  return crypto.timingSafeEqual(h(a), h(b));
};

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
pool.query(`
  CREATE TABLE IF NOT EXISTS photos (
    id SERIAL PRIMARY KEY, title TEXT NOT NULL, image_data TEXT NOT NULL,
    is_private BOOLEAN DEFAULT false, photo_password_hash TEXT, created_at TIMESTAMPTZ DEFAULT now());
  ALTER TABLE photos ADD COLUMN IF NOT EXISTS thumb TEXT;
  ALTER TABLE photos ADD COLUMN IF NOT EXISTS hint TEXT;
  ALTER TABLE photos ADD COLUMN IF NOT EXISTS burn BOOLEAN DEFAULT false;
`).catch(e => console.error('DB setup failed:', e.message));

// Only failed attempts count, so normal browsing is never blocked
const limiter = rateLimit({
  windowMs: 10 * 60 * 1000, max: 20, skipSuccessfulRequests: true,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many wrong tries. Wait 10 minutes.' }
});

// Optional: only allow the Android app (set REQUIRE_APP=true on Render when the app is ready)
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  if (REQUIRE_APP === 'true' && !(req.get('user-agent') || '').includes('VaultApp')) {
    return res.status(403).json({ error: 'Open this in the Vault app.' });
  }
  next();
});

const safe = fn => (req, res) => fn(req, res).catch(e => {
  console.error(e);
  res.status(500).json({ error: 'Server error' });
});

function auth(role) {
  return (req, res, next) => {
    try {
      const token = (req.headers.authorization || '').split(' ')[1];
      req.user = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    } catch (e) {
      return res.status(401).json({ error: 'Session expired. Log in again.' });
    }
    if (role && req.user.role !== role) return res.status(403).json({ error: 'Admin only' });
    next();
  };
}

const sign = (role, name) => ({
  role, name, token: jwt.sign({ role, name }, JWT_SECRET, { algorithm: 'HS256', expiresIn: '4h' })
});

app.post('/api/login', limiter, (req, res) => {
  const pw = String((req.body || {}).password || '');
  if (same(pw, ADMIN_PASS)) return res.json(sign('admin', 'Admin'));
  let name = same(pw, MASTER_PASS) ? 'Guest' : null;
  for (const [n, code] of friends) if (same(pw, code)) name = n;
  if (!name) return res.status(401).json({ error: 'Wrong password' });
  res.json(sign('viewer', name));
});

// List: titles and tiny blurred thumbnails only, never full images
app.get('/api/photos', auth(), safe(async (req, res) => {
  const r = await pool.query('SELECT id, title, thumb, hint, burn, is_private FROM photos ORDER BY created_at DESC');
  const admin = req.user.role === 'admin';
  res.json(r.rows.map(p => ({ ...p, thumb: p.is_private && !admin ? null : p.thumb })));
}));

// View one photo (checks the photo password, burns it if it is a burn photo)
app.post('/api/photos/:id/view', limiter, auth(), safe(async (req, res) => {
  const r = await pool.query('SELECT * FROM photos WHERE id = $1', [req.params.id]);
  const p = r.rows[0];
  if (!p) return res.status(404).json({ error: 'Photo not found (it may have burned).' });
  const admin = req.user.role === 'admin';
  if (p.is_private && !admin) {
    const ok = await bcrypt.compare(String((req.body || {}).password || ''), p.photo_password_hash || '');
    if (!ok) return res.status(401).json({ error: 'Wrong photo password' });
  }
  if (p.burn && !admin) await pool.query('DELETE FROM photos WHERE id = $1', [p.id]);
  res.json({ image_data: p.image_data });
}));

app.post('/api/admin/upload', auth('admin'), safe(async (req, res) => {
  const { title, image_data, thumb, is_private, photo_password, hint, burn } = req.body || {};
  if (!title || !String(image_data || '').startsWith('data:image/')) {
    return res.status(400).json({ error: 'Title and image are required' });
  }
  if (is_private && !photo_password) return res.status(400).json({ error: 'Private photos need a password' });
  const hash = is_private ? await bcrypt.hash(String(photo_password), 10) : null;
  await pool.query(
    `INSERT INTO photos (title, image_data, thumb, is_private, photo_password_hash, hint, burn)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [String(title).slice(0, 80), image_data, thumb || null, Boolean(is_private), hash,
     hint ? String(hint).slice(0, 80) : null, Boolean(burn)]
  );
  res.json({ success: true });
}));

app.delete('/api/admin/photos/:id', auth('admin'), safe(async (req, res) => {
  await pool.query('DELETE FROM photos WHERE id = $1', [req.params.id]);
  res.json({ success: true });
}));

app.listen(process.env.PORT || 3000, () => console.log('Vault running'));
