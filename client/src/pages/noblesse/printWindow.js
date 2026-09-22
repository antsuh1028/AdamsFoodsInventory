// What every printable in this section shares.
//
// These two were copied into each print*.js file — five byte-identical copies
// of the escape in particular, which is the one thing here that must never
// differ between them: a fix applied to one copy and not the rest leaves the
// others quietly wrong.

// HTML-escape a value for interpolation into a print template.
export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));

// Open a built document in a new tab. Returns false when the popup was
// blocked, which is the caller's only failure case — everything before this is
// string building and cannot throw.
export const printDocument = (html) => {
  const win = window.open("", "_blank");
  if (!win) return false;
  win.document.write(html);
  win.document.close();
  return true;
};
