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

  const port = await navigator.serial.requestPort();
  await port.open({ ...DEFAULT_PORT_OPTIONS, ...portOptions });

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

module.exports = { isSupported, splitLines, connectScale, DEFAULT_PORT_OPTIONS };
