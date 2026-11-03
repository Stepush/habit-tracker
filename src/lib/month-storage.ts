export type MonthStorage = Pick<
  Storage,
  "length" | "key" | "getItem" | "setItem" | "removeItem"
>;

// Cloud records stay in memory and never overwrite the old browser-local history.
export function memoryStorage(): MonthStorage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

import { parseMonth, type BackupMonth } from "./backup";
import { HABITS, emptyGrid, storageKey } from "./model";

function savedMonths(storage: MonthStorage): BackupMonth[] {
  const records: BackupMonth[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key?.startsWith(storageKey(""))) continue;
    const record = parseMonth(JSON.parse(storage.getItem(key)!));
    if (storageKey(record.month) !== key)
      throw new Error("Повреждены данные месяца.");
    records.push(record);
  }
  return records.sort((a, b) => a.month.localeCompare(b.month));
}

export function currentMonth(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function withHabits(record: BackupMonth, source: BackupMonth): BackupMonth {
  return {
    ...record,
    habits: source.habits.map((h) => ({ ...h })),
    habitIds: [...source.habitIds],
    grid: source.habitIds.map((id) => {
      const index = record.habitIds.indexOf(id);
      return index < 0
        ? emptyGrid(record.month, 1)[0]
        : [...record.grid[index]];
    }),
  };
}

export function loadMonth(
  storage: MonthStorage,
  month: string,
  today = currentMonth(),
): BackupMonth {
  const records = savedMonths(storage);
  const existing = records.find((record) => record.month === month);
  // Past snapshots retain their own habit list. Current and future months share
  // the most recent list available at or before the current month.
  const source =
    records
      .filter((record) => record.month <= (month >= today ? today : month))
      .at(-1) ?? (month >= today ? records[0] : undefined);
  const blank = parseMonth({
    version: 1,
    month,
    habits: source?.habits ?? HABITS,
    grid: emptyGrid(month, source?.habits.length ?? HABITS.length),
  });
  if (!existing) return blank;
  return month >= today && source ? withHabits(existing, source) : existing;
}

export function planMonthSave(
  storage: MonthStorage,
  current: BackupMonth,
  today = currentMonth(),
): BackupMonth[] {
  const records = savedMonths(storage);
  if (current.month < today) {
    // Freeze the inherited current list before changing a historical snapshot.
    return records.some((record) => record.month === today)
      ? [current]
      : [loadMonth(storage, today, today), current];
  }
  const anchor =
    records.find((record) => record.month === today) ??
    loadMonth(storage, today, today);
  const targets = new Map(
    records
      .filter((record) => record.month >= today)
      .map((record) => [record.month, record]),
  );
  targets.set(today, anchor);
  targets.set(current.month, current);
  return [...targets.values()].map((record) => withHabits(record, current));
}
