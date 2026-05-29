import {
  initFirebase, onSyncStatus, onAuthReady, loginWithGoogle, logout,
  subscribeToSongs, createSong, updateSong, deleteSong,
  listRepoAudio,
} from './firebase.js';

// ===== State =====
let songs = [];
let groupBy = 'none';
let searchQuery = '';
let pendingAudio = null;   // { url, name } resolved from the URL/filename field, or null
let repoAudioCache = null; // [{ name, downloadUrl }] from GitHub API, lazily loaded
let readOnly = false;

// Mini-player state. The queue is a snapshot of song IDs taken at play time
// from the currently visible group, so the album order is whatever you see.
const player = {
  audio: new Audio(),
  queue: [],
  currentIdx: -1,
  autoplay: true,
};
player.audio.preload = 'metadata';

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
    if (user) {
      readOnly = false;
      document.body.classList.remove('read-only');
      const banner = $('readonly-banner');
      if (banner) banner.classList.add('hidden');
      loginScreen.classList.add('hidden');
      appEl.classList.remove('hidden');
      startApp();
      return;
    }
    if (!readOnly) {
      loginScreen.classList.remove('hidden');
      appEl.classList.add('hidden');
    }
  });

  googleBtn.addEventListener('click', async () => {
    loginError.textContent = '';
    const r = await loginWithGoogle();
    if (r.error === 'unauthorized') loginError.textContent = 'Unauthorized account.';
    else if (r.error) loginError.textContent = r.error;
  });

  const readonlyBtn = $('readonly-btn');
  if (readonlyBtn) {
    readonlyBtn.addEventListener('click', () => {
      readOnly = true;
      document.body.classList.add('read-only');
      const banner = $('readonly-banner');
      if (banner) banner.classList.remove('hidden');
      loginScreen.classList.add('hidden');
      appEl.classList.remove('hidden');
      startApp();
    });
  }
  const bannerSignin = $('readonly-banner-signin');
  if (bannerSignin) {
    bannerSignin.addEventListener('click', (e) => { e.preventDefault(); window.location.reload(); });
  }
  const logoutBtn = $('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      logoutBtn.disabled = true;
      logoutBtn.textContent = 'Signing out…';
      try { await logout(); } catch (err) { console.error('signOut failed:', err); }
      window.location.reload();
    });
  }
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
  setupMiniPlayer();
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

  const hasAudio = !!(song.audio && song.audio.url);
  const isCurrent = player.queue[player.currentIdx] === song.id;
  const isPlaying = isCurrent && !player.audio.paused;

  card.innerHTML = `
    <div class="song-card-head">
      <h3 class="song-card-title">${escapeHtml(song.title || 'Untitled')}</h3>
      ${hasAudio ? `<button class="song-card-play${isPlaying ? ' playing' : ''}" data-song-id="${song.id}" title="${isPlaying ? 'Pause' : 'Play'}">${isPlaying ? '❚❚' : '▶'}</button>` : ''}
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

  if (hasAudio) {
    const playBtn = card.querySelector('.song-card-play');
    playBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (player.queue[player.currentIdx] === song.id) {
        // Same song — toggle play/pause
        togglePlay();
      } else {
        // Different song — start it (and build queue from current visible group)
        playSong(song.id);
      }
    });
  }

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

  // Audio URL input — on change, update pending audio + preview
  const urlInput = $('song-audio-url');
  urlInput.addEventListener('input', () => {
    const raw = urlInput.value.trim();
    pendingAudio = raw ? resolveAudioRef(raw) : null;
    renderAudioPreview();
  });

  // Browse files in the repo's /audio/ folder
  $('browse-audio').addEventListener('click', openRepoAudioBrowser);

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
      const data = {
        title,
        text,
        genre, album, mood,
        date: dateRaw ? new Date(dateRaw) : new Date(),
        tags: tagsRaw.split(',').map(t => t.trim()).filter(Boolean),
        audio: pendingAudio || null,
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
    }
  });

  $('song-delete-btn').addEventListener('click', async () => {
    const id = $('song-id').value;
    if (!id) return;
    if (!confirm('Delete this song?')) return;
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

// Resolve a user-typed reference (either a bare filename like "demo.mp3" or a
// full URL) into the { url, name } shape we persist on the song doc. Relative
// filenames are anchored at the deployed site's /audio/ folder.
function resolveAudioRef(raw) {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    const name = decodeURIComponent(trimmed.split('/').pop() || trimmed);
    return { url: trimmed, name };
  }
  const filename = trimmed.replace(/^\/?audio\//, '');
  return { url: `audio/${filename}`, name: filename };
}

function renderAudioPreview() {
  const preview = $('audio-preview');
  if (!pendingAudio || !pendingAudio.url) {
    preview.classList.add('hidden');
    const audio = $('audio-player');
    if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); }
    return;
  }
  preview.classList.remove('hidden');
  $('audio-player').src = pendingAudio.url;
  $('audio-name').textContent = pendingAudio.name || pendingAudio.url;
}

// ===== Browse repo /audio/ folder =====
async function openRepoAudioBrowser() {
  const listEl = $('audio-browse-list');
  if (listEl.classList.contains('open')) { closeRepoAudioBrowser(); return; }

  listEl.classList.remove('hidden');
  listEl.classList.add('open');
  listEl.innerHTML = '<div class="browse-loading">Loading /audio/ from GitHub…</div>';

  try {
    if (!repoAudioCache) repoAudioCache = await listRepoAudio();
    if (repoAudioCache.length === 0) {
      listEl.innerHTML = `
        <div class="browse-empty">
          /audio/ is empty. Drop files into the folder in the repo, commit, push.
          <button type="button" id="browse-refresh" class="btn-secondary btn-sm">Refresh</button>
        </div>
      `;
    } else {
      listEl.innerHTML = `
        <div class="browse-head">
          <span>${repoAudioCache.length} file${repoAudioCache.length === 1 ? '' : 's'} in /audio/</span>
          <button type="button" id="browse-refresh" class="browse-link">Refresh</button>
        </div>
        <ul class="browse-items">
          ${repoAudioCache.map(f => `<li data-name="${escapeHtml(f.name)}">${escapeHtml(f.name)}</li>`).join('')}
        </ul>
      `;
      listEl.querySelectorAll('.browse-items li').forEach(li => {
        li.addEventListener('click', () => {
          const name = li.dataset.name;
          $('song-audio-url').value = name;
          $('song-audio-url').dispatchEvent(new Event('input'));
          closeRepoAudioBrowser();
        });
      });
    }
    const refresh = $('browse-refresh');
    if (refresh) refresh.addEventListener('click', async (e) => {
      e.preventDefault();
      repoAudioCache = null;
      await openRepoAudioBrowser();
      if (!listEl.classList.contains('open')) await openRepoAudioBrowser();
    });
  } catch (err) {
    listEl.innerHTML = `<div class="browse-empty error">Couldn't read /audio/: ${escapeHtml(err.message || err)}</div>`;
  }
}

