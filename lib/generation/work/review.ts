/**
 * TAYYORLIK HISOBOTI — TALABA ISHI (AUDIT-19 WP-A) — `reviewWork`.
 *
 * Ikki qatlam (maqola bilan bir xil naqsh, mantiq NEYTRAL qatlamda):
 *   1. QOIDALAR — deterministik 16 band: kirish elementlari, kirish
 *      ulushi, bob balansi, hajm, xulosa ulushi, manbalar soni/tartibi/
 *      tasdig'i/iqtibosi, vizual havolasi, mundarija mosligi, «suv»
 *      iboralar, bo'limlar takrori, manbasiz raqamlar, foydalanuvchi
 *      faktlari, bet chegarasi. Yorliqlar O'ZBEKCHA (interfeys tili).
 *   2. BAHOLOVCHI — `judge` rol, turning `JudgeSpec` i bo'yicha 5 mezon
 *      × 0–3 (`logic`, `depth`, `style`, `aimMatch`, `originality`).
 *
 * BALL = `report/score.ts scoreReviewFor` (60 % qoidalar + 40 % baholovchi).
 *
 * Nega qoidalar hujjatdan QAYTA hisoblanadi: hisobot tahrirdan keyin ham
 * chaqiriladi — o'shanda dvigatel yo'q. Dvigateldan faqat qayta tiklab
 * bo'lmaydigan narsa olinadi (`guard`: o'chirilgan iqtiboslar, bo'sh
 * bo'limlar).
 *
 * Izomorf: DOM/server importi yo'q.
 */
import type { AcademicDoc, DocSection } from "../types";
import type { DocReview, ReviewCheck, ReviewGuardInput } from "../report/types";
import { check, jaccard, langKey, rewrite, scoreReviewFor, sectionText, trigrams, visualCoverageOf } from "../report/score";
import { JUDGE_MIN_MS, JUDGE_NO_ANSWER, JUDGE_TIMEOUT_MS, judgeChecksFor, judgeSystemPromptFor, neutralJudgeFor, parseJudgeFor } from "../report/judge";
import { sampleForJudge } from "../report/text";
import type { JudgeResult as ReportJudgeResult } from "../report/types";
import { remainingMs } from "../quality";
import type { LlmUsage } from "../llm-roles";
import type { CompleteFn, ResearchStats } from "../research/pipeline";
import { orderUzReferences, uzGroupOf, type UzGroup } from "../cite/order";
import { WORK_JUDGE_CRITERIA, workKindOf, type WorkJudgeCriterion, type WorkKind } from "./registry";
import { SUBJECT_PROFILES } from "./subjects";
import { workLabels } from "./labels";
import { chapterBalance, guardSection, intakeCheck, missingFactNumbers, wordsOf } from "./guard";
import { estimateWorkDocPages, estimateWorkPages, workVisualNumbers, workWordPlan } from "./plan";
import { isChapterHeadId, type WorkModel } from "./types";

/* ────────────────────────── tiplar ────────────────────────── */

export type WorkJudgeResult = ReportJudgeResult<WorkJudgeCriterion>;

export type WorkReviewOpts = {
  research?: ResearchStats;
  guard?: ReviewGuardInput;
  complete?: CompleteFn;
  deadline?: number;
  /** `false` — baholovchi chaqirilmaydi (testlar). */
  judge?: boolean;
  now?: Date;
  onUsage?: (u: LlmUsage) => void;
};

/** Bo'limlar matni baholovchiga shu belgidan oshmaydi. */
export const JUDGE_TEXT_CHARS = 25_000;
/** Bo'limlar o'zaro takror deb hisoblanadigan 3-gram Jaccard chegarasi. */
export const REPETITION_JACCARD = 0.15;
/** Hajm chegarasi: maqsaddan ±20 % — yashil, ±40 % — sariq. */
export const LENGTH_TOLERANCE = 0.2;

export const WORK_RULE_IDS = [
  "introParts",
  "introShare",
  "chapterBalance",
  "length",
  "conclusionShare",
  "refsCount",
  "refsOrder",
  "refsVerified",
  "refsCited",
  "visualRef",
  "tocMatch",
  "filler",
  "repetition",
  "unsourcedNumbers",
  "userFacts",
  "pageLimit",
] as const;
export type WorkRuleId = (typeof WORK_RULE_IDS)[number];

