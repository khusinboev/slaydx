/**
 * Maqola maketi — YAGONA MANBA («ko'rdim = oldim», Maqola 2 / AUDIT-17).
 *
 * `planArticle(doc)` hujjatni TARTIB va RAQAMLASH bilan yoyadi:
 *
 *   UDK → sarlavha → mualliflar → annotatsiya ×3 → highlights →
 *   bo'limlar (1., 1.1. — profil/tur talab qilsa) → adabiyotlar →
 *   REFERENCES (OAK ikkinchi ro'yxati)
 *
 * va matn ichidagi `[W…]` iqtiboslarini uslubga ko'ra almashtiradi
 * (`[1; 25-b.]` / `[1]` / `(Familiya, yil)`), rasm/jadval/formulaga raqam
 * beradi («1-rasm», «1-jadval», «(1)»). DOCX (`render-docx.ts`) ham,
 * ko'ruvchi (`lib/viewers/flow.ts docToFlow`) ham FAQAT shu natijani
 * chizadi — ikkalasida ham «qaysi band qayerda, qanday raqam bilan» degan
 * mantiq YO'Q. Izomorf: DOM ham, `docx` ham import qilinmaydi.
 *
 * Eski maqola (`doc.article` yo'q) — `legacyArticleModel(doc)` bilan
 * o'qiladi: renderlar uni ESKI yo'l bilan chizishda davom etadi (titul,
 * mundarija), bu reja esa faqat o'quvchilar (hisobot, tahrir) uchun.
 */
import type { AcademicDoc, Block, DocTable } from "../types";
import type {
  ArticleModel,
  ArticleType,
  CiteStyle,
  Figure,
  PublicationProfile,
  Reference,
  ReferenceVerified,
} from "./types";
import { ARTICLE_TYPES, normalizeArticleType } from "./types-registry";
import { PUBLICATION_PROFILES, normalizePublicationProfile } from "./profiles";
import { articleLabels, type ArticleDocLabels } from "./labels";

/* ────────────────────────── tiplar ────────────────────────── */

/**
 * Matn bo'lagi. `cite` bo'lsa — bu iqtibos («[1; 25-b.]»): ko'ruvchi uni
 * `data-ref-verified` bilan o'raydi, DOCX esa oddiy matn sifatida yozadi.
 * Bo'laklar matni qo'shilganda `text` ga AYNAN teng bo'ladi.
 */
export type CiteSpan = {
  text: string;
  cite?: { ids: string[]; ns: number[]; verified: ReferenceVerified };
};

export type ArticleAuthorLine = {
  index: number;
  /** «Karimova D. B., PhD, dotsent» — ism + unvon bitta qatorda. */
  line: string;
  /** «Tashkilot, email, ORCID: …» — bo'sh bo'lsa chizilmaydi. */
  affiliation: string;
};

export type HeadItem =
  | { k: "udk"; text: string }
  | { k: "title"; text: string }
  | { k: "authors"; authors: ArticleAuthorLine[] }
  | { k: "abstract"; lang: string; label: string; text: string; keywordsLabel: string; keywords: string }
  | { k: "highlights"; label: string; items: string[] };

export type BodyItem =
  | { k: "h1"; text: string; title: string; number?: string; sectionId: string; path: string }
  | { k: "h2"; text: string; title: string; number?: string; path: string }
  | { k: "h3"; text: string; path: string }
  | { k: "p"; text: string; spans: CiteSpan[]; path: string }
  | { k: "li"; text: string; spans: CiteSpan[]; path: string }
  | { k: "quote"; text: string; spans: CiteSpan[]; path: string }
  | { k: "code"; text: string; caption?: string; path: string }
  /**
   * Sxema. `figure` reyestrda topilmasa ham band chiziladi (o'rinbosar
   * ramka) — sarlavha va raqam yo'qolmaydi. `caption` — TO'LIQ satr
   * («1-rasm. …»), `placeholder` — PNG bo'lmaganda ramka ichidagi matn.
   */
  | { k: "figure"; figureId: string; figure?: Figure; number: string; caption: string; placeholder: string; path: string }
  /** Jadval matnning SHU joyida; `caption` — «1-jadval. …» (TEPADA chiziladi). */
  | { k: "table"; tableId: string; table: DocTable; number: string; caption: string; path: string }
  /** Formula; `number` — «(1)». */
  | { k: "formula"; latex: string; number: string; display: boolean; path: string };

