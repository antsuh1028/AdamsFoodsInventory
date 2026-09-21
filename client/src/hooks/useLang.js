import { useCallback, useMemo, useSyncExternalStore } from "react";
import { getLang, saveLang, translator } from "../utils/i18n";

// One language per device, shared by every screen that reads it — so switching
// on the Outgoing tab also switches the weighing window floating over it.
// Not a context around the app: only the outgoing side is translated, and a
// provider at the root would imply the rest of it is.
let current = getLang();
const listeners = new Set();

const subscribe = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
const snapshot = () => current;

const useLang = () => {
  const lang = useSyncExternalStore(subscribe, snapshot);
  const t = useMemo(() => translator(lang), [lang]);

  const toggle = useCallback(() => {
    current = current === "en" ? "es" : "en";
    saveLang(current);
    listeners.forEach((fn) => fn());
  }, []);

  return { lang, t, toggle };
};

export default useLang;
