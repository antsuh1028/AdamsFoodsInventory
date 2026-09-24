import React from "react";
import { Box, GridItem, Text } from "@chakra-ui/react";
import { ChevronDownIcon, ChevronRightIcon } from "@chakra-ui/icons";

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

// NTI's processing codes, kept as the literal strings that get stored so they
// survive into the printed form with no lookup table to keep in sync.
export const PROCESSING_TYPES = [
  "101 SLC-BG Slicing & Bagging",
  "101A SLC-PK Slicing & Packing",
  "102 DBN-PK Deboning & Bagging",
  "103 PRTN-PK Portioning & Packing",
  "104 CUT-PK 1/2 Cutting & Packing",
  "105 BONE CUT Bone Cut",
  "105A OX-CUT Oxtail Cut",
  "106 CUT-RL Cutting & Rolling",
  "107 TRM - RL Trimming & Rolling",
  "108 SHR-CT Short Rib Cut",
  "109 CHK-RL Chicken & Rolling",
  "110 REPK Repacking",
  "111 MARIN Marinading",
];

// The stations a run happens on. Named equipment, not line numbers — "2" meant
// nothing to anyone reading the report afterwards, and Slicer #2 running on
// Line #2 is its own station rather than either of the two beside it.
export const PROCESSING_LINES = [
  "Slicer #1",
  "Slicer #2",
  "Slicer #2 Line #2",
  "Bandsaw #1",
  "Bandsaw #2",
];

export const PACIFIC_TZ = "America/Los_Angeles";

// Built once each: constructing an Intl formatter is the expensive part, and
// these run per row in lists that re-render on every keystroke.
const PARTS_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: PACIFIC_TZ,
  year: "numeric", month: "2-digit", day: "2-digit",
});
const DATE_TIME_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: PACIFIC_TZ,
  month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
});
const TIME_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: PACIFIC_TZ, hour: "2-digit", minute: "2-digit", hour12: false,
});
const DATE_ONLY_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: PACIFIC_TZ, month: "numeric", day: "numeric", year: "numeric",
});

const pacificParts = (date = new Date()) => {
  const parts = PARTS_FMT.formatToParts(date);
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return { year: get("year"), month: get("month"), day: get("day") };
};

// "YYYY-MM-DD" for the current Pacific date.
export const today = (date = new Date()) => {
  const { year, month, day } = pacificParts(date);
  const pad = (n) => String(n).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}`;
};

// The Pacific day a session's boxes were weighed: the date someone set after
// the fact, else the day it was opened. Not created_at sliced — that string is
// UTC, so a session opened after 5pm Pacific would read as the next day.
export const weighedDay = (b) => {
  if (!b) return "";
  if (b.weighed_on) return b.weighed_on;
  return b.created_at ? today(new Date(b.created_at)) : "";
};

// A stored timestamp as Pacific date AND time — "Sep 15, 2:41 PM". For lists
// ordered by when a row was added, where the date alone cannot show the order
// within a day.
export const fmtDateTime = (ts) => {
  if (!ts) return null;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  return DATE_TIME_FMT.format(d);
};

// A stored timestamp as just the Pacific date — "9/16/2026". fmtDate renders a
// timestamp with the time appended, which is noise on a printed tag.
export const fmtDateOnly = (ts) => {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return DATE_ONLY_FMT.format(d);
};

// "HH:MM" for the current Pacific time, which is what an <input type="time">
// expects. Pacific for the same reason the dates are: it is the warehouse's
// clock, and a device left on another timezone would otherwise stamp a receipt
// with an hour nobody was on the dock.
export const timeNow = (date = new Date()) => TIME_FMT.format(date);

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

// ── The sheet look ───────────────────────────────────────────────────────────
// The paper forms these screens mirror are grids of label/value pairs, so the
// screens are too. Shared so the processing report and the registration form
// are visibly the same document family rather than two takes on it.

// Bold right-aligned label plus a filled cell, as a pair of grid columns.
// Collapses to one column on mobile, where the right-aligned pairing has no
// room to mean anything.
export const SheetField = ({ label, full, plain, children }) => (
  <>
    <GridItem
      colSpan={1}
      display="flex"
      alignItems="center"
      justifyContent={{ base: "flex-start", md: "flex-end" }}
    >
      <Text
        // 10px reads as fine print on a desktop sheet and as unreadable at
        // arm's length on a tablet, which is where this form is filled in.
        fontSize={{ base: "xs", md: "2xs" }}
        fontWeight="bold" p={2} color="gray.700"
        textTransform="uppercase" letterSpacing="wide"
        textAlign={{ base: "left", md: "right" }}
      >
        {label}
      </Text>
    </GridItem>
    <GridItem
      colSpan={{ base: 1, md: full ? 3 : 1 }}
      bg={plain ? "transparent" : "#f0f0f0"}
      borderRadius="sm"
    >
      {children}
    </GridItem>
  </>
);

// Block capitals on screen; the value is uppercased in the change handler so it
// is stored and printed that way too, not merely displayed.
export const sheetInputProps = {
  size: "sm", bg: "transparent", border: "none", borderRadius: 0, px: 2,
  textTransform: "uppercase", _focus: { boxShadow: "none", bg: "white" },
  // 16px ON TOUCH IS NOT A STYLE CHOICE. iOS Safari zooms the whole page in
  // when a field smaller than that takes focus, and it does not zoom back out
  // - so on a tablet every tap into this sheet left the operator scrolling a
  // magnified form sideways to find the next field.
  fontSize: { base: "16px", md: "sm" },
  // A fingertip is about 9mm; 44px is the smallest target it reliably hits.
  // minH rather than height because these props are spread onto Textareas and
  // plain Boxes too, and a fixed height would flatten those.
  minH: { base: "44px", md: "auto" },
};

// Pass onToggle to make a section collapsible; without it this renders exactly
// as before, so the sections that are not are unaffected.
export const SectionBar = ({ children, isOpen, onToggle, summary }) => {
  const Chevron = isOpen ? ChevronDownIcon : ChevronRightIcon;
  return (
    <GridItem colSpan={{ base: 1, md: 4 }} bg="#ccd3db" px={3} py={2}
      fontSize="xs" fontWeight="bold" color="gray.800"
      display="flex" alignItems="center" gap={2}
      cursor={onToggle ? "pointer" : undefined}
      onClick={onToggle}
      title={onToggle ? (isOpen ? "Hide these fields" : "Show these fields") : undefined}>
      {onToggle && <Chevron boxSize={4} color="gray.700" />}
      {children}
      {/* Collapsed, the bar still says what is under it. */}
      {!isOpen && summary && (
        <Text as="span" fontWeight="normal" color="gray.600" textTransform="none"
          noOfLines={1} minW={0}>
          {summary}
        </Text>
      )}
    </GridItem>
  );
};

// The grid the two above live in.
export const SHEET_GRID = {
  templateColumns: { base: "1fr", md: "1fr 2fr 1fr 2fr" },
  gap: "1px",
  bg: "gray.200",
  border: "1px solid",
  borderColor: "gray.200",
};
