/* ==========================================================================
   INDEXEDDB PERSISTENCE LAYER — LOSSLESS WAV BLOBS + MULTI-ACCOUNT ISOLATION
   Schema v3: adds ownerAccountId index on tracks (non-destructive migration).
   ========================================================================== */

const DB_NAME = 'AnalogMasteringPortfolioDB';
const DB_VERSION = 3;

const STORE_TRACKS = 'tracks';
const STORE_AUDIO = 'audioBlobs';
const STORE_SETTINGS = 'settings';
const STORE_ACCOUNTS = 'accounts';

let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db = event.target.result;
      const tx = event.target.transaction;

      let trackStore;
      if (!db.objectStoreNames.contains(STORE_TRACKS)) {
        trackStore = db.createObjectStore(STORE_TRACKS, { keyPath: 'id' });
        trackStore.createIndex('order', 'order', { unique: false });
      } else {
        trackStore = tx.objectStore(STORE_TRACKS);
      }

      if (!trackStore.indexNames.contains('ownerAccountId')) {
        trackStore.createIndex('ownerAccountId', 'ownerAccountId', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_AUDIO)) {
        db.createObjectStore(STORE_AUDIO, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
        db.createObjectStore(STORE_SETTINGS, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORE_ACCOUNTS)) {
        const accStore = db.createObjectStore(STORE_ACCOUNTS, { keyPath: 'id' });
        accStore.createIndex('handle', 'handle', { unique: true });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function txRequest(storeName, mode, operation) {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const store = tx.objectStore(storeName);
        const req = operation(store);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      })
  );
}

/* ---- TRACKS & WAV BLOBS (SCOPED BY ownerAccountId) ---- */
export async function saveTrack(trackMeta, mixBlob, masterBlob) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_TRACKS, STORE_AUDIO], 'readwrite');
    tx.objectStore(STORE_TRACKS).put(trackMeta);
    if (mixBlob) {
      tx.objectStore(STORE_AUDIO).put({
        key: `${trackMeta.id}:mix`,
        blob: mixBlob,
        fileName: trackMeta.mixFileName || 'version-a.wav',
      });
    }
    if (masterBlob) {
      tx.objectStore(STORE_AUDIO).put({
        key: `${trackMeta.id}:master`,
        blob: masterBlob,
        fileName: trackMeta.masterFileName || 'version-b.wav',
      });
    }
    tx.oncomplete = () => resolve(trackMeta);
    tx.onerror = () => reject(tx.error);
  });
}

export async function updateTrackMeta(trackMeta) {
  return txRequest(STORE_TRACKS, 'readwrite', (store) => store.put(trackMeta));
}

export async function getAllTracks() {
  const tracks = await txRequest(STORE_TRACKS, 'readonly', (store) => store.getAll());
  return tracks.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

/**
 * Fetch only tracks owned by a specific producer account ID.
 */
export async function getTracksByOwner(ownerAccountId) {
  const tracks = await txRequest(STORE_TRACKS, 'readonly', (store) =>
    store.index('ownerAccountId').getAll(ownerAccountId)
  );
  return tracks.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

/**
 * Migrate any legacy v1/v2 tracks without ownerAccountId to the default account.
 */
export async function migrateOrphanTracks(defaultOwnerId) {
  const all = await getAllTracks();
  let migrated = 0;
  for (const t of all) {
    if (!t.ownerAccountId) {
      t.ownerAccountId = defaultOwnerId;
      t.trackMode = t.trackMode || 'master';
      t.labelA = t.labelA || 'MIX (Antes)';
      t.labelB = t.labelB || 'MÁSTER (Después)';
      await updateTrackMeta(t);
      migrated++;
    }
  }
  return migrated;
}

export async function getTrackAudioBlobs(trackId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_AUDIO, 'readonly');
    const store = tx.objectStore(STORE_AUDIO);
    const mixReq = store.get(`${trackId}:mix`);
    const masterReq = store.get(`${trackId}:master`);

    let mixRec = null;
    let masterRec = null;
    mixReq.onsuccess = () => { mixRec = mixReq.result; };
    masterReq.onsuccess = () => { masterRec = masterReq.result; };

    tx.oncomplete = () =>
      resolve({
        mixBlob: mixRec?.blob || null,
        masterBlob: masterRec?.blob || null,
      });
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteTrack(trackId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_TRACKS, STORE_AUDIO], 'readwrite');
    tx.objectStore(STORE_TRACKS).delete(trackId);
    tx.objectStore(STORE_AUDIO).delete(`${trackId}:mix`);
    tx.objectStore(STORE_AUDIO).delete(`${trackId}:master`);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/* ---- PRODUCER ACCOUNTS ---- */
export async function saveAccount(account) {
  return txRequest(STORE_ACCOUNTS, 'readwrite', (store) => store.put(account));
}

export async function getAllAccounts() {
  const list = await txRequest(STORE_ACCOUNTS, 'readonly', (store) => store.getAll());
  return list.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
}

export async function deleteAccount(id) {
  return txRequest(STORE_ACCOUNTS, 'readwrite', (store) => store.delete(id));
}

/* ---- SETTINGS & QUOTA ---- */
export async function saveSetting(key, value) {
  return txRequest(STORE_SETTINGS, 'readwrite', (store) => store.put({ key, value }));
}

export async function getSetting(key, fallback = null) {
  const record = await txRequest(STORE_SETTINGS, 'readonly', (store) => store.get(key));
  return record ? record.value : fallback;
}

export async function getStorageInfo() {
  if (!navigator.storage || !navigator.storage.estimate) return null;
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  return {
    usedMB: (usage / (1024 * 1024)).toFixed(1),
    quotaMB: (quota / (1024 * 1024)).toFixed(0),
    percent: quota > 0 ? Math.min(100, (usage / quota) * 100).toFixed(1) : '0',
  };
}
