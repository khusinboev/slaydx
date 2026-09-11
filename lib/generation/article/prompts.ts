/**
 * Maqola promptlari (Maqola 2, AUDIT-17).
 *
 * Ko'rsatmalar INGLIZCHA, birinchi qator `languageDirective` (tarjima va
 * rezyume dvigatellari bilan bir qaror): tuzilma qoidalarini — JSON
 * sxemasi, id bilan iqtibos, VERBATIM faktlar — model inglizcha
 * ko'rsatmada ishonchliroq bajaradi; chiqish tilini esa birinchi qator
 * qat'iy belgilaydi.
 *
 * Uch TAQIQ shu yerda qulflanadi (testda `assert.match` bilan):
 *   • manba/DOI/muallif o'ylab topish — iqtibos FAQAT berilgan `[W…]` id;
 *   • manbasiz raqam (`\d+%`, n=, p-value) — faqat manba yoki foydalanuvchi
 *     faktidan;
 *   • «suv» iboralar (`FILLER_PHRASES`).
 * Qo'riqchi (`guard.ts`) va tekshiruv (`research/verify.ts`) shu qoidalarni
 * generatsiyadan KEYIN ham tekshiradi — prompt yolg'iz kafolat emas.
 *
 * `judge`/`rewrite` promptlari bu faylda YO'Q — WP5/WP7.
 */
import { languageDirective, langInfo } from "../i18n";
import type { DocMeta } from "../types";
import type { ArticleType, PublicationProfile, Reference } from "./types";
import { articleLabels, type ArticleDocLabels } from "./labels";
import type { ArticleInput } from "./input";
import type { OpenAlexWork } from "../research/openalex";

/** Dvigatel bosqichlari o'rtasida uzatiladigan kontekst. */
export type ArticleContext = {
  input: ArticleInput;
  meta: DocMeta;
  type: ArticleType;
  profile: PublicationProfile;
  labels: ArticleDocLabels;
  /** Butun maqola tanasi uchun so'z maqsadi (annotatsiyasiz). */
  wordTarget: number;
  refs: Reference[];
};

/** Bo'lim rejasi — outline bosqichi natijasi. */
export type SectionPlan = {
  id: string;
  /** Skelet kaliti (`body-2` → `body`). */
  skeletonId: string;
  title: string;
  brief: string;
  words: number;
  hard: boolean;
};

/**
 * «Suv» iboralar — uch tilda. Promptda taqiqlanadi, qo'riqchi hisoblaydi
 * (o'chirmaydi — hisobot uchun). Ro'yxat qisqa va aniq: keng qolip
 * («muhim») jonli nasrni ham ushlab qolardi.
 */
export const FILLER_PHRASES: readonly string[] = [
  "bugungi kunda",
  "ma’lumki",
  "ma'lumki",
  "shuni ta’kidlash joizki",
  "shuni ta'kidlash joizki",
  "hozirgi vaqtda",
  "muhim rol o‘ynaydi",
  "muhim rol o'ynaydi",
  "в настоящее время",
  "как известно",
  "следует отметить",
  "играет важную роль",
  "in today's world",
  "in today’s world",
  "it is worth noting",
  "it is well known",
  "plays a crucial role",
  "in the modern era",
];

/** `[ID] Muallif va b. (yil). Sarlavha. Venue.` — promptdagi manba qatori. */
export function formatRefLine(r: Reference & { abstract?: string }, withAbstract = false): string {
  const authors = r.authors.length ? (r.authors.length > 3 ? `${r.authors.slice(0, 3).join(", ")} et al.` : r.authors.join(", ")) : "—";
  const head = `[${r.id}] ${authors} (${r.year ?? "n.d."}). ${r.title}.${r.venue ? ` ${r.venue}.` : ""}${r.doi ? ` doi:${r.doi}` : ""}`;
  return withAbstract && r.abstract ? `${head}\n    Abstract: ${r.abstract}` : head;
}

function locatorExample(lang: string): string {
  return lang === "ru" ? "[W2741809807; с. 25]" : lang === "en" ? "[W2741809807; p. 25]" : "[W2741809807; 25-b.]";
}

