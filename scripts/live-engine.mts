#!/usr/bin/env node
/**
 * DVIGATEL darajasidagi jonli tekshiruv — haqiqiy Gemini bilan.
 *
 * `scripts/eval-services.mjs` butun stekni (HTTP → navbat → worker →
 * fayl) sinaydi va ishlab turgan server talab qiladi. Bu skript esa
 * `buildArtifact` ni TO'G'RIDAN-TO'G'RI chaqiradi: server, sessiya va
 * navbat kerak emas, shuning uchun uni har o'zgarishdan keyin ishga
 * tushirish arzon.
 *
 * Nega kerak: unit testlar `fetch` ni stub qiladi, ya'ni ular MANTIQNI
 * sinaydi — modelning haqiqiy javobini emas. Byudjet, prompt sifati va
 * hajm darvozalari faqat jonli chaqiruvda o'lchanadi.
 *
 * Foydalanish:
 *   npm run live                 — barcha keyslar
 *   npm run live -- imrad essay  — faqat nomlanganlar
 *
 * `GEMINI_API_KEY` shart. Chiqish `eval-out/live/` ga yoziladi.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildArtifact } from "../lib/generation/index.ts";
import { parsePptxTemplate } from "../lib/generation/pptx-template.ts";
import { readFile } from "node:fs/promises";
import { extractMeta } from "../lib/generation/meta.ts";
import type { SlideProgressEvent } from "../lib/generation/slide-progress.ts";
import { wordCount } from "../lib/generation/quality.ts";
import { slideNotes } from "../lib/generation/slide-layout.ts";
import { pdfAvailable, toPdf } from "../lib/server/pdf.ts";
import { TOOL_BY_ID } from "../lib/tools.ts";
import type { AcademicDoc, BuiltFile } from "../lib/generation/types.ts";
import type { FormValues } from "../lib/types.ts";

type Check = { label: string; ok: boolean; detail: string };
type Case = {
  name: string;
  tool: keyof typeof TOOL_BY_ID;
  values: FormValues;
  budgetMs: number;
  /** Faylni ko'rgandan keyin nimani da'vo qilamiz. */
  checks: (file: BuiltFile, pages: number | null) => Check[];
};

const OUT = path.resolve(process.cwd(), "eval-out", "live");
const ok = (label: string, cond: boolean, detail: string): Check => ({ label, ok: cond, detail });

/** Bo'limlar ichidagi `h2` — ostmavzu/bob sarlavhalari. */
const countH2 = (doc: AcademicDoc) =>
  doc.sections.reduce((n, s) => n + s.blocks.filter((b) => b.kind === "h2").length, 0);

const TRANSLATION_SAMPLE = [
  "Orol dengizi fojiasi va uni tiklash choralari",
  "Orol dengizi 1960-yillarda dunyodagi to‘rtinchi eng katta ko‘l edi: maydoni 68 000 km², suv hajmi 1 090 km³. 2024-yilga kelib uning 10 foizdan kamrog‘i qoldi. Asosiy sabab — Amudaryo va Sirdaryo suvlarining paxta dalalariga haddan tashqari ko‘p olinishi.",
  "Oqibatlar: 1 250 ta aholi punkti suv ta’minotidan ayrildi, qurigan tubdan yiliga 75 million tonnagacha tuz va chang ko‘tariladi. Tadqiqotlar (UNESCO, 2019) mintaqada nafas yo‘llari kasalliklari 30 % ga oshganini ko‘rsatadi.",
  "Choralar: saksovul ekish (2018–2024 yillarda 1,7 million gektar), tomchilatib sug‘orish, «Orolni asrash» xalqaro jamg‘armasi loyihalari. Batafsil: https://aral.uz va info@aral.uz.",
].join("\n\n");

