import {
  initFirebase, onSyncStatus, onAuthReady, loginWithGoogle,
  subscribeToSongs, createSong, updateSong, deleteSong,
  uploadAudio, removeAudio,
} from './firebase.js';

// ===== State =====
let songs = [];
let groupBy = 'none';
let searchQuery = '';
let pendingAudio = null;   // { url, path, name, size, contentType } when staged in modal
let pendingAudioFile = null; // local File before upload (set when user picks/drops)
let originalAudioPath = null; // path to delete from Storage when audio is replaced/removed

// ===== DOM =====
const $ = (id) => document.getElementById(id);

const loginScreen = $('login-screen');
const appEl = $('app');
const googleBtn = $('google-login-btn');
const loginError = $('login-error');
const syncStatus = $('sync-status');
const toast = $('toast');
const songsEl = $('songs');
const emptyEl = $('empty-state');
const searchEl = $('search');

// ===== Init =====
function init() {
  initFirebase();

  onSyncStatus((s) => {
    syncStatus.className = 'sync-status ' + s;
    syncStatus.title = s;
  });

  onAuthReady((user) => {
    if (!user) {
      loginScreen.classList.remove('hidden');
      appEl.classList.add('hidden');
      return;
    }
    loginScreen.classList.add('hidden');
    appEl.classList.remove('hidden');
    startApp();
  });

  googleBtn.addEventListener('click', async () => {
    loginError.textContent = '';
    const r = await loginWithGoogle();
    if (r.error === 'unauthorized') loginError.textContent = 'Unauthorized account.';
    else if (r.error) loginError.textContent = r.error;
  });
}

let started = false;
function startApp() {
  if (started) return;
  started = true;

  subscribeToSongs((items) => {
    songs = items;
    refreshDatalists();
    renderSongs();
  });

  setupGroupToggle();
  setupSearch();
  setupSongModal();
  setupViewModal();
  setupModalDismiss();
  setupKeyboard();

  $('open-new-btn').addEventListener('click', () => openSongModal());
}

// ===== Group toggle / search =====
function setupGroupToggle() {
  document.querySelectorAll('#group-toggle button').forEach(btn => {
    btn.addEventListener('click', () => {
      groupBy = btn.dataset.group;
      document.querySelectorAll('#group-toggle button').forEach(b =>
        b.classList.toggle('active', b === btn));
      renderSongs();
    });
  });
}

function setupSearch() {
  searchEl.addEventListener('input', () => {
    searchQuery = searchEl.value.trim().toLowerCase();
    renderSongs();
  });
}

// ===== Render =====
function filteredSongs() {
  if (!searchQuery) return songs;
  return songs.filter(s => {
    const hay = [
      s.title || '',
      stripHtml(s.text || ''),
      s.genre || '',
      s.album || '',
      s.mood || '',
      (s.tags || []).join(' '),
    ].join(' ').toLowerCase();
    return hay.includes(searchQuery);
  });
}

function renderSongs() {
  const items = filteredSongs();
  if (items.length === 0) {
    songsEl.innerHTML = '';
    emptyEl.classList.remove('hidden');
    if (searchQuery) {
      emptyEl.innerHTML = `<p>No songs match "${escapeHtml(searchQuery)}".</p>`;
    } else {
      emptyEl.innerHTML = `<p>No songs yet. Start with the first idea, even a single line.</p>`;
    }
    return;
  }
  emptyEl.classList.add('hidden');
  songsEl.innerHTML = '';

  if (groupBy === 'none') {
    items.forEach(s => songsEl.appendChild(buildSongCard(s)));
    return;
  }

  // Build groups
  const groups = new Map();
  items.forEach(s => {
    const key = (s[groupBy] || '').trim() || '— unfiled —';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  });

  // Sort group names; unfiled goes last
  const names = [...groups.keys()].sort((a, b) => {
    if (a === '— unfiled —') return 1;
    if (b === '— unfiled —') return -1;
    return a.localeCompare(b, undefined, { sensitivity: 'base' });
  });

  names.forEach(name => {
    const list = groups.get(name);
    const group = document.createElement('div');
    group.className = 'song-group';
    group.innerHTML = `
      <div class="song-group-header">
        <span>${escapeHtml(name)}</span>
        <span class="song-group-count">${list.length}</span>
      </div>
      <div class="song-group-items"></div>
    `;
    const itemsEl = group.querySelector('.song-group-items');
    list.forEach(s => itemsEl.appendChild(buildSongCard(s)));
    songsEl.appendChild(group);
  });
}

