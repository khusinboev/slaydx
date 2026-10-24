import "server-only";
import { TOOLS, TOOL_BY_ID, missingRequired, preflightError, profileDefaults } from "../../tools";
import { TARGET_LANGUAGES, SOURCE_LANGUAGES } from "../../languages";
import { QUIZ_COUNTS, SLIDE_TEXT_VOLUMES, SLIDE_IMAGE_STYLES, slideParamsFor, PRO_SLIDE_MAX, PRO_SLIDE_MIN } from "../../generation/slide-params";
import { SLIDE_AUDIENCES } from "../../generation/slide-audience";
import { SLIDE_PURPOSES } from "../../generation/slide-purpose";
import { SLIDE_TEMPLATES } from "../../generation/slide-templates";
import { SLIDE_THEMES } from "../../generation/slide-themes";
import { COURSEWORK_PAGES, INDEPENDENT_PAGES, REFERAT_PAGES } from "../../generation/work/registry";
import { ESSAY_CONTEXTS } from "../../generation/essay/registry";
import { ARTICLE_TYPES } from "../../generation/article/types-registry";
import { PUBLICATION_PROFILES } from "../../generation/article/profiles";
import { WORK_FORM_FIELDS, WORK_JSON_FIELDS } from "../../generation/work-params";
import { ESSAY_FORM_FIELDS } from "../../generation/essay-params";
import { ARTICLE_FORM_FIELDS, ARTICLE_JSON_FIELDS } from "../../generation/article-params";
import { TEACHER_FORM_FIELDS, TEACHER_JSON_FIELDS } from "../../generation/teacher-params";
import { GAME_FORM_FIELDS } from "../../generation/game-params";
import { AUDIO_FORM_FIELDS } from "../../generation/audio-params";
import { IMAGE_FORM_FIELDS } from "../../generation/image-params";
import { INFOGRAPHIC_FORM_FIELDS } from "../../generation/infographic-params";
import type { FormValues, ToolConfig, ToolId } from "../../types";
import type { SessionUser } from "../session";
import { sanitizeValues } from "../validate";
import { effectivePrice } from "../pricing";

/**
 * What the AI chat may PROPOSE, and how a proposal is validated (owner request 8).
 *
 * The model names a tool and form values; nothing it says is trusted. This module is the only gate between
 * its text and a card the user can confirm:
 *   - the tool must be a chat tool (text-only input; no photo / file / long-text tools);
 *   - every key must belong to that tool's param registry (the same `*-params.ts` registries the forms and
 *     the differential probe tests use) or to its form fields -- unknown keys are an `adjust` issue, never
 *     silently dropped, and file / asset ids and JSON blobs are never accepted from a model;
 *   - every value must have the registry's type, and the enumerated ones (languages, slide audience, essay
 *     context, page packages, the tool's own chips) must be one of the real options;
 *   - then the server's own `missingRequired` and `preflightError`, and finally the SERVER price
 *     (`effectivePrice`, i.e. `priceFor` plus the admin adjustment) that the card shows and the confirm checks.
 */

/** Tools the chat cannot create: they need a photo, an uploaded file, or a structured form too large for a chat. */
export const CHAT_EXCLUDED_TOOLS: readonly ToolId[] = ["portrait", "translation", "resume", "video"];

export function isChatTool(id: string): id is ToolId {
  return Object.prototype.hasOwnProperty.call(TOOL_BY_ID, id) && !CHAT_EXCLUDED_TOOLS.includes(id as ToolId);
}

export function chatTools(): ToolConfig[] {
  return TOOLS.filter((t) => isChatTool(t.id));
}

type Rule = { type: "string" | "number" | "boolean"; values?: readonly string[]; min?: number; max?: number; maxLen?: number };

const DOC_LANGS = TARGET_LANGUAGES.map((l) => l.value) as readonly string[];
const ANY_LANGS = SOURCE_LANGUAGES.map((l) => l.value) as readonly string[];
const TOPIC_MAX = 300;
const TEXT_MAX = 500;
const EXTRA_MAX = 800;

