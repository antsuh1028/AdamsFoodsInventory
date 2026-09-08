# CLAUDE.md — working context

> ## Box weighing v2 — DEPLOYED to production (2026-09-03)
>
> **`master` = `da604e2` = what production runs**, deployed and verified on
> 2026-09-03. `box-weighing-v2` is merged into it; the branch still exists.
>
> Suite **456 pass / 6 pre-existing fail**. Verified live after deploy: new PID,
> all four new tables present, `batch_items` audit columns present, no migration
> errors, new client bundle served.
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
> - **The keypad is its own `FloatingWindow`**, a sibling of the session window
>   whose `isOpen` is ANDed with it — so it closes with the session and can never
>   be left floating over an unrelated screen. `placement="right"` keeps it off
>   the grid's left-hand columns (the weight and unit being read).
> - **Nothing on the panel is focusable.** Load-bearing: the global keydown
>   handler in `boxScanner.jsx` returns early when `e.target` is an
>   INPUT/TEXTAREA/SELECT, so a field left focused there **silently swallows
>   scans**. The unit is buttons on the keypad; the note collapses and warns.
>
> **5. Corrections carry a unit.** A KG label is correctable as KG — the figure
> goes up as typed and the server converts, so the client stays untrusted.
> Correcting back to LB clears `converted_from`.
>
> **6. Deleting.** A whole session: `DELETE /box-batches/:id`, admin-only,
> refuses while a merged manifest or a registration form still references it and
> names what to detach. There is **no single-row erase** — void covers it,
> reversibly and with a record; that route existed briefly and was removed.
>
> **7. Removal history** — `box_removal_history` records voided / restored /
> session deleted / manifest removed. **No FKs to box tables**: an audit row must
> outlive what it describes. `details` holds the destroyed row in full. Logging
> never fails the request.
>
> **8. Box weights → registration form** — `registration_form_batches` ties
> sessions to a form; the panel shows the live total and fills Original Weight /
> Total Quantity. A reference, not a copy, so drift is shown rather than applied.
> No FK to `noblesse_registration_forms` — originally because that table was
> created by a different module with no ordering guarantee. `db/migrate.js` now
> guarantees the order, so the FK is *possible*; adding it is a Phase D step
> (it fails if any orphan link exists) and has not been done.
>
> ### Lot registry + Outgoing (2026-09-04, committed, NOT deployed)
> **NTI processes; AdamsFoods distributes.** A lot is issued once at Incoming
> and only ever *referenced* afterwards — see [[project-domain-model]] in memory.
> - `lots` owns lot identity. `POST /lots` creates, `POST /lots/resolve` never
>   does — the split is structural so downstream cannot mint a lot from a typo.
>   The `-NN` is allocated server-side against `UNIQUE (tenant_id, lot_date, seq)`.
>   It used to be typed, which is why prod has `N26132-03` and `-08` with a gap.
> - `utils/lot.js` normalises what is unambiguous and REFUSES what is not
>   (`N26244` alone has no sequence, so it is never assumed to be `-01`).
> - `utils/lotRegistry.js`: `ensureLot` (incoming) / `lookupLot` (downstream).
>   Returns null rather than throwing on non-lot text, so Phase C could not break
>   a save. Uses a SAVEPOINT inside a transaction.
> - **Processing output re-stocks under the same lot** (`stage='processed'`,
>   keyed by `source_processing_order_id` with a unique index). Before this,
>   processing deducted raw and recorded output on the ORDER, so nothing was left
>   in stock to ship — Outgoing had nothing to draw on.
> - **Outgoing**: `noblesse_shipments` + items. Ship deducts stock with the rows
>   locked and REFUSES an overage rather than flooring at zero; cancel restores
>   and keeps the record; a shipped load is never *edited*.
> - **An admin may DELETE a load in any state** (2026-09-08). This relaxed the
>   older "shipped is cancelled, never deleted" rule, for the case it was
>   written against: a registration deleted for some lot, leaving an outgoing
>   load behind that should not exist. Cancel is still right for a real load
>   that came back — it restores stock AND keeps the record. Delete destroys it.
>   **The stock rule is the load-bearing part**: restoring is keyed strictly on
>   `status === 'shipped'`. A draft never deducted; a cancelled load already had
>   its weight put back, so restoring either INVENTS weight that never left.
>   Both directions are mutation-tested. The destroyed load is written to
>   `nti_inventory_history` as `shipment_deleted` with the head and every line,
>   since after this that snapshot is the only copy.
> - Phases A+B applied to prod; text columns still authoritative (Phase D — drop
>   them — not done).
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

