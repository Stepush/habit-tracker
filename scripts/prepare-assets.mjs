import { copyFile, mkdir } from "node:fs/promises";
import { build } from "esbuild";
await mkdir("public/vendor", { recursive: true });
await copyFile(
  "node_modules/@techstark/opencv-js/dist/opencv.js",
  "public/vendor/opencv.js",
);
await build({
  entryPoints: ["src/workers/scanner.worker.ts"],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  outfile: "public/scanner.worker.js",
});
console.log("Local OpenCV and scanner worker prepared.");
