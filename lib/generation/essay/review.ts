/**
 * INSHO TAYYORLIK HISOBOTI (AUDIT-19 WP-D) — `reviewEssay`.
 *
 * Ikki qatlam (maqoladagi naqsh, `article/review.ts`):
 *   1. QOIDALAR — deterministik: hajm, bandlar soni va kirish/xulosa
 *      ulushi, thesis statement, topic sentence lar, klişe, takror,
 *      manbasiz statistika, shaxs, epigraf/asar iqtibosi, bog'lovchilar
 *      (IELTS), sarlavha. Yorliqlar O'ZBEKCHA (interfeys tili).
 *   2. BAHOLOVCHI — `judge` roli, kontekst mezonlari bilan
 *      (`registry.ts` `JudgeSpec`): DTM 5, akademik 5, IELTS 4.
 *
 * BALL — `rubric.ts essayScore` (vaznlar BITTA joyda): maktab va IELTS
 * da rubrika ustun (baholovchi 0.6), akademik esse da qoidalar 0.6.
 *
 * Izomorf: DOM/server importi yo'q; LLM chaqiruvi dependensiya
 * (`opts.complete`) sifatida keladi.
 */
import type { AcademicDoc, Block, DocSection } from "../types";
import type { complete as completeRole, LlmUsage } from "../llm-roles";
import { remainingMs } from "../quality";
import { JUDGE_MIN_MS, JUDGE_NO_ANSWER, JUDGE_TIMEOUT_MS, judgeSystemPromptFor, neutralJudgeFor, parseJudgeFor } from "../report/judge";
import { check, jaccard, langKey, rewrite, trigrams } from "../report/score";
import { sampleForJudge } from "../report/text";
import { wordsOf } from "../report/guard";
import type { DocReview, ReviewCheck, ReviewGuardInput } from "../report/types";
import { ESSAY_CONTEXTS, IELTS_LINKERS, essayCitationPolicy, essayEpigraphPolicy, essayKindSpec, essayWords } from "./registry";
import { ESSAY_FILLER, judgeHeader } from "./prompts";
import { essayJudgeDetail, essayRubric, essayScore, type EssayJudge } from "./rubric";
import { ESSAY_LIMITS, type EssayContextId, type EssayModel } from "./types";

export type CompleteFn = typeof completeRole;

export type EssayReviewOpts = {
  complete?: CompleteFn;
  deadline?: number;
  /** `false` — baholovchi chaqirilmaydi (neytral ball, izohsiz). */
  judge?: boolean;
  now?: Date;
  onUsage?: (u: LlmUsage) => void;
  /** Dvigateldan: hujjatdan qayta hisoblab bo'lmaydigan qism. */
  guard?: ReviewGuardInput;
};

/** Baholovchiga beriladigan matn shundan oshmaydi. */
export const JUDGE_TEXT_CHARS = 16_000;
/** Bandlar o'zaro takror deb hisoblanadigan 3-gram Jaccard chegarasi. */
export const REPETITION_JACCARD = 0.2;
/** IELTS: kamida shuncha XIL bog'lovchi. */
export const LINKERS_MIN = 3;

export const ESSAY_RULE_IDS = [
  "words",
  "paragraphs",
  "thesisStatement",
  "topicSentences",
  "filler",
  "repetition",
  "unsourcedNumbers",
  "person",
  "epigraph",
  "workQuote",
  "linking",
  "title",
] as const;

export type EssayRuleId = (typeof ESSAY_RULE_IDS)[number];

/** `fix` nishonlari — butun insho yoki uning chekkasi. */
export const ESSAY_TARGETS = ["essay", "intro", "conclusion"] as const;

/* ────────────────────────── model va matn ────────────────────────── */

/**
 * Eski inshoda (`writeEssayWithLlm`) `doc.essay` yo'q — hisobot baribir
 * ishlaydi: kontekst maktab inshosi, hajm `meta.targetPages` dan.
 */
