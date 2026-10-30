import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createTemplatePDF } from "../src/lib/pdf";
async function main() {
  const month = process.argv[2] || "2026-10";
  const font = await readFile("public/fonts/OpenSans-Variable.ttf");
  const accentFont = await readFile("public/fonts/Georgia-Bold.ttf");
  const pdf = await createTemplatePDF(month, font, undefined, accentFont);
  await mkdir("output/pdf", { recursive: true });
  const path = `output/pdf/ritm-${month}.pdf`;
  await writeFile(path, pdf);
  console.log(path);
}
void main();