function typeLine(t: ArticleType, L: ArticleDocLabels): string {
  const skel = t.skeleton.map((s) => `${s.id}=«${L.section[s.titleKey]}» (${s.sharePct}%${s.required ? "" : ", optional"})`).join("; ");
  const extra: string[] = [];
  if (t.freeSections) extra.push(`the «body» part is ${t.freeSections.min}–${t.freeSections.max} topic-specific named sections`);
  if (t.wordRange) extra.push(`total body length ${t.wordRange[0]}–${t.wordRange[1]} words`);
  if (t.requiresPrisma) extra.push("a PRISMA flow diagram is mandatory in Results");
  if (t.requiresTimeline) extra.push("a Timeline table is mandatory (CARE)");
  if (t.numberedHeadings) extra.push("headings will be numbered 1., 1.1. by the renderer — do not number them yourself");
  return `Article type: ${t.label.en} (${t.id}). Skeleton: ${skel}.${extra.length ? ` Notes: ${extra.join("; ")}.` : ""}`;
}

/**
 * Tizim prompti — barcha yozuv chaqiruvlari uchun bitta (outline, bo'lim,
 * highlights). Annotatsiya o'z tili bilan alohida (`abstractSystemPrompt`).
 */
export function articleSystemPrompt(ctx: ArticleContext): string {
  const { input, meta, type, profile, labels: L } = ctx;
  const lang = meta.language;
  const lines = [
    languageDirective(lang),
    `You are an academic co-author writing a journal article for the «${profile.label.en}» publication profile (${profile.hint}).`,
    `Topic: «${input.topic}».`,
    typeLine(type, L),
    `Target length of the article body: about ${ctx.wordTarget} words (abstracts excluded).`,
    `RULES (strict):`,
    `1. CITATIONS: cite ONLY the sources listed under SOURCES, by their ID in square brackets: [W2741809807], several: [W2741809807; W4385], with a page locator: ${locatorExample(lang)}. Never cite by number, author name or year alone. NEVER invent a source, DOI, author, journal or year. A claim with no matching source is written WITHOUT a citation. A citation ID not in SOURCES will be deleted automatically.`,
    `2. NUMBERS: every statistic, percentage, sample size (n=), p-value or year of an event must come either from a cited SOURCE (cite it in the same sentence) or from USER FACTS. Do not invent survey results, experiment outcomes or figures. If you have no number, describe qualitatively.`,
    `3. USER FACTS are the author's own results — reproduce every number, unit, name and date VERBATIM; never alter, round or contradict them; do not add results the author did not report.`,
    `4. NO FILLER: do not use empty openers such as ${FILLER_PHRASES.slice(0, 4).map((p) => `«${p}»`).join(", ")}, «${FILLER_PHRASES[8]}», «${FILLER_PHRASES[12]}», «${FILLER_PHRASES[16]}». Every paragraph must carry a specific claim, mechanism, comparison or result.`,
    `5. Style: formal academic register, third person, precise terminology of the field; no motivational or generic sentences; do not repeat the section title inside the text; do not write chapter numbers («I BOB»).`,
    `6. Output: return ONLY the JSON requested — no markdown fences, no commentary.`,
  ];
  if (input.extra) lines.push(`Additional author requirements: ${input.extra}`);
  if (input.userFacts) lines.push(`USER FACTS (verbatim, the author's own results/experiment):\n--- FACTS ---\n${input.userFacts}\n--- END FACTS ---`);
  if (input.sourceText) {
    lines.push(`SOURCE DOCUMENT uploaded by the author (context; use its facts, terms and structure; do not copy verbatim; numbers from it count as USER FACTS):\n--- SOURCE ---\n${input.sourceText.slice(0, 16_000)}\n--- END SOURCE ---`);
  }
  return lines.join("\n");
}

