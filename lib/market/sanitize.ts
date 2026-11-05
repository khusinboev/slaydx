import { parseAuthorLine } from "../generation/meta";
import { deckFooter } from "../generation/slide-identity";
import type { AcademicDoc, DocMeta, Reference } from "../generation/types";
import { convert } from "../translit";
import { normalizeText } from "./normalize";
import { pickMarketParams, type MarketParams } from "./params";
import { MARKET_ASSET_PREFIX, type PiiFlag, type PiiKind } from "./types";
import type { ToolId } from "../types";

/**
 * The market sanitiser (docs/market/PLAN.md §1.4): the only door between a user's work and a listing. Pure and
 * isomorphic. It works by ALLOW-LIST, not by deny-list: the output document is built from the fields named here, so a
 * field added to `AcademicDoc` later never reaches a listing until someone decides it may.
 *
 * Three layers:
 *   1. structure — the document keeps only the listed top-level keys and meta keys; title-page fields, signatures, the
 *      logo, a custom template, user material (facts, own sources) and the reports are gone;
 *   2. text — every remaining string (except structural keys) passes the scrub: phones, e-mails, `@username`, `t.me/…`,
 *      then the phrases of the title page (university, faculty, …), then the words of the people's names;
 *   3. assets — own asset URLs become `market-asset://<id>`; a foreign generation's URL is dropped.
 *
 * Only body-level hits are flagged (`flags`): clearing the title page is routine, a name inside a paragraph is what the
 * admin must look at. A flag holds the path, never the matched value.
 */

export const SCRUB_MARK = "____";

export type MarketIdentity = {
  /** People: author, teacher, approver, co-authors, the account's profile names. */
  names: readonly string[];
  /** Institutions and other multi-word title-page values. */
  phrases: readonly string[];
  /** Exact secrets of the account: phone, Telegram username, e-mail. */
  exact: readonly string[];
};

export type SanitizeInput = {
  toolId: ToolId;
  doc: AcademicDoc;
  values: Record<string, unknown>;
  /** Generation the document belongs to: only ITS asset URLs survive. */
  sourceId: string;
  /** Profile of the account (`users` columns). */
  profile?: Partial<Record<"name" | "author" | "teacher" | "university" | "faculty" | "department" | "organization" | "position" | "group" | "username" | "phone" | "email", string | null>>;
};

export type SanitizeResult = {
  doc: AcademicDoc;
  params: MarketParams;
  flags: PiiFlag[];
  /** Asset ids the sanitised document references; `candidates.ts` copies exactly these bytes. */
  assetIds: string[];
  /** The document carried user-provided sources: not ours to resell, the caller must not list it. */
  userMaterial: boolean;
};

/* ────────────────────────── allow-lists ────────────────────────── */

/** Top-level document keys that may be stored on a listing. Everything else disappears. */
const DOC_KEEP = [
  "meta",
  "titlePage",
  "toc",
  "sections",
  "tables",
  "references",
  "referencesNote",
  "abstracts",
  "slideTheme",
  "slideTemplate",
  "slideVisual",
  "slides",
  "slideImages",
  "slideResearch",
  "work",
  "essay",
  "teacher",
  "article",
] as const satisfies readonly (keyof AcademicDoc)[];

/**
 * Meta keys kept as they are (no person, no free user text). Every other string meta key is blanked, every other
 * array emptied: `extractMeta` builds a full `DocMeta` and renderers read optional-looking fields without guards.
 */
const META_KEEP: ReadonlySet<string> = new Set<keyof DocMeta>([
  "toolId", "workLabel", "topic", "language", "subject", "ministry", "kind", "pagesLabel", "targetPages", "annotationLangs",
  "weeklyHours", "totalHours", "termCount", "grade", "duration", "fileNameHint", "tocMethod", "includeVisuals", "titleSlide",
  "premiumVisuals", "slideAudience", "design", "slideTheme", "slideTemplate", "slidePurpose", "localExamples", "blocks",
  "planItems", "agendaSlide", "textVolume", "quizCount", "internetSearch", "speakerNotes", "slideImageStyle", "resumeTemplate",
  "resumePalette", "enrich", "articleType", "pubProfile", "citeStyle", "figureCount", "figureKinds", "research", "year",
]);

/** String keys inside the document that are structure, not text: never scrubbed. */
const STRUCTURAL_KEYS: ReadonlySet<string> = new Set([
  "id", "url", "assetId", "kind", "layout", "figureId", "tableId", "sectionId", "anchor", "lang", "language", "mime", "src",
  "doi", "isbn", "accessed", "docDate", "verified", "svg", "type", "profile", "cite", "genre", "rubric", "context",
  "direction", "chart", "dataSource", "visual", "slideVisual", "slideTheme", "slideTemplate", "toolId", "pagesLabel",
  "design", "from", "to", "at", "builtAt", "font", "fontSize",
]);

