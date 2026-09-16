/**
 * INSHO PROMPTLARI (AUDIT-19 WP-D).
 *
 * Ko'rsatmalar INGLIZCHA, birinchi qator `languageDirective` — maqola,
 * tarjima va rezyume dvigatellari bilan bir qaror: tuzilma qoidalarini
 * (JSON sxemasi, so'z sanash, VERBATIM faktlar) model inglizcha
 * ko'rsatmada ishonchliroq bajaradi, chiqish tilini esa birinchi qator
 * qat'iy belgilaydi.
 *
 * Uch TAQIQ shu yerda qulflanadi (testda `assert.match` bilan):
 *   • KLIŞE — `ESSAY_FILLER` («bugungi kunda», «xulosa qilib aytganda» …);
 *   • UYDIRMA FAKT/STATISTIKA — raqam faqat USER FACTS dan, qolgani
 *     sifat jihatidan bayon qilinadi;
 *   • UYDIRMA IQTIBOS — asardan iqtibos FAQAT foydalanuvchi bergan
 *     parchadan (`citations: "work_only"`), boshqa hech qanday manba yo'q.
 * Qo'riqchi (`report/guard.ts`) va hisobot (`review.ts`) shularni
 * generatsiyadan KEYIN ham tekshiradi — prompt yolg'iz kafolat emas.
 */
import { languageDirective, langInfo } from "../i18n";
import { FILLER_PHRASES } from "../report/filler";
import { HONESTY_LIMIT } from "../report/polish-core";
import type { DocMeta } from "../types";
import {
  ESSAY_CONTEXTS,
  IELTS_LINKERS,
  essayBodyParagraphs,
  essayCitationPolicy,
  essayEdgeWords,
  essayEpigraphPolicy,
  essayKindSpec,
  essayWords,
  type EssayContextSpec,
  type EssayKindSpec,
} from "./registry";
import type { EssayInput } from "./input";
import type { EssayWords } from "./types";

/* ────────────────────────── klişelar ────────────────────────── */

/**
 * Neytral ro'yxat (`report/filler.ts`) maqola/kurs ishi uchun yig'ilgan:
 * «bugungi kunda» unda BOR, lekin insho uchun tipik xulosa klişesi
 * («xulosa qilib aytganda») yo'q — u ilmiy matnda deyarli uchramaydi,
 * maktab inshosida esa deyarli har ikkinchisida. Neytral qatlamga
 * tegmasdan (u lead egaligida) insho ro'yxati shu yerda kengaytiriladi.
 */
export const ESSAY_FILLER_EXTRA: readonly string[] = [
  "xulosa qilib aytganda",
  "xulosa o‘rnida shuni aytish mumkin",
  "xulosa o'rnida shuni aytish mumkin",
  "yuqoridagilardan kelib chiqib",
  "har birimiz bilamizki",
  "подводя итог",
  "в заключение хочется сказать",
  "in conclusion it can be said",
  "all in all we can say",
];

export const ESSAY_FILLER: readonly string[] = [...FILLER_PHRASES, ...ESSAY_FILLER_EXTRA];

/* ────────────────────────── kontekst ────────────────────────── */

/** Dvigatel bosqichlari o'rtasida uzatiladigan kontekst. */
export type EssayCtx = {
  input: EssayInput;
  meta: DocMeta;
  context: EssayContextSpec;
  kind: EssayKindSpec;
  words: EssayWords;
  edges: { intro: [number, number]; conclusion: [number, number] };
  /** Tana bandlari soni (kirish/xulosadan tashqari). */
  bodyCount: number;
};

export function essayCtx(meta: DocMeta, input: EssayInput): EssayCtx {
  const context = ESSAY_CONTEXTS[input.context];
  const words = essayWords(input.context, { pages: input.pages, wordTarget: input.wordTarget });
  return {
    input,
    meta,
    context,
    kind: essayKindSpec(input.context, input.kind),
    words,
    edges: essayEdgeWords(input.context, words),
    bodyCount: essayBodyParagraphs(input.context, words),
  };
}

