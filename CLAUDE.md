# CLAUDE.md — working context

> ## ⏸ PAUSED MID-TASK — read this first (2026-09-02)
>
> Branch **`box-weighing-v2`** holds finished, committed, unreleased work.
> **`master` = `dd13b58` = what production is actually running.** Don't deploy
> `box-weighing-v2` without being asked.
>
> ### Done and committed (`a5444cd`)
> **KG→LB conversion.** Every weight is now stored and printed in pounds.
> - `server/utils/weight.js` + byte-identical mirror `client/src/utils/weight.js`
>   (a test enforces the mirror, exactly like `gs1.js`). Exact integer-ratio
>   conversion in BigInt; carries a `/* global BigInt */` directive because CRA's
>   linter otherwise fails the build on the mirrored copy.
> - Conversion happens **server-side, after the barcode check** in `validateItem`.
>   It cannot move to the client: the server re-derives the weight from
>   `raw_barcode`, so a pre-converted client weight is rejected as `UNIT_MISMATCH`.
> - New column `batch_items.converted_from` (provenance only, not a second
>   weight — the KG figure is recoverable from `raw_barcode`).
> - `scanQueue` keeps two weights per row: `weight`/`weightUnit` as scanned (what
>   goes on the wire) and `displayWeight` in LB (what the grid, totals and
>   manifest show). Don't collapse these.
> - **Per-box conversion, then sum** — never sum-then-convert. On a 7-box sample
>   the two disagree by 0.001 lb, which leaves a manifest whose column does not
>   add up to its own total. `weight.test.js` pins this with real figures.
>
> ### Still to build — all four agreed with the user, none started
> 1. **Row editing.** Delete/void any row (even synced) and edit a weight, with an
>    audit trail: flag the row as adjusted and retain the original barcode weight.
>    Needs `PATCH` + `DELETE /box-batches/:id/items/:itemId`. **Admins must be able
>    to edit and delete rows on already-stored batches, not just live ones** — gate
>    with `requireRole("admin")` server-side, per §8 (a client-side check is not a
>    control). Prefer a soft void so the audit survives.
> 2. **Merged manifests.** A *saved, reopenable* group — tick several sessions,
>    name it, reprint later and get the identical form. New tables
>    (`manifest_groups` + a join table), not a print-time-only selection.
> 3. **In-app numeric keypad** for manual weight entry, so iPadOS never needs to
>    show its keyboard (a paired BT scanner is an HID keyboard and suppresses it).
>    Inputs go `readOnly` and the keypad drives them.
> 4. The tally-sheet **date is still discarded** on import — see §4 Known gap.
>
> ### State at the pause
> Full suite **387 passed / 6 failed** (the same six pre-existing — see §7).
> Client builds clean (523.3 kB). `server/scripts/tally-accuracy.js` is a local
> gitignored script that re-parses all 55 workbooks in `2026/`; last run 55/55
> with 55/55 checksum agreement.
>
> ### Two things the user raised that were NOT decided
> - iPad keyboard: they should check whether their scanner has an *iOS keyboard
>   toggle* config barcode. That fixes typing device-wide, not just in this app.
> - 11 of the 55 sheets have messy lot cells (`"P12 N26230-01"`, `"N26244-3"`).
>   The editable preview covers it; pre-filling from the filename would remove
>   most of the friction. Offered, not built.


Orientation for a fresh session. The README covers the stack; this file covers
what is **not** derivable from reading the code, plus the traps that have already
cost real debugging time.

---

## 1. Two apps, one codebase

| | Adams Foods | Noblesse Trading |
|---|---|---|
| Entry | `client/src/pages/HomeScreen.jsx` + navbar | `client/src/pages/NoblesseScreen.jsx` |
| Login | `/login` | `/noblesse-login` |
| Nav | top navbar | hamburger **drawer** (`useDisclosure`) |

Noblesse is tabbed: Incoming Records · Registration Forms · **Weight Manifests**.
Box weighing lives under Noblesse (it is a Noblesse business process), not in the
Adams navbar — a deliberate placement, not an accident.

`NoblesseScreen` polls every 60s and bumps a `refreshSignal` counter. **Tabs that
load their own data must watch that signal**, comparing it against a `useRef` so
the mount effect and the signal effect do not double-fetch. A tab that only
fetches on mount looks live but is frozen at page load — this bug shipped once.

---

## 2. Branch / deploy state

