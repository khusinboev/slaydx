/**
 * O'QUV DASTURI BAZASI — 1-bosqich: RASMIY PDF larni yuklab, matnga
 * o'girib keshlaydi (AUDIT-20 WP-B, `data/curriculum/`).
 *
 * Naqsh: `scripts/fetch-professions.mts` — TARMOQ bosqichi alohida va
 * keshlanadi, chunki 40+ PDF ni har yugurishda qayta yuklab olish ham
 * sekin, ham manbani bezovta qiladi. Ikkinchi bosqich (mundarija →
 * JSON) `scripts/gen-curriculum.mts` da va u FAQAT keshdan o'qiydi.
 *
 * MANBA: uzbmb.uz (Bilimni baholash agentligi) `/page/<fan>_dastur`
 * sahifalari — Respublika ta'lim markazi (RTM) tayyorlagan umumiy
 * o'rta ta'lim o'quv dasturlari, har sinf alohida PDF. Ro'yxat
 * sahifadan O'QIB olinadi (fayl nomlari barqaror emas: `10-sinf Kimyo…`
 * va `10-sinf-Kimyo…` ikkalasi ham uchraydi — R4 X-2), qo'lda
 * yozilmaydi.
 *
 * SERTIFIKAT: uzbmb.uz TLS zanjiri to'liq emas («unable to verify the
 * first certificate»), shuning uchun `rejectUnauthorized: false`. Bu
 * FAQAT shu yig'ish skriptida: ishlab turgan xizmat bu manbaga
 * umuman bormaydi (baza gitga kommit qilinadi), va yuklanadigan narsa
 * — ochiq davlat hujjati, maxfiy ma'lumot emas. Xavfsizlik ko'rigi
 * uchun bu izoh ataylab shu yerda turadi.
 *
 * Foydalanish (loyiha ildizidan):
 *   scripts/heavy.sh npx tsx scripts/fetch-curriculum.mts
 *   … --subject matematika,fizika   # faqat shu fanlar
 *   … --grade 9                     # faqat shu sinf
 *   … --force                       # keshni e'tiborsiz qoldiradi
 *   … --dry                         # faqat ro'yxatni ko'rsatadi
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import https from "node:https";
import { extractFromBuffer } from "../lib/extract-text.ts";

const HOST = "uzbmb.uz";
const BASE = `https://${HOST}`;
const UA = "SlaydX/1.0 (Uzbek school curriculum dataset; +https://slaydx.uz)";
export const CACHE_DIR = "node_modules/.cache/curriculum";
/** Manbani bezovta qilmaslik uchun so'rovlar orasidagi pauza. */
const PAUSE_MS = 400;

/* ────────────────────────── fanlar jadvali ────────────────────────── */

/**
 * Fan → sahifa + fayl nomini o'qish qoidasi.
 *
 * `match` — PDF fayl nomidan shu fanga tegishliligini aniqlaydi. Tarix
 * sahifasida uchta fan bor (umumiy «Tarix» 5–6-sinf, «Jahon tarixi» va
 * «O'zbekiston tarixi» 7–11), shuning uchun ular UCH fan sifatida
 * ajratiladi (R4 X-6): bitta faylga majburlash 7-sinfda ikki xil
 * dasturni aralashtirib yuborardi.
 */
export type SubjectSpec = {
  id: string;
  uz: string;
  ru: string;
  en: string;
  /** `/page/<slug>` — uzbmb.uz dasturlar sahifasi. */
  page: string;
  match: (file: string) => boolean;
};

const has = (s: string, ...words: string[]) => words.every((w) => s.toLowerCase().includes(w.toLowerCase()));

