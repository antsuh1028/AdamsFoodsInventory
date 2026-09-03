# CLAUDE.md — working context

> ## Branch `box-weighing-v2` — built, tested, NOT deployed (2026-09-02)
>
> **`master` = `dd13b58` = what production runs.** This branch is four commits
> ahead and has never been deployed. Don't deploy it without being asked.
>
> All four requested features are complete, plus a later round (keypad always
> on, unit on corrections, admin erase). Suite **466 pass / 6 pre-existing
> fail**; client builds clean.
>
> **1. KG→LB conversion.** Every weight is stored and printed in pounds.
> `server/utils/weight.js` + byte-identical mirror `client/src/utils/weight.js`
> (a test enforces the mirror; carries `/* global BigInt */` or CRA's linter
> fails the build). Exact integer-ratio conversion in BigInt.
> - Converts **server-side, after the barcode check** in `validateItem`. It
>   cannot move to the client — the server re-derives the weight from
>   `raw_barcode`, so a pre-converted client weight is rejected as `UNIT_MISMATCH`.
> - **Per-box conversion, then sum** — never sum-then-convert. On a 7-box sample
>   the two disagree by 0.001 lb, leaving a manifest whose column does not add up
>   to its own total. `weight.test.js` pins this with real figures.
> - `scanQueue` keeps two weights per row: `weight`/`weightUnit` as scanned (goes
>   on the wire) and `displayWeight` in LB (grid, totals, manifest). Don't
>   collapse these.
>
> **2. Row editing** — `PATCH` / `DELETE` / `POST .../restore` on one row.
> - Deleting is a **soft void**: voided rows stay visible, struck through, and
>   are excluded from every count, total and printed manifest.
> - Corrections keep the label's figure in `original_weight`, captured with
>   `COALESCE` so a second edit cannot overwrite the original with the first edit.
> - **Operator may correct an open session; a closed one is admin-only**, enforced
>   server-side (mutation-tested).
> - A corrected row that has **not yet synced** is detached from its barcode and
>   sent as a manual entry. Keeping the barcode would not preserve verification —
>   the server would reject the box as `WEIGHT_MISMATCH` and it would be lost.
> - Synced rows keep their server id (`serverItemId`, set by `markSynced`), which
>   is what makes mid-session correction of an already-sent box possible.
>
> **3. Merged manifests** — `manifest_groups` + `manifest_group_batches`.
> A group stores **references, never copies**. Reprinting pulls fresh, so a
> correction made after the merge appears on the next print.
>
> **4. In-app numeric keypad** (`NumericKeypad.jsx`) for manual entry and for
> correcting a row. A paired BT scanner is an HID keyboard, so iPadOS suppresses
> its own; the readout is a `div`, not an `input`, because focusing an input is
> what triggers the OS keyboard. Buttons are `tabIndex={-1}` with
> `onMouseDown` prevented so a scan's Enter cannot re-press the last button.
> - **The keypad panel is open by default for the whole session** and nothing on
>   it is focusable. That is load-bearing: the global keydown handler in
>   `boxScanner.jsx` returns early when `e.target` is an INPUT/TEXTAREA/SELECT,
>   so a field left focused there **silently swallows scans**. The unit is
>   buttons on the keypad; the note field collapses and warns while open.
>
> **5. Corrections carry a unit.** A KG label is correctable as KG — the figure
> goes up as typed and the server converts, so the client stays untrusted.
> Correcting back to LB clears `converted_from`.
>
> **6. Admin erase** — `DELETE .../items/:itemId/permanent`, `requireRole("admin")`,
> mutation-tested. Deliberately a **separate route** from the void, so a replayed
> or mistyped void can never destroy a box; the DELETE carries `tenant_id` so a
> guessed id from another tenant misses. Voiding remains the default.
>
> ### Not done
> - The tally-sheet **date is still discarded** on import — see §4 Known gap.
> - iPad keyboard: the user should check whether their scanner has an *iOS
>   keyboard toggle* config barcode — fixes typing device-wide, not just here.
> - 11 of 55 sheets have messy lot cells (`"P12 N26230-01"`, `"N26244-3"`).
>   Pre-filling from the filename would remove most of the friction. Offered,
>   not built.

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

- Working branch: `box-weighing-v2` (see the block at the top of this file).
- **Production runs `master`.** Box weighing (scanning + tally import) was
  deployed on 2026-09-02 as `dd13b58` and verified live. The KG conversion, row
  editing, merged manifests and keypad are NOT deployed — they sit on
  `box-weighing-v2`. Don't merge or deploy without being asked.
- Historical note: `master` once deliberately excluded box weighing and was built
  by removing barcode-only files rather than cherry-picking. `barcode-integration`
  is that now-merged branch.
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
- **Fire-and-forget migrations race.** `boxes.pg.js` used to fire every
  `CREATE TABLE` at module load without awaiting. A pool hands concurrent
  queries to different connections, so `manifest_group_batches` reached the
  server before `manifest_groups` existed and died with `relation
  "manifest_groups" does not exist` — then never retried, leaving the table
  missing until a boot happened to win the race. Seen live. Migrations there now
  run in a sequential `migrate()`; keep any new dependent DDL inside it.

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
