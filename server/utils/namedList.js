const express = require("express");
const pool = require("./pg");
const verifyToken = require("../middleware/verifyToken.pg");
const requireRole = require("../middleware/requireRole");

// A managed list of names the dock picks from (items, customers).
// Suggested, not enforced. Nothing is hard-deleted.

const MAX_NAME = 120;
const MANAGERS = ["admin", "ntimanager"];

// Trimmed, single-spaced, upper case.
const normaliseName = (s) => String(s ?? "").trim().replace(/\s+/g, " ").toUpperCase();

// Letters and digits only, so "BONE-IN" and "BONE IN" are one name.
const KEY = (col) => `REGEXP_REPLACE(${col}, '[^A-Z0-9]', '', 'g')`;

const fmt = (r) => ({ id: r.id, name: r.name, active: r.active, uses: r.uses ?? 0 });

const validName = (raw) => {
  const name = normaliseName(raw);
  return name && name.length <= MAX_NAME ? name : null;
};

// table and usedColumn are constants from the caller, never request input.
const namedListRouter = ({ path, table, usedColumn, label }) => {
  const router = express.Router();

  const sameWords = (tenantId, name, exceptId = null) => pool.query(
    `SELECT id, name, active FROM ${table}
      WHERE tenant_id = $1 AND ${KEY("name")} = ${KEY("$2")}
        AND ($3::int IS NULL OR id <> $3)`,
    [tenantId, name, exceptId]
  );

  const sameAs = (res, existing) => res.status(409).json({
    code: "SAME_AS", existing: existing.name,
    error: `Already on the list as ${existing.name}${existing.active ? "" : " (retired)"}.`,
  });

  router.get(path, verifyToken, async (req, res) => {
    const all = req.query.all === "1";
    try {
      // Uses are counted the way names are stored.
      const result = await pool.query(
        `WITH used AS (
           SELECT UPPER(REGEXP_REPLACE(TRIM(${usedColumn}), '\\s+', ' ', 'g')) AS name,
                  COUNT(*)::int AS uses
             FROM box_batches
            WHERE tenant_id = $1 AND direction = 'outgoing' AND ${usedColumn} IS NOT NULL
            GROUP BY 1)
         SELECT d.id, d.name, d.active, COALESCE(u.uses, 0) AS uses
           FROM ${table} d
           LEFT JOIN used u ON u.name = d.name
          WHERE d.tenant_id = $1 AND ($2 OR d.active)
          ORDER BY d.active DESC, uses DESC, d.name`,
        [req.tenantId, all]
      );
      res.json(result.rows.map(fmt));
    } catch (err) {
      console.error(`list ${label}:`, err);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });

  router.post(path, verifyToken, requireRole(...MANAGERS), async (req, res) => {
    const name = validName(req.body?.name);
    if (!name) return res.status(400).json({ error: `name must be 1 to ${MAX_NAME} characters` });
    try {
      const found = (await sameWords(req.tenantId, name)).rows[0];
      if (found && found.name !== name) return sameAs(res, found);
      if (found) {
        // The exact name: bring it back if retired.
        const r = await pool.query(
          `UPDATE ${table} SET active = true WHERE id = $1 AND tenant_id = $2 RETURNING *`,
          [found.id, req.tenantId]
        );
        return res.status(200).json({ ...fmt(r.rows[0]), created: false, restored: !found.active });
      }
      const r = await pool.query(
        `INSERT INTO ${table} (tenant_id, name, created_by) VALUES ($1, $2, $3) RETURNING *`,
        [req.tenantId, name, req.userId || null]
      );
      res.status(201).json({ ...fmt(r.rows[0]), created: true });
    } catch (err) {
      if (err.code === "23505") return res.status(409).json({ code: "SAME_AS", existing: name, error: `Already on the list as ${name}.` });
      console.error(`add ${label}:`, err);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });

  // Retire, restore, or correct the spelling.
  router.patch(`${path}/:id`, verifyToken, requireRole(...MANAGERS), async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid id" });
    const { active } = req.body || {};
    const hasName = req.body?.name !== undefined;
    if (active !== undefined && typeof active !== "boolean") {
      return res.status(400).json({ error: "active must be true or false" });
    }
    if (!hasName && active === undefined) return res.status(400).json({ error: "Nothing to change" });
    const name = hasName ? validName(req.body.name) : null;
    if (hasName && !name) return res.status(400).json({ error: `name must be 1 to ${MAX_NAME} characters` });
    try {
      if (name) {
        const clash = (await sameWords(req.tenantId, name, id)).rows[0];
        if (clash) return sameAs(res, clash);
      }
      const r = await pool.query(
        `UPDATE ${table}
            SET name = COALESCE($1, name), active = COALESCE($2, active)
          WHERE id = $3 AND tenant_id = $4 RETURNING *`,
        [name, active ?? null, id, req.tenantId]
      );
      if (!r.rows.length) return res.status(404).json({ error: "Not found" });
      res.json(fmt(r.rows[0]));
    } catch (err) {
      if (err.code === "23505") return res.status(409).json({ code: "SAME_AS", existing: name, error: `Already on the list as ${name}.` });
      console.error(`update ${label}:`, err);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });

  return router;
};

module.exports = { namedListRouter, normaliseName };
