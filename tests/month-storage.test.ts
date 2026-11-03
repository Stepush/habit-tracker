import test from "node:test";
import assert from "node:assert/strict";
import { parseMonth, restoreBackup } from "../src/lib/backup";
import {
  HABITS,
  type Habit,
  HABIT_COLORS,
  emptyGrid,
  nextHabitColor,
  storageKey,
} from "../src/lib/model";
import {
  loadMonth,
  memoryStorage,
  planMonthSave,
} from "../src/lib/month-storage";

const today = "2026-11";
function record(
  month: string,
  habits: readonly Habit[] = HABITS.map((h) => ({ ...h })),
) {
  return parseMonth({
    version: 1,
    month,
    habits,
    grid: emptyGrid(month, habits.length),
  });
}

test("legacy IDs and duplicate colors migrate consistently without changing marks", () => {
  const old = {
    ...record(today),
    habits: HABITS.map((h, i) => ({
      ...h,
      id: ["read", "move", "water", "quiet"][i],
      color: HABITS[0].color,
    })),
    habitIds: ["read", "move", "water", "quiet"],
  };
  old.grid[0][4] = "completed";
  const migrated = parseMonth(old);
  assert.deepEqual(
    migrated.habitIds,
    HABITS.map((h) => h.id),
  );
  assert.equal(new Set(migrated.habits.map((h) => h.color)).size, 4);
  assert.equal(migrated.grid[0][4], "completed");
  assert.deepEqual(parseMonth(migrated), migrated);
});

test("all ten habits receive distinct pastel colors, including after deletion", () => {
  const habits: Habit[] = HABITS.map((h) => ({ ...h }));
  while (habits.length < 10)
    habits.push({
      id: String(habits.length),
      name: "Сон",
      short: "Сон",
      color: nextHabitColor(habits),
    });
  assert.equal(new Set(habits.map((h) => h.color)).size, 10);
  assert.ok(
    habits.every((h) =>
      HABIT_COLORS.includes(h.color as (typeof HABIT_COLORS)[number]),
    ),
  );
  const [removed] = habits.splice(2, 1);
  assert.equal(nextHabitColor(habits), removed.color);
});

test("unsaved future months inherit the latest list across year boundaries with blank marks", () => {
  const storage = memoryStorage();
  const current = record(today, [HABITS[2], HABITS[0]]);
  current.grid[0][0] = "completed";
  restoreBackup(storage, [current]);
  for (const month of ["2026-12", "2027-01", "2028-02"]) {
    const next = loadMonth(storage, month, today);
    assert.deepEqual(next.habits, current.habits);
    assert.equal(next.grid[0].length, month === "2028-02" ? 29 : 31);
    assert.ok(next.grid.flat().every((s) => s === "missed"));
  }
  assert.equal(loadMonth(storage, "2026-10", today).habits.length, 4);
});

test("saving current habits updates existing future months by ID and preserves past snapshots", () => {
  const storage = memoryStorage();
  const past = record("2026-10");
  const future = record("2026-12");
  future.grid[2][5] = "completed";
  future.grid[0][2] = "completed";
  restoreBackup(storage, [past, future]);
  const pastRaw = storage.getItem(storageKey(past.month));
  const added = {
    id: "new-habit",
    name: "Сон",
    short: "Сон",
    color: HABIT_COLORS[4],
  };
  const current = record(today, [HABITS[2], added, HABITS[0]]);
  restoreBackup(storage, planMonthSave(storage, current, today));
  assert.equal(storage.getItem(storageKey(past.month)), pastRaw);
  const next = loadMonth(storage, future.month, today);
  assert.deepEqual(next.habits, current.habits);
  assert.equal(next.grid[0][5], "completed");
  assert.equal(next.grid[2][2], "completed");
  assert.ok(next.grid[1].every((s) => s === "missed"));
  assert.deepEqual(loadMonth(storage, "2027-01", today).habits, current.habits);
});

test("editing a historical month freezes the current inherited list", () => {
  const storage = memoryStorage();
  restoreBackup(storage, [record("2026-10", [HABITS[2]])]);
  const current = loadMonth(storage, today, today);
  const changedPast = record("2026-10", [HABITS[1]]);
  restoreBackup(storage, planMonthSave(storage, changedPast, today));
  assert.deepEqual(loadMonth(storage, today, today).habits, current.habits);
  assert.deepEqual(loadMonth(storage, "2026-12", today).habits, current.habits);
  assert.deepEqual(
    loadMonth(storage, "2026-10", today).habits,
    changedPast.habits,
  );
});

test("editing future habits also saves the common current list and retains its marks", () => {
  const storage = memoryStorage();
  const current = record(today);
  current.grid[1][3] = "completed";
  restoreBackup(storage, [current]);
  const changed = record("2027-01", [HABITS[1], HABITS[3]]);
  restoreBackup(storage, planMonthSave(storage, changed, today));
  assert.deepEqual(loadMonth(storage, today, today).habits, changed.habits);
  assert.equal(loadMonth(storage, today, today).grid[0][3], "completed");
});

test("a backup containing only future months supplies one common list", () => {
  const storage = memoryStorage();
  restoreBackup(storage, [
    record("2026-12", [HABITS[2]]),
    record("2027-01", [HABITS[1]]),
  ]);
  for (const month of [today, "2026-12", "2027-01", "2027-02"]) {
    assert.deepEqual(loadMonth(storage, month, today).habits, [HABITS[2]]);
  }
});
