import { useEffect, useMemo, useRef } from "react";
import { createScanAssembler } from "../../utils/scanInput";
import { parseGs1 } from "../../utils/gs1";

// Listens for the Bluetooth scanner, which types like a keyboard, while `active`.
// Calls onScan with { type: "scan", raw, parsed } or { type: "reject", code, reason }.
// Keys typed into a field are left alone, so the setup form still works.
const useBarcodeKeys = (active, onScan) => {
  const assembler = useMemo(() => createScanAssembler({ parse: parseGs1 }), []);
  const handler = useRef(onScan);
  handler.current = onScan;

  useEffect(() => {
    if (!active) return undefined;
    assembler.reset();
    const onKeyDown = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (e.key === "Enter" || e.key === "Tab") e.preventDefault();
      const result = assembler.handleKey(e);
      if (result) handler.current(result);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [active, assembler]);
};

export default useBarcodeKeys;
