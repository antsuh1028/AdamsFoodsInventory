// One scanned Adams Foods box: read from its label, and checked for a duplicate in stock.

const crypto = require("crypto");
const { parseGs1 } = require("./gs1");
const { toPounds, toThousandths, WeightError } = require("./weight");

const MAX_BOX_THOUSANDTHS = 2000n * 1000n;

// One scanned label as a stored box, weight in pounds. Refuses anything that is not a weighed box label.
const boxFromBarcode = (raw, username) => {
  const text = String(raw || "").trim();
  if (!text) return { error: { code: "NO_BARCODE", message: "Nothing was scanned." } };
  let parsed;
  try { parsed = parseGs1(text); } catch (err) {
    if (err && err.code === "NO_WEIGHT_AI") {
      return { error: { code: "NO_WEIGHT", message: "That label has no weight on it, so it is not a box label." } };
    }
    return { error: { code: "BAD_BARCODE", message: "That barcode could not be read." } };
  }
  if (!parsed || !parsed.weight) {
    return { error: { code: "NO_WEIGHT", message: "That label has no weight on it, so it is not a box label." } };
  }
  let lb;
  try {
    lb = toPounds(parsed.weight.value, parsed.weight.unit);
    const t = toThousandths(lb.weight);
    if (t <= 0n || t > MAX_BOX_THOUSANDTHS) throw new WeightError("BAD_WEIGHT", "out of range");
  } catch {
    return { error: { code: "BAD_WEIGHT", message: "The weight on that label is not a plausible box weight." } };
  }
  return {
    box: {
      weight: lb.weight,
      scannedWeight: parsed.weight.value,
      scannedUnit: parsed.weight.unit,
      gtin: parsed.gtin || null,
      serial: parsed.serial || null,
      lot: parsed.lot || null,
      itemCode: parsed.itemCode || null,
      customerPart: parsed.customerPart || null,
      packDate: parsed.productionDate || parsed.packagingDate || null,
      raw: text,
      scanId: crypto.randomUUID(),
      scannedAt: new Date().toISOString(),
      scannedBy: username || null,
    },
  };
};

// A packer box is one of a kind: GTIN plus serial. Labels without a serial cannot be told apart.
const findSameBox = (client, tenantId, box) => {
  if (!box.serial) return Promise.resolve(null);
  const probe = box.gtin ? [{ gtin: box.gtin, serial: box.serial }] : [{ serial: box.serial }];
  return client.query(
    `SELECT id, location, lot FROM inventory WHERE tenant_id = $1 AND boxes @> $2::jsonb LIMIT 1`,
    [tenantId, JSON.stringify(probe)]
  ).then((r) => r.rows[0] || null);
};

module.exports = { boxFromBarcode, findSameBox };
