// Every schema change for the Noblesse side, in one place, run IN ORDER before
// the server starts listening.
//
// Why this file exists (CLAUDE.md §8, "fire-and-forget migrations race"): route
// modules used to fire their own CREATE TABLE statements at require-time without
// awaiting them. A pool hands concurrent queries to different connections, so a
// child table could reach the server before its parent existed and die with
// `relation "manifest_groups" does not exist` — and then never retry, leaving
// the table missing for the whole boot. That happened in production.
//
// Rules this file keeps:
//   - Sequential. Every statement awaits the one before it.
//   - Idempotent. IF NOT EXISTS / ADD COLUMN IF NOT EXISTS / DROP ... IF EXISTS,
//     so a retry from the top after a mid-run failure is always safe.
//   - Loud. A failure THROWS and boot aborts. A server that comes up with a
//     missing table is the exact bug this file kills; pm2 restarts a failed
//     boot, and a transient Neon connection drop gets a few retries first.
//   - `tenants` is NOT created here. It predates this file, lives in production
//     with a shape this repo never defined, and every table references it. We
//     check it is there and refuse to boot without it.
//   - Adams-side modules (production, snapshots, history, s3) keep their own
//     small IF NOT EXISTS statements at require-time. They reference nothing
//     created here, and index.js requires them only after this has finished,
//     so they cannot race it.

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

