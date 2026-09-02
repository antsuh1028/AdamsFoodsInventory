"use strict";

// Parses a Noblesse tally sheet workbook into the same shape a scanning
// session produces, so a hand-entered lot and a barcoded one end up as the
// same kind of record.
//
// Everything is located by CONTENT, not by cell coordinates. These files are
// filled in by hand on an iPad, so a row gets inserted, a column shifts, and
// a parser keyed to rows[6][3] silently reads the wrong number. Finding the
// "Box/Pcs." header and working from there survives that.
//
// The sheet carries its own checksums — a total per row, plus Total Boxes and
// Subtotal — so every figure is recomputed from the individual weights and
// compared against what the file claims. A disagreement means the layout was
// misread or a formula is stale, and the import is refused rather than
// recording weights nobody has verified.

const PER_ROW = 10;

class TallyError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "TallyError";
    this.code = code;
    this.details = details;
  }
}

const text = (cell) =>
  cell === null || cell === undefined ? "" : String(cell).trim();

// Strips every non-alphanumeric character, so "Box/Pcs.", "Box / Pcs" and
// "BOX PCS:" all match. Label punctuation varies between hand-edited copies of
// the form and none of it carries meaning.
const norm = (cell) => text(cell).toLowerCase().replace(/[^a-z0-9]+/g, "");

// Excel gives numbers as numbers and hand-typed values as strings. Weights are
// carried as decimal strings from here on, never floats.
const toThousandths = (cell) => {
  if (cell === null || cell === undefined || cell === "") return null;
  const raw = String(cell).trim().replace(/,/g, "");
  if (!/^\d*\.?\d+$/.test(raw)) return null;
  const [whole, frac = ""] = raw.split(".");
  return (parseInt(whole || "0", 10)) * 1000 + parseInt((frac + "000").slice(0, 3), 10);
};

