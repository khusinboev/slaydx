/**
 * TALABA ISHI PROMPTLARI (AUDIT-19 WP-A) — `article/prompts.ts` naqshi.
 *
 * Ko'rsatmalar INGLIZCHA, birinchi qator `languageDirective`: tuzilma
 * qoidalarini (JSON sxemasi, id bilan iqtibos, VERBATIM faktlar) model
 * inglizcha ko'rsatmada ishonchliroq bajaradi, chiqish tilini esa
 * birinchi qator qat'iy belgilaydi.
 *
 * Uch TAQIQ shu yerda qulflanadi (testda `assert.match`):
 *   • manba/muallif o'ylab topish — iqtibos FAQAT berilgan `[W…]`/`[u…]` id;
 *   • manbasiz raqam (foiz, n=, yil) — faqat SOURCES yoki USER FACTS dan;
 *   • «suv» iboralar (`report/filler.ts FILLER_PHRASES`).
 * Qo'riqchi (`work/guard.ts` → `report/guard.ts`) va `research/verify.ts`
 * shu qoidalarni generatsiyadan KEYIN ham tekshiradi.
 *
 * Sxema turlarining JSON sxemasi maqoladan QAYTA ishlatiladi
 * (`FIGURE_KIND_HELP`) — ikkinchi nusxa yozilmaydi; `lengthLine` va
 * `formatRefLine` ham o'sha yerdan import qilinadi.
 */
import { languageDirective } from "../i18n";
import { FILLER_PHRASES } from "../report/filler";
import { HONESTY_LIMIT } from "../report/polish-core";
import { FIGURE_KIND_HELP, formatRefLine, lengthLine } from "../article/prompts";
import { SELECTABLE_FIGURE_KINDS, type Reference, type SelectableFigureKind } from "../types";
import type { DocMeta } from "../types";
import type { WorkKind } from "./registry";
import type { SubjectProfile } from "./subjects";
import type { WorkDocLabels } from "./labels";
import type { WorkInput } from "./input";
import type { WorkWordPlan } from "./plan";
import { WORK_INTRO_PART_IDS, type WorkIntroPartId } from "./types";

export { HONESTY_LIMIT };

/** Dvigatel bosqichlari o'rtasida uzatiladigan kontekst. */
export type WorkContext = {
  input: WorkInput;
  meta: DocMeta;
  kind: WorkKind;
  subject: SubjectProfile;
  labels: WorkDocLabels;
  plan: WorkWordPlan;
  refs: Reference[];
};

/** Bitta paragraf (yoki kirish/xulosa) rejasi — outline bosqichi natijasi. */
export type WorkSectionPlan = {
  /** `ch1.2` | `intro` | `conclusion`. */
  id: string;
  title: string;
  /** Bob sarlavhasi (paragraf uchun) — promptga kontekst sifatida kiradi. */
  chapterTitle?: string;
  brief: string;
  words: number;
};

export type WorkOutlinePlan = {
  chapters: { id: string; title: string; paragraphs: WorkSectionPlan[] }[];
};

/* ────────────────────────── tizim prompti ────────────────────────── */

const GENRE_NOUN: Record<string, string> = {
  coursework: "course paper (kurs ishi)",
  referat: "referat (topic report)",
  independent: "independent study work (mustaqil ish)",
};

function titleContext(ctx: WorkContext): string {
  const i = ctx.input;
  const rows = [
    i.university && `university: ${i.university}`,
    i.faculty && `faculty: ${i.faculty}`,
    i.department && `department: ${i.department}`,
    i.subjectName && `subject (fan): ${i.subjectName}`,
    i.course && `course/year: ${i.course}`,
    i.group && `group: ${i.group}`,
    i.author && `author: ${i.author}`,
    i.teacher && `supervisor: ${[i.teacherDegree, i.teacher].filter(Boolean).join(" ")}`,
    i.city && `city: ${i.city}`,
  ].filter(Boolean);
  return rows.length ? `CONTEXT (title page — do NOT repeat these lines in the body text): ${rows.join("; ")}.` : "";
}

function outlineContext(ctx: WorkContext): string {
  if (!ctx.input.outline.length) return "";
  const lines = ctx.input.outline.map((c, i) => `  ${i + 1}. ${c.title}${c.paragraphs.length ? `\n${c.paragraphs.map((p, j) => `     ${i + 1}.${j + 1}. ${p}`).join("\n")}` : ""}`);
  return [`AUTHOR'S OWN PLAN (binding — keep these chapter and paragraph titles, do not invent your own):`, ...lines].join("\n");
}

