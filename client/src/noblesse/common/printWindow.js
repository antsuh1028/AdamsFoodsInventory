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

// A script that shrinks `selector` to fit one page `limitIn` inches tall; rerun once images load and before printing.
export const fitOnePage = (selector, limitIn) => `<script>
  (function () {
    var limit = ${Number(limitIn)} * 96;
    function fit() {
      var el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return;
      el.style.zoom = "";
      // Borders stay at least a pixel when zoomed, so one pass lands short; measure again until it fits.
      for (var z = 1, i = 0; i < 6; i++) {
        var h = el.getBoundingClientRect().height;
        if (h <= limit) break;
        z = z * (limit / h) * 0.995;
        el.style.zoom = String(z);
      }
    }
    fit();
    window.addEventListener("load", fit);
    window.addEventListener("beforeprint", fit);
  })();
</script>`;

// Open a built document in a new tab. Returns false when the popup was
// blocked, which is the caller's only failure case — everything before this is
// string building and cannot throw.
// `opened` is a window already opened on the click, for callers that load data first.
export const printDocument = (html, opened = null) => {
  const win = opened || window.open("", "_blank");
  if (!win) return false;
  // Replaces anything already shown in it, like a loading note.
  win.document.open();
  win.document.write(html);
  win.document.close();
  return true;
};