/** Keys never accepted from a model: assets, JSON blobs, long source text, anything that is not a short plain value. */
const BLOCKED = new Set<string>([
  ...WORK_JSON_FIELDS,
  ...ARTICLE_JSON_FIELDS,
  ...TEACHER_JSON_FIELDS,
  "sourceText",
  "sourceAssetId",
  "userGlossary",
  "mode",
]);
function blockedKey(key: string): boolean {
  return BLOCKED.has(key) || /AssetId$/.test(key);
}

/** The registry keys a tool's values may carry (before blocking). */
function registryKeys(id: ToolId): string[] {
  switch (id) {
    case "slide":
    case "pro-slide":
      return slideParamsFor(id).map((p) => p.id);
    case "coursework":
    case "referat":
    case "mustaqil-ish":
      return [...WORK_FORM_FIELDS];
    case "essay":
      return [...ESSAY_FORM_FIELDS];
    case "article":
    case "thesis":
      return [...ARTICLE_FORM_FIELDS];
    case "texnologik-xarita":
    case "glossary":
    case "keys":
    case "lesson-plan":
    case "test":
      return [...TEACHER_FORM_FIELDS];
    case "image":
      return [...IMAGE_FORM_FIELDS];
    case "crossword":
    case "flashcards":
    case "sorting":
    case "listening":
      return [...GAME_FORM_FIELDS];
    case "podcast":
    case "greeting":
      return [...AUDIO_FORM_FIELDS];
    case "infographic":
      return [...INFOGRAPHIC_FORM_FIELDS];
    default:
      return [];
  }
}

/** Every key the chat may set on a tool: registry + form fields (+ `topic` when the tool has one), minus the blocked ones. */
export function allowedKeys(id: ToolId): string[] {
  const tool = TOOL_BY_ID[id];
  const set = new Set<string>([...registryKeys(id), ...tool.fields.map((f) => f.name)]);
  if (tool.topicLegend) set.add("topic");
  return [...set].filter((k) => !blockedKey(k));
}

/** Profile-filled keys: never shown as "the model's" parameters, never overridden by an empty string. */
const PROFILE_KEYS = new Set(["author", "university", "faculty", "department", "subject", "teacher", "city", "position", "organization"]);

/** Hand-curated typing of the keys a model is told about. Anything else in the registry is validated by its encode type only. */
function curatedRules(id: ToolId): Record<string, Rule> {
  const lang: Rule = { type: "string", values: DOC_LANGS };
  switch (id) {
    case "slide":
    case "pro-slide":
      return {
        topic: { type: "string", maxLen: TOPIC_MAX },
        language: lang,
        slideCount: { type: "number", min: PRO_SLIDE_MIN, max: PRO_SLIDE_MAX },
        slideAudience: { type: "string", values: SLIDE_AUDIENCES },
        slidePurpose: { type: "string", values: SLIDE_PURPOSES },
        textVolume: { type: "string", values: SLIDE_TEXT_VOLUMES },
        slideTemplate: { type: "string", values: SLIDE_TEMPLATES.map((t) => t.id) },
        slideTheme: { type: "string", values: SLIDE_THEMES.map((t) => t.id) },
        quizCount: { type: "number", values: QUIZ_COUNTS.map(String) },
        planItems: { type: "number", min: 3, max: 6 },
        slideImageStyle: { type: "string", values: SLIDE_IMAGE_STYLES },
        internetSearch: { type: "boolean" },
        speakerNotes: { type: "boolean" },
        localExamples: { type: "boolean" },
        titleSlide: { type: "boolean" },
        agendaSlide: { type: "boolean" },
      };
    case "coursework":
      return { topic: { type: "string", maxLen: TOPIC_MAX }, language: lang, pages: { type: "string", values: COURSEWORK_PAGES } };
    case "referat":
      return { topic: { type: "string", maxLen: TOPIC_MAX }, language: lang, pages: { type: "string", values: REFERAT_PAGES } };
    case "mustaqil-ish":
      return { topic: { type: "string", maxLen: TOPIC_MAX }, language: lang, pages: { type: "string", values: INDEPENDENT_PAGES } };
    case "essay":
      return {
        topic: { type: "string", maxLen: TOPIC_MAX },
        language: lang,
        essayContext: { type: "string", values: Object.keys(ESSAY_CONTEXTS) },
        pages: { type: "string", values: ["1", "2", "3", "4", "5"] },
      };
    case "article":
      return {
        topic: { type: "string", maxLen: TOPIC_MAX },
        language: lang,
        articleType: { type: "string", values: Object.keys(ARTICLE_TYPES) },
        pubProfile: { type: "string", values: Object.keys(PUBLICATION_PROFILES) },
        pages: { type: "string", values: ["1-2", "3-5", "5-10", "10-15"] },
      };
    case "thesis":
      return {
        topic: { type: "string", maxLen: TOPIC_MAX },
        language: lang,
        articleType: { type: "string", values: ["conference_thesis", "conference_extended"] },
        pages: { type: "string", values: ["1-2", "3-5"] },
      };
    case "image":
      return { prompt: { type: "string", maxLen: 500 }, imageCount: { type: "number", min: 1, max: 4 } };
    case "texnologik-xarita":
    case "glossary":
    case "keys":
    case "lesson-plan":
    case "test":
      return { topic: { type: "string", maxLen: TOPIC_MAX }, language: lang, subject: { type: "string", maxLen: 120 }, grade: { type: "string", maxLen: 40 } };
    default:
      return {};
  }
}

