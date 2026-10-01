// Which floating window is on top. Opening or pressing one moves it to the top.

// Open windows, bottom to top.
const stack = [];
const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn());

export const raise = (id) => {
  if (stack[stack.length - 1] === id) return;
  const i = stack.indexOf(id);
  if (i !== -1) stack.splice(i, 1);
  stack.push(id);
  notify();
};

export const drop = (id) => {
  const i = stack.indexOf(id);
  if (i === -1) return;
  stack.splice(i, 1);
  notify();
};

export const subscribe = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

// Below Chakra's dialogs (1400); a window asking for more stacks in the upper tier.
export const WINDOW_BASE = 1300;
export const TIER = 40;
export const zFor = (id, asked = 1400) =>
  WINDOW_BASE + (asked > 1400 ? TIER : 0) + Math.min(Math.max(0, stack.indexOf(id)), TIER - 1);
