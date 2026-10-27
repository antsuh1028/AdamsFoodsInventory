// Screens that must stay signed in while unattended (a scan station) hold off the idle sign-out.

let holds = 0;

// Takes a hold; returns the function that releases it.
export const holdIdle = () => {
  holds += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds = Math.max(0, holds - 1);
  };
};

export const idleHeld = () => holds > 0;
