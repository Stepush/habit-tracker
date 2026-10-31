import { createHash } from "node:crypto";
import { parseMonth, type BackupMonth } from "./backup";
import { daysInMonth, MAX_HABITS } from "./model";

export type CloudMonth = BackupMonth & { savedAt: string };
export const SHEET_HEADER = [
  "ID",
  "Привычка",
  "Цвет",
  "Короткое название",
  ...Array.from({ length: 31 }, (_, i) => String(i + 1)),
  "Сохранено",
  "Формат",
];
export function sheetRows(record: CloudMonth): (string | number)[][] {
  const checked = parseMonth(record);
  return [
    SHEET_HEADER,
    ...Array.from({ length: MAX_HABITS }, (_, index) => {
      const habit = checked.habits[index];
      return habit
        ? [
            habit.id,
            habit.name,
            habit.color,
            habit.short,
            ...Array.from({ length: 31 }, (_, day) =>
              day < checked.grid[index].length
                ? Number(checked.grid[index][day] === "completed")
                : "",
            ),
            record.savedAt,
            "ritm:v1",
          ]
        : Array(37).fill("");
    }),
  ];
}
export function parseSheet(month: string, rows: unknown[][]): CloudMonth {
  if (JSON.stringify(rows[0]) !== JSON.stringify(SHEET_HEADER))
    throw new Error(
      `Лист ${month}: неизвестный формат. Восстановите заголовки или используйте пустую таблицу.`,
    );
  const data = rows.slice(1);
  // Sheets omits trailing empty cells and rows. Gaps between habits are invalid.
  while (
    data.length &&
    data[data.length - 1].every((v) => v === "" || v == null)
  )
    data.pop();
  const count = daysInMonth(month);
  if (
    !data.length ||
    data.length > MAX_HABITS ||
    data.some(
      (row) =>
        row[36] !== "ritm:v1" ||
        typeof row[35] !== "string" ||
        Number.isNaN(Date.parse(row[35])) ||
        row[35] !== data[0][35],
    )
  )
    throw new Error(`Лист ${month}: повреждены служебные данные.`);
  const grid = data.map((row) =>
    Array.from({ length: count }, (_, day) => {
      const value = row[4 + day];
      if (value !== 0 && value !== 1)
        throw new Error(`Лист ${month}: отметка должна быть 0 или 1.`);
      return value === 1 ? "completed" : "missed";
    }),
  );
  const record = parseMonth({
    version: 1,
    month,
    habits: data.map((row) => ({
      id: row[0],
      name: row[1],
      color: row[2],
      short: row[3],
    })),
    grid,
  });
  return { ...record, savedAt: String(data[0][35]) };
}
export function revision(record: CloudMonth | undefined) {
  return record
    ? createHash("sha256").update(JSON.stringify(record)).digest("hex")
    : null;
}
