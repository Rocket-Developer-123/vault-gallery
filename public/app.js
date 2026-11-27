let authToken = null;
let currentRole = null;
let activeImageBase64 = null;
let pendingUnlockPhotoId = null;

// Elements
const loginScreen = document.getElementById('login-screen');
const adminScreen = document.getElementById('admin-screen');
const viewerScreen = document.getElementById('viewer-screen');
const holdOverlay = document.getElementById('hold-overlay');
const holdZone = document.getElementById('hold-zone');
const holdPrompt = document.getElementById('hold-prompt');
const secureCanvas = document.getElementById('secure-canvas');
const ctx = secureCanvas.getContext('2d');

// 1. MAGIC PASSWORD LOGIN
document.getElementById('login-btn').addEventListener('click', async () => {
  const password = document.getElementById('magic-password').value;
  const errorEl = document.getElementById('login-error');
  errorEl.textContent = '';

  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password })
  });

  const data = await res.json();
  if (!res.ok) {
    errorEl.textContent = data.error || 'Access denied';
    return;
  }

  authToken = data.token;
  currentRole = data.role;
  document.getElementById('magic-password').value = '';
  loginScreen.classList.add('hidden');

  if (currentRole === 'admin') {
    adminScreen.classList.remove('hidden');
    loadPhotos();
  } else {
    viewerScreen.classList.remove('hidden');
    loadPhotos();
  }
});

function logout() {
  authToken = null;
  currentRole = null;
  activeImageBase64 = null;
  adminScreen.classList.add('hidden');
  viewerScreen.classList.add('hidden');
  closeHoldOverlay();
  loginScreen.classList.remove('hidden');
}

// 2. LOAD GALLERY
async function loadPhotos() {
  const res = await fetch('/api/photos', {
    headers: { Authorization: `Bearer ${authToken}` }
  });
  const photos = await res.json();

  if (currentRole === 'admin') {
    renderAdminList(photos);
  } else {
    renderViewerList(photos);
  }
}

function renderViewerList(photos) {
  const list = document.getElementById('viewer-photo-list');
  list.innerHTML = '';

  photos.forEach(photo => {
    const card = document.createElement('div');
    card.className = `photo-card ${photo.is_private ? 'locked' : ''}`;
    card.innerHTML = `
      <div class="card-icon">${photo.is_private ? '🔐' : '🖼️'}</div>
      <div class="card-title">${escapeHtml(photo.title)}</div>
      <div class="card-badge">${photo.is_private ? 'Password Required' : 'Tap to Hold & View'}</div>
    `;

    card.addEventListener('click', () => {
      if (photo.is_private) {
        openUnlockModal(photo.id, photo.title);
      } else {
        openHoldOverlay(photo.image_data);
      }
    });

    list.appendChild(card);
  });
}

function renderAdminList(photos) {
  const list = document.getElementById('admin-photo-list');
  list.innerHTML = '';

  photos.forEach(photo => {
    const card = document.createElement('div');
    card.className = `photo-card ${photo.is_private ? 'locked' : ''}`;
    card.innerHTML = `
      <div>
        <div class="card-icon">${photo.is_private ? '🔐' : '🖼️'}</div>
        <div class="card-title">${escapeHtml(photo.title)}</div>
      </div>
      <button class="danger" onclick="deletePhoto(${photo.id})">Delete</button>
    `;
    list.appendChild(card);
  });
}

// 3. PRIVATE PHOTO UNLOCK
function openUnlockModal(id, title) {
  pendingUnlockPhotoId = id;
  document.getElementById('unlock-title').textContent = `🔐 ${title}`;
  document.getElementById('unlock-pass-input').value = '';
  document.getElementById('unlock-error').textContent = '';
  document.getElementById('unlock-modal').classList.remove('hidden');
}

function closeUnlockModal() {
  pendingUnlockPhotoId = null;
  document.getElementById('unlock-modal').classList.add('hidden');
}

