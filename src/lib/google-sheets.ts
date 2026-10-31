import { JWT } from "google-auth-library";
import { googleConfig } from "./google-config";
import {
  parseSheet,
  sheetRows,
  revision,
  type CloudMonth,
} from "./sheet-format";
import { parseMonth, type BackupMonth } from "./backup";

type Metadata = {
  sheets?: { properties: { sheetId: number; title: string } }[];
};
let credentials: JWT | undefined;
async function sheets<T>(path: string, body?: unknown): Promise<T> {
  const config = googleConfig();
  credentials ??= new JWT({
    email: config.serviceEmail,
    key: config.privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const token = await credentials.getAccessToken();
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheetId}${path}`,
    {
      method: body === undefined ? "GET" : "POST",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${token.token}`,
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (!response.ok)
    throw new Error(
      response.status === 429
        ? "Google ограничил частоту запросов. Подождите минуту и повторите сохранение."
        : "Не удалось обратиться к Google Sheets. Проверьте доступ к таблице и повторите попытку.",
    );
  return response.json();
}
export async function loadMonths() {
  const metadata = await sheets<Metadata>(
    "?fields=sheets.properties(sheetId,title)",
  );
  const tabs = (metadata.sheets ?? []).filter(({ properties }) =>
    /^\d{4}-(0[1-9]|1[0-2])$/.test(properties.title),
  );
  const records: Record<string, CloudMonth> = {};
  const revisions: Record<string, string | null> = {};
  // Bound each batch URL even for years of history.
  for (let offset = 0; offset < tabs.length; offset += 100) {
    const group = tabs.slice(offset, offset + 100);
    const query = new URLSearchParams({
      valueRenderOption: "UNFORMATTED_VALUE",
    });
    group.forEach(({ properties }) =>
      query.append("ranges", `'${properties.title}'!A1:AK12`),
    );
    const values = await sheets<{ valueRanges: { values?: unknown[][] }[] }>(
      `/values:batchGet?${query}`,
    );
    if (values.valueRanges.length !== group.length)
      throw new Error("Неполный ответ Google Sheets.");
    group.forEach(({ properties }, index) => {
      const rows = values.valueRanges[index].values ?? [];
      if (rows.length > 11)
        throw new Error(
          `Лист ${properties.title}: лишние строки в области данных.`,
        );
      const record = parseSheet(properties.title, rows);
      records[record.month] = record;
      revisions[record.month] = revision(record);
    });
  }
  return { records, revisions, tabs };
}
export class ConflictError extends Error {}
export async function saveMonths(
  input: BackupMonth[],
  expected: Record<string, unknown>,
) {
  const current = await loadMonths();
  const checked = input.map(parseMonth);
  for (const record of checked) {
    if (
      !(record.month in expected) ||
      expected[record.month] !== (current.revisions[record.month] ?? null)
    ) {
      throw new ConflictError(
        "Месяц изменился в таблице или на другом устройстве. Скачайте JSON черновика, затем обновите страницу и повторите импорт.",
      );
    }
  }
  const timestamp = new Date().toISOString();
  const records = checked.map((record) => ({ ...record, savedAt: timestamp }));
  const requests: unknown[] = [];
  for (const record of records) {
    const existing = current.tabs.find(
      (tab) => tab.properties.title === record.month,
    );
    // Deterministic ID makes concurrent creation fail instead of duplicating a month.
    const sheetId =
      existing?.properties.sheetId ?? Number(record.month.replace("-", ""));
    if (!existing)
      requests.push({
        addSheet: {
          properties: {
            sheetId,
            title: record.month,
            gridProperties: {
              rowCount: 12,
              columnCount: 37,
              frozenRowCount: 1,
              frozenColumnCount: 2,
            },
          },
        },
      });
    requests.push({
      updateCells: {
        start: { sheetId, rowIndex: 0, columnIndex: 0 },
        rows: sheetRows(record).map((row) => ({
          values: row.map((value) => ({
            userEnteredValue:
              typeof value === "number"
                ? { numberValue: value }
                : { stringValue: value },
          })),
        })),
        fields: "userEnteredValue",
      },
    });
  }
  // All month changes and sheet creation are committed in one atomic batch.
  await sheets(":batchUpdate", { requests });
  return {
    records,
    revisions: Object.fromEntries(
      records.map((record) => [record.month, revision(record)]),
    ),
  };
}
