/**
 * Manba yig'ish quvuri — `collectReferencesFor(ask)` (AUDIT-19) va uning
 * maqola o'rami `collectReferences(input, meta)` (Maqola 2).
 *
 *   (a) foydalanuvchi manbalari BIRINCHI: DOI → Crossref tasdiq; ISBN →
 *       Google Books; erkin matn → Crossref bibliografik qidiruv;
 *       topilmasa `verified:"user"` (matn `raw` da saqlanadi —
 *       foydalanuvchi bergan narsa yo'qolmaydi);
 *   (b) `research` yoqilgan bo'lsa: `fast` rol 4–6 qidiruv so'rovi tuzadi
 *       (mavzu + kalit so'zlar; inglizcha + hujjat tilida) → `ask.kinds`
 *       dagi TARMOQLAR parallel: lex.uz (`law`), Google Books (`book`),
 *       OpenAlex (`article`, `fromYear`) → dedup (id/DOI/ISBN/sarlavha)
 *       → `researcher` rol FAQAT berilgan ro'yxatdan `want.min..max` ta
 *       id tanlaydi (`{ids:[…]}`); noma'lum id tashlanadi;
 *   (c) natija `Reference[]` (`cited:false`) + statistika (PRISMA va
 *       hisobot uchun; `byKind` — qaysi turdan nechta).
 *
 * Model bu yerda MANBA YOZMAYDI — faqat so'rov tuzadi va tanlaydi;
 * lex.uz nomzodlari esa sahifa bilan tasdiqlanadi (`lexuz.ts`).
 * Ro'yxat bo'sh chiqishi XATO EMAS (manba xizmati tushsa hujjat baribir
 * chiqadi, hisobotda qizil) — mahsulot egasi qarori: manba ulushi HARD
 * darvoza emas, lekin uydirma manba hech qachon qo'shilmaydi.
 */
import { REFERENCE_KINDS, kindOf, type DocMeta, type Reference, type ReferenceKind } from "../types";
import type { ArticleInput, ArticleUserRef } from "../article/input";
import { PUBLICATION_PROFILES } from "../article/profiles";
import { ARTICLE_TYPES } from "../article/types-registry";
import { mapPool, remainingMs } from "../quality";
import { parseLlmObject } from "../json";
import type { complete as completeRole } from "../llm-roles";
import { DeadlineError } from "../llm/chain";
import { searchWorks, type OpenAlexWork } from "./openalex";
import { searchBibliographic, verifyDoi } from "./crossref";
import { BOOKS_MAX_RESULTS, searchBooks, verifyIsbn } from "./googlebooks";
import { LEX_MAX, findLaws } from "./lexuz";
import type { HttpOpts } from "./http";
import { queriesPrompt, researchSystemPrompt, selectRefsPrompt } from "../article/prompts";

export type CompleteFn = typeof completeRole;

/**
 * Bosqich muddati tugagani (`DeadlineError`, audit C28) — «model javob
 * bermadi» bilan bir xil: manba tanlovi deterministik zaxiraga tushadi.
 * Boshqa istisnolar o'zgarishsiz yuqoriga ketadi.
 */
async function withinStage<T>(p: Promise<T | null>): Promise<T | null> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof DeadlineError) {
      console.warn(`[research] ${e.message}`);
      return null;
    }
    throw e;
  }
}

export type CollectOpts = {
  deadline: number;
  complete: CompleteFn;
  /** Testda OpenAlex/Crossref stub'i. */
  fetchImpl?: typeof fetch;
  /** Testda 0 — retry kutishsiz. */
  retryBaseMs?: number;
  /** `fromYear` uchun joriy yil (standart — hozirgi). */
  year?: number;
  /** Sarf hisobi. */
  onUsage?: (u: NonNullable<Awaited<ReturnType<CompleteFn>>>["usage"]) => void;
};