/** Bitta chaqiruvda yoziladigan eng katta insho (so'zning YUQORI chegarasi). */
export const ESSAY_SINGLE_CALL_WORDS = 1200;

/** Insho ikki qismda yozilishi kerakmi (5 varaqli maktab inshosi). */
export function essayNeedsTwoParts(ctx: EssayCtx): boolean {
  return ctx.words.max > ESSAY_SINGLE_CALL_WORDS;
}

/* ────────────────────────── hajm qatori ────────────────────────── */

/**
 * Hajm ko'rsatmasi — `article/prompts.ts lengthLine` naqshi va o'sha
 * jonli saboq: model o'zbek/rus so'zini KAM sanaydi va aytilgan
 * oraliqning pastki chetiga yozadi, shuning uchun mo'ljal 10 % yuqori
 * va «shubha bo'lsa ko'proq yoz» ochiq aytiladi.
 */
export function essayLengthLine(aim: number, range: [number, number], paragraphs: number): string {
  const per = Math.max(60, Math.round(aim / Math.max(1, paragraphs)));
  return [
    `Length: about ${Math.round(aim * 1.1)} words in ${paragraphs} paragraph${paragraphs > 1 ? "s" : ""} of roughly ${per}–${Math.round(per * 1.25)} words each`,
    `(count words as whitespace-separated tokens; models undercount Uzbek and Russian words, so when unsure write MORE).`,
    `Fewer than ${range[0]} or more than ${range[1]} words is unacceptable.`,
  ].join(" ");
}

/* ────────────────────────── tizim prompti ────────────────────────── */

function contextRules(ctx: EssayCtx): string[] {
  const c = ctx.context;
  const epigraph = essayEpigraphPolicy(c.id, ctx.kind.id);
  const citations = essayCitationPolicy(c.id, ctx.kind.id);
  const out: string[] = [
    `1. STRUCTURE: introduction – body – conclusion, ${c.paragraphs.min}–${c.paragraphs.max} paragraphs in total (${ctx.bodyCount} body paragraphs). The introduction is ${ctx.edges.intro[0]}–${ctx.edges.intro[1]} words and the conclusion ${ctx.edges.conclusion[0]}–${ctx.edges.conclusion[1]} words — each between 12 % and 20 % of the essay.`,
  ];
  out.push(
    c.thesisStatement
      ? `2. THESIS STATEMENT: the LAST sentence of the introduction is one explicit, arguable claim that the whole essay defends. It is not a question, not a definition and not an announcement of the topic.`
      : `2. The introduction leads the reader into the topic and ends with the thought the essay will develop; do not announce «in this essay I will…».`,
  );
  out.push(
    c.topicSentences
      ? `3. TOPIC SENTENCES: every body paragraph BEGINS with a topic sentence stating that paragraph's claim; the rest of the paragraph supports it and links back to the thesis.`
      : `3. Every paragraph develops ONE thought and connects to the next; no paragraph repeats another.`,
  );
  out.push(
    citations === "work_only"
      ? `4. QUOTATIONS: you may quote ONLY the passage of the literary work supplied below, verbatim, inside «…». Never invent a quotation, a line, a character, a date or a critic's opinion. If no passage is supplied, write without quotations.`
      : `4. NO SOURCES: this essay has no bibliography. Do not cite anyone, do not use bracketed reference markers ([1], [W…]), do not attribute statistics to studies.`,
  );
  out.push(
    `5. PERSON: write in the ${ctx.input.person === "first" ? "FIRST person (the author's own voice: «menimcha», «I believe») where the thought is personal" : "THIRD person, impersonal academic register — no «I think», no «we»"}.`,
  );
  if (epigraph === "optional" && ctx.input.epigraph) {
    out.push(`6. EPIGRAPH: the essay opens with the epigraph given below (quotation, then its author) — reproduce it verbatim; the epigraph does NOT count as a paragraph.`);
  }
  if (c.id === "ielts_task2") {
    out.push(
      `7. COHESION: use at least three different cohesive devices from the natural range (${IELTS_LINKERS.slice(0, 8).join(", ")}) — placed inside sentences, not mechanically at the start of every one.`,
      `8. No headings, no bullet points, no numbering: IELTS Task 2 is continuous prose.`,
    );
  }
  return out;
}

