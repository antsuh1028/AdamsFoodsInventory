// Every schema change for the Noblesse side, in one place, run IN ORDER before the
// server starts listening.

const pool = require("../utils/pg");

const RETRIES = 3;
// Overridable so the retry path can be tested without sleeping for real.
// Production never sets it and gets the 2s default.
const RETRY_DELAY_MS = Number(process.env.MIGRATE_RETRY_DELAY_MS ?? 2000);

const run = async (label, sql) => {
  try {
    await pool.query(sql);
  } catch (err) {
    err.message = `migration "${label}" failed: ${err.message}`;
    throw err;
  }
};

// Everything references tenants(id).
const preflight = async () => {
  try {
    await pool.query("SELECT 1 FROM tenants LIMIT 1");
  } catch (err) {
    throw new Error(
      `tenants table is missing or unreadable — this database was never initialised (${err.message})`
    );
  }
};

const steps = async () => {
  // ══════════════════════════════════════════════════════════════════════════
  // Noblesse core — moved verbatim from routes/noblesse.pg.js, original order.

  await run("noblesse_receipts", `
    CREATE TABLE IF NOT EXISTS noblesse_receipts (
      id               SERIAL PRIMARY KEY,
      tenant_id        UUID NOT NULL REFERENCES tenants(id),
      shipment_date    DATE,
      bol_number       TEXT,
      driver           TEXT,
      linked_order_id  INTEGER,
      lines            JSONB NOT NULL DEFAULT '[]',
      status           TEXT NOT NULL DEFAULT 'received',
      notes            TEXT,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await run("nti_inventory", `
    CREATE TABLE IF NOT EXISTS nti_inventory (
      id            SERIAL PRIMARY KEY,
      tenant_id     UUID NOT NULL REFERENCES tenants(id),
      lot           TEXT,
      description   TEXT,
      brand         TEXT,
      species       TEXT,
      est           TEXT,
      pack_date     DATE,
      weight        NUMERIC,
      qty_cases     INTEGER,
      qty_pallets   INTEGER,
      received_date DATE,
      notes         TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await run("noblesse_receipts output_weight",
    `ALTER TABLE noblesse_receipts ADD COLUMN IF NOT EXISTS output_weight NUMERIC`);
  await run("noblesse_receipts processing_runs",
    `ALTER TABLE noblesse_receipts ADD COLUMN IF NOT EXISTS processing_runs JSONB NOT NULL DEFAULT '[]'`);
  await run("noblesse_receipts inspection",
    `ALTER TABLE noblesse_receipts ADD COLUMN IF NOT EXISTS inspection JSONB NOT NULL DEFAULT '{}'`);

  await run("noblesse_processing_orders", `
    CREATE TABLE IF NOT EXISTS noblesse_processing_orders (
      id            SERIAL PRIMARY KEY,
      tenant_id     UUID NOT NULL REFERENCES tenants(id),
      order_date    DATE,
      notes         TEXT,
      output_weight NUMERIC,
      status        TEXT NOT NULL DEFAULT 'pending',
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await run("noblesse_processing_order_items", `
    CREATE TABLE IF NOT EXISTS noblesse_processing_order_items (
      id                  SERIAL PRIMARY KEY,
      processing_order_id INTEGER NOT NULL REFERENCES noblesse_processing_orders(id) ON DELETE CASCADE,
      receipt_id          INTEGER,
      lot                 TEXT,
      description         TEXT,
      brand               TEXT,
      species             TEXT,
      grade               TEXT,
      weight_in           NUMERIC,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await run("noblesse_processing_order_items nti_item_id",
    `ALTER TABLE noblesse_processing_order_items ADD COLUMN IF NOT EXISTS nti_item_id INTEGER`);
  await run("noblesse_processing_order_items cases_in",
    `ALTER TABLE noblesse_processing_order_items ADD COLUMN IF NOT EXISTS cases_in INTEGER`);
  await run("noblesse_processing_orders output_cases",
    `ALTER TABLE noblesse_processing_orders ADD COLUMN IF NOT EXISTS output_cases INTEGER`);
  await run("nti_inventory grade",
    `ALTER TABLE nti_inventory ADD COLUMN IF NOT EXISTS grade VARCHAR(50)`);
  await run("noblesse_processing_orders completed_at",
    `ALTER TABLE noblesse_processing_orders ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ`);
  await run("noblesse_processing_order_items actual_weight_in",
    `ALTER TABLE noblesse_processing_order_items ADD COLUMN IF NOT EXISTS actual_weight_in NUMERIC`);
  await run("noblesse_receipts inventory_pushed",
    `ALTER TABLE noblesse_receipts ADD COLUMN IF NOT EXISTS inventory_pushed BOOLEAN NOT NULL DEFAULT FALSE`);

  await run("nti_inventory_history", `
    CREATE TABLE IF NOT EXISTS nti_inventory_history (
      id         SERIAL PRIMARY KEY,
      tenant_id  UUID NOT NULL REFERENCES tenants(id),
      action     TEXT NOT NULL,
      item_id    INTEGER,
      lot        TEXT,
      snapshot   JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await run("nti_inventory_history performed_by",
    `ALTER TABLE nti_inventory_history ADD COLUMN IF NOT EXISTS performed_by TEXT`);

  await run("noblesse_registration_forms", `
    CREATE TABLE IF NOT EXISTS noblesse_registration_forms (
      id                       SERIAL PRIMARY KEY,
      tenant_id                UUID NOT NULL REFERENCES tenants(id),
      lot_number               TEXT,
      form_date                DATE,
      date_received            DATE,
      time_received            TEXT,
      vendor_lot               TEXT,
      vendor                   TEXT,
      product_description      TEXT,
      processing_type          TEXT,
      spec                     TEXT,
      brand                    TEXT,
      est_number               TEXT,
      grade                    TEXT,
      due_date                 DATE,
      predicted_yield          NUMERIC,
      manifest_bl_attached     BOOLEAN NOT NULL DEFAULT FALSE,
      process_report_attached  BOOLEAN NOT NULL DEFAULT FALSE,
      original_weight          NUMERIC,
      total_quantity           TEXT,
      processing_date_1        DATE,
      processed_weight_1       NUMERIC,
      processing_date_2        DATE,
      processed_weight_2       NUMERIC,
      actual_yield             NUMERIC,
      temp                     TEXT,
      remarks                  TEXT,
      checked_by               TEXT,
      status                   TEXT NOT NULL DEFAULT 'in_progress',
      created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await run("noblesse_registration_forms processing_dates",
    `ALTER TABLE noblesse_registration_forms ADD COLUMN IF NOT EXISTS processing_dates JSONB`);

  await run("noblesse_registration_history", `
    CREATE TABLE IF NOT EXISTS noblesse_registration_history (
      id              SERIAL PRIMARY KEY,
      tenant_id       UUID NOT NULL REFERENCES tenants(id),
      form_id         INTEGER,
      action          TEXT NOT NULL,
      lot_number      TEXT,
      changed_fields  JSONB,
      old_values      JSONB,
      new_values      JSONB,
      performed_by    TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // The FK is dropped so a "deleted" audit row can outlive the form it describes.
  await run("noblesse_registration_history drop form fk", `
    ALTER TABLE noblesse_registration_history
    DROP CONSTRAINT IF EXISTS noblesse_registration_history_form_id_fkey
  `);
  await run("noblesse_registration_history form_id nullable",
    `ALTER TABLE noblesse_registration_history ALTER COLUMN form_id DROP NOT NULL`);

  // ══════════════════════════════════════════════════════════════════════════ Box
  // weighing — moved verbatim from routes/boxes.pg.js, original order.

  await run("box_batches", `
    CREATE TABLE IF NOT EXISTS box_batches (
      batch_id     SERIAL PRIMARY KEY,
      tenant_id    UUID NOT NULL REFERENCES tenants(id),
      client_uuid  UUID NOT NULL UNIQUE,
      status       TEXT NOT NULL DEFAULT 'open',
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      closed_at    TIMESTAMPTZ
    )
  `);

  // raw_barcode is nullable only because of the manual-entry fallback: a damaged or
  // unbarcoded label has no payload to store.
  await run("batch_items", `
    CREATE TABLE IF NOT EXISTS batch_items (
      item_id         SERIAL PRIMARY KEY,
      tenant_id       UUID NOT NULL REFERENCES tenants(id),
      batch_id        INT NOT NULL REFERENCES box_batches(batch_id),
      weight          NUMERIC(8,3) NOT NULL,
      weight_unit     TEXT NOT NULL,
      gtin            TEXT,
      production_date DATE,
      serial          TEXT,
      raw_barcode     TEXT,
      is_manual       BOOLEAN NOT NULL DEFAULT false,
      scanned_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT batch_items_barcode_or_manual
        CHECK (is_manual OR raw_barcode IS NOT NULL)
    )
  `);

  await run("batch_items index",
    `CREATE INDEX IF NOT EXISTS batch_items_batch_id_idx ON batch_items (batch_id)`);

  // A scanning session covers exactly one lot, so the lot belongs on the batch.
  // Without it a stored batch cannot be reprinted as a weight manifest.
  await run("box_batches lot_number",
    `ALTER TABLE box_batches ADD COLUMN IF NOT EXISTS lot_number TEXT`);

  // The rest of the tally sheet heading.
  // scanning surface makes the global keydown handler bail and silently
  // swallow scans (CLAUDE.md §4).
  for (const col of ["vendor", "ship_to", "bill_of_lading", "item_description",
                     "brand", "est_number", "grade", "remarks"]) {
    await run(`box_batches ${col}`,
      `ALTER TABLE box_batches ADD COLUMN IF NOT EXISTS ${col} TEXT`);
  }

  // 'scanned' or 'imported'.
  await run("box_batches source",
    `ALTER TABLE box_batches ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'scanned'`);

  // Which end of the process this session weighed.
  await run("box_batches direction",
    `ALTER TABLE box_batches ADD COLUMN IF NOT EXISTS direction TEXT NOT NULL
       DEFAULT 'incoming' CHECK (direction IN ('incoming', 'outgoing'))`);

  await run("box_batches direction index",
    `CREATE INDEX IF NOT EXISTS box_batches_direction_idx
       ON box_batches (tenant_id, direction, lot_id)`);

  // How many boxes the operator expects, entered before weighing starts.
  await run("box_batches expected_boxes",
    `ALTER TABLE box_batches ADD COLUMN IF NOT EXISTS expected_boxes INT`);

  // Where a box's weight actually came from.
  await run("batch_items entry_method",
    `ALTER TABLE batch_items ADD COLUMN IF NOT EXISTS entry_method TEXT
       CHECK (entry_method IN ('scanned', 'scale', 'keyed'))`);

  // Every weight is stored in pounds.
  await run("batch_items converted_from",
    `ALTER TABLE batch_items ADD COLUMN IF NOT EXISTS converted_from TEXT`);

  // Corrections.
  for (const ddl of [
    `ALTER TABLE batch_items ADD COLUMN IF NOT EXISTS original_weight NUMERIC(8,3)`,
    `ALTER TABLE batch_items ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ`,
    `ALTER TABLE batch_items ADD COLUMN IF NOT EXISTS edited_by UUID`,
    `ALTER TABLE batch_items ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ`,
    `ALTER TABLE batch_items ADD COLUMN IF NOT EXISTS voided_by UUID`,
    `ALTER TABLE batch_items ADD COLUMN IF NOT EXISTS void_reason TEXT`,
  ]) {
    await run("batch_items audit", ddl);
  }

  // A weight that was NOT measured.
  await run("batch_items is_estimated",
    `ALTER TABLE batch_items ADD COLUMN IF NOT EXISTS is_estimated BOOLEAN NOT NULL
       DEFAULT false`);

  // The client's own id for one box, minted when it is queued.
  await run("batch_items client_item_uuid",
    `ALTER TABLE batch_items ADD COLUMN IF NOT EXISTS client_item_uuid UUID`);

  // Free duplicate-scan protection: the same serial cannot land in a batch twice.
  await run("batch_items unique index", `
    CREATE UNIQUE INDEX IF NOT EXISTS batch_items_batch_serial_uniq
    ON batch_items (batch_id, serial) WHERE serial IS NOT NULL
  `);

  // The same, for boxes that have no serial to be keyed on.
  await run("batch_items client uuid index", `
    CREATE UNIQUE INDEX IF NOT EXISTS batch_items_batch_client_uuid_uniq
    ON batch_items (batch_id, client_item_uuid) WHERE client_item_uuid IS NOT NULL
  `);

  // A lot is sometimes weighed across several sessions — two people on two pallets,
  // or a session stopped and restarted — but it ships on ONE manifest.
  await run("manifest_groups", `
    CREATE TABLE IF NOT EXISTS manifest_groups (
      group_id         SERIAL PRIMARY KEY,
      tenant_id        UUID NOT NULL REFERENCES tenants(id),
      name             TEXT,
      lot_number       TEXT,
      vendor           TEXT,
      ship_to          TEXT,
      bill_of_lading   TEXT,
      item_description TEXT,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by       UUID
    )
  `);

  // ON DELETE CASCADE on the group only. A batch is never deleted, and the
  // composite key means the same session cannot be added to one group twice.
  await run("manifest_group_batches", `
    CREATE TABLE IF NOT EXISTS manifest_group_batches (
      group_id  INT NOT NULL REFERENCES manifest_groups(group_id) ON DELETE CASCADE,
      batch_id  INT NOT NULL REFERENCES box_batches(batch_id),
      position  INT NOT NULL DEFAULT 0,
      PRIMARY KEY (group_id, batch_id)
    )
  `);

  // Weighing sessions feeding one registration form.
  await run("registration_form_batches", `
    CREATE TABLE IF NOT EXISTS registration_form_batches (
      form_id   INT NOT NULL,
      batch_id  INT NOT NULL REFERENCES box_batches(batch_id),
      tenant_id UUID NOT NULL REFERENCES tenants(id),
      position  INT NOT NULL DEFAULT 0,
      PRIMARY KEY (form_id, batch_id)
    )
  `);
  await run("registration_form_batches index", `
    CREATE INDEX IF NOT EXISTS registration_form_batches_form_idx
      ON registration_form_batches (form_id)
  `);

  // Every removal, kept.
  await run("box_removal_history", `
    CREATE TABLE IF NOT EXISTS box_removal_history (
      id           SERIAL PRIMARY KEY,
      tenant_id    UUID NOT NULL REFERENCES tenants(id),
      action       TEXT NOT NULL,
      batch_id     INTEGER,
      item_id      INTEGER,
      lot_number   TEXT,
      summary      TEXT,
      reason       TEXT,
      details      JSONB,
      performed_by TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await run("box_removal_history index", `
    CREATE INDEX IF NOT EXISTS box_removal_history_created_idx
      ON box_removal_history (tenant_id, created_at DESC)
  `);

  // ══════════════════════════════════════════════════════════════════════════ Lot
  // registry — Phase A.

  await run("lots", `
    CREATE TABLE IF NOT EXISTS lots (
      lot_id      SERIAL PRIMARY KEY,
      tenant_id   UUID NOT NULL REFERENCES tenants(id),
      lot_number  TEXT NOT NULL,        -- N26244-01, canonical form only
      lot_date    DATE NOT NULL,        -- the day the number encodes (Pacific)
      seq         SMALLINT NOT NULL,    -- the -NN
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by  UUID,
      notes       TEXT,
      UNIQUE (tenant_id, lot_number),
      -- Two people cannot both take -01 on the same morning. Server-side
      -- issuance relies on this failing, not on checking first.
      UNIQUE (tenant_id, lot_date, seq)
    )
  `);

  // Lots that are not ours.
  await run("lots kind",
    `ALTER TABLE lots ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL
       DEFAULT 'internal' CHECK (kind IN ('internal', 'external'))`);

  // Every lot that already exists was issued by us, so the default is correct
  // for all of them and there is nothing to backfill.
  await run("lots lot_date nullable",
    `ALTER TABLE lots ALTER COLUMN lot_date DROP NOT NULL`);
  await run("lots seq nullable",
    `ALTER TABLE lots ALTER COLUMN seq DROP NOT NULL`);

  // Back-references. ADD COLUMN IF NOT EXISTS skips the whole clause, FK
  // included, when the column is already there — so re-running is safe.
  for (const table of [
    "nti_inventory",
    "noblesse_registration_forms",
    "box_batches",
    "manifest_groups",
    "noblesse_processing_order_items",
  ]) {
    await run(`${table} lot_id`,
      `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS lot_id INT REFERENCES lots(lot_id)`);
    await run(`${table} lot_id index`,
      `CREATE INDEX IF NOT EXISTS ${table}_lot_id_idx ON ${table} (lot_id)`);
  }

  // Raw in, processed out — both are stock, both carry the same lot.
  await run("nti_inventory stage", `
    ALTER TABLE nti_inventory
      ADD COLUMN IF NOT EXISTS stage TEXT NOT NULL DEFAULT 'raw'
      CHECK (stage IN ('raw', 'processed'))
  `);

  // Where a receipt came from.
  await run("noblesse_receipts source_type", `
    ALTER TABLE noblesse_receipts
      ADD COLUMN IF NOT EXISTS source_type TEXT
      CHECK (source_type IN ('adamsfoods', 'vendor'))
  `);
  await run("noblesse_receipts source_name",
    `ALTER TABLE noblesse_receipts ADD COLUMN IF NOT EXISTS source_name TEXT`);

  // The stored value was 'afdc' before the business name was settled.
  await run("noblesse_receipts source_type check drop",
    `ALTER TABLE noblesse_receipts DROP CONSTRAINT IF EXISTS noblesse_receipts_source_type_check`);
  await run("noblesse_receipts source_type rename",
    `UPDATE noblesse_receipts SET source_type = 'adamsfoods' WHERE source_type = 'afdc'`);
  await run("noblesse_receipts source_type check add", `
    ALTER TABLE noblesse_receipts
      ADD CONSTRAINT noblesse_receipts_source_type_check
      CHECK (source_type IN ('adamsfoods', 'vendor'))
  `);

  // Ties a processed stock row back to the order that produced it.
  await run("nti_inventory source_processing_order_id",
    `ALTER TABLE nti_inventory ADD COLUMN IF NOT EXISTS source_processing_order_id INT`);

  // One processed row per order, enforced by the database rather than trusted
  // to the code. Partial index because every raw row leaves it null.
  await run("nti_inventory processed order uniq", `
    CREATE UNIQUE INDEX IF NOT EXISTS nti_inventory_source_order_uniq
      ON nti_inventory (source_processing_order_id)
      WHERE source_processing_order_id IS NOT NULL
  `);

  // Registering product is what puts it in stock.
  await run("nti_inventory source_registration_form_id",
    `ALTER TABLE nti_inventory ADD COLUMN IF NOT EXISTS source_registration_form_id INT`);

  // The figure the FORM last claimed, kept apart from `weight`, which is what is
  // actually on hand after shipping.
  await run("nti_inventory registered_weight",
    `ALTER TABLE nti_inventory ADD COLUMN IF NOT EXISTS registered_weight NUMERIC`);
  await run("nti_inventory registered_cases",
    `ALTER TABLE nti_inventory ADD COLUMN IF NOT EXISTS registered_cases INT`);

  // One stock row per form, enforced by the database.
  await run("nti_inventory registration form uniq", `
    CREATE UNIQUE INDEX IF NOT EXISTS nti_inventory_source_reg_form_uniq
      ON nti_inventory (source_registration_form_id)
      WHERE source_registration_form_id IS NOT NULL
  `);

  // ══════════════════════════════════════════════════════════════════════════
  // Processing reports — the shop-floor record of one run.

  // What the paper form carries. Tracked in CASES only: the manager counts
  // cases, and real pounds come from the weighing benches.
  await run("noblesse_processing_reports", `
    CREATE TABLE IF NOT EXISTS noblesse_processing_reports (
      report_id        SERIAL PRIMARY KEY,
      tenant_id        UUID NOT NULL REFERENCES tenants(id),
      -- A report REFERENCES a lot and never mints one, like outgoing weighing.
      lot_id           INT NOT NULL REFERENCES lots(lot_id),
      processing_date  DATE,
      processing_type  TEXT,
      line_no          TEXT,
      customer         TEXT,
      description      TEXT,
      brand            TEXT,
      grade            TEXT,
      est_number       TEXT,
      pack_date        DATE,
      input_cases      INT NOT NULL,
      output_cases     INT,
      -- Recorded and printed, but it creates no stock: nobody weighed it.
      output_weight    NUMERIC(10,3),
      inedible_weight  NUMERIC(10,3),
      notes            TEXT,
      status           TEXT NOT NULL DEFAULT 'submitted'
                       CHECK (status IN ('submitted', 'accepted', 'rejected')),
      submitted_by     TEXT,
      submitted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      accepted_by      TEXT,
      accepted_at      TIMESTAMPTZ,
      reject_reason    TEXT,
      -- The form this was applied to, set when reception accepts.
      applied_form_id  INT,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await run("noblesse_processing_reports lot index", `
    CREATE INDEX IF NOT EXISTS noblesse_processing_reports_lot_idx
      ON noblesse_processing_reports (tenant_id, lot_id, status)
  `);

  // One row per pull off the rack. Cases only — no weight column, because the
  // manager does not have one.
  await run("noblesse_processing_report_pulls", `
    CREATE TABLE IF NOT EXISTS noblesse_processing_report_pulls (
      pull_id   SERIAL PRIMARY KEY,
      report_id INT NOT NULL REFERENCES noblesse_processing_reports(report_id) ON DELETE CASCADE,
      position  INT NOT NULL DEFAULT 0,
      cases     INT NOT NULL,
      notes     TEXT
    )
  `);
  await run("noblesse_processing_report_pulls index", `
    CREATE INDEX IF NOT EXISTS noblesse_processing_report_pulls_report_idx
      ON noblesse_processing_report_pulls (report_id)
  `);

  // Who ran the line. Free text until there is a reason for a roster table.
  await run("noblesse_processing_report_workers", `
    CREATE TABLE IF NOT EXISTS noblesse_processing_report_workers (
      worker_id SERIAL PRIMARY KEY,
      report_id INT NOT NULL REFERENCES noblesse_processing_reports(report_id) ON DELETE CASCADE,
      position  INT NOT NULL DEFAULT 0,
      name      TEXT NOT NULL
    )
  `);
  await run("noblesse_processing_report_workers index", `
    CREATE INDEX IF NOT EXISTS noblesse_processing_report_workers_report_idx
      ON noblesse_processing_report_workers (report_id)
  `);

  // ══════════════════════════════════════════════════════════════════════════
  // Adams side.

  await run("history old_data",
    `ALTER TABLE history ADD COLUMN IF NOT EXISTS old_data JSONB`);
  await run("history scan_image_key",
    `ALTER TABLE history ADD COLUMN IF NOT EXISTS scan_image_key TEXT`);

  // ══════════════════════════════════════════════════════════════════════════
  // Outgoing.

  await run("noblesse_shipments", `
    CREATE TABLE IF NOT EXISTS noblesse_shipments (
      shipment_id      SERIAL PRIMARY KEY,
      tenant_id        UUID NOT NULL REFERENCES tenants(id),
      ship_date        DATE NOT NULL,
      destination_type TEXT NOT NULL CHECK (destination_type IN ('adamsfoods', 'customer')),
      destination_name TEXT NOT NULL,
      ship_to          TEXT,
      bill_of_lading   TEXT,
      carrier          TEXT,
      driver           TEXT,
      status           TEXT NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft', 'shipped', 'cancelled')),
      notes            TEXT,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by       UUID,
      shipped_at       TIMESTAMPTZ,
      cancelled_at     TIMESTAMPTZ
    )
  `);

  await run("noblesse_shipments index",
    `CREATE INDEX IF NOT EXISTS noblesse_shipments_tenant_date_idx
       ON noblesse_shipments (tenant_id, ship_date DESC)`);

  // One line per lot on the load.
  await run("noblesse_shipment_items", `
    CREATE TABLE IF NOT EXISTS noblesse_shipment_items (
      item_id      SERIAL PRIMARY KEY,
      shipment_id  INT NOT NULL REFERENCES noblesse_shipments(shipment_id) ON DELETE CASCADE,
      tenant_id    UUID NOT NULL REFERENCES tenants(id),
      lot_id       INT NOT NULL REFERENCES lots(lot_id),
      nti_item_id  INT REFERENCES nti_inventory(id),
      weight       NUMERIC(10,3) NOT NULL,
      qty_cases    INTEGER,
      description  TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await run("noblesse_shipment_items index",
    `CREATE INDEX IF NOT EXISTS noblesse_shipment_items_shipment_idx
       ON noblesse_shipment_items (shipment_id)`);
  await run("noblesse_shipment_items lot index",
    `CREATE INDEX IF NOT EXISTS noblesse_shipment_items_lot_idx
       ON noblesse_shipment_items (lot_id)`);

  // Box weighing for an outgoing load.
  await run("shipment_batches", `
    CREATE TABLE IF NOT EXISTS shipment_batches (
      shipment_id INT NOT NULL REFERENCES noblesse_shipments(shipment_id) ON DELETE CASCADE,
      batch_id    INT NOT NULL REFERENCES box_batches(batch_id),
      tenant_id   UUID NOT NULL REFERENCES tenants(id),
      position    INT NOT NULL DEFAULT 0,
      PRIMARY KEY (shipment_id, batch_id)
    )
  `);

  // Two modules once defined `pdfs` with different shapes; this settles on one.
  await run("pdfs", `
    CREATE TABLE IF NOT EXISTS pdfs (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id   UUID REFERENCES tenants(id) ON DELETE CASCADE,
      file_name   TEXT,
      file_key    TEXT,
      file_url    TEXT,
      upload_date TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
};

// Retries cover the one failure that is not our fault: Neon dropping the connection
// between statements.
const migrate = async () => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await preflight();
      await steps();
      console.log(`[migrate] schema ready${attempt > 1 ? ` (attempt ${attempt})` : ""}`);
      return;
    } catch (err) {
      if (attempt >= RETRIES) throw err;
      console.error(`[migrate] attempt ${attempt} failed: ${err.message} — retrying in ${RETRY_DELAY_MS}ms`);
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }
};

module.exports = { migrate };