export type ResearchStats = {
  /** Foydalanuvchi bergan manbalar soni. */
  user: number;
  /** Shulardan Crossref tasdiqlagani. */
  userVerified: number;
  /** Tuzilgan qidiruv so'rovlari. */
  queries: string[];
  /** OpenAlex qaytargan xom natijalar (dedupdan oldin). */
  found: number;
  /** Dedupdan keyingi nomzodlar (PRISMA «identified/screened»). */
  candidates: number;
  /** Tanlangan (PRISMA «eligible»). */
  selected: number;
  /** OpenAlex chaqiruvlaridan nechtasi xato/bo'sh qaytdi. */
  failedQueries: number;
  /*
   * AUDIT-19 maydonlari IXTIYORIY: `collectReferencesFor` ularni DOIM
   * to'ldiradi, lekin eski hujjatlarning saqlangan statistikasida va
   * qo'lda tuzilgan (test/hisobot) obyektlarda ular yo'q.
   */
  /** Google Books topgan kitoblar (dedupdan oldin). */
  books?: number;
  /** lex.uz TASDIQLAGAN normativ hujjatlar. */
  laws?: number;
  /** Sahifa tasdiqlamagani uchun RAD etilgan hujjatlar (uydirma manba). */
  rejected?: number;
  /** Sahifaga umuman kirib bo'lmagani (lex.uz 403/timeout). */
  blocked?: number;
  /** Yakuniy ro'yxat turlar kesimida — hisobot uchun. */
  byKind?: Record<ReferenceKind, number>;
};

export type CollectResult = { refs: Reference[]; stats: ResearchStats };

/** Bir qidiruv so'roviga OpenAlex dan nechta natija. */
export const OPENALEX_PER_QUERY = 25;
/** Tanlash promptiga beriladigan nomzodlar soni chegarasi (token narxi). */
export const CANDIDATE_CAP = 60;
/** Butun bosqichga vaqt (reja: research 30 s). */
export const RESEARCH_STAGE_MS = 30_000;
const CALL_TIMEOUT_MS = 15_000;

/** Sarlavhani dedup uchun normallashtiradi — kichik harf, faqat harf/raqam. */
export function normalizeTitle(t: string): string {
  return t
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .slice(0, 120);
}

function userRefToReference(u: ArticleUserRef): Reference {
  const r: Reference = {
    id: u.id,
    title: u.title || (u.raw ? u.raw.slice(0, 200) : u.doi ? `DOI ${u.doi}` : "—"),
    authors: u.authors ?? [],
    verified: "user",
    cited: false,
  };
  if (u.doi) r.doi = u.doi;
  if (u.isbn) {
    r.isbn = u.isbn;
    r.kind = "book";
  }
  if (u.year) r.year = u.year;
  if (u.venue) r.venue = u.venue;
  if (u.url) r.url = u.url;
  if (u.raw) r.raw = u.raw;
  return r;
}

/**
 * (a) Foydalanuvchi manbalari. DOI → Crossref; matn → bibliografik.
 * Tasdiqlangan yozuv foydalanuvchi id sini (`u1`) SAQLAYDI — matndagi
 * iqtibos va forma qatori bir-biriga bog'liq qoladi; `raw` ham qoladi.
 */
export async function resolveUserRefs(userRefs: ArticleUserRef[], http: HttpOpts, deadline: number): Promise<Reference[]> {
  return mapPool(userRefs, 3, async (u) => {
    const fallback = userRefToReference(u);
    if (remainingMs(deadline) < 3_000) return fallback;
    const opts: HttpOpts = { ...http, timeoutMs: Math.min(CALL_TIMEOUT_MS, remainingMs(deadline)) };
    let found: Reference | null = null;
    if (u.doi) found = await verifyDoi(u.doi, opts);
    // ISBN — Google Books (AUDIT-19): kitobni Crossref bilmaydi.
    else if (u.isbn) found = await verifyIsbn(u.isbn, opts);
    else if (u.raw) found = await searchBibliographic(u.raw, opts);
    else if (u.title) found = await searchBibliographic([u.authors?.join(", "), u.title, u.year].filter(Boolean).join(". "), opts);
    if (!found) return fallback;
    return { ...found, id: u.id, cited: false, ...(u.raw ? { raw: u.raw } : {}) };
  });
}

/**
 * Dedup: id → DOI (kichik harf) → ISBN → sarlavha (normallashtirilgan).
 * Birinchi uchragani qoladi (foydalanuvchi manbalari ro'yxat boshida —
 * `u1` ustun bo'lsin).
 *
 * ISBN AUDIT-19 da qo'shildi: bir darslikning ikki nashri Google Books da
 * ikki `volumeId` bilan, biroz boshqacha sarlavha bilan keladi
 * («… (2-nashr)») — sarlavha dedupidan o'tib ketardi.
 */
