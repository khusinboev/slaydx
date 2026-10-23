/**
 * Qo'lyozma shriftlarining belgi QAMROVINI tekshiradi (`public/fonts/handwriting/`).
 *
 *   scripts/heavy.sh npx tsx scripts/check-handwriting-fonts.mts [fayl.ttf ...]
 *
 * Fayl berilmasa — kataloqdagi barcha .ttf. `lib/generation/work/font-cmap.ts`
 * (minimal `cmap` o'quvchi) ishlatiladi, fontkit kerak emas. Yopilmagan belgilar
 * ro'yxati chiqadi; `ʻ` (U+02BB) uchun `handwriting.ts` o'rinbosari (`‘`) bor —
 * u «o'rinbosar bor» deb belgilanadi, qolgani XATO (chiqish kodi 1).
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fontCodepoints, fontMetrics, missingChars } from "../lib/generation/work/font-cmap";
import { HAND_REQUIRED_ALL } from "../lib/generation/work/handwriting-coverage";
import { HAND_FONTS } from "../lib/generation/work/handwriting";

const dir = path.join(process.cwd(), "public", "fonts", "handwriting");
const files = process.argv.slice(2).length ? process.argv.slice(2) : readdirSync(dir).filter((f) => f.endsWith(".ttf")).map((f) => path.join(dir, f));
let bad = 0;
for (const file of files) {
  const bytes = new Uint8Array(readFileSync(file));
  const cps = fontCodepoints(bytes);
  const m = fontMetrics(bytes);
  const spec = Object.values(HAND_FONTS).find((f) => f.file === path.basename(file));
  const fallback = spec?.fallback ?? {};
  const missing = missingChars(cps, HAND_REQUIRED_ALL);
  const covered = missing.filter((c) => fallback[c.codePointAt(0)!] !== undefined && cps.has(fallback[c.codePointAt(0)!]));
  const real = missing.filter((c) => !covered.includes(c));
  console.log(`${path.basename(file)}: ${cps.size} glyphs, em ${m.unitsPerEm}, ascent ${m.ascent}, descent ${m.descent}`);
  console.log(`  missing with fallback: ${covered.map((c) => `U+${c.codePointAt(0)!.toString(16).toUpperCase()}`).join(" ") || "-"}`);
  console.log(`  MISSING (no fallback): ${real.map((c) => `U+${c.codePointAt(0)!.toString(16).toUpperCase()} ${c}`).join(" ") || "-"}`);
  if (real.length) bad++;
}
process.exit(bad ? 1 : 0);