/**
 * Tizim prompti — barcha yozuv chaqiruvlari uchun bitta (reja, kirish,
 * paragraf, xulosa). Turga xos qoidalar «TYPE RULES», fan profiliga xos
 * qoidalar «SUBJECT RULES» bo'limida (AUDIT-18 Q-7 naqshi).
 */
export function workSystemPrompt(ctx: WorkContext): string {
  const { input, kind, subject } = ctx;
  const lang = ctx.meta.language || input.language;
  const lines = [
    languageDirective(lang),
    `You are an academic supervisor writing a student's ${GENRE_NOUN[input.genre] ?? "student paper"} for an Uzbek university.`,
    `Topic: «${input.topic}».`,
    `Work type: ${kind.label.en} (${kind.id}). Subject field: ${subject.label.en} (${subject.id}).`,
    `Target volume: about ${ctx.plan.body} words of body text (${ctx.plan.pages} pages including title page, contents and the reference list).`,
    `RULES (strict):`,
    `1. CITATIONS: cite ONLY the sources listed under SOURCES, by their ID in square brackets: [W2741809807], several: [W2741809807; u1], with a page locator: [u1; 25-b.]. Never cite by number, author name or year alone. NEVER invent a source, law, DOI, author, publisher or year. A claim with no matching source is written WITHOUT a citation. A citation ID that is not in SOURCES will be deleted automatically.`,
    `2. NUMBERS: every statistic, percentage, sample size, price, date of an event or article number of a law must come either from a cited SOURCE (cite it in the same sentence) or from USER FACTS. Do not invent survey results, measurements or statistics. If you have no number, describe qualitatively.`,
    `3. USER FACTS are the student's own materials — reproduce every number, unit, name and date VERBATIM; never alter, round or contradict them; do not add results the student did not report. Report them in full once, then refer to them briefly.`,
    `4. NO FILLER: do not use empty openers such as ${FILLER_PHRASES.slice(0, 4).map((p) => `«${p}»`).join(", ")}, «${FILLER_PHRASES[8]}», «${FILLER_PHRASES[12]}», «${FILLER_PHRASES[16]}». Every paragraph must carry a specific claim, mechanism, comparison or result.`,
    `5. Style: formal academic register, third person, precise terminology of the field; no motivational sentences, no rhetorical questions; do not repeat the section title inside the text; do NOT write chapter numbers («1-BOB», «1.1.») inside the text — the renderer adds them.`,
    `6. Output: return ONLY the JSON requested — no markdown fences, no commentary.`,
    `TYPE RULES (${kind.label.en}):`,
    ...kind.guidance.map((g, i) => `${i + 1}. ${g}`),
    `SUBJECT RULES (${subject.label.en}):`,
    ...subject.guidance.map((g, i) => `${i + 1}. ${g}`),
  ];
  const title = titleContext(ctx);
  if (title) lines.push(title);
  const outline = outlineContext(ctx);
  if (outline) lines.push(outline);
  if (input.extra) lines.push(`Additional author requirements: ${input.extra}`);
  if (input.userFacts) lines.push(`USER FACTS (verbatim, the student's own materials/results):\n--- FACTS ---\n${input.userFacts}\n--- END FACTS ---`);
  if (input.sourceText) {
    lines.push(`SOURCE DOCUMENT uploaded by the student (context; use its facts, terms and structure; do not copy verbatim; numbers from it count as USER FACTS):\n--- SOURCE ---\n${input.sourceText.slice(0, 16_000)}\n--- END SOURCE ---`);
  }
  return lines.join("\n");
}

/* ────────────────────────── reja ────────────────────────── */

const SHAPE_HINT: Record<WorkKind["shape"], string> = {
  "theory-2x2": "chapter 1 = conceptual/theoretical foundations, chapter 2 = analysis of the topic on that foundation (and, if a third chapter is asked for, practical conclusions)",
  "review-experiment-results": "chapter 1 = literature and normative basis, chapter 2 = the procedure (calculation, experiment or case analysis), chapter 3 = results and their discussion",
  "theory-analysis-practice": "part 1 = theory, part 2 = analysis of the chosen case, part 3 = the student's own practical result (example, calculation, recommendations)",
  sections: "independent SECTIONS of the topic (not chapters): each covers one aspect and can be read on its own",
};

/** Kirish elementlari ro'yxati — prompt va hisobot bitta manbadan. */
export function introPartsLine(parts: WorkIntroPartId[], L: WorkDocLabels): string {
  return parts.map((p) => `${p} («${L.introPart[p]}»)`).join(", ");
}