const CASES: Case[] = [
  {
    /* Tarjimon 2: matn rejimi — aniqlangan til, glossariy, raqam/URL saqlanishi, `translation` profil. */
    name: "translation-text",
    tool: "translation",
    budgetMs: 200_000,
    values: { mode: "text", sourceText: TRANSLATION_SAMPLE, language: "en", sourceLang: "avto", style: "formal" },
    checks: (f, pages) => {
      const t = f.doc.translation;
      const pair = t?.pairs.find((p) => p.src.includes("1 250"));
      return [
        ok("hisobot bor", Boolean(t), t ? `${t.translated}/${t.segments} band` : "yo'q"),
        ok("aniqlangan til uz", t?.detected === "uz", String(t?.detected)),
        ok("glossariy", (t?.glossary.length ?? 0) >= 3, `${t?.glossary.length ?? 0} atama`),
        ok("hamma band tarjima", Boolean(t) && t!.pairs.every((p) => p.dst.trim() && p.dst !== p.src), "asl bilan bir xil emas"),
        ok("raqam saqlangan", Boolean(pair) && pair!.dst.replace(/\D/g, "").includes("1250"), pair?.dst.slice(0, 80) ?? "juft topilmadi"),
        ok("URL saqlangan", Boolean(t?.pairs.some((p) => p.dst.includes("https://aral.uz"))), ""),
        ok("ogohlantirish yo'q", (t?.warnings.length ?? 0) === 0, (t?.warnings ?? []).map((w) => w.code).join(",") || "toza"),
        ok("DOCX 1+ bet", (pages ?? 1) >= 1, `${pages ?? "?"} bet`),
      ];
    },
  },
  {
    /* Tarjimon 2: fayl rejimi — `--source <fayl>` shart; chiqish = kirish formati, sahifa soni teng. */
    name: "translation-file",
    tool: "translation",
    budgetMs: 400_000,
    values: { mode: "file", sourceAssetId: "live", language: process.env.LIVE_TARGET || "en", sourceLang: "avto", style: "formal" },
    checks: (f, pages) => {
      const t = f.doc.translation;
      const src = sourceArg();
      const wantExt = src ? (sourceKindOf(src) === "pdf" ? "docx" : sourceKindOf(src)) : "";
      return [
        ok("hisobot bor", Boolean(t), t ? `${t.translated}/${t.segments} band, ${t.chars} belgi` : "yo'q"),
        ok("chiqish formati = kirish", f.fileName.toLowerCase().endsWith(`.${wantExt}`), f.fileName),
        ok("hamma band tarjima", Boolean(t) && t!.pairs.every((p) => p.dst.trim()), ""),
        ok("ogohlantirishlar", true, (t?.warnings ?? []).map((w) => `${w.code}`).join(",") || "yo'q"),
        ok("PDF sahifa", pages !== null, `${pages ?? "o'girilmadi"} bet (asl bilan qo'lda solishtiring)`),
      ];
    },
  },
  {
    /* P0-4: annotatsiya stubi olib tashlandi — endi HAQIQIY matn kelishi kerak. */
    name: "imrad",
    tool: "article",
    budgetMs: 200_000,
    values: {
      topic: "Quyosh energiyasidan foydalanishning iqtisodiy samaradorligi",
      kind: "imrad",
      pages: "3-5",
      language: "uz",
      author: "Aliyev Ali",
      degree: "PhD",
      organization: "Toshkent davlat texnika universiteti",
      email: "ali@example.uz",
      annotationLangs: "same",
    },
    checks: (f) => {
      const abs = f.doc.abstracts ?? [];
      const stub = /IMRAD tuzilmasi asosida yoritiladi/.test(abs[0]?.text ?? "");
      return [
        ok("annotatsiya bor", abs.length > 0, `${abs.length} ta`),
        ok("annotatsiya stub emas", !stub, stub ? "STUB!" : abs[0]?.text.slice(0, 60) ?? "—"),
        ok("annotatsiya to'la", (abs[0]?.text.length ?? 0) > 200, `${abs[0]?.text.length ?? 0} belgi`),
        ok("IMRAD 4 bo'lim", f.doc.sections.length === 4, `${f.doc.sections.length} bo'lim`),
      ];
    },
  },
  {
    /* P1-3: 5 varaq → 5 burchak (ilgari uchtasi ham 3 ta olardi). */
    name: "essay",
    tool: "essay",
    budgetMs: 160_000,
    values: {
      topic: "Ona tilim — g'ururim va iftixorim",
      pages: "5",
      language: "uz",
      author: "Valiyeva Nodira",
      design: "iris",
    },
    checks: (f, pages) => {
      const body = f.doc.sections.filter((s) => s.id.startsWith("asosiy"));
      return [
        ok("5 ta asosiy burchak", body.length === 5, `${body.length} ta`),
        ok("kirish va xulosa bor", f.doc.sections.length === 7, `${f.doc.sections.length} bo'lim`),
        ok("hajm 5 varaqqa yetadi", wordCount(f.doc) >= 920, `${wordCount(f.doc)} so'z (darvoza 920)`),
        ok("renderlangan sahifa", pages === null || pages >= 4, `${pages ?? "—"} bet`),
      ];
    },
  },
  {
    /* P1-10: prompt endi «4 ta bob» deydi — reja ham shuncha bo'lishi kerak. */
    name: "coursework",
    tool: "coursework",
    budgetMs: 420_000,
    values: {
      topic: "Boshlang'ich sinf o'quvchilarida o'qish ko'nikmalarini rivojlantirish",
      pages: "20-25",
      language: "uz",
      author: "Aliyev Ali — 3-kurs, 301-guruh",
      university: "Toshkent davlat pedagogika universiteti",
      faculty: "Boshlang'ich ta'lim",
      subject: "Pedagogika",
      teacher: "Karimova D.",
      images: "yes",
      tocMethod: "ai",
    },
    checks: (f, pages) => {
      const bobs = f.doc.sections.filter((s) => /^bob\d/.test(s.id));
      return [
        ok("4 bob (prompt bilan mos)", bobs.length === 4, `${bobs.length} bob`),
        ok("ostmavzular bor", countH2(f.doc) >= 8, `${countH2(f.doc)} ostmavzu`),
        ok("hajm darvozasi", wordCount(f.doc) >= 0.8 * 23 * 230, `${wordCount(f.doc)} so'z`),
        ok("renderlangan sahifa", pages === null || pages >= 17, `${pages ?? "—"} bet (kerak 20-25)`),
        ok("manba ogohlantirishi", Boolean(f.doc.referencesNote), f.doc.referencesNote ? "bor" : "YO'Q"),
      ];
    },
  },
  {
    /* P1-2: 20 atama va'da — kam chiqsa `delivered` to'lishi kerak. */
    name: "glossary",
    tool: "glossary",
    budgetMs: 160_000,
    values: { topic: "Fotosintez va o'simlik fiziologiyasi", termCount: "20", language: "uz" },
    checks: (f) => {
      const terms = f.doc.sections.reduce(
        (n, s) => n + s.blocks.filter((b) => b.kind === "h3").length,
        0,
      );
      const short = f.delivered;
      return [
        ok("atamalar sanaldi", terms > 0, `${terms} ta`),
        ok(
          "delivered va'daga mos",
          terms >= 20 ? short === undefined : short?.got === terms && short?.want === 20,
          short ? `${short.got}/${short.want} → farq qaytadi` : "to'liq",
        ),
        ok("alifbo tartibi", isSorted(f.doc), "h3 sarlavhalari"),
      ];
    },
  },
  {
    /* P0-3: portret profil + daqiqalar yig'indisi. */
    name: "lesson",
    tool: "lesson-plan",
    budgetMs: 140_000,
    values: {
      topic: "Kasrlarni qo'shish va ayirish",
      subject: "Matematika",
      grade: 5,
      duration: "45",
      language: "uz",
    },
    checks: (f) => {
      const rows = f.doc.tables?.[0]?.rows ?? [];
      const sum = rows.reduce((n, r) => n + (Number(r[1]) || 0), 0);
      const topicHit = f.doc.sections.some((s) =>
        s.blocks.some((b) => /kasr/i.test(b.text)),
      );
      return [
        ok("daqiqalar yig'indisi = 45", sum === 45, `${sum} daq`),
        ok("bosqichlar bor", rows.length >= 5, `${rows.length} bosqich`),
        ok("mavzuga bog'langan", topicHit, topicHit ? "«kasr» matnda" : "MAVZU YO'Q"),
      ];
    },
  },
  {
    /*
     * Pro-slayd: har parametr ta'sir qilishi shart (AUDIT-9). Bu keys
     * brifni to'liq beradi — auditoriya, tur, bloklar, test, internet,
     * izohsiz → «Javoblar» slaydi, logo yo'q (worker beradi).
     */
    name: "pro-slide",
    tool: "pro-slide",
    budgetMs: 400_000,
    values: {
      topic: "Orol dengizi fojiasi va uni tiklash choralari",
      slideAudience: "school_8_9",
      slidePurpose: "open_lesson",
      blocks: "reja,maqsadlar,motivatsiya,amaliyot,test,uyga_vazifa,adabiyotlar",
      planItems: 4,
      slideCount: 10,
      subject: "Geografiya",
      language: "uz",
      slideImageStyle: "illustration",
      author: "Karimova Nilufar",
      position: "Geografiya o‘qituvchisi",
      organization: "Toshkent shahar 12-maktab",
      keyIdeas: "Orol qurishi inson faoliyati oqibati\nOrolbo‘yida saksovul ekish\nSuvni tejash har kimga bog‘liq",
      localExamples: true,
      internetSearch: true,
      quizCount: 3,
      speakerNotes: false,
      titleSlide: true,
      agendaSlide: true,
      textVolume: "standart",
    },
    checks: (file) => {
      const slides = file.doc.slides ?? [];
      const layouts = slides.map((s) => s.layout);
      const research = file.doc.slideResearch;
      const quiz = slides.filter((s) => s.layout === "quiz");
      const leaked = quiz.filter((s) => (s.quiz ?? []).length === 0);
      return [
        ok("slaydlar soni", slides.length === 10, `${slides.length} / 10`),
        ok("reja bandlari", (slides.find((s) => s.layout === "agenda")?.bullets?.length ?? 0) === 4, `${slides.find((s) => s.layout === "agenda")?.bullets?.length ?? 0} band`),
        ok("test slaydi", quiz.length >= 1 && leaked.length === 0, `${quiz.length} ta quiz, bo'sh: ${leaked.length}`),
        ok("javoblar slaydi", layouts.includes("answers"), layouts.join(" › ")),
        ok("adabiyotlar", layouts.includes("references"), ""),
        ok("internet manbalari", !!research && research.sources.length > 0, `${research?.sources.length ?? 0} manba, ${research?.queries.length ?? 0} so'rov`),
        /*
         * Izoh o'chiq bo'lsa javoblar `notes` da QOLADI (ular «Javoblar»
         * slaydidan tashqari zaxira), lekin FAYLGA tushmasligi kerak —
         * shuni `slideNotes` bilan tekshiramiz, xom maydon bilan emas.
         */
        ok("izoh fayldan chiqmaydi", slides.every((s) => slideNotes(s, false) === ""), ""),
        ok("rasm bor", slides.some((s) => !!s.image), `${slides.filter((s) => !!s.image).length} rasm`),
        ok("footer", slides.some((s) => (s.footer ?? "").includes("Karimova")), slides[1]?.footer ?? ""),
      ];
    },
  },
  {
    /*
     * Oddiy slayd — PARITET keysi: yangi maydonlar (auditoriya, tur,
     * matn hajmi, test, internet, reja bandlari, izoh) shu vositada
     * ham ishlashi kerak, narx esa paketlarda qoladi.
     */
    name: "slide",
    tool: "slide",
    budgetMs: 260_000,
    values: {
      topic: "Kasr sonlarni qo‘shish va ayirish",
      slideAudience: "school_5_7",
      slidePurpose: "lesson",
      planItems: 3,
      quality: "standard",
      language: "uz",
      textVolume: "qisqa",
      quizCount: 3,
      internetSearch: false,
      speakerNotes: true,
      subject: "Matematika",
      author: "Sobirov Anvar",
      organization: "45-maktab",
    },
    checks: (file) => {
      const slides = file.doc.slides ?? [];
      const layouts = slides.map((s) => s.layout);
      const body = slides.filter((s) => (s.bullets ?? []).length);
      const chars = body.flatMap((s) => s.bullets ?? []).map((b) => b.length);
      const avg = chars.length ? Math.round(chars.reduce((a, b) => a + b, 0) / chars.length) : 0;
      return [
        ok("slaydlar", slides.length >= 8, `${slides.length} ta`),
        ok("test slaydi", layouts.includes("quiz"), layouts.join(" › ")),
        ok("javob izohda", slides.some((s) => /Javob/i.test(s.notes ?? "")), ""),
        ok("javoblar slaydi YO‘Q", !layouts.includes("answers"), "izoh yoqiq — kalit izohda"),
        ok("qisqa matn", avg > 0 && avg <= 120, `o‘rtacha ${avg} belgi/band`),
        ok("maktab shrifti", true, "maket testlarida qulflangan"),
        ok("manbasiz", !file.doc.slideResearch, "internet o‘chiq"),
      ];
    },
  },
];

