/**
 * OpenAlex (CC0) — ilmiy manbalar qidiruvi (Maqola 2).
 *
 * Model manba O'YLAB TOPMAYDI: dvigatel shu yerdan topilgan ro'yxatni
 * beradi va model faqat undagi `[W…]` id lari bilan iqtibos qiladi.
 * OpenAlex id (`W2741809807`) tanlangan, chunki uni raqam kabi «taxmin
 * qilib» bo'lmaydi — `[3]` ni model o'ylab topishi mumkin, `[W2741809807]`
 * ni emas; reyestrda yo'q id `verifyCitations` da o'chiriladi.
 *
 * API: `/works?search=…&filter=…&per-page=…&select=…&mailto=…&api_key=…`.
 * `select` minimal — javob hajmi (va kesh qatori) kichik qolsin.
 * Kalit (`OPENALEX_API_KEY`) bo'lmasa ham ishlaydi (2026-02 dan kunlik
 * bepul limit kalit bilan beriladi; kalitsiz — umumiy hovuz).
 */
import type { Reference } from "../article/types";
import { cached, queryKey } from "./cache";
import { getJson, withParams, type HttpOpts } from "./http";

const BASE = "https://api.openalex.org/works";
const SELECT = "id,title,publication_year,doi,authorships,primary_location,cited_by_count,abstract_inverted_index";
const CACHE_DAYS = 30;

/** `Reference` + qidiruvga xos maydonlar (tanlash promptida ishlatiladi, hujjatga tushmaydi). */
export type OpenAlexWork = Reference & { abstract?: string; citedBy?: number };

export type SearchOpts = HttpOpts & {
  fromYear?: number;
  perPage?: number;
  /** Faqat DOI li ishlar (tasdiqlanadigan manba) — standart `true`. */
  requireDoi?: boolean;
};

type RawWork = {
  id?: string;
  title?: string | null;
  display_name?: string | null;
  publication_year?: number | null;
  doi?: string | null;
  authorships?: { author?: { display_name?: string | null } | null }[] | null;
  primary_location?: { source?: { display_name?: string | null } | null; landing_page_url?: string | null } | null;
  cited_by_count?: number | null;
  abstract_inverted_index?: Record<string, number[]> | null;
};

function apiKey(): string {
  return (process.env.OPENALEX_API_KEY || "").trim();
}

function mailto(): string {
  return (process.env.OPENALEX_MAILTO || process.env.CROSSREF_MAILTO || "").trim();
}

/** `https://openalex.org/W123` → `W123`. */
export function openAlexId(raw: unknown): string {
  const t = String(raw ?? "").trim();
  const m = t.match(/(W\d{4,})$/i);
  return m ? m[1].toUpperCase() : "";
}

