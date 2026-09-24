/**
 * Slayd REJA/mazmun tekshiruvi (AUDIT-25 P5) — `AcademicDoc` JSON (yoki
 * shunday fayllar katalogi) ustida, LLM chaqiruvisiz.
 *
 * Nega kerak (`docs/AUDIT-25.md` §1 tashxis): reja bandlari mazmun
 * slaydiga bog'lanmagan bo'lishi (S1), raqamlar reja bilan mos kelmasligi
 * (S2), zaxira skeletning uydirma raqamlari (S3) va axboriy matn kamligi
 * (S4) — bularning hech biri unit test bilan emas, TAYYOR `doc.json`
 * ustida tekshiriladi. `scripts/live-engine.mts` `slide`/`pro-slide`
 * holatlari va bu skript BIR XIL `auditSlideDoc` dan foydalanadi — ikkita
 * alohida "tekshirish kodi" yo'q (loyihaning "yagona manba" qoidasi).
 *
 * Kontrakt eslatmasi (P1/P3 parallel ishlaydi, §3): `SlideModel.plan?:
 * number` va `thinSlides(slides, rules)` (`lib/generation/slide-quality.ts`)
 * shu paket YOZILAYOTGANDA hali bu worktree'da yo'q edi. Shuning uchun:
 *   - `plan` maydoni DUCK-TYPE bilan o'qiladi (`SlideWithPlan`) — P1
 *     qo'shgach `SlideModel`ning o'zida bo'ladi, bu yerdagi kasting
 *     zararsiz qoladi;
 *   - yupqa-slayd aniqlash P3'ning `thinSlides()`'ini IMPORT QILMAYDI —
 *     shu faylda MUSTAQIL, oddiy evristika bilan qayta yozilgan (ruhda bir
 *     xil: band/so'z chegaralari AUDIT-25 §2.6 dan). Ikkisi qo'lda
 *     solishtirilishi kerak — birlashgandan keyin farq bo'lsa, bittasi
 *     noto'g'ri qattiqlashtirilgan bo'lishi mumkin.
 *
 * Foydalanish:
 *   npm run slide-audit -- <deck.doc.json>
 *   npm run slide-audit -- eval-out/live          # katalogdagi barcha *.doc.json
 */
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { SlideModel } from "../lib/generation/types.ts";

/** P1 kontrakti hali yo'q — `plan` duck-type bilan o'qiladi (yuqoridagi izoh). */
type SlideWithPlan = SlideModel & { plan?: number };
type SlideDocLike = { slides?: SlideWithPlan[] };

export type SlideAuditIssue = { slide: number; kind: string; detail: string };
export type SlideAuditResult = { ok: boolean; issues: SlideAuditIssue[] };

/** «1.», «1)», rim raqami «I.» bilan boshlangan sarlavha — maketdan emas, LLM yozgan tartib raqami. */
const ORDINAL_LEAK_RE = /^\s*(?:\d+[.)]|[IVXLCDM]+\.)\s*/;
/** `stats` uydirma raqam bergan holatlar — qiymat "bor", yorliq umuman ma'nosiz. */
const GENERIC_STAT_LABELS = new Set(["asosiy nuqta", "—", "-", ""]);
/** Kesilgan variant (`QUIZ_OPTION_MAX` bilan matn o'rtadan uzilgan). */
const TRUNCATED_RE = /(…|\.\.\.)\s*$/;

function wordCount(s: string | undefined | null): number {
  return (s ?? "").trim().split(/\s+/).filter(Boolean).length;
}