export function workOutlinePrompt(ctx: WorkContext): string {
  const { kind, input, plan } = ctx;
  const word = kind.shape === "sections" ? "sections" : "chapters";
  const lines = [
    `Plan the body of the work: ${kind.chapters.min}–${kind.chapters.max} ${word}, each with ${kind.paragraphsPerChapter.min}–${kind.paragraphsPerChapter.max} numbered paragraphs.`,
    `Shape for this work type: ${SHAPE_HINT[kind.shape]}.`,
    `Every title is a NOUN PHRASE naming its actual content for THIS topic («${input.topic}») — never «Nazariy qism», «Asosiy qism», «Kirish» or a bare restatement of the topic. Do NOT put numbers in the titles.`,
    `For each paragraph write a one-sentence «brief»: what exactly it will argue or report (specific, not generic).`,
    `The ${word} together carry about ${plan.chapters} words; distribute them evenly.`,
    `Also plan the INTRODUCTION: for each required element give one sentence of what it will say. Required elements: ${introPartsLine(kind.introParts, ctx.labels)}.`,
  ];
  if (input.outline.length) {
    lines.push(`The author's own plan above is BINDING: reproduce its titles exactly (translated into the output language if needed); only add the «brief» for each.`);
  }
  lines.push(
    `Return JSON: {"chapters":[{"title":"…","paragraphs":[{"title":"…","brief":"…"}]}],"intro":{${ctx.kind.introParts.map((p) => `"${p}":"…"`).join(",")}}}`,
  );
  return lines.join("\n");
}

/* ────────────────────────── kirish ────────────────────────── */

/**
 * Kirish — MAJBURIY elementlar aniq belgilangan: model har element uchun
 * alohida matn beradi (`parts`) va ular bloklarga aylanadi. Shu tufayli
 * qo'riqchi (`intakeCheck`) yo'qolgan elementni ANIQ ko'radi va dvigatel
 * bir marta qayta so'raydi.
 */
export function workIntroPrompt(ctx: WorkContext, outline: WorkOutlinePlan, missing?: WorkIntroPartId[]): string {
  const { kind, labels: L, plan } = ctx;
  const parts = missing?.length ? missing : kind.introParts;
  const structure = outline.chapters.map((c, i) => `${i + 1}. ${c.title}`).join("; ");
  const lines = [
    missing?.length
      ? `The previous introduction was missing these MANDATORY elements: ${introPartsLine(parts, L)}. Write them now (the rest of the introduction stays as it is).`
      : `Write the INTRODUCTION of the work. It must contain EVERY mandatory element below, each stated explicitly and in this order — a missing element fails the university requirement.`,
    ...parts.map((p) => `- ${p} («${L.introPart[p]}»): ${INTRO_PART_ASK[p]}`),
    `Each element is one paragraph (2–5 sentences) that names the element in its own words — for example the aim paragraph literally states the aim.`,
    lengthLine(plan.intro),
    structure ? `The «structure» element must describe the actual plan of THIS work: ${structure}.` : "",
    `Return JSON: {"parts":{${parts.map((p) => `"${p}":"…"`).join(",")}}}`,
  ].filter(Boolean);
  return lines.join("\n");
}

/** Har element promptda nima so'ralishi — hisobot regexlari bilan bitta manbadan. */
const INTRO_PART_ASK: Record<WorkIntroPartId, string> = {
  relevance: "why the topic matters now — with a concrete fact, trend or normative document, cited.",
  aim: "one sentence starting from the aim itself («Ishning maqsadi — …» / «Цель работы — …» / «The aim of the work is …»).",
  tasks: "a numbered list of 3–5 concrete tasks; each task must be answerable by one part of the work.",
  object: "what phenomenon or process as a whole is studied.",
  subject: "which aspect of that object is studied here (narrower than the object).",
  methods: "the research methods actually used (analysis of sources, comparison, systematisation, statistical analysis, case study …) — no method the work does not use.",
  structure: "how many chapters/sections and what each contains, plus the number of pages and sources.",
  novelty: "what exactly this work adds to what the cited sources already say.",
  significance: "where and by whom the results can be used in practice.",
};

/* ────────────────────────── paragraf ────────────────────────── */

export type WorkSectionAsk = {
  plan: WorkSectionPlan;
  wantTable: boolean;
  wantFigure: boolean;
  /**
   * Shu paragrafga BIRIKTIRILGAN manbalar (dvigatel manbalarni
   * paragraflar orasida aylanma taqsimlaydi). Jonli sinov: 7 manba
   * hammasi har paragrafga berilganda model 2 tasini ishlatdi — referat
   * `refsMin 5` qizil. Biriktirilgani «har birini kamida bir marta»
   * so'raladi, qolganlari ixtiyoriy.
   */
  primary?: Reference[];
};