/** The typing rule of one key of a tool: curated, then the form field's own options / range, then the generic fallback. */
function ruleFor(id: ToolId, key: string): Rule {
  const curated = curatedRules(id)[key];
  if (curated) return curated;
  const field = TOOL_BY_ID[id].fields.find((f) => f.name === key);
  if (field) {
    if (field.kind === "language") return { type: "string", values: key === "language" ? DOC_LANGS : ANY_LANGS };
    if (field.options?.length) return { type: "string", values: field.options.map((o) => o.value) };
    if (field.kind === "number") return { type: "number", min: field.min, max: field.max };
    if (field.kind === "toggle") return { type: "boolean" };
  }
  if (key === "language") return { type: "string", values: DOC_LANGS };
  if (key === "nativeLanguage" || key === "targetLanguage") return { type: "string", values: ANY_LANGS };
  if (key === "extra") return { type: "string", maxLen: EXTRA_MAX };
  return { type: "string", maxLen: TEXT_MAX };
}

/** Keys the model is told about for a tool (the prompt lists these); `required` ones first. */
export type ChatParamHint = { key: string; required: boolean; rule: Rule };

const HINT_KEYS: Partial<Record<ToolId, { required: string[]; optional: string[] }>> = {
  slide: { required: ["topic"], optional: ["slideCount", "language", "slideAudience", "slidePurpose", "textVolume", "quizCount", "speakerNotes"] },
  "pro-slide": { required: ["topic"], optional: ["slideCount", "language", "slideAudience", "slidePurpose", "textVolume", "quizCount", "slideImageStyle", "speakerNotes"] },
  coursework: { required: ["topic"], optional: ["pages", "language"] },
  referat: { required: ["topic"], optional: ["pages", "language"] },
  "mustaqil-ish": { required: ["topic"], optional: ["pages", "language"] },
  essay: { required: ["topic", "essayContext"], optional: ["pages", "language"] },
  article: { required: ["topic", "articleType"], optional: ["pages", "language", "pubProfile"] },
  thesis: { required: ["topic", "articleType"], optional: ["pages", "language"] },
  image: { required: ["prompt"], optional: ["imageCount"] },
  "texnologik-xarita": { required: ["topic"], optional: ["subject", "grade", "language"] },
  glossary: { required: ["topic"], optional: ["subject", "grade", "language"] },
  keys: { required: ["topic"], optional: ["subject", "grade", "language"] },
  "lesson-plan": { required: ["topic"], optional: ["subject", "grade", "language"] },
  test: { required: ["topic"], optional: ["subject", "grade", "language"] },
};

