import { Box } from "@chakra-ui/react";

// Every date in this app is a Pacific business date. The warehouse is in
// Maywood, CA, so "today" means today in Maywood — not in UTC, and not in
// whatever timezone the viewer's device happens to be set to.
//
// This previously used toISOString(), which is UTC and flipped to tomorrow at
// 4pm or 5pm Pacific, so anything received in the afternoon was dated a day
// ahead. Intl handles the DST offset, so there is no fixed -8/-7 to maintain.
// The paper forms these screens mirror are filled in block capitals, so typed
// values are stored that way rather than merely displayed that way.
//
// Safe to apply blanket: a date input yields "2026-09-04", a time "14:30", a
// number "1695.5" — none contains a letter, so this is a no-op for them and
// only text is affected. Nulls pass through untouched so an empty field stays
// empty rather than becoming "".
export const upper = (v) =>
  (typeof v === "string" ? v.toUpperCase() : v);

export const PACIFIC_TZ = "America/Los_Angeles";

const pacificParts = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: PACIFIC_TZ,
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return { year: get("year"), month: get("month"), day: get("day") };
};

// "YYYY-MM-DD" for the current Pacific date.
export const today = (date = new Date()) => {
  const { year, month, day } = pacificParts(date);
  const pad = (n) => String(n).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}`;
};

// "HH:MM" for the current Pacific time, which is what an <input type="time">
// expects. Pacific for the same reason the dates are: it is the warehouse's
// clock, and a device left on another timezone would otherwise stamp a receipt
// with an hour nobody was on the dock.
export const timeNow = (date = new Date()) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: PACIFIC_TZ, hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(date);

// Lot numbers are N{YY}{JJJ} — two-digit year plus zero-padded day of the year —
// with a per-record sequence appended downstream. 2026-09-01 is N26244.
//
// Day-of-year is derived from the Pacific calendar date; the subtraction runs
// in UTC only because that arithmetic has no daylight-saving jumps in it.
export const lotNumberForDate = (date = new Date()) => {
  const { year, month, day } = pacificParts(date);
  const dayOfYear = Math.floor(
    (Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 0)) / 86400000
  );
  return `N${String(year % 100).padStart(2, "0")}${String(dayOfYear).padStart(3, "0")}`;
};

// "Tuesday, September 1, 2026" — in Pacific, so it agrees with the lot number
// beside it even when the viewer's device is on another clock.
export const fmtLongDate = (date = new Date()) =>
  date.toLocaleDateString("en-US", {
    timeZone: PACIFIC_TZ,
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });

export const fmtDate = (val) => {
  if (!val) return "—";
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(val))) {
    const [y, m, d] = String(val).split("-");
    return `${parseInt(m)}/${parseInt(d)}/${y}`;
  }
  const dt = new Date(val);
  if (isNaN(dt)) return String(val);
  const mo = dt.getMonth() + 1;
  const d  = dt.getDate();
  const y  = dt.getFullYear();
  const h  = dt.getHours() % 12 || 12;
  const min  = String(dt.getMinutes()).padStart(2, "0");
  const ampm = dt.getHours() >= 12 ? "PM" : "AM";
  return `${mo}/${d}/${y} - ${h}:${min} ${ampm}`;
};

// Weights always carry two decimals, whole numbers included — on a sheet where
// every other figure shows cents, a bare "2357" reads as a different kind of
// number from "2357.00".
//
// Display only. The stored value stays the decimal string it arrived as; this
// never feeds arithmetic, which is why a float here is harmless.
export const fmtWeight = (v) => {
  if (v == null || String(v).trim() === "") return "—";
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : String(v);
};

export const cellInputStyle = {
  width: "100%", fontSize: "14px", padding: "3px 6px",
  border: "1px solid #A0AEC0", borderRadius: "3px",
  outline: "none", background: "white", fontFamily: "inherit",
  // The receipt grid is data entry against a paper sheet, so block capitals
  // like the rest. The value is uppercased on change too, so this only keeps
  // the display honest while typing.
  textTransform: "uppercase",
};

export const Th = ({ children, ...props }) => (
  <Box
    as="th" px={3} py={2} textAlign="left"
    fontSize="sm" fontWeight="semibold" color="gray.500"
    textTransform="uppercase" letterSpacing="wide"
    bg="gray.50" borderBottom="2px" borderColor="gray.200"
    whiteSpace="nowrap" {...props}
  >
    {children}
  </Box>
);

export const Td = ({ children, ...props }) => (
  <Box
    as="td" px={3} py={2}
    fontSize="md" color="gray.700"
    borderBottom="1px" borderColor="gray.100"
    whiteSpace="nowrap" {...props}
  >
    {children}
  </Box>
);
