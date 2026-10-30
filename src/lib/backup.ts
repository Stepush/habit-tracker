import {
  HABITS,
  daysInMonth,
  migrateLegacyGrid,
  storageKey,
  validGrid,
  validHabits,
  type Grid,
  type Habit,
} from "./model";

export type BackupMonth = {
  version: 1;
  month: string;
  habits: Habit[];
  habitIds: string[];
  grid: Grid;
};
type BackupStorage = Pick<
  Storage,
  "length" | "key" | "getItem" | "setItem" | "removeItem"
>;

export function parseMonth(value: unknown): BackupMonth {
  if (!value || typeof value !== "object")
    throw new Error("Неверный формат месяца.");
  const data = value as Record<string, unknown>;
  if (data.version !== 1 || typeof data.month !== "string")
    throw new Error("Неверный формат месяца.");
  daysInMonth(data.month);
  const habits = data.habits ?? HABITS.map((h) => ({ ...h }));
  const grid = migrateLegacyGrid(data.grid);
  if (
    !validHabits(habits) ||
    !validGrid(grid, data.month, habits.length) ||
    (data.habitIds !== undefined &&
      JSON.stringify(data.habitIds) !== JSON.stringify(habits.map((h) => h.id)))
  ) {
    throw new Error("Некорректные привычки или отметки в файле.");
  }
  return {
    version: 1,
    month: data.month,
    habits,
    habitIds: habits.map((h) => h.id),
    grid,
  };
}

export function parseBackup(value: unknown): BackupMonth[] {
  if (value && typeof value === "object" && "months" in value) {
    const data = value as Record<string, unknown>;
    if (
      data.version !== 1 ||
      data.type !== "ritm-backup" ||
      !Array.isArray(data.months) ||
      !data.months.length
    )
      throw new Error("Неверный формат резервной копии.");
    const months = data.months.map(parseMonth);
    if (new Set(months.map((m) => m.month)).size !== months.length)
      throw new Error("В файле повторяются месяцы.");
    return months;
  }
  return [parseMonth(value)];
}

export function collectBackup(storage: BackupStorage, current: BackupMonth) {
  const months = new Map<string, BackupMonth>();
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key?.startsWith(storageKey("")) || key === storageKey(current.month))
      continue;
    const record = parseMonth(JSON.parse(storage.getItem(key)!));
    if (storageKey(record.month) !== key)
      throw new Error("Повреждены сохранённые данные месяца.");
    months.set(record.month, record);
  }
  months.set(current.month, current);
  return {
    type: "ritm-backup",
    version: 1,
    months: [...months.values()].sort((a, b) => a.month.localeCompare(b.month)),
  };
}

export function restoreBackup(storage: BackupStorage, months: BackupMonth[]) {
  const previous = months.map(
    (record) =>
      [
        storageKey(record.month),
        storage.getItem(storageKey(record.month)),
      ] as const,
  );
  let written = 0;
  try {
    for (const record of months) {
      storage.setItem(
        storageKey(record.month),
        JSON.stringify({ ...record, savedAt: new Date().toISOString() }),
      );
      written++;
    }
  } catch {
    try {
      for (const [key, value] of previous.slice(0, written)) {
        if (value === null) storage.removeItem(key);
        else storage.setItem(key, value);
      }
    } catch {
      throw new Error(
        "Импорт прерван, часть месяцев могла измениться. Освободите место и повторите импорт.",
      );
    }
    throw new Error(
      "Не удалось сохранить импорт: хранилище недоступно или заполнено. Изменения отменены.",
    );
  }
}