/** Case/probel-insensitiv, boshidagi tartib raqami olib tashlangan solishtirish uchun. */
function normTitle(s: string | undefined | null): string {
  return (s ?? "")
    .replace(ORDINAL_LEAK_RE, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Bitta dekani tekshiradi — TOZA funksiya (I/O yo'q), `live-engine.mts`
 * checks'lari va testlar shu bilan chaqiradi.
 */
export function auditSlideDoc(doc: SlideDocLike): SlideAuditResult {
  const slides: SlideWithPlan[] = Array.isArray(doc.slides) ? doc.slides : [];
  const issues: SlideAuditIssue[] = [];
  const push = (slide: number, kind: string, detail: string) => issues.push({ slide, kind, detail });

  /* ── 1. Reja qamrovi: har agenda bandi ≥1 mazmun slaydiga ega, tartibda, sarlavha mos ── */
  const agendaIdx = slides.findIndex((s) => s.layout === "agenda");
  const agenda = agendaIdx >= 0 ? slides[agendaIdx] : undefined;
  const agendaBullets = agenda?.bullets ?? [];
  const planTotal = agendaBullets.length;
  let lastGroupMaxIdx = -1;
  for (let i = 1; i <= planTotal; i++) {
    const group = slides.map((s, idx) => ({ s, idx })).filter(({ s }) => s.plan === i);
    if (group.length === 0) {
      push(0, "plan-coverage", `reja bandi ${i}/${planTotal} uchun mazmun slaydi yo'q (agenda: "${agendaBullets[i - 1] ?? ""}")`);
      continue;
    }
    const firstIdx = Math.min(...group.map((g) => g.idx));
    const maxIdx = Math.max(...group.map((g) => g.idx));
    if (firstIdx <= lastGroupMaxIdx) {
      push(firstIdx + 1, "plan-order", `reja bandi ${i} oldingi banddan KEYIN kelishi kerak edi (slayd #${firstIdx + 1})`);
    }
    lastGroupMaxIdx = Math.max(lastGroupMaxIdx, maxIdx);
    /* Bo'lim (`section`) beat'i bo'lsa — sarlavha shundan, aks holda guruhdagi BIRINCHI slayddan. */
    const sectionSlide = group.find((g) => g.s.layout === "section");
    const target = sectionSlide ?? group.reduce((a, b) => (a.idx < b.idx ? a : b));
    const want = normTitle(agendaBullets[i - 1]);
    const got = normTitle(target.s.title);
    if (want && got && want !== got) {
      push(target.idx + 1, "plan-title-mismatch", `agenda "${agendaBullets[i - 1]}" ≠ slayd sarlavhasi "${target.s.title}"`);
    }
  }

  /* ── 2. Tartib raqami sizishi ── */
  slides.forEach((s, idx) => {
    if (ORDINAL_LEAK_RE.test(s.title ?? "")) {
      push(idx + 1, "ordinal-leak", `sarlavha tartib raqami bilan boshlanadi: "${s.title}"`);
    }
  });

  /* ── 3. Uydirma raqamlar (S3: zaxira skelet qoldig'i) ── */
  slides.forEach((s, idx) => {
    for (const st of s.stats ?? []) {
      if (/^\d{1,3}$/.test((st.value ?? "").trim()) && GENERIC_STAT_LABELS.has((st.label ?? "").trim().toLowerCase())) {
        push(idx + 1, "stray-number", `stats qiymati "${st.value}" umumiy yorliq "${st.label}" bilan — uydirma ko'rinadi`);
      }
    }
    for (const step of s.steps ?? []) {
      const text = (step.text ?? "").trim();
      if (text && text.toLowerCase() === (step.title ?? "").trim().toLowerCase()) {
        push(idx + 1, "stray-step-echo", `process qadam "${step.title}" matni sarlavhani so'zma-so'z takrorlaydi (mazmun yo'q)`);
      }
    }
  });

  /* ── 4. Yupqa mazmun (S4) — MUSTAQIL evristika, fayl boshidagi izohga qarang ── */
  slides.forEach((s, idx) => {
    const n = idx + 1;
    if (s.layout === "bullets") {
      const bullets = s.bullets ?? [];
      if (bullets.length < 2) {
        push(n, "thin-bullets", `${bullets.length} band (< 2)`);
      } else {
        const avg = bullets.reduce((sum, b) => sum + wordCount(b), 0) / bullets.length;
        if (avg < 6) push(n, "thin-bullets", `o'rtacha ${avg.toFixed(1)} so'z/band (< 6)`);
      }
    }
    for (const step of s.steps ?? []) {
      const words = wordCount(step.text);
      if (words < 6) push(n, "thin-process-step", `qadam "${step.title}" — ${words} so'z (< 6): "${step.text}"`);
    }
    if (s.layout === "section" && !(s.subtitle ?? "").trim()) {
      push(n, "thin-section-subtitle", "bo'lim slaydida subtitle yo'q");
    }
    if (s.layout === "twoCol" || s.layout === "compare") {
      const leftLen = (s.left ?? []).length;
      const rightLen = (s.right ?? []).length;
      if (leftLen < 2) push(n, "thin-column", `chap ustun ${leftLen} band (< 2)`);
      if (rightLen < 2) push(n, "thin-column", `o'ng ustun ${rightLen} band (< 2)`);
    }
    for (const q of s.quiz ?? []) {
      for (const opt of q.options ?? []) {
        if (TRUNCATED_RE.test((opt ?? "").trim())) push(n, "thin-quiz-option", `variant kesilgan: "${opt}"`);
      }
    }
    if (s.layout === "quote" && s.quote) {
      const words = wordCount(s.quote);
      if (words < 8) push(n, "thin-quote", `iqtibos ${words} so'z (< 8): "${s.quote}"`);
    }
  });

  /* ── 5. Blok qamrovi / tartib: title birinchi, closing oxirgi, agenda ikkinchi ── */
  const layouts = slides.map((s) => s.layout);
  const hasTitle = layouts.includes("title");
  const hasClosing = layouts.includes("closing");
  if (hasTitle && slides[0]?.layout !== "title") {
    push(1, "block-order", `birinchi slayd "${slides[0]?.layout}" — "title" bo'lishi kerak edi`);
  }
  if (hasClosing && slides[slides.length - 1]?.layout !== "closing") {
    push(slides.length, "block-order", `oxirgi slayd "${slides[slides.length - 1]?.layout}" — "closing" bo'lishi kerak edi`);
  }
  if (agenda) {
    const expectedIdx = hasTitle ? 1 : 0;
    if (agendaIdx !== expectedIdx) {
      push(agendaIdx + 1, "block-order", `agenda #${agendaIdx + 1} da turibdi, kutilgan o'rin #${expectedIdx + 1}`);
    }
  }

  return { ok: issues.length === 0, issues };
}

/** Qamrov hisobotidagi «N/N» — qamrab olingan reja bandlari soni umumiy sondan. */
function planCoverage(doc: SlideDocLike, issues: SlideAuditIssue[]): { covered: number; total: number } {
  const slides = doc.slides ?? [];
  const agenda = slides.find((s) => s.layout === "agenda");
  const total = agenda?.bullets?.length ?? 0;
  const missing = issues.filter((i) => i.kind === "plan-coverage").length;
  return { covered: Math.max(0, total - missing), total };
}

/** Uchragan layoutlar ro'yxati — hisobot uchun (P5 topshirig'idagi «blok qamrovi» bandi). */
function layoutsSummary(doc: SlideDocLike): string {
  const slides = doc.slides ?? [];
  const counts = new Map<string, number>();
  for (const s of slides) counts.set(s.layout, (counts.get(s.layout) ?? 0) + 1);
  return Array.from(counts.entries())
    .map(([l, n]) => `${l}×${n}`)
    .join(" · ");
}

/* ═════════════════════════════ CLI ═════════════════════════════ */

async function collectDocFiles(target: string): Promise<string[]> {
  const st = await stat(target);
  if (st.isFile()) return [target];
  const entries = await readdir(target);
  return entries
    .filter((e) => e.endsWith(".doc.json"))
    .sort()
    .map((e) => path.join(target, e));
}

async function auditFile(file: string): Promise<boolean> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (e) {
    console.log(`✘ ${file}: o'qib bo'lmadi — ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.log(`✘ ${file}: JSON emas — ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
  /* Fayl to'g'ridan-to'g'ri AcademicDoc (`live-engine.mts` shunday yozadi); `{doc:...}` bo'lsa ham qabul qilinadi. */
  const doc = (
    parsed && typeof parsed === "object" && Array.isArray((parsed as SlideDocLike).slides)
      ? (parsed as SlideDocLike)
      : (parsed as { doc?: SlideDocLike })?.doc
  ) as SlideDocLike | undefined;
  if (!doc || !Array.isArray(doc.slides)) {
    console.log(`✘ ${file}: doc.slides massiv emas — slayd hujjati emasmi?`);
    return false;
  }

  const { ok, issues } = auditSlideDoc(doc);
  const { covered, total } = planCoverage(doc, issues);
  const thin = issues.filter((i) => i.kind.startsWith("thin-")).length;
  const leaks = issues.filter((i) => i.kind === "ordinal-leak").length;

  console.log(`\n═══ ${path.basename(file)} ═══`);
  console.log(`  bloklar: ${layoutsSummary(doc) || "(bo'sh)"}`);
  for (const iss of issues) {
    console.log(`  ${iss.slide > 0 ? `#${iss.slide}`.padEnd(4) : "—   "} ${iss.kind.padEnd(22)} ${iss.detail}`);
  }
  console.log(`${ok ? "OK" : "FAIL"} slides=${doc.slides.length} plan=${covered}/${total} thin=${thin} leaks=${leaks}`);
  return ok;
}

async function main() {
  const target = process.argv[2];
  if (!target || target.startsWith("--")) {
    console.error("Foydalanish: npm run slide-audit -- <deck.doc.json | katalog>");
    process.exitCode = 2;
    return;
  }
  const resolved = path.resolve(process.cwd(), target);
  let files: string[];
  try {
    files = await collectDocFiles(resolved);
  } catch (e) {
    console.error(`✘ topilmadi: ${resolved} — ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 2;
    return;
  }
  if (files.length === 0) {
    console.error(`Hech qanday *.doc.json topilmadi: ${resolved}`);
    process.exitCode = 2;
    return;
  }
  let allOk = true;
  for (const f of files) {
    const ok = await auditFile(f);
    allOk = allOk && ok;
  }
  process.exitCode = allOk ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