function buildSongCard(song) {
  const card = document.createElement('div');
  card.className = 'song-card';
  const plain = stripHtml(song.text || '');
  const snippet = plain.slice(0, 220);
  const dateStr = formatDate(song.date);
  const tagsHtml = (song.tags || []).slice(0, 4)
    .map(t => `<span class="song-card-tag">${escapeHtml(t)}</span>`)
    .join('');

  card.innerHTML = `
    <div class="song-card-head">
      <h3 class="song-card-title">${escapeHtml(song.title || 'Untitled')}</h3>
      ${song.audio ? '<span class="song-card-audio-mark" title="Has audio">♪</span>' : ''}
    </div>
    <p class="song-card-snippet">${escapeHtml(snippet)}${plain.length > 220 ? '…' : ''}</p>
    <div class="song-card-foot">
      ${song.genre ? `<span class="pill genre">${escapeHtml(song.genre)}</span>` : ''}
      ${song.album ? `<span class="pill album">${escapeHtml(song.album)}</span>` : ''}
      ${song.mood  ? `<span class="pill mood">${escapeHtml(song.mood)}</span>`  : ''}
      ${tagsHtml}
      <span class="song-card-date">${dateStr}</span>
    </div>
  `;
  card.addEventListener('click', () => openView(song));
  return card;
}

// ===== Datalists (autocomplete from existing values) =====
function refreshDatalists() {
  ['genre', 'album', 'mood'].forEach(field => {
    const dl = $('dl-' + field);
    if (!dl) return;
    const values = [...new Set(songs.map(s => (s[field] || '').trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    dl.innerHTML = values.map(v => `<option value="${escapeHtml(v)}">`).join('');
  });
}

// ===== Date helpers =====
function formatDate(d) {
  if (!d) return '';
  let date;
  if (typeof d === 'string') date = new Date(d);
  else if (d.seconds) date = new Date(d.seconds * 1000);
  else if (d instanceof Date) date = d;
  else return '';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

// ===== Song modal =====
function setupSongModal() {
  // Rich text toolbar
  const editor = $('song-text');
  document.querySelectorAll('.rich-toolbar button[data-cmd]').forEach(btn => {
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', () => {
      editor.focus();
      document.execCommand(btn.dataset.cmd, false);
      updateToolbarState();
    });
  });
  editor.addEventListener('keydown', (e) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    const k = e.key.toLowerCase();
    if (k === 'b') { e.preventDefault(); document.execCommand('bold'); updateToolbarState(); }
    if (k === 'i') { e.preventDefault(); document.execCommand('italic'); updateToolbarState(); }
  });
  editor.addEventListener('keyup', updateToolbarState);
  editor.addEventListener('mouseup', updateToolbarState);

  // Audio drop area
  const drop = $('audio-drop');
  const fileInput = $('audio-file');
  drop.addEventListener('click', () => fileInput.click());
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('drag-over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('drag-over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('drag-over');
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) handleAudioFile(file);
  });
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) handleAudioFile(file);
    fileInput.value = '';
  });

  $('audio-remove').addEventListener('click', () => {
    // Mark existing audio for deletion on save; clear staged file
    pendingAudio = null;
    pendingAudioFile = null;
    renderAudioPreview();
  });

  // Save
  $('song-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = $('song-id').value;
    const title = $('song-title').value.trim() || 'Untitled';
    const text = sanitizeRichHtml(editor.innerHTML);
    const genre = $('song-genre').value.trim();
    const album = $('song-album').value.trim();
    const mood = $('song-mood').value.trim();
    const dateRaw = $('song-date').value;
    const tagsRaw = $('song-tags').value;

    const saveBtn = $('song-save-btn');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';

    try {
      // Upload audio first if there's a new file staged
      let audio = pendingAudio;
      if (pendingAudioFile) {
        showProgress(true);
        audio = await uploadAudio(pendingAudioFile, (pct) => updateProgress(pct));
        showProgress(false);
      }

      // Delete old audio from Storage if it was replaced or removed
      if (originalAudioPath && (!audio || audio.path !== originalAudioPath)) {
        await removeAudio(originalAudioPath);
      }

      const data = {
        title,
        text,
        genre, album, mood,
        date: dateRaw ? new Date(dateRaw) : new Date(),
        tags: tagsRaw.split(',').map(t => t.trim()).filter(Boolean),
        audio: audio || null,
      };

      if (id) {
        await updateSong(id, data);
        showToast('Song updated');
      } else {
        await createSong(data);
        showToast('Song saved');
      }
      closeModal('song-modal');
    } catch (err) {
      console.error(err);
      showToast('Save failed: ' + (err.message || err), 'error');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
      showProgress(false);
    }
  });

  $('song-delete-btn').addEventListener('click', async () => {
    const id = $('song-id').value;
    if (!id) return;
    if (!confirm('Delete this song?')) return;
    const song = songs.find(s => s.id === id);
    if (song && song.audio && song.audio.path) {
      await removeAudio(song.audio.path);
    }
    await deleteSong(id);
    closeModal('song-modal');
    closeModal('view-modal');
    showToast('Deleted');
  });
}

