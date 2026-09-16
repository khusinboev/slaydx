/**
 * INFOGRAFIKA PROMPTLARI (AUDIT-21 WP-C) — `teacher/prompts.ts` naqshi.
 *
 * Ko'rsatmalar INGLIZCHA, birinchi qator `languageDirective`: JSON
 * sxemasi, blok soni va majburiy maydonlar kabi TUZILMA qoidalarini
 * model inglizcha ko'rsatmada ishonchliroq bajaradi, chiqish tilini esa
 * birinchi qator qat'iy belgilaydi.
 *
 * HALOLLIK CHEGARASI (hisobot §4) promptning O'Z bo'limi:
 * `stat` va `source` FAQAT foydalanuvchi bergan raqam-faktdan
 * to'ldiriladi. Bu takrorlanuvchi shior emas — `review.ts`
 * (`sourceGrounded`, `statPresent`) va `polish.ts` («Sizdan kutiladi»)
 * AYNAN shu qoidani qayta tekshiradi, ya'ni prompt va hisobot bitta
 * shartnomani ikki tomondan ushlab turadi.
 *
 * Nega butun SPETSIFIKATSIYA bitta chaqiruvda so'raladi (bo'lak-bo'lak
 * emas, `teacher/map.ts` dagidek): plakatda 3–8 blok va ular O'ZARO
 * bog'liq — jarayon bosqichlari ketma-ket, taqqoslash juftlari bir xil
 * mezon bo'yicha, sabab-natija guruhlari muvozanatli. Bo'lak-bo'lak
 * so'ralganda model ikkinchi bo'lakda birinchisini KO'RMAYDI.
 */
import { languageDirective } from "../i18n";
import { INFOGRAPHIC_LIMITS, PALETTES, type InfographicSpec } from "./types";
import { ICONS } from "./types";
import type { InfographicTypeSpec } from "./registry";
import type { InfographicInput } from "./input";

/* ══════════════════════════ kontekst ══════════════════════════ */

export type InfographicContext = {
  spec: InfographicTypeSpec;
  input: InfographicInput;
};

export const infographicCtx = (spec: InfographicTypeSpec, input: InfographicInput): InfographicContext => ({ spec, input });

/* ══════════════════════════ bloklar ══════════════════════════ */

const L = INFOGRAPHIC_LIMITS;

/** Turga MAJBURIY maydonlar — reyestrdan, qo'lda takrorlanmaydi. */
function requiredFields(spec: InfographicTypeSpec): string {
  if (!spec.requires.length) return "";
  const notes: Record<string, string> = {
    order: '"order": the 1-based stage number (blocks listed in that order)',
    side: '"side": "left" or "right" (both columns get the SAME number of blocks)',
    stat: '"stat": {"value": "<short printable number>", "label": "<what it counts>"}',
    when: '"when": a year, date or named period, one consistent format',
    role: '"role": "cause" or "effect" (at least two of each, causes listed first)',
  };
  return `Every block in this type MUST carry: ${spec.requires.map((f) => notes[f]).join("; ")}.`;
}

/**
 * HALOLLIK bo'limi — `stat`/`source`/`when` uchun.
 *
 * `userFacts` bo'sh bo'lsa TAQIQ qat'iyroq yoziladi: foydalanuvchi hech
 * qanday raqam bermagan, demak plakatdagi HAR QANDAY foiz o'ylab
 * topilgan bo'lardi.
 */
function honesty(input: InfographicInput): string {
  const hasFacts = Boolean(input.extra.trim() || input.sourceText.trim());
  return [
    "HONESTY LIMIT (absolute):",
    '- "stat" values, the "source" line and any percentage or count inside block text may come ONLY from USER DATA below. Never from your own knowledge, even when you are sure it is correct.',
    hasFacts
      ? '- If USER DATA does not contain enough numbers for every block, write FEWER blocks with a "stat" — or, in a non-statistics type, leave "stat" out entirely. Do not fill the gap with a plausible figure.'
      : '- USER DATA contains NO figures at all, so NO block may carry a "stat" and "source" MUST be omitted. Write the poster qualitatively.',
    '- "source" is filled ONLY when the user named the source. An invented citation («Manba: Jahon banki, 2024») is a critical error.',
  ].join("\n");
}

/* ══════════════════════════ tizim prompti ══════════════════════════ */