export function essaySystemPrompt(ctx: EssayCtx): string {
  const { input, context: c, kind } = ctx;
  const lines: string[] = [
    languageDirective(input.language),
    `You are ${roleOf(ctx)}. Write ONE complete essay in ${langInfo(input.language).name}.`,
    `Topic: «${input.topic}».`,
    `Essay context: ${c.label.en} — ${c.hint}. Essay type: ${kind.label.en} (${kind.id}).`,
    `RULES (strict):`,
    ...contextRules(ctx),
    `NO FILLER: never open a sentence or a paragraph with an empty formula such as ${ESSAY_FILLER.slice(0, 2).map((p) => `«${p}»`).join(", ")}, «${ESSAY_FILLER[5]}», «${ESSAY_FILLER_EXTRA[0]}». Every paragraph must carry a specific thought, image, example or argument.`,
    `NO INVENTED FACTS: do not write statistics, percentages, survey results, dates of events or named studies. Numbers may appear ONLY if they are present in USER FACTS below; everything else is stated qualitatively («ko‘pchilik», «so‘nggi yillarda sezilarli darajada»).`,
    `STYLE: no slogans, no praise of the topic in general terms, no repetition of the title inside the text, no meta-commentary about the essay itself.`,
    `OUTPUT: return ONLY the JSON requested — no markdown fences, no commentary.`,
    `TYPE RULES (${kind.label.en}):`,
    ...kind.guidance.map((g, i) => `${i + 1}. ${g}`),
  ];
  if (input.workTitle) lines.push(`LITERARY WORK: «${input.workTitle}» — the essay is about this work; use only what the passage below and general knowledge of the work support.`);
  if (input.epigraph?.text) lines.push(`EPIGRAPH (verbatim):\n«${input.epigraph.text}»${input.epigraph.author ? `\n— ${input.epigraph.author}` : ""}`);
  if (input.extra) lines.push(`Additional author requirements: ${input.extra}`);
  if (input.userFacts) {
    lines.push(`USER FACTS — the author's own thoughts, arguments, quotations or experience (reproduce every number, name and quotation VERBATIM; build the essay around them):\n--- FACTS ---\n${input.userFacts}\n--- END FACTS ---`);
  }
  if (input.sourceText) {
    lines.push(`SOURCE DOCUMENT uploaded by the author (context; use its facts and terms; do not copy verbatim):\n--- SOURCE ---\n${input.sourceText.slice(0, 12_000)}\n--- END SOURCE ---`);
  }
  lines.push(HONESTY_LIMIT);
  return lines.join("\n");
}

function roleOf(ctx: EssayCtx): string {
  switch (ctx.context.id) {
    case "school_dtm":
      return "an Uzbek language and literature teacher who writes model school essays for graduating pupils";
    case "academic":
      return "a university writing tutor who writes model academic essays";
    default:
      return "an IELTS writing tutor who produces band 8 model answers for Writing Task 2";
  }
}

/* ────────────────────────── reja ────────────────────────── */

/**
 * Paragraf rejasi: sarlavha, thesis statement (kerak bo'lsa), har
 * bandning roli, topic sentence i va bir jumlalik mo'ljali. Reja
 * `EssayModel.paragraphs` ga tushadi — hisobot `topicSentences` qoidasi
 * va sayqal ko'rsatmalari shundan o'qiydi.
 */