/* ────────────────────────── yordamchilar ────────────────────────── */

const list = (xs: string[], max = 6) => (xs.length > max ? `${xs.slice(0, max).join(", ")} … (+${xs.length - max})` : xs.join(", "));

/** O'zbekiston ro'yxat guruhlarining o'zbekcha nomi (hisobot izohi). */
const UZ_GROUP_LABEL: Record<UzGroup, string> = {
  law: "qonun",
  president: "Prezident hujjati",
  cabinet: "VM qarori",
  ministry: "vazirlik hujjati",
  book: "kitob",
  article: "maqola",
  statistics: "statistika",
  web: "internet",
};
const pct = (x: number) => `${Math.round(x * 100)}%`;

/** Bob sarlavhasi bo'limlari (`ch1`) MATN emas — hajm/takror hisobidan chiqariladi. */
export function textSections(doc: AcademicDoc): DocSection[] {
  return doc.sections.filter((s) => s.blocks.length && !isChapterHeadId(s.id));
}

function modelOf(doc: AcademicDoc): WorkModel | null {
  return doc.work ?? null;
}

/**
 * Rasm/jadval matnda havola qilinganmi — sof hisob `report/score.ts` da,
 * bu o'ram raqam (`workVisualNumbers` — bob bo'yicha `1.1`) va yorliqni
 * (`1.1-rasm`) beradi. WP-C `planWork` kelganda u ayni shu raqamlarni
 * beradi — ikkalasi bir xil chiqishi uchun formula BITTA joyda.
 */
export function workVisualCoverage(doc: AcademicDoc) {
  const model = modelOf(doc);
  const L = workLabels(model?.language ?? doc.meta.language);
  return visualCoverageOf(doc.sections, model?.figures ?? [], workVisualNumbers(doc), { figureRef: L.figureRef, tableRef: L.tableRef }, L.lang);
}

/* ────────────────────────── qoidalar ────────────────────────── */

export type WorkRuleResult = { checks: ReviewCheck[]; verifiedShare: number; recentShare: number };