export function essayModelOf(doc: AcademicDoc): EssayModel {
  if (doc.essay) return doc.essay;
  const pages = Math.max(ESSAY_LIMITS.pagesMin, Math.min(ESSAY_LIMITS.pagesMax, Math.round(doc.meta.targetPages || 2)));
  return {
    v: 1,
    context: "school_dtm",
    kind: "reflective",
    language: langKey(doc.meta.language),
    words: essayWords("school_dtm", { pages }),
    paragraphs: [],
    rubric: "dtm24",
    ...(doc.meta.design ? { design: doc.meta.design } : {}),
  };
}

/** Insho bo'limi — yangi hujjatda `essay`, eskisida birinchi to'ldirilgan. */
export function essaySection(doc: AcademicDoc): DocSection | null {
  return doc.sections.find((s) => s.id === "essay" && s.blocks.length) ?? doc.sections.find((s) => s.blocks.length) ?? null;
}

export type EssayText = {
  /** Epigrafsiz bandlar (matn). */
  paragraphs: string[];
  /** Epigraf bloki (bo'lsa). */
  epigraph: string | null;
  words: number;
  title: string;
};

const TEXT_KINDS = new Set<Block["kind"]>(["p", "li", "quote"]);

/**
 * Hujjat matni bandlarga ajratiladi. Epigraf — model epigrafi bilan
 * mos keladigan BIRINCHI `quote` bloki: u band sifatida sanalmaydi
 * (hajm, ulush va takror hisobidan chiqadi).
 */
export function essayTextOf(doc: AcademicDoc, model: EssayModel): EssayText {
  const live = doc.sections.filter((s) => s.blocks.length);
  const blocks: Block[] = live.flatMap((s) => s.blocks.filter((b) => TEXT_KINDS.has(b.kind)));
  let epigraph: string | null = null;
  const rest = blocks.slice();
  const head = rest[0];
  if (model.epigraph?.text && head && head.kind === "quote" && head.text.includes(model.epigraph.text.slice(0, 24))) {
    epigraph = head.text;
    rest.shift();
  }
  return {
    paragraphs: rest.map((b) => b.text.trim()).filter(Boolean),
    epigraph,
    words: wordsOf(rest),
    title: essaySection(doc)?.title?.trim() ?? "",
  };
}

/* ────────────────────────── kichik yordamchilar ────────────────────────── */

const WORD_RE = /\S+/g;
const wc = (s: string) => (s.match(WORD_RE) ?? []).length;
const pct = (x: number) => `${Math.round(x * 100)}%`;
const list = (xs: string[], max = 5) => (xs.length > max ? `${xs.slice(0, max).join(", ")} … (+${xs.length - max})` : xs.join(", "));

