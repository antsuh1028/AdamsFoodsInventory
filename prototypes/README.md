# Prototypes and reference material

Working prototypes from the Adams Foods redesign (November 2026). Open any `.html` in Chrome; each runs on its own with sample data and saves nothing. The same pages are also published as private artifacts on claude.ai (see the project memory for links).

| File | What it is |
|---|---|
| `order-sheet-builder.html` (local only, not in git: holds every customer's template and prices) | The office making an order in the app from a customer's template (51 real templates from `AF_ORDER SHEET_2026.xlsx`). |
| `order-picking.html` | The floor working several orders at once: tap a line, scan boxes into its tally, finish only when full and signed off, print the filled sheet. |
| `bill-of-lading.html` | Loading a bill of lading to NTI by scanning pallet tags (whole pallets) or single boxes, and the printed BOL form. |
| `pull-out.html` | Earlier outgoing idea: one pull list, customer or NTI. Superseded by order picking. |
| `scan-test-labels.html`, `Scan-Test-Labels.pdf` | 19 real GS1-128 test box labels with expected results, for testing the scan station on a test database. |
| `salidas-dock-sheet.html`, `Salidas-Dock-Sheet.pdf` | The bilingual one-page Outgoing (Salidas) wall sheet for NTI. The app serves it at `/help/outgoing.html`. |
| `tools/read-order-templates.js` (local only) | Reads each customer tab's newest order panel as a template. The starting point for the real template import. |
| `tools/read-item-codes.js`, `tools/build-item-codes-xlsx.py` (local only) | Extract every item code from the order sheets and build `AF Item Codes.xlsx`. |
| `tools/build-test-labels.js` | Builds the test labels and checks each one against the server's own barcode parser. |

Decisions behind these are recorded in the project memory (`af-incoming-redesign`).