function updateToolbarState() {
  document.querySelectorAll('.rich-toolbar button[data-cmd]').forEach(btn => {
    let active = false;
    try { active = document.queryCommandState(btn.dataset.cmd); } catch {}
    btn.classList.toggle('active', active);
  });
}

function handleAudioFile(file) {
  if (!file.type.startsWith('audio/')) {
    showToast('That doesn\'t look like an audio file.', 'error');
    return;
  }
  const MAX = 25 * 1024 * 1024; // 25 MB safety cap
  if (file.size > MAX) {
    showToast(`File too large (${formatSize(file.size)}). Max ~25 MB.`, 'error');
    return;
  }
  pendingAudioFile = file;
  // Show local preview immediately (before upload)
  pendingAudio = {
    url: URL.createObjectURL(file),
    path: null,
    name: file.name,
    size: file.size,
    contentType: file.type,
    _local: true,
  };
  renderAudioPreview();
}

function renderAudioPreview() {
  const preview = $('audio-preview');
  const drop = $('audio-drop');
  if (!pendingAudio) {
    preview.classList.add('hidden');
    drop.classList.remove('hidden');
    return;
  }
  preview.classList.remove('hidden');
  drop.classList.add('hidden');
  $('audio-player').src = pendingAudio.url;
  $('audio-name').textContent = pendingAudio.name || 'Audio sample';
  $('audio-size').textContent = pendingAudio.size ? formatSize(pendingAudio.size) : '';
}

function showProgress(show) {
  const p = $('audio-progress');
  if (show) p.classList.remove('hidden');
  else { p.classList.add('hidden'); updateProgress(0); }
}
function updateProgress(pct) {
  const v = Math.round(pct * 100);
  $('audio-progress-bar').style.width = v + '%';
  $('audio-progress-pct').textContent = v + '%';
}

function openSongModal(song) {
  $('song-modal-title').textContent = song ? 'Edit song' : 'New song';
  $('song-id').value = song ? song.id : '';
  $('song-title').value = song ? (song.title || '') : '';
  $('song-text').innerHTML = song ? (song.text || '') : '';
  $('song-genre').value = song ? (song.genre || '') : '';
  $('song-album').value = song ? (song.album || '') : '';
  $('song-mood').value = song ? (song.mood || '') : '';
  $('song-tags').value = song && song.tags ? song.tags.join(', ') : '';

  // Date
  const dateInput = $('song-date');
  if (song && song.date) {
    const d = song.date.seconds ? new Date(song.date.seconds * 1000)
      : (typeof song.date === 'string' ? new Date(song.date) : song.date);
    dateInput.value = d.toISOString().slice(0, 10);
  } else {
    dateInput.value = todayIso();
  }

  // Audio state
  pendingAudioFile = null;
  if (song && song.audio) {
    pendingAudio = { ...song.audio };
    originalAudioPath = song.audio.path || null;
  } else {
    pendingAudio = null;
    originalAudioPath = null;
  }
  renderAudioPreview();

  $('song-delete-btn').classList.toggle('hidden', !song);
  openModal('song-modal');
  setTimeout(() => $('song-title').focus(), 50);
}