/**
 * Sxema turlarining JSON shakli — maqola yordamidan (`FIGURE_KIND_HELP`)
 * QAYTA ishlatiladi; oq ro'yxat bo'lsa faqat u.
 */
export function workFigureHelp(kinds: readonly SelectableFigureKind[]): string {
  const list: readonly SelectableFigureKind[] = kinds.length ? kinds : SELECTABLE_FIGURE_KINDS;
  const lines = [
    `FIGURE spec kinds (choose the kind whose "use for" rule matches THIS paragraph's content; every label ≤ 40 characters, in the output language):`,
    ...list.map((k) => `  • ${FIGURE_KIND_HELP[k]}`),
  ];
  if (kinds.length) lines.push(`Allowed kinds (chosen by the author): ${kinds.join(", ")} — any other kind will be rejected.`);
  return lines.join("\n");
}

export function workParagraphPrompt(ctx: WorkContext, ask: WorkSectionAsk): string {
  const { plan } = ask;
  const refs = ctx.refs;
  const lines = [
    `Write the paragraph «${plan.title}»${plan.chapterTitle ? ` of the chapter «${plan.chapterTitle}»` : ""} (id ${plan.id}). Do not repeat the title in the text.`,
    `Plan for this paragraph: ${plan.brief}`,
    lengthLine(plan.words),
  ];
  const primary = ask.primary?.length ? ask.primary : [];
  const primaryIds = new Set(primary.map((r) => r.id));
  const other = refs.filter((r) => !primaryIds.has(r.id));
  if (refs.length) {
    lines.push(
      `SOURCES (cite by ID only; a citation supports a specific sentence; do not force a citation into every sentence; do not cite what you did not use). The whole work must cite about ${ctx.plan.refs} DIFFERENT sources (not fewer than ${ctx.input.refsMin}); the list is shared out between paragraphs, so:`,
    );
    if (primary.length) {
      lines.push(`PRIMARY SOURCES for this paragraph — use EACH of them at least once where it genuinely supports a sentence (a claim, a definition, a comparison, a figure):`, ...primary.map((r) => formatRefLine(r)));
      if (other.length) lines.push(`OTHER SOURCES (optional — only if they fit better):`, ...other.map((r) => formatRefLine(r)));
    } else {
      lines.push(...refs.map((r) => formatRefLine(r)));
    }
  } else {
    lines.push(`SOURCES: none available — write WITHOUT any citations and without any bracketed IDs or numbers.`);
  }
  const schema: string[] = [`{"blocks":[{"kind":"p","text":"…"},{"kind":"li","text":"…"},{"kind":"quote","text":"…"}]`];
  if (ask.wantTable) {
    lines.push(
      `Include ONE table that structures this paragraph's content (comparison, classification, indicators; 2–5 columns, 3–8 rows; cell values only from SOURCES/USER FACTS or qualitative labels — no invented numbers). Give "anchorAfterBlock": the index of the block after which it belongs; the caption is a noun phrase WITHOUT a number (the renderer adds «1.1-jadval»). Refer to the table in the text BEFORE it appears.`,
    );
    schema.push(`"table":{"caption":"…","headers":["…"],"rows":[["…"]],"anchorAfterBlock":1,"source":"…"}`);
  }
  if (ask.wantFigure) {
    lines.push(workFigureHelp(ctx.input.figureKinds));
    lines.push(`Include ONE figure (scheme) with a caption WITHOUT a number and "anchorAfterBlock"; refer to it in the text before it appears («quyidagi sxemada ko‘rsatilgan»), never by a number.`);
    schema.push(`"figure":{"caption":"…","anchorAfterBlock":1,"spec":{…}}`);
  }
  lines.push(`Return JSON: ${schema.join(",")}}`);
  return lines.join("\n");
}

/**
 * «Kengaytir» — paragraf rejadagi so'zning 70 % idan kalta chiqsa bir
 * marta (maqola dvigatelidagi `expandPrompt` naqshi). MAVJUD matn
 * promptga kiradi — usiz model paragrafni qayta yozib takrorlaydi.
 * Referat jonli sinovi: 6 paragraf ≈150–200 so'z (reja 305) → hujjat
 * 8 bet chiqib, hajm darvozasida yiqildi.
 */
