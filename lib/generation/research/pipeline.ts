/**
 * Manba yig'ish quvuri (Maqola 2) — `collectReferences`.
 *
 *   (a) foydalanuvchi manbalari BIRINCHI: DOI → Crossref tasdiq; erkin
 *       matn → Crossref bibliografik qidiruv; topilmasa `verified:"user"`
 *       (matn `raw` da saqlanadi — foydalanuvchi bergan narsa yo'qolmaydi);
 *   (b) `research` yoqilgan bo'lsa: `fast` rol 4–6 qidiruv so'rovi tuzadi
 *       (mavzu + kalit so'zlar; inglizcha + hujjat tilida) → OpenAlex
 *       (`fromYear = yil − 8`) → dedup (DOI / normallashtirilgan sarlavha)
 *       → `researcher` rol FAQAT berilgan ro'yxatdan `refsMin..refsMax` ta
 *       id tanlaydi (`{ids:[…]}`); noma'lum id tashlanadi;
 *   (c) natija `Reference[]` (`cited:false`) + statistika (PRISMA va
 *       hisobot uchun).
 *
 * Model bu yerda MANBA YOZMAYDI — faqat so'rov tuzadi va tanlaydi.
 * Ro'yxat bo'sh chiqishi XATO EMAS (OpenAlex tushsa maqola baribir
 * chiqadi, hisobotda qizil) — mahsulot egasi qarori: manba ulushi HARD
 * darvoza emas.
 */
import type { DocMeta } from "../types";
import type { Reference } from "../article/types";
import type { ArticleInput, ArticleUserRef } from "../article/input";
import { PUBLICATION_PROFILES } from "../article/profiles";
import { mapPool, remainingMs } from "../quality";
import { parseLlmObject } from "../json";
import type { complete as completeRole } from "../llm-roles";
import { searchWorks, type OpenAlexWork } from "./openalex";
import { searchBibliographic, verifyDoi } from "./crossref";
import type { HttpOpts } from "./http";
import { queriesPrompt, researchSystemPrompt, selectRefsPrompt } from "../article/prompts";

export type CompleteFn = typeof completeRole;

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
    else if (u.raw) found = await searchBibliographic(u.raw, opts);
    else if (u.title) found = await searchBibliographic([u.authors?.join(", "), u.title, u.year].filter(Boolean).join(". "), opts);
    if (!found) return fallback;
    return { ...found, id: u.id, cited: false, ...(u.raw ? { raw: u.raw } : {}) };
  });
}

/** Dedup: DOI (kichik harf) → sarlavha (normallashtirilgan). Birinchi uchragani qoladi. */
export function dedupeReferences<T extends Reference>(refs: T[]): T[] {
  const seenDoi = new Set<string>();
  const seenTitle = new Set<string>();
  const seenId = new Set<string>();
  const out: T[] = [];
  for (const r of refs) {
    const doi = r.doi?.toLowerCase();
    const title = normalizeTitle(r.title);
    if (seenId.has(r.id)) continue;
    if (doi && seenDoi.has(doi)) continue;
    if (title.length > 12 && seenTitle.has(title)) continue;
    seenId.add(r.id);
    if (doi) seenDoi.add(doi);
    if (title) seenTitle.add(title);
    out.push(r);
  }
  return out;
}