export function workRuleChecks(doc: AcademicDoc, o: { guard?: ReviewGuardInput; research?: ResearchStats; now?: Date } = {}): WorkRuleResult {
  const model = modelOf(doc);
  const out: ReviewCheck[] = [];
  if (!model) {
    out.push(check("structure", "red", "Tuzilma", "Eski hujjat — tayyorlik hisoboti uchun qaytadan yarating"));
    return { checks: out, verifiedShare: 0, recentShare: 0 };
  }
  const kind = workKindOf(model.genre, model.kind);
  const subject = SUBJECT_PROFILES[model.subject] ?? SUBJECT_PROFILES.humanities;
  const L = workLabels(model.language || doc.meta.language);
  const year = (o.now ?? new Date()).getFullYear();
  const sections = textSections(doc);
  const intro = doc.sections.find((s) => s.id === "intro");
  const conclusion = doc.sections.find((s) => s.id === "conclusion");
  const refs = model.references.filter((r) => r.cited);
  const plan = workWordPlan(doc.meta, kind, subject, { refs: model.refsMin, figures: model.figures.length, tables: doc.tables?.length ?? 0 });
  const bodyWords = sections.reduce((n, s) => n + wordsOf(s.blocks), 0);

  /* ── 1. introParts: MAJBURIY elementlar ── */
  {
    const r = intakeCheck(kind.introParts, intro?.blocks ?? [], null);
    const names = (ids: typeof r.missing) => ids.map((p) => L.introPart[p]).join(", ");
    if (!intro?.blocks.length) out.push(check("introParts", "red", "Kirish elementlari", "Kirish bo‘sh", rewrite("intro", `Write the introduction with all mandatory elements: ${kind.introParts.join(", ")}.`)));
    else if (r.missing.length)
      out.push(
        check(
          "introParts",
          r.missing.length > kind.introParts.length / 2 ? "red" : "yellow",
          "Kirish elementlari",
          `${kind.introParts.length} tadan ${r.found.length} tasi bor; yo‘q: ${names(r.missing)}`,
          rewrite("intro", `Rewrite the introduction so that it explicitly states these missing mandatory elements: ${r.missing.join(", ")}. Keep everything that is already correct.`),
        ),
      );
    else out.push(check("introParts", "green", "Kirish elementlari", `${kind.introParts.length} ta majburiy element bor`));
  }

  /* ── 2. introShare: kirish 10–15 % ── */
  {
    const share = bodyWords ? wordsOf(intro?.blocks ?? []) / bodyWords : 0;
    const [lo, hi] = kind.introShare;
    const d = `${pct(share)} (kerak ${pct(lo)}–${pct(hi)})`;
    if (!intro?.blocks.length) out.push(check("introShare", "red", "Kirish hajmi", "Kirish yo‘q"));
    else if (share >= lo && share <= hi) out.push(check("introShare", "green", "Kirish hajmi", d));
    else if (share >= lo * 0.6 && share <= hi * 1.6)
      out.push(check("introShare", "yellow", "Kirish hajmi", d, rewrite("intro", `Adjust the introduction to about ${Math.round(((lo + hi) / 2) * bodyWords)} words (${share < lo ? "expand the mandatory elements" : "condense without dropping any mandatory element"}).`)));
    else out.push(check("introShare", "red", "Kirish hajmi", d, rewrite("intro", `Rewrite the introduction to about ${Math.round(((lo + hi) / 2) * bodyWords)} words, keeping every mandatory element.`)));
  }

  /* ── 3. chapterBalance: har bobda ≥2 paragraf, boblar ±30 % ── */
  {
    const b = chapterBalance(doc.sections, kind.paragraphsPerChapter.min);
    const d = `${b.chapters.length} bob: ${b.chapters.map((c) => `${c.id} ${c.words} so‘z / ${c.paragraphs} paragraf`).join("; ")}`;
    if (b.chapters.length < kind.chapters.min) out.push(check("chapterBalance", "red", "Boblar balansi", `${b.chapters.length} ta — kamida ${kind.chapters.min} kerak`));
    else if (b.thin.length) {
      const target = b.thin[0];
      const first = sections.find((s) => s.id.startsWith(`${target}.`));
      out.push(
        check("chapterBalance", "red", "Boblar balansi", `Paragraf yetmaydi (${kind.paragraphsPerChapter.min} kerak): ${b.thin.join(", ")}`, first ? rewrite(first.id, `Expand this paragraph substantially — its chapter has fewer paragraphs than the requirement; add a new specific aspect with cited sources.`) : undefined),
      );
    } else if (!b.balanced) {
      const biggest = [...b.chapters].sort((x, y) => y.words - x.words)[0];
      const target = sections.find((s) => s.id.startsWith(`${biggest.id}.`));
      out.push(check("chapterBalance", "yellow", "Boblar balansi", `Boblar hajmi ±30 % dan chetda — ${d}`, target ? rewrite(target.id, `Condense this paragraph: its chapter is noticeably longer than the others; remove repetition, keep every citation and fact.`) : undefined));
    } else out.push(check("chapterBalance", "green", "Boblar balansi", d));
  }

  /* ── 4. length: umumiy hajm ── */
  {
    const target = Math.max(1, plan.body);
    const ratio = bodyWords / target;
    const d = `${bodyWords} so‘z (maqsad ≈${target}, ${pct(ratio)})`;
    if (Math.abs(ratio - 1) <= LENGTH_TOLERANCE) out.push(check("length", "green", "Hajm", d));
    else if (Math.abs(ratio - 1) <= LENGTH_TOLERANCE * 2) out.push(check("length", "yellow", "Hajm", d));
    else out.push(check("length", "red", "Hajm", d));
  }

  /* ── 5. conclusionShare: xulosa 2–4 bet (referat ≈1) ── */
  {
    const words = wordsOf(conclusion?.blocks ?? []);
    const pages = words / plan.perPage;
    const [lo, hi] = kind.conclusionPages;
    const d = `${words} so‘z ≈ ${pages.toFixed(1)} bet (kerak ${lo}–${hi} bet)`;
    if (!conclusion?.blocks.length) out.push(check("conclusionShare", "red", "Xulosa hajmi", "Xulosa yo‘q", rewrite("conclusion", `Write the conclusion answering each task from the introduction.`)));
    else if (pages >= lo * 0.8 && pages <= hi * 1.2) out.push(check("conclusionShare", "green", "Xulosa hajmi", d));
    else
      out.push(
        check("conclusionShare", "yellow", "Xulosa hajmi", d, rewrite("conclusion", `${pages < lo ? "Expand" : "Condense"} the conclusion to about ${Math.round(((lo + hi) / 2) * plan.perPage)} words: one item per task from the introduction, no new facts.`)),
      );
  }

  /* ── 6. refsCount: janr minimumi (fix YO'Q — foydalanuvchi ma'lumoti) ── */
  {
    const n = refs.length;
    const need = model.refsMin;
    const r = o.research;
    const src = r ? ` (qidiruv: ${r.found} topildi, ${r.selected} tanlandi${r.failedQueries ? `, ${r.failedQueries} so‘rov xato` : ""})` : "";
    if (n < need) out.push(check("refsCount", n < need / 2 ? "red" : "yellow", "Manbalar soni", `${n} ta — janr kamida ${need} ta talab qiladi${src}`));
    else out.push(check("refsCount", "green", "Manbalar soni", `${n} ta (kamida ${need})${src}`));
  }

  /* ── 7. refsOrder: O'zbekiston tartibi (`cite/order.ts orderUzReferences`) ── */
  {
    if (!refs.length) out.push(check("refsOrder", "green", "Ro‘yxat tartibi", "Manba yo‘q"));
    else {
      const ordered = orderUzReferences(refs).map((r) => r.id).join("|");
      const actual = refs.map((r) => r.id).join("|");
      const groups = [...new Set(refs.map((r) => UZ_GROUP_LABEL[uzGroupOf(r)]))].join(" → ");
      out.push(
        actual === ordered
          ? check("refsOrder", "green", "Ro‘yxat tartibi", `O‘zbekiston qoidasi bo‘yicha: ${groups}`)
          : check("refsOrder", "yellow", "Ro‘yxat tartibi", "Ro‘yxat O‘zbekiston qoidasi bo‘yicha tartiblanmagan (qonun → VM/vazirlik → kitob → maqola → statistika → internet)"),
      );
    }
  }

  /* ── 8. refsVerified: 100 % tekshirilgan ── */
  const verifiedShare = refs.length ? refs.filter((r) => r.verified !== "unverified").length / refs.length : 1;
  {
    const bad = refs.filter((r) => r.verified === "unverified");
    if (!refs.length) out.push(check("refsVerified", "green", "Tasdiqlangan manbalar", "Manba yo‘q"));
    else if (verifiedShare >= 1) out.push(check("refsVerified", "green", "Tasdiqlangan manbalar", "Barcha manbalar tekshirilgan yoki foydalanuvchidan"));
    else out.push(check("refsVerified", verifiedShare < 0.8 ? "red" : "yellow", "Tasdiqlangan manbalar", `${pct(verifiedShare)} tasdiqlangan; tekshirilmagan: ${list(bad.map((r) => r.id))}`));
  }

  /* ── 9. refsCited: matn ↔ ro'yxat 1:1 ── */
  const inText = new Set<string>();
  {
    const known = new Set(model.references.map((r) => r.id));
    const re = /\[([^\[\]\n]{1,240})\]/g;
    let citeCount = 0;
    const scan = (t: string) => {
      let m: RegExpExecArray | null;
      while ((m = re.exec(t))) for (const tok of m[1].split(";")) {
        const id = tok.trim();
        if (known.has(id)) {
          inText.add(id);
          citeCount++;
        }
      }
    };
    for (const s of sections) for (const b of s.blocks) if (b.kind !== "formula") scan(b.text);
    for (const t of doc.tables ?? []) {
      if (t.caption) scan(t.caption);
      for (const r of t.rows) for (const c of r) scan(c);
    }
    const unresolved = o.guard?.unresolved ?? [];
    const orphan = refs.filter((r) => !inText.has(r.id));
    if (unresolved.length) out.push(check("refsCited", "red", "Iqtibos ↔ ro‘yxat", `${unresolved.length} ta reyestrda yo‘q iqtibos o‘chirildi (${list([...new Set(unresolved.map((u) => u.sectionId))])}) — jumlalar manbasiz qoldi`));
    else if (!citeCount && model.refsMin > 0) out.push(check("refsCited", "red", "Iqtibos ↔ ro‘yxat", "Matnda birorta iqtibos yo‘q"));
    else if (orphan.length) out.push(check("refsCited", "yellow", "Iqtibos ↔ ro‘yxat", `Ro‘yxatda bor, matnda yo‘q: ${list(orphan.map((r) => r.id))}`));
    else out.push(check("refsCited", "green", "Iqtibos ↔ ro‘yxat", `${citeCount} iqtibos, ${refs.length} manba — 1:1`));
  }

  /* ── recentShare (ball bandi emas, panel ko'rsatkichi) ── */
  const dated = refs.filter((r) => Number.isInteger(r.year));
  const recentShare = dated.length ? dated.filter((r) => r.year! >= year - 10).length / dated.length : 0;

  /* ── 10. visualRef: har vizual matnda havola qilinganmi ── */
  {
    const v = workVisualCoverage(doc);
    const need = kind.visuals;
    const problems = v.unreferenced.map((x) => x.label);
    if (problems.length) {
      const first = v.unreferenced[0];
      out.push(
        check("visualRef", "yellow", "Vizuallar", `Matnda havola yo‘q: ${list(problems)}`, rewrite(first.sectionId, `Refer to the visual in this section's text: write the token ${first.kind === "figure" ? `[fig:${first.id}]` : `[tab:${first.id}]`} inside a sentence that introduces it; keep everything else unchanged.`)),
      );
    } else if (v.fallback) out.push(check("visualRef", "yellow", "Vizuallar", `${v.fallback} ta sxema chizilmadi — ro‘yxat sifatida qoldi`));
    else if (!v.count && (need.tables === "required" || need.figures === "required"))
      out.push(check("visualRef", "red", "Vizuallar", "Bu tur uchun jadval va sxema majburiy — bittasi ham yo‘q"));
    else if (!v.count && doc.meta.includeVisuals && (model.figures.length || (doc.tables?.length ?? 0)))
      out.push(check("visualRef", "yellow", "Vizuallar", "Vizual so‘ralgan, lekin matnga joylashmadi"));
    else out.push(check("visualRef", "green", "Vizuallar", v.count ? `${v.count} ta vizual, hammasi matnda havola qilingan` : "Vizual talab qilinmaydi"));
  }

  /* ── 11. tocMatch: mundarija ↔ bo'lim sarlavhalari ── */
  {
    const planned = model.chapters.flatMap((c) => [c.title, ...c.paragraphs.map((p) => p.title)]);
    const actual = new Map(doc.sections.map((s) => [s.id, s.title]));
    const mismatch: string[] = [];
    for (const c of model.chapters) {
      if (actual.get(c.id) !== c.title) mismatch.push(c.id);
      for (const p of c.paragraphs) if (actual.get(p.sectionId) !== p.title) mismatch.push(p.id);
    }
    const missing = model.chapters.flatMap((c) => c.paragraphs).filter((p) => !doc.sections.some((s) => s.id === p.sectionId)).map((p) => p.id);
    if (!planned.length) out.push(check("tocMatch", "red", "Mundarija mosligi", "Reja bo‘sh"));
    else if (missing.length) out.push(check("tocMatch", "red", "Mundarija mosligi", `Rejadagi bo‘lim hujjatda yo‘q: ${list(missing)}`));
    else if (mismatch.length) out.push(check("tocMatch", "yellow", "Mundarija mosligi", `Sarlavha rejadan farq qiladi: ${list([...new Set(mismatch)])}`));
    else out.push(check("tocMatch", "green", "Mundarija mosligi", `${model.chapters.length} bob, ${model.chapters.reduce((n, c) => n + c.paragraphs.length, 0)} paragraf — mundarijaga mos`));
  }

  /* ── guard qayta: suv, manbasiz raqamlar ── */
  const perSection = sections.map((s) => ({ s, r: guardSection(s.blocks, { refs: model.references, userFacts: model.userFacts }).report }));

  /* ── 12. filler ── */
  {
    const filler = perSection.flatMap((x) => x.r.filler);
    const worst = [...perSection].sort((a, b) => b.r.filler.length - a.r.filler.length)[0];
    const d = `${filler.length} ta: ${list([...new Set(filler)])}`;
    if (filler.length > 3) out.push(check("filler", "red", "«Suv» iboralar", d, worst ? rewrite(worst.s.id, "Remove filler phrases and make every sentence carry a specific claim, mechanism or comparison.") : undefined));
    else if (filler.length) out.push(check("filler", "yellow", "«Suv» iboralar", d, worst ? rewrite(worst.s.id, "Remove filler phrases and make every sentence carry a specific claim.") : undefined));
    else out.push(check("filler", "green", "«Suv» iboralar", "Topilmadi"));
  }

  /* ── 13. repetition: 3-gram Jaccard ── */
  {
    const big = sections.filter((s) => wordsOf(s.blocks) >= 30).map((s) => ({ s, g: trigrams(sectionText(s)) }));
    let worst: { a: DocSection; b: DocSection; j: number } | null = null;
    for (let i = 0; i < big.length; i++)
      for (let k = i + 1; k < big.length; k++) {
        const j = jaccard(big[i].g, big[k].g);
        if (j > REPETITION_JACCARD && (!worst || j > worst.j)) worst = { a: big[i].s, b: big[k].s, j };
      }
    out.push(
      worst
        ? check("repetition", "yellow", "Bo‘limlar takrori", `«${worst.a.title}» ↔ «${worst.b.title}»: ${pct(worst.j)} umumiy 3-gram`, rewrite(worst.b.id, `Rewrite so it does not repeat sentences from “${worst.a.title}”; add new content specific to this section.`))
        : check("repetition", "green", "Bo‘limlar takrori", "Bo‘limlar bir-birini takrorlamaydi"),
    );
  }

  /* ── 14. unsourcedNumbers ── */
  {
    const unsourced = perSection.flatMap((x) => x.r.unsourcedNumbers);
    const worst = [...perSection].sort((a, b) => b.r.unsourcedNumbers.length - a.r.unsourcedNumbers.length)[0];
    out.push(
      unsourced.length
        ? check("unsourcedNumbers", "red", "Manbasiz raqamlar", `Iqtibossiz va foydalanuvchi faktida yo‘q foizlar: ${list([...new Set(unsourced)])}`, worst ? rewrite(worst.s.id, "Remove or attribute every percentage that has no cited source or user fact; describe qualitatively instead.") : undefined)
        : check("unsourcedNumbers", "green", "Manbasiz raqamlar", "Barcha foizlar manbali yoki foydalanuvchi faktidan"),
    );
  }

  /* ── 15. userFacts ── */
  {
    const missing = missingFactNumbers(sections, model.userFacts);
    if (!model.userFacts?.trim()) out.push(check("userFacts", "green", "Materiallaringiz", "Fakt berilmagan"));
    else if (missing.length) {
      const target = sections.find((s) => /^ch\d+\.\d+$/.test(s.id)) ?? sections[0];
      out.push(check("userFacts", "yellow", "Materiallaringiz", `Matnda uchramagan raqamlar: ${list(missing)}`, target ? rewrite(target.id, `Include the student's own figures verbatim: ${missing.slice(0, 6).join(", ")}.`) : undefined));
    } else out.push(check("userFacts", "green", "Materiallaringiz", "Barcha raqamlaringiz matnda"));
  }

  /* ── 16. pageLimit: paket chegarasi ── */
  {
    const est = estimateWorkDocPages(doc);
    const [lo, hi] = [Math.max(1, plan.pages * 0.85), plan.pages * 1.2];
    const target = estimateWorkPages(doc.meta.pagesLabel || `${plan.pages}`, kind, subject, { refs: model.refsMin, figures: model.figures.length, tables: doc.tables?.length ?? 0 });
    const d = `Taxminan ${Math.round(est)} bet (paket ${doc.meta.pagesLabel || plan.pages}, reja ${target})`;
    if (est >= lo && est <= hi) out.push(check("pageLimit", "green", "Bet chegarasi", d));
    else {
      const longest = [...sections].sort((a, b) => wordsOf(b.blocks) - wordsOf(a.blocks))[0];
      out.push(
        check(
          "pageLimit",
          est < lo * 0.7 || est > hi * 1.3 ? "red" : "yellow",
          "Bet chegarasi",
          d,
          longest && est > hi ? rewrite(longest.id, `Shorten this section by about ${Math.min(50, Math.round(((est - hi) / est) * 100) + 10)}% — remove redundancy, keep every fact and citation.`) : undefined,
        ),
      );
    }
  }

  return { checks: out, verifiedShare, recentShare };
}

