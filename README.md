# Ритм / Ritm

A local proof of concept for a printable habit tracker with browser-only recognition.

## Run locally

Use Node.js 22 LTS or a newer supported runtime (Next.js requires at least 20.9).

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:3000. Recognition diagnostics and ground-truth tools are available separately at `/poc`. No environment variables, account, API keys, or database are required. The development server binds to loopback only.

```sh
npm run typecheck
npm test
npm run build
npm start
npm run sample:pdf -- 2026-10
```

The sample PDF is written to `output/pdf/ritm-2026-10.pdf`. Output and temporary test images are ignored. `predev`, `prebuild`, and `pretest` copy the installed OpenCV runtime into `public/vendor/` and bundle the scanner worker; these generated assets must not be committed. No CDN runtime is used.

## Included in this increment

- Russian responsive UI, editable monthly habit lists with stable IDs (add, rename, remove and reorder in edit mode), months from 2000 through 2100.
- Landscape A4 PDF: 31 square 7 mm cells, 12 mm side margins, 56 mm label area, corner markers, versioned QR and readable template ID. Short months have disabled final cells.
- Manual editing of completed and not-completed entries.
- Explicit Save and Cancel; navigation warns about unsaved edits. Save stores only the selected month in localStorage. Reloading discards unsaved edits.
- JPEG/PNG/WebP loading, OpenCV marker detection, perspective correction, local QR identification and experimental binary classification in a dedicated worker.
- Manual marker selection when automatic alignment fails. The manual fallback assumes the selected fixed template if QR cannot be read.
- Recognition is a proposal. Apply it to the draft, correct it, then save. Repeated saves replace that month's record instead of duplicating it.
- Versioned JSON backup/restore, ground-truth import, cell accuracy, confusion matrix, per-status recall and JSON report export.

## Privacy and persistence

Photos are decoded into memory, resized to at most 2200 pixels on the long side and passed to a same-origin worker. There is no image upload endpoint, photo database, storage bucket, analytics SDK, or paid AI dependency. The worker loads OpenCV from this application. Original file inputs are cleared after selection. Image buffers/canvases are released when the photo is removed, the month changes or the page closes. No photos are persisted by the application.

Only confirmed habit lists and grid data are stored, keyed by format version and month. This is browser-local storage, not an account or cloud backup. It can be lost on browser-data deletion; use JSON backups. Other browser profiles, devices and origins do not share these records. JSON export offers the selected month or all saved months, including the current draft. A single import accepts either format and legacy month backups, validates the entire file, and saves imported months immediately. Existing matching months require confirmation before replacement; other months remain untouched. If storage writes fail, import attempts to restore the previous records. Exports require valid habit names and data.

## Status and analytics rules

- Completed: fill the whole cell.
- Not completed: leave empty.

Rate = completed / all cells in the selected month. Metrics describe the full selected draft month, including any blank days; this PoC has no tracking schedule or automatic elapsed-day exclusion. A new month remains explicitly unsaved until confirmed.

Color is decorative, not a status code. Thresholds and confidence scores are heuristic and uncalibrated. All recognized cells can be edited; highlighted cells need particular attention. Unsupported QR versions, month mismatches and habit-order mismatches are rejected. Old four-habit records and JSON backups remain compatible. Manual alignment is reported separately.

## Recognition is not validated yet

Passing synthetic tests proves the pipeline executes, not that real pencil photos are reliable. This increment is ready for physical print/photo experiments, not a completed recognition PoC or production MVP. See [the validation protocol](docs/recognition-validation.md).

Current limitations: 1–10 habits per month; printing and scanning support the same range per A4 sheet, no authentication/database/sync, no HEIC decoder, no correction for bent paper, no clinical-grade or guaranteed accuracy. Very light pencil, shadows, thick crosses and glare may be misclassified. The user must review the result before saving.

## Code map

- `src/lib/model.ts`: IDs, geometry, month validation and aggregation.
- `src/lib/pdf.ts`: deterministic vector PDF geometry and embedded Cyrillic font.
- `src/lib/classify.ts`: explainable coverage and shape classifier.
- `src/workers/scanner.worker.ts`: OpenCV/QR processing and cleanup.
- `src/app/tracker.tsx`: draft/review/save workflow and PoC tools.
- `tests/`: calendar, data validation, PDF geometry and actual OpenCV worker integration checks.

The OpenCV integration test runs the actual bundled worker against a generated sheet and a perspective-transformed variant, exercises both statuses and ambiguous marks, and checks month mismatch and missing-marker errors. It does not use real photos. Browser checks are manual; no automated browser regression suite is included yet.

## Next gate

Validate real materials and photos before adding Supabase Auth, RLS, custom habits or public hosting. The eventual data model must preserve habit IDs, monthly snapshots and immutable printed template configurations. No database migrations are shipped in this increment.

## Third-party assets

DejaVu Sans is embedded for Cyrillic PDF labels; its original license is in `public/fonts/LICENSE.txt`. OpenCV and all npm packages retain their respective upstream licenses in `node_modules`. A project-wide open-source license has not yet been selected.

Legacy saved months and JSON backups convert the retired partial and excused statuses to not completed on load. All cells now contribute to the denominator, including former rest days. Newly saved/exported records contain only the two supported statuses. Incomplete filling is flagged for manual review during recognition.
