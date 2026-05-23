import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.4.0/firebase-app.js';
import {
  getFirestore, collection, addDoc, getDocs, deleteDoc, doc, updateDoc,
  serverTimestamp, onSnapshot, query, orderBy
} from 'https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js';
import {
  getAuth, signInWithPopup, signOut, onAuthStateChanged, GoogleAuthProvider
} from 'https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js';
import {
  getStorage, ref as storageRef, uploadBytesResumable, getDownloadURL, deleteObject
} from 'https://www.gstatic.com/firebasejs/11.4.0/firebase-storage.js';

const ALLOWED_EMAILS = ['gabritupini@gmail.com', 'gabritupini3@gmail.com'];

// Songs live alongside the other journaling apps in the routiner-db project,
// but in a dedicated collection so they never cross-talk with Routiner /
// Life Lessons / Stoa data.
const COL_SONGS = 'cadence_songs';
const STORAGE_PREFIX = 'cadence';

let db, auth, storage;
let syncStatusCallback = null;

export function initFirebase() {
  const app = initializeApp({
    apiKey: "AIzaSyCaOEjgmmCbtl00fYif89iVCO5CewiSoVQ",
    authDomain: "routiner-db.firebaseapp.com",
    projectId: "routiner-db",
    storageBucket: "routiner-db.firebasestorage.app",
    messagingSenderId: "815158931879",
    appId: "1:815158931879:web:8c5cc7ccfed90210068682",
  });
  db = getFirestore(app);
  auth = getAuth(app);
  storage = getStorage(app);
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

// ===== Audio =====
// Returns { url, path, name, size, contentType }.
// onProgress receives 0..1.
// Throws an Error with a human-readable message if Storage isn't reachable or
// the upload stalls for too long.
const STORAGE_TIMEOUT_MS = 90 * 1000;

function translateStorageError(err) {
  const code = err && err.code;
  const msg = err && err.message;
  if (code === 'storage/unauthorized') {
    return new Error('Storage rules deny this upload. Open Firebase Console → Storage → Rules and allow authenticated writes to /cadence/.');
  }
  if (code === 'storage/unauthenticated') {
    return new Error('Not authenticated. Sign out and back in, then retry.');
  }
  if (code === 'storage/quota-exceeded') {
    return new Error('Storage quota exceeded.');
  }
  if (code === 'storage/canceled') {
    return new Error('Upload cancelled.');
  }
  if (code === 'storage/unknown' || /bucket/i.test(msg || '') || /not exist/i.test(msg || '')) {
    return new Error('Storage bucket not reachable. Likely Storage isn\'t enabled yet — open Firebase Console → Storage → Get started on routiner-db.');
  }
  return new Error(msg || 'Upload failed.');
}

export async function uploadAudio(file, onProgress) {
  const safe = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_').slice(-64);
  const path = `${STORAGE_PREFIX}/${Date.now()}_${safe}`;
  const ref = storageRef(storage, path);
  const task = uploadBytesResumable(ref, file, { contentType: file.type || 'audio/mpeg' });

  let timeoutHandle;
  const timeout = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => {
      try { task.cancel(); } catch {}
      reject(new Error('Upload timed out after 90s. Check your connection and that Firebase Storage is enabled.'));
    }, STORAGE_TIMEOUT_MS);
  });

  const upload = new Promise((resolve, reject) => {
    task.on('state_changed',
      (snap) => {
        if (onProgress && snap.totalBytes) onProgress(snap.bytesTransferred / snap.totalBytes);
      },
      (err) => reject(translateStorageError(err)),
      async () => {
        try {
          const url = await getDownloadURL(task.snapshot.ref);
          resolve({
            url,
            path,
            name: file.name,
            size: file.size,
            contentType: file.type || 'audio/mpeg',
          });
        } catch (err) {
          reject(translateStorageError(err));
        }
      }
    );
  });

  try {
    return await Promise.race([upload, timeout]);
  } finally {
    clearTimeout(timeoutHandle);
  }
}

export async function removeAudio(path) {
  if (!path) return;
  try {
    await deleteObject(storageRef(storage, path));
  } catch (err) {
    // ignore not-found; surface anything else
    if (err.code !== 'storage/object-not-found') console.warn('removeAudio', err);
  }
}
