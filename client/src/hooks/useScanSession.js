import { useCallback, useEffect, useRef, useState } from "react";
import axiosInstance from "../utils/axiosInstance";
import { createScanQueue } from "../utils/scanQueue";
import { createScanStore } from "../utils/scanStore";

// Wiring only. Every decision about what is safe to delete lives in scanQueue,
// which is unit-tested; this hook owns the browser-side concerns that cannot be
// unit-tested without a device: timers, wake lock, and unload warnings.

const FLUSH_EVERY_SCANS = 5;
const FLUSH_INTERVAL_MS = 4000;

const api = {
  createBatch: (clientUuid, lotNumber) =>
    axiosInstance.post("/box-batches", { clientUuid, lotNumber }).then((r) => r.data),
  postItems: (batchId, items) =>
    axiosInstance.post(`/box-batches/${batchId}/items`, { items }).then((r) => r.data),
  closeBatch: (batchId) =>
    axiosInstance.post(`/box-batches/${batchId}/close`).then((r) => r.data),
};

const newUuid = () =>
  (typeof crypto !== "undefined" && crypto.randomUUID)
    ? crypto.randomUUID()
    // Older iPadOS Safari has crypto but not randomUUID.
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
      });

export const useScanSession = () => {
  const [ready, setReady] = useState(false);
  const [durable, setDurable] = useState(true);
  const [session, setSession] = useState(null);
  const [pending, setPending] = useState(0);
  const [resumable, setResumable] = useState(null);
  const [lastError, setLastError] = useState(null);
  const [stats, setStats] = useState({ count: 0, totals: [] });
  const [lastScan, setLastScan] = useState(null);
  const [scans, setScans] = useState([]);

  const queueRef = useRef(null);
  const wakeLockRef = useRef(null);
  const sinceFlushRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const backend = await createScanStore();
      if (cancelled) return;
      queueRef.current = createScanQueue({ backend, api });
      setDurable(backend.durable !== false);
      setResumable(await queueRef.current.findResumable());
      setPending(await queueRef.current.countPending());
      setReady(true);
    })();
    return () => { cancelled = true; };
  }, []);

  const refreshPending = useCallback(async () => {
    if (!queueRef.current) return;
    setPending(await queueRef.current.countPending());
    setStats(await queueRef.current.getStats());
    setScans(await queueRef.current.listSession());
  }, []);

  const flush = useCallback(async () => {
    if (!queueRef.current) return null;
    const result = await queueRef.current.flush();
    if (result && result.error) setLastError(result.error);
    else if (result && !result.skipped) setLastError(null);
    sinceFlushRef.current = 0;
    await refreshPending();
    return result;
  }, [refreshPending]);

  // Keeping the screen awake matters here: an iPad that locks mid-session
  // suspends timers, so a queue full of unflushed scans just sits there.
  const acquireWakeLock = useCallback(async () => {
    try {
      if (navigator.wakeLock && !wakeLockRef.current) {
        wakeLockRef.current = await navigator.wakeLock.request("screen");
        wakeLockRef.current.addEventListener("release", () => { wakeLockRef.current = null; });
      }
    } catch {
      // Not fatal — a denied wake lock just means the operator must tap
      // occasionally. Never block a scanning session on it.
    }
  }, []);

  const releaseWakeLock = useCallback(async () => {
    try {
      if (wakeLockRef.current) await wakeLockRef.current.release();
    } catch { /* already gone */ }
    wakeLockRef.current = null;
  }, []);

  const start = useCallback(async (lotNumber = null) => {
    if (!queueRef.current) return null;
    // A new session starts from an empty grid — the previous batch is closed
    // and already on the server.
    await queueRef.current.clearSession();
    const opened = await queueRef.current.start(newUuid(), lotNumber);
    setSession(opened);
    setResumable(null);
    await acquireWakeLock();
    await refreshPending();
    return opened;
  }, [acquireWakeLock, refreshPending]);

  const resume = useCallback(async () => {
    if (!queueRef.current) return null;
    const existing = await queueRef.current.findResumable();
    if (!existing) return null;
    setSession(existing);
    setResumable(null);
    await acquireWakeLock();
    await flush();
    return existing;
  }, [acquireWakeLock, flush]);

  const addScan = useCallback(async (scan) => {
    if (!queueRef.current) throw new Error("Scan store not ready");
    await queueRef.current.enqueue(scan);
    setLastScan(scan);
    sinceFlushRef.current += 1;
    await refreshPending();
    if (sinceFlushRef.current >= FLUSH_EVERY_SCANS) flush();
    return scan;
  }, [flush, refreshPending]);

  const undoLast = useCallback(async () => {
    if (!queueRef.current) return { undone: false, reason: "not-ready" };
    const result = await queueRef.current.undoLast();
    if (result.undone) setLastScan(null);
    await refreshPending();
    return result;
  }, [refreshPending]);

  const stop = useCallback(async () => {
    if (!queueRef.current) return null;
    const result = await queueRef.current.stop();
    await refreshPending();
    if (result.closed) {
      setSession(null);
      await releaseWakeLock();
    }
    return result;
  }, [refreshPending, releaseWakeLock]);

  // Time-based flush, so a slow scanner still gets its scans off the device.
  useEffect(() => {
    if (!session) return undefined;
    const id = setInterval(() => { flush(); }, FLUSH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [session, flush]);

  // A wake lock is dropped when the tab is backgrounded; take it again and
  // flush whatever piled up while the screen was off.
  useEffect(() => {
    if (!session) return undefined;
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        acquireWakeLock();
        flush();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [session, acquireWakeLock, flush]);

  useEffect(() => {
    const onBeforeUnload = (e) => {
      if (pending > 0) {
        e.preventDefault();
        e.returnValue = "";
        return "";
      }
      return undefined;
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [pending]);

  useEffect(() => () => { releaseWakeLock(); }, [releaseWakeLock]);

  return {
    ready, durable, session, pending, resumable, lastError, stats, lastScan, scans,
    start, resume, stop, flush, addScan, undoLast,
  };
};

export default useScanSession;
