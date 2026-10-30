"use client";

import { useEffect, useRef, useState } from "react";
import MonthStatistics from "./month-statistics";
import Toast from "./toast";
import {
  collectBackup,
  parseBackup,
  parseMonth,
  restoreBackup,
} from "@/lib/backup";
import {
  Archive,
  ArrowDownToLine,
  ArrowUpFromLine,
  ArrowDown,
  ArrowUp,
  ArrowLeft,
  ArrowRight,
  Calendar,
  Check,
  ChevronDown,
  FileText,
  Grid2X2,
  LoaderCircle,
  LogOut,
  Plus,
  UserRound,
  ScanLine,
  X,
  Target,
} from "lucide-react";
import {
  FORMAT,
  HABITS,
  MIN_HABITS,
  MAX_HABITS,
  STATUSES,
  STATUS_LABELS,
  daysInMonth,
  emptyGrid,
  monthLabel,
  monthCalendar,
  storageKey,
  validGrid,
  migrateLegacyGrid,
  validHabits,
  type Habit,
  type Grid,
  type Point,
  type ScanResult,
  type Status,
} from "@/lib/model";

type SavedMonth = {
  habits?: Habit[];
  version: 1;
  month: string;
  grid: Grid;
  savedAt: string;
};
type SourceImage = { rgba: Uint8ClampedArray; width: number; height: number };
const INITIAL_MONTH = "2026-10";
const NAVIGATION = [
  { id: "habits", label: "Трекер", icon: Grid2X2 },
  { id: "paper-tools", label: "Бумажный лист", icon: FileText },
  { id: "backup", label: "Резервная копия", icon: Archive },
] as const;
type SectionId = (typeof NAVIGATION)[number]["id"];
const CORNER_NAMES = [
  "верхний левый",
  "верхний правый",
  "нижний правый",
  "нижний левый",
];
function clone(grid: Grid): Grid {
  return grid.map((row) => [...row]);
}
function download(data: Blob, name: string) {
  const url = URL.createObjectURL(data),
    anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function Tracker({
  showDiagnostics = false,
}: {
  showDiagnostics?: boolean;
}) {
  const [month, setMonth] = useState(INITIAL_MONTH),
    [grid, setGrid] = useState<Grid>(() => emptyGrid(INITIAL_MONTH));
  const [saved, setSaved] = useState<Grid>(() => emptyGrid(INITIAL_MONTH)),
    [ready, setReady] = useState(false);
  const [habits, setHabits] = useState<Habit[]>(() =>
    HABITS.map((h) => ({ ...h })),
  );
  const [savedHabits, setSavedHabits] = useState<Habit[]>(() =>
    HABITS.map((h) => ({ ...h })),
  );
  const [showHabitErrors, setShowHabitErrors] = useState(false);
  const [newHabitId, setNewHabitId] = useState<string | null>(null);
  const [mode, setMode] = useState<"view" | "fill" | "habits">("view");
  const isEditing = mode !== "view";
  const [error, setError] = useState("");
  const [backupMessage, setBackupMessage] = useState("");
  const [historyRevision, setHistoryRevision] = useState(0);
  const [pdfBusy, setPdfBusy] = useState(false),
    [scanBusy, setScanBusy] = useState(false),
    [progress, setProgress] = useState("");
  const [source, setSource] = useState<SourceImage | null>(null),
    [result, setResult] = useState<ScanResult | null>(null);
  const [manual, setManual] = useState(false),
    [corners, setCorners] = useState<Point[]>([]),
    [pending, setPending] = useState<Set<string>>(new Set());
  const [truth, setTruth] = useState<Grid | null>(null);
  const [activeSection, setActiveSection] = useState<SectionId>("habits");
  const [pickerYear, setPickerYear] = useState(
    Number(INITIAL_MONTH.slice(0, 4)),
  );
  const navigationTarget = useRef<SectionId | null>(null);
  const initializedMonth = useRef(false);
  const canvas = useRef<HTMLCanvasElement>(null),
    corrected = useRef<HTMLCanvasElement>(null),
    scanner = useRef<Worker | null>(null),
    fileInput = useRef<HTMLInputElement>(null);
  const dirty =
      JSON.stringify(grid) !== JSON.stringify(saved) ||
      JSON.stringify(habits) !== JSON.stringify(savedHabits),
    dayCount = daysInMonth(month),
    calendar = monthCalendar(month);

  useEffect(() => {
    if (!initializedMonth.current) {
      initializedMonth.current = true;
      const today = new Date();
      const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
      if (
        currentMonth >= "2000-01" &&
        currentMonth <= "2100-12" &&
        currentMonth !== month
      ) {
        setMonth(currentMonth);
        return;
      }
    }
    setReady(false);
    setMode("view");
    setShowHabitErrors(false);
    setError("");
    let next = emptyGrid(month);
    let nextHabits: Habit[] = HABITS.map((h) => ({ ...h }));
    try {
      const raw = localStorage.getItem(storageKey(month));
      if (raw) {
        const value = JSON.parse(raw);
        if (value && typeof value === "object")
          value.grid = migrateLegacyGrid(value.grid);
        if (
          value.version !== 1 ||
          value.month !== month ||
          (value.habits !== undefined && !validHabits(value.habits)) ||
          !validGrid(value.grid, month, value.habits?.length ?? HABITS.length)
        )
          throw new Error("Неверный формат сохранённого месяца.");
        next = value.grid;
        nextHabits = value.habits ?? nextHabits;
      }
    } catch {
      setError(
        "Не удалось прочитать сохранённый месяц. Восстановите данные из резервной копии.",
      );
    }
    setHabits(nextHabits.map((h) => ({ ...h })));
    setSavedHabits(nextHabits.map((h) => ({ ...h })));
    setGrid(clone(next));
    setSaved(clone(next));
    setPending(new Set());
    setTruth(null);
    setResult(null);
    setSource(null);
    setManual(false);
    setCorners([]);
    setReady(true);
  }, [month]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  useEffect(
    () => () => {
      scanner.current?.terminate();
    },
    [],
  );
  useEffect(() => {
    if (!source || !canvas.current) return;
    const node = canvas.current;
    node.width = source.width;
    node.height = source.height;
    const ctx = node.getContext("2d");
    if (!ctx) return;
    ctx.putImageData(
      new ImageData(
        new Uint8ClampedArray(source.rgba),
        source.width,
        source.height,
      ),
      0,
      0,
    );
    corners.forEach((point, i) => {
      const radius = Math.max(14, source.width / 60);
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = "#52694b";
      ctx.fill();
      ctx.strokeStyle = "white";
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = "white";
      ctx.font = `bold ${radius * 1.2}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(i + 1), point.x, point.y);
    });
  }, [source, corners]);
  useEffect(() => {
    if (!result || !corrected.current) return;
    const node = corrected.current;
    node.width = result.width;
    node.height = result.height;
    const ctx = node.getContext("2d");
    if (!ctx) return;
    ctx.putImageData(
      new ImageData(
        new Uint8ClampedArray(result.rgba),
        result.width,
        result.height,
      ),
      0,
      0,
    );
    ctx.strokeStyle = "#c77f37";
    ctx.lineWidth = 2;
    result.cells
      .filter((c) => c.needsReview)
      .forEach((c) =>
        ctx.strokeRect(
          (FORMAT.gridX + c.day * 7) * 5,
          (FORMAT.gridY + c.row * 7) * 5,
          35,
          35,
        ),
      );
  }, [result]);

  useEffect(() => {
    let frame = 0;
    const updateSection = () => {
      frame = 0;
      if (navigationTarget.current) return;
      const offset = parseFloat(
        getComputedStyle(document.getElementById("paper-tools")!)
          .scrollMarginTop,
      );
      let current: SectionId = "habits";
      for (const { id } of NAVIGATION) {
        const section = document.getElementById(id);
        if (section && section.getBoundingClientRect().top <= offset + 1) {
          current = id;
        }
      }
      // The final section can be shorter than the remaining viewport.
      if (
        window.scrollY > 0 &&
        Math.ceil(window.scrollY + window.innerHeight) >=
          document.documentElement.scrollHeight - 2
      ) {
        current = "backup";
      }
      setActiveSection(current);
    };
    const scheduleUpdate = () => {
      if (!frame) frame = requestAnimationFrame(updateSection);
    };
    const resumeScrollTracking = () => {
      navigationTarget.current = null;
      scheduleUpdate();
    };
    const handleScrollKey = (event: KeyboardEvent) => {
      if (
        [
          "ArrowUp",
          "ArrowDown",
          "PageUp",
          "PageDown",
          "Home",
          "End",
          " ",
        ].includes(event.key)
      ) {
        resumeScrollTracking();
      }
    };
    const openHashTarget = () => {
      const target = NAVIGATION.find(
        ({ id }) => `#${id}` === window.location.hash,
      );
      navigationTarget.current = target?.id ?? null;
      if (target) setActiveSection(target.id);
      scheduleUpdate();
    };
    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", resumeScrollTracking);
    window.addEventListener("wheel", resumeScrollTracking, { passive: true });
    window.addEventListener("touchstart", resumeScrollTracking, {
      passive: true,
    });
    window.addEventListener("pointerdown", resumeScrollTracking);
    window.addEventListener("keydown", handleScrollKey);
    window.addEventListener("hashchange", openHashTarget);
    const observer = new ResizeObserver(scheduleUpdate);
    const main = document.querySelector("main");
    if (main) observer.observe(main);
    openHashTarget();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", resumeScrollTracking);
      window.removeEventListener("wheel", resumeScrollTracking);
      window.removeEventListener("touchstart", resumeScrollTracking);
      window.removeEventListener("pointerdown", resumeScrollTracking);
      window.removeEventListener("keydown", handleScrollKey);
      window.removeEventListener("hashchange", openHashTarget);
    };
  }, []);

  function changeMonth(next: string) {
    if (next === month || next < "2000-01" || next > "2100-12") return;
    try {
      daysInMonth(next);
    } catch {
      return;
    }
    if (
      scanBusy ||
      (dirty &&
        !window.confirm(
          "Есть несохранённые изменения. Перейти к другому месяцу и отменить их?",
        ))
    )
      return;
    setMonth(next);
  }
  function stepMonth(delta: number) {
    const date = new Date(`${month}-01T12:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + delta);
    changeMonth(date.toISOString().slice(0, 7));
  }
  function paint(row: number, day: number) {
    if (mode !== "fill" || !ready) return;
    setGrid((current) =>
      current.map((cells, i) =>
        i === row
          ? cells.map((s, j) =>
              j === day ? (s === "completed" ? "missed" : "completed") : s,
            )
          : cells,
      ),
    );
    setPending((current) => {
      const next = new Set(current);
      next.delete(`${row}:${day}`);
      return next;
    });
  }
  function updateHabitOrder(next: Habit[]) {
    if (next.length < MIN_HABITS || next.length > MAX_HABITS) return;
    const indices = next.map((h) => habits.findIndex((old) => old.id === h.id));
    setGrid(
      indices.map((index) =>
        index < 0 ? Array<Status>(dayCount).fill("missed") : [...grid[index]],
      ),
    );
    setPending(
      new Set(
        indices.flatMap((oldIndex, index) =>
          Array.from({ length: dayCount }, (_, day) =>
            pending.has(`${oldIndex}:${day}`) ? `${index}:${day}` : null,
          ).filter((key): key is string => key !== null),
        ),
      ),
    );
    setHabits(next);
    setResult(null);
    setTruth(null);
  }
  function addHabit() {
    if (habits.length >= MAX_HABITS) return;
    const id = crypto.randomUUID();
    setNewHabitId(id);
    updateHabitOrder([
      ...habits,
      {
        id,
        name: "",
        short: "",
        color: HABITS[habits.length % HABITS.length].color,
      },
    ]);
  }
  function moveHabit(row: number, direction: number) {
    const next = [...habits];
    [next[row], next[row + direction]] = [next[row + direction], next[row]];
    updateHabitOrder(next);
  }
  function save() {
    const invalidName = habits.find((habit) => !habit.name.trim());
    if (invalidName) {
      setError("");
      setShowHabitErrors(true);
      setMode("habits");
      requestAnimationFrame(() =>
        document.getElementById(`habit-name-${invalidName.id}`)?.focus(),
      );
      return;
    }
    if (!validHabits(habits)) {
      setError(
        "Не удалось сохранить список привычек. Проверьте названия и количество привычек.",
      );
      return;
    }
    const normalized = habits.map((h) => ({
      ...h,
      name: h.name.trim(),
      short: h.short.trim() || h.name.trim(),
    }));
    try {
      const timestamp = new Date().toISOString();
      const payload: SavedMonth = {
        version: 1,
        month,
        grid: clone(grid),
        habits: normalized,
        savedAt: timestamp,
      };
      localStorage.setItem(storageKey(month), JSON.stringify(payload));
      setSaved(clone(grid));
      setHabits(normalized);
      setSavedHabits(normalized.map((h) => ({ ...h })));
      setMode("view");
      setPending(new Set());
      setError("");
    } catch {
      setError(
        "Сохранение недоступно или хранилище заполнено. Изменения остались в черновике — скачайте JSON.",
      );
    }
  }
  async function makePDF() {
    setPdfBusy(true);
    setError("");
    try {
      const [{ createTemplatePDF }, response, accentResponse] =
        await Promise.all([
          import("@/lib/pdf"),
          fetch("/fonts/OpenSans-Variable.ttf"),
          fetch("/fonts/Georgia-Bold.ttf"),
        ]);
      if (!response.ok || !accentResponse.ok)
        throw new Error("Не удалось загрузить шрифт.");
      const bytes = await createTemplatePDF(
        month,
        new Uint8Array(await response.arrayBuffer()),
        habits,
        new Uint8Array(await accentResponse.arrayBuffer()),
      );
      download(
        new Blob([new Uint8Array(bytes)], { type: "application/pdf" }),
        `ritm-${month}.pdf`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось создать PDF.");
    } finally {
      setPdfBusy(false);
    }
  }
  async function loadPhoto(file?: File) {
    if (!file) return;
    setError("");
    setResult(null);
    setSource(null);
    setManual(false);
    setCorners([]);
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError(
        "Выберите JPEG, PNG или WebP. HEIC сначала преобразуйте в JPEG.",
      );
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      setError("Файл больше 25 МБ. Уменьшите фотографию.");
      return;
    }
    setScanBusy(true);
    try {
      const image = await createImageBitmap(file, {
        imageOrientation: "from-image",
      });
      try {
        const scale = Math.min(1, 2200 / Math.max(image.width, image.height)),
          node = document.createElement("canvas");
        node.width = Math.round(image.width * scale);
        node.height = Math.round(image.height * scale);
        const ctx = node.getContext("2d", { willReadFrequently: true });
        if (!ctx) throw new Error("Canvas недоступен.");
        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, node.width, node.height);
        ctx.drawImage(image, 0, 0, node.width, node.height);
        const rgba = ctx.getImageData(0, 0, node.width, node.height).data;
        setSource({ rgba, width: node.width, height: node.height });
        requestAnimationFrame(() => {
          document.getElementById("photo-review")?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
        });
      } finally {
        image.close();
      }
    } catch {
      setError(
        "Браузер не смог открыть фото. Попробуйте JPEG или заполните таблицу вручную.",
      );
    } finally {
      setScanBusy(false);
    }
  }
  function scan() {
    if (!source) return;
    setScanBusy(true);
    setError("");
    setResult(null);
    setProgress("Подготавливаем сканер…");
    scanner.current?.terminate();
    const worker = new Worker("/scanner.worker.js");
    scanner.current = worker;
    const timeout = setTimeout(() => {
      worker.terminate();
      setScanBusy(false);
      setError(
        "Обработка заняла больше минуты. Уменьшите фото или заполните таблицу вручную.",
      );
    }, 60000);
    worker.onmessage = (event) => {
      const data = event.data;
      if (data.type === "progress") {
        setProgress(data.message);
        return;
      }
      clearTimeout(timeout);
      setScanBusy(false);
      worker.terminate();
      if (data.type === "error") {
        setError(data.message);
        return;
      }
      setResult(data.result);
    };
    worker.onerror = () => {
      clearTimeout(timeout);
      setScanBusy(false);
      worker.terminate();
      setError(
        "Не удалось распознать лист. Попробуйте другое фото или заполните таблицу вручную.",
      );
    };
    worker.postMessage({
      ...source,
      rgba: new Uint8ClampedArray(source.rgba),
      month,
      habitIds: habits.map((h) => h.id),
      ...(manual ? { corners } : {}),
    });
  }
  function applyResult() {
    if (!result) return;
    const next = emptyGrid(month, habits.length),
      flagged = new Set<string>();
    result.cells.forEach((c) => {
      next[c.row][c.day] = c.status;
      if (c.needsReview) flagged.add(`${c.row}:${c.day}`);
    });
    setGrid(next);
    setMode("fill");
    setPending(flagged);
    document
      .getElementById("month-grid")
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  function exportJSON(all = false) {
    setBackupMessage("");
    try {
      const current = parseMonth({ version: 1, month, habits, grid });
      const payload = all ? collectBackup(localStorage, current) : current;
      download(
        new Blob([JSON.stringify(payload, null, 2)], {
          type: "application/json",
        }),
        all ? "ritm-all.json" : `ritm-${month}.json`,
      );
      setError("");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Не удалось экспортировать данные.",
      );
    }
  }
  async function importJSON(file?: File, asTruth = false) {
    if (!file) return;
    setBackupMessage("");
    try {
      if (file.size > 20_000_000)
        throw new Error("Файл слишком большой (максимум 20 МБ).");
      const records = parseBackup(JSON.parse(await file.text()));
      if (asTruth) {
        const record = records.find((r) => r.month === month);
        if (
          !record ||
          JSON.stringify(record.habitIds) !==
            JSON.stringify(habits.map((h) => h.id))
        )
          throw new Error(
            "Месяц, состав и порядок привычек эталона должны совпадать с таблицей.",
          );
        setTruth(clone(record.grid));
        setError("");
        return;
      }
      const overlaps = records.filter(
        (r) => localStorage.getItem(storageKey(r.month)) !== null,
      );
      const current = records.find((r) => r.month === month);
      if (
        (overlaps.length || (current && dirty)) &&
        !window.confirm(
          `Импортировать месяцев: ${records.length}? Данные совпадающих месяцев будут заменены${current && dirty ? ", включая текущие несохранённые изменения" : ""}. Остальные месяцы сохранятся.`,
        )
      )
        return;
      restoreBackup(localStorage, records);
      setHistoryRevision((revision) => revision + 1);
      if (current) {
        setHabits(current.habits.map((h) => ({ ...h })));
        setSavedHabits(current.habits.map((h) => ({ ...h })));
        setGrid(clone(current.grid));
        setSaved(clone(current.grid));
        setResult(null);
        setTruth(null);
        setSource(null);
        setManual(false);
        setCorners([]);
        setMode("view");
        setPending(new Set());
        setShowHabitErrors(false);
      } else if (!dirty) {
        setMonth(records[0].month);
      }
      setError("");
      setBackupMessage(`Импортировано и сохранено месяцев: ${records.length}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось прочитать файл.");
    }
  }
  const accuracy =
    truth && result
      ? result.cells.filter((c) => truth[c.row][c.day] === c.status).length /
        result.cells.length
      : null;
  const confusion =
    truth && result
      ? STATUSES.map((actual) =>
          STATUSES.map(
            (predicted) =>
              result.cells.filter(
                (c) => truth[c.row][c.day] === actual && c.status === predicted,
              ).length,
          ),
        )
      : null;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => e.preventDefault()}
          aria-label="Ритм"
        >
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span className="brand-word">
            <svg className="brand-cells" aria-hidden="true">
              <g transform="translate(0 1)">
                <rect
                  x="-1.9782552083em"
                  y="-0.69287109375em"
                  width="0.69287109375em"
                  height="0.69287109375em"
                  rx="1"
                  fill="#6d7e55"
                />
                <rect
                  x="-1.1853841146em"
                  y="-0.69287109375em"
                  width="0.69287109375em"
                  height="0.69287109375em"
                  rx="1"
                  fill="#bbc4a9"
                />
                <rect
                  x="-0.3925130208em"
                  y="-0.69287109375em"
                  width="0.69287109375em"
                  height="0.69287109375em"
                  rx="1"
                  fill="#a2b18c"
                />
              </g>
            </svg>
            Ритм<span className="brand-dot">.</span>
          </span>
        </a>

        <nav aria-label="Основная навигация">
          {NAVIGATION.map(({ id, label, icon: Icon }) => (
            <a
              key={id}
              href={`#${id}`}
              className={`nav-item${activeSection === id ? " active" : ""}`}
              aria-label={label}
              aria-current={activeSection === id ? "location" : undefined}
              title={label}
              onClick={(event) => {
                if (
                  event.metaKey ||
                  event.ctrlKey ||
                  event.shiftKey ||
                  event.altKey
                )
                  return;
                event.preventDefault();
                const section = document.getElementById(id);
                if (!section) return;
                navigationTarget.current = id;
                setActiveSection(id);
                if (window.location.hash !== `#${id}`) {
                  window.history.pushState(null, "", `#${id}`);
                }
                section.scrollIntoView({
                  behavior: window.matchMedia(
                    "(prefers-reduced-motion: reduce)",
                  ).matches
                    ? "instant"
                    : "smooth",
                  block: "start",
                });
              }}
            >
              <Icon size={18} />
              <span className="nav-label">{label}</span>
            </a>
          ))}
        </nav>
        <div className="sidebar-account">
          <span className="account-avatar" aria-hidden="true">
            <UserRound size={18} />
          </span>
          <div className="account-info">
            <strong>Пользователь</strong>
            <span>Локальный профиль</span>
          </div>
          <button
            className="logout-button"
            type="button"
            aria-label="Выйти"
            title="Выход будет доступен после подключения авторизации"
          >
            <LogOut size={18} />
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <main>
          <div className="page-intro" id="habits">
            <div className="heading-month-navigation">
              <button
                className="month-step"
                aria-label="Сегодня — текущий месяц"
                title="Сегодня"
                disabled={scanBusy}
                onClick={() => {
                  const today = new Date();
                  changeMonth(
                    `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`,
                  );
                }}
              >
                <Calendar size={20} aria-hidden="true">
                  <circle
                    cx="12"
                    cy="15"
                    r="1.5"
                    fill="currentColor"
                    stroke="none"
                  />
                </Calendar>
              </button>
              <button
                className="month-step"
                aria-label="Предыдущий месяц"
                onClick={() => stepMonth(-1)}
                disabled={scanBusy || month === "2000-01"}
              >
                <ArrowLeft size={20} />
              </button>
              <button
                className="month-step"
                aria-label="Следующий месяц"
                onClick={() => stepMonth(1)}
                disabled={scanBusy || month === "2100-12"}
              >
                <ArrowRight size={20} />
              </button>
              <details
                className="heading-month-picker"
                onToggle={(e) => {
                  if (e.currentTarget.open)
                    setPickerYear(Number(month.slice(0, 4)));
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.currentTarget.open = false;
                    e.currentTarget.querySelector("summary")?.focus();
                  }
                }}
              >
                <summary aria-label={`Выбрать месяц: ${monthLabel(month)}`}>
                  <h1>
                    <span>{monthLabel(month).replace(" г.", "")}</span>
                    <ChevronDown
                      className="month-heading-chevron"
                      aria-hidden="true"
                    />
                  </h1>
                </summary>
                <div className="heading-month-popover">
                  <div className="month-picker-year">
                    <button
                      className="month-step"
                      aria-label="Предыдущий год"
                      disabled={pickerYear <= 2000}
                      onClick={() => setPickerYear((year) => year - 1)}
                    >
                      <ArrowLeft size={16} />
                    </button>
                    <strong aria-live="polite">{pickerYear}</strong>
                    <button
                      className="month-step"
                      aria-label="Следующий год"
                      disabled={pickerYear >= 2100}
                      onClick={() => setPickerYear((year) => year + 1)}
                    >
                      <ArrowRight size={16} />
                    </button>
                  </div>
                  <div
                    className="month-picker-grid"
                    role="group"
                    aria-label="Выбор месяца"
                  >
                    {Array.from({ length: 12 }, (_, index) => {
                      const value = `${pickerYear}-${String(index + 1).padStart(2, "0")}`;
                      const label = monthLabel(value).split(" ")[0];
                      return (
                        <button
                          key={value}
                          aria-label={`${label} ${pickerYear}`}
                          aria-pressed={month === value}
                          disabled={scanBusy}
                          onClick={(e) => {
                            changeMonth(value);
                            const picker = e.currentTarget.closest("details");
                            if (picker) picker.open = false;
                          }}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </details>
            </div>
          </div>
          <section
            className={`panel mosaic-panel${mode === "fill" ? " is-filling" : ""}`}
            id="month-grid"
          >
            <div
              className={`grid-scroll${mode === "habits" ? " habits-scroll" : ""}`}
              tabIndex={mode === "habits" ? undefined : 0}
              role={mode === "habits" ? undefined : "region"}
              aria-label={
                mode === "habits"
                  ? undefined
                  : "Календарь привычек, прокрутка по горизонтали"
              }
            >
              <table
                className={`habit-table${mode === "habits" ? " editing-habits" : ""}`}
              >
                <thead>
                  <tr>
                    <th scope="col">ПРИВЫЧКА</th>
                    {mode !== "habits" &&
                      calendar.map(({ day, weekday }) => (
                        <th
                          key={day}
                          scope="col"
                          aria-label={`${day}, ${weekday}`}
                        >
                          {String(day).padStart(2, "0")}
                        </th>
                      ))}
                  </tr>
                </thead>
                <tbody>
                  {habits.map((habit, row) => (
                    <tr
                      key={habit.id}
                      style={
                        {
                          "--habit-color": habit.color,
                        } as React.CSSProperties
                      }
                    >
                      <th scope="row">
                        {mode === "habits" ? (
                          <div className="habit-editor">
                            <div className="habit-name-field">
                              <input
                                id={`habit-name-${habit.id}`}
                                aria-label={`Название привычки ${row + 1}`}
                                aria-invalid={
                                  showHabitErrors && !habit.name.trim()
                                    ? true
                                    : undefined
                                }
                                aria-describedby={
                                  showHabitErrors && !habit.name.trim()
                                    ? `habit-error-${habit.id}`
                                    : undefined
                                }
                                value={habit.name}
                                maxLength={80}
                                autoFocus={habit.id === newHabitId}
                                disabled={scanBusy}
                                onChange={(event) =>
                                  setHabits((current) =>
                                    current.map((h) =>
                                      h.id === habit.id
                                        ? {
                                            ...h,
                                            name: event.target.value,
                                            short: event.target.value,
                                          }
                                        : h,
                                    ),
                                  )
                                }
                              />
                              {showHabitErrors && !habit.name.trim() && (
                                <span
                                  className="habit-name-error"
                                  id={`habit-error-${habit.id}`}
                                  role="alert"
                                >
                                  Введите название привычки.
                                </span>
                              )}
                            </div>
                            <div className="habit-row-actions">
                              <button
                                type="button"
                                aria-label={`Поднять привычку ${row + 1}`}
                                title="Переместить выше"
                                disabled={row === 0 || scanBusy}
                                onClick={() => moveHabit(row, -1)}
                              >
                                <ArrowUp size={20} aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                aria-label={`Опустить привычку ${row + 1}`}
                                title="Переместить ниже"
                                disabled={row === habits.length - 1 || scanBusy}
                                onClick={() => moveHabit(row, 1)}
                              >
                                <ArrowDown size={20} aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                aria-label={`Удалить привычку ${row + 1}`}
                                title={
                                  habits.length <= MIN_HABITS
                                    ? "Нужна хотя бы одна привычка"
                                    : "Удалить привычку"
                                }
                                disabled={
                                  scanBusy || habits.length <= MIN_HABITS
                                }
                                onClick={() =>
                                  updateHabitOrder(
                                    habits.filter((h) => h.id !== habit.id),
                                  )
                                }
                              >
                                <X size={20} aria-hidden="true" />
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <span className="habit-dot" />
                            {habit.name}
                          </>
                        )}
                      </th>
                      {mode !== "habits" &&
                        Array.from({ length: dayCount }, (_, day) => (
                          <td key={day}>
                            <button
                              disabled={!ready || mode !== "fill"}
                              aria-label={`${habit.name}, ${day + 1}: ${STATUS_LABELS[grid[row]?.[day] || "missed"]}${pending.has(`${row}:${day}`) ? ", проверить" : ""}`}
                              title={`${day + 1} — ${STATUS_LABELS[grid[row]?.[day] || "missed"]}`}
                              className={`cell ${grid[row]?.[day] || "missed"} ${pending.has(`${row}:${day}`) ? "uncertain" : ""}`}
                              aria-pressed={grid[row]?.[day] === "completed"}
                              onClick={() => paint(row, day)}
                            ></button>
                          </td>
                        ))}
                    </tr>
                  ))}
                </tbody>
                {mode !== "habits" && (
                  <tfoot>
                    <tr>
                      <td />
                      {calendar.map(({ day, weekday }) => (
                        <td key={day} className="calendar-weekday">
                          {weekday}
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            {mode === "habits" && (
              <div className="habit-add-row">
                <button
                  className="button subtle add-habit"
                  disabled={scanBusy || habits.length >= MAX_HABITS}
                  onClick={addHabit}
                >
                  <Plus size={16} aria-hidden="true" />
                  Добавить привычку
                </button>
                <span
                  className="habit-count"
                  aria-live="polite"
                  aria-atomic="true"
                >
                  {habits.length} из {MAX_HABITS}
                </span>
              </div>
            )}
            {mode === "fill" && pending.size > 0 && (
              <div className="grid-caption">
                <span>
                  <span className="dashed-square" />
                  {pending.size} клеток требуют внимания
                </span>
              </div>
            )}
            <div className="save-bar">
              {mode === "fill" && (
                <div className="painting-toolbar">
                  <button
                    className="button subtle"
                    disabled={scanBusy}
                    onClick={() => fileInput.current?.click()}
                  >
                    Загрузить фото листа
                  </button>
                </div>
              )}
              <div className={`save-actions${isEditing ? " editing" : ""}`}>
                {isEditing ? (
                  <>
                    <button
                      className="button subtle"
                      disabled={scanBusy}
                      onClick={() => {
                        setGrid(clone(saved));
                        setHabits(savedHabits.map((h) => ({ ...h })));
                        setMode("view");
                        setPending(new Set());
                      }}
                    >
                      Отменить
                    </button>
                    <button
                      className="button primary"
                      onClick={save}
                      disabled={!ready || scanBusy}
                    >
                      Сохранить
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="button primary"
                      disabled={!ready || scanBusy || habits.length === 0}
                      onClick={() => {
                        setMode("fill");
                      }}
                    >
                      Заполнить
                    </button>
                    <button
                      className="button subtle"
                      disabled={!ready || scanBusy}
                      onClick={() => {
                        setMode("habits");
                        setShowHabitErrors(false);
                      }}
                    >
                      Настроить привычки
                    </button>
                  </>
                )}
              </div>
            </div>
          </section>
          <MonthStatistics
            month={month}
            grid={grid}
            historyRevision={historyRevision}
          />
          <section
            className="panel paper-sheet"
            id="paper-tools"
            aria-labelledby="paper-sheet-title"
          >
            <div className="paper-sheet-info">
              <h2 id="paper-sheet-title">Бумажный лист</h2>
              <span className="paper-sheet-month">
                {monthLabel(month).replace(" г.", "")}
              </span>
              <button
                className="button primary"
                disabled={!ready || pdfBusy || !validHabits(habits)}
                onClick={makePDF}
              >
                {pdfBusy ? (
                  <LoaderCircle size={16} className="spin" />
                ) : (
                  <ArrowDownToLine size={16} />
                )}
                {pdfBusy ? "Готовим PDF…" : "Скачать PDF"}
              </button>
            </div>
            <div className="paper-sheet-stage">
              <div
                className="paper-sheet-preview"
                role="img"
                aria-label={`Чистый лист на ${monthLabel(month)}: ${habits.map((habit) => habit.name).join(", ")}`}
              >
                <div className="paper-corner tl" />
                <div className="paper-corner tr" />
                <b className="paper-sheet-brand">Ритм</b>
                <h3>{monthLabel(month).replace(" г.", "")}</h3>
                <div className="paper-sheet-table">
                  <div className="paper-sheet-row paper-sheet-days">
                    <span>ПРИВЫЧКА</span>
                    {Array.from({ length: dayCount }, (_, day) => (
                      <span key={day}>{day + 1}</span>
                    ))}
                  </div>
                  {habits.map((habit) => (
                    <div className="paper-sheet-row" key={habit.id}>
                      <span title={habit.name}>{habit.name}</span>
                      {Array.from({ length: dayCount }, (_, day) => (
                        <i key={day} />
                      ))}
                    </div>
                  ))}
                  <div
                    className="paper-sheet-row paper-sheet-days"
                    style={{ marginTop: 5 }}
                  >
                    <span />
                    {calendar.map(({ day, weekday }) => (
                      <span key={day}>{weekday}</span>
                    ))}
                  </div>
                </div>
                <div className="paper-corner bl" />
                <div className="paper-corner br" />
              </div>
            </div>
          </section>
          <input
            ref={fileInput}
            type="file"
            className="sr-only"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => {
              void loadPhoto(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          {source && (
            <section className="panel scanner-panel" id="photo-review">
              <div className="panel-heading">
                <div>
                  <h2>Проверка фотографии</h2>
                </div>
                <button
                  className="button subtle"
                  disabled={scanBusy}
                  onClick={() => {
                    setSource(null);
                    setResult(null);
                    setCorners([]);
                    setManual(false);
                    scanner.current?.terminate();
                  }}
                >
                  Убрать фото <X size={15} />
                </button>
              </div>
              <p className="muted">
                Проверьте распознанные отметки перед сохранением.
              </p>
              <div className="scan-preview-grid">
                <div>
                  <div className="image-label">
                    Исходное фото{" "}
                    {manual &&
                      `· укажите ${CORNER_NAMES[corners.length] || "все маркеры"}`}
                  </div>
                  <canvas
                    aria-label="Фотография листа. В ручном режиме нажмите на центры четырёх маркеров."
                    ref={canvas}
                    className={manual ? "photo-canvas picking" : "photo-canvas"}
                    onClick={(e) => {
                      if (
                        !manual ||
                        scanBusy ||
                        corners.length === 4 ||
                        !canvas.current
                      )
                        return;
                      const box = e.currentTarget.getBoundingClientRect();
                      setCorners((current) => [
                        ...current,
                        {
                          x:
                            ((e.clientX - box.left) * source.width) / box.width,
                          y:
                            ((e.clientY - box.top) * source.height) /
                            box.height,
                        },
                      ]);
                    }}
                  />
                </div>
                {result && (
                  <div>
                    <div className="image-label">
                      Выровненный лист · сомнительные клетки выделены
                    </div>
                    <canvas
                      ref={corrected}
                      className="photo-canvas"
                      aria-label="Выровненный лист с результатами анализа"
                    />
                  </div>
                )}
              </div>
              <div className="scan-controls">
                <button
                  className="button primary"
                  disabled={scanBusy || (manual && corners.length !== 4)}
                  onClick={scan}
                >
                  {scanBusy ? (
                    <LoaderCircle size={16} className="spin" />
                  ) : (
                    <ScanLine size={16} />
                  )}
                  Распознать лист
                </button>
                <button
                  className="button secondary"
                  disabled={scanBusy}
                  onClick={() => {
                    setManual((v) => !v);
                    setCorners([]);
                  }}
                >
                  <Target size={16} />
                  {manual
                    ? "Автоматическое выравнивание"
                    : "Указать маркеры вручную"}
                </button>
                {manual && (
                  <button
                    className="text-button"
                    disabled={scanBusy}
                    onClick={() => setCorners([])}
                  >
                    Сбросить точки
                  </button>
                )}
              </div>
              {manual && (
                <p className="manual-note">
                  Укажите центры маркеров в порядке: верхний левый → верхний
                  правый → нижний правый → нижний левый по ориентации текста
                  листа. Без читаемого QR используется выбранный месяц:{" "}
                  {monthLabel(month)}.
                </p>
              )}
              {scanBusy && (
                <p role="status" className="muted">
                  {progress}
                </p>
              )}
              {result && (
                <div className="scan-result">
                  <div>
                    <b>Результат распознавания</b>
                    <p>
                      {result.cells.length} клеток ·{" "}
                      {result.cells.filter((c) => c.needsReview).length}{" "}
                      сомнительных ·{" "}
                      {result.manual ? "ручное" : "автоматическое"} выравнивание
                    </p>
                  </div>
                  <button
                    className="button primary"
                    onClick={() => {
                      if (
                        !dirty ||
                        window.confirm(
                          "Заменить текущий черновик результатом сканирования?",
                        )
                      )
                        applyResult();
                    }}
                  >
                    Применить к черновику <ArrowRight size={16} />
                  </button>
                </div>
              )}
            </section>
          )}
          <section
            className="panel backup-panel"
            id="backup"
            aria-labelledby="backup-title"
          >
            <h2 id="backup-title">
              {showDiagnostics
                ? "Резервная копия и проверка распознавания"
                : "Резервная копия"}
            </h2>
            <p className="backup-format">Формат файлов — JSON</p>
            <div className="lab-body">
              <div className="lab-actions">
                <button
                  className="button secondary"
                  disabled={!ready || scanBusy}
                  onClick={() => exportJSON(true)}
                >
                  <ArrowDownToLine size={15} />
                  Экспорт всех данных
                </button>
                <div className="backup-month-export">
                  <button
                    className="button secondary"
                    disabled={!ready || scanBusy}
                    onClick={() => exportJSON()}
                  >
                    <ArrowDownToLine size={15} />
                    Экспорт месяца
                  </button>
                  <span className="backup-month-name">
                    {monthLabel(month).replace(" г.", "")}
                  </span>
                </div>
                <label className="button secondary file-label backup-import">
                  <ArrowUpFromLine size={15} />
                  Импорт
                  <input
                    type="file"
                    accept="application/json,.json"
                    disabled={scanBusy}
                    onChange={(e) => {
                      void importJSON(e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />
                </label>
                {showDiagnostics && (
                  <>
                    <label className="button secondary file-label">
                      Загрузить эталон
                      <input
                        type="file"
                        accept="application/json,.json"
                        onChange={(e) => {
                          void importJSON(e.target.files?.[0], true);
                          e.target.value = "";
                        }}
                      />
                    </label>
                    <button
                      className="button subtle"
                      onClick={() => {
                        setTruth(clone(grid));
                      }}
                    >
                      Текущая таблица — эталон
                    </button>
                  </>
                )}
              </div>
              {showDiagnostics && truth && (
                <p className="muted">
                  Эталон загружен для {monthLabel(month)}.
                </p>
              )}
              {showDiagnostics && accuracy !== null && confusion && (
                <div className="metrics">
                  <h3>Точность по клеткам: {(accuracy * 100).toFixed(1)}%</h3>
                  <p>
                    Строки — эталон, столбцы — предсказание. Сравнивается
                    результат до ручных исправлений.
                  </p>
                  <div className="grid-scroll">
                    <table className="metrics-table">
                      <thead>
                        <tr>
                          <th>Эталон / прогноз</th>
                          {STATUSES.map((s) => (
                            <th key={s}>{STATUS_LABELS[s]}</th>
                          ))}
                          <th>Recall</th>
                        </tr>
                      </thead>
                      <tbody>
                        {confusion.map((row, i) => (
                          <tr key={i}>
                            <th>{STATUS_LABELS[STATUSES[i]]}</th>
                            {row.map((n, j) => (
                              <td key={j}>{n}</td>
                            ))}
                            <td>
                              {row.reduce((a, b) => a + b, 0)
                                ? `${((row[i] / row.reduce((a, b) => a + b, 0)) * 100).toFixed(1)}%`
                                : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <button
                    className="text-button"
                    onClick={() =>
                      download(
                        new Blob(
                          [
                            JSON.stringify(
                              {
                                month,
                                accuracy,
                                labels: STATUSES,
                                confusion,
                                manualAlignment: result?.manual,
                                cells: result?.cells,
                              },
                              null,
                              2,
                            ),
                          ],
                          { type: "application/json" },
                        ),
                        `recognition-report-${month}.json`,
                      )
                    }
                  >
                    Скачать отчёт <ArrowDownToLine size={14} />
                  </button>
                </div>
              )}
            </div>
          </section>
        </main>
      </div>
      <div className="toast-viewport">
        <Toast message={error} variant="error" setMessage={setError} />
        <Toast
          message={backupMessage}
          variant="success"
          setMessage={setBackupMessage}
        />
      </div>
    </div>
  );
}
