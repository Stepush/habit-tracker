import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import {
  FORMAT,
  emptyGrid,
  daysInMonth,
  monthCalendar,
  summarize,
  completionChange,
  validGrid,
  migrateLegacyGrid,
  monthFromQR,
  qrPayload,
  HABITS,
  validHabits,
} from "../src/lib/model";
import { classify, type Sample } from "../src/lib/classify";
import { createTemplatePDF } from "../src/lib/pdf";

test("calendar respects leap years and rejects invalid months", () => {
  assert.equal(daysInMonth("2024-02"), 29);
  assert.equal(daysInMonth("2026-02"), 28);
  assert.equal(daysInMonth("2026-04"), 30);
  for (const month of ["2026-13", "2026-00", "bad", "1999-01"])
    assert.throws(() => daysInMonth(month));
});
test("calendar labels match real weekdays and stop at the end of each month", () => {
  const october = monthCalendar("2026-10");
  assert.equal(october.length, 31);
  assert.deepEqual(october[0], { day: 1, weekday: "чт" });
  assert.deepEqual(october[30], { day: 31, weekday: "сб" });
  const february = monthCalendar("2026-02");
  assert.equal(february.length, 28);
  assert.deepEqual(february[0], { day: 1, weekday: "вс" });
  assert.deepEqual(february[27], { day: 28, weekday: "сб" });
  assert.deepEqual(monthCalendar("2024-02").at(-1), { day: 29, weekday: "чт" });
  assert.equal(monthCalendar("2026-04").length, 30);
  assert.deepEqual(monthCalendar("2027-01")[0], { day: 1, weekday: "пт" });
});
test("monthly records validate shape and status before restoration", () => {
  const grid = emptyGrid("2026-02");
  assert.equal(grid.length, 4);
  assert.equal(grid[0].length, 28);
  assert.ok(validGrid(grid, "2026-02"));
  assert.equal(validGrid(grid, "2026-10"), false);
  assert.equal(validGrid([["invalid"]], "2026-02"), false);
});
test("custom habit records validate identity, labels, colors and row count", () => {
  const habits = [
    ...HABITS,
    { id: "sleep", name: "Сон", short: "Сон", color: "#536648" },
  ];
  assert.ok(validHabits(habits));
  assert.ok(validGrid(emptyGrid("2026-02", 5), "2026-02", 5));
  assert.equal(validGrid(emptyGrid("2026-02", 4), "2026-02", 5), false);
  assert.equal(validHabits([]), false);
  assert.ok(validHabits([HABITS[0]]));
  const ten = Array.from({ length: 10 }, (_, i) => ({
    ...HABITS[0],
    id: `habit-${i}`,
  }));
  assert.ok(validHabits(ten));
  assert.equal(validHabits([...ten, { ...HABITS[0], id: "habit-10" }]), false);
  assert.equal(validHabits([...habits, habits[0]]), false);
  assert.equal(validHabits([{ ...habits[0], name: "   " }]), false);
  assert.equal(validHabits([{ ...habits[0], color: "red" }]), false);
  const ids = habits.map((h) => h.id);
  assert.equal(monthFromQR(qrPayload("2026-02", ids)), "2026-02");
  assert.notEqual(
    qrPayload("2026-02", ids),
    qrPayload("2026-02", [...ids].reverse()),
  );
});
test("completion includes every cell in the selected month", () => {
  assert.deepEqual(summarize([["completed", "missed"]]), {
    completed: 1,
    available: 2,
    rate: 50,
  });
  assert.equal(summarize([["missed"]]).rate, 0);
  assert.equal(summarize([["completed"]]).rate, 100);
  assert.equal(summarize([]).rate, null);
});
test("completion change subtracts displayed monthly percentages", () => {
  const stats = (completed: number, available = 100) => ({
    completed,
    available,
    rate: Math.round((completed / available) * 100),
  });
  assert.equal(completionChange(stats(60), stats(40)), 20);
  assert.equal(completionChange(stats(40), stats(60)), -20);
  assert.equal(completionChange(stats(40), stats(40)), 0);
  assert.equal(completionChange(stats(0), stats(40)), -40);
  assert.equal(completionChange(stats(80), stats(20)), 60);
  assert.equal(completionChange(stats(1, 300), stats(1, 310)), 0);
  assert.equal(completionChange(stats(60), stats(0)), 60);
  assert.equal(completionChange(stats(0), stats(0)), 0);
  assert.equal(completionChange(stats(60), undefined), null);
  assert.equal(completionChange(summarize([]), stats(40)), null);
});
test("QR identifies the fixed version and month", () => {
  assert.equal(monthFromQR(qrPayload("2026-10")), "2026-10");
  assert.equal(monthFromQR("paper:v2:2026-10:fixed4"), null);
  assert.equal(monthFromQR("paper:v1:2026-13:fixed4"), null);
});
test("landscape geometry has square 7 mm cells and fits all 31 days", () => {
  assert.equal(FORMAT.width, 297);
  assert.equal(FORMAT.height, 210);
  assert.equal(FORMAT.gridX + 31 * FORMAT.cell, 285);
  assert.equal(FORMAT.width - 285, 12);
});
function fixture(
  kind: "empty" | "full" | "half" | "cross" | "ambiguous",
): Sample[] {
  const samples: Sample[] = [];
  for (let y = 0; y < 25; y++)
    for (let x = 0; x < 25; x++) {
      const xx = x / 24,
        yy = y / 24;
      const ink =
        kind === "full" ||
        (kind === "half" && xx < 0.5) ||
        (kind === "cross" &&
          (Math.abs(xx - yy) < 0.13 || Math.abs(xx + yy - 1) < 0.13)) ||
        (kind === "ambiguous" &&
          xx > 0.25 &&
          xx < 0.75 &&
          yy > 0.25 &&
          yy < 0.75);
      samples.push({
        x: xx,
        y: yy,
        r: ink ? 70 : 250,
        g: ink ? 95 : 250,
        b: ink ? 65 : 250,
      });
    }
  return samples;
}
test("classifier has basic synthetic checks, not real-photo accuracy claims", () => {
  assert.equal(classify(fixture("empty"), 250).status, "missed");
  assert.equal(classify(fixture("full"), 250).status, "completed");
  assert.equal(classify(fixture("half"), 250).status, "missed");
  assert.equal(classify(fixture("half"), 250).needsReview, true);
  assert.equal(classify(fixture("cross"), 250).status, "missed");
  assert.equal(classify(fixture("ambiguous"), 250).needsReview, true);
});
test("generated PDF is a single landscape A4 page", async () => {
  const bytes = await createTemplatePDF(
    "2026-02",
    await readFile("public/fonts/OpenSans-Variable.ttf"),
  );
  const doc = await PDFDocument.load(bytes);
  assert.equal(doc.getPageCount(), 1);
  const page = doc.getPage(0);
  assert.ok(Math.abs(page.getWidth() - (297 * 72) / 25.4) < 0.01);
  assert.ok(Math.abs(page.getHeight() - (210 * 72) / 25.4) < 0.01);
});
test("custom PDF uses the selected habit layout and checks sheet capacity", async () => {
  const font = await readFile("public/fonts/OpenSans-Variable.ttf");
  const habits = [HABITS[1], HABITS[0]];
  const doc = await PDFDocument.load(
    await createTemplatePDF("2026-10", font, habits),
  );
  assert.match(doc.getSubject() || "", /PAPER-V2-2026-10-2/);
  assert.equal(doc.getPageCount(), 1);
  const fullSheet = await PDFDocument.load(
    await createTemplatePDF(
      "2026-10",
      font,
      Array.from({ length: 10 }, (_, i) => ({
        ...HABITS[0],
        id: `habit-${i}`,
      })),
    ),
  );
  assert.equal(fullSheet.getPageCount(), 1);
  await assert.rejects(createTemplatePDF("2026-10", font, []), /от 1 до 10/);
  await assert.rejects(
    createTemplatePDF("2026-10", font, Array(11).fill(HABITS[0])),
    /от 1 до 10/,
  );
});

test("legacy grid migration preserves completion and rejects unknown statuses", () => {
  const old = emptyGrid("2026-10") as string[][];
  old[0][0] = "partial";
  old[0][1] = "completed";
  old[0][3] = "excused";
  const migrated = migrateLegacyGrid(old);
  assert.ok(validGrid(migrated, "2026-10"));
  assert.equal(migrated[0][0], "missed");
  assert.equal(migrated[0][3], "missed");
  assert.equal(summarize(migrated).available, 124);
  assert.equal(summarize(migrated).completed, 1);
  assert.equal(old[0][0], "partial");
  old[0][2] = "invalid";
  assert.equal(validGrid(migrateLegacyGrid(old), "2026-10"), false);
  assert.equal(validGrid(migrateLegacyGrid(null), "2026-10"), false);
});
