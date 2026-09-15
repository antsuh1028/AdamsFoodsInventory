import { useCallback, useMemo, useState } from "react";
import { getLang, saveLang, translator } from "../utils/i18n";

// The language of one window. Held in component state rather than a context
// because only the weighing bench is translated — a provider around the whole
// app would imply the rest of it is, and it is not.
const useLang = () => {
  const [lang, setLang] = useState(getLang);

  const t = useMemo(() => translator(lang), [lang]);

  const toggle = useCallback(() => {
    setLang((current) => {
      const next = current === "en" ? "es" : "en";
      saveLang(next);
      return next;
    });
  }, []);

  return { lang, t, toggle };
};

export default useLang;