export type RefItem = {
  n: number;
  /** Uslubga ko'ra shakllangan satr (raqamsiz). */
  text: string;
  /** Chiziladigan satr — raqamli uslubda «1. …», APA da raqamsiz. */
  line: string;
  ref: Reference;
};

export type ArticlePlan = {
  /** `doc.article` yo'q — eski maqola (`legacyArticleModel`). */
  legacy: boolean;
  model: ArticleModel;
  type: ArticleType;
  profile: PublicationProfile;
  cite: CiteStyle;
  language: string;
  labels: ArticleDocLabels;
  head: HeadItem[];
  body: BodyItem[];
  refsLabel: string;
  refs: RefItem[];
  /** OAK: «REFERENCES» — hozircha `formatReferenceLine(ref, "apa7", "en")`; WP5 `cite/translit` bilan almashtiradi. */
  refs2Label?: string;
  refs2?: RefItem[];
  numbers: { figures: Record<string, string>; tables: Record<string, string>; formulas: number };
  /** Jadval sarlavhasi tekislanishi — GOST oilasi o'ngda, APA/IEEE chapda. */
  tableCaptionAlign: "right" | "left";
  /** Bo'lim sarlavhasi — raqamlangan (IEEE/Elsevier) uslubda chapda, aks holda markazda. */
  headingAlign: "center" | "left";
  numberedSections: boolean;
};

/* ────────────────────────── yordamchilar ────────────────────────── */

export function isArticleV2(doc: AcademicDoc): boolean {
  return Boolean(doc.article);
}

/**
 * Eski maqola (`doc.article` yo'q) uchun metama'lumot: tur `meta.kind`
 * dan (`imrad`/`standard`), muallif titul maydonlaridan, manbalar —
 * `doc.references` satrlari (`raw`, tekshirilmagan). Renderlar bu
 * hujjatni ESKI yo'l bilan chizadi; model hisobot/tahrir o'quvchilari uchun.
 */
export function legacyArticleModel(doc: AcademicDoc): ArticleModel {
  const { meta } = doc;
  const type = normalizeArticleType(meta.articleType, meta.kind);
  const profile = normalizePublicationProfile(meta.pubProfile, ARTICLE_TYPES[type].defaultProfile);
  const authors = meta.author
    ? [
        {
          name: meta.author,
          degree: meta.degree || undefined,
          org: meta.organization || undefined,
          email: meta.email || undefined,
        },
      ]
    : [];
  return {
    v: 1,
    type,
    profile,
    cite: meta.citeStyle ?? PUBLICATION_PROFILES[profile].cite,
    udk: meta.udk || undefined,
    language: meta.language,
    authors,
    keywords: {},
    references: (doc.references ?? []).map((raw, i) => ({
      id: `legacy${i + 1}`,
      title: raw,
      raw,
      authors: [],
      verified: "unverified" as const,
      cited: true,
      n: i + 1,
    })),
    figures: [],
  };
}

const VERIFIED_RANK: Record<ReferenceVerified, number> = { unverified: 0, user: 1, crossref: 2, openalex: 3 };

/** Guruhdagi eng ZAIF holat — bitta iqtibosda ikkita manba bo'lsa, belgi eng yomoniga qarab qo'yiladi. */
function weakest(list: ReferenceVerified[]): ReferenceVerified {
  return list.reduce<ReferenceVerified>((a, b) => (VERIFIED_RANK[b] < VERIFIED_RANK[a] ? b : a), "openalex");
}

