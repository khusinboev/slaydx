/**
 * IKON GENERATORI (AUDIT-21 WP-C) — `@tabler/icons` → `infographic/icons.ts`.
 *
 * Nega generator, nega runtime paket EMAS: `@tabler/icons` 50 MB (5 130
 * ikon × 2 uslub) va u SVG FAYLLAR to'plami, JS moduli emas — ya'ni
 * runtime da undan o'qish `fs` demakdir, bu esa `infographic/svg.ts` ni
 * izomorf bo'lmay qoldirardi (`figures/*` oilasining butun qoidasi
 * shunga tayanadi). Bizga kerak bo'lgani 41 ta ikon ≈ 6 KB path matni.
 * Shuning uchun paket DEV bog'liqlik, path lar esa generatsiya vaqtida
 * `icons.ts` ga ko'chiriladi va REPOGA kiradi.
 *
 * Litsenziya: MIT (Paweł Kuna) — atributsiya shart emas, lekin nusxa
 * `data/ICONS-LICENSE.md` da saqlanadi (paket olib tashlansa ham path
 * larning kelib chiqishi ko'rinib tursin).
 *
 * Foydalanish:
 *   npm i -D @tabler/icons
 *   npx tsx scripts/gen-icons.mts               # node_modules dan
 *   npx tsx scripts/gen-icons.mts --src <dir>   # ochib olingan paketdan
 *
 * `--src` — `@tabler/icons` paketining ILDIZI (ichida `icons/outline/`).
 *
 * Chiqish DETERMINISTIK: nomlar `ICONS` tartibida, path lar SVG dagi
 * tartibda; ikki marta yurgizilsa fayl bit-ma-bit bir xil bo'ladi.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ICONS, ICON_FALLBACK } from "../lib/generation/infographic/types.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const OUT = join(ROOT, "lib/generation/infographic/icons.ts");

/**
 * `ICONS` NOMI → Tabler slug i, faqat ular FARQ qilganda.
 *
 * `ICONS` (R0, `types.ts`) hisobotning konseptual ro'yxati edi va R0
 * o'zi «aniq slug lar WP-C boshida paketdan TASDIQLANSIN» deb yozgan
 * (AUDIT-21 §5, ochiq savol 3). Tekshirildi: 41 nomdan 40 tasi Tabler
 * da AYNAN shu nom bilan bor, faqat `sigma` yo'q — Σ ikoni u yerda
 * `sum` deb ataladi.
 *
 * Nega `types.ts` dagi nom o'zgartirilmadi: `ICONS` — PROMPTGA tushadigan
 * ro'yxat va u modelga MA'NO aytadi. «sigma» yig'indi belgisi sifatida
 * modelga tushunarliroq, «sum» esa «summa» (pul) bilan adashtiradi.
 * Taqdim etiladigan NOM bizniki, CHIZMA Tabler niki — taqqoslash shu
 * yerda, bitta jadvalda.
 */
const ALIASES: Record<string, string> = {
  sigma: "sum",
};

/* ────────────────────────── kirish ────────────────────────── */

function srcArg(): string | null {
  const i = process.argv.indexOf("--src");
  return i >= 0 && process.argv[i + 1] ? resolve(process.argv[i + 1]) : null;
}

/** Paket ildizi: `--src`, aks holda `node_modules/@tabler/icons` (yuqoriga yurib). */
function packageRoot(): string {
  const explicit = srcArg();
  if (explicit) {
    if (!existsSync(join(explicit, "icons/outline"))) throw new Error(`--src ichida icons/outline yo'q: ${explicit}`);
    return explicit;
  }
  let dir = ROOT;
  for (let i = 0; i < 8; i++) {
    const cand = join(dir, "node_modules/@tabler/icons");
    if (existsSync(join(cand, "icons/outline"))) return cand;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  throw new Error("@tabler/icons topilmadi — `npm i -D @tabler/icons` yoki `--src <paket ildizi>`");
}

/* ────────────────────────── SVG tahlili ────────────────────────── */

/**
 * Tabler ikoni → `d` satrlari.
 *
 * BIRINCHI path DOIM shaffof ramka (`M0 0h24v24H0z` + `fill="none"`) —
 * u 24×24 chegarani belgilaydi va CHIZILMAYDI; bizda chegara maketdan
 * keladi, shuning uchun tashlanadi. Qolganlari — strok chiziqlari
 * (`fill="none"`, `stroke-width="2"`, yumaloq uchlar), ular `icons.ts`
 * da shu holicha saqlanadi va `svg.ts` bitta `<g>` ichida chizadi.
 */
function pathsOf(svg: string, slug: string): string[] {
  const out: string[] = [];
  for (const m of svg.matchAll(/<path\b([^>]*)\/?>/g)) {
    const attrs = m[1];
    const d = /\sd="([^"]+)"/.exec(attrs)?.[1];
    if (!d) continue;
    // Ramka: `stroke="none"` bilan belgilangan (Tabler naqshi) yoki 24×24 to'rtburchak.
    if (/\sstroke="none"/.test(attrs) || /^M0\s*0h24v24H0z$/.test(d.trim())) continue;
    out.push(d.replace(/\s+/g, " ").trim());
  }
  if (!out.length) throw new Error(`${slug}: chizma path topilmadi`);
  return out;
}

