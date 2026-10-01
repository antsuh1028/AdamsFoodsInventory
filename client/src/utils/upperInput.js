// Capitalises what was typed without throwing the cursor to the end.
// Replacing a controlled input's value moves the caret to the end, so the
// field is corrected in place first, caret restored, and React then sees no
// change to apply.
export const upperInput = (e) => {
  const el = e.target;
  const typed = el.value;
  const up = typed.toUpperCase();
  // Only when something changed: number and date inputs refuse selection calls.
  if (up !== typed) {
    const { selectionStart, selectionEnd } = el;
    el.value = up;
    try { el.setSelectionRange(selectionStart, selectionEnd); } catch { /* not a text field */ }
  }
  return up;
};

export default upperInput;
