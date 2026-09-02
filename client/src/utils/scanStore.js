// IndexedDB backend for scanQueue. Deliberately thin: every decision about what
// is safe to delete lives in scanQueue.js, which is unit-tested. This file only
// moves records in and out of storage.
//
// iPad Safari in Private Browsing refuses IndexedDB outright, and a device that
// is out of quota throws on write. Either would otherwise take the whole
// scanning session down, so we fall back to an in-memory store and tell the
// caller durability is degraded rather than failing to open at all.

const DB_NAME = "afdc-box-scans";
const DB_VERSION = 1;
const SCANS = "scans";
const META = "meta";
const SESSION_KEY = "session";

const promisify = (request) =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const openDb = () =>
  new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined" || !indexedDB) {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SCANS)) {
        const store = db.createObjectStore(SCANS, { keyPath: "localId", autoIncrement: true });
        store.createIndex("byStatus", "status", { unique: false });
      }
      if (!db.objectStoreNames.contains(META)) {
        db.createObjectStore(META, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("IndexedDB blocked by another tab"));
  });

const createIndexedDbBackend = (db) => {
  const tx = (storeNames, mode) => db.transaction(storeNames, mode);

  return {
    durable: true,

    getSession: async () => {
      const store = tx(META, "readonly").objectStore(META);
      const row = await promisify(store.get(SESSION_KEY));
      return row ? row.value : null;
    },

    setSession: async (session) => {
      const store = tx(META, "readwrite").objectStore(META);
      await promisify(store.put({ key: SESSION_KEY, value: session }));
    },

    putScan: async (record) => {
      const store = tx(SCANS, "readwrite").objectStore(SCANS);
      return promisify(store.add(record));
    },

    listPending: async () => {
      const index = tx(SCANS, "readonly").objectStore(SCANS).index("byStatus");
      const rows = await promisify(index.getAll("pending"));
      return rows.sort((a, b) => a.localId - b.localId);
    },

    countPending: async () => {
      const index = tx(SCANS, "readonly").objectStore(SCANS).index("byStatus");
      return promisify(index.count("pending"));
    },

    deleteScans: async (localIds) => {
      const store = tx(SCANS, "readwrite").objectStore(SCANS);
      await Promise.all(localIds.map((id) => promisify(store.delete(id))));
    },

    // Confirmed by the server, so out of the flush queue — but kept on disk so
    // the operator's session grid can still show it.
    markSynced: async (localIds) => {
      const store = tx(SCANS, "readwrite").objectStore(SCANS);
      await Promise.all(localIds.map(async (id) => {
        const existing = await promisify(store.get(id));
        if (existing) await promisify(store.put({ ...existing, status: "synced" }));
      }));
    },

    // The same box scanned twice. Kept visible so the operator can see it
    // happened, but not counted as an arriving box.
    markDuplicate: async (localIds) => {
      const store = tx(SCANS, "readwrite").objectStore(SCANS);
      await Promise.all(localIds.map(async (id) => {
        const existing = await promisify(store.get(id));
        if (existing) await promisify(store.put({ ...existing, status: "duplicate" }));
      }));
    },

    listAll: async () => {
      const store = tx(SCANS, "readonly").objectStore(SCANS);
      const rows = await promisify(store.getAll());
      return rows.sort((a, b) => a.localId - b.localId);
    },

    markRejected: async (localId, reason) => {
      const store = tx(SCANS, "readwrite").objectStore(SCANS);
      const existing = await promisify(store.get(localId));
      if (!existing) return;
      await promisify(store.put({ ...existing, status: "rejected", reason }));
    },

    listRejected: async () => {
      const index = tx(SCANS, "readonly").objectStore(SCANS).index("byStatus");
      return promisify(index.getAll("rejected"));
    },

    clearAll: async () => {
      const store = tx(SCANS, "readwrite").objectStore(SCANS);
      await promisify(store.clear());
      const meta = tx(META, "readwrite").objectStore(META);
      await promisify(meta.delete(SESSION_KEY));
    },
  };
};

// Same contract, no persistence. Used only when IndexedDB cannot be opened.
const createMemoryBackend = () => {
  let session = null;
  let nextId = 1;
  const scans = new Map();
  const byStatus = (status) =>
    [...scans.values()].filter((s) => s.status === status).sort((a, b) => a.localId - b.localId);

  return {
    durable: false,
    getSession: async () => session,
    setSession: async (s) => { session = s; },
    putScan: async (record) => {
      const localId = nextId++;
      scans.set(localId, { ...record, localId });
      return localId;
    },
    listPending: async () => byStatus("pending"),
    countPending: async () => byStatus("pending").length,
    listAll: async () => [...scans.values()].sort((a, b) => a.localId - b.localId),
    deleteScans: async (ids) => { ids.forEach((id) => scans.delete(id)); },
    markSynced: async (ids) => {
      ids.forEach((id) => {
        const s = scans.get(id);
        if (s) scans.set(id, { ...s, status: "synced" });
      });
    },
    markDuplicate: async (ids) => {
      ids.forEach((id) => {
        const s = scans.get(id);
        if (s) scans.set(id, { ...s, status: "duplicate" });
      });
    },
    markRejected: async (localId, reason) => {
      const s = scans.get(localId);
      if (s) scans.set(localId, { ...s, status: "rejected", reason });
    },
    listRejected: async () => byStatus("rejected"),
    clearAll: async () => { scans.clear(); session = null; },
  };
};

// Returns a backend plus whether it actually persists. A caller that gets
// durable:false should warn the operator loudly — scans will not survive a
// tab reload in that mode.
const createScanStore = async () => {
  try {
    const db = await openDb();
    return createIndexedDbBackend(db);
  } catch (err) {
    console.warn("IndexedDB unavailable, falling back to memory:", err && err.message);
    return createMemoryBackend();
  }
};

module.exports = { createScanStore, createMemoryBackend, DB_NAME };
