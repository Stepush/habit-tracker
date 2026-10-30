import type { Status } from "./model";
export type Sample = { r: number; g: number; b: number; x: number; y: number };
export function classify(samples: Sample[], white: number) {
  let ink = 0;
  for (const p of samples) {
    const light = (p.r + p.g + p.b) / 3;
    const chroma = Math.max(p.r, p.g, p.b) - Math.min(p.r, p.g, p.b);
    const marked = light < white - 28 || (chroma > 30 && light < white - 7);
    if (marked) ink++;
  }
  const coverage = ink / Math.max(1, samples.length);
  let status: Status = "missed",
    score = 0.3;
  if (coverage < 0.06) {
    status = "missed";
    score = 0.96;
  } else if (coverage > 0.72) {
    status = "completed";
    score = 0.93;
  }
  return { status, score, coverage, needsReview: score < 0.9 };
}