// Everything references tenants(id). If it is missing this is not a database
// we know how to initialise, and starting the server against it would only
// produce a stream of FK errors later.
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
  // ══════════════════════════════════════════════════════════════════════════

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

  // form_id was originally NOT NULL REFERENCES noblesse_registration_forms(id) ON
  // DELETE CASCADE, which makes a "deleted" audit row impossible to keep: log
  // before the delete and the cascade removes it, log after and the FK has
  // nothing to point at. An audit trail has to outlive the row it describes, so
  // the constraint goes. Both statements are no-ops once applied.
  await run("noblesse_registration_history drop form fk", `
    ALTER TABLE noblesse_registration_history
    DROP CONSTRAINT IF EXISTS noblesse_registration_history_form_id_fkey
  `);
  await run("noblesse_registration_history form_id nullable",
    `ALTER TABLE noblesse_registration_history ALTER COLUMN form_id DROP NOT NULL`);

  // ══════════════════════════════════════════════════════════════════════════
  // Box weighing — moved verbatim from routes/boxes.pg.js, original order.
  // ══════════════════════════════════════════════════════════════════════════

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

  // raw_barcode is nullable only because of the manual-entry fallback: a damaged
  // or unbarcoded label has no payload to store. The CHECK keeps the guarantee
  // that every *scanned* row carries the barcode it came from.
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

  // The rest of the tally sheet heading. Stored on the batch so a past session
  // reprints as a complete form rather than one missing its header.
  for (const col of ["vendor", "ship_to", "bill_of_lading", "item_description"]) {
    await run(`box_batches ${col}`,
      `ALTER TABLE box_batches ADD COLUMN IF NOT EXISTS ${col} TEXT`);
  }

  // 'scanned' or 'imported'. A barcode-verified lot and one keyed in by hand on
  // an iPad are both legitimate, but they carry different confidence and anyone
  // reconciling a shipment needs to be able to tell them apart.
  await run("box_batches source",
    `ALTER TABLE box_batches ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'scanned'`);

  // Every weight is stored in pounds. Non-American suppliers label in kilograms,
  // so those are converted on the way in; this column records that it happened.
  // It is provenance, not a second weight — the original figure is recoverable
  // from raw_barcode, which still holds the kilogram payload it was read from.
  await run("batch_items converted_from",
    `ALTER TABLE batch_items ADD COLUMN IF NOT EXISTS converted_from TEXT`);

  // Corrections. A weight that came off a barcode was verified against that
  // barcode; once a person overtypes it that is no longer true, so the row has
  // to carry its own history rather than quietly becoming indistinguishable
  // from a scanned one. original_weight holds what the label actually said.
  //
  // Removal is a soft void. A box that was scanned and then taken off the tally
  // is a fact about the shipment, and hard-deleting the row would erase the
  // only record that it ever happened.
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

  // Free duplicate-scan protection: the same serial cannot land in a batch twice.
  await run("batch_items unique index", `
    CREATE UNIQUE INDEX IF NOT EXISTS batch_items_batch_serial_uniq
    ON batch_items (batch_id, serial) WHERE serial IS NOT NULL
  `);

  // A lot is sometimes weighed across several sessions — two people on two
  // pallets, or a session stopped and restarted — but it ships on ONE manifest.
  //
  // The group stores which sessions it covers rather than copying their weights.
  // Copying would fork the truth: correcting a box afterwards would fix the
  // session and leave the manifest stale, which is exactly the disagreement
  // this whole feature exists to prevent.
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

  // Weighing sessions feeding one registration form. A form records what came
  // in; box weighing is how that number is actually measured, so this ties the
  // two together instead of having someone read a total off a manifest and
  // retype it.
  //
  // References, not a copy — the same reasoning as manifest groups. The form's
  // own original_weight stays a stable record, and the live total is compared
  // against it so a correction made after the fact shows up as a discrepancy
  // rather than silently rewriting a filed form.
  //
  // No foreign key to noblesse_registration_forms. Historically that was
  // because the two tables were created by different modules with no ordering
  // guarantee; this file fixes the ordering, so the FK is now *possible* — but
  // adding it is a Phase D change (it fails if any orphan link exists) and is
  // not made here. Orphans are still handled explicitly: deleting a form clears
  // its links, and deleting a session is refused while a form points at it.
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

  // Every removal, kept. Voiding leaves its trace on the row itself, but an
  // erased box or a deleted session leaves nothing at all — and "where did that
  // box go" is precisely the question a reconciliation asks months later.
  //
  // NO foreign keys to box_batches or batch_items, deliberately: an audit row
  // has to outlive the row it describes. With an FK, logging before the delete
  // gets cascaded away and logging after has nothing to point at. The same
  // lesson is written into noblesse_registration_history above.
  //
  // `details` carries the destroyed row itself, because after a permanent
  // delete this is the only copy that will ever exist.
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

  // ══════════════════════════════════════════════════════════════════════════
  // Lot registry — Phase A. Additive, nullable, zero behaviour change.
  //
  // NTI is the processor, AdamsFoods the distributor. A lot is issued once when
  // product arrives at NTI and only ever *referenced* after that — through
  // processing, out to AdamsFoods or a customer, and back in again if AdamsFoods returns
  // it. Six free-text lot columns across five tables cannot express that; this
  // table is the one thing that owns a lot's identity. It is deliberately thin:
  // the registration form stays the lot's descriptor and nti_inventory keeps
  // the quantities. We are adding a key, not moving data.
  //
  // Every lot_id below is NULLABLE and nothing reads it yet. Phase B backfills
  // them from the text columns (dry-run first, unmatched rows reviewed by
  // hand); Phase C starts writing them; Phase D — a separate decision — makes
  // them NOT NULL and drops the text. Until then the text columns remain
  // exactly as authoritative as they are today.
  // ══════════════════════════════════════════════════════════════════════════

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

  // Raw in, processed out — both are stock, both carry the same lot. Today
  // processed output never re-enters inventory at all (it is recorded on the
  // processing order and vanishes from stock); this column is what lets it
  // come back without being mistaken for the raw it was cut from. Existing
  // rows are all raw, so the DEFAULT is also the backfill for this column.
  await run("nti_inventory stage", `
    ALTER TABLE nti_inventory
      ADD COLUMN IF NOT EXISTS stage TEXT NOT NULL DEFAULT 'raw'
      CHECK (stage IN ('raw', 'processed'))
  `);

  // Where a receipt came from. Without it, a lot returning from AdamsFoods for a
  // second pass and a fresh delivery from a packer look identical, and the
  // timeline cannot say which it was. Nullable: existing receipts predate the
  // question.
  await run("noblesse_receipts source_type", `
    ALTER TABLE noblesse_receipts
      ADD COLUMN IF NOT EXISTS source_type TEXT
      CHECK (source_type IN ('adamsfoods', 'vendor'))
  `);
  await run("noblesse_receipts source_name",
    `ALTER TABLE noblesse_receipts ADD COLUMN IF NOT EXISTS source_name TEXT`);

  // The stored value was 'afdc' before the business name was settled. The
  // column already exists, so the ADD COLUMN above never revisits its CHECK —
  // the constraint has to be replaced on its own. Drop, migrate any rows, then
  // re-add: idempotent in that order, and the rows have to move BEFORE the new
  // constraint exists or adding it would fail on them.
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
  //
  // Processing used to deduct raw and record output_weight ON THE ORDER, so
  // after NTI processed a lot there was nothing in stock to ship. The output
  // now comes back as its own nti_inventory row, and this column is what makes
  // that idempotent: editing the output later adjusts the existing row instead
  // of adding a second one.
  await run("nti_inventory source_processing_order_id",
    `ALTER TABLE nti_inventory ADD COLUMN IF NOT EXISTS source_processing_order_id INT`);

  // One processed row per order, enforced by the database rather than trusted
  // to the code. Partial index because every raw row leaves it null.
  await run("nti_inventory processed order uniq", `
    CREATE UNIQUE INDEX IF NOT EXISTS nti_inventory_source_order_uniq
      ON nti_inventory (source_processing_order_id)
      WHERE source_processing_order_id IS NOT NULL
  `);

  // ══════════════════════════════════════════════════════════════════════════
  // Adams side. `history` and `inventory` predate this repo, like `tenants` —
  // they are never created here, only altered. These two columns used to be
  // fired at module load from routes/history.pg.js with a swallowed .catch();
  // that is the pattern this file exists to remove, and it also broke a whole
  // test suite, because a mocked pool returns undefined and `.catch` of
  // undefined throws before the suite can even load.
  // ══════════════════════════════════════════════════════════════════════════

  await run("history old_data",
    `ALTER TABLE history ADD COLUMN IF NOT EXISTS old_data JSONB`);
  await run("history scan_image_key",
    `ALTER TABLE history ADD COLUMN IF NOT EXISTS scan_image_key TEXT`);

  // Two modules used to define `pdfs`, with DIFFERENT shapes: routes/s3.pg.js
  // (live, mounted in index.js) uses a uuid id and a tenants FK, while the
  // legacy routes/s3.js used a SERIAL id and a bare TEXT tenant. Both were
  // CREATE TABLE IF NOT EXISTS, so on a fresh database whichever ran first
  // silently won. This is the live shape, which is what production has.
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

// Retries cover the one failure that is not our fault: Neon dropping the
// connection between statements. A genuine schema error will fail all three
// times, and the last error is the one that surfaces.
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