export const SUBJECTS: SubjectSpec[] = [
  { id: "matematika", uz: "Matematika", ru: "Математика", en: "Mathematics", page: "matematika_dastur", match: (f) => has(f, "matematika") },
  { id: "fizika", uz: "Fizika", ru: "Физика", en: "Physics", page: "fizika_dastur", match: (f) => has(f, "fizika") },
  { id: "kimyo", uz: "Kimyo", ru: "Химия", en: "Chemistry", page: "kimyo_dastur", match: (f) => has(f, "kimyo") },
  { id: "biologiya", uz: "Biologiya", ru: "Биология", en: "Biology", page: "biologiya_dastur", match: (f) => has(f, "biologiya") },
  { id: "geografiya", uz: "Geografiya", ru: "География", en: "Geography", page: "geografiya_dastur", match: (f) => has(f, "geografiya") },
  {
    id: "tarix",
    uz: "Tarix",
    ru: "История",
    en: "History",
    page: "tarix_dastur",
    // 5–6-sinfda fan bo'linmagan: fayl nomida «Jahon»/«O'zbekiston» yo'q.
    match: (f) => has(f, "tarix") && !/jahon|o.?zbekiston/i.test(f),
  },
  { id: "jahon-tarixi", uz: "Jahon tarixi", ru: "Всемирная история", en: "World history", page: "tarix_dastur", match: (f) => /jahon\s*tarixi/i.test(f) },
  { id: "ozbekiston-tarixi", uz: "O'zbekiston tarixi", ru: "История Узбекистана", en: "History of Uzbekistan", page: "tarix_dastur", match: (f) => /o.?zbekiston\s*tarixi/i.test(f) },
];

/* ────────────────────────── tarmoq ────────────────────────── */

