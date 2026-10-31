import { readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";

const args = process.argv.slice(2);
function option(name) {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}
const target = resolve(".env.local");
try {
  const owner = option("--owner-sub");
  if (owner) {
    if (!/^\d+$/.test(owner))
      throw new Error("Google ID должен содержать только цифры.");
    const current = await readFile(target, "utf8");
    if (!/^GOOGLE_OWNER_SUB=.*$/m.test(current))
      throw new Error("В .env.local отсутствует GOOGLE_OWNER_SUB.");
    await writeFile(
      target,
      current.replace(/^GOOGLE_OWNER_SUB=.*$/m, `GOOGLE_OWNER_SUB=${owner}`),
      { mode: 0o600 },
    );
    console.log(
      "Владелец обновлён. Перезапустите dev-сервер. Секреты не выводились.",
    );
  } else {
    const keyPath = option("--service-account");
    const clientPath = option("--oauth-client");
    const spreadsheet = option("--spreadsheet");
    if (!keyPath || !clientPath || !spreadsheet)
      throw new Error(
        "Использование: npm run setup:google -- --service-account /путь/к/ключу.json --oauth-client /путь/к/oauth.json --spreadsheet URL_ТАБЛИЦЫ\nДля привязки владельца: npm run setup:google -- --owner-sub ВАШ_GOOGLE_ID",
      );
    const key = JSON.parse(await readFile(resolve(keyPath), "utf8"));
    const client = JSON.parse(await readFile(resolve(clientPath), "utf8")).web;
    const id =
      spreadsheet.match(/\/spreadsheets\/d\/([\w-]+)/)?.[1] ?? spreadsheet;
    if (
      key.type !== "service_account" ||
      !key.client_email ||
      !key.private_key?.includes("BEGIN PRIVATE KEY")
    )
      throw new Error("Нужен JSON-ключ сервисного аккаунта Google.");
    if (!client?.client_id || !client.client_secret)
      throw new Error("Нужен JSON OAuth-клиента типа Web application.");
    if (!/^[\w-]+$/.test(id)) throw new Error("Неверный ID таблицы.");
    const fields = {
      APP_URL: "http://127.0.0.1:3000",
      SESSION_SECRET: randomBytes(32).toString("hex"),
      GOOGLE_CLIENT_ID: client.client_id,
      GOOGLE_CLIENT_SECRET: client.client_secret,
      GOOGLE_OWNER_SUB: "0",
      GOOGLE_SERVICE_ACCOUNT_EMAIL: key.client_email,
      GOOGLE_PRIVATE_KEY: key.private_key,
      GOOGLE_SPREADSHEET_ID: id,
    };
    // JSON quoting preserves escaped newlines for Next's dotenv parser. Refuse overwrites.
    const content =
      Object.entries(fields)
        .map(([name, value]) => `${name}=${JSON.stringify(value)}`)
        .join("\n") + "\n";
    await writeFile(target, content, { flag: "wx", mode: 0o600 });
    console.log(
      ".env.local создан. Ключи не выводились. Перезапустите dev-сервер и войдите через Google для получения ID владельца.",
    );
  }
} catch (error) {
  console.error(
    error?.code === "EEXIST"
      ? ".env.local уже существует; он не был изменён."
      : error instanceof SyntaxError
        ? "Не удалось прочитать JSON. Проверьте, что указаны исходные файлы, скачанные из Google Cloud."
        : error instanceof Error
          ? error.message
          : "Настройка не завершена.",
  );
  process.exitCode = 1;
}