export function paramHints(id: ToolId): ChatParamHint[] {
  const tool = TOOL_BY_ID[id];
  const curated = HINT_KEYS[id];
  const allowed = new Set(allowedKeys(id));
  let required: string[];
  let optional: string[];
  if (curated) {
    required = curated.required;
    optional = curated.optional;
  } else {
    // Field-driven tools (games, infographic, podcast, greeting): the form's own fields.
    const own = tool.fields.filter((f) => !blockedKey(f.name) && !PROFILE_KEYS.has(f.name));
    required = own.filter((f) => f.required).map((f) => f.name);
    optional = own.filter((f) => !f.required && !f.extra).map((f) => f.name);
    if (tool.topicLegend && !required.includes("topic")) required = ["topic", ...required];
  }
  return [...required.map((key) => ({ key, required: true })), ...optional.map((key) => ({ key, required: false }))]
    .filter((h) => allowed.has(h.key))
    .map((h) => ({ ...h, rule: ruleFor(id, h.key) }));
}

/** One short human-readable description of a rule, for the model prompt. */
export function describeRule(rule: Rule): string {
  if (rule.type === "boolean") return "true|false";
  if (rule.values) {
    const v = [...rule.values];
    return v.length > 14 ? `${v.slice(0, 14).join("|")}|...` : v.join("|");
  }
  if (rule.type === "number") return `${rule.min ?? 0}..${rule.max ?? "N"}`;
  return "text";
}

/** Uzbek label of a form key for the confirmation card. */
const KEY_LABELS: Record<string, string> = {
  topic: "Mavzu",
  prompt: "Tavsif",
  slideCount: "Slaydlar soni",
  language: "Til",
  pages: "Hajm (bet)",
  slideAudience: "Auditoriya",
  slidePurpose: "Maqsad",
  textVolume: "Matn hajmi",
  quizCount: "Test savollari",
  slideTemplate: "Shablon",
  slideTheme: "Mavzu rangi",
  slideImageStyle: "Rasm uslubi",
  planItems: "Reja bandlari",
  essayContext: "Insho turi",
  articleType: "Maqola turi",
  pubProfile: "Nashr profili",
  imageCount: "Rasmlar soni",
  subject: "Fan",
  grade: "Sinf",
  recipient: "Kimga",
  occasion: "Munosabat",
  durationMin: "Davomiyligi (daq)",
  voice: "Ovoz",
  speakerNotes: "Spiker izohlari",
  internetSearch: "Internet qidiruvi",
};

export function keyLabel(id: ToolId, key: string): string {
  const field = TOOL_BY_ID[id].fields.find((f) => f.name === key);
  return KEY_LABELS[key] ?? field?.legend ?? key;
}