// ===== View modal =====
function setupViewModal() {
  $('v-edit-btn').addEventListener('click', () => {
    const id = $('view-modal').dataset.songId;
    const song = songs.find(s => s.id === id);
    if (!song) return;
    closeModal('view-modal');
    openSongModal(song);
  });
  $('v-copy-btn').addEventListener('click', async () => {
    const id = $('view-modal').dataset.songId;
    const song = songs.find(s => s.id === id);
    if (!song) return;
    const text = `${song.title || 'Untitled'}\n\n${stripHtml(song.text || '')}`;
    try {
      await navigator.clipboard.writeText(text);
      showToast('Lyrics copied');
    } catch {
      showToast('Copy failed', 'error');
    }
  });
}

function openView(song) {
  const modal = $('view-modal');
  modal.dataset.songId = song.id;
  $('v-title').textContent = song.title || 'Untitled';
  $('v-genre').textContent = song.genre || '';
  $('v-album').textContent = song.album || '';
  $('v-mood').textContent = song.mood || '';
  $('v-date').textContent = formatDate(song.date);

  const tagsEl = $('v-tags');
  tagsEl.innerHTML = (song.tags || []).map(t => `<span>${escapeHtml(t)}</span>`).join('');

  const audioBox = $('v-audio');
  const audio = audioBox.querySelector('audio');
  if (song.audio && song.audio.url) {
    audio.src = song.audio.url;
    audioBox.classList.remove('hidden');
  } else {
    audio.removeAttribute('src');
    audio.load();
    audioBox.classList.add('hidden');
  }

  $('v-text').innerHTML = sanitizeRichHtml(song.text || '');
  openModal('view-modal');
  modal.querySelector('.modal-content').scrollTop = 0;
}

// ===== Modal helpers =====
function setupModalDismiss() {
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => {
      const modal = btn.closest('.modal');
      if (modal) modal.classList.remove('open');
    });
  });
  document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.remove('open');
    });
  });
}
function openModal(id) { $(id).classList.add('open'); }
function closeModal(id) { $(id).classList.remove('open'); }

function setupKeyboard() {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal.open').forEach(m => m.classList.remove('open'));
    }
  });
}

// ===== Utilities =====
function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s == null ? '' : String(s);
  return div.innerHTML;
}

const ALLOWED_TAGS = new Set(['P', 'BLOCKQUOTE', 'H3', 'STRONG', 'B', 'EM', 'I', 'BR', 'A']);
function sanitizeRichHtml(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html || '';
  tmp.querySelectorAll('script, style, iframe').forEach(el => el.remove());
  tmp.querySelectorAll('*').forEach(el => {
    if (!ALLOWED_TAGS.has(el.tagName)) {
      el.replaceWith(...el.childNodes);
      return;
    }
    [...el.attributes].forEach(a => {
      if (el.tagName === 'A' && (a.name === 'href' || a.name === 'target' || a.name === 'rel')) return;
      el.removeAttribute(a.name);
    });
  });
  return tmp.innerHTML;
}

function stripHtml(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html || '';
  return (tmp.textContent || '').replace(/\s+/g, ' ').trim();
}

function formatSize(bytes) {
  if (!bytes) return '';
  const kb = bytes / 1024;
  if (kb < 1024) return Math.round(kb) + ' KB';
  return (kb / 1024).toFixed(1) + ' MB';
}

let toastTimer = null;
function showToast(msg, type = '') {
  toast.textContent = msg;
  toast.className = 'toast show ' + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
}

document.addEventListener('DOMContentLoaded', init);