/** Manba identifikatoriga o'xshaydi (`W…`, `u…`, `doi:…`) — lekin ro'yxatda yo'q. */
const ID_LIKE = /^(W\d+|u\d+|doi:\S+|ref\d+)$/i;

/** Familiya — «Lin C.» / «C. Lin» / «Karimova, D.» shakllaridan. */
export function surnameOf(author: string): string {
  const parts = author
    .replace(/,/g, " ")
    .split(/\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) return author.trim();
  // Bosh harf + nuqta (inisial) bo'lmagan birinchi bo'lak.
  const word = parts.find((p) => p.replace(/\./g, "").length > 2 && !/^\p{Lu}\.?$/u.test(p));
  return word ?? parts[0];
}

function apaJoin(lang: string): { two: string; many: string; nd: string } {
  const c = (lang || "uz").toLowerCase();
  if (c === "ru") return { two: " и ", many: " и др.", nd: "б. г." };
  if (c === "en") return { two: " & ", many: " et al.", nd: "n.d." };
  return { two: " va ", many: " va b.", nd: "yilsiz" };
}

/** APA 7 matn ichidagi iqtibos: «Lin, 2023» / «Lin & Huang, 2023» / «Lin et al., 2023». */
function apaInText(ref: Reference, lang: string): string {
  const J = apaJoin(lang);
  const names = ref.authors.filter(Boolean).map(surnameOf);
  const year = ref.year ? String(ref.year) : J.nd;
  let who: string;
  if (!names.length) who = ref.title.split(/\s+/).slice(0, 3).join(" ");
  else if (names.length === 1) who = names[0];
  else if (names.length === 2) who = names[0] + J.two + names[1];
  else who = names[0] + J.many;
  return `${who}, ${year}`;
}

/**
 * Matndagi `[W…]`, `[W…; W…]`, `[W…; 25-b.]` iqtiboslarini uslubga ko'ra
 * almashtiradi. `nOf` — manba id → tartib raqami (faqat ro'yxatdagilar).
 *
 *   gost           → [1; 25-b.]  /  [1, 2]
 *   numeric, ieee  → [1]  /  [1, 2]  /  [1, 25-b.]
 *   apa7           → (Lin et al., 2023)  /  (Lin et al., 2023; Ahmad et al., 2023, 25-b.)
 *
 * Ro'yxatda YO'Q, lekin id ga o'xshagan token tashlanadi (guard buni
 * allaqachon belgilagan); umuman id bo'lmagan qavs («[qarang]») matn
 * sifatida qoladi. `[fig:f1]` / `[tab:t1]` — rasm/jadval havolasi
 * («1-rasm» / «1-jadval»).
 */
