// Importing a hand-written tally sheet as a session.

const router = require("express").Router();
const pool = require("../../utils/pg");
const verifyToken = require("../../middleware/verifyToken.pg");
const { parseTallySheet } = require("../../utils/tallySheet");
const { kgToLb, sumWeights, trimTrailingZeros } = require("../../utils/weight");
const { lotColumns } = require("../../utils/lotRegistry");
const { parseWeighedOn, parseSheetDay } = require("../../utils/weighedAt");
const { upload } = require("../../utils/aws");
const readXlsxFile = require("read-excel-file/node");
const { scanLimiter } = require("../../middleware/rateLimits");
const { UNITS, DECIMAL_RE, MAX_WEIGHT_THOUSANDTHS, toThousandths } = require("./helpers/validate");

// Importing a hand-entered tally sheet, for lots whose labels carry no barcode.
router.post("/box-batches/import", verifyToken, scanLimiter, upload.single("file"),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const dryRun = String(req.body.dryRun) === "true";
    const clientUuid = req.body.clientUuid;
    if (!dryRun && !clientUuid) {
      return res.status(400).json({ error: "clientUuid is required to commit an import" });
    }

    let parsed;
    try {
      const rows = await readXlsxFile(req.file.buffer);
      parsed = parseTallySheet(rows);
    } catch (err) {
      // A parse or checksum failure is the operator's problem to fix in the
      // spreadsheet, so it comes back as a 400 with the specific reason.
      return res.status(400).json({
        error: err.message,
        code: err.code || "PARSE_FAILED",
        details: err.details || null,
      });
    }

    // The unit is not on the sheet. Canada and Mexico ship in kilograms, so
    // this cannot be assumed — the operator picks it and it is recorded.
    const weightUnit = String(req.body.weightUnit || "LB").toUpperCase();
    if (!UNITS.has(weightUnit)) {
      return res.status(400).json({ error: "weightUnit must be LB or KG" });
    }

    const overLimit = parsed.weights.filter((w) => toThousandths(w) > MAX_WEIGHT_THOUSANDTHS);
    if (overLimit.length) {
      return res.status(400).json({
        code: "IMPLAUSIBLE_WEIGHT",
        error: `Sheet contains ${overLimit.length} weight(s) outside the plausible range`,
        details: { weights: overLimit.slice(0, 5) },
      });
    }

    // The heading may be corrected in the preview before committing — real sheets
    // carry things like "P12 N26230-01" in the lot cell.
    //
    // Stored in block capitals, like every other heading in this app: the paper
    // forms are filled in caps, and a sheet typed as "ibp" would otherwise sit
    // apart from the same vendor entered anywhere else. Applied here rather than
    // at the INSERT so the preview shows exactly what will be filed.
    const pick = (override, fromSheet) => {
      const v = typeof override === "string" ? override.trim() : "";
      const value = v || fromSheet || null;
      return typeof value === "string" ? value.toUpperCase() : value;
    };

    // Converted only after the sheet has been reconciled against its own checksums
    // in the unit it was written in.
    const isKg = weightUnit === "KG";
    const converted = isKg
      ? parsed.weights.map((w) => trimTrailingZeros(kgToLb(w)))
      : parsed.weights;
    const storedUnit = "LB";

    // A weight the sheet got wrong.
    //
    // The checksums still have to pass first — they prove the sheet adds up to
    // what it claims, which is a different thing from the figure being right.
    // Someone reading the paper can see a transcription error the arithmetic
    // never will, so this is a per-box override ON TOP of a validated sheet,
    // recorded rather than silent: the sheet's figure goes to original_weight
    // exactly as a mid-session correction does.
    //
    // In POUNDS, because the preview being corrected is in pounds — on a KG
    // sheet the operator is looking at converted figures, not what was written.
    let edits = [];
    if (req.body.weightEdits) {
      try {
        edits = JSON.parse(req.body.weightEdits);
        if (!Array.isArray(edits)) throw new Error("not an array");
      } catch {
        return res.status(400).json({ error: "weightEdits must be a JSON array" });
      }
    }

    // Null where the sheet stands, the sheet's figure where it was overridden.
    const sheetFigures = converted.map(() => null);
    for (const e of edits) {
      const i = Number(e && e.index);
      const w = e && typeof e.weight === "string" ? e.weight.trim() : "";
      if (!Number.isInteger(i) || i < 0 || i >= converted.length) {
        return res.status(400).json({ error: `weightEdits: no box at index ${e && e.index}` });
      }
      if (!DECIMAL_RE.test(w)) {
        return res.status(400).json({
          error: `weightEdits: box ${i + 1} must be a decimal with at most 3 places`,
        });
      }
      if (toThousandths(w) > MAX_WEIGHT_THOUSANDTHS) {
        return res.status(400).json({
          code: "IMPLAUSIBLE_WEIGHT",
          error: `weightEdits: box ${i + 1} is outside the plausible range`,
        });
      }
      // Re-editing the same box keeps the SHEET's figure as the original, not
      // the previous edit.
      if (sheetFigures[i] === null) sheetFigures[i] = converted[i];
      converted[i] = trimTrailingZeros(w);
    }

    const editedCount = sheetFigures.filter((v) => v !== null).length;
    // Recomputed once the overrides are in, so the stored total is the total of
    // what is stored rather than what the sheet declared.
    const subtotal = (isKg || editedCount)
      ? trimTrailingZeros(sumWeights(converted))
      : parsed.computed.subtotal;

    // The day printed on the sheet is when the boxes were weighed — which is
    // rarely the day the file is uploaded. Correctable in the preview like the
    // rest of the heading; a sheet whose date cannot be read still imports, and
    // says so, rather than refusing over a heading field.
    const sheetDay = parseSheetDay(parsed.date);
    const typedDay = typeof req.body.weighedOn === "string" ? req.body.weighedOn.trim() : "";
    const checkedDay = parseWeighedOn(typedDay || sheetDay);
    if (typedDay && !checkedDay.ok) {
      return res.status(400).json({ code: "BAD_DATE", error: checkedDay.error });
    }
    const weighedOn = checkedDay.ok ? checkedDay.value : null;

    const summary = {
      lotNumber: pick(req.body.lotNumber, parsed.lotNumber),
      vendor: pick(req.body.vendor, parsed.vendor),
      shipTo: pick(req.body.shipTo, parsed.shipTo),
      itemDescription: pick(req.body.itemDescription, parsed.itemDescription),
      date: parsed.date,
      // What will actually be filed as the weighing day, and why it is not the
      // sheet's own date when that could not be read.
      weighedOn,
      dateNote: weighedOn ? null
        : (parsed.date ? `The date on this sheet ("${parsed.date}") could not be read.`
          : "This sheet carries no date."),
      weightUnit: storedUnit,
      convertedFrom: weightUnit === "KG" ? "KG" : null,
      boxes: parsed.computed.boxes,
      subtotal,
      // So the preview and the response can say the stored total no longer
      // matches the paper, and why.
      edited: editedCount,
      declared: parsed.declared,
      weights: converted,
      // What the sheet itself said, so the preview can show the operator the
      // figures they will recognise from the paper.
      asWritten: weightUnit === "KG"
        ? { unit: "KG", subtotal: parsed.computed.subtotal, weights: parsed.weights }
        : null,
    };

    if (dryRun) return res.json({ preview: true, ...summary });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // An imported tally is incoming-side, so its lot is created or resolved like
      // any other.
      const lot = await lotColumns(req.tenantId, req.userId, summary.lotNumber, client);
      // Report it as STORED, not as the sheet spelled it, so the operator sees
      // that "N26244-3" was filed as "N26244-03".
      summary.lotNumber = lot.lotNumber;

      const batch = await client.query(
        `INSERT INTO box_batches
           (tenant_id, client_uuid, lot_number, vendor, ship_to, item_description,
            source, status, closed_at, lot_id, weighed_on)
         VALUES ($1, $2, $3, $4, $5, $6, 'imported', 'closed', now(), $7, $8)
         ON CONFLICT (client_uuid) DO NOTHING
         RETURNING batch_id`,
        [req.tenantId, clientUuid, lot.lotNumber, summary.vendor,
         summary.shipTo, summary.itemDescription, lot.lotId, summary.weighedOn]
      );

      // A retried upload finds its own batch rather than importing twice.
      if (!batch.rows.length) {
        await client.query("ROLLBACK");
        const existing = await pool.query(
          `SELECT batch_id FROM box_batches WHERE client_uuid = $1 AND tenant_id = $2`,
          [clientUuid, req.tenantId]
        );
        if (!existing.rows.length) return res.status(409).json({ error: "clientUuid already used" });
        return res.json({ ...summary, batchId: existing.rows[0].batch_id, reused: true });

      }

      const batchId = batch.rows[0].batch_id;

      // is_manual is true because none of these came from a barcode; the
      // batch's source column is what marks the whole lot as imported.
      await client.query(
        `INSERT INTO batch_items
           (tenant_id, batch_id, weight, weight_unit, is_manual, converted_from,
            original_weight, edited_at, edited_by)
         SELECT $1, $2, t.w, $3, true, $6,
                t.o,
                CASE WHEN t.o IS NULL THEN NULL ELSE now() END,
                CASE WHEN t.o IS NULL THEN NULL ELSE $7::uuid END
           FROM UNNEST($4::numeric[], $5::numeric[]) AS t(w, o)`,
        // edited_by is a UUID, like every other writer of this column — the
        // username is an email and the cast is explicit so a CASE arm cannot
        // infer text.
        [req.tenantId, batchId, storedUnit, summary.weights, sheetFigures,
         summary.convertedFrom, req.userId || null]
      );

      await client.query("COMMIT");
      return res.status(201).json({ ...summary, batchId, reused: false });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("import tally:", err);
      return res.status(500).json({ error: "Internal Server Error" });
    } finally {
      client.release();
    }
  });

module.exports = router;
