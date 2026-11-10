"use strict";

const rx = require("read-excel-file/node");

// Reads the office's order workbook (AF_ORDER SHEET_2026.xlsx): one tab per
// customer, side-by-side order panels, each line "CODE-TAG DESCRIPTION" with a
// price at the right. A customer's template is its newest panel; the item
// codes are every product line on every tab.

const readSheet = rx.default || rx;
const { readSheetNames } = rx;

// Tabs that are not a customer.
const SKIP = new Set(["OTHER", "OTHER_EMPLOYEE", "WTR_PRICE", "SHEET2", "SHEET3", "ONT.SCHEDULE"]);

// Code, an optional variant tag (-BF, -NR, -CAB ...), then the description.
const LINE = /^\s*(\d{5,7})\s*(?:[-–]\s*([A-Za-z][A-Za-z0-9/&."]*))?\s*(?:[-–]|\/\/|\s)\s*(.*\S)\s*$/;

const str = (v) => (v == null ? "" : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).replace(/\s+/g, " ").trim());
const priceOf = (v) => { const m = /(\d+(?:\.\d+)?)/.exec(str(v)); return m ? m[1] : null; };

/** A product line's parts, or null. "26124-03" is a lot, not a code. */
const parseLine = (text) => {
  const m = LINE.exec(str(text));
  if (!m || /^\d{2}$/.test(m[2] || "") || !/[A-Za-z]{3}/.test(m[3])) return null;
  return {
    code: m[1], tag: (m[2] || "").toUpperCase() || null,
    description: m[3].replace(/\s*\(\s*\d{5}\s*-\s*\d{2}\s*\)/g, "").trim(),
  };
};

// Dates are typed every way: 2026-11-06, 4/31/2026* (not a real day), 45204 (an Excel serial).
const isoDate = (d) => {
  const t = str(d);
  let y; let m; let dd;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) [y, m, dd] = t.split("-").map(Number);
  else if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(t)) { const [a, b, c] = t.match(/\d+/g).map(Number); [y, m, dd] = [c, a, b]; }
  else if (/^\d{5}$/.test(t)) return new Date(Date.UTC(1899, 11, 30) + Number(t) * 864e5).toISOString().slice(0, 10);
  else return null;
  const x = new Date(Date.UTC(y, m - 1, dd));
  return x.getUTCMonth() === m - 1 && x.getUTCDate() === dd ? x.toISOString().slice(0, 10) : null;
};

// The order panels on one tab: a panel starts at a "PL/CS/BX" cell, its heading sits in the rows above.
const panelsOf = (rows) => {
  const cell = (r, c) => str((rows[r] || [])[c]);
  const starts = [];
  rows.forEach((r, ri) => r.forEach((c, ci) => { if (/^PL\/CS\/BX$/i.test(str(c))) starts.push({ row: ri, col: ci }); }));
  return starts.map(({ row, col }) => {
    let customer = ""; let date = ""; let ship = ""; let due = "";
    for (let r = Math.max(0, row - 4); r < row; r++) {
      for (let c = col; c < col + 13; c++) {
        const k = cell(r, c);
        if (k === "Customer") customer = cell(r, c + 1);
        if (/^Date:?$/.test(k)) date = cell(r, c + 1);
        if (/^Ship(\/BL)? To$|^Address$/.test(k)) ship = cell(r, c + 1);
        if (/^Due:?$/.test(k)) due = cell(r, c + 1);
      }
    }
    const lines = [];
    for (let r = row + 1; r < rows.length; r++) {
      const first = cell(r, col);
      const desc = cell(r, col + 1);
      if (/^Order Qty/i.test(first) || /^Order Qty/i.test(desc)) break;
      const line = parseLine(desc);
      if (!line) continue;
      // The $/lb sits at the right of the panel, as a number or as "5.99/lb".
      let price = null;
      for (let c = col + 2; c < col + 13; c++) {
        const v = (rows[r] || [])[c];
        if (typeof v === "number" && v > 0.5 && v < 60 && c >= col + 10) { price = String(Math.round(v * 100) / 100); break; }
        if (typeof v === "string" && /\/lb/i.test(v)) { price = priceOf(v); break; }
      }
      lines.push({ ...line, price });
    }
    return { customer, date: isoDate(date), rawDate: date, ship, due: due.toUpperCase(), lines };
  }).filter((p) => p.lines.length);
};

/**
 * The workbook as templates and item codes.
 * Returns { templates: [{ name, displayName, shipTo, dueDay, from, panels, lines }], items: [{ code, tag, description }] }.
 */
const readOrderWorkbook = async (input) => {
  const templates = [];
  const items = new Map();
  for (const sheet of await readSheetNames(input)) {
    const rows = await readSheet(input, { sheet });
    const panels = panelsOf(rows);
    for (const p of panels) {
      for (const l of p.lines) {
        const key = `${l.code}|${l.description.toUpperCase()}`;
        if (!items.has(key)) items.set(key, { code: l.code, tag: l.tag, description: l.description });
      }
    }
    if (SKIP.has(sheet.trim().toUpperCase()) || !panels.length) continue;
    const newest = panels.slice().sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))[0];
    templates.push({
      name: sheet.trim(), displayName: newest.customer || sheet.trim(),
      shipTo: newest.ship || null, dueDay: newest.due || null, from: newest.date,
      panels: panels.length, lines: newest.lines,
    });
  }
  return { templates, items: [...items.values()] };
};

module.exports = { readOrderWorkbook, parseLine, isoDate };