/** Model tuzgan so'rovlar bo'lmasa — mavzu + kalit so'zlardan deterministik to'plam. */
export function fallbackQueries(input: ArticleInput): string[] {
  const topic = input.topic.trim();
  const out = new Set<string>();
  if (topic) out.add(topic);
  for (const k of input.keywords.slice(0, 3)) if (topic) out.add(`${topic} ${k}`);
  if (input.keywords.length >= 2) out.add(input.keywords.slice(0, 3).join(" "));
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
 * Model tanlamasa/kam tanlasa — deterministik to'ldirish: iqtibos soni
 * bo'yicha (OpenAlex `cited_by_count`), oxirgi yillar ustun. Model
 * tanlovi HAM shu ro'yxatdan — ya'ni «tanlash» hech qachon reyestrdan
 * tashqariga chiqmaydi.
 */
export function rankCandidates(cands: OpenAlexWork[], recentFrom: number): OpenAlexWork[] {
  return [...cands].sort((a, b) => {
    const ra = (a.year ?? 0) >= recentFrom ? 1 : 0;
    const rb = (b.year ?? 0) >= recentFrom ? 1 : 0;
    if (ra !== rb) return rb - ra;
    return (b.citedBy ?? 0) - (a.citedBy ?? 0);
  });
}

export async function collectReferences(input: ArticleInput, meta: DocMeta, opts: CollectOpts): Promise<CollectResult> {
  const stageDeadline = Math.min(opts.deadline, Date.now() + RESEARCH_STAGE_MS);
  const http: HttpOpts = { fetchImpl: opts.fetchImpl, retryBaseMs: opts.retryBaseMs };
  const profile = PUBLICATION_PROFILES[input.pubProfile];
  const year = opts.year ?? meta.year ?? new Date().getFullYear();
  const stats: ResearchStats = { user: input.userRefs.length, userVerified: 0, queries: [], found: 0, candidates: 0, selected: 0, failedQueries: 0 };

  // (a) Foydalanuvchi manbalari — doim, `research` o'chiq bo'lsa ham.
  const userRefs = await resolveUserRefs(input.userRefs, http, stageDeadline);
  stats.userVerified = userRefs.filter((r) => r.verified === "crossref").length;

  if (!input.research) return { refs: userRefs, stats };
  if (remainingMs(stageDeadline) < 5_000) {
    console.warn("[research] byudjet yetmadi — faqat foydalanuvchi manbalari");
    return { refs: userRefs, stats };
  }

  // (b1) Qidiruv so'rovlari — `fast` rol; javob bo'lmasa deterministik.
  const sys = researchSystemPrompt();
  const qRes = await opts.complete("fast", sys, queriesPrompt(input), { json: true, maxTokens: 400, timeoutMs: Math.min(12_000, remainingMs(stageDeadline)) });
  opts.onUsage?.(qRes?.usage);
  let queries = parseQueries(qRes?.text);
  if (queries.length < 3) queries = [...new Set([...queries, ...fallbackQueries(input)])].slice(0, 6);
  stats.queries = queries;

  // (b2) OpenAlex — parallel (3), har so'rov o'z timeouti bilan.
  const fromYear = year - 8;
  const results = await mapPool(queries, 3, async (q) => {
    if (remainingMs(stageDeadline) < 2_000) return [];
    const works = await searchWorks(q, { ...http, fromYear, perPage: OPENALEX_PER_QUERY, timeoutMs: Math.min(CALL_TIMEOUT_MS, remainingMs(stageDeadline)) });
    if (!works.length) stats.failedQueries++;
    return works;
  });
  const flat = results.flat();
  stats.found = flat.length;

  // Dedup: foydalanuvchi manbalari bilan ham (bir DOI ikki marta chiqmasin — `u1` ustun).
  const merged = dedupeReferences<Reference>([...userRefs, ...flat]);
  const candidates = merged.filter((r): r is OpenAlexWork => r.verified === "openalex");
  stats.candidates = candidates.length;
  if (!candidates.length) {
    console.warn(`[research] OpenAlex nomzod topilmadi (${queries.length} so'rov, ${stats.failedQueries} xato)`);
    return { refs: userRefs, stats };
  }

  // (b3) Tanlash — `researcher` rol, FAQAT nomzodlar ro'yxatidan.
  const want = { min: Math.max(3, Math.min(profile.refsMin, candidates.length)), max: Math.min(profile.refsMax, candidates.length) };
  const ranked = rankCandidates(candidates, year - profile.recentYearsMin);
  const shortlist = ranked.slice(0, CANDIDATE_CAP);
  const byId = new Map<string, Reference>(shortlist.map((c) => [c.id.toUpperCase(), c]));
  let chosen: string[] = [];
  if (remainingMs(stageDeadline) > 5_000) {
    const sRes = await opts.complete("researcher", sys, selectRefsPrompt(input, shortlist, want), {
      json: true,
      maxTokens: 900,
      timeoutMs: Math.min(15_000, remainingMs(stageDeadline)),
    });
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
  return { refs: [...userRefs, ...selected], stats };
}
