"use strict";

// Cases processed by hand on a lot's registration form: run rows typed in, not
// written by an accepted report. Those rows never moved stock, so whatever asks
// how many cases a lot has left has to take them off qty_cases itself.
// Report rows (reportId) are already off stock; FP rows (fp) came off the FP lot.

/** SQL for one stock row's hand-typed cases. `s` is an nti_inventory alias. */
const manualCasesSql = (s) => `
  COALESCE((SELECT SUM(CASE WHEN (e->>'cases') ~ '^[0-9]+(\\.[0-9]+)?$'
                            THEN (e->>'cases')::numeric ELSE 0 END)
              FROM noblesse_registration_forms f,
                   jsonb_array_elements(COALESCE(f.processing_dates, '[]'::jsonb)) e
             WHERE f.tenant_id = ${s}.tenant_id
               AND (f.lot_id = ${s}.lot_id OR (f.lot_id IS NULL AND f.lot_number = ${s}.lot))
               AND e->>'reportId' IS NULL AND e->>'fp' IS NULL), 0)::int`;

module.exports = { manualCasesSql };
