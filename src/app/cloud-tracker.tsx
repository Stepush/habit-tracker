"use client";

import { useEffect, useRef, useState } from "react";
import Tracker from "./tracker";
import { memoryStorage, type MonthStorage } from "@/lib/month-storage";
import { parseBackup, type BackupMonth } from "@/lib/backup";
import { storageKey } from "@/lib/model";

type User = { name: string; email: string; sub: string };
async function readResponse(response: Response) {
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error ?? "Google Sheets временно недоступен.");
  return data;
}
export default function CloudTracker({
  user,
  showDiagnostics,
}: {
  user: User;
  showDiagnostics: boolean;
}) {
  const [storage, setStorage] = useState<MonthStorage | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const revisions = useRef<Record<string, string | null>>({});
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    fetch("/api/months", { cache: "no-store", signal: controller.signal })
      .then(readResponse)
      .then((data) => {
        if (controller.signal.aborted) return;
        const records: BackupMonth[] = data.records.length
          ? parseBackup({
              type: "ritm-backup",
              version: 1,
              months: data.records,
            })
          : [];
        const next = memoryStorage();
        records.forEach((record) =>
          next.setItem(storageKey(record.month), JSON.stringify(record)),
        );
        revisions.current = data.revisions;
        setStorage(next);
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setError(
            error instanceof Error
              ? error.message
              : "Не удалось загрузить историю.",
          );
      });
    return () => controller.abort();
  }, [attempt]);

  async function persist(records: BackupMonth[]) {
    const response = await fetch("/api/months", {
      method: "POST",
      signal: AbortSignal.timeout(55_000),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        backup: { type: "ritm-backup", version: 1, months: records },
        revisions: Object.fromEntries(
          records.map((record) => [
            record.month,
            revisions.current[record.month] ?? null,
          ]),
        ),
      }),
    });
    const data = await readResponse(response);
    revisions.current = { ...revisions.current, ...data.revisions };
  }
  if (!storage)
    return (
      <main className="access-screen">
        <div className="access-card">
          <h1>Ритм</h1>
          <p role="status">{error || "Загружаем историю из Google Sheets…"}</p>
          {error && (
            <button
              className="primary"
              onClick={() => setAttempt((value) => value + 1)}
            >
              Повторить загрузку
            </button>
          )}
          <form action="/api/auth/logout" method="post">
            <button className="secondary">Выйти</button>
          </form>
        </div>
      </main>
    );
  return (
    <Tracker
      storage={storage}
      persist={persist}
      user={user}
      showDiagnostics={showDiagnostics}
    />
  );
}