export function infographicSystemPrompt(ctx: InfographicContext): string {
  const { spec, input } = ctx;
  const [min, max] = spec.limits.blocks;
  return [
    languageDirective(input.language),
    `You design a ONE-PAGE educational wall poster (infographic) for an Uzbek school or university teacher. Poster type: ${spec.label.en}. Return ONLY a JSON object, no prose, no markdown fence.`,
    "",
    "TYPE RULES:",
    ...spec.guidance.map((g) => `- ${g}`),
    requiredFields(spec),
    "",
    "HARD LIMITS (a poster is read from two metres away — every word costs space):",
    `- exactly ${input.blockCount} blocks (allowed range for this type: ${min}–${max});`,
    `- "title" ≤ ${L.titleCharsMax} characters, "subtitle" ≤ ${L.subtitleCharsMax};`,
    `- each block "heading" ≤ ${L.headingCharsMax} characters — a scannable phrase, NOT a sentence;`,
    `- each block "text" ≤ ${L.blockTextWordsMax} words, and the WHOLE poster ≤ ${L.textWordsMax} words;`,
    `- "stat.value" ≤ ${L.statValueCharsMax} characters with the unit inside it («73%», «1 200 km»), "stat.label" ≤ ${L.statLabelCharsMax};`,
    `- "source" ≤ ${L.sourceCharsMax} characters.`,
    "",
    honesty(input),
    "",
    `ICONS: each block picks ONE name from this list, the one that best matches its content — ${ICONS.join(", ")}. A name outside the list is replaced by a default icon, so choose from it.`,
    spec.id === "compare"
      ? 'SUBTITLE: for this type the subtitle names the two columns separated by an em dash, e.g. «Fotosintez — Hujayra nafas olishi»; the layout draws them as the two column headers.'
      : "SUBTITLE: one short line that sharpens the title; omit it rather than repeating the title.",
    "",
    "JSON schema (keys in English, VALUES in the output language):",
    '{"title":"…","subtitle":"…","blocks":[{"icon":"…","heading":"…","text":"…","stat":{"value":"…","label":"…"},"when":"…","role":"cause|effect","side":"left|right","order":1,"parent":"<block index, 1-based>"}],"source":"…"}',
    'Omit every optional key that does not apply to this type — write no empty strings and no null.',
  ]
    .filter(Boolean)
    .join("\n");
}

/* ══════════════════════════ foydalanuvchi prompti ══════════════════════════ */

export function infographicPrompt(ctx: InfographicContext): string {
  const { input } = ctx;
  const facts = [input.extra.trim(), input.sourceText.trim().slice(0, 6000)].filter(Boolean).join("\n");
  return [
    `TOPIC: ${input.topic}`,
    `BLOCKS: ${input.blockCount}`,
    facts ? `USER DATA (the only admissible source of figures, dates and citations):\n${facts}` : "USER DATA: none — the user supplied no figures, dates or sources.",
    "",
    "Write the poster specification now. Each block must add a fact a reader could NOT guess from the title.",
  ].join("\n");
}

/* ══════════════════════════ qayta so'rov ══════════════════════════ */

/**
 * BIR MARTALIK qayta so'rov — maket yoki qoidalar blokni rad etganda.
 *
 * Model o'z javobini KO'RADI va aniq nima buzilganini o'qiydi: mavhum
 * «qisqaroq yoz» ko'rsatmasi jonli sinovda matnni 5 % qisqartirib,
 * o'sha kartaga yana sig'masdi. Shuning uchun muammolar blok id si
 * bilan sanaladi va qisqartirish ULUSHI aytiladi.
 */
export function infographicRetryPrompt(ctx: InfographicContext, spec: InfographicSpec, problems: string[]): string {
  return [
    "Your previous specification did not fit the printed page. Here it is:",
    JSON.stringify({ title: spec.title, subtitle: spec.subtitle, blocks: spec.blocks.map(({ id, heading, text, stat }) => ({ id, heading, text, ...(stat ? { stat } : {}) })) }),
    "",
    "Problems:",
    ...problems.map((p) => `- ${p}`),
    "",
    `Rewrite the WHOLE specification with the same ${spec.blocks.length} blocks, the same block ids, the same order and the same meaning, but with the listed problems fixed. Cut wording, do not cut information: drop adjectives and filler clauses first. Return the same JSON schema.`,
  ].join("\n");
}

/* ══════════════════════════ sayqal ══════════════════════════ */

/**
 * Avto-sayqal — butun spetsifikatsiyani QAYTA so'raydi (bo'limni emas).
 *
 * Plakatda «bo'lim» yo'q: bloklar bir-biriga bog'liq va bittasini
 * alohida qayta yozish taqqoslash juftini yoki jarayon zanjirini uzib
 * qo'yardi. Blok soni, id lar va tur maydonlari SAQLANADI — aks holda
 * hisobot qayta hisoblanganda `blockCount` qizarib, sayqal hech qachon
 * qabul qilinmasdi.
 */
export function infographicRewritePrompt(ctx: InfographicContext, spec: InfographicSpec, instructions: string[]): string {
  return [
    "Current poster specification:",
    JSON.stringify(spec),
    "",
    "Review notes to act on:",
    ...instructions.map((s, i) => `${i + 1}. ${s}`),
    "",
    `Return the improved specification in the same JSON schema, keeping EXACTLY ${spec.blocks.length} blocks, the same block ids and the same type-specific fields (order/side/role/when/stat presence).`,
    "The honesty limit still holds: you may not add a figure, date or source that is absent from the current specification and from the user data.",
  ].join("\n");
}

/** Palitra nomlari — prompt uchun emas, xato xabari va testlar uchun. */
export const PALETTE_NAMES = PALETTES.map((p) => p.id);