document.getElementById('confirm-unlock-btn').addEventListener('click', async () => {
  const password = document.getElementById('unlock-pass-input').value;
  const errEl = document.getElementById('unlock-error');

  const res = await fetch(`/api/photos/${pendingUnlockPhotoId}/unlock`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`
    },
    body: JSON.stringify({ password })
  });

  const data = await res.json();
  if (!res.ok) {
    errEl.textContent = data.error || 'Wrong password';
    return;
  }

  closeUnlockModal();
  openHoldOverlay(data.image_data);
});

// 4. SNAPCHAT PRESS-AND-HOLD VIEWER LOGIC
function openHoldOverlay(base64Data) {
  activeImageBase64 = base64Data;
  hidePhotoOnCanvas();
  holdOverlay.classList.remove('hidden');
}

function closeHoldOverlay() {
  activeImageBase64 = null;
  hidePhotoOnCanvas();
  holdOverlay.classList.add('hidden');
}

function revealPhotoOnCanvas() {
  if (!activeImageBase64) return;
  const img = new Image();
  img.onload = () => {
    secureCanvas.width = img.width;
    secureCanvas.height = img.height;
    ctx.drawImage(img, 0, 0);
    holdPrompt.classList.add('hidden');
    secureCanvas.classList.remove('hidden');
  };
  img.src = activeImageBase64;
}

function hidePhotoOnCanvas() {
  ctx.clearRect(0, 0, secureCanvas.width, secureCanvas.height);
  secureCanvas.classList.add('hidden');
  holdPrompt.classList.remove('hidden');
}

// Touch & Mouse Listeners for Press-and-Hold
holdZone.addEventListener('touchstart', (e) => {
  e.preventDefault();
  // Anti-screenshot: If more than 1 finger touches screen (e.g., 3-finger screenshot swipe), hide immediately!
  if (e.touches.length > 1) {
    hidePhotoOnCanvas();
    return;
  }
  revealPhotoOnCanvas();
}, { passive: false });

holdZone.addEventListener('touchmove', (e) => {
  if (e.touches.length > 1) hidePhotoOnCanvas();
});

holdZone.addEventListener('touchend', () => hidePhotoOnCanvas());
holdZone.addEventListener('touchcancel', () => hidePhotoOnCanvas());

// Desktop fallback testing
holdZone.addEventListener('mousedown', () => revealPhotoOnCanvas());
holdZone.addEventListener('mouseup', () => hidePhotoOnCanvas());
holdZone.addEventListener('mouseleave', () => hidePhotoOnCanvas());

// Hide immediately if user pulls down Android notification bar or switches tabs
document.addEventListener('visibilitychange', () => {
  if (document.hidden) hidePhotoOnCanvas();
});
window.addEventListener('blur', () => hidePhotoOnCanvas());

// 5. ADMIN UPLOAD & IMAGE COMPRESSION
document.getElementById('is-private-check').addEventListener('change', (e) => {
  document.getElementById('private-photo-pass').classList.toggle('hidden', !e.target.checked);
});

document.getElementById('upload-btn').addEventListener('click', async () => {
  const title = document.getElementById('photo-title').value.trim();
  const fileInput = document.getElementById('photo-file');
  const isPrivate = document.getElementById('is-private-check').checked;
  const photoPass = document.getElementById('private-photo-pass').value;
  const statusEl = document.getElementById('upload-status');

  if (!title || !fileInput.files[0]) {
    statusEl.textContent = 'Please add a title and pick a photo.';
    return;
  }

  statusEl.textContent = 'Compressing & uploading...';
  const compressedBase64 = await compressImage(fileInput.files[0], 800, 0.7);

  const res = await fetch('/api/admin/upload', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`
    },
    body: JSON.stringify({
      title,
      image_data: compressedBase64,
      is_private: isPrivate,
      photo_password: photoPass
    })
  });

  if (res.ok) {
    statusEl.textContent = 'Uploaded successfully!';
    document.getElementById('photo-title').value = '';
    fileInput.value = '';
    document.getElementById('private-photo-pass').value = '';
    loadPhotos();
  } else {
    const err = await res.json();
    statusEl.textContent = `Error: ${err.error}`;
  }
});

async function deletePhoto(id) {
  await fetch(`/api/admin/photos/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${authToken}` }
  });
  loadPhotos();
}

// Shrinks phone camera photos on the client before sending to Neon
function compressImage(file, maxWidth, quality) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const scale = Math.min(1, maxWidth / img.width);
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        const c = canvas.getContext('2d');
        c.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));
}
