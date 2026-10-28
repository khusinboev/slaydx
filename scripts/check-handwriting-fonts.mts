/**
 * Qo'lyozma shriftlarining belgi QAMROVINI tekshiradi (`public/fonts/handwriting/`).
 *
 *   scripts/heavy.sh npx tsx scripts/check-handwriting-fonts.mts
 *
 * Har shrift (`HAND_FONTS`) uchun har talab qilingan belgi o'z yuzida
 * (`handFaceOf`: asosiy yoki kirill yo'ldoshi) qidiriladi. `lib/generation/work/
 * font-cmap.ts` (minimal `cmap` o'quvchi) ishlatiladi, fontkit kerak emas.
 * Yuz yopmaydigan belgi uchun `fallback` o'rinbosari («ʻ» → «‘») bo'lsa
 * «o'rinbosar bor» deb belgilanadi, qolgani XATO (chiqish kodi 1).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fontCodepoints, fontMetrics } from "../lib/generation/work/font-cmap";
import { HAND_REQUIRED_ALL } from "../lib/generation/work/handwriting-coverage";
import { HAND_FONT_LIST, handFaceOf, handFaces } from "../lib/generation/work/handwriting";

const dir = path.join(process.cwd(), "public", "fonts", "handwriting");
const cmaps = new Map<string, Set<number>>();
const cmapOf = (file: string): Set<number> => {
  let c = cmaps.get(file);
  if (!c) cmaps.set(file, (c = fontCodepoints(new Uint8Array(readFileSync(path.join(dir, file))))));
  return c;
};

let bad = 0;
for (const spec of HAND_FONT_LIST) {
  const faces = handFaces(spec.id);
  console.log(`${spec.label} (${spec.id}): ${faces.map((f) => `${f.family}×${f.scale}`).join(" + ")}`);
  for (const f of faces) {
    const m = fontMetrics(new Uint8Array(readFileSync(path.join(dir, f.file))));
    console.log(`  ${f.file}: ${cmapOf(f.file).size} glyphs, em ${m.unitsPerEm}, ascent ${m.ascent}, descent ${m.descent}`);
  }
  const withFallback: string[] = [];
  const real: string[] = [];
  for (const ch of HAND_REQUIRED_ALL) {
    const cp = ch.codePointAt(0)!;
    if (cmapOf(handFaceOf(spec.id, cp).file).has(cp)) continue;
    const to = spec.fallback[cp];
    const label = `U+${cp.toString(16).toUpperCase()} ${ch}`;
    if (to !== undefined && cmapOf(handFaceOf(spec.id, to).file).has(to)) withFallback.push(label);
    else real.push(label);
  }
  console.log(`  missing with fallback: ${withFallback.join(" ") || "-"}`);
  console.log(`  MISSING (no fallback): ${real.join(" ") || "-"}`);
  if (real.length) bad++;
}
process.exit(bad ? 1 : 0);
