import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.4.0/firebase-app.js';
import {
  getFirestore, collection, addDoc, deleteDoc, doc, updateDoc,
  serverTimestamp, onSnapshot, query, orderBy
} from 'https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js';
import {
  getAuth, signInWithPopup, signOut, onAuthStateChanged, GoogleAuthProvider
} from 'https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js';

const ALLOWED_EMAILS = ['gabritupini@gmail.com', 'gabritupini3@gmail.com'];

// Cadence has its own dedicated Firebase project (cadence-db) so the
// collection name no longer needs the cadence_ prefix.
const COL_SONGS = 'songs';

// Audio files are served from the GitHub repo's /audio/ folder (no Firebase
// Storage). We expose the repo here so the modal can fetch the file listing
// from the GitHub API.
export const REPO_OWNER = 'gabrieletupini';
export const REPO_NAME = 'cadence';

let db, auth;
let syncStatusCallback = null;

export function initFirebase() {
  const app = initializeApp({
    apiKey: "AIzaSyBQ2eNlMQZsPFlJRvRJBjRmYUYZdOzA5cY",
    authDomain: "cadence-db.firebaseapp.com",
    projectId: "cadence-db",
    storageBucket: "cadence-db.firebasestorage.app",
    messagingSenderId: "1083457776149",
    appId: "1:1083457776149:web:22307b5864c1c0f343fc1c",
  });
  db = getFirestore(app);
  auth = getAuth(app);
}

export function onAuthReady(callback) {
  onAuthStateChanged(auth, (user) => {
    if (user && ALLOWED_EMAILS.includes(user.email)) callback(user);
    else if (user) { signOut(auth); callback(null); }
    else callback(null);
  });
}

export async function loginWithGoogle() {
  try {
    const result = await signInWithPopup(auth, new GoogleAuthProvider());
    if (!ALLOWED_EMAILS.includes(result.user.email)) {
      await signOut(auth);
      return { error: 'unauthorized' };
    }
    return { user: result.user };
  } catch (err) {
    return { error: err.message };
  }
}

export async function logout() { await signOut(auth); }

export function onSyncStatus(cb) { syncStatusCallback = cb; }
function emit(s) { if (syncStatusCallback) syncStatusCallback(s); }

// ===== Songs =====
export function subscribeToSongs(callback) {
  emit('connecting');
  return onSnapshot(
    query(collection(db, COL_SONGS), orderBy('date', 'desc')),
    (snap) => {
      emit('synced');
      callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    },
    (err) => {
      console.error('subscribeToSongs', err);
      emit('error');
    }
  );
}

export async function createSong(data) {
  emit('syncing');
  const ref = await addDoc(collection(db, COL_SONGS), {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  emit('synced');
  return ref.id;
}

export async function updateSong(id, data) {
  emit('syncing');
  await updateDoc(doc(db, COL_SONGS, id), {
    ...data,
    updatedAt: serverTimestamp(),
  });
  emit('synced');
}

export async function deleteSong(id) {
  emit('syncing');
  await deleteDoc(doc(db, COL_SONGS, id));
  emit('synced');
}

// ===== GitHub /audio/ listing =====
// Fetches the file list under the repo's /audio/ folder via the GitHub API.
// Returns array of { name, downloadUrl } for browser-playable audio files.
const AUDIO_EXT = /\.(mp3|m4a|wav|ogg|opus|flac|aac)$/i;
export async function listRepoAudio() {
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/audio`;
  const r = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } });
  if (!r.ok) throw new Error(`GitHub API ${r.status}: ${r.statusText}`);
  const items = await r.json();
  if (!Array.isArray(items)) return [];
  return items
    .filter(i => i.type === 'file' && AUDIO_EXT.test(i.name))
    .map(i => ({ name: i.name, downloadUrl: i.download_url }));
}