/* ────────────────────────── baholovchi ────────────────────────── */

/** Turning baholovchi spetsifikatsiyasi — reyestrdan (`registry.ts judge`). */
export function workJudgeSpec(kind: WorkKind) {
  return kind.judge;
}

export function workJudgeSystemPrompt(kind: WorkKind, sectionIds: string[]): string {
  return judgeSystemPromptFor(kind.judge, sectionIds);
}

export function parseWorkJudge(kind: WorkKind, raw: string | null | undefined, sectionIds: string[]): WorkJudgeResult | null {
  return parseJudgeFor(kind.judge, raw, sectionIds);
}

export function neutralWorkJudge(kind: WorkKind): WorkJudgeResult {
  return neutralJudgeFor(kind.judge);
}

export function workJudgeChecks(kind: WorkKind, j: WorkJudgeResult): ReviewCheck[] {
  return judgeChecksFor(kind.judge, j);
}

/**
 * Baholovchiga beriladigan matn: sarlavha, janr/tur/fan, kirish va
 * xulosa TO'LIQ (`sampleForJudge` — X-4: aynan shu ikki bo'lim
 * `aimMatch` mezoni uchun kerak), boblar mutanosib kesilgan, manbalar.
 */
export function workJudgeUserPrompt(doc: AcademicDoc, maxChars = JUDGE_TEXT_CHARS): string {
  const model = modelOf(doc);
  const kind = model ? workKindOf(model.genre, model.kind) : null;
  const groups = textSections(doc).map((s) => ({
    id: s.id,
    title: s.title,
    lines: s.blocks.map((b) => (b.kind === "figure" || b.kind === "tableRef" ? `[${b.text}]` : b.text)),
  }));
  const body = sampleForJudge(groups, maxChars)
    .map((g) => `## ${g.id} — ${g.title}\n${g.text}${g.truncated ? "\n[…truncated]" : ""}`)
    .join("\n\n");
  const refs = (model?.references ?? []).filter((r) => r.cited).map((r, i) => `${i + 1}. ${r.authors.join(", ")} ${r.title}${r.year ? ` (${r.year})` : ""}`).join("\n");
  const chapters = (model?.chapters ?? []).map((c, i) => `${i + 1}. ${c.title}`).join("; ");
  return [
    `TITLE: ${model?.title ?? doc.meta.topic}`,
    `GENRE: ${model?.genre ?? "?"} · TYPE: ${kind?.id ?? "?"} · SUBJECT FIELD: ${model?.subject ?? "?"} · LANGUAGE: ${langKey(model?.language ?? doc.meta.language)}`,
    `PLAN: ${chapters || "(none)"}`,
    "",
    "SECTIONS:",
    body,
    "",
    `REFERENCES (${refs ? refs.split("\n").length : 0}):`,
    refs || "(none)",
  ].join("\n");
}