/** Words that sit in a name line but name nobody; `q'izi` and friends arrive here without the apostrophe. */
const NAME_STOP: ReadonlySet<string> = new Set([
  "ogli", "ugli", "qizi", "kizi", "ibn", "bin", "van", "der", "fan", "kurs", "guruh", "talaba", "talabasi", "dotsent", "dots",
  "professor", "prof", "katta", "oqituvchi", "oqituvchisi", "ustoz", "domla", "doktor", "nomzodi", "phd", "dsc", "assistent",
  "direktor", "rahbar", "mudir", "mudiri", "mudira", "sinf", "maktab",
]);

/** Case endings after a name, on normalised (Latin, no apostrophe) text: Uzbek suffixes and Russian surname cases. */
const NAME_SUFFIX = /^(?:ning|ni|ga|ka|qa|da|dan|ta|lar|larning|niki|dek|day|cha|im|ing|imiz|ingiz|si|i|a|u|e|y|om|oy|ym|oj|oi|oga|oning|ovna|evna|ovich|evich)$/;

/** Name words shorter than this never scrub (plan §1.4). */
const NAME_MIN = 3;
/** From this length a lowercase spelling scrubs too; short names only capitalised, «olim» (scholar) is not «Olim». */
const NAME_ANY_CASE_MIN = 6;
const PHRASE_MIN = 5;

/* ────────────────────────── text scrub ────────────────────────── */

const PATTERNS: readonly { kind: PiiKind; re: RegExp }[] = [
  { kind: "email", re: /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu },
  { kind: "telegram", re: /(?:https?:\/\/)?(?:t|telegram)\.me\/[A-Za-z0-9_+/-]+/gi },
  // +998 90 123 45 67, 998901234567, (90) 123-45-67, 90 123 45 67, 90-123-45-67.
  { kind: "phone", re: /\+?998[\s-]?\(?\d{2}\)?[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}(?!\d)/g },
  { kind: "phone", re: /(?<![\d.,])\(?\d{2}\)?[ -]\d{3}[ -]\d{2}[ -]\d{2}(?![\d.,]\d)/g },
  { kind: "username", re: /(?<![\p{L}\p{N}._%+-])@[A-Za-z0-9_]{3,32}\b/gu },
];

type Scrubber = (text: string, path: string, mode?: { names?: boolean; username?: boolean }) => string;

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Case endings glued to the last word of an institution, in both scripts («Akademiyasida», «Академиясида»). */
const PHRASE_SUFFIX = "-?(?:ning|ni|ga|ka|qa|da|dan|ta|нинг|ни|га|ка|қа|да|дан|та)";