export function dedupeReferences<T extends Reference>(refs: T[]): T[] {
  const seenDoi = new Set<string>();
  const seenIsbn = new Set<string>();
  const seenTitle = new Set<string>();
  const seenId = new Set<string>();
  const out: T[] = [];
  for (const r of refs) {
    const doi = r.doi?.toLowerCase();
    const isbn = r.isbn?.toUpperCase();
    const title = normalizeTitle(r.title);
    if (seenId.has(r.id)) continue;
    if (doi && seenDoi.has(doi)) continue;
    if (isbn && seenIsbn.has(isbn)) continue;
    if (title.length > 12 && seenTitle.has(title)) continue;
    seenId.add(r.id);
    if (doi) seenDoi.add(doi);
    if (isbn) seenIsbn.add(isbn);
    if (title) seenTitle.add(title);
    out.push(r);
  }
  return out;
}

/** Model tuzgan so'rovlar bo'lmasa — mavzu + kalit so'zlardan deterministik to'plam. */
export function fallbackQueries(ask: { topic: string; keywords: string[] }): string[] {
  const topic = ask.topic.trim();
  const out = new Set<string>();
  if (topic) out.add(topic);
  for (const k of ask.keywords.slice(0, 3)) if (topic) out.add(`${topic} ${k}`);
  if (ask.keywords.length >= 2) out.add(ask.keywords.slice(0, 3).join(" "));
  return [...out].filter(Boolean).slice(0, 6);
}

function parseQueries(text: string | undefined): string[] {
  const o = parseLlmObject<{ queries?: unknown }>(text ?? "");
  const list = Array.isArray(o?.queries) ? o!.queries : [];
  return list
    .map((q) => String(q ?? "").replace(/\s+/g, " ").trim())
    .filter((q) => q.length >= 3 && q.length <= 160)
    .slice(0, 6);
}