- Working branch: `barcode-integration` (~34 commits ahead of `master`).
- **Production runs `master` and deliberately excludes the box-weighing feature.**
  Master was built by branching and removing barcode-only files, not by
  cherry-picking. Do not merge the branch to master without being asked.
- `npm run deploy` = `deploy:server` (ssh + git pull + npm install + pm2 restart)
  then `deploy:client` (react build + scp).

### Deploy landmines

1. **Two PM2 daemons.** A root daemon (`pm2-root.service`) holds port 3001;
   `deploy:server` restarts *admin's* copy, which dies on `EADDRINUSE` — and still
   prints a tick. **Every server deploy silently no-opped for a while.**
   Permanent fix (not yet applied): `sudo pm2 delete adamsfoodsinventory && sudo pm2 save`,
   then disable `pm2-root.service`. A reboot restores the conflict.
2. `deploy:server` uses `npm install`, which dirties `server/package-lock.json` on
   the box and makes the next `git pull` refuse. Should be `npm ci`.

---

## 3. Invariants — break these and data goes silently wrong

**Weights are decimal strings, end to end.** Barcode → parser → HTTP → `NUMERIC(8,3)`.
No float ever enters the path. Comparisons and running totals use **integer
thousandths**. `"76.20"` and `"76.2"` must compare equal.

**The client is not trusted.** `validateItem` in `server/routes/boxes.pg.js`
re-parses `rawBarcode` server-side and rejects `WEIGHT_MISMATCH` / `UNIT_MISMATCH`.
Everything persisted comes from the server's own parse.

**`server/utils/gs1.js` and `client/src/utils/gs1.js` are byte-identical.**
`server/tests/gs1.test.js` fails if they drift. Edit both.

**GS1 fields are not at fixed offsets.** AIs 10/21/30/240 are variable length; one
of them shifts every byte after it. Walk AI by AI. And `310n` = KG, `320n` = LB,
with the last AI digit as the decimal position — confusing these is a 2.2x or 10x
error on every box.

**A scan is never deleted until the server confirms that specific record.**
`scanQueue.flush()` marks (`markSynced` / `markDuplicate` / `markRejected`) rather
than deleting, so the operator's grid outlives its own flush. Losing a box is
worse than sending one twice; the server is idempotent on `(batch_id, serial)`.

**Duplicates must not count.** The same box scanned twice is one box. A duplicate
is shown struck-through, backed out of the running total, and excluded from the
printed manifest.

**Lot numbers are `N{YY}{JJJ}-{NN}`** (year, Julian day, sequence). Sorting
alphabetically is chronological. Dates are **Pacific**, via `shared.jsx`
(`today()`, `lotNumberForDate()`, `PACIFIC_TZ`) — never `new Date()` locals.

---

## 4. Box weighing — the map

Two ingestion paths converge on the same `box_batches` / `batch_items` shape, told
apart by `box_batches.source` (`scanned` | `imported`).

**Path A — barcode scan**

```
scanInput.js           keystroke assembler (the scanner is a USB/BT keyboard)
  -> gs1.js            parse
  -> scanQueue.js      durable queue; decides what is safe to delete
  -> scanStore.js      IndexedDB backend, in-memory fallback (durable:false)
  -> useScanSession.js timers, wake lock, beforeunload
  -> boxScanner.jsx + ScanSheet.jsx    operator UI
```

**Path B — hand-entered tally** (lots whose labels carry no barcode; weights
written into Excel on an iPad with an Apple Pencil, then uploaded)

```
ImportTally.jsx -> POST /box-batches/import (dryRun, then commit)
  -> server/utils/tallySheet.js
```

`tallySheet.js` locates everything by **content, not cell coordinates** — these
files are hand-edited and rows shift. It validates against the sheet's own three
checksums (per-row total, Total Boxes, Subtotal) and refuses on mismatch. The
heading is correctable in the preview; **the weights deliberately are not**,
because they passed those checksums.

**Reading back:** `WeightManifestTab.jsx` (list, filters, expand, reprint),
`printWeightManifest.js` (reproduces the paper tally: 10 weights/row, MIN_ROWS 16,
`@page { margin: 22mm 12mm 12mm }`).

`scannerDiagnostic.jsx` exists to configure a new scanner — it shows raw keystrokes.

### Known gap