/** A phrase as a regex: any whitespace between words, any apostrophe, case-insensitive. */
function phraseRe(phrase: string): RegExp {
  const body = phrase
    .trim()
    .split(/\s+/)
    .map((w) => escapeRe(w).replace(/['ʻʼ’‘`´]/g, "['ʻʼ’‘`´]"))
    .join("\\s+");
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}(?:${PHRASE_SUFFIX})?(?![\\p{L}\\p{N}])`, "giu");
}

/** The name words of a person's line: normalised, no patronymic markers, nothing the topic itself is about. */
function nameWords(names: readonly string[], topicWords: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  for (const raw of names) {
    const line = parseAuthorLine(String(raw ?? "")).name;
    const words = normalizeText(line)
      .split(" ")
      .filter((w) => w.length >= NAME_MIN && !NAME_STOP.has(w) && !/^\d+$/.test(w));
    // A work about Amir Temur keeps «Temur» when the author merely shares it. The WHOLE name in the topic is the author
    // writing himself into it («Aliyev Ali 301-guruh, Fizika»): nothing is protected then.
    const ownName = words.length > 1 && words.every((w) => topicWords.has(w));
    for (const w of words) if (ownName || !topicWords.has(w)) out.add(w);
  }
  return out;
}

const isName = (word: string, names: ReadonlySet<string>): boolean => {
  const n = normalizeText(word).replace(/ /g, "");
  if (n.length < NAME_MIN) return false;
  if (names.has(n)) return true;
  for (const name of names) if (n.startsWith(name) && NAME_SUFFIX.test(n.slice(name.length))) return true;
  return false;
};

function isScrubbableCase(word: string): boolean {
  if (word.length >= NAME_ANY_CASE_MIN) return true;
  const first = word[0] ?? "";
  return first !== first.toLowerCase();
}

/**
 * A word of a person's name that stays in the topic: «Karimov tajribasi» by Ali Karimov looks exactly like «Amir Temur»
 * by Ali Temur, so the text cannot decide. The admin does: the title goes out only after a look.
 */
function nameInTopic(names: readonly string[], topicWords: ReadonlySet<string>, scrubbed: ReadonlySet<string>): boolean {
  return names.some((raw) =>
    normalizeText(parseAuthorLine(String(raw ?? "")).name)
      .split(" ")
      .some((w) => w.length >= NAME_MIN && !NAME_STOP.has(w) && topicWords.has(w) && !scrubbed.has(w)),
  );
}

function makeScrubber(identity: MarketIdentity, topic: string, flags: PiiFlag[]): Scrubber {
  const topicNorm = normalizeText(topic);
  const topicWords = new Set(topicNorm.split(" "));
  const names = nameWords(identity.names, topicWords);
  if (nameInTopic(identity.names, topicWords, names)) flags.push({ kind: "name", path: "meta.topic" });
  const phrases: RegExp[] = [];
  for (const raw of identity.phrases) {
    const p = String(raw ?? "").replace(/\s+/g, " ").trim();
    if (p.length < PHRASE_MIN || topicNorm.includes(normalizeText(p))) continue;
    phrases.push(phraseRe(p));
    const cyr = convert(p, "lat", "cyr");
    if (cyr !== p) phrases.push(phraseRe(cyr));
  }
  const exact = identity.exact
    .map((v) => String(v ?? "").trim())
    .filter((v) => v.length >= 4)
    .map((v) => new RegExp(`(?<![\\p{L}\\p{N}])@?${escapeRe(v.replace(/^[@+]/, ""))}(?![\\p{L}\\p{N}])`, "giu"));

  return (text, path, mode = {}) => {
    let out = text;
    const hit = (kind: PiiKind) => flags.push({ kind, path });
    for (const { kind, re } of PATTERNS) {
      if (kind === "username" && mode.username === false) continue;
      out = out.replace(re, () => (hit(kind), SCRUB_MARK));
    }
    for (const re of exact) out = out.replace(re, () => (hit("username"), SCRUB_MARK));
    for (const re of phrases) out = out.replace(re, () => (hit("institution"), SCRUB_MARK));
    if (mode.names === false || !names.size) return out;
    return out.replace(/[\p{L}\p{M}][\p{L}\p{M}'ʻʼ’‘`´]*/gu, (word) => {
      if (!isScrubbableCase(word) || !isName(word, names)) return word;
      hit("name");
      return SCRUB_MARK;
    });
  };
}

/* ────────────────────────── identity ────────────────────────── */

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** Everything the document, its form values and the account say about who made it. */
export function identityOf(input: Pick<SanitizeInput, "doc" | "values" | "profile">): MarketIdentity {
  const { doc, values } = input;
  const m = (doc.meta ?? {}) as Partial<DocMeta>;
  const w = doc.work;
  const s = doc.teacher?.school;
  const p = input.profile ?? {};
  const names = [
    m.author, m.teacher, w?.author, w?.teacher, s?.author, s?.approver,
    str(values.author), str(values.teacher), str(values.fullName), str(values.approver),
    p.author, p.name, p.teacher,
    ...(doc.article?.authors ?? []).map((a) => a.name),
  ];
  const phrases = [
    m.university, m.faculty, m.department, m.organization, m.group, m.position, m.degree,
    w?.university, w?.faculty, w?.department, w?.group, w?.teacherDegree, w?.ministryCustom,
    s?.institution,
    str(values.university), str(values.faculty), str(values.department), str(values.group), str(values.organization),
    p.university, p.faculty, p.department, p.organization, p.position, p.group,
    ...(doc.article?.authors ?? []).flatMap((a) => [a.org, a.degree]),
  ];
  const exact = [p.phone, p.username, p.email, m.email, str(values.email), ...(doc.article?.authors ?? []).flatMap((a) => [a.email, a.orcid])];
  const clean = (list: readonly (string | null | undefined)[]) => [...new Set(list.map((v) => String(v ?? "").trim()).filter(Boolean))];
  return { names: clean(names), phrases: clean(phrases), exact: clean(exact) };
}

/* ────────────────────────── structure ────────────────────────── */

function cleanMeta(meta: DocMeta): DocMeta {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (META_KEEP.has(key)) out[key] = value;
    else if (typeof value === "string") out[key] = "";
    else if (Array.isArray(value)) out[key] = [];
    else if (typeof value === "number" || typeof value === "boolean") out[key] = value;
  }
  return out as DocMeta;
}

const isUserRef = (r: Pick<Reference, "verified" | "kind">): boolean => r.verified === "user" || r.kind === "user";

/** Keeps verified sources only. `dropped` = the raw lines of the user's own, removed from `doc.references` too. */
function keepVerified(refs: readonly Reference[] | undefined): { refs: Reference[]; dropped: Reference[] } {
  const list = refs ?? [];
  return { refs: list.filter((r) => !isUserRef(r)), dropped: list.filter(isUserRef) };
}

/** The asset id of an own URL, `null` for a foreign generation, `undefined` when `url` is no generation asset. */
function ownAsset(url: string, sourceId: string): string | null | undefined {
  const m = /^\/api\/generations\/([^/]+)\/assets\/([0-9a-f]+)$/.exec(url);
  if (!m) return undefined;
  return m[1] === sourceId ? m[2]! : null;
}

function structure(doc: AcademicDoc): { doc: AcademicDoc; userRefs: Reference[] } {
  const src = doc as unknown as Record<string, unknown>;
  const kept: Record<string, unknown> = {};
  for (const key of DOC_KEEP) if (src[key] !== undefined) kept[key] = src[key];
  const out = kept as unknown as AcademicDoc;
  out.meta = cleanMeta(doc.meta);
  const userRefs: Reference[] = [];

  if (doc.work) {
    const { refs, dropped } = keepVerified(doc.work.references);
    userRefs.push(...dropped);
    const w = { ...doc.work, references: refs };
    for (const k of ["university", "faculty", "department", "group", "course", "author", "teacher", "city"] as const) w[k] = "";
    delete w.teacherDegree;
    delete w.ministryCustom;
    delete w.userFacts;
    delete w.review;
    if (w.ministry === "custom") w.ministry = "oliy";
    out.work = w;
  }
  if (doc.essay) {
    const e = { ...doc.essay };
    delete e.userFacts;
    delete e.review;
    out.essay = e;
  }
  if (doc.teacher) {
    const t = { ...doc.teacher, school: { ...doc.teacher.school, institution: "", author: "", approver: "", date: "" } };
    delete t.school.gradeLetter;
    delete t.review;
    delete t.polish;
    delete t.userNeeds;
    out.teacher = t;
  }
  if (doc.article) {
    const { refs, dropped } = keepVerified(doc.article.references);
    userRefs.push(...dropped);
    const a = { ...doc.article, authors: [], udk: "", references: refs };
    delete a.userFacts;
    delete a.review;
    out.article = a;
  }
  if (userRefs.length && out.references?.length) {
    const lines = userRefs.flatMap((r) => [r.raw, r.title]).filter((v): v is string => Boolean(v));
    out.references = out.references.filter((line) => !lines.some((l) => line.includes(l)));
  }
  if (doc.slides) {
    const footer = deckFooter(out.meta);
    out.slides = doc.slides.map((slide, i) => {
      const s = { ...slide, footer };
      // `imageOrig` exists only after the user replaced the picture: the AI original goes back, his upload does not.
      if (s.imageOrig) s.image = s.imageOrig;
      delete s.imageOrig;
      if (i === 0 || s.layout === "title") {
        if (s.subtitle && s.subtitle !== doc.meta.workLabel) delete s.subtitle;
      }
      return s;
    });
  }
  return { doc: out, userRefs };
}

/* ────────────────────────── text + asset walk ────────────────────────── */

type WalkCtx = { scrub: Scrubber; sourceId: string; assets: Set<string> };

/** The deep walk over everything that survived `structure`: rewrites strings, keeps the shape. */
function walk(node: unknown, path: string, ctx: WalkCtx, inherited: { names?: boolean; username?: boolean; raw?: boolean } = {}): unknown {
  if (typeof node === "string") return inherited.raw ? node : ctx.scrub(node, path, inherited);
  if (Array.isArray(node)) return node.map((v, i) => walk(v, `${path}.${i}`, ctx, inherited));
  if (!node || typeof node !== "object") return node;
  const obj = node as Record<string, unknown>;
  let mode = inherited;
  if (obj.kind === "formula") mode = { ...mode, raw: true };
  if (obj.kind === "code") mode = { ...mode, username: false };
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const next = path ? `${path}.${key}` : key;
    if (typeof value === "string" && value.startsWith("/api/generations/")) {
      const asset = ownAsset(value, ctx.sourceId);
      if (asset) {
        ctx.assets.add(asset);
        out[key] = `${MARKET_ASSET_PREFIX}${asset}`;
      } else if (asset === null) {
        out[key] = "";
      } else {
        out[key] = value;
      }
      continue;
    }
    if (STRUCTURAL_KEYS.has(key)) {
      out[key] = value;
      continue;
    }
    // Real literature carries real surnames: a same-named cited author is no leak, a broken bibliography is a defect.
    const child = key === "references" ? { ...mode, names: false } : mode;
    out[key] = walk(value, next, ctx, child);
  }
  return out;
}

