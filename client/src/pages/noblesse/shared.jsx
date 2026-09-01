import { Box } from "@chakra-ui/react";

export const today = () => new Date().toISOString().slice(0, 10);

// today() is UTC-based, which in California flips to tomorrow around 4-5pm.
// Use this wherever the answer has to match the wall calendar the warehouse
// is working to.
export const localToday = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// Lot numbers are N{YY}{JJJ} — two-digit year plus zero-padded day of the year —
// with a per-record sequence appended downstream. 2026-09-01 is N26244.
//
// The day is taken from the LOCAL calendar date, not UTC: the warehouse is in
// California, so a UTC day-of-year would roll the lot over mid-afternoon. The
// subtraction itself runs in UTC because that has no daylight-saving jumps.
export const lotNumberForDate = (date = new Date()) => {
  const year = date.getFullYear();
  const dayOfYear = Math.floor(
    (Date.UTC(year, date.getMonth(), date.getDate()) - Date.UTC(year, 0, 0)) / 86400000
  );
  return `N${String(year % 100).padStart(2, "0")}${String(dayOfYear).padStart(3, "0")}`;
};

// "Tuesday, September 1, 2026"
export const fmtLongDate = (date = new Date()) =>
  date.toLocaleDateString(undefined, {
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

export const cellInputStyle = {
  width: "100%", fontSize: "14px", padding: "3px 6px",
  border: "1px solid #A0AEC0", borderRadius: "3px",
  outline: "none", background: "white", fontFamily: "inherit",
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