/** Glossariy atamalari alifbo tartibidami. */
function isSorted(doc: AcademicDoc): boolean {
  const terms = doc.sections.flatMap((s) => s.blocks.filter((b) => b.kind === "h3").map((b) => b.text));
  const collator = new Intl.Collator(doc.meta.language || "uz", { sensitivity: "base", numeric: true });
  for (let i = 1; i < terms.length; i++) {
    if (collator.compare(terms[i - 1], terms[i]) > 0) return false;
  }
  return terms.length > 0;
}

/** DOCX/PPTX ni PDF ga o'girib sahifa sonini sanaydi. `null` — o'girib bo'lmadi. */
async function pageCount(file: BuiltFile): Promise<number | null> {
  if (!pdfAvailable()) return null;
  const pdf = await toPdf(file.bytes, file.fileName).catch(() => null);
  if (!pdf) return null;
  try {
    const { getDocumentProxy } = await import("unpdf");
    const proxy = await getDocumentProxy(new Uint8Array(pdf));
    return proxy.numPages;
  } catch {
    return null;
  }
}

async function runCase(c: Case) {
  const started = Date.now();
  const tool = TOOL_BY_ID[c.tool];
  const meta = extractMeta(tool, c.values);
  process.stdout.write(`\n▶ ${c.name} (${tool.title}, byudjet ${c.budgetMs / 1000}s)\n`);

  try {
    /*
     * Jonli hodisalar STDOUT ga — bu skript «streaming ishladimi» ni
     * ko'z bilan tekshirish uchun yagona joy. Vaqt tamg'asi muhim:
     * `slide` hodisalari bo'lak TUGASHIDAN oldin kelsa, oqim haqiqatan
     * ishlagan; hammasi bir soniyada guruh bo'lib kelsa — bo'lakli yo'l.
     */
    const onProgress = (ev: SlideProgressEvent) => {
      const dt = ((Date.now() - started) / 1000).toFixed(1);
      const tail =
        ev.type === "slide"
          ? ` #${ev.index} ${ev.slide.title}`
          : ev.type === "stage"
            ? ` ${ev.stage}`
            : ev.type === "image"
              ? ` #${ev.index}`
              : ev.type === "plan"
                ? ` ${ev.slides.length} slayd`
                : ev.type === "deck"
                  ? ` ${ev.slides.length} slayd`
                  : ev.type === "images"
                    ? ` ${ev.wait.length} kutilmoqda`
                    : ev.type === "research"
                      ? ` ${ev.sources} manba`
                      : "";
      process.stdout.write(`   ⟶ +${dt}s ${ev.type}${tail}\n`);
    };
    /*
     * `--template <fayl.pptx>` — «O'z shablonim» jonli sinovi (Shablonlar 2):
     * namuna tahlil qilinadi va deka uning master/layout/temasi ichiga
     * yoziladi (`renderPptxWithTemplate`), worker yo'lining o'zi.
     */
    const tplPath = templateArg();
    const template =
      tplPath && (c.tool === "slide" || c.tool === "pro-slide")
        ? await (async () => {
            const bytes = new Uint8Array(await readFile(tplPath));
            const profile = await parsePptxTemplate(bytes);
            process.stdout.write(`   ⟶ namuna ${path.basename(tplPath)}: ${profile.layouts.length} layout, rollar ${Object.keys(profile.roles).join("/")}\n`);
            return { bytes, template: { assetId: "live", name: path.basename(tplPath), profile, previews: {} } };
          })()
        : undefined;
    /* `--source <fayl>` — tarjima fayl rejimi: bayt `BuildOptions.source` orqali (worker `sourceForJob` yo'li). */
    const srcPath = sourceArg();
    const source =
      srcPath && c.tool === "translation" && c.values.mode === "file"
        ? await (async () => {
            const bytes = new Uint8Array(await readFile(srcPath));
            const kind = sourceKindOf(srcPath);
            process.stdout.write(`   ⟶ manba ${path.basename(srcPath)}: ${kind}, ${(bytes.byteLength / 1024).toFixed(0)} KB\n`);
            return { bytes, name: path.basename(srcPath), kind, mime: "application/octet-stream", chars: 0 };
          })()
        : undefined;
    const onStage = (ev: { progress: number; step: string }) => {
      const dt = ((Date.now() - started) / 1000).toFixed(1);
      process.stdout.write(`   ⟶ +${dt}s ${ev.progress}% ${ev.step}\n`);
    };
    const file = await buildArtifact(tool, c.values, { deadline: Date.now() + c.budgetMs, onProgress, template, source, onStage });
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    const pages = await pageCount(file);
    await writeFile(path.join(OUT, file.fileName), file.bytes);

    const checks = c.checks(file, pages);
    for (const ch of checks) {
      process.stdout.write(`   ${ch.ok ? "✔" : "✘"} ${ch.label.padEnd(26)} ${ch.detail}\n`);
    }
    process.stdout.write(
      `   · ${secs}s · ${(file.bytes.byteLength / 1024).toFixed(0)} KB · ${wordCount(file.doc)} so'z · ${meta.targetPages} maqsad\n`,
    );
    return { name: c.name, ok: checks.every((x) => x.ok), failed: checks.filter((x) => !x.ok) };
  } catch (e) {
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    const msg = e instanceof Error ? e.message : String(e);
    process.stdout.write(`   ✘ XATO (${secs}s): ${msg}\n`);
    return { name: c.name, ok: false, failed: [{ label: "buildArtifact", ok: false, detail: msg }] };
  }
}

