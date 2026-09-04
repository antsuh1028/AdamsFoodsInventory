"use strict";

const pool = require("./pg");
const { parseLot } = require("./lot");

// Server-side resolve-or-create, shared by every write that carries a lot.
//
// The rule it encodes: **Incoming creates or resolves; everything after
// references.** `ensureLot` is for incoming-side writes (a receipt, a weighing
// session, a registration form, a tally import). `lookupLot` never creates and
// is what downstream writes use.
//
// Both return null — rather than throwing — when the text is not a lot.
// That is deliberate and is what makes Phase C safe to deploy: the text columns
// are still authoritative, so a record that saved yesterday with an odd lot
// value must still save today. It simply keeps `lot_id` NULL and shows up in
// the backfill's unmatched list. Making this throw would turn a cosmetic data
// problem into a save that fails, which is a far worse trade while the
// registry is still being populated.

const SELECT_LOT = `SELECT lot_id, lot_number FROM lots WHERE tenant_id = $1 AND lot_number = $2`;

const shape = (row, created) => ({
  lotId: row.lot_id, lotNumber: row.lot_number, created,
});

// A failed INSERT aborts the surrounding transaction, so when we are running
// inside one the attempt is wrapped in a savepoint. Without this, two receipts
// pushed at the same moment could have one of them lose the lot race and take
// the whole push down with it.
const insertLot = async (client, inTransaction, tenantId, userId, parsed) => {
  if (inTransaction) await client.query("SAVEPOINT lot_ensure");
  try {
    const ins = await client.query(
      `INSERT INTO lots (tenant_id, lot_number, lot_date, seq, created_by, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING lot_id, lot_number`,
      [tenantId, parsed.lotNumber, parsed.lotDate, parsed.seq, userId || null, parsed.extra || null]
    );
    if (inTransaction) await client.query("RELEASE SAVEPOINT lot_ensure");
    return shape(ins.rows[0], true);
  } catch (err) {
    if (inTransaction) await client.query("ROLLBACK TO SAVEPOINT lot_ensure");
    if (err.code !== "23505") throw err;
    // Someone created it between our lookup and our insert. Their row is as
    // good as ours would have been.
    const now = await client.query(SELECT_LOT, [tenantId, parsed.lotNumber]);
    if (now.rows.length) return shape(now.rows[0], false);
    throw err;
  }
};

/**
 * Incoming side. Resolves the text to a lot, creating the record when the lot
 * is genuinely new.
 *
 * A lot coming back from AdamsFoods for a second pass hits the resolve path and
 * returns its EXISTING record — stored, not re-created, which is the whole
 * point of the registry.
 *
 * Returns { lotId, lotNumber, created } or null.
 */
const ensureLot = async (tenantId, userId, text, client = pool) => {
  const parsed = parseLot(text);
  if (!parsed.ok) return null;

  const found = await client.query(SELECT_LOT, [tenantId, parsed.lotNumber]);
  if (found.rows.length) return shape(found.rows[0], false);

  return insertLot(client, client !== pool, tenantId, userId, parsed);
};

/**
 * Downstream. Resolves the text to an EXISTING lot and never creates one.
 * Returns { lotId, lotNumber, created: false } or null.
 */
const lookupLot = async (tenantId, text, client = pool) => {
  const parsed = parseLot(text);
  if (!parsed.ok) return null;

  const found = await client.query(SELECT_LOT, [tenantId, parsed.lotNumber]);
  return found.rows.length ? shape(found.rows[0], false) : null;
};

/**
 * The pair a dual-write needs: the canonical text to store alongside the id.
 *
 * When the lot resolves, the stored text becomes the canonical form — so
 * "N26244-3" is written as "N26244-03" and the columns stop disagreeing with
 * each other. When it does not, the original text is kept exactly as the caller
 * sent it and lot_id is null, which is what today's behaviour already is.
 */
const lotColumns = async (tenantId, userId, text, client = pool) => {
  const lot = await ensureLot(tenantId, userId, text, client);
  return lot
    ? { lotId: lot.lotId, lotNumber: lot.lotNumber, created: lot.created }
    : { lotId: null, lotNumber: text == null || text === "" ? null : text, created: false };
};

module.exports = { ensureLot, lookupLot, lotColumns };
