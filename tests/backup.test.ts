import assert from "node:assert/strict";
import test from "node:test";
import {
  collectBackup,
  parseBackup,
  parseMonth,
  restoreBackup,
} from "../src/lib/backup";
import { emptyGrid, HABITS, storageKey } from "../src/lib/model";

function record(month: string) {
  return parseMonth({
    version: 1,
    month,
    habits: HABITS,
    grid: emptyGrid(month),
  });
}
function storage() {
  const values = new Map<string, string>();
  return {
    values,
    get length() {
      return values.size;
    },
    key: (i: number) => [...values.keys()][i] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}

test("all-data export includes saved months and replaces current month with draft", () => {
  const db = storage();
  restoreBackup(db, [record("2026-09"), record("2026-10")]);
  db.setItem("unrelated", "keep");
  const current = record("2026-10");
  current.grid[0][0] = "completed";
  const result = parseBackup(
    JSON.parse(JSON.stringify(collectBackup(db, current))),
  );
  assert.equal(result.length, 2);
  assert.equal(result[1].grid[0][0], "completed");
  assert.equal(
    parseBackup(JSON.parse(db.getItem(storageKey("2026-10"))!))[0].grid[0][0],
    "missed",
  );
});

test("import supports legacy month copies and validates entire archive", () => {
  const legacy = {
    version: 1,
    month: "2026-10",
    habitIds: HABITS.map((h) => h.id),
    grid: emptyGrid("2026-10"),
  };
  assert.equal(parseBackup(legacy)[0].habits.length, HABITS.length);
  const archive = {
    version: 1,
    type: "ritm-backup",
    months: [record("2026-09"), record("2026-10")],
  };
  assert.equal(parseBackup(archive).length, 2);
  assert.throws(() =>
    parseBackup({
      ...archive,
      months: [record("2026-09"), { ...record("2026-10"), grid: [] }],
    }),
  );
  assert.throws(() =>
    parseBackup({ ...archive, months: [record("2026-10"), record("2026-10")] }),
  );
  assert.throws(() => parseBackup({ ...legacy, month: "2026-13" }));
  assert.throws(() => parseBackup({ ...legacy, version: 99 }));
});

test("restore preserves months outside imported file and rolls back write failure", () => {
  const db = storage();
  restoreBackup(db, [record("2026-08"), record("2026-09")]);
  const before = [...db.values];
  const setItem = db.setItem;
  db.setItem = (key, value) => {
    if (key === storageKey("2026-10")) throw new Error("quota");
    setItem(key, value);
  };
  const changed = record("2026-09");
  changed.grid[0][0] = "completed";
  assert.throws(
    () => restoreBackup(db, [changed, record("2026-10")]),
    /Изменения отменены/,
  );
  assert.deepEqual([...db.values], before);
  db.setItem = setItem;
  restoreBackup(db, [changed]);
  assert.equal(db.getItem(storageKey("2026-08")), before[0][1]);
  assert.equal(
    parseBackup(JSON.parse(db.getItem(storageKey("2026-09"))!))[0].grid[0][0],
    "completed",
  );
});