The tally parser reads the **date printed on the sheet**, shows it in the preview,
then discards it: `box_batches` has no date column and the import INSERT omits it.
Reprinting an imported manifest therefore prints the *upload* date. One column plus
one line in the INSERT, if it ever matters.

---

## 5. Postgres notes

- Migrations are **idempotent, at module load**: `CREATE TABLE IF NOT EXISTS`,
  `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`. No migration tool — a deliberate call.
- Everything is tenant-scoped on `tenant_id`. Every lookup filters by it, including
  the "already exists" branches, so a UUID from another tenant cannot be adopted.
- **Neon drops idle connections.** `server/utils/pg.js` sets
  `idleTimeoutMillis: 120_000` — it must exceed the client's 60s poll, or every
  poll forces a fresh DNS lookup (the source of recurring `ENOTFOUND`) — and
  registers `pool.on("error")`. Without that listener an idle-client error is an
  unhandled `'error'` event and **the process dies**.
- **Never join a child table twice in one query.** Joining `batch_items` for a
  COUNT and again for per-unit totals cross-products: 17 boxes printed the same
  total 17 times. Use independent scalar subqueries.

---

## 6. Conventions worth matching

- Comments explain **why**, especially where a naive implementation is wrong. The
  existing code does this heavily; match the density.
- Chakra responsive props: `{{ base, md }}`. Wide tables live in an
  `overflowX="auto"` box **and carry a `minWidth`** — a scroll container without a
  floor just lets the table crush to nothing (this bit `scannerDiagnostic`).
- `AlertDialog` for confirmations, with `leastDestructiveRef` on the safe button.
  On the scanning screen this matters: the scanner *types Enter*, so focus must sit
  on "Go back".
- Prove a guard is load-bearing by **mutation testing** it — revert the fix, watch
  the test fail. Done for the fan-out join, the weight-mismatch check, the duplicate
  accounting, and the Excel rounding fix.

---

## 7. Testing

`cd server && npm test` (jest, `--forceExit`).

**`server/tests/` and `server/scripts/` are gitignored** — tests are local-only by
request. So is `2026/` (real shipment workbooks used for parser accuracy checks).

**Baseline: 6 pre-existing failures** (proc-orders partial-complete ×3, proc-orders
status ×1, S3 admin routes ×2 — the last from `routes.pg.test.js` failing to load
because its `pool.query` mock returns `undefined`). Establish this baseline before
claiming a change caused no regressions.

---

## 8. Scars — bugs that already happened here

- `if (!draft.processingDates)` — **an empty array is truthy**, so seeding was
  skipped and a dead placeholder row rendered. Was live in production.
- CSS specificity: `table.form td` (0,1,2) beat `td.label` (0,1,1), so *every*
  padding change silently did nothing, regardless of order.
- Excel stores `SUM` with float error (`680.2399999999999`); truncating read
  `680.239` and tripped the checksum. Use `Math.round(n * 1000)`.
- Excel date cells are midnight **UTC**; reading local components turned 8/17 into
  8/16. Use `toISOString().slice(0,10)`.
- `"Ship To          Bill of Lading"` is a single cell. A blank value made the scan
  walk on and return the *next label* as the value. Hence `KNOWN_LABELS`.
- Re-entrancy: `flushing = true` was set *after* an `await`, so two calls in one
  tick both got through. Claim the flag **before the first await**.
- Admin-only gates were non-functional — gated on an `isAdmin` prop that
  `NoblesseScreen` passes as `canEdit` (hardcoded `true`). Gate server-side with
  `requireRole("admin")`; a client-side check is not a control.
- `FloatingWindow` centring must read `window.innerWidth` **directly**, not from
  state — state is async and takes the clamp branch on first paint.

### Tooling

Bash heredocs and `sed` have repeatedly mangled edits here (apostrophes, CRLF,
unescaped `$`). Prefer the Edit tool for surgical changes, and run `node --check`
after any scripted edit to a `.js` file.

---

## 9. Open / deferred

- Registration-form Excel import — explicitly deferred.
- GTIN company-prefix → vendor map. Identified: `0027182` IBP, `0199239`
  Sustainable Beef, `0627577` Blue Ribbon (CA), `0883363` Creekstone, `6303080`
  Greater Omaha, `0076338` Swift/Imperial (**they share a prefix — needs a decision**).
- `PATCH /box-batches/:id` so vendor/item/BOL are editable mid-session. The lot
  number stays locked by design.
- The two PM2 fixes in §2.
