export const HABITS = [
  {
    id: "27f5a849-9b01-47d2-a1ef-2df6a4b670c8",
    name: "Читать 20 минут",
    color: "#7a9271",
    short: "Чтение",
  },
  {
    id: "cd06f0c1-71b4-44ba-b19d-0d1b9d1e8e70",
    name: "Двигаться каждый день",
    color: "#c69372",
    short: "Движение",
  },
  {
    id: "e8a47d3c-0db5-421b-88f8-595a4958c4f3",
    name: "Пить достаточно воды",
    color: "#7a9ca9",
    short: "Вода",
  },
  {
    id: "b130cb96-38fe-4fb5-81c8-95e8a7d2d6a4",
    name: "Время для себя",
    color: "#a393b8",
    short: "Тишина",
  },
] as const;
export type Habit = { id: string; name: string; color: string; short: string };
export const MIN_HABITS = 1;
export const MAX_HABITS = 10;
export function validHabits(value: unknown): value is Habit[] {
  return (
    Array.isArray(value) &&
    value.length >= MIN_HABITS &&
    value.length <= MAX_HABITS &&
    value.every(
      (habit) =>
        habit &&
        typeof habit.id === "string" &&
        habit.id.length > 0 &&
        habit.id.length <= 100 &&
        typeof habit.name === "string" &&
        habit.name.trim().length > 0 &&
        habit.name.length <= 80 &&
        typeof habit.short === "string" &&
        habit.short.length <= 80 &&
        typeof habit.color === "string" &&
        /^#[0-9a-f]{6}$/i.test(habit.color),
    ) &&
    new Set(value.map((habit) => habit.id)).size === value.length
  );
}
export const STATUSES = ["missed", "completed"] as const;
export type Status = (typeof STATUSES)[number];
export type Grid = Status[][];
export const STATUS_LABELS: Record<Status, string> = {
  missed: "Не выполнено",
  completed: "Выполнено",
};
export const FORMAT = {
  version: 1,
  width: 297,
  height: 210,
  gridX: 68,
  gridY: 66,
  cell: 7,
};
export function daysInMonth(month: string): number {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Invalid month");
  const [year, value] = month.split("-").map(Number);
  if (year < 2000 || year > 2100)
    throw new Error("Month outside supported range");
  return new Date(Date.UTC(year, value, 0)).getUTCDate();
}
export function emptyGrid(month: string, count: number = HABITS.length): Grid {
  return Array.from({ length: count }, () =>
    Array<Status>(daysInMonth(month)).fill("missed"),
  );
}
export function monthCalendar(month: string) {
  const dayCount = daysInMonth(month);
  const weekdayFormat = new Intl.DateTimeFormat("ru-RU", {
    weekday: "short",
    timeZone: "UTC",
  });
  return Array.from({ length: dayCount }, (_, index) => {
    const day = index + 1;
    const date = new Date(`${month}-${String(day).padStart(2, "0")}T12:00:00Z`);
    return { day, weekday: weekdayFormat.format(date) };
  });
}
// Retired statuses are loaded as not completed; new records are binary.
export function migrateLegacyGrid(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((row) =>
    Array.isArray(row)
      ? row.map((status) =>
          status === "partial" || status === "excused" ? "missed" : status,
        )
      : row,
  );
}
export function validGrid(
  value: unknown,
  month: string,
  count: number = HABITS.length,
): value is Grid {
  return (
    Array.isArray(value) &&
    value.length === count &&
    value.every(
      (row) =>
        Array.isArray(row) &&
        row.length === daysInMonth(month) &&
        row.every((v) => STATUSES.includes(v)),
    )
  );
}
export function summarize(grid: Grid) {
  const values = grid.flat();
  const completed = values.filter((s) => s === "completed").length;
  const available = values.length;
  return {
    completed,
    available,
    rate: available ? Math.round((completed / available) * 100) : null,
  };
}
export function completionChange(
  current: ReturnType<typeof summarize> | undefined,
  previous: ReturnType<typeof summarize> | undefined,
): number | null {
  if (current?.rate == null || previous?.rate == null) return null;
  return current.rate - previous.rate;
}
export function monthLabel(month: string) {
  return new Intl.DateTimeFormat("ru", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${month}-01T12:00:00Z`));
}
export function storageKey(month: string) {
  return `paper-first:v1:${month}`;
}

export const HABIT_COLORS = [
  "#7a9271",
  "#c69372",
  "#7a9ca9",
  "#a393b8",
  "#c58d9b",
  "#baa362",
  "#71a49b",
  "#929fc5",
  "#b29b87",
  "#9baa75",
] as const;
const LEGACY_HABIT_IDS: Record<string, string> = {
  read: "27f5a849-9b01-47d2-a1ef-2df6a4b670c8",
  move: "cd06f0c1-71b4-44ba-b19d-0d1b9d1e8e70",
  water: "e8a47d3c-0db5-421b-88f8-595a4958c4f3",
  quiet: "b130cb96-38fe-4fb5-81c8-95e8a7d2d6a4",
};
export function nextHabitColor(habits: readonly Habit[]): string {
  const used = new Set(habits.map((habit) => habit.color.toLowerCase()));
  const color = HABIT_COLORS.find((color) => !used.has(color));
  if (!color) throw new Error("Нет свободного цвета для привычки.");
  return color;
}
// Stable migration keeps identities and completion rows aligned across months.
export function normalizeHabits(habits: readonly Habit[]): Habit[] {
  const used = new Set<string>();
  return habits.map((habit) => {
    const color = used.has(habit.color.toLowerCase())
      ? (HABIT_COLORS.find(
          (candidate) =>
            !used.has(candidate) &&
            !habits.some((h) => h.color.toLowerCase() === candidate),
        ) ?? HABIT_COLORS.find((candidate) => !used.has(candidate))!)
      : habit.color;
    used.add(color.toLowerCase());
    return { ...habit, id: LEGACY_HABIT_IDS[habit.id] ?? habit.id, color };
  });
}