/** A value as the card prints it: the option's label when the field has options, "Ha"/"Yo'q" for booleans. */
export function valueLabel(id: ToolId, key: string, value: FormValues[string]): string {
  if (typeof value === "boolean") return value ? "Ha" : "Yo'q";
  const text = String(value ?? "");
  const field = TOOL_BY_ID[id].fields.find((f) => f.name === key);
  const opt = field?.options?.find((o) => o.value === text);
  if (opt) return opt.label;
  if (key === "language") return TARGET_LANGUAGES.find((l) => l.value === text)?.label ?? text;
  if (key === "slideTemplate") return SLIDE_TEMPLATES.find((t) => t.id === text)?.nameUz ?? text;
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

export type ProposalCheck =
  | { ok: true; tool: ToolConfig; values: FormValues; price: number; shown: Array<{ label: string; value: string }> }
  | { ok: false; tool: ToolConfig | null; issues: string[]; shown: Array<{ label: string; value: string }> };

type ProfileLike = Pick<SessionUser, "name" | "author" | "university" | "faculty" | "department" | "subject" | "teacher" | "city" | "position" | "organization" | "group" | "course">;

/**
 * Validates a model proposal. Never throws; every problem is an Uzbek `issues` line the card shows.
 * The returned `values` are the model's values (typed, bounded) merged over the user's profile defaults for the keys the tool
 * actually takes -- exactly what `submitGeneration` receives on confirm.
 */
export async function checkProposal(toolId: unknown, rawValues: unknown, profile: ProfileLike): Promise<ProposalCheck> {
  const id = typeof toolId === "string" ? toolId.trim() : "";
  if (!id || !Object.prototype.hasOwnProperty.call(TOOL_BY_ID, id)) {
    return { ok: false, tool: null, issues: ["Bunday vosita yo'q — qaysi vositani xohlayotganingizni yozing."], shown: [] };
  }
  const tool = TOOL_BY_ID[id as ToolId];
  if (!isChatTool(tool.id)) {
    return { ok: false, tool, issues: [`«${tool.title}» chat orqali yaratilmaydi — uni saytdagi formadan oching.`], shown: [] };
  }

  const clean = sanitizeValues(rawValues);
  const issues: string[] = [];
  if (!clean) issues.push("Forma qiymatlari noto'g'ri.");
  const allowed = new Set(allowedKeys(tool.id));
  const model: FormValues = {};
  const shown: Array<{ label: string; value: string }> = [];

  for (const [key, value] of Object.entries(clean ?? {})) {
    if (!allowed.has(key)) {
      issues.push(`Noma'lum parametr: ${key.slice(0, 40)}`);
      continue;
    }
    const rule = ruleFor(tool.id, key);
    const problem = checkValue(rule, value);
    if (problem) {
      issues.push(`${keyLabel(tool.id, key)}: ${problem}`);
      continue;
    }
    // Numbers that arrive as numeric strings ("12") are normalized so the engine and the price read one thing.
    const typed = rule.type === "number" ? Number(value) : value;
    if (typed === "" || typed === null) continue;
    model[key] = typed as FormValues[string];
  }

  // Profile defaults only for the keys this tool takes; the model's own values win.
  const defaults = profileDefaults(profile);
  const values: FormValues = {};
  for (const [key, value] of Object.entries(defaults)) {
    if (allowed.has(key) && value !== "") values[key] = value;
  }
  for (const key of ["group", "course"] as const) {
    if (allowed.has(key) && profile[key]) values[key] = profile[key];
  }
  Object.assign(values, model);

  for (const [key, value] of Object.entries(model)) shown.push({ label: keyLabel(tool.id, key), value: valueLabel(tool.id, key, value) });

  for (const legend of missingRequired(tool, values)) issues.push(`To'ldirilmagan: ${legend}`);
  const pre = preflightError(tool, values);
  if (pre) issues.push(pre);
  if (issues.length) return { ok: false, tool, issues: dedupe(issues), shown };

  const price = await effectivePrice(tool, values);
  return { ok: true, tool, values, price, shown };
}

function checkValue(rule: Rule, value: FormValues[string]): string | null {
  if (value === null) return null;
  if (rule.type === "boolean") return typeof value === "boolean" ? null : "Ha yoki Yo'q bo'lishi kerak";
  if (rule.type === "number") {
    const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
    if (!Number.isFinite(n) || !Number.isInteger(n)) return "butun son bo'lishi kerak";
    if (rule.min !== undefined && n < rule.min) return `${rule.min} dan kam bo'lmasin`;
    if (rule.max !== undefined && n > rule.max) return `${rule.max} dan oshmasin`;
    if (rule.values && !rule.values.includes(String(n))) return `quyidagilardan biri bo'lishi kerak: ${rule.values.join(", ")}`;
    return null;
  }
  if (typeof value !== "string") return "matn bo'lishi kerak";
  if (rule.values && !rule.values.includes(value)) return `quyidagilardan biri bo'lishi kerak: ${[...rule.values].slice(0, 12).join(", ")}`;
  if (rule.maxLen && value.length > rule.maxLen) return `${rule.maxLen} belgidan oshmasin`;
  return null;
}

function dedupe(items: string[]): string[] {
  return [...new Set(items)].slice(0, 8);
}

/** The canonical form of a proposal: sorted keys, so the same values always hash the same. */
export function canonicalValues(values: FormValues): string {
  return JSON.stringify(Object.fromEntries(Object.entries(values).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))));
}