export function renderCitations(
  text: string,
  refs: Reference[],
  style: CiteStyle,
  lang: string,
  numbers: { figures?: Record<string, string>; tables?: Record<string, string> } = {},
): { text: string; spans: CiteSpan[] } {
  const byId = new Map<string, Reference>();
  for (const r of refs) byId.set(r.id, r);
  const L = articleLabels(lang);
  const spans: CiteSpan[] = [];
  let last = 0;
  const re = /\[([^\[\]\n]{1,240})\]/g;
  const pushText = (t: string) => {
    if (!t) return;
    const prev = spans[spans.length - 1];
    if (prev && !prev.cite) prev.text += t;
    else spans.push({ text: t });
  };
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const inner = m[1].trim();
    const figRef = /^fig:(\S+)$/i.exec(inner);
    const tabRef = /^tab:(\S+)$/i.exec(inner);
    if (figRef || tabRef) {
      const n = figRef ? numbers.figures?.[figRef[1]] : numbers.tables?.[tabRef![1]];
      pushText(text.slice(last, m.index));
      pushText(n ? (figRef ? L.figureRef(n) : L.tableRef(n)) : m[0]);
      last = m.index + m[0].length;
      continue;
    }
    const tokens = inner
      .split(";")
      .map((t) => t.trim())
      .filter(Boolean);
    const found: Reference[] = [];
    const locators: string[] = [];
    let idLike = 0;
    for (const t of tokens) {
      const r = byId.get(t);
      if (r) {
        if (!found.includes(r)) found.push(r);
        idLike++;
      } else if (ID_LIKE.test(t)) idLike++;
      else locators.push(t);
    }
    if (!idLike) continue; // oddiy qavs — iqtibos emas
    pushText(text.slice(last, m.index));
    last = m.index + m[0].length;
    if (!found.length) {
      /*
       * Barcha manbalar ro'yxatdan chiqarilgan — qavs butunlay tushadi;
       * undan oldingi bo'shliq ham, agar keyin tinish belgisi kelsa
       * («… [W1].» → «….», «… [W1] .» emas).
       */
      const prev = spans[spans.length - 1];
      if (prev && !prev.cite && prev.text.endsWith(" ") && /^[\s.,;:]/.test(text.slice(last))) prev.text = prev.text.slice(0, -1);
      continue;
    }
    const ns = found.map((r) => r.n ?? 0);
    const loc = locators.join(", ");
    let rendered: string;
    if (style === "apa7") {
      const parts = found.map((r) => apaInText(r, lang));
      rendered = `(${parts.join("; ")}${loc ? `, ${loc}` : ""})`;
    } else if (style === "gost") {
      rendered = `[${ns.join(", ")}${loc ? `; ${loc}` : ""}]`;
    } else {
      rendered = `[${ns.join(", ")}${loc ? `, ${loc}` : ""}]`;
    }
    spans.push({ text: rendered, cite: { ids: found.map((r) => r.id), ns, verified: weakest(found.map((r) => r.verified)) } });
  }
  pushText(text.slice(last));
  return { text: spans.map((s) => s.text).join(""), spans };
}

function pagesUnit(lang: string): string {
  const c = (lang || "uz").toLowerCase();
  return c === "ru" ? "с." : c === "en" ? "p." : "b.";
}

/**
 * Adabiyotlar ro'yxati satri — VAQTINCHA oddiy shakl («Muallif. Sarlavha.
 * Venue, yil. DOI»). WP5 buni `cite/{gost,apa,ieee,numeric}` bilan
 * almashtiradi; imzo saqlanadi. Foydalanuvchi bergan erkin matn (`raw`)
 * o'zgarishsiz qaytadi.
 */
export function formatReferenceLine(ref: Reference, style: CiteStyle, lang = "uz"): string {
  if (ref.raw?.trim()) return ref.raw.trim();
  const authors = ref.authors.map((a) => a.trim()).filter(Boolean);
  // «Lin O.» + «.» → «Lin O..» bo'lmasin: oxirgi nuqta bitta.
  const dot = (s: string) => `${s.replace(/[.\s]+$/, "")}.`;
  const title = ref.title.trim().replace(/\.$/, "");
  const where = ref.venue?.trim() || [ref.place, ref.publisher].filter(Boolean).join(": ");
  const year = ref.year ? String(ref.year) : "";
  const pages = ref.pages ? `${ref.pages} ${pagesUnit(lang)}` : "";
  if (style === "apa7") {
    const J = apaJoin(lang);
    const who =
      authors.length > 1 ? `${authors.slice(0, -1).join(", ")}${J.two.replace(/\s+$/, " ")}${authors[authors.length - 1]}` : authors[0] ?? "";
    const link = ref.doi ? `https://doi.org/${ref.doi}` : ref.url ?? "";
    return [who && `${who} (${year || J.nd}).`, dot(title), where && dot(where), pages && dot(pages), link]
      .filter(Boolean)
      .join(" ");
  }
  if (style === "ieee") {
    return [authors.length && `${authors.join(", ")},`, `“${title},”`, where && `${where},`, year && `${year}.`, pages && dot(pages), ref.doi && `doi: ${ref.doi}.`]
      .filter(Boolean)
      .join(" ");
  }
  // gost / numeric
  return [authors.length && dot(authors.join(", ")), dot(title), where && `${where},`, year && `${year}.`, pages && dot(pages), ref.doi && `DOI: ${ref.doi}.`]
    .filter(Boolean)
    .join(" ");
}