function closeRepoAudioBrowser() {
  const listEl = $('audio-browse-list');
  listEl.classList.add('hidden');
  listEl.classList.remove('open');
}

function openSongModal(song) {
  if (readOnly) return;
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

  // Audio state — populate the URL field from the song's saved audio
  if (song && song.audio && song.audio.url) {
    pendingAudio = { url: song.audio.url, name: song.audio.name || song.audio.url };
    // If the URL is the repo-relative form, show just the filename for editing
    $('song-audio-url').value = song.audio.url.startsWith('audio/')
      ? song.audio.url.slice('audio/'.length)
      : song.audio.url;
  } else {
    pendingAudio = null;
    $('song-audio-url').value = '';
  }
  renderAudioPreview();
  closeRepoAudioBrowser();

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

// ===== Mini player =====
function setupMiniPlayer() {
  // Sync UI on every audio event
  player.audio.addEventListener('timeupdate', updatePlayerProgress);
  player.audio.addEventListener('loadedmetadata', updatePlayerProgress);
  player.audio.addEventListener('play', () => updatePlayUI(true));
  player.audio.addEventListener('pause', () => updatePlayUI(false));
  player.audio.addEventListener('ended', onTrackEnded);
  player.audio.addEventListener('error', () => {
    showToast('Playback error.', 'error');
  });

  $('mp-play').addEventListener('click', togglePlay);
  $('mp-prev').addEventListener('click', () => playOffset(-1));
  $('mp-next').addEventListener('click', () => playOffset(+1));
  $('mp-autoplay').addEventListener('click', toggleAutoplay);
  $('mp-close').addEventListener('click', closePlayer);

  // Default autoplay on, reflect in UI
  $('mp-autoplay').classList.toggle('active', player.autoplay);

  // Seek via slider
  const seek = $('mp-seek');
  seek.addEventListener('input', () => {
    if (player.audio.duration && isFinite(player.audio.duration)) {
      const pct = parseInt(seek.value, 10) / 1000;
      player.audio.currentTime = pct * player.audio.duration;
    }
  });
}

function buildQueueFrom(songId) {
  // If grouping is active and the song belongs to a group, queue = same group.
  // Otherwise queue = the full filtered list. Only songs with audio.
  const visible = filteredSongs().filter(s => s.audio && s.audio.url);
  const song = songs.find(s => s.id === songId);
  if (!song) return [];
  if (groupBy !== 'none' && song[groupBy]) {
    return visible.filter(s => s[groupBy] === song[groupBy]).map(s => s.id);
  }
  return visible.map(s => s.id);
}

function playSong(songId) {
  player.queue = buildQueueFrom(songId);
  const idx = player.queue.indexOf(songId);
  if (idx === -1) {
    // Song wasn't in the visible queue (e.g. no audio match) — just play it alone
    player.queue = [songId];
    player.currentIdx = 0;
  } else {
    player.currentIdx = idx;
  }
  loadCurrent(true);
  showPlayer();
}

function loadCurrent(autoStart = false) {
  const id = player.queue[player.currentIdx];
  const song = songs.find(s => s.id === id);
  if (!song || !song.audio || !song.audio.url) return;
  player.audio.src = song.audio.url;
  updateContextUI(song);
  if (autoStart) {
    player.audio.play().catch(err => {
      console.error('play() failed', err);
      showToast('Cannot play: ' + (err.message || err), 'error');
    });
  }
  // Re-render cards so the playing one shows ❚❚ and the previous one resets
  renderSongs();
}

function updateContextUI(song) {
  $('mp-title').textContent = song.title || 'Untitled';
  let ctx;
  if (groupBy !== 'none' && song[groupBy]) {
    ctx = `${groupBy}: ${song[groupBy]} · ${player.currentIdx + 1} / ${player.queue.length}`;
  } else if (player.queue.length > 1) {
    ctx = `track ${player.currentIdx + 1} / ${player.queue.length}`;
  } else {
    ctx = song.album || song.genre || song.mood || 'single track';
  }
  $('mp-context').textContent = ctx;
}

function togglePlay() {
  if (player.queue.length === 0) return;
  if (player.audio.paused) {
    player.audio.play().catch(err => console.error(err));
  } else {
    player.audio.pause();
  }
}

function playOffset(delta) {
  if (player.queue.length === 0) return;
  player.currentIdx = (player.currentIdx + delta + player.queue.length) % player.queue.length;
  loadCurrent(true);
}

function onTrackEnded() {
  if (player.autoplay && player.queue.length > 1) {
    // Auto-advance, but stop at the end of the queue (don't loop)
    if (player.currentIdx < player.queue.length - 1) {
      playOffset(+1);
    } else {
      updatePlayUI(false);
    }
  } else {
    updatePlayUI(false);
  }
}

function toggleAutoplay() {
  player.autoplay = !player.autoplay;
  $('mp-autoplay').classList.toggle('active', player.autoplay);
  showToast(player.autoplay ? 'Autoplay on' : 'Autoplay off');
}

function closePlayer() {
  player.audio.pause();
  player.audio.removeAttribute('src');
  player.audio.load();
  player.queue = [];
  player.currentIdx = -1;
  $('mini-player').classList.add('hidden');
  document.body.classList.remove('player-open');
  renderSongs();
}

function showPlayer() {
  $('mini-player').classList.remove('hidden');
  document.body.classList.add('player-open');
}

function updatePlayerProgress() {
  const d = player.audio.duration;
  const t = player.audio.currentTime;
  if (!d || !isFinite(d)) {
    $('mp-time-cur').textContent = '0:00';
    $('mp-time-dur').textContent = '0:00';
    return;
  }
  const pct = (t / d) * 1000;
  const seek = $('mp-seek');
  seek.value = pct;
  seek.style.setProperty('--pct', (pct / 10) + '%');
  $('mp-time-cur').textContent = formatTime(t);
  $('mp-time-dur').textContent = formatTime(d);
}

function updatePlayUI(playing) {
  const btn = $('mp-play');
  btn.textContent = playing ? '❚❚' : '▶';
  btn.classList.toggle('playing', playing);
  const currentId = player.queue[player.currentIdx];
  document.querySelectorAll('.song-card-play').forEach(b => {
    const isThis = b.dataset.songId === currentId;
    b.classList.toggle('playing', isThis && playing);
    b.textContent = (isThis && playing) ? '❚❚' : '▶';
  });
}

function formatTime(s) {
  if (!s || !isFinite(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
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

let toastTimer = null;
function showToast(msg, type = '') {
  toast.textContent = msg;
  toast.className = 'toast show ' + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
}

document.addEventListener('DOMContentLoaded', init);
