"use client";

import { useEffect, useState } from "react";
import type { MonthStorage } from "@/lib/month-storage";
import {
  HABITS,
  monthLabel,
  storageKey,
  summarize,
  emptyGrid,
  completionChange,
  validGrid,
  migrateLegacyGrid,
  validHabits,
  type Grid,
  type Habit,
} from "@/lib/model";

type PreviousMonth = {
  month: string;
  stats: ReturnType<typeof summarize>;
  habits: readonly Habit[];
};

function offsetMonth(month: string, offset: number) {
  const date = new Date(`${month}-01T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 7);
}

function signed(value: number) {
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value)}`;
}

export default function MonthStatistics({
  month,
  grid,
  historyRevision,
  storage,
}: {
  month: string;
  grid: Grid;
  historyRevision: number;
  storage?: MonthStorage;
}) {
  const previousMonth = offsetMonth(month, -1);
  const [history, setHistory] = useState<Record<string, PreviousMonth>>({});
  const [readError, setReadError] = useState(false);

  useEffect(() => {
    const months = Array.from({ length: 5 }, (_, i) =>
      offsetMonth(month, -i - 1),
    );
    function readHistory() {
      const records: Record<string, PreviousMonth> = {};
      let failed = false;
      for (const period of months) {
        if (period < "2000-01") continue;
        try {
          const raw = (storage ?? localStorage).getItem(storageKey(period));
          if (!raw) {
            records[period] = {
              month: period,
              stats: summarize(emptyGrid(period)),
              habits: HABITS,
            };
            continue;
          }
          const value = JSON.parse(raw);
          if (value && typeof value === "object")
            value.grid = migrateLegacyGrid(value.grid);
          if (
            !value ||
            value.version !== 1 ||
            value.month !== period ||
            (value.habits !== undefined && !validHabits(value.habits)) ||
            !validGrid(
              value.grid,
              period,
              value.habits?.length ?? HABITS.length,
            )
          ) {
            throw new Error("Invalid saved month");
          }
          records[period] = {
            month: period,
            stats: summarize(value.grid),
            habits: value.habits ?? HABITS,
          };
        } catch {
          failed = true;
        }
      }
      setHistory(records);
      setReadError(failed);
    }
    readHistory();
    function onStorage(event: StorageEvent) {
      if (
        event.key === null ||
        months.some((period) => event.key === storageKey(period))
      )
        readHistory();
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [month, historyRevision, storage]);

  const stats = summarize(grid);
  const baseline = history[previousMonth];
  const currentRate = stats.rate ?? 0;
  const delta = completionChange(stats, baseline?.stats);
  const periods = Array.from({ length: 4 }, (_, i) => {
    const period = offsetMonth(month, i - 4);
    return {
      month: period,
      delta: completionChange(
        history[period]?.stats,
        history[offsetMonth(period, -1)]?.stats,
      ),
    };
  });

  return (
    <section className="stats-grid" aria-label="Статистика выбранного месяца">
      <article className="stat-card">
        <span>Выполнение за месяц</span>
        <strong>
          {stats.rate ?? "—"}
          <small>{stats.rate === null ? "" : "%"}</small>
        </strong>
        <div className="stat-summary">
          <span className="stat-foot">
            Выполнено {stats.completed} из {stats.available}
          </span>
          <div className="mini-progress" aria-hidden="true">
            <i style={{ width: `${currentRate}%` }} />
          </div>
        </div>
      </article>
      <article className="stat-card">
        <span title="Разница процентов выполнения текущего и предыдущего месяца">
          Динамика выполнения
        </span>
        <strong
          className={
            delta === null || delta === 0
              ? undefined
              : delta > 0
                ? "stat-increase"
                : "stat-decrease"
          }
        >
          {delta === null ? "—" : signed(delta)}
          {delta !== null && <small>%</small>}
        </strong>
        <div
          className="stat-history"
          aria-label="Динамика за четыре предыдущих месяца"
        >
          {periods.map((period) => (
            <div className="stat-history-month" key={period.month}>
              <span
                className="stat-history-label"
                title={monthLabel(period.month)}
              >
                {new Intl.DateTimeFormat("ru-RU", {
                  month: "short",
                  timeZone: "UTC",
                }).format(new Date(`${period.month}-01T12:00:00Z`))}
              </span>
              <span
                className={`stat-history-delta ${period.delta !== null && period.delta > 0 ? "positive" : period.delta !== null && period.delta < 0 ? "negative" : ""}`}
                aria-label={
                  period.delta === null
                    ? "Нет данных для сравнения"
                    : `Изменение к предыдущему месяцу: ${signed(period.delta)}%`
                }
              >
                {period.delta === null ? "—" : `${signed(period.delta)}%`}
              </span>
            </div>
          ))}
        </div>
        {readError && (
          <p className="stat-detail">
            Не удалось прочитать часть истории. Сравнение недоступно для этих
            месяцев.
          </p>
        )}
      </article>
    </section>
  );
}