/* ────────────────────────── generatsiya ────────────────────────── */

const pkg = packageRoot();
const dir = join(pkg, "icons/outline");
const available = new Set(readdirSync(dir).filter((f) => f.endsWith(".svg")).map((f) => f.slice(0, -4)));
const version = JSON.parse(readFileSync(join(pkg, "package.json"), "utf8")).version as string;

const rows: { name: string; slug: string; paths: string[] }[] = [];
const missing: string[] = [];
for (const name of ICONS) {
  const slug = ALIASES[name] ?? name;
  if (!available.has(slug)) {
    missing.push(`${name}${slug === name ? "" : ` (→ ${slug})`}`);
    continue;
  }
  rows.push({ name, slug, paths: pathsOf(readFileSync(join(dir, `${slug}.svg`), "utf8"), slug) });
}
if (missing.length) throw new Error(`Tabler da yo'q ikon(lar): ${missing.join(", ")} — ALIASES ga qo'shing yoki ICONS dan olib tashlang`);
if (!rows.some((r) => r.name === ICON_FALLBACK)) throw new Error(`ICON_FALLBACK (${ICON_FALLBACK}) chizilmadi`);

const aliasRows = rows.filter((r) => r.slug !== r.name);
const header = `/**
 * IKON CHIZMALARI (AUDIT-21 WP-C) — AVTOMATIK YARATILGAN, QO'LDA TAHRIRLAMANG.
 *
 *   manba:   @tabler/icons@${version} (MIT, Paweł Kuna — data/ICONS-LICENSE.md)
 *   generator: scripts/gen-icons.mts
 *   qayta yaratish: npx tsx scripts/gen-icons.mts
 *
 * Har ikon — 24×24 viewBox dagi \`d\` satrlari; ular STROK bilan chiziladi
 * (\`fill: none\`, \`stroke-width: 2\`, yumaloq uch va burchak), shuning
 * uchun \`svg.ts\` ularni bitta \`<g transform="… scale(s)">\` ichiga
 * qo'yadi: strok qalinligi ikon bilan birga masshtablanadi va 14 mm li
 * doirada Tabler ning o'z nisbati (2/24) saqlanadi.
 *
 * Nomlar \`types.ts ICONS\` dan; farq qilgan slug lar (${aliasRows.length ? aliasRows.map((r) => `${r.name} → ${r.slug}`).join(", ") : "yo'q"})
 * generatorning \`ALIASES\` jadvalida izohlangan.
 */
import { ICON_FALLBACK, ICONS } from "./types";

/** \`ICONS\` nomi → 24×24 panjaradagi \`d\` satrlari (chizish tartibida). */
export const ICON_PATHS: Readonly<Record<string, readonly string[]>> = {
`;

const body = rows.map((r) => `  ${JSON.stringify(r.name)}: [${r.paths.map((d) => JSON.stringify(d)).join(", ")}],`).join("\n");

const footer = `
};

/** Ikon panjarasi (Tabler 24×24) — masshtab shu sondan hisoblanadi. */
export const ICON_GRID = 24;
/** Tabler strok qalinligi (panjaraga nisbatan) — masshtab bilan birga o'zgaradi. */
export const ICON_STROKE = 2;

/**
 * Nom → chizma. Noma'lum/bo'sh nom \`ICON_FALLBACK\` ga tushadi
 * (\`iconKnown\` qoidasi, hisobot §4): plakat ikonsiz qolmaydi, hisobot
 * esa almashtirishni AYTADI.
 */
export function iconPaths(name: unknown): readonly string[] {
  return ICON_PATHS[String(name ?? "")] ?? ICON_PATHS[ICON_FALLBACK];
}

/** Chizmasi bor ikonlar — \`ICONS\` bilan AYNI to'plam (\`tests/infographic-icons\` qulflaydi). */
export const DRAWN_ICONS: readonly string[] = ICONS.filter((n) => Boolean(ICON_PATHS[n]));
`;

writeFileSync(OUT, header + body + footer, "utf8");
console.log(`[gen-icons] ${rows.length} ikon → ${OUT} (@tabler/icons@${version})`);