const fromThousandths = (n) => {
  const whole = Math.floor(n / 1000);
  const frac = String(n % 1000).padStart(3, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : String(whole);
};

// Finds a labelled header value: locate the cell whose text matches, then take
// the first non-empty cell to its right on the same row.
const labelledValue = (rows, ...labels) => {
  const wanted = labels.map((l) => norm(l));
  for (const row of rows) {
    if (!row) continue;
    for (let c = 0; c < row.length; c += 1) {
      if (!wanted.includes(norm(row[c]))) continue;
      for (let k = c + 1; k < row.length; k += 1) {
        const v = text(row[k]);
        if (v) return v;
      }
    }
  }
  return null;
};

const findRowIndex = (rows, predicate) => rows.findIndex((r) => r && predicate(r));

/**
 * Parse a tally workbook (as rows from read-excel-file) into
 *   { lotNumber, vendor, shipTo, itemDescription, date, weights: string[],
 *     declared: { boxes, subtotal }, computed: { boxes, subtotal } }
 *
 * Throws TallyError. Callers should surface err.code and err.details — an
 * operator needs to know WHICH row disagreed, not just that something did.
 */
const parseTallySheet = (rows) => {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new TallyError("EMPTY_SHEET", "The workbook has no rows");
  }

  const headerIdx = findRowIndex(rows, (r) => r.some((c) => norm(c) === "boxpcs"));
  if (headerIdx === -1) {
    throw new TallyError("NOT_A_TALLY",
      'Could not find the "Box/Pcs." header — this does not look like a tally sheet');
  }

  const footerIdx = findRowIndex(rows, (r) => r.some((c) => norm(c) === "totalboxes"));
  if (footerIdx === -1 || footerIdx <= headerIdx) {
    throw new TallyError("NOT_A_TALLY", 'Could not find the "Total Boxes" row');
  }

  // The count sits in the first column of the data rows, so the weights begin
  // in the column after it.
  const countCol = rows[headerIdx].findIndex((c) => norm(c) === "boxpcs");
  const firstWeightCol = countCol + 1;

  const weights = [];
  const rowProblems = [];

  for (let r = headerIdx + 1; r < footerIdx; r += 1) {
    const row = rows[r] || [];
    const declaredCount = toThousandths(row[countCol]);
    const cells = row.slice(firstWeightCol, firstWeightCol + PER_ROW);

    const found = [];
    for (const cell of cells) {
      const th = toThousandths(cell);
      if (th === null) continue;
      if (th <= 0) continue; // blank rows are written as 0 on the paper form
      found.push(th);
    }
    if (found.length === 0) continue; // an unused row on the form

    // The row's own total is the checksum for that row.
    const declaredTotal = toThousandths(row[firstWeightCol + PER_ROW]);
    const computedTotal = found.reduce((a, b) => a + b, 0);
    if (declaredTotal !== null && declaredTotal !== computedTotal) {
      rowProblems.push({
        row: r + 1,
        declared: fromThousandths(declaredTotal),
        computed: fromThousandths(computedTotal),
      });
    }
    const declaredBoxes = declaredCount === null ? null : declaredCount / 1000;
    if (declaredBoxes !== null && declaredBoxes !== found.length) {
      rowProblems.push({
        row: r + 1,
        declaredBoxes,
        computedBoxes: found.length,
      });
    }

    weights.push(...found.map(fromThousandths));
  }

  if (weights.length === 0) {
    throw new TallyError("NO_WEIGHTS", "The tally sheet has no box weights on it");
  }
  if (rowProblems.length) {
    throw new TallyError("ROW_MISMATCH",
      "A row total on the sheet does not match its own weights", { rows: rowProblems });
  }

  const footer = rows[footerIdx];
  const declaredBoxes = (() => {
    const idx = footer.findIndex((c) => norm(c) === "totalboxes");
    for (let k = idx + 1; k < footer.length; k += 1) {
      const th = toThousandths(footer[k]);
      if (th !== null) return th / 1000;
    }
    return null;
  })();

  const declaredSubtotal = (() => {
    const idx = footer.findIndex((c) => norm(c) === "subtotal");
    if (idx === -1) {
      // Some sheets put the subtotal in the last cell with no label.
      for (let k = footer.length - 1; k >= 0; k -= 1) {
        const th = toThousandths(footer[k]);
        if (th !== null && th / 1000 !== declaredBoxes) return th;
      }
      return null;
    }
    for (let k = idx + 1; k < footer.length; k += 1) {
      const th = toThousandths(footer[k]);
      if (th !== null) return th;
    }
    return null;
  })();

  const computedSubtotal = weights.reduce((a, w) => a + toThousandths(w), 0);

  if (declaredBoxes !== null && declaredBoxes !== weights.length) {
    throw new TallyError("COUNT_MISMATCH",
      `The sheet says ${declaredBoxes} boxes but ${weights.length} weights were read`,
      { declared: declaredBoxes, computed: weights.length });
  }
  if (declaredSubtotal !== null && declaredSubtotal !== computedSubtotal) {
    throw new TallyError("SUBTOTAL_MISMATCH",
      `The sheet subtotal is ${fromThousandths(declaredSubtotal)} but the weights add to ${fromThousandths(computedSubtotal)}`,
      { declared: fromThousandths(declaredSubtotal), computed: fromThousandths(computedSubtotal) });
  }

  return {
    lotNumber: labelledValue(rows, "Lot#", "Lot"),
    vendor: labelledValue(rows, "Vendor"),
    shipTo: labelledValue(rows, "Ship To", "Bill of Lading"),
    itemDescription: labelledValue(rows, "Item Description"),
    date: labelledValue(rows, "Date"),
    weights,
    declared: {
      boxes: declaredBoxes,
      subtotal: declaredSubtotal === null ? null : fromThousandths(declaredSubtotal),
    },
    computed: {
      boxes: weights.length,
      subtotal: fromThousandths(computedSubtotal),
    },
  };
};

module.exports = { parseTallySheet, TallyError, toThousandths, fromThousandths, PER_ROW };