/** Reja: skelet → bo'lim rejasi JSON. */
export function outlinePrompt(ctx: ArticleContext): string {
  const { type, labels: L } = ctx;
  const lines: string[] = [];
  if (type.wordRange && type.skeleton.length === 1) {
    lines.push(
      `Plan a single-block ${type.label.en} of ${type.wordRange[0]}–${type.wordRange[1]} words: context → gap → aim → method → result → significance.`,
      `Return JSON: {"sections":[{"id":"${type.skeleton[0].id}","title":"${L.section[type.skeleton[0].titleKey]}","brief":"one-sentence plan of the block","words":${Math.round((type.wordRange[0] + type.wordRange[1]) / 2)}}]}`,
    );
    return lines.join("\n");
  }
  lines.push(`Plan the sections. For each skeleton section write a one-sentence «brief» — what exactly this section will argue or report for THIS topic (specific, not generic).`);
  if (type.freeSections) {
    lines.push(
      `The skeleton section «body» must be replaced by ${type.freeSections.min}–${type.freeSections.max} named sections specific to the topic: ids "body-1", "body-2", …; each with its own title in the output language (no numbering) and brief.`,
    );
  }
  lines.push(
    `Keep the other skeleton ids and their titles EXACTLY as given; do not add or drop sections (optional ones may be omitted).`,
    `Section words must sum to about ${ctx.wordTarget}; distribute by the skeleton shares.`,
    `Skeleton (id → title → share):`,
    ...type.skeleton.map((s) => `  ${s.id} → «${L.section[s.titleKey]}» → ${s.sharePct}%${s.required ? "" : " (optional)"}`),
    `Return JSON: {"sections":[{"id":"…","title":"…","brief":"…","words":320}]}`,
  );
  return lines.join("\n");
}

function figureSpecHelp(ctx: ArticleContext): string {
  const chart = ctx.input.userData
    ? `  • {"kind":"chart","chart":"bar"|"line","dataSource":"user","categories":[…],"series":[{"name":"…","values":[…]}]} — ONLY from USER DATA; categories/series will be filled from the user's data verbatim, so just choose "bar"/"line" and write the caption.`
    : `  • charts are NOT allowed (no user data provided).`;
  return [
    `FIGURE spec kinds (choose one that explains a mechanism/process/classification of THIS section; max 14 nodes / 24 edges; labels short, in the output language):`,
    `  • {"kind":"flow","direction":"TB"|"LR","nodes":[{"id":"n1","label":"…","kind":"start"|"step"|"decision"|"data"|"end"}],"edges":[{"from":"n1","to":"n2","label":"…"}]}`,
    `  • {"kind":"process","steps":["…","…"]}`,
    `  • {"kind":"tree","root":"…","children":[{"label":"…","children":[{"label":"…"}]}]}`,
    chart,
  ].join("\n");
}

export type SectionAsk = {
  plan: SectionPlan;
  /** Shu bo'limda jadval so'ralsinmi (dvigatel taqsimlaydi). */
  wantTable: boolean;
  /** Shu bo'limda sxema so'ralsinmi. */
  wantFigure: boolean;
  /** Foydalanuvchi ma'lumotidan grafik shu bo'limda. */
  wantChart: boolean;
};

