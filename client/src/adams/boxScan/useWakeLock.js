import { useEffect } from "react";

// Keeps the screen awake while `active`, so the iPad does not sleep mid-scan.
// The lock drops whenever the page is hidden, so it is asked for again on return.
const useWakeLock = (active) => {
  useEffect(() => {
    if (!active || !navigator.wakeLock) return undefined;
    let lock = null;
    let stopped = false;
    const take = async () => {
      try {
        if (!stopped && document.visibilityState === "visible") lock = await navigator.wakeLock.request("screen");
      } catch { /* denied: the operator taps now and then */ }
    };
    const onVisible = () => { if (document.visibilityState === "visible") take(); };
    take();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisible);
      if (lock) lock.release().catch(() => {});
    };
  }, [active]);
};

export default useWakeLock;
