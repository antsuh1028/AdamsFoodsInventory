"use strict";

const { correctName } = require("./descriptionMatch");

// Outgoing heading fields corrected against their standard list.
const LISTS = {
  itemDescription: "item_descriptions",
  shipTo: "customers",
};

/**
 * Swaps clear typos in an outgoing heading for the list's spelling.
 * `fields` maps itemDescription / shipTo to typed text; fields named in `keep`
 * are left as typed. Returns { values, corrections: [{ field, from, to }] }.
 */
const correctHeading = async (db, tenantId, fields, keep = []) => {
  const values = { ...fields };
  const corrections = [];
  for (const [field, table] of Object.entries(LISTS)) {
    const typed = fields[field];
    if (typeof typed !== "string" || !typed.trim() || keep.includes(field)) continue;
    const { rows } = await db.query(
      `SELECT name FROM ${table} WHERE tenant_id = $1 AND active`, [tenantId]);
    const out = correctName(typed, rows.map((r) => r.name));
    if (out.corrected) {
      values[field] = out.name;
      corrections.push({ field, from: out.from, to: out.name });
    }
  }
  return { values, corrections };
};

// The keepAsTyped body field: a list of heading field names.
const parseKeep = (raw) => (Array.isArray(raw) ? raw.filter((f) => f in LISTS) : []);

module.exports = { correctHeading, parseKeep, LISTS };