export function outlinePrompt(ctx: EssayCtx): string {
  const c = ctx.context;
  const total = ctx.bodyCount + 2;
  const lines = [
    `Plan the essay before writing it.`,
    `Give a TITLE for the essay in ${langInfo(ctx.input.language).name}: a short noun phrase specific to the topic (not the bare topic string, not a sentence).`,
  ];
  if (c.thesisStatement) {
    lines.push(`Give the THESIS STATEMENT: one arguable sentence (12–35 words) that the essay will defend; it will be the last sentence of the introduction.`);
  }
  lines.push(
    `Plan ${total} paragraphs: 1 «intro», ${ctx.bodyCount} «body», 1 «conclusion».`,
    c.topicSentences
      ? `For every «body» paragraph write its TOPIC SENTENCE (the first sentence of that paragraph — a claim, not a question) and a one-sentence «brief» of the support it will give.`
      : `For every paragraph write a one-sentence «brief»: what exactly this paragraph will say for THIS topic (specific, not generic).`,
    `Paragraph word budgets must sum to about ${ctx.words.aim}; the introduction gets ${ctx.edges.intro[0]}–${ctx.edges.intro[1]} and the conclusion ${ctx.edges.conclusion[0]}–${ctx.edges.conclusion[1]}.`,
    `The conclusion must NOT repeat the introduction: plan a different move (consequence, personal position, open question, call to the reader).`,
    `Return JSON: {"title":"…"${c.thesisStatement ? ',"thesisStatement":"…"' : ""},"paragraphs":[{"id":"p1","role":"intro"|"body"|"conclusion"${c.topicSentences ? ',"topicSentence":"…"' : ""},"brief":"…","words":120}]}`,
  );
  return lines.join("\n");
}

/* ────────────────────────── insho matni ────────────────────────── */

export type EssayPart = "all" | "head" | "tail";

/** Reja qatori — dvigatel `outlinePrompt` javobidan to'ldiradi. */
export type EssayParagraphPlan = {
  id: string;
  role: "intro" | "body" | "conclusion";
  topicSentence?: string;
  brief: string;
  words: number;
};

function planLines(plans: EssayParagraphPlan[]): string[] {
  return plans.map((p, i) => `  ${i + 1}. [${p.role}] ${p.topicSentence ? `topic sentence: «${p.topicSentence}» — ` : ""}${p.brief} (~${p.words} words)`);
}

/**
 * Butun insho (yoki uning yarmi) bitta chaqiruvda. Qism bo'yicha yozilganda
 * (`head`/`tail`) modelga allaqachon yozilgan matn BERILADI — jonli
 * sinovda (maqola `expandPrompt`) usiz model boshidan qayta yozib,
 * paragraf takrorlanardi.
 */
export function essayPrompt(ctx: EssayCtx, plans: EssayParagraphPlan[], o: { part?: EssayPart; thesisStatement?: string; title?: string; written?: string } = {}): string {
  const part = o.part ?? "all";
  const aim = plans.reduce((n, p) => n + p.words, 0) || ctx.words.aim;
  const range: [number, number] =
    part === "all" ? [ctx.words.min, ctx.words.max] : [Math.round(aim * 0.8), Math.round(aim * 1.25)];
  const lines = [
    part === "all"
      ? `Write the WHOLE essay «${o.title || ctx.input.topic}» now, following the plan below exactly.`
      : part === "head"
        ? `Write the FIRST part of the essay «${o.title || ctx.input.topic}»: the introduction and the body paragraphs listed below. Do NOT write the conclusion — it is written separately.`
        : `Write the REMAINING part of the essay «${o.title || ctx.input.topic}»: the body paragraphs listed below and the conclusion. Do NOT rewrite or summarise what is already written; continue it seamlessly and never repeat a sentence from it.`,
    `Plan:`,
    ...planLines(plans),
  ];
  if (o.thesisStatement) {
    lines.push(
      part === "tail"
        ? `The thesis defended by the essay: «${o.thesisStatement}» — the conclusion must return to it without repeating it word for word.`
        : `THESIS STATEMENT (use it verbatim as the LAST sentence of the introduction): «${o.thesisStatement}»`,
    );
  }
  lines.push(essayLengthLine(aim, range, plans.length));
  if (o.written) lines.push(`ALREADY WRITTEN (for continuity — do not repeat, rephrase or summarise it):\n${o.written.slice(0, 8000)}`);
  lines.push(
    `Write continuous prose: no headings, no numbering, no bullet lists — one JSON block per paragraph, in order.`,
    `Return JSON: {"blocks":[{"kind":"p","text":"…"}]}`,
  );
  return lines.join("\n");
}