/** Qayta urinadigan GET (`node:https` — sertifikat zanjiri to'liq emas). */
function get(url: string, tries = 3): Promise<Buffer> {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const req = https.get(
      {
        host: u.host,
        path: u.pathname + u.search,
        // ↓ ATAYLAB: uzbmb.uz oraliq sertifikatni yubormaydi (yuqoridagi izoh).
        rejectUnauthorized: false,
        headers: { "User-Agent": UA, Accept: "*/*" },
        timeout: 60_000,
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          resolve(get(new URL(res.headers.location, url).toString(), tries));
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode} — ${url}`));
          return;
        }
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks)));
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", (e) => {
      if (tries > 1) {
        setTimeout(() => get(url, tries - 1).then(resolve, reject), 1_500);
        return;
      }
      reject(e);
    });
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ────────────────────────── sahifani o'qish ────────────────────────── */

export type PdfLink = {
  subject: string;
  /** 1–11; qo'shma fayl («6-7-sinf») bo'lsa BIR NECHTA sinf. */
  grades: number[];
  url: string;
  file: string;
  /** «(MO'D)» — Milliy o'quv dasturi belgisi; sarlavhaga kiradi. */
  note: string;
};

/** Fayl nomidan sinf(lar): «6-7-sinf-…» → [6, 7]; «10-sinf …» → [10]. */
export function gradesOf(file: string): number[] {
  const m = /^(\d{1,2}(?:-\d{1,2})*)\s*-?\s*sinf/i.exec(file);
  if (!m) return [];
  return m[1]
    .split("-")
    .map((x) => Number(x))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 11);
}

/** Sahifa HTML idan `dasturlar/…pdf` havolalari (R4 da ishlagan naqsh). */
export function pdfLinksOf(html: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/href="([^"]*dasturlar[^"]*\.pdf)"/gi)) out.add(m[1]);
  return [...out];
}

export async function listPdfs(subjects: SubjectSpec[]): Promise<PdfLink[]> {
  const pages = new Map<string, string>();
  const out: PdfLink[] = [];
  for (const s of subjects) {
    if (!pages.has(s.page)) {
      const html = (await get(`${BASE}/page/${s.page}`)).toString("utf8");
      pages.set(s.page, html);
      await sleep(PAUSE_MS);
    }
    for (const href of pdfLinksOf(pages.get(s.page)!)) {
      const file = decodeURIComponent(href.split("/").pop() ?? "");
      if (!s.match(file)) continue;
      const grades = gradesOf(file);
      if (!grades.length) continue;
      const note = /\(\s*MO.?D\s*\)/i.test(file) ? "MO'D" : "";
      out.push({ subject: s.id, grades, url: new URL(href, BASE).toString(), file, note });
    }
  }
  return out;
}

/* ────────────────────────── kesh ────────────────────────── */

export type CachedDoc = {
  subject: string;
  grades: number[];
  url: string;
  file: string;
  note: string;
  fetchedAt: string;
  chars: number;
  text: string;
};

const cachePath = (subject: string, grades: number[]) => join(CACHE_DIR, `${subject}-${grades.join("-")}.json`);

export async function loadCached(subject: string, grades: number[]): Promise<CachedDoc | null> {
  const p = cachePath(subject, grades);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(await readFile(p, "utf8")) as CachedDoc;
  } catch {
    return null;
  }
}

/** Keshdagi HAMMA hujjat (gen-curriculum shu ro'yxatdan o'qiydi). */
export async function loadAllCached(subjectId: string): Promise<CachedDoc[]> {
  const { readdir } = await import("node:fs/promises");
  if (!existsSync(CACHE_DIR)) return [];
  const files = await readdir(CACHE_DIR);
  const out: CachedDoc[] = [];
  for (const f of files) {
    if (!f.endsWith(".json") || !f.startsWith(`${subjectId}-`)) continue;
    try {
      const doc = JSON.parse(await readFile(join(CACHE_DIR, f), "utf8")) as CachedDoc;
      if (doc.subject === subjectId) out.push(doc);
    } catch {
      /* buzuq kesh fayli — e'tiborsiz (keyingi yugurishda qayta yuklanadi) */
    }
  }
  return out.sort((a, b) => a.grades[0] - b.grades[0]);
}

/* ────────────────────────── asosiy ────────────────────────── */

type Args = { subjects: string[]; grade: number | null; force: boolean; dry: boolean };

export function parseArgs(argv: string[]): Args {
  const val = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    subjects: (val("--subject") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    grade: Number(val("--grade")) || null,
    force: argv.includes("--force"),
    dry: argv.includes("--dry"),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const subjects = args.subjects.length ? SUBJECTS.filter((s) => args.subjects.includes(s.id)) : SUBJECTS;
  if (!subjects.length) {
    console.error(`Noma'lum fan. Mavjud: ${SUBJECTS.map((s) => s.id).join(", ")}`);
    process.exit(2);
  }

  console.log(`[fetch] ${subjects.length} fan sahifasi o'qilmoqda…`);
  const links = (await listPdfs(subjects)).filter((l) => !args.grade || l.grades.includes(args.grade));
  console.log(`[fetch] ${links.length} PDF topildi`);
  for (const l of links) console.log(`  ${l.subject} · ${l.grades.join("/")}-sinf · ${l.file}${l.note ? ` (${l.note})` : ""}`);
  if (args.dry) return;

  await mkdir(CACHE_DIR, { recursive: true });
  let ok = 0;
  let skipped = 0;
  const failed: string[] = [];
  for (const l of links) {
    const p = cachePath(l.subject, l.grades);
    if (!args.force && existsSync(p)) {
      skipped++;
      continue;
    }
    try {
      const buf = await get(l.url);
      const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
      const { text, error } = await extractFromBuffer(l.file, ab);
      if (error || text.length < 2_000) throw new Error(error || `matn juda qisqa (${text.length})`);
      const doc: CachedDoc = { ...l, fetchedAt: new Date().toISOString().slice(0, 10), chars: text.length, text };
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, JSON.stringify(doc), "utf8");
      console.log(`  [ok] ${l.subject} ${l.grades.join("/")} — ${text.length} belgi`);
      ok++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`  [xato] ${l.file}: ${msg}`);
      failed.push(`${l.subject} ${l.grades.join("/")}: ${msg}`);
    }
    await sleep(PAUSE_MS);
  }
  console.log(`[fetch] yangi: ${ok}, keshdan: ${skipped}, xato: ${failed.length}`);
  for (const f of failed) console.log(`  ✗ ${f}`);
}

if (process.argv[1]?.endsWith("fetch-curriculum.mts")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
