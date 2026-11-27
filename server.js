const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Allow up to 10MB JSON payloads for Base64 compressed images
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_key';
const MASTER_PASS = process.env.MASTER_PASS || 'view123';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123';

// Middleware to verify JWT token and role
function authenticate(requiredRole = null) {
  return (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });

    const token = authHeader.split(' ')[1];
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      if (requiredRole && decoded.role !== requiredRole) {
        return res.status(403).json({ error: 'Admin access required' });
      }
      req.user = decoded;
      next();
    } catch (err) {
      return res.status(401).json({ error: 'Invalid or expired session' });
    }
  };
}

// 1. MAGIC LOGIN ROUTE (Single input decides Viewer vs Admin)
app.post('/api/login', (req, res) => {
  const { password } = req.body;

  if (password === ADMIN_PASS) {
    const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '12h' });
    return res.json({ role: 'admin', token });
  }

  if (password === MASTER_PASS) {
    const token = jwt.sign({ role: 'viewer' }, JWT_SECRET, { expiresIn: '6h' });
    return res.json({ role: 'viewer', token });
  }

  return res.status(401).json({ error: 'Wrong password' });
});

// 2. FETCH GALLERY METADATA (Hides image_data for private photos!)
app.get('/api/photos', authenticate(), async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, title, image_data, is_private, created_at FROM photos ORDER BY created_at DESC'
    );

    const photos = result.rows.map(photo => {
      // If admin, send everything; if viewer & private, hide image_data until unlocked
      if (photo.is_private && req.user.role !== 'admin') {
        return {
          id: photo.id,
          title: photo.title,
          is_private: true,
          image_data: null
        };
      }
      return {
        id: photo.id,
        title: photo.title,
        is_private: photo.is_private,
        image_data: photo.image_data
      };
    });

    res.json(photos);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// 3. UNLOCK INDIVIDUAL PRIVATE PHOTO
app.post('/api/photos/:id/unlock', authenticate(), async (req, res) => {
  const { id } = req.params;
  const { password } = req.body;

  try {
    const result = await pool.query('SELECT * FROM photos WHERE id = $1', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Photo not found' });

    const photo = result.rows[0];
    if (!photo.is_private) return res.json({ image_data: photo.image_data });

    const isMatch = await bcrypt.compare(password || '', photo.photo_password_hash);
    if (!isMatch) return res.status(401).json({ error: 'Incorrect photo password' });

    res.json({ image_data: photo.image_data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// 4. ADMIN UPLOAD PHOTO
app.post('/api/admin/upload', authenticate('admin'), async (req, res) => {
  const { title, image_data, is_private, photo_password } = req.body;

  if (!title || !image_data) {
    return res.status(400).json({ error: 'Title and image are required' });
  }

  try {
    let passwordHash = null;
    if (is_private) {
      if (!photo_password) {
        return res.status(400).json({ error: 'Private photos require a password' });
      }
      passwordHash = await bcrypt.hash(photo_password, 10);
    }

    await pool.query(
      'INSERT INTO photos (title, image_data, is_private, photo_password_hash) VALUES ($1, $2, $3, $4)',
      [title, image_data, Boolean(is_private), passwordHash]
    );

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save photo' });
  }
});

// 5. ADMIN DELETE PHOTO
app.delete('/api/admin/photos/:id', authenticate('admin'), async (req, res) => {
  try {
    await pool.query('DELETE FROM photos WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete photo' });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