/**
 * Ro'yxat tartibi. Raqamli uslublar — matnda UCHRASH tartibida (matnda
 * uchramagan, lekin `cited` manbalar oxirida, model tartibida); APA 7 —
 * birinchi muallif familiyasi, yil, sarlavha bo'yicha alifbo.
 */
export function orderReferences(refs: Reference[], style: CiteStyle, appearance: string[]): Reference[] {
  if (style === "apa7") {
    const key = (r: Reference) => `${r.authors[0] ? surnameOf(r.authors[0]) : r.title}`.toLocaleLowerCase();
    return [...refs].sort((a, b) => key(a).localeCompare(key(b)) || (a.year ?? 0) - (b.year ?? 0) || a.title.localeCompare(b.title));
  }
  const rank = new Map<string, number>();
  appearance.forEach((id, i) => {
    if (!rank.has(id)) rank.set(id, i);
  });
  return [...refs]
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (rank.get(a.r.id) ?? 1e9 + a.i) - (rank.get(b.r.id) ?? 1e9 + b.i))
    .map((x) => x.r);
}

/** Matnda iqtibos qilingan id lar — uchrash tartibida. */
function appearanceOrder(doc: AcademicDoc, known: Set<string>): string[] {
  const out: string[] = [];
  const re = /\[([^\[\]\n]{1,240})\]/g;
  const scan = (text: string) => {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      for (const t of m[1].split(";")) {
        const id = t.trim();
        if (known.has(id) && !out.includes(id)) out.push(id);
      }
    }
  };
  for (const a of doc.abstracts ?? []) scan(a.text);
  for (const s of doc.sections) {
    scan(s.title);
    for (const b of s.blocks) if (b.kind !== "formula") scan(b.text);
  }
  for (const t of doc.tables ?? []) if (t.caption) scan(t.caption);
  return out;
}

const SCHEME_WORD: Record<"uz" | "ru" | "en", { scheme: string; chart: string }> = {
  uz: { scheme: "sxema", chart: "diagramma" },
  ru: { scheme: "схема", chart: "диаграмма" },
  en: { scheme: "scheme", chart: "chart" },
};

function langKey(lang: string): "uz" | "ru" | "en" {
  const c = (lang || "uz").toLowerCase();
  return c === "ru" ? "ru" : c === "en" ? "en" : "uz";
}

/* ────────────────────────── reja ────────────────────────── */