export function workExpandPrompt(ctx: WorkContext, plan: WorkSectionPlan, have: number, need: number, existing: string): string {
  const refs = ctx.refs;
  return [
    `The paragraph «${plan.title}» (id ${plan.id}) currently has ${have} words; it needs about ${need} more (${Math.max(1, Math.ceil(need / 100))} paragraphs of 90–130 words). Write ADDITIONAL text for the same paragraph: NEW specific points only (a mechanism, a comparison, an example, a limitation, an implication) — do not repeat, rephrase or summarise anything from ALREADY WRITTEN.`,
    `Plan for this paragraph: ${plan.brief}`,
    `ALREADY WRITTEN (for reference — do not repeat):\n${existing.slice(0, 6000)}`,
    refs.length ? `SOURCES (same rules — cite by ID only, do not cite what you did not use):\n${refs.map((r) => formatRefLine(r)).join("\n")}` : `SOURCES: none — no citations, no bracketed IDs or numbers.`,
    `Return JSON: {"blocks":[{"kind":"p","text":"…"}]}`,
  ].join("\n");
}

/* ────────────────────────── xulosa ────────────────────────── */

/**
 * Xulosa — kirishdagi VAZIFALARGA javob: har vazifa uchun alohida band.
 * Bu `aimMatch` baholovchi mezonining to'g'ridan-to'g'ri talabi.
 */
export function workConclusionPrompt(ctx: WorkContext, tasks: string[], chapterSummaries: string): string {
  const { plan } = ctx;
  const lines = [
    `Write the CONCLUSION of the work.`,
    tasks.length
      ? `The introduction stated these tasks — answer EACH of them with its own numbered item, in the same order, saying what the work established:\n${tasks.map((t, i) => `  ${i + 1}. ${t}`).join("\n")}`
      : `Answer, item by item, the tasks stated in the introduction; each item says what the work established.`,
    `Then close with 1–2 paragraphs: the overall answer to the aim and, where it follows from the body, concrete recommendations.`,
    `Every statement must already be supported by the body — introduce NO new fact, number or source here.`,
    lengthLine(plan.conclusion),
    `Chapter summaries (this is what the work actually established):`,
    chapterSummaries,
    `Return JSON: {"blocks":[{"kind":"p","text":"…"},{"kind":"li","text":"…"}]}`,
  ];
  return lines.join("\n");
}

/* ────────────────────────── qayta yozish (sayqal) ────────────────────────── */

/**
 * Sayqal/«Tuzatish» uchun qayta yozish prompti. `HONESTY_LIMIT` oxirgi
 * to'siq: ko'rsatma nima so'ramasin, model faqat FAKT / JORIY MATN /
 * MANBADA bor tafsilotni yozadi (AUDIT-18 Q-2).
 */
export function workRewritePrompt(ctx: WorkContext, ask: WorkSectionAsk, current: string, instruction: string): string {
  return [
    workParagraphPrompt(ctx, { ...ask, wantTable: false, wantFigure: false }),
    `CURRENT TEXT of this section — rewrite it: keep its scope and every USER FACT verbatim, keep the citation IDs that still support a sentence, do not add new claims without a SOURCE:`,
    current || "(empty)",
    `EDITOR INSTRUCTION (highest priority): ${instruction}`,
    HONESTY_LIMIT,
  ].join("\n");
}

/** Kirishni qayta yozish — yo'qolgan elementlar bilan. */
export function workIntroRewritePrompt(ctx: WorkContext, outline: WorkOutlinePlan, current: string, instruction: string): string {
  return [
    workIntroPrompt(ctx, outline),
    `CURRENT INTRODUCTION — rewrite it keeping every element that is already correct:`,
    current || "(empty)",
    `EDITOR INSTRUCTION (highest priority): ${instruction}`,
    HONESTY_LIMIT,
  ].join("\n");
}

/** Xulosani qayta yozish. */
export function workConclusionRewritePrompt(ctx: WorkContext, tasks: string[], summaries: string, current: string, instruction: string): string {
  return [
    workConclusionPrompt(ctx, tasks, summaries),
    `CURRENT CONCLUSION — rewrite it:`,
    current || "(empty)",
    `EDITOR INSTRUCTION (highest priority): ${instruction}`,
    HONESTY_LIMIT,
  ].join("\n");
}

/* ────────────────────────── tadqiqot ────────────────────────── */

/** WP-B shartnomasi uchun kalit so'zlar — mavzu + tur + fan profilidan. */
export function workResearchKeywords(ctx: WorkContext): string[] {
  const out = new Set<string>();
  const topic = ctx.input.topic.trim();
  if (topic) out.add(topic);
  if (ctx.input.subjectName) out.add(`${topic} ${ctx.input.subjectName}`.trim());
  for (const c of ctx.input.outline.slice(0, 3)) if (c.title) out.add(c.title);
  return [...out].filter(Boolean).slice(0, 6);
}

export { WORK_INTRO_PART_IDS };