- **Production CODE runs `master` = `3235a37`** — verified 2026-09-08 by reading
  `git log` in `~/AdamsFoodsInventory` on the box. Don't deploy without being
  asked. The lot registry, Outgoing, merged manifests and the processing-tab
  gating ARE deployed; the note that said prod was still on `da604e2` with all of
  that undeployed was stale.
- **The dev server points at the PRODUCTION database.** Running it locally
  applies `db/migrate.js` to prod and writes real rows. "Not deployed" therefore
  means the *code* on the server is old; schema and data changes made locally
  are already live. Bear that in mind before running anything destructive.
- **The production DATABASE is deliberately ahead of that code (2026-09-04).**
  Lot-registry Phase A + B were applied straight to Neon from a workstation —
  `migrate()` run against prod, then `scripts/backfill-lots.js --commit`. The
  running server has never seen this schema and does not need to: every new
  column is nullable, has a default, or is unread, so the old code ignores them.
  In prod now: `lots` (11 rows), `lot_id` populated on 15 rows across four
  tables, `nti_inventory.stage` = 'raw' on all 8 rows, `noblesse_receipts`
  `source_type`/`source_name` present and null.
  Two rows keep `lot_id NULL` on purpose — both are the `"TEST"` sentinel.
  **Deploying the code later is a no-op for the schema** (`migrate()` is
  idempotent) but DOES change boot behaviour: a failed migration now exits the
  process instead of logging and carrying on.
- Historical note: `master` once deliberately excluded box weighing and was built
  by removing barcode-only files rather than cherry-picking. `barcode-integration`
  is that now-merged branch.
- `npm run deploy` = `deploy:server` (ssh + git pull + npm install + pm2 restart)
  then `deploy:client` (react build + scp).

### Deploy landmines

