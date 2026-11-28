const $ = id => document.getElementById(id);
const HIDE_MS = 15000; // photo hides itself after 15 seconds of holding
let token = null, me = {}, current = null, loaded = null, timer = null;

async function api(url, method = 'GET', body) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

const showScreen = id => ['login', 'admin', 'viewer'].forEach(s => $(s).classList.toggle('hidden', s !== id));

async function login() {
  $('login-err').textContent = '';
  try {
    me = await api('/api/login', 'POST', { password: $('pw').value });
    token = me.token;
    $('pw').value = '';
    $('hello').textContent = 'Hi ' + me.name;
    showScreen(me.role === 'admin' ? 'admin' : 'viewer');
    await loadPhotos();
  } catch (e) { $('login-err').textContent = e.message; }
}

async function loadPhotos() {
  const admin = me.role === 'admin';
  const photos = await api('/api/photos');
  const list = admin ? $('admin-list') : $('grid');
  list.replaceChildren(...photos.map(p => tile(p, admin)));
  if (!photos.length) list.textContent = 'No photos yet.';
}

function tile(p, admin) {
  const t = document.createElement('div');
  t.className = 'tile' + (p.is_private && !admin ? ' locked' : '');
  const box = document.createElement('div');
  box.className = 'pic';
  if (p.thumb) { const i = new Image(); i.src = p.thumb; box.append(i); }
  else box.textContent = p.is_private ? '🔒' : '🖼️';
  const info = document.createElement('div');
  info.className = 'info';
  info.textContent = p.title;
  const tags = [p.is_private && 'Private', p.burn && 'Burns after view'].filter(Boolean).join(', ');
  if (tags) { const s = document.createElement('small'); s.textContent = tags; info.append(s); }
  t.append(box, info);
  if (admin) {
    const b = document.createElement('button');
    b.className = 'danger';
    b.textContent = 'Delete';
    b.onclick = async () => { await api('/api/admin/photos/' + p.id, 'DELETE'); loadPhotos(); };
    t.append(b);
  } else t.onclick = () => openCard(p);
  return t;
}

// ---------- open a photo ----------
function openCard(p) {
  current = p;
  $('m-title').textContent = p.title;
  $('m-note').textContent = [p.hint && 'Hint: ' + p.hint, p.burn && 'This photo disappears after you view it.'].filter(Boolean).join(' ');
  $('m-pw').classList.toggle('hidden', !p.is_private);
  $('m-pw').value = '';
  $('m-err').textContent = '';
  $('modal').classList.remove('hidden');
}

async function openPhoto() {
  try {
    const d = await api('/api/photos/' + current.id + '/view', 'POST', { password: $('m-pw').value });
    const im = new Image();
    im.src = d.image_data;
    await im.decode();
    loaded = im;
    $('modal').classList.add('hidden');
    $('hold').classList.remove('hidden');
  } catch (e) { $('m-err').textContent = e.message; }
}

// ---------- press and hold viewer ----------
const cv = $('canvas'), zone = $('zone');

function reveal() {
  if (!loaded) return;
  const w = cv.width = loaded.naturalWidth, h = cv.height = loaded.naturalHeight;
  const c = cv.getContext('2d');
  c.drawImage(loaded, 0, 0);
  // watermark: viewer name + time, tiled diagonally
  c.save();
  c.globalAlpha = 0.25; c.fillStyle = '#fff'; c.shadowColor = '#000'; c.shadowBlur = 4;
  c.font = 'bold ' + Math.round(w / 20) + 'px sans-serif';
  const label = me.name + ' ' + new Date().toLocaleTimeString();
  c.rotate(-Math.PI / 6);
  for (let y = -w; y < w + h; y += w / 6) for (let x = -h; x < w + h; x += w * 0.8) c.fillText(label, x, y);
  c.restore();
  cv.classList.remove('hidden');
  $('prompt').classList.add('hidden');
  clearTimeout(timer);
  timer = setTimeout(hide, HIDE_MS);
}

function hide() {
  clearTimeout(timer);
  cv.getContext('2d').clearRect(0, 0, cv.width, cv.height);
  cv.classList.add('hidden');
  $('prompt').classList.remove('hidden');
}

zone.addEventListener('touchstart', e => { e.preventDefault(); e.touches.length > 1 ? hide() : reveal(); }, { passive: false });
['touchend', 'touchcancel'].forEach(t => zone.addEventListener(t, hide));
zone.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('visibilitychange', () => document.hidden && hide());
['blur', 'pagehide', 'resize'].forEach(t => window.addEventListener(t, hide));

$('close-hold').onclick = () => { hide(); loaded = null; $('hold').classList.add('hidden'); loadPhotos(); };
$('m-ok').onclick = openPhoto;
$('m-cancel').onclick = () => $('modal').classList.add('hidden');

// ---------- admin upload ----------
async function shrink(file, max, type, quality) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL(type, quality);
}

$('private').onchange = e => $('private-fields').classList.toggle('hidden', !e.target.checked);

$('upload-btn').onclick = async () => {
  const f = $('file').files[0], title = $('title').value.trim(), msg = $('upload-msg');
  if (!f || !title) { msg.className = 'error'; msg.textContent = 'Add a title and a photo.'; return; }
  try {
    msg.className = 'status'; msg.textContent = 'Uploading...';
    await api('/api/admin/upload', 'POST', {
      title,
      image_data: await shrink(f, 1400, 'image/webp', 0.8),
      thumb: await shrink(f, 32, 'image/jpeg', 0.6),
      is_private: $('private').checked, photo_password: $('photo-pw').value,
      hint: $('hint').value.trim(), burn: $('burn').checked
    });
    msg.textContent = 'Uploaded.';
    ['title', 'file', 'photo-pw', 'hint'].forEach(i => { $(i).value = ''; });
    loadPhotos();
  } catch (e) { msg.className = 'error'; msg.textContent = e.message; }
};

$('login-btn').onclick = login;
$('pw').addEventListener('keydown', e => e.key === 'Enter' && login());
['exit-admin', 'exit-viewer'].forEach(i => { $(i).onclick = () => location.reload(); });
