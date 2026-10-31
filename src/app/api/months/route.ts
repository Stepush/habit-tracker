import { session, sameOrigin } from "@/lib/google-auth";
import { configuration } from "@/lib/google-config";
import { loadMonths, saveMonths, ConflictError } from "@/lib/google-sheets";
import { parseBackup } from "@/lib/backup";

export const runtime = "nodejs";
export const maxDuration = 60;
const headers = { "Cache-Control": "no-store" };
async function authorized() {
  return configuration().ready && Boolean(await session());
}
export async function GET() {
  if (!(await authorized()))
    return Response.json(
      { error: "Войдите в свой аккаунт." },
      { status: 401, headers },
    );
  try {
    const { records, revisions } = await loadMonths();
    return Response.json(
      { records: Object.values(records), revisions },
      { headers },
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Не удалось загрузить историю.",
      },
      { status: 502, headers },
    );
  }
}
export async function POST(request: Request) {
  if (!(await authorized()))
    return Response.json(
      { error: "Сессия истекла. Скачайте JSON черновика и войдите снова." },
      { status: 401, headers },
    );
  if (!sameOrigin(request))
    return Response.json(
      { error: "Запрос отклонён." },
      { status: 403, headers },
    );
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    return Response.json({ error: "Нужен JSON." }, { status: 415, headers });
  let input;
  try {
    const text = await request.text();
    if (Buffer.byteLength(text) > 2_000_000)
      throw new Error(
        "Слишком большой импорт. Разделите его на несколько файлов.",
      );
    const body = JSON.parse(text);
    input = { records: parseBackup(body.backup), revisions: body.revisions };
    if (
      !input.revisions ||
      typeof input.revisions !== "object" ||
      Array.isArray(input.revisions)
    )
      throw new Error("Нет версий месяцев.");
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Неверный запрос." },
      { status: 400, headers },
    );
  }
  try {
    return Response.json(await saveMonths(input.records, input.revisions), {
      headers,
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Сохранение не удалось.",
      },
      { status: error instanceof ConflictError ? 409 : 502, headers },
    );
  }
}
