// Reads a bench-scale indicator over the Web Serial API.
//
// WHY SERIAL AND NOT A KEYBOARD WEDGE. A wedge types into whatever has focus,
// and this app already carries a scar from exactly that: the global keydown
// handler in boxScanner.jsx has to ignore INPUT/TEXTAREA/SELECT because a
// focused field silently swallows scans. A serial port cannot type into
// anything, so a stray focus cannot eat a weight or scatter digits into a note.
//
// The trade is that Web Serial is Chrome/Edge on desktop only — no iOS, no
// Safari. That is fine for a fixed weighing station and nowhere else, so
// isSupported() is checked before any of this is offered.

// Ohaus indicators ship at 9600 8-N-1 by default. Every one of these is
// settable on the device, so they are parameters rather than constants — if the
// unit in the warehouse was configured differently, this is what changes.
const DEFAULT_PORT_OPTIONS = {
  baudRate: 9600,
  dataBits: 8,
  stopBits: 1,
  parity: "none",
  flowControl: "none",
};

const isSupported = () =>
  typeof navigator !== "undefined" && "serial" in navigator;

// Ports this browser has already been granted for this origin.
//
// Exposed so a caller can say "reconnecting to the remembered port" rather than
// silently doing something the operator did not ask for, and so a settings
// screen could offer to forget one.
const rememberedPorts = async () =>
  (isSupported() ? navigator.serial.getPorts() : Promise.resolve([]));

// Hand the port back to Windows.
//
// A serial port is EXCLUSIVE and nothing releases it politely: the handle lives
// until the owning process exits or closes it. A tab left holding COM2 is why a
// later session gets access-denied and why the fix looks like "restart
// everything". Releasing on every exit path is the app's share of not causing
// that.
const releaseAll = async () => {
  if (!isSupported()) return;
  const ports = await navigator.serial.getPorts();
  await Promise.all(ports.map((p) => p.close().catch(() => {})));
};

/**
 * Splits a stream of arbitrary chunks into whole lines.
 *
 * THE POINT OF THIS BEING SEPARATE AND PURE. Serial delivers bytes when it
 * feels like it, not a reading at a time: "12.3" and "45 lb\r\n" routinely
 * arrive as two chunks, and a reader that treats each chunk as a line records
 * 12.3 lb for a 12.345 lb box — a plausible, wrong weight, which is the one
 * outcome that must never happen silently. So the remainder is carried and only
 * completed lines are emitted.
 *
 * Returns { lines, rest }. Feed `rest` back in as `carry` on the next chunk.
 */
const splitLines = (carry, chunk) => {
  const buffer = `${carry || ""}${chunk || ""}`;
  // \r\n, \n and bare \r are all in use across indicator firmware.
  const parts = buffer.split(/\r\n|\n|\r/);
  const rest = parts.pop();          // may be a partial line, or "" after a terminator
  return { lines: parts.filter((l) => l.trim() !== ""), rest };
};

/**
 * Opens a port and streams decoded lines to onLine.
 *
 * requestPort() MUST be called from a user gesture — the browser refuses
 * otherwise — so this is wired to a button, never to an effect on mount.
 * Permission persists per origin once granted, so it is asked once.
 *
 * Returns a handle with disconnect(). Errors go to onError rather than
 * throwing into a click handler.
 */
const connectScale = async ({
  onLine,
  onError = () => {},
  onDisconnect = () => {},
  portOptions = {},
} = {}) => {
  if (!isSupported()) {
    throw new Error("This browser cannot talk to a serial device. Use Chrome or Edge on the desktop.");
  }

  // Reuse a port this browser has already been granted rather than asking
  // again.
  //
  // getPorts() returns what the user has previously approved for this origin,
  // and the grant survives a reload. Reusing it means the operator is not
  // presented with a chooser every session — which is not just friction: the
  // chooser is where COM1 gets picked by mistake, and COM1 is BarTender's. A
  // wrong pick there denies BarTender its port and the whole chain falls over.
  //
  // Only when exactly ONE port is remembered, though. With several there is no
  // way to tell which is which — Web Serial exposes a USB vendor/product id,
  // not a COM number — so guessing would be the same mistake automated.
  const remembered = await navigator.serial.getPorts();
  const port = remembered.length === 1
    ? remembered[0]
    : await navigator.serial.requestPort();

  try {
    await port.open({ ...DEFAULT_PORT_OPTIONS, ...portOptions });
  } catch (err) {
    // "Failed to open serial port" covers every reason, and the commonest by
    // far is that something else already holds it. Name the likely culprit,
    // because the browser will not.
    const busy = /open|access|denied|busy|in use/i.test(err.message || "");
    if (busy) {
      const e = new Error(
        "That port is already in use. COM1 belongs to BarTender — this app reads " +
        "COM2. If it is the right port, close whatever else has it open."
      );
      e.cause = err;
      throw e;
    }
    throw err;
  }

  let stopped = false;
  let reader = null;

  const stop = async () => {
    if (stopped) return;
    stopped = true;
    try { if (reader) await reader.cancel(); } catch { /* already gone */ }
    try { await port.close(); } catch { /* already closed */ }
    onDisconnect();
  };

  // The read loop runs detached. Every failure inside it has to reach onError:
  // an exception here would otherwise be an unhandled rejection and the station
  // would look connected while silently reading nothing.
  (async () => {
    const decoder = new TextDecoder();
    let carry = "";
    try {
      while (!stopped && port.readable) {
        reader = port.readable.getReader();
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            // stream: true so a multi-byte character split across chunks is not
            // mangled into a replacement character.
            const text = decoder.decode(value, { stream: true });
            const { lines, rest } = splitLines(carry, text);
            carry = rest;
            for (const line of lines) onLine(line);
          }
        } finally {
          try { reader.releaseLock(); } catch { /* nothing to release */ }
          reader = null;
        }
      }
    } catch (err) {
      if (!stopped) onError(err);
    }
  })();

  // Sends a command to the indicator. Ohaus units take short ASCII commands
  // (P to print, Z to zero, T to tare) when they are not in continuous mode, so
  // the app can ASK for a reading instead of someone reaching over to press
  // Print. Terminated with CRLF, which is what the command set expects.
  const send = async (command, { terminator = "\r\n" } = {}) => {
    if (stopped || !port.writable) throw new Error("Not connected");
    const writer = port.writable.getWriter();
    try {
      await writer.write(new TextEncoder().encode(`${command}${terminator}`));
    } finally {
      writer.releaseLock();
    }
  };

  return { port, disconnect: stop, send };
};

module.exports = {
  isSupported, splitLines, connectScale, rememberedPorts, releaseAll,
  DEFAULT_PORT_OPTIONS,
};
