import Tracker from "./tracker";
import CloudTracker from "./cloud-tracker";
import { configuration } from "@/lib/google-config";
import { session } from "@/lib/google-auth";
import { connection } from "next/server";

export default async function AccessGate({
  showDiagnostics = false,
  loginFailed = false,
}: {
  showDiagnostics?: boolean;
  loginFailed?: boolean;
}) {
  await connection();
  const status = configuration();
  if (status.local) return <Tracker showDiagnostics={showDiagnostics} />;
  if (!status.ready)
    return (
      <main className="access-screen">
        <div className="access-card">
          <h1>Подключение Google</h1>
          <p>Для работы трекера завершите настройку Google-входа и таблицы.</p>
          <p>Инструкция: docs/google-setup.md в проекте.</p>
          {process.env.NODE_ENV !== "production" && (
            <p>
              Проверьте .env.local:{" "}
              {status.missing.join(", ") ||
                "некорректный адрес приложения, ID или длина SESSION_SECRET"}
              .
            </p>
          )}
        </div>
      </main>
    );
  const user = await session();
  if (!user)
    return (
      <main className="access-screen">
        <div className="access-card access-login">
          <h1>Ритм</h1>
          {loginFailed && (
            <p role="alert">Вход не завершён. Попробуйте ещё раз.</p>
          )}
          <form action="/api/auth/login" method="get">
            <button className="google-sign-in" type="submit">
              Войти через Google
            </button>
          </form>
        </div>
      </main>
    );
  return (
    <CloudTracker
      user={{ name: user.name, email: user.email, sub: user.sub }}
      showDiagnostics={showDiagnostics}
    />
  );
}
