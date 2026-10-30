import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import QRCode from "qrcode";
import { FORMAT, qrPayload, type ScanResult } from "../src/lib/model";
const require = createRequire(`${process.cwd()}/package.json`);

test("actual OpenCV worker aligns a generated sheet and rejects the wrong month", async () => {
  const width = 1485,
    height = 1050,
    scale = 5;
  const rgba = new Uint8ClampedArray(width * height * 4).fill(255);
  function rect(x: number, y: number, w: number, h: number, color: number) {
    for (let yy = Math.round(y); yy < Math.round(y + h); yy++)
      for (let xx = Math.round(x); xx < Math.round(x + w); xx++) {
        if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
        const index = (yy * width + xx) * 4;
        rgba[index] = color;
        rgba[index + 1] = color;
        rgba[index + 2] = color;
      }
  }
  for (const p of FORMAT.markers) {
    rect((p.x - 3) * scale, (p.y - 3) * scale, 30, 30, 0);
    rect((p.x - 2) * scale, (p.y - 2) * scale, 20, 20, 255);
    rect((p.x - 1) * scale, (p.y - 1) * scale, 10, 10, 0);
  }
  for (let day = 0; day <= 31; day++)
    rect((FORMAT.gridX + day * 7) * scale, FORMAT.gridY * scale, 1, 4 * 35, 40);
  for (let row = 0; row <= 4; row++)
    rect(
      FORMAT.gridX * scale,
      (FORMAT.gridY + row * 7) * scale,
      31 * 35,
      1,
      40,
    );
  const x = FORMAT.gridX * scale,
    y = FORMAT.gridY * scale;
  rect(x + 3, y + 3, 29, 29, 60);
  rect(x + 35 + 3, y + 3, 14, 29, 60);
  for (let t = 4; t < 31; t++) {
    rect(x + 70 + t - 1, y + t - 1, 3, 3, 30);
    rect(x + 70 + 35 - t - 1, y + t - 1, 3, 3, 30);
  }
  const qr = QRCode.create(qrPayload("2026-10"), { errorCorrectionLevel: "M" }),
    moduleSize = 4;
  for (let r = 0; r < qr.modules.size; r++)
    for (let c = 0; c < qr.modules.size; c++)
      if (qr.modules.get(r, c))
        rect(
          1230 + (c + 4) * moduleSize,
          700 + (r + 4) * moduleSize,
          moduleSize,
          moduleSize,
          0,
        );
  // This harness executes the same bundled worker, including local OpenCV and QR decoding.
  // It verifies integration only; it is not evidence of real-photo recognition quality.
  let deliver: (value: any) => void = () => {};
  const workerScope: any = {
    importScripts: () => {
      workerScope.cv = require("@techstark/opencv-js");
    },
    postMessage: (value: any) => {
      if (value.type !== "progress") deliver(value);
    },
  };
  (globalThis as any).self = workerScope;
  require("./public/scanner.worker.js");
  function run(
    month: string,
    data = rgba,
    corners?: { x: number; y: number }[],
    habitIds?: string[],
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Worker test timed out")),
        45000,
      );
      deliver = (value) => {
        clearTimeout(timeout);
        resolve(value);
      };
      void workerScope.onmessage({
        data: {
          rgba: new Uint8ClampedArray(data),
          width,
          height,
          month,
          corners,
          habitIds,
        },
      });
    });
  }
  try {
    const response = await run("2026-10");
    assert.equal(response.type, "result", response.message);
    const result = response.result as ScanResult;
    assert.equal(result.cells.length, 124);
    assert.equal(result.manual, false);
    assert.deepEqual(
      result.cells.slice(0, 4).map((c) => c.status),
      ["completed", "missed", "missed", "missed"],
    );
    assert.equal(result.cells[1].needsReview, true);
    assert.equal(result.cells[2].needsReview, true);
    const cv = await workerScope.cv;
    const src = cv.matFromImageData({ data: rgba, width, height }),
      dst = new cv.Mat();
    const from = cv.matFromArray(4, 1, cv.CV_32FC2, [
      0,
      0,
      width,
      0,
      width,
      height,
      0,
      height,
    ]);
    const to = cv.matFromArray(4, 1, cv.CV_32FC2, [
      110,
      80,
      width - 70,
      20,
      width - 130,
      height - 80,
      30,
      height - 30,
    ]);
    const transform = cv.getPerspectiveTransform(from, to);
    try {
      cv.warpPerspective(
        src,
        dst,
        transform,
        new cv.Size(width, height),
        cv.INTER_LINEAR,
        cv.BORDER_CONSTANT,
        new cv.Scalar(230, 230, 230, 255),
      );
      const skewed = await run("2026-10", new Uint8ClampedArray(dst.data));
      assert.equal(skewed.type, "result", skewed.message);
      assert.deepEqual(
        skewed.result.cells.slice(0, 4).map((c: any) => c.status),
        ["completed", "missed", "missed", "missed"],
      );
    } finally {
      src.delete();
      dst.delete();
      from.delete();
      to.delete();
      transform.delete();
    }
    const mismatch = await run("2026-09");
    assert.equal(mismatch.type, "error");
    assert.match(mismatch.message, /2026-10/);
    const blank = new Uint8ClampedArray(rgba.length).fill(255);
    const invalid = await run("2026-10", blank);
    assert.equal(invalid.type, "error");
    assert.match(invalid.message, /маркер/);
    const badCorners = await run("2026-10", rgba, [
      { x: 10, y: 10 },
      { x: 20, y: 20 },
      { x: 30, y: 30 },
      { x: 40, y: 40 },
    ]);
    assert.equal(badCorners.type, "error");
    assert.match(badCorners.message, /четырёхугольник/);
    const customIds = ["read", "sleep"];
    const wrongHabits = await run("2026-10", rgba, undefined, customIds);
    assert.equal(wrongHabits.type, "error");
    assert.match(wrongHabits.message, /порядок привычек/);
    rect(1220, 690, 220, 220, 255);
    const customQR = QRCode.create(qrPayload("2026-10", customIds), {
      errorCorrectionLevel: "M",
    });
    for (let r = 0; r < customQR.modules.size; r++)
      for (let c = 0; c < customQR.modules.size; c++)
        if (customQR.modules.get(r, c))
          rect(
            1230 + (c + 4) * moduleSize,
            700 + (r + 4) * moduleSize,
            moduleSize,
            moduleSize,
            0,
          );
    const custom = await run("2026-10", rgba, undefined, customIds);
    assert.equal(custom.type, "result", custom.message);
    assert.equal(custom.result.cells.length, 62);
  } finally {
    delete (globalThis as any).self;
  }
});
