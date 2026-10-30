export const HABITS = [
  { id: "read", name: "Читать 20 минут", color: "#7a9271", short: "Чтение" },
  {
    id: "move",
    name: "Двигаться каждый день",
    color: "#c69372",
    short: "Движение",
  },
  {
    id: "water",
    name: "Пить достаточно воды",
    color: "#7a9ca9",
    short: "Вода",
  },
  { id: "quiet", name: "Время для себя", color: "#a393b8", short: "Тишина" },
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
export type Point = { x: number; y: number };
export type CellPrediction = {
  row: number;
  day: number;
  status: Status;
  score: number;
  needsReview: boolean;
  coverage: number;
};
export type ScanResult = {
  cells: CellPrediction[];
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
  manual: boolean;
};
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
  markers: [
    { x: 15, y: 15 },
    { x: 282, y: 15 },
    { x: 282, y: 195 },
    { x: 15, y: 195 },
  ] as Point[],
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
export function templateId(
  month: string,
  habitIds: readonly string[] = HABITS.map((h) => h.id),
) {
  daysInMonth(month);
  const version = qrPayload(month, habitIds).startsWith("paper:v1:") ? 1 : 2;
  return `PAPER-V${version}-${month}-${habitIds.length}`;
}
export function qrPayload(
  month: string,
  habitIds: readonly string[] = HABITS.map((h) => h.id),
) {
  return JSON.stringify(habitIds) === JSON.stringify(HABITS.map((h) => h.id))
    ? `paper:v1:${month}:fixed4`
    : `paper:v2:${month}:${JSON.stringify(habitIds)}`;
}
export function monthFromQR(payload: string): string | null {
  const match =
    /^paper:v1:(\d{4}-\d{2}):fixed4$/.exec(payload) ||
    /^paper:v2:(\d{4}-\d{2}):\[.*\]$/.exec(payload);
  if (!match) return null;
  try {
    daysInMonth(match[1]);
    return match[1];
  } catch {
    return null;
  }
}
export function storageKey(month: string) {
  return `paper-first:v1:${month}`;
}