/* ────────────────────────── asosiy ────────────────────────── */

export function scoreWorkReview(rules: ReviewCheck[], judge: WorkJudgeResult): number {
  return scoreReviewFor(rules, judge, WORK_JUDGE_CRITERIA);
}

export async function reviewWork(doc: AcademicDoc, opts: WorkReviewOpts = {}): Promise<DocReview> {
  const now = opts.now ?? new Date();
  const model = modelOf(doc);
  const kind = model ? workKindOf(model.genre, model.kind) : workKindOf("coursework", "theory");
  const rules = workRuleChecks(doc, { guard: opts.guard, research: opts.research, now });

  let judge: WorkJudgeResult | null = null;
  const judgeNotes: string[] = [];
  if (opts.judge !== false && opts.complete) {
    const timeoutMs = Math.min(JUDGE_TIMEOUT_MS, remainingMs(opts.deadline));
    if (timeoutMs >= JUDGE_MIN_MS) {
      const ids = textSections(doc).map((s) => s.id);
      try {
        const r = await opts.complete("judge", workJudgeSystemPrompt(kind, ids), workJudgeUserPrompt(doc), { json: true, deadline: opts.deadline, maxTokens: 1500, timeoutMs });
        if (r?.usage) opts.onUsage?.(r.usage);
        judge = parseWorkJudge(kind, r?.text, ids);
      } catch (e) {
        console.warn("[work] baholovchi xatosi:", e instanceof Error ? e.message : e);
      }
    }
    if (!judge) judgeNotes.push(JUDGE_NO_ANSWER);
  }
  const j = judge ?? neutralWorkJudge(kind);
  judgeNotes.push(...j.notes);

  return {
    score: scoreWorkReview(rules.checks, j),
    checks: [...rules.checks, ...workJudgeChecks(kind, j)],
    judgeNotes,
    verifiedShare: Math.round(rules.verifiedShare * 100) / 100,
    recentShare: Math.round(rules.recentShare * 100) / 100,
    builtAt: now.toISOString(),
  };
}
