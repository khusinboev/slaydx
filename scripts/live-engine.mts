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
import { extractMeta } from "../lib/generation/meta.ts";
import { wordCount } from "../lib/generation/quality.ts";
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

const CASES: Case[] = [
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
    const file = await buildArtifact(tool, c.values, { deadline: Date.now() + c.budgetMs });
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

async function main() {
  if (!process.env.GEMINI_API_KEY && !process.env.XAI_API_KEY) {
    console.error("GEMINI_API_KEY yo'q — jonli tekshiruv o'tkazib yuborildi.");
    process.exit(2);
  }
  await mkdir(OUT, { recursive: true });

  const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));
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