/** `--source <fayl>` — «Tarjimon» jonli sinovi uchun kirish fayli (DOCX/PPTX/XLSX/PDF/TXT/MD/CSV). */
function sourceArg(): string | null {
  const i = process.argv.indexOf("--source");
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}
const SOURCE_KINDS = ["docx", "pptx", "xlsx", "pdf", "txt", "md", "csv"] as const;
function sourceKindOf(file: string): (typeof SOURCE_KINDS)[number] {
  const ext = path.extname(file).slice(1).toLowerCase() as (typeof SOURCE_KINDS)[number];
  if (!SOURCE_KINDS.includes(ext)) throw new Error(`--source: noma'lum format .${ext}`);
  return ext;
}

function templateArg(): string | null {
  const i = process.argv.indexOf("--template");
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

async function main() {
  if (!process.env.GEMINI_API_KEY && !process.env.XAI_API_KEY) {
    console.error("GEMINI_API_KEY yo'q — jonli tekshiruv o'tkazib yuborildi.");
    process.exit(2);
  }
  await mkdir(OUT, { recursive: true });

  const tpl = templateArg();
  const src = sourceArg();
  const only = process.argv.slice(2).filter((a) => !a.startsWith("-") && a !== tpl && a !== src);
  const cases = only.length ? CASES.filter((c) => only.includes(c.name)) : CASES;
  process.stdout.write(
    `Jonli tekshiruv — ${cases.length} keys · model ${process.env.GEMINI_MODEL || "gemini"} · PDF ${pdfAvailable() ? "bor" : "yo'q"}\n`,
  );

  const results = [];
  for (const c of cases) results.push(await runCase(c));

  const bad = results.filter((r) => !r.ok);
  process.stdout.write(
    `\n${"─".repeat(64)}\nNatija: ${results.length - bad.length}/${results.length} keys o'tdi\n`,
  );
  for (const r of bad) {
    for (const f of r.failed) process.stdout.write(`  ✘ ${r.name}: ${f.label} — ${f.detail}\n`);
  }
  process.stdout.write(`Fayllar: ${OUT}\n`);
  process.exit(bad.length ? 1 : 0);
}

await main();
