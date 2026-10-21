import { weighedDay, timeNow, fmtClock } from "../common/shared";

// Gap that starts a new shipment to the same customer.
export const SPLIT_GAP_MIN = 120;

// Customer name compared without case, spaces or punctuation.
export const destKey = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

const FREEZER = "\u0000FREEZER";

const lbMils = (b) =>
  Math.round(Number((b.totals || []).find((t) => t.unit === "LB")?.total || 0) * 1000);

export const milsToLb = (m) => `${Math.floor(m / 1000)}.${String(m % 1000).padStart(3, "0")}`;

export const clockOf = (ts) => (ts ? fmtClock(timeNow(new Date(ts))) : "");

// Sessions by day, newest first, each day auto-grouped into shipments.
export const groupOutgoing = (sessions, now = Date.now()) => {
  const days = new Map();
  for (const b of sessions) {
    const day = weighedDay(b);
    if (!days.has(day)) days.set(day, []);
    days.get(day).push(b);
  }

  return [...days.entries()]
    .sort(([a], [b]) => String(b).localeCompare(String(a)))
    .map(([day, list]) => {
      const sorted = [...list].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      const shipments = [];
      const lastByKey = new Map();
      for (const b of sorted) {
        const key = b.further_processing ? FREEZER : destKey(b.ship_to);
        const start = new Date(b.created_at).getTime();
        const end = b.closed_at ? new Date(b.closed_at).getTime() : Math.max(start, now);
        let g = lastByKey.get(key);
        if (!g || start - g.endMs > SPLIT_GAP_MIN * 60000) {
          g = {
            id: `${day}|${key}|${b.batch_id}`, key,
            freezer: key === FREEZER, destination: b.ship_to || "",
            sessions: [], startMs: start, endMs: end, boxes: 0, mils: 0, lots: [],
          };
          shipments.push(g);
          lastByKey.set(key, g);
        }
        g.sessions.push(b);
        g.endMs = Math.max(g.endMs, end);
        g.boxes += Number(b.box_count) || 0;
        g.mils += lbMils(b);
        if (b.lot_number && !g.lots.includes(b.lot_number)) g.lots.push(b.lot_number);
      }
      for (const g of shipments) {
        const drivers = [...new Set(g.sessions.map((s) => s.driver).filter(Boolean))];
        g.driver = drivers[0] || "";
        // Some pallets lack the driver, or carry a different one.
        g.driverMixed = drivers.length > 1 || (drivers.length === 1 && g.sessions.some((s) => !s.driver));
        g.open = g.sessions.some((s) => s.status === "open");
        g.flagged = g.sessions.some((s) => s.flagged_at);
        g.sessions.reverse();
      }
      shipments.sort((a, b) => b.startMs - a.startMs);
      const boxes = shipments.reduce((n, g) => n + g.boxes, 0);
      const mils = shipments.reduce((n, g) => n + g.mils, 0);
      return { day, shipments, boxes, mils };
    });
};