/** Second guard behind the scan's `values_json` filter: the document itself says the user brought material. */
function broughtMaterial(doc: AcademicDoc, userRefs: readonly Reference[]): boolean {
  const m = doc.meta;
  return Boolean(
    userRefs.length ||
      m.sourceText?.trim() ||
      m.logoAssetId ||
      m.templateAssetId ||
      m.photoAssetId ||
      doc.slideLogo ||
      doc.customTemplate ||
      doc.work?.userFacts?.trim() ||
      doc.essay?.userFacts?.trim() ||
      doc.article?.userFacts?.trim(),
  );
}

/** A picture whose bytes we may not keep leaves no empty frame behind. */
function dropEmptyImages(doc: AcademicDoc): void {
  for (const s of doc.slides ?? []) if (s.image && !s.image.url) delete s.image;
  for (const m of [doc.work, doc.article, doc.teacher]) {
    for (const f of m?.figures ?? []) {
      if (f.url === "") {
        delete f.url;
        delete f.assetId;
      }
    }
  }
}

/* ────────────────────────── entry ────────────────────────── */

/** Neutral copy of a work. Throws only on a document without `meta` (the caller records `sanitize_error`). */
export function sanitizeForMarket(input: SanitizeInput): SanitizeResult {
  const { doc, values, toolId, sourceId } = input;
  if (!doc?.meta) throw new Error("document has no meta");
  const identity = identityOf(input);
  const flags: PiiFlag[] = [];
  const { doc: shaped, userRefs } = structure(doc);
  const scrub = makeScrubber(identity, doc.meta.topic ?? "", flags);
  const assets = new Set<string>();
  const clean = walk(shaped, "", { scrub, sourceId, assets }) as AcademicDoc;
  dropEmptyImages(clean);
  return {
    doc: clean,
    params: pickMarketParams(toolId, values),
    flags,
    assetIds: [...assets],
    userMaterial: broughtMaterial(doc, userRefs),
  };
}