/** Bo'lim matni — JSON bloklar (+ ixtiyoriy jadval/sxema). */
export function sectionPrompt(ctx: ArticleContext, ask: SectionAsk): string {
  const { plan } = ask;
  const refs = ctx.refs;
  const lines = [
    `Write the section «${plan.title}» (id ${plan.id}) of the article. Do not repeat the title in the text.`,
    `Plan for this section: ${plan.brief}`,
    `Length: about ${plan.words} words (${Math.max(2, Math.round(plan.words / 110))} or more full paragraphs of 80–130 words). Stay strictly within this section's scope; other sections are written separately.`,
  ];
  if (ctx.type.wordRange && ctx.type.skeleton.length === 1) {
    lines.push(`This is the WHOLE ${ctx.type.label.en}: ${ctx.type.wordRange[0]}–${ctx.type.wordRange[1]} words in total, no headings, 3–6 paragraphs or one dense block.`);
  }
  if (refs.length) {
    lines.push(`SOURCES (cite by ID; use those that genuinely support a sentence; do not force a citation into every paragraph; do not cite what you did not use):`, ...refs.map((r) => formatRefLine(r)));
  } else {
    lines.push(`SOURCES: none available — write WITHOUT any citations and without any bracketed IDs or numbers.`);
  }
  const schema: string[] = [`{"blocks":[{"kind":"p","text":"…"},{"kind":"li","text":"…"},{"kind":"quote","text":"…"}]`];
  if (ask.wantTable) {
    lines.push(`Include ONE table that structures this section's content (comparison, classification, parameters; 2–5 columns, 3–8 rows; cell values only from SOURCES/USER FACTS or qualitative labels — no invented numbers). Give "anchorAfterBlock": the index of the block after which it belongs; caption without a number.`);
    schema.push(`"table":{"caption":"…","headers":["…"],"rows":[["…"]],"anchorAfterBlock":1}`);
  }
  if (ask.wantFigure || ask.wantChart) {
    lines.push(figureSpecHelp(ctx));
    lines.push(
      ask.wantChart
        ? `Include ONE figure of kind "chart" from the USER DATA (categories: ${ctx.input.userData?.categories.join(", ")}; series: ${ctx.input.userData?.series.map((s) => s.name).join(", ")}) with a caption, and refer to it in the text.`
        : `Include ONE figure (scheme) with a caption (without a number) and "anchorAfterBlock"; refer to it in the text as «the figure below»/equivalent, never by a number.`,
    );
    schema.push(`"figure":{"caption":"…","anchorAfterBlock":1,"spec":{…}}`);
  }
  lines.push(`Return JSON: ${schema.join(",")}}`);
  return lines.join("\n");
}

/** «Kengaytir» — hajm yetmasa bir marta. */
export function expandPrompt(ctx: ArticleContext, plan: SectionPlan, have: number, need: number): string {
  return [
    `The section «${plan.title}» currently has ${have} words; it needs about ${need} more. Write ADDITIONAL paragraphs for the same section: new specific points (a mechanism, a comparison, a limitation, a counter-example) — do not repeat or summarise what is already written.`,
    `Section plan: ${plan.brief}`,
    ctx.refs.length ? `SOURCES (same rules — cite by ID only):\n${ctx.refs.map((r) => formatRefLine(r)).join("\n")}` : `SOURCES: none — no citations.`,
    `Return JSON: {"blocks":[{"kind":"p","text":"…"}]}`,
  ].join("\n");
}

/** Tezis/qisqa xabar — so'z chegarasidan tashqarida bo'lsa qayta so'rov. */
export function wordRangePrompt(ctx: ArticleContext, plan: SectionPlan, have: number, range: [number, number]): string {
  const dir = have < range[0] ? "too short" : "too long";
  return [
    `The previous text was ${dir} (${have} words); the required range is ${range[0]}–${range[1]} words. Rewrite the whole section «${plan.title}» to fit the range exactly, keeping every USER FACT verbatim and every citation ID unchanged.`,
    `Section plan: ${plan.brief}`,
    ctx.refs.length ? `SOURCES (cite by ID only):\n${ctx.refs.map((r) => formatRefLine(r)).join("\n")}` : `SOURCES: none — no citations.`,
    `Return JSON: {"blocks":[{"kind":"p","text":"…"}]}`,
  ].join("\n");
}