/** Jumlalarga ajratish — o'zbek/rus/ingliz nuqtalari. */
export function sentencesOf(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Da'vo jumlasimi: savol emas, juda qisqa/uzun emas, ro'yxat emas. */
export function isClaimSentence(s: string, min = 6, max = 45): boolean {
  const t = s.trim();
  if (!t || t.endsWith("?")) return false;
  const n = wc(t);
  return n >= min && n <= max;
}

/** Manbasiz statistika: «12 %», «4,6 foiz», «30 percent» (foydalanuvchi faktida yo'q). */
const STAT_RE = /(\d+(?:[.,]\d+)?)\s*(%|foizi?|процент\w*|percent)/giu;

export function unsourcedStats(text: string, userFacts: string | undefined): string[] {
  const facts = (userFacts ?? "").replace(/\s+/g, " ");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  STAT_RE.lastIndex = 0;
  while ((m = STAT_RE.exec(text))) {
    const num = m[1].replace(",", ".");
    if (facts.includes(m[1]) || facts.includes(num)) continue;
    out.push(`${m[1]} ${m[2]}`.trim());
  }
  return out;
}

/** 1-shaxs belgilari (uz/ru/en) — «shaxs» qoidasi uchun. */
export const FIRST_PERSON_RE =
  /(?<![\p{L}])(men|menimcha|menga|mening|o[‘’'`]ylaymanki|fikrimcha|nazarimda|я|мне|моё|мой|по-моему|считаю|i|me|my|mine|we|our)(?![\p{L}])/iu;

/* ────────────────────────── qoidalar ────────────────────────── */

export type EssayRuleInput = {
  doc: AcademicDoc;
  model: EssayModel;
  text: EssayText;
};

export function ruleChecks(o: EssayRuleInput): ReviewCheck[] {
  const { model, text } = o;
  const c = ESSAY_CONTEXTS[model.context];
  const kind = essayKindSpec(model.context, model.kind);
  const words = model.words;
  const paras = text.paragraphs;
  const out: ReviewCheck[] = [];

  /* ── words: hajm oralig'i ── */
  {
    const n = text.words;
    const d = `${n} so‘z (kerak ${words.min}–${words.max})`;
    if (n >= words.min && n <= words.max) out.push(check("words", "green", "Hajm", d));
    else {
      const far = n < words.min * 0.9 || n > words.max * 1.1;
      out.push(
        check(
          "words",
          far ? "red" : "yellow",
          "Hajm",
          d,
          rewrite("essay", n < words.min ? `Expand the essay to ${words.min}–${words.max} words by developing the existing thoughts (new example, counter-argument, deeper explanation) — no padding.` : `Condense the essay to ${words.min}–${words.max} words: remove repetition and empty sentences, keep every specific thought.`),
        ),
      );
    }
  }

  /* ── paragraphs: soni + kirish/xulosa ulushi ── */
  {
    const n = paras.length;
    const introW = paras.length ? wc(paras[0]) : 0;
    const concW = paras.length > 1 ? wc(paras[paras.length - 1]) : 0;
    const share = (w: number) => (text.words ? w / text.words : 0);
    const bad = (w: number, span: [number, number]) => share(w) < span[0] || share(w) > span[1];
    const introBad = bad(introW, c.introShare);
    const concBad = bad(concW, c.conclusionShare);
    const shareText = `kirish ${pct(share(introW))}, xulosa ${pct(share(concW))} (kerak ${pct(c.introShare[0])}–${pct(c.introShare[1])})`;
    if (n < c.paragraphs.min || n > c.paragraphs.max) {
      out.push(
        check("paragraphs", n < c.paragraphs.min ? "red" : "yellow", "Bandlar", `${n} band (kerak ${c.paragraphs.min}–${c.paragraphs.max}); ${shareText}`, rewrite("essay", `Restructure the essay into ${c.paragraphs.min}–${c.paragraphs.max} paragraphs: one introduction, ${c.paragraphs.min - 2}–${c.paragraphs.max - 2} body paragraphs and one conclusion, each developing a single thought.`)),
      );
    } else if (introBad || concBad) {
      out.push(
        check("paragraphs", "yellow", "Bandlar", `${n} band; ${shareText}`, rewrite(introBad ? "intro" : "conclusion", `Rewrite the ${introBad ? "introduction" : "conclusion"} so that it is ${pct(c.introShare[0])}–${pct(c.introShare[1])} of the essay (about ${Math.round(((c.introShare[0] + c.introShare[1]) / 2) * (text.words || words.aim))} words), without repeating the other paragraphs.`)),
      );
    } else out.push(check("paragraphs", "green", "Bandlar", `${n} band; ${shareText}`));
  }

  /* ── thesisStatement: kirishning oxirgi jumlasi — da'vo ── */
  if (c.thesisStatement) {
    const intro = paras[0] ?? "";
    const last = sentencesOf(intro).pop() ?? "";
    const declared = model.thesisStatement?.trim();
    const inText = declared ? intro.includes(declared.slice(0, Math.min(40, declared.length))) : false;
    if (!intro) out.push(check("thesisStatement", "red", "Thesis statement", "Kirish yo‘q", rewrite("intro", "Write an introduction that ends with an explicit, arguable thesis statement.")));
    else if (isClaimSentence(last, 8, 45) && (!declared || inText)) out.push(check("thesisStatement", "green", "Thesis statement", `«${last.slice(0, 120)}»`));
    else {
      out.push(
        check(
          "thesisStatement",
          "red",
          "Thesis statement",
          last ? `Kirishning oxirgi jumlasi aniq da'vo emas: «${last.slice(0, 120)}»` : "Kirishning oxirgi jumlasi topilmadi",
          rewrite("intro", "Rewrite the introduction so that its LAST sentence is one explicit, arguable thesis statement (12–35 words, not a question, not a definition) that the essay defends."),
        ),
      );
    }
  }

  /* ── topicSentences: har tana bandi da'vo bilan boshlanadi ── */
  if (c.topicSentences) {
    const body = paras.slice(1, -1);
    const weak = body.filter((p) => !isClaimSentence(sentencesOf(p)[0] ?? "", 5, 45));
    if (!body.length) out.push(check("topicSentences", "red", "Topic sentence", "Tana bandlari yo‘q", rewrite("essay", "Write body paragraphs, each opening with a topic sentence.")));
    else if (!weak.length) out.push(check("topicSentences", "green", "Topic sentence", `${body.length} ta tana bandining hammasi da'vo bilan boshlanadi`));
    else
      out.push(
        check("topicSentences", weak.length > body.length / 2 ? "red" : "yellow", "Topic sentence", `${weak.length}/${body.length} band da'vo bilan boshlanmaydi`, rewrite("essay", "Rewrite the body paragraphs so that EACH begins with a topic sentence — a claim (not a question, not a general statement about the topic) that the rest of the paragraph supports.")),
      );
  }

  /* ── filler: klişelar ── */
  {
    const low = paras.join("\n").toLowerCase();
    const hits = ESSAY_FILLER.filter((f) => low.includes(f));
    const note = c.rubric === "dtm24" ? " — DTM «ijodiylik» mezonini pasaytiradi" : "";
    if (!hits.length) out.push(check("filler", "green", "Klişe iboralar", "Shablon ibora topilmadi"));
    else
      out.push(
        check("filler", hits.length >= 3 ? "red" : "yellow", "Klişe iboralar", `${list(hits)}${note}`, rewrite("essay", `Remove the cliché openers (${hits.slice(0, 4).join("; ")}) and replace each with a concrete thought, image or example; keep the meaning and the length.`)),
      );
  }

  /* ── repetition: bandlar o'zaro takror (3-gram) ── */
  {
    const grams = paras.map((p) => trigrams(p));
    const pairs: string[] = [];
    let worst = 0;
    for (let i = 0; i < grams.length; i++) {
      for (let j = i + 1; j < grams.length; j++) {
        const v = jaccard(grams[i], grams[j]);
        if (v > worst) worst = v;
        if (v >= REPETITION_JACCARD) pairs.push(`${i + 1}↔${j + 1} (${pct(v)})`);
      }
    }
    out.push(
      pairs.length
        ? check("repetition", pairs.length > 1 ? "red" : "yellow", "Takrorlar", `Bandlar bir-birini takrorlaydi: ${list(pairs)}`, rewrite("essay", "Remove the repetition between paragraphs: each paragraph must carry a different thought; the conclusion must not restate the introduction in other words."))
        : check("repetition", "green", "Takrorlar", `Eng yuqori o‘xshashlik ${pct(worst)}`),
    );
  }

  /* ── unsourcedNumbers: faktsiz statistika ── */
  {
    const hits = paras.flatMap((p) => unsourcedStats(p, model.userFacts));
    out.push(
      hits.length
        ? check("unsourcedNumbers", "red", "Manbasiz statistika", `Foydalanuvchi faktlarida yo‘q raqamlar: ${list([...new Set(hits)])}`, rewrite("essay", "Remove every statistic and percentage that is not in USER FACTS; state the point qualitatively instead. Do not attribute numbers to studies."))
        : check("unsourcedNumbers", "green", "Manbasiz statistika", "Uydirma raqam topilmadi"),
    );
  }

  /* ── person: forma tanlagan (yoki kontekst standarti) shaxs ── */
  {
    const body = paras.join(" ");
    const hasFirst = FIRST_PERSON_RE.test(body);
    const person = model.person ?? c.person;
    if (person === "third" && hasFirst) {
      out.push(check("person", "yellow", "Bayon shaxsi", "Akademik esse 3-shaxsda yoziladi, matnda 1-shaxs belgilari bor", rewrite("essay", "Rewrite in impersonal third person: remove «men/menimcha/I think/we» constructions, keep every idea.")));
    } else if (person === "first" && !hasFirst) {
      out.push(check("person", "yellow", "Bayon shaxsi", "Insho shaxsiy ovozsiz — muallif munosabati ko‘rinmayapti", rewrite("essay", "Add the author's own voice: state the personal position explicitly at least in the body and the conclusion (first person), keeping the structure.")));
    } else out.push(check("person", "green", "Bayon shaxsi", person === "first" ? "Shaxsiy ovoz bor" : "3-shaxs saqlangan"));
  }

  /* ── epigraph: adabiy inshoda epigraf ── */
  if (essayEpigraphPolicy(model.context, model.kind) === "optional") {
    out.push(
      text.epigraph
        ? check("epigraph", "green", "Epigraf", `«${text.epigraph.slice(0, 90)}»`)
        : check("epigraph", "yellow", "Epigraf", "Adabiy inshoda epigraf kutiladi — o‘zingiz tanlagan iqtibosni kiriting"),
    );
  }

  /* ── workQuote: asar va undan iqtibos ── */
  if (essayCitationPolicy(model.context, model.kind) === "work_only") {
    const body = paras.join("\n");
    const quoted = /[«"“][^»"”]{20,}[»"”]/u.test(body);
    const named = Boolean(model.workTitle?.trim()) && body.toLowerCase().includes(model.workTitle!.trim().toLowerCase().slice(0, 12));
    if (!model.workTitle?.trim()) out.push(check("workQuote", "yellow", "Asar va iqtibos", "Asar nomi berilmagan — tahlil umumiy chiqadi"));
    else if (quoted && named) out.push(check("workQuote", "green", "Asar va iqtibos", `«${model.workTitle}» nomi va iqtibos matnda bor`));
    else
      out.push(
        check("workQuote", "yellow", "Asar va iqtibos", quoted ? `«${model.workTitle}» matnda tilga olinmagan` : "Asardan iqtibos keltirilmagan", rewrite("essay", `Name the work «${model.workTitle}» explicitly and analyse one verbatim quotation from the passage supplied by the author (in «…»); do NOT invent a quotation if none was supplied.`)),
      );
  }

  /* ── linking: IELTS bog'lovchilari ── */
  if (model.context === "ielts_task2") {
    const low = paras.join(" ").toLowerCase();
    const found = IELTS_LINKERS.filter((w) => low.includes(w));
    out.push(
      found.length >= LINKERS_MIN
        ? check("linking", "green", "Bog‘lovchilar", `${found.length} xil: ${list(found)}`)
        : check("linking", found.length ? "yellow" : "red", "Bog‘lovchilar", `${found.length} xil (kerak ≥ ${LINKERS_MIN})`, rewrite("essay", `Use at least ${LINKERS_MIN} different cohesive devices (however, moreover, as a result, for instance, in contrast) inside the sentences — not mechanically at the start of every sentence.`)),
    );
  }

  /* ── title: sarlavha ── */
  {
    const t = text.title;
    const n = wc(t);
    if (!t) out.push(check("title", "red", "Sarlavha", "Insho sarlavhasi yo‘q"));
    else if (n > 14 || t.endsWith(".")) out.push(check("title", "yellow", "Sarlavha", `Sarlavha jumlaga o‘xshaydi: «${t.slice(0, 90)}»`));
    else out.push(check("title", "green", "Sarlavha", `«${t}»${kind.needsWork && model.workTitle ? ` · asar: «${model.workTitle}»` : ""}`));
  }

  return out;
}

/* ────────────────────────── baholovchi ────────────────────────── */

export function judgeUserPrompt(doc: AcademicDoc, model: EssayModel, maxChars = JUDGE_TEXT_CHARS): string {
  const text = essayTextOf(doc, model);
  const groups = text.paragraphs.map((p, i) => ({ id: `p${i + 1}`, title: i === 0 ? "introduction" : i === text.paragraphs.length - 1 ? "conclusion" : `body ${i}`, lines: [p] }));
  const body = sampleForJudge(groups, maxChars)
    .map((g) => `[${g.title}] ${g.text}${g.truncated ? " […truncated]" : ""}`)
    .join("\n\n");
  return [
    judgeHeader({ topic: text.title || doc.meta.topic, context: model.context, kind: model.kind, language: model.language, words: text.words }),
    model.thesisStatement ? `THESIS STATEMENT: ${model.thesisStatement}` : "",
    text.epigraph ? `EPIGRAPH: ${text.epigraph}` : "",
    "",
    "ESSAY:",
    body || "(empty)",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Baholovchi mezonlari → `ReviewCheck` (IELTS da detal «Band 7 · 2/3»). */
export function essayJudgeChecks(context: EssayContextId, j: EssayJudge): ReviewCheck[] {
  const spec = ESSAY_CONTEXTS[context].judge;
  const rubric = essayRubric(context);
  const skip = new Set<string>(j.skipped ?? []);
  const out: ReviewCheck[] = rubric.criteria
    .filter((c) => !skip.has(c))
    .map((c) => check(`judge:${c}`, j[c] >= 3 ? "green" : j[c] === 2 ? "yellow" : "red", spec.labels[c] ?? c, essayJudgeDetail(context, c, j[c])));
  j.fixes.forEach((f, i) => out.push(check(`judge:fix:${i + 1}`, "yellow", "Baholovchi tavsiyasi", `${f.target}: ${f.instruction}`, { op: "rewrite", target: f.target, instruction: f.instruction })));
  return out;
}

export function essayJudgeSystemPrompt(context: EssayContextId, kindLabel?: string): string {
  const spec = ESSAY_CONTEXTS[context].judge;
  return judgeSystemPromptFor({ ...spec, ...(kindLabel ? { typeLabel: kindLabel } : {}) }, ["essay"], ["intro", "conclusion"]);
}

export function parseEssayJudge(context: EssayContextId, raw: string | null | undefined): EssayJudge | null {
  return parseJudgeFor(ESSAY_CONTEXTS[context].judge, raw, ["essay"], ["intro", "conclusion"]);
}

export function neutralEssayJudge(context: EssayContextId): EssayJudge {
  return neutralJudgeFor(ESSAY_CONTEXTS[context].judge);
}

/* ────────────────────────── asosiy ────────────────────────── */

export async function reviewEssay(doc: AcademicDoc, opts: EssayReviewOpts = {}): Promise<DocReview> {
  const now = opts.now ?? new Date();
  const model = essayModelOf(doc);
  const text = essayTextOf(doc, model);
  const rules = ruleChecks({ doc, model, text });

  // Dvigatel bergan, hujjatdan qayta hisoblab bo'lmaydigan qism.
  const emptySections = opts.guard?.emptySections ?? [];
  if (emptySections.length) rules.push(check("empty", "red", "Bo‘sh matn", `Bo‘lim bo‘sh qoldi: ${list(emptySections)}`));

  let judge: EssayJudge | null = null;
  const judgeNotes: string[] = [...essayRubric(model.context).notes];
  if (opts.judge !== false && opts.complete) {
    const timeoutMs = Math.min(JUDGE_TIMEOUT_MS, remainingMs(opts.deadline));
    if (timeoutMs >= JUDGE_MIN_MS) {
      try {
        const kind = essayKindSpec(model.context, model.kind);
        const r = await opts.complete("judge", essayJudgeSystemPrompt(model.context, kind.label.en), judgeUserPrompt(doc, model), { json: true, deadline: opts.deadline, maxTokens: 1200, timeoutMs });
        if (r?.usage) opts.onUsage?.(r.usage);
        judge = parseEssayJudge(model.context, r?.text);
      } catch (e) {
        console.warn("[essay] baholovchi xatosi:", e instanceof Error ? e.message : e);
      }
    }
    if (!judge) judgeNotes.push(JUDGE_NO_ANSWER);
  }
  const j = judge ?? neutralEssayJudge(model.context);
  judgeNotes.push(...j.notes);

  return {
    score: essayScore(rules, j, model.context),
    checks: [...rules, ...essayJudgeChecks(model.context, j)],
    judgeNotes,
    verifiedShare: 1,
    recentShare: 1,
    builtAt: now.toISOString(),
  };
}