1. **Two PM2 daemons — and it is the ADMIN one that serves.** Checked
   2026-09-08: `ss -lntp` shows pid 1215788 (`node`, user admin) owning :3001,
   and admin's `pm2 list` has `adamsfoodsinventory` online. So `deploy:server`
   restarting admin's copy is correct, and deploys DO land. This entry used to
   say the opposite — that root held the port and admin's copy died on
   `EADDRINUSE`. Whatever was true once, it is not true now; check `ss -lntp`
   before believing either version.
   The root daemon holds two **dead** entries that lose the race for :3001:
   `adamsfoodsinventory` (stopped, ~962k restarts) and `nodeapp` (errored,
   1.6M restarts, `/var/www/nodeapp/server.js` — an unrelated leftover).
   Harmless while stopped, but root's `dump.pm2` still lists them, so a reboot
   resurrects both into a crash-loop. Not yet cleaned:
   `sudo pm2 delete nodeapp adamsfoodsinventory && sudo pm2 save` **in the root
   daemon only** (admin's is separate; its copy must survive).
2. `deploy:server` uses `npm install`, which dirties `server/package-lock.json` on
   the box and makes the next `git pull` refuse. Should be `npm ci`.
   **It is dirty right now** (confirmed 2026-09-08) — the next commit that
   touches that file will make the deploy's pull fail. Clear it on the box with
   `git checkout -- server/package-lock.json`.
3. **The TLS cert renews through Apache, not standalone.** Apache2 owns :80 and
   :443. The renewal conf was set to `authenticator = standalone`, which binds
   :80 itself, so every renewal failed with `Could not bind TCP port 80` — daily,
   silently, for a month — and the cert **expired on 2026-09-06**, taking the
   whole site down for browsers while the app itself stayed healthy. Fixed
   2026-09-08 by reissuing with `certbot certonly --apache` (one cert, SANs
   `client.` + `server.afdcstorage.com`), which rewrote the conf to
   `authenticator = apache`. `certbot renew --dry-run` passes.
   A `deploy` hook that ran `pm2 restart nodeapp` — the dead leftover — was moved
   out to `/root/restart-nodeapp.sh.disabled`. Nothing needs restarting on
   renewal: Apache terminates TLS and the Node app never reads the certs.
   **The lesson is the failure mode, not the plugin:** a renewal timer that is
   `enabled` and `active` tells you nothing. `systemctl status certbot.service`
   shows whether the last run actually succeeded.

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

- **All Noblesse and box-weighing DDL lives in `server/db/migrate.js`** and runs
  sequentially, awaited, before `app.listen` (`index.js` requires the route
  modules only after `migrate()` resolves). Idempotent statements only
  (`IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` / `DROP ... IF EXISTS`), so a
  retry restarts from the top safely. **A failing statement throws and boot
  aborts** — pm2 restarts it; three attempts cover a Neon connection drop.
  No migration tool — a deliberate call. **Put any new DDL there, in dependency
  order; never fire DDL from a route module.** `tenants` predates the repo and is
  never created here — `migrate()` checks it exists and refuses to boot without
  it. Adams-side modules (production, snapshots, history, s3) still carry their
  own small `IF NOT EXISTS` statements; they reference nothing Noblesse-side and
  run after `migrate()`, so they cannot race it.
  `server/tests/migrate.test.js` pins the ordering (lots before every FK to it,
  every parent before its child, strictly one statement in flight) and the
  loudness (errors reject, retries restart from the preflight).
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

**Baseline: 0 failures, 722 passing (2026-09-04).** Anything red is yours.

It was 6 failures / 583 tests for a long time. Both numbers were wrong in the
same way: **two suites never loaded at all**, so ~140 tests were dead and their
assertions had silently gone stale.

- `routes/history.pg.js` and `routes/s3.js` fired DDL at import with a swallowed
  `.catch()`. A mocked `pool.query` returns `undefined`, and `.catch` of
  `undefined` throws before the suite can load. That DDL now lives in
  `db/migrate.js`; nothing fires schema at import any more.
- The proc-order failures were tests describing a design that had been REPLACED:
  they asserted that a partial completion credits the unprocessed remainder back
  to `nti_inventory`, when the route spins it into a new pending order and says
  so in a comment. Response shape had also moved to `{ order, newOrder }`, which
  is what the client reads.
- `inventoryFind` moved to LIKE patterns (`"A101%"`, `"%Beef%"`); assertions
  still expected raw values.
- `getHistory` returns `{ items, total, offset, hasMore }`, not a bare array.
- `routes.test.js` signed tokens with no `tenantId`; `verifyToken.pg` 401s on
  those, so the admin-only tests never reached the role check they exist to
  prove.

Lesson worth keeping: a suite that fails to LOAD hides every test in it, and jest
reports that as one failure. Check suite counts, not just test counts.

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
- **Fire-and-forget migrations race.** Route modules used to fire every
  `CREATE TABLE` at module load without awaiting. A pool hands concurrent
  queries to different connections, so `manifest_group_batches` reached the
  server before `manifest_groups` existed and died with `relation
  "manifest_groups" does not exist` — then never retried, leaving the table
  missing until a boot happened to win the race. Seen live. The first fix was a
  sequential `migrate()` inside `boxes.pg.js`, which still *swallowed* each
  step's error. Now structurally fixed: one ordered, awaited, loud
  `server/db/migrate.js` (see §5). The lot registry's FKs from Noblesse tables
  are what forced the full fix — they would have hit the same race.

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