/** `https://doi.org/10.1/x` → `10.1/x` (OpenAlex DOI ni doim prefiks bilan beradi). */
export function stripDoi(raw: unknown): string {
  const t = String(raw ?? "")
    .trim()
    .replace(/^(?:https?:\/\/)?(?:dx\.)?doi\.org\//i, "")
    .replace(/^doi\s*:?\s*/i, "");
  return /^10\.\d{4,9}\/\S+$/i.test(t) ? t : "";
}

/**
 * Inverted index → matn. OpenAlex annotatsiyani `{so'z: [pozitsiyalar]}`
 * ko'rinishida beradi (huquqiy sabab); tiklash — pozitsiya bo'yicha
 * tartiblash. ≤600 belgi: tanlash promptiga sig'sin.
 */
export function abstractFromInvertedIndex(idx: Record<string, number[]> | null | undefined, max = 600): string {
  if (!idx || typeof idx !== "object") return "";
  const slots: string[] = [];
  for (const [word, positions] of Object.entries(idx)) {
    if (!Array.isArray(positions)) continue;
    for (const p of positions) if (Number.isInteger(p) && p >= 0 && p < 5000) slots[p] = word;
  }
  const text = slots.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 40))}…`;
}

/** Bitta OpenAlex yozuvi → `Reference` (`verified: "openalex"`). Sarlavhasiz/id siz → `null`. */
export function referenceFromWork(w: RawWork | null | undefined): OpenAlexWork | null {
  if (!w) return null;
  const id = openAlexId(w.id);
  const title = String(w.title ?? w.display_name ?? "").replace(/\s+/g, " ").trim();
  if (!id || !title) return null;
  const authors = (w.authorships ?? [])
    .map((a) => String(a?.author?.display_name ?? "").trim())
    .filter(Boolean)
    .slice(0, 6);
  const ref: OpenAlexWork = { id, title, authors, verified: "openalex", cited: false };
  const doi = stripDoi(w.doi);
  if (doi) ref.doi = doi;
  if (Number.isInteger(w.publication_year)) ref.year = Number(w.publication_year);
  const venue = String(w.primary_location?.source?.display_name ?? "").trim();
  if (venue) ref.venue = venue;
  const url = String(w.primary_location?.landing_page_url ?? "").trim();
  if (/^https?:\/\//.test(url)) ref.url = url;
  else if (doi) ref.url = `https://doi.org/${doi}`;
  if (Number.isInteger(w.cited_by_count)) ref.citedBy = Number(w.cited_by_count);
  const abs = abstractFromInvertedIndex(w.abstract_inverted_index);
  if (abs) ref.abstract = abs;
  return ref;
}

/**
 * Qidiruv. `fromYear` — `publication_year:>N` filtri (profil «oxirgi
 * N yil» talabi uchun yosh manbalar ko'proq bo'lsin); natija OpenAlex
 * relevance tartibida (`sort` berilmaydi).
 */
export async function searchWorks(query: string, opts: SearchOpts = {}): Promise<OpenAlexWork[]> {
  const q = query.replace(/\s+/g, " ").trim();
  if (!q) return [];
  const perPage = Math.max(1, Math.min(50, opts.perPage ?? 25));
  const filters: string[] = [];
  if (opts.fromYear) filters.push(`publication_year:>${opts.fromYear - 1}`);
  if (opts.requireDoi !== false) filters.push("has_doi:true");
  const url = withParams(BASE, {
    search: q,
    filter: filters.join(",") || undefined,
    "per-page": perPage,
    select: SELECT,
    mailto: mailto() || undefined,
    api_key: apiKey() || undefined,
  });
  const key = queryKey("q:openalex", `${q}|${opts.fromYear ?? ""}|${perPage}|${opts.requireDoi === false ? "any" : "doi"}`);
  const raw = await cached(key, CACHE_DAYS, async () => {
    const res = await getJson(url, opts);
    if (!res.ok) {
      console.warn(`[openalex] qidiruv «${q.slice(0, 60)}»: ${res.error}`);
      return null;
    }
    const results = (res.json as { results?: RawWork[] } | null)?.results;
    return Array.isArray(results) ? results : null;
  });
  if (!raw) return [];
  return raw.map(referenceFromWork).filter((r): r is OpenAlexWork => Boolean(r));
}

/** Bitta ish — `W…` id yoki DOI bo'yicha (`/works/W123`, `/works/https://doi.org/…`). */
export async function getWork(id: string, opts: HttpOpts = {}): Promise<OpenAlexWork | null> {
  const wid = openAlexId(id);
  const doi = wid ? "" : stripDoi(id);
  if (!wid && !doi) return null;
  const path = wid ? wid : `https://doi.org/${doi}`;
  const url = withParams(`${BASE}/${encodeURIComponent(path)}`, {
    select: SELECT,
    mailto: mailto() || undefined,
    api_key: apiKey() || undefined,
  });
  const raw = await cached(`openalex:${wid || doi}`, CACHE_DAYS, async () => {
    const res = await getJson(url, opts);
    if (!res.ok) {
      if (res.status !== 404) console.warn(`[openalex] ${path}: ${res.error}`);
      return null;
    }
    return res.json as RawWork;
  });
  return referenceFromWork(raw);
}
