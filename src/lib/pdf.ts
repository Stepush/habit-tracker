import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import {
  FORMAT,
  HABITS,
  MAX_HABITS,
  daysInMonth,
  monthLabel,
  monthCalendar,
  templateId,
  type Habit,
} from "./model";
const mm = (value: number) => (value * 72) / 25.4;
export async function createTemplatePDF(
  month: string,
  fontBytes: Uint8Array,
  habits: readonly Habit[] = HABITS,
  accentFontBytes?: Uint8Array,
): Promise<Uint8Array> {
  if (habits.length > MAX_HABITS || habits.length === 0)
    throw new Error(
      "Для печати и сканирования на одном листе нужно от 1 до 10 привычек.",
    );
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(fontBytes, { subset: true });
  const accentFont = accentFontBytes
    ? await doc.embedFont(accentFontBytes, { subset: true })
    : font;
  const page = doc.addPage([mm(FORMAT.width), mm(FORMAT.height)]);
  const id = templateId(
    month,
    habits.map((h) => h.id),
  );
  doc.setTitle(`Ritm habit tracker - ${month}`);
  doc.setSubject(`Template ${id}; A4 landscape; 7 mm cells`);
  const text = (
    value: string,
    x: number,
    y: number,
    size = 9,
    gray = 0,
    face = font,
  ) =>
    page.drawText(value, {
      x: mm(x),
      y: mm(210 - y) - size,
      size,
      font: face,
      color: rgb(gray, gray, gray),
    });
  const rect = (
    x: number,
    y: number,
    w: number,
    h: number,
    fill?: number,
    border = false,
  ) =>
    page.drawRectangle({
      x: mm(x),
      y: mm(210 - y - h),
      width: mm(w),
      height: mm(h),
      ...(fill !== undefined ? { color: rgb(fill, fill, fill) } : {}),
      ...(border
        ? { borderColor: rgb(0.15, 0.15, 0.15), borderWidth: 0.55 }
        : { borderWidth: 0 }),
    });
  for (const p of FORMAT.markers) {
    rect(p.x - 3, p.y - 3, 6, 6, 0);
    rect(p.x - 2, p.y - 2, 4, 4, 1);
    rect(p.x - 1, p.y - 1, 2, 2, 0);
  }
  text("Ритм", 26, 13, 11, 0, accentFont);
  text(monthLabel(month).replace(" г.", ""), 12, 32, 24, 0, accentFont);
  text("ПРИВЫЧКА", 12, 59, 7, 0.35);
  const days = daysInMonth(month);
  for (let day = 0; day < days; day++) {
    const label = String(day + 1),
      size = 7;
    const width = font.widthOfTextAtSize(label, size);
    page.drawText(label, {
      x: mm(FORMAT.gridX + day * 7 + 3.5) - width / 2,
      y: mm(210 - 61) - size,
      font,
      size,
      color: rgb(0.25, 0.25, 0.25),
    });
    habits.forEach((_, row) => {
      rect(FORMAT.gridX + day * 7, FORMAT.gridY + row * 7, 7, 7, 1, true);
    });
  }
  habits.forEach((habit, row) => {
    const size = Math.min(
      9,
      mm(52) / Math.max(font.widthOfTextAtSize(habit.name, 1), 1),
    );
    text(habit.name, 12, FORMAT.gridY + row * 7 + 1.7, size);
  });
  monthCalendar(month).forEach(({ day, weekday }) => {
    const size = 7;
    page.drawText(weekday, {
      x:
        mm(FORMAT.gridX + (day - 1) * 7 + 3.5) -
        font.widthOfTextAtSize(weekday, size) / 2,
      y: mm(210 - (FORMAT.gridY + habits.length * 7 + 3)) - size,
      font,
      size,
      color: rgb(0.35, 0.35, 0.35),
    });
  });
  return doc.save();
}
