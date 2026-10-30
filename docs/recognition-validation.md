# Recognition validation protocol

## Status

Real-photo dataset: not collected. Real-photo accuracy: unknown. This increment is a test harness, not proof that the product's recognition requirement has been met.

## First physical test

1. Start the application, select October 2026 and download its PDF.
2. Print A4 landscape at 100% scale. Measure several cells: they should be 7 x 7 mm. Keep all four markers and QR intact.
3. Fill a mix of full cells and blank cells using several pencil colors, including pale yellow. Also try a marker. Record the intended state independently of scanner output.
4. Enter that ground truth manually in the web grid. Download its JSON; load it as the ground truth in the PoC tools. Ground truth must never be derived from the scanner's predictions.
5. Photograph the whole flat sheet in daylight, indoor light and at an angle. Start with JPEG. The application does not retain the photo; select the original file from disk for every run.
6. Load a photo and run recognition. Inspect alignment before trusting classification. Record automatic failures rather than silently switching to manual alignment.
7. Inspect accuracy, confusion matrix and recall; download the report. Report metadata contains statuses/features only, no pixels or photo filenames.
8. Apply the result to the draft, correct errors and explicitly save. Time this review. Exercise Cancel and reload to check that only confirmed data persists.

## Larger evaluation

Use at least 20 independently filled sheets and approximately 60 photographs across phones, printers, materials and lighting. Include blank cells in shadows, sparse/light filling, spills across borders, thick crosses, weak QR, clipped markers, blur, rotation and bent sheets. Ensure both statuses are represented.

Separate sheets, not merely photographs, between tuning and held-out evaluation. Freeze thresholds before final evaluation. Keep original photos on the tester's own disk; do not add personal photos to the repository or application storage. Record anonymous sheet/device/lighting/material IDs in a local experiment log.

## Proposed acceptance gates

- Automatic alignment on at least 95% of suitable held-out photos.
- Cell accuracy at least 95%, recall at least 90% for every represented status.
- At most 1% errors among unflagged cells, with at most 15% cells flagged for review.
- Median user review/correction time at most 2 minutes per month.
- Processing at most 10 seconds on a named reference phone; distinguish cold runtime loading from warm processing.

These are proposed experiment targets, not achieved results. Track rejected images, total input count, class balance, per-material results, all-cell accuracy, accepted-cell accuracy and coverage separately. A model that flags every cell has not passed. Manual alignment must never count as automatic success. A missing class has undefined recall rather than 100% recall.

The UI provides per-image cell accuracy, confusion matrix, recall and flagged counts. Dataset aggregation, timing and confidence calibration are manual research work in this increment. The confidence score is not a calibrated probability.

If light colors fail, test stronger paper instructions or a small dark fallback symbol before expanding the product. Ambiguous filling and old cross marks must be flagged for manual review.
