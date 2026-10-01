"use strict";

// What a lot has waiting in the F.P Tracker: cases sent to the freezer, less
// cases accepted runs have already taken. Computed from the rows every time,
// never stored, so a correction anywhere shows at once and nothing drifts.

// One spelling per item: trimmed, single-spaced, upper case.
const normaliseItem = (s) => String(s ?? "").trim().replace(/\s+/g, " ").toUpperCase();

// Per item for one lot. $1 tenant, $2 lot_id.
const ITEMS_FOR_LOT = `
  SELECT t.item,
         SUM(t.cases)::int AS sent,
         COALESCE((SELECT SUM(r.input_cases) FROM noblesse_processing_reports r
                    WHERE r.tenant_id = $1 AND r.lot_id = $2 AND r.status = 'accepted'
                      AND r.source_fp_item = t.item), 0)::int AS drawn,
         BOOL_OR(t.returned_on IS NULL) AS in_freezer,
         MAX(t.sent_on)::text AS last_sent
    FROM fp_tracker t
   WHERE t.tenant_id = $1 AND t.lot_id = $2 AND t.voided_at IS NULL
   GROUP BY t.item
   ORDER BY t.item`;

// The waiting count for one lot and item. $1 tenant, $2 lot_id, $3 item.
const WAITING_ONE = `
  SELECT COALESCE((SELECT SUM(cases) FROM fp_tracker
                    WHERE tenant_id = $1 AND lot_id = $2 AND item = $3 AND voided_at IS NULL), 0)::int
       - COALESCE((SELECT SUM(input_cases) FROM noblesse_processing_reports
                    WHERE tenant_id = $1 AND lot_id = $2 AND source_fp_item = $3
                      AND status = 'accepted'), 0)::int AS waiting`;

const waitingFor = async (db, tenantId, lotId, item) =>
  Number((await db.query(WAITING_ONE, [tenantId, lotId, item])).rows[0].waiting);

const itemsForLot = async (db, tenantId, lotId) =>
  (await db.query(ITEMS_FOR_LOT, [tenantId, lotId])).rows.map((r) => ({
    item: r.item,
    sent: r.sent,
    drawn: r.drawn,
    waiting: r.sent - r.drawn,
    inFreezer: r.in_freezer === true,
    lastSent: r.last_sent,
  }));

// Serialises everything that reads and then changes a lot's waiting count.
const lockLot = (db, tenantId, lotId) =>
  db.query("SELECT lot_id FROM lots WHERE lot_id = $1 AND tenant_id = $2 FOR UPDATE", [lotId, tenantId]);

module.exports = { normaliseItem, ITEMS_FOR_LOT, WAITING_ONE, waitingFor, itemsForLot, lockLot };
