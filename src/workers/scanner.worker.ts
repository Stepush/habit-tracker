/// <reference lib="webworker" />
import jsQR from "jsqr";
import { classify, type Sample } from "../lib/classify";
import {
  FORMAT,
  HABITS,
  MAX_HABITS,
  daysInMonth,
  monthFromQR,
  qrPayload,
  type Point,
  type CellPrediction,
} from "../lib/model";
declare const self: DedicatedWorkerGlobalScope;
// OpenCV's generated runtime is loaded as a local classic worker script.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CV = any;
let runtime: Promise<CV> | undefined;
function loadCV(): Promise<CV> {
  if (!runtime)
    runtime = new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            new Error(
              "Не удалось подготовить распознавание. Попробуйте ещё раз.",
            ),
          ),
        45000,
      );
      try {
        self.importScripts("/vendor/opencv.js");
        const value = (self as unknown as { cv: CV }).cv;
        Promise.resolve(value).then(
          (cv) => {
            clearTimeout(timer);
            resolve(cv);
          },
          (error) => {
            clearTimeout(timer);
            reject(error);
          },
        );
      } catch (error) {
        clearTimeout(timer);
        reject(error);
      }
    }).catch((error) => {
      runtime = undefined;
      throw error;
    });
  return runtime;
}
function orderCorners(points: Point[]) {
  const center = {
    x: points.reduce((s, p) => s + p.x, 0) / 4,
    y: points.reduce((s, p) => s + p.y, 0) / 4,
  };
  const ordered = [...points].sort(
    (a, b) =>
      Math.atan2(a.y - center.y, a.x - center.x) -
      Math.atan2(b.y - center.y, b.x - center.x),
  );
  const first = ordered.reduce(
    (best, p, i) => (p.x + p.y < ordered[best].x + ordered[best].y ? i : best),
    0,
  );
  return [...ordered.slice(first), ...ordered.slice(0, first)];
}
function findMarkers(cv: CV, src: CV): Point[] {
  const gray = new cv.Mat(),
    binary = new cv.Mat(),
    contours = new cv.MatVector(),
    hierarchy = new cv.Mat();
  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.adaptiveThreshold(
      gray,
      binary,
      255,
      cv.ADAPTIVE_THRESH_GAUSSIAN_C,
      cv.THRESH_BINARY_INV,
      41,
      9,
    );
    cv.findContours(
      binary,
      contours,
      hierarchy,
      cv.RETR_TREE,
      cv.CHAIN_APPROX_SIMPLE,
    );
    const candidates: Point[] = [];
    for (let i = 0; i < contours.size(); i++) {
      const child = hierarchy.data32S[i * 4 + 2];
      if (child < 0 || hierarchy.data32S[child * 4 + 2] < 0) continue;
      const contour = contours.get(i);
      try {
        const area = cv.contourArea(contour),
          box = cv.boundingRect(contour);
        if (
          area < 50 ||
          area > src.cols * src.rows * 0.008 ||
          box.width / box.height < 0.45 ||
          box.width / box.height > 2.2
        )
          continue;
        const inner = contours.get(child);
        try {
          const ratio = cv.contourArea(inner) / area;
          if (ratio < 0.2 || ratio > 0.72) continue;
        } finally {
          inner.delete();
        }
        const moments = cv.moments(contour);
        if (moments.m00)
          candidates.push({
            x: moments.m10 / moments.m00,
            y: moments.m01 / moments.m00,
          });
      } finally {
        contour.delete();
      }
    }
    if (candidates.length < 4)
      throw new Error(
        "Не найдены все четыре маркера. Снимите лист целиком или укажите маркеры вручную.",
      );
    const corners = [
      candidates.reduce((a, b) => (a.x + a.y < b.x + b.y ? a : b)),
      candidates.reduce((a, b) => (a.x - a.y > b.x - b.y ? a : b)),
      candidates.reduce((a, b) => (a.x + a.y > b.x + b.y ? a : b)),
      candidates.reduce((a, b) => (a.y - a.x > b.y - b.x ? a : b)),
    ];
    if (new Set(corners).size !== 4)
      throw new Error("Геометрия маркеров неоднозначна. Укажите их вручную.");
    const polygonArea =
      Math.abs(
        corners.reduce((sum, p, i) => {
          const q = corners[(i + 1) % 4];
          return sum + p.x * q.y - q.x * p.y;
        }, 0),
      ) / 2;
    if (polygonArea < src.cols * src.rows * 0.15)
      throw new Error(
        "Лист слишком далеко или маркеры определены неверно. Приблизьте камеру.",
      );
    return orderCorners(corners);
  } finally {
    gray.delete();
    binary.delete();
    contours.delete();
    hierarchy.delete();
  }
}
self.onmessage = async (
  event: MessageEvent<{
    rgba: Uint8ClampedArray;
    width: number;
    height: number;
    month: string;
    corners?: Point[];
    habitIds?: string[];
  }>,
) => {
  const {
    rgba,
    width,
    height,
    month,
    corners,
    habitIds = HABITS.map((h) => h.id),
  } = event.data;
  const owned: CV[] = [];
  try {
    if (habitIds.length < 1 || habitIds.length > MAX_HABITS)
      throw new Error(
        "Для сканирования на одном листе нужно от 1 до 10 привычек.",
      );
    self.postMessage({
      type: "progress",
      message: "Подготавливаем распознавание…",
    });
    const cv = await loadCV();
    const src = cv.matFromImageData({ data: rgba, width, height });
    owned.push(src);
    self.postMessage({
      type: "progress",
      message: "Ищем маркеры и выравниваем лист…",
    });
    let points = corners || findMarkers(cv, src);
    const initialQR = jsQR(rgba, width, height, {
      inversionAttempts: "dontInvert",
    });
    if (initialQR && !corners) {
      const center = {
        x:
          (initialQR.location.topLeftCorner.x +
            initialQR.location.bottomRightCorner.x) /
          2,
        y:
          (initialQR.location.topLeftCorner.y +
            initialQR.location.bottomRightCorner.y) /
          2,
      };
      const nearest = points.reduce(
        (best, p, i) =>
          Math.hypot(p.x - center.x, p.y - center.y) <
          Math.hypot(points[best].x - center.x, points[best].y - center.y)
            ? i
            : best,
        0,
      );
      const start = (nearest + 2) % 4;
      points = [...points.slice(start), ...points.slice(0, start)];
    }
    if (
      points.length !== 4 ||
      points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))
    )
      throw new Error("Нужны четыре корректных маркера.");
    const turns = points.map((p, i) => {
      const q = points[(i + 1) % 4],
        r = points[(i + 2) % 4];
      return (q.x - p.x) * (r.y - q.y) - (q.y - p.y) * (r.x - q.x);
    });
    const area =
      Math.abs(
        points.reduce((sum, p, i) => {
          const q = points[(i + 1) % 4];
          return sum + p.x * q.y - q.x * p.y;
        }, 0),
      ) / 2;
    if (
      turns.some((t) => t <= 0) ||
      area < width * height * 0.04 ||
      points.some((p) => p.x < 0 || p.y < 0 || p.x >= width || p.y >= height)
    ) {
      throw new Error(
        "Маркеры должны образовывать выпуклый четырёхугольник по часовой стрелке. Сбросьте точки и укажите их заново.",
      );
    }
    const scale = 5,
      outWidth = 297 * scale,
      outHeight = 210 * scale;
    const from = cv.matFromArray(
      4,
      1,
      cv.CV_32FC2,
      points.flatMap((p) => [p.x, p.y]),
    );
    owned.push(from);
    const to = cv.matFromArray(
      4,
      1,
      cv.CV_32FC2,
      FORMAT.markers.flatMap((p) => [p.x * scale, p.y * scale]),
    );
    owned.push(to);
    const transform = cv.getPerspectiveTransform(from, to);
    owned.push(transform);
    const dst = new cv.Mat();
    owned.push(dst);
    cv.warpPerspective(
      src,
      dst,
      transform,
      new cv.Size(outWidth, outHeight),
      cv.INTER_LINEAR,
      cv.BORDER_CONSTANT,
      new cv.Scalar(255, 255, 255, 255),
    );
    const pixels = new Uint8ClampedArray(dst.data);
    const qr =
      jsQR(pixels, outWidth, outHeight, { inversionAttempts: "dontInvert" }) ||
      initialQR;
    if (qr) {
      const detectedMonth = monthFromQR(qr.data);
      if (!detectedMonth)
        throw new Error("QR не соответствует поддерживаемому шаблону «Ритма».");
      if (detectedMonth !== month)
        throw new Error(
          `На фото месяц ${detectedMonth}. Переключите месяц в приложении и повторите.`,
        );
      if (qr.data !== qrPayload(month, habitIds))
        throw new Error(
          "Состав или порядок привычек на листе отличается от таблицы. Восстановите список привычек, с которым печатали лист.",
        );
    } else if (!corners) {
      throw new Error(
        "QR шаблона не читается. Улучшите фото или укажите маркеры вручную, подтвердив выбранный месяц.",
      );
    }
    self.postMessage({
      type: "progress",
      message: "Анализируем заполнение клеток…",
    });
    const cells: CellPrediction[] = [];
    for (let row = 0; row < habitIds.length; row++)
      for (let day = 0; day < daysInMonth(month); day++) {
        const samples: Sample[] = [],
          bg: number[] = [];
        const x0 = (FORMAT.gridX + day * 7) * scale,
          y0 = (FORMAT.gridY + row * 7) * scale;
        // White paper above the day column anchors local brightness; borders are excluded.
        for (let y = 54 * scale; y < 56 * scale; y += 2)
          for (let x = x0 + 6; x < x0 + 29; x += 2) {
            const i = (y * outWidth + x) * 4;
            bg.push((pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3);
          }
        bg.sort((a, b) => a - b);
        const white = bg[Math.floor(bg.length * 0.7)] || 245;
        for (let y = 0; y < 25; y++)
          for (let x = 0; x < 25; x++) {
            const i = ((y0 + 5 + y) * outWidth + x0 + 5 + x) * 4;
            samples.push({
              r: pixels[i],
              g: pixels[i + 1],
              b: pixels[i + 2],
              x: x / 24,
              y: y / 24,
            });
          }
        const prediction = classify(samples, white);
        cells.push({
          row,
          day,
          ...prediction,
          needsReview: prediction.needsReview || Boolean(corners),
        });
      }
    self.postMessage(
      {
        type: "result",
        result: {
          cells,
          width: outWidth,
          height: outHeight,
          rgba: pixels,
          manual: Boolean(corners),
        },
      },
      [pixels.buffer],
    );
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    for (const mat of owned.reverse()) mat.delete();
  }
};