/**
 * The picture of a placeholder whose bytes are gone (the user deleted the asset while editing) goes too: a listing
 * never points at something it does not hold.
 */
export function dropMissingAssets(doc: AcademicDoc, missing: readonly string[]): AcademicDoc {
  if (!missing.length) return doc;
  const gone = new Set(missing.map((id) => `${MARKET_ASSET_PREFIX}${id}`));
  const visit = (v: unknown): unknown => {
    if (typeof v === "string") return gone.has(v) ? "" : v;
    if (Array.isArray(v)) return v.map(visit);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, visit(x)]));
    return v;
  };
  const out = visit(doc) as AcademicDoc;
  dropEmptyImages(out);
  return out;
}

/**
 * «Qayta tozalash» of a stored listing (admin): the source is never read again (M1), so only the pattern layer and the
 * structure run over the stored document; title-page values are already gone from it.
 */
export function resanitizeStored(toolId: ToolId, doc: AcademicDoc, params: Record<string, unknown>): SanitizeResult {
  const flags: PiiFlag[] = [];
  const { doc: shaped } = structure(doc);
  const scrub = makeScrubber({ names: [], phrases: [], exact: [] }, doc.meta?.topic ?? "", flags);
  const assets = new Set<string>();
  const clean = walk(shaped, "", { scrub, sourceId: "", assets }) as AcademicDoc;
  for (const url of collectPlaceholders(clean)) assets.add(url);
  return { doc: clean, params: pickMarketParams(toolId, params), flags, assetIds: [...assets], userMaterial: false };
}

/** Asset ids of the `market-asset://` placeholders of a stored document. */
export function collectPlaceholders(doc: unknown): string[] {
  const found = new Set<string>();
  const visit = (v: unknown): void => {
    if (typeof v === "string") {
      if (v.startsWith(MARKET_ASSET_PREFIX)) found.add(v.slice(MARKET_ASSET_PREFIX.length));
    } else if (Array.isArray(v)) v.forEach(visit);
    else if (v && typeof v === "object") Object.values(v).forEach(visit);
  };
  visit(doc);
  return [...found];
}