export function planArticle(doc: AcademicDoc): ArticlePlan {
  const legacy = !doc.article;
  const model = doc.article ?? legacyArticleModel(doc);
  const type = ARTICLE_TYPES[model.type] ?? ARTICLE_TYPES.imrad_oak;
  const profile = PUBLICATION_PROFILES[model.profile] ?? PUBLICATION_PROFILES[type.defaultProfile];
  const cite: CiteStyle = model.cite ?? profile.cite;
  const language = model.language || doc.meta.language || "uz";
  const L = articleLabels(language);
  const numbered = Boolean(profile.numberedSections || type.numberedHeadings);

  /* ── manbalar: faqat `cited`, tartib uslubga ko'ra ── */
  const citedRefs = model.references.filter((r) => r.cited);
  const known = new Set(citedRefs.map((r) => r.id));
  const ordered = orderReferences(citedRefs, cite, appearanceOrder(doc, known));
  const numberedRefs: Reference[] = ordered.map((r, i) => ({ ...r, n: i + 1 }));
  const refItem = (r: Reference, style: CiteStyle, lang: string): RefItem => {
    const text = formatReferenceLine(r, style, lang);
    return { n: r.n!, text, line: style === "apa7" ? text : `${r.n}. ${text}`, ref: r };
  };
  const refs = numberedRefs.map((r) => refItem(r, cite, language));
  const refs2 = profile.secondEnglishList ? numberedRefs.map((r) => refItem(r, "apa7", "en")) : undefined;

  /* ── raqamlash: rasm/jadval/formula — bo'limlar tartibida ── */
  const figures = new Map(model.figures.map((f) => [f.id, f]));
  const tables = new Map((doc.tables ?? []).filter((t) => t.id).map((t) => [t.id!, t]));
  const numbers: ArticlePlan["numbers"] = { figures: {}, tables: {}, formulas: 0 };
  const sections = doc.sections.filter((s) => s.blocks.length);
  {
    let chapter = 0;
    let fig = 0;
    let tab = 0;
    for (const s of sections) {
      chapter++;
      if (profile.figureNumbering === "chapter") {
        fig = 0;
        tab = 0;
      }
      const label = (n: number) => (profile.figureNumbering === "chapter" ? `${chapter}.${n}` : String(n));
      for (const b of s.blocks) {
        if (b.kind === "figure") {
          const f = figures.get(b.figureId);
          if (f?.fallbackBlocks?.length) continue; // rasm o'rniga ro'yxat — raqam yo'q
          if (!numbers.figures[b.figureId]) numbers.figures[b.figureId] = label(++fig);
        } else if (b.kind === "tableRef") {
          if (tables.has(b.tableId) && !numbers.tables[b.tableId]) numbers.tables[b.tableId] = label(++tab);
        } else if (b.kind === "formula") numbers.formulas++;
      }
      // Bo'limga langarlangan, lekin `tableRef` siz jadvallar — bo'lim oxirida.
      for (const t of doc.tables ?? []) {
        if (t.id && t.anchor === s.id && !numbers.tables[t.id]) numbers.tables[t.id] = label(++tab);
      }
    }
    // Langarsiz/qolgan jadvallar — hujjat oxirida (adabiyotlardan oldin).
    for (const t of doc.tables ?? []) {
      if (t.id && !numbers.tables[t.id]) numbers.tables[t.id] = profile.figureNumbering === "chapter" ? `${Math.max(1, chapter)}.${++tab}` : String(++tab);
    }
  }

  const cites = (text: string) => renderCitations(text, numberedRefs, cite, language, numbers);

  /* ── bosh blok ── */
  const head: HeadItem[] = [];
  if (profile.udk && model.udk?.trim()) head.push({ k: "udk", text: `${L.udk} ${model.udk.trim()}` });
  head.push({ k: "title", text: doc.meta.topic });
  if (model.authors.length) {
    head.push({
      k: "authors",
      authors: model.authors.map((a, index) => ({
        index,
        line: [a.name, a.degree].map((x) => x?.trim()).filter(Boolean).join(", "),
        affiliation: [a.org, a.email, a.orcid && `ORCID: ${a.orcid}`]
          .map((x) => x?.trim())
          .filter(Boolean)
          .join(", "),
      })),
    });
  }
  for (const a of doc.abstracts ?? []) {
    const AL = articleLabels(a.lang);
    const kw = a.keywords?.trim() || (model.keywords[langKey(a.lang)] ?? []).join(", ");
    head.push({ k: "abstract", lang: a.lang, label: AL.abstract, text: a.text, keywordsLabel: AL.keywords, keywords: kw });
  }
  if (model.highlights?.length) head.push({ k: "highlights", label: L.highlights, items: model.highlights });

  /* ── tana ── */
  const body: BodyItem[] = [];
  const drawnTables = new Set<string>();
  let formulaN = 0;
  const tableItem = (t: DocTable, path: string): BodyItem => {
    const n = numbers.tables[t.id!];
    drawnTables.add(t.id!);
    return { k: "table", tableId: t.id!, table: t, number: n, caption: `${L.table(n)} ${cites(t.caption ?? "").text}`.trim(), path };
  };
  const textItem = (b: Extract<Block, { kind: "p" | "li" | "quote" }>, path: string): BodyItem => {
    const r = cites(b.text);
    return { k: b.kind, text: r.text, spans: r.spans, path };
  };
  const pushBlocks = (blocks: Block[], path: string, sub: { chapter: number; n: number }) => {
    blocks.forEach((b, bi) => {
      const p = `${path}.blocks.${bi}`;
      switch (b.kind) {
        case "h1":
          body.push({ k: "h1", text: b.text, title: b.text, sectionId: "", path: p });
          break;
        case "h2": {
          const number = numbered ? `${sub.chapter}.${++sub.n}.` : undefined;
          body.push({ k: "h2", text: number ? `${number} ${b.text}` : b.text, title: b.text, number, path: p });
          break;
        }
        case "h3":
          body.push({ k: "h3", text: b.text, path: p });
          break;
        case "code":
          body.push({ k: "code", text: b.text, caption: b.caption, path: p });
          break;
        case "figure": {
          const f = figures.get(b.figureId);
          if (f?.fallbackBlocks?.length) {
            pushBlocks(f.fallbackBlocks, p, sub);
            break;
          }
          const n = numbers.figures[b.figureId];
          const word = SCHEME_WORD[langKey(language)][f?.kind === "chart" ? "chart" : "scheme"];
          const cap = (b.text || f?.caption || "").trim();
          body.push({
            k: "figure",
            figureId: b.figureId,
            figure: f,
            number: n,
            caption: `${L.figure(n)} ${cites(cap).text}`.trim(),
            placeholder: `[${L.figureRef(n)} — ${word}]`,
            path: p,
          });
          break;
        }
        case "tableRef": {
          const t = tables.get(b.tableId);
          if (t && !drawnTables.has(b.tableId)) body.push(tableItem(t, p));
          break;
        }
        case "formula":
          body.push({ k: "formula", latex: b.text, number: `(${++formulaN})`, display: b.display !== false, path: p });
          break;
        default:
          body.push(textItem(b, p));
      }
    });
  };
  sections.forEach((s, si) => {
    // `doc.sections` indeksi (bo'sh bo'limlar tashlab ketilgan bo'lsa ham) — tahrir yo'li uchun.
    const index = doc.sections.indexOf(s);
    const chapter = si + 1;
    const number = numbered ? `${chapter}.` : undefined;
    body.push({ k: "h1", text: number ? `${number} ${s.title}` : s.title, title: s.title, number, sectionId: s.id, path: `sections.${index}.title` });
    pushBlocks(s.blocks, `sections.${index}`, { chapter, n: 0 });
    for (const t of doc.tables ?? []) {
      if (t.id && t.anchor === s.id && !drawnTables.has(t.id)) body.push(tableItem(t, `tables.${(doc.tables ?? []).indexOf(t)}`));
    }
  });
  for (const t of doc.tables ?? []) {
    if (t.id && !drawnTables.has(t.id)) body.push(tableItem(t, `tables.${(doc.tables ?? []).indexOf(t)}`));
  }

  return {
    legacy,
    model,
    type,
    profile,
    cite,
    language,
    labels: L,
    head,
    body,
    refsLabel: L.references,
    refs,
    ...(refs2 ? { refs2Label: L.referencesEnglish, refs2 } : {}),
    numbers,
    tableCaptionAlign: cite === "apa7" || cite === "ieee" ? "left" : "right",
    headingAlign: numbered ? "left" : "center",
    numberedSections: numbered,
  };
}

export function figureNumber(plan: ArticlePlan, figureId: string): string | undefined {
  return plan.numbers.figures[figureId];
}

export function tableNumber(plan: ArticlePlan, tableId: string): string | undefined {
  return plan.numbers.tables[tableId];
}
