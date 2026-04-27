const _store = new Map();

const cache = {
  get(key) {
    const entry = _store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.exp) { _store.delete(key); return null; }
    return entry.data;
  },
  set(key, data, ttlMs = Infinity) {
    _store.set(key, { data, exp: ttlMs === Infinity ? Infinity : Date.now() + ttlMs });
  },
  del(key) { _store.delete(key); },
  // Remove all keys that start with a given prefix
  delPrefix(prefix) {
    for (const k of _store.keys()) if (k.startsWith(prefix)) _store.delete(k);
  },
};

export default cache;