/** Tanlov: `{ids:[…]}`; FAQAT nomzodlar ichidagi id lar; tartib saqlanadi. */
export function parseSelection(text: string | undefined, candidates: Map<string, Reference>): string[] {
  const o = parseLlmObject<{ ids?: unknown }>(text ?? "");
  const list = Array.isArray(o?.ids) ? o!.ids : [];
  const out: string[] = [];
  for (const raw of list) {
    const id = String(raw ?? "").trim().toUpperCase();
    if (candidates.has(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * Nomzodlar tartibi — RELEVANTLIK bo'yicha: har so'rovning natijalari
 * OpenAlex relevance tartibida keladi, ular aylanma (round-robin)
 * aralashtiriladi — har so'rovning eng mos ishlari ro'yxat boshida.
 *
 * Ilgari to'ldirish `cited_by_count` bo'yicha edi: jonli sinovda
 * «adaptiv o'qitish» maqolasiga eng ko'p iqtibos qilingan UMUMIY
 * chuqur o'rganish sharhlari (CNN, uncertainty quantification) kirib
 * qolgan — ular mavzuga mos emas, shunchaki mashhur. Model tanlovi ham
 * to'ldirish ham shu ro'yxatdan — reyestrdan tashqariga chiqilmaydi.
 */
export function interleaveByRelevance<T>(perQuery: T[][]): T[] {
  const out: T[] = [];
  const max = Math.max(0, ...perQuery.map((l) => l.length));
  for (let i = 0; i < max; i++) for (const list of perQuery) if (i < list.length) out.push(list[i]);
  return out;
}

/* ────────────────────────── umumiy so'rov ────────────────────────── */

/**
 * Hujjatdan MUSTAQIL manba so'rovi (AUDIT-19): maqola ham, kurs ishi ham,
 * referat ham shu shakl bilan tushadi. `kinds` qaysi TARMOQLAR ishga
 * tushishini belgilaydi — maqolada `["article"]`, kurs ishida
 * `["law","book","article"]`.
 */
export type ResearchAsk = {
  topic: string;
  keywords: string[];
  language: "uz" | "ru" | "en";
  userRefs: ArticleUserRef[];
  research: boolean;
  /** Jami tanlanadigan manba (nomzodlar soni bilan kesiladi). */
  want: { min: number; max: number };
  kinds: ReferenceKind[];
  /** Mo'ljal (kurs ishi: `{law:3, book:5}`) — TALAB emas, promptga maslahat. */
  quota?: Partial<Record<ReferenceKind, number>>;
  /** OpenAlex `publication_year:>N-1` filtri. */
  fromYear?: number;
  /** Tezis/qisqa xabar — 2–4 manba yetadi. */
  tiny?: boolean;
  userFacts?: string;
  typeLabel?: string;
};

const EMPTY_BY_KIND = (): Record<ReferenceKind, number> =>
  Object.fromEntries(REFERENCE_KINDS.map((k) => [k, 0])) as Record<ReferenceKind, number>;

function emptyStats(userCount: number): ResearchStats {
  return {
    user: userCount,
    userVerified: 0,
    queries: [],
    found: 0,
    candidates: 0,
    selected: 0,
    failedQueries: 0,
    books: 0,
    laws: 0,
    rejected: 0,
    blocked: 0,
    byKind: EMPTY_BY_KIND(),
  };
}

/** Yakunda `byKind` to'ldiriladi — hisobot «3 qonun, 5 kitob, 7 maqola» deydi. */
function finish(refs: Reference[], stats: ResearchStats): CollectResult {
  stats.byKind = EMPTY_BY_KIND();
  for (const r of refs) stats.byKind[kindOf(r)]++;
  return { refs, stats };
}

export async function collectReferencesFor(ask: ResearchAsk, opts: CollectOpts): Promise<CollectResult> {
  const stageDeadline = Math.min(opts.deadline, Date.now() + RESEARCH_STAGE_MS);
  // `deadline` — har HTTP urinishi bosqich muddatidan oshmasin (audit EXT-03/EXT-07).
  const http: HttpOpts = { fetchImpl: opts.fetchImpl, retryBaseMs: opts.retryBaseMs, deadline: stageDeadline };
  const stats = emptyStats(ask.userRefs.length);

  // (a) Foydalanuvchi manbalari — doim, `research` o'chiq bo'lsa ham.
  const userRefs = await resolveUserRefs(ask.userRefs, http, stageDeadline);
  stats.userVerified = userRefs.filter((r) => r.verified === "crossref" || r.verified === "googlebooks").length;

  if (!ask.research) return finish(userRefs, stats);
  if (remainingMs(stageDeadline) < 5_000) {
    console.warn("[research] byudjet yetmadi — faqat foydalanuvchi manbalari");
    return finish(userRefs, stats);
  }

  const kinds = new Set<ReferenceKind>(ask.kinds.length ? ask.kinds : ["article"]);
  const sys = researchSystemPrompt();

  // (b1) Qidiruv so'rovlari — `fast` rol; javob bo'lmasa deterministik.
  const qRes = await withinStage(opts.complete("fast", sys, queriesPrompt(ask), { json: true, maxTokens: 400, timeoutMs: Math.min(12_000, remainingMs(stageDeadline)), deadline: stageDeadline }));
  opts.onUsage?.(qRes?.usage);
  let queries = parseQueries(qRes?.text);
  if (queries.length < 3) queries = [...new Set([...queries, ...fallbackQueries(ask)])].slice(0, 6);
  stats.queries = queries;

  /*
   * (b2) TARMOQLAR parallel. Har biri o'z xatosini o'zi yeydi (bo'sh
   * ro'yxat) — lex.uz bloklansa Google Books va OpenAlex baribir ishlaydi.
   */
  const branches: (() => Promise<Reference[]>)[] = [];

  if (kinds.has("law")) {
    branches.push(async () => {
      const res = await findLaws(ask.topic, {
        complete: opts.complete,
        http,
        deadline: stageDeadline,
        keywords: ask.keywords,
        language: ask.language,
        max: Math.max(3, Math.min(LEX_MAX, (ask.quota?.law ?? 3) + 2)),
        onUsage: opts.onUsage,
      });
      stats.laws = res.refs.length;
      stats.rejected = (stats.rejected ?? 0) + res.rejected;
      stats.blocked = (stats.blocked ?? 0) + res.blocked;
      return res.refs;
    });
  }

  if (kinds.has("book")) {
    branches.push(async () => {
      const bookQueries = [...new Set([ask.topic, ...ask.keywords.slice(0, 2).map((k) => `${ask.topic} ${k}`)])].filter(Boolean).slice(0, 3);
      const lists = await mapPool(bookQueries, 2, async (q) => {
        if (remainingMs(stageDeadline) < 2_000) return [];
        return searchBooks(q, { ...http, lang: ask.language, maxResults: BOOKS_MAX_RESULTS, timeoutMs: Math.min(CALL_TIMEOUT_MS, remainingMs(stageDeadline)) });
      });
      const books = interleaveByRelevance(lists);
      stats.books = books.length;
      return books;
    });
  }

  if (kinds.has("article")) {
    branches.push(async () => {
      const fromYear = ask.fromYear;
      const lists = await mapPool(queries, 3, async (q) => {
        if (remainingMs(stageDeadline) < 2_000) return [];
        const works = await searchWorks(q, { ...http, fromYear, perPage: OPENALEX_PER_QUERY, timeoutMs: Math.min(CALL_TIMEOUT_MS, remainingMs(stageDeadline)) });
        if (!works.length) stats.failedQueries++;
        return works;
      });
      return interleaveByRelevance(lists);
    });
  }

  const found = (await mapPool(branches, 3, (run) => run())).flat();
  stats.found = found.length;

  // Dedup: foydalanuvchi manbalari bilan ham (bir DOI/ISBN ikki marta chiqmasin — `u1` ustun).
  const merged = dedupeReferences<Reference>([...userRefs, ...found]);
  /*
   * Nomzodlar — TASDIQLANGAN, lekin foydalanuvchiniki BO'LMAGAN yozuvlar:
   * foydalanuvchi manbasi Crossref/Books orqali tasdiqlanganda ham `u1`
   * id si bilan qoladi va ro'yxatda ALLAQACHON bor — nomzodlar orasiga
   * tushsa ikki marta chiqardi.
   */
  const userIds = new Set(userRefs.map((r) => r.id));
  const candidates = merged.filter((r) => !userIds.has(r.id) && r.verified !== "user" && r.verified !== "unverified");
  stats.candidates = candidates.length;
  if (!candidates.length) {
    console.warn(`[research] nomzod topilmadi (${queries.length} so'rov, ${stats.failedQueries} xato, ${stats.rejected} rad, ${stats.blocked} bloklangan)`);
    return finish(userRefs, stats);
  }

  // (b3) Tanlash — `researcher` rol, FAQAT nomzodlar ro'yxatidan.
  /*
   * Tezis (200–300 so'z) uchun profil chegarasi (≤20) ko'p: jonli sinovda
   * 7 manba 250 so'zga tiqilib ketdi. Konferensiya tezisi amaliyoti — ≤3–4.
   */
  const want = ask.tiny
    ? { min: Math.min(2, candidates.length), max: Math.min(4, candidates.length) }
    : { min: Math.max(3, Math.min(ask.want.min, candidates.length)), max: Math.min(ask.want.max, candidates.length) };
  const shortlist = candidates.slice(0, CANDIDATE_CAP);
  const byId = new Map<string, Reference>(shortlist.map((c) => [c.id.toUpperCase(), c]));
  let chosen: string[] = [];
  if (remainingMs(stageDeadline) > 5_000) {
    const sRes = await withinStage(
      opts.complete("researcher", sys, selectRefsPrompt(ask, shortlist, want, ask.quota), {
        json: true,
        maxTokens: 900,
        timeoutMs: Math.min(15_000, remainingMs(stageDeadline)),
        deadline: stageDeadline,
      }),
    );
    opts.onUsage?.(sRes?.usage);
    chosen = parseSelection(sRes?.text, byId);
  }
  // Kam tanlansa — reytingdan to'ldiriladi; ko'p tanlansa — kesiladi.
  for (const c of shortlist) {
    if (chosen.length >= want.min) break;
    const id = c.id.toUpperCase();
    if (!chosen.includes(id)) chosen.push(id);
  }
  chosen = chosen.slice(0, want.max);
  stats.selected = chosen.length;

  const selected = chosen.map((id) => byId.get(id)!).map((c) => {
    // `abstract` promptga kerak edi, hujjatga tushmaydi (hajm); `citedBy` qoladi.
    const { abstract, ...rest } = c as OpenAlexWork;
    void abstract;
    return { ...rest, cited: false } as Reference;
  });
  return finish([...userRefs, ...selected], stats);
}

/* ────────────────────────── maqola o'rami ────────────────────────── */

/**
 * Maqola dvigateli kirishi — `ArticleInput` dan `ResearchAsk` quriladi.
 * Imzo va xatti-harakat AUDIT-17 dagidek: faqat `article` tarmog'i,
 * profil `refsMin..refsMax`, tezisda 2–4.
 */
export async function collectReferences(input: ArticleInput, meta: DocMeta, opts: CollectOpts): Promise<CollectResult> {
  const profile = PUBLICATION_PROFILES[input.pubProfile];
  const year = opts.year ?? meta.year ?? new Date().getFullYear();
  const ask: ResearchAsk = {
    topic: input.topic,
    keywords: input.keywords,
    language: input.language,
    userRefs: input.userRefs,
    research: input.research,
    want: { min: profile.refsMin, max: profile.refsMax },
    kinds: ["article"],
    fromYear: year - 8,
    tiny: (ARTICLE_TYPES[input.articleType].wordRange?.[1] ?? Infinity) <= 300,
    userFacts: input.userFacts,
    typeLabel: input.articleType,
  };
  return collectReferencesFor(ask, opts);
}