/**
 * Hajm to'g'ri chiqmaganda bir marta qayta so'rov (`article/prompts.ts
 * wordRangePrompt` naqshi): matn QAYTA yoziladi, faktlar va epigraf
 * o'zgarmaydi.
 */
export function wordRangePrompt(ctx: EssayCtx, have: number, range: [number, number], current: string): string {
  const short = have < range[0];
  const aim = short ? Math.round(range[0] + (range[1] - range[0]) * 0.6) : Math.round((range[0] + range[1]) / 2);
  return [
    `The essay you wrote is ${short ? "too short" : "too long"}: ${have} whitespace-separated words, the required range is ${range[0]}–${range[1]}.`,
    `Rewrite the WHOLE essay to about ${aim} words — ${short ? `add substantive development (a new example, a counter-argument, a deeper explanation); you were ${range[0] - have} words short, so add at least ${Math.round((range[0] - have) * 1.5)} words of NEW content, never padding or repetition` : "cut repetition and empty sentences, keep every specific thought, example and user fact"}.`,
    `Keep the structure, the ${ctx.context.thesisStatement ? "thesis statement, " : ""}every USER FACT verbatim and the same language.`,
    `CURRENT ESSAY:\n${current.slice(0, 12_000)}`,
    `Return JSON: {"blocks":[{"kind":"p","text":"…"}]}`,
  ].join("\n");
}

/* ────────────────────────── qayta yozish (sayqal / «Tuzatish») ────────────────────────── */

export type EssayRewriteTarget = "essay" | "intro" | "conclusion";

/**
 * «Tuzatish» va avto-sayqal prompti. Nishon butun insho yoki uning
 * chekkasi (kirish/xulosa) — insho kichik matn, shuning uchun eng
 * ishonchli yo'l butunini qayta yozish; chekka nishonda esa faqat o'sha
 * band almashadi va qolgani VERBATIM qaytariladi.
 */
export function rewritePrompt(ctx: EssayCtx, target: EssayRewriteTarget, instruction: string, current: string): string {
  const scope =
    target === "essay"
      ? `Rewrite the WHOLE essay according to the editor's instruction.`
      : target === "intro"
        ? `Rewrite ONLY the introduction (the first paragraph${ctx.input.epigraph ? ", keeping the epigraph unchanged" : ""}) according to the editor's instruction, then return the whole essay with the other paragraphs VERBATIM.`
        : `Rewrite ONLY the conclusion (the last paragraph) according to the editor's instruction, then return the whole essay with the other paragraphs VERBATIM.`;
  return [
    scope,
    `EDITOR INSTRUCTION (highest priority): ${instruction}`,
    `Keep the essay's language, its ${ctx.context.thesisStatement ? "thesis statement, " : ""}structure and every USER FACT verbatim; do not add statistics, sources or quotations that are not already there.`,
    essayLengthLine(ctx.words.aim, [ctx.words.min, ctx.words.max], Math.max(3, ctx.bodyCount + 2)),
    `CURRENT ESSAY:\n${current.slice(0, 12_000)}`,
    HONESTY_LIMIT,
    `Return JSON: {"blocks":[{"kind":"p","text":"…"}]}`,
  ].join("\n");
}

/* ────────────────────────── baholovchi ────────────────────────── */

/** Baholovchiga beriladigan matn (`review.ts` `sampleForJudge` bilan kesadi). */
export function judgeHeader(ctx: { topic: string; context: string; kind: string; language: string; words: number }): string {
  return [`TITLE: ${ctx.topic}`, `CONTEXT: ${ctx.context} · TYPE: ${ctx.kind} · LANGUAGE: ${ctx.language} · WORDS: ${ctx.words}`].join("\n");
}