/** Annotatsiya tizim prompti — O'Z tili bilan (uz/ru/en), tarjima emas. */
export function abstractSystemPrompt(ctx: ArticleContext, lang: string): string {
  return [
    languageDirective(lang),
    `You are an academic co-author writing the abstract of a journal article in ${langInfo(lang).name}. Write it INDEPENDENTLY in this language — it is not a translation of another abstract.`,
    `Topic: «${ctx.input.topic}». Article type: ${ctx.type.label.en}. Publication profile: ${ctx.profile.label.en}.`,
    `Rules: no citations, no bracketed IDs, no invented numbers (only numbers present in the section summaries or USER FACTS), no filler openers, third person, one paragraph per part.`,
    ctx.input.userFacts ? `USER FACTS (verbatim):\n${ctx.input.userFacts}` : "",
    `Return ONLY JSON.`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Annotatsiya so'rovi: `{text, keywords}` yoki structured 4 qism. */
export function abstractPrompt(ctx: ArticleContext, lang: string, sectionSummaries: string): string {
  const [minW, maxW] = ctx.profile.abstractWords;
  const [minK, maxK] = ctx.profile.keywords;
  const L = articleLabels(lang);
  const structured = Boolean(ctx.type.structuredAbstract);
  const lines = [
    `Write the abstract in ${langInfo(lang).name}: ${minW}–${maxW} words in total; aim, method, main result (with the author's numbers if any), conclusion/significance.`,
    `Then ${minK}–${maxK} keywords in ${langInfo(lang).name} (lowercase unless proper nouns; no duplicates; 1–3 words each).`,
    `Section summaries of the written article (the abstract must reflect THIS content):`,
    sectionSummaries,
  ];
  if (ctx.input.keywords.length) lines.push(`Author-suggested keywords (in the article language; adapt to ${langInfo(lang).name}, do not just copy if the language differs): ${ctx.input.keywords.join(", ")}`);
  if (structured) {
    lines.push(
      `STRUCTURED abstract — four labelled parts; return JSON: {"background":"…","methods":"…","results":"…","conclusions":"…","keywords":["…"]} (labels «${L.structured.background}», «${L.structured.methods}», «${L.structured.results}», «${L.structured.conclusions}» are added by the renderer — do not include them in the text).`,
    );
  } else {
    lines.push(`Return JSON: {"text":"…","keywords":["…"]}`);
  }
  return lines.join("\n");
}

/** Highlights (Elsevier): 3–5 × ≤85 belgi. */
export function highlightsPrompt(ctx: ArticleContext, sectionSummaries: string): string {
  const h = ctx.type.highlights ?? { min: 3, max: 5, maxChars: 85 };
  return [
    `Write ${h.min}–${h.max} Highlights for the article: each a single sentence of at most ${h.maxChars} characters (including spaces), stating a concrete result or contribution; no citations, no numbers that are not in the summaries/USER FACTS.`,
    `Section summaries:`,
    sectionSummaries,
    `Return JSON: {"highlights":["…"]}`,
  ].join("\n");
}

/* ────────────────────────── tadqiqot (research) ────────────────────────── */

export function researchSystemPrompt(): string {
  return [
    `You are a research librarian assisting an academic author. You never invent sources: you only formulate search queries and choose among the candidate records given to you. Return ONLY JSON.`,
  ].join("\n");
}

/** `fast` rol: 4–6 qidiruv so'rovi (inglizcha + hujjat tilida). */
export function queriesPrompt(input: ArticleInput): string {
  const lang = langInfo(input.language).name;
  return [
    `Topic: «${input.topic}». Article type: ${input.articleType}. Keywords: ${input.keywords.join(", ") || "—"}.`,
    input.userFacts ? `Author's own results (for context): ${input.userFacts.slice(0, 600)}` : "",
    `Write 4–6 search queries for a scholarly database (OpenAlex full-text search): 3–4 in English (the database is mostly English), 1–2 in ${lang} if the language is not English. Each query 3–8 words, specific to the topic and its sub-questions (methods, effects, context), no quotes, no boolean operators.`,
    `Return JSON: {"queries":["…"]}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** `researcher` rol: FAQAT ro'yxatdan `min..max` ta id. */
export function selectRefsPrompt(input: ArticleInput, candidates: OpenAlexWork[], want: { min: number; max: number }): string {
  return [
    `Topic: «${input.topic}». Article type: ${input.articleType}. Keywords: ${input.keywords.join(", ") || "—"}.`,
    `From the CANDIDATES below choose ${want.min}–${want.max} records that are genuinely relevant to the topic and useful for citing in this article (prefer: directly on-topic, recent, peer-reviewed venues, higher citation counts; avoid duplicates of the same study and off-topic records).`,
    `Return ONLY ids that appear in the list — any other id is discarded. Return JSON: {"ids":["W…"]}`,
    `CANDIDATES:`,
    ...candidates.map((c) => `${formatRefLine(c, true)}${c.citedBy !== undefined ? ` [cited by ${c.citedBy}]` : ""}`),
  ].join("\n");
}
