/**
 * lex.uz — NORMATIV HUJJAT manbalari (Talaba ishlari 2, AUDIT-19 WP-B).
 *
 * Huquqiy, iqtisodiy va pedagogik kurs ishlarida adabiyotlar ro'yxati
 * QONUN bilan boshlanadi (O'zbekiston qoidasi: qonun → Prezident farmon/
 * qarori → VM qarori → vazirlik hujjati → kitob → maqola → internet).
 * lex.uz da ochiq qidiruv API si YO'Q, shuning uchun ikki qadam:
 *
 *   1. `complete("fast", …)` — model SHU MAVZUGA tegishli hujjatlarni
 *      sanaydi (nomi, turi, raqami, sanasi, `https://lex.uz/docs/<N>`);
 *      bilmasa BO'SH ro'yxat berishi talab qilinadi;
 *   2. har havola FETCH qilinadi va sahifaning o'zi model bergan
 *      RAQAM yoki SANA yoki SARLAVHA so'zlarining ≥60 % ini tasdiqlashi
 *      shart. Tasdiqlanmasa — RAD (`rejected++`), hujjatga TUSHMAYDI.
 *
 * Mahsulot egasi qarori: uydirma manba HECH QACHON. Model «O'RQ-999-son
 * Raqamli ta'lim to'g'risida»gi mavjud bo'lmagan qonunni ishonch bilan
 * yozib berishi ma'lum holat — shuning uchun tasdiqsiz yozuv ro'yxatga
 * kirmaydi; yetmasa hisobot «N ta manba yetishmayapti» deydi.
 *
 * Fetch umuman ishlamasa (403/timeout — lex.uz bot filtri) natija `null`
 * emas, `{ok:false, reason:"blocked"}`: bu XATO emas, shunchaki manba
 * qo'shilmaydi (`stats.blocked`). Bloklangan javob KESHLANMAYDI (o'tkinchi),
 * rad etilgani esa keshlanadi — bir mavzu qayta yaratilganda o'sha
 * uydirma havolaga qayta urinmaslik uchun.
 *
 * Grounding: `llm-roles.ts complete()` da grounding opsiyasi YO'Q, va
 * `llm.ts` grounding + JSON ni ataylab taqiqlaydi («ikki chaqiruv qiling»)
 * — bu yerda javob JSON bo'lgani uchun oddiy `fast` chaqiruvi ishlatiladi.
 */
import type { Reference } from "../types";
import { parseLlmObject } from "../json";
import type { complete as completeRole } from "../llm-roles";
import { mapPool, remainingMs } from "../quality";
import { cached } from "./cache";
import { getText, type HttpOpts } from "./http";

export const LEX_DOC_BASE = "https://lex.uz/docs/";
export const LEX_CACHE_DAYS = 30;
export const LEX_TIMEOUT_MS = 8_000;
/** Bir mavzuga eng ko'pi bilan nechta hujjat so'raladi. */
export const LEX_MAX = 6;
/** Sarlavha so'zlarining sahifada topilishi kerak bo'lgan ulushi. */
export const LEX_TITLE_MATCH = 0.6;
/** Sarlavha tasdig'i shuncha uzun so'zdan kam bo'lsa hal qiluvchi emas. */
export const LEX_TITLE_MIN_WORDS = 3;

export type CompleteFn = typeof completeRole;

export const LAW_TYPES = ["law", "decree", "resolution", "cabinet", "ministry"] as const;
export type LawType = (typeof LAW_TYPES)[number];

/** Model bergan nomzod — HALI TASDIQLANMAGAN. */
export type LawCandidate = { title: string; type: LawType; docNo?: string; docDate?: string; url: string };

export type LawVerdict = { ok: true; ref: Reference } | { ok: false; reason: "rejected" | "blocked" };

export type FindLawsOpts = {
  complete: CompleteFn;
  http?: HttpOpts;
  deadline?: number;
  max?: number;
  keywords?: string[];
  language?: "uz" | "ru" | "en";
  /** «Murojaat sanasi» — ISO; testda qat'iy. */
  today?: string;
  onUsage?: (u: NonNullable<Awaited<ReturnType<CompleteFn>>>["usage"]) => void;
};

export type LawsResult = {
  refs: Reference[];
  /** Model bergan nomzodlar soni. */
  candidates: number;
  /** Sahifa tasdiqlamagani uchun tashlangani. */
  rejected: number;
  /** Sahifaga umuman kirib bo'lmagani (403/timeout). */
  blocked: number;
};

/* ────────────────────────── prompt ────────────────────────── */

export function lawsSystemPrompt(): string {
  return "You are a legal research assistant for Uzbekistan. You never invent legal documents: if you are not certain a document exists, you omit it. Return ONLY JSON.";
}

/**
 * Model nomzodlarni sanaydi. TAQIQ ochiq yozilgan: noaniq bo'lsa bo'sh
 * ro'yxat. Baribir uydirma kelsa — ikkinchi qadam (sahifa tasdig'i) uni
 * tashlaydi; prompt yolg'iz kafolat emas.
 */
export function lawsPrompt(topic: string, keywords: string[] = [], max = LEX_MAX): string {
  return [
    `Topic: «${topic}». Keywords: ${keywords.filter(Boolean).slice(0, 8).join(", ") || "—"}.`,
    `List up to ${max} legal acts of the Republic of Uzbekistan that are DIRECTLY relevant to this topic: laws (Qonun), decrees of the President (Farmon), resolutions of the President (Qaror), resolutions of the Cabinet of Ministers, ministry orders.`,
    `For each give: "title" (official title), "type" (one of: law | decree | resolution | cabinet | ministry), "docNo" (e.g. «O‘RQ-563», «PQ-4947», «PF-60», «207-son»), "docDate" (ISO, e.g. «2019-09-20») and "url" of the form https://lex.uz/docs/<number>.`,
    `Include ONLY acts you know EXACTLY — the title, the number and the lex.uz document id must be ones you are certain about. If you are not certain about any act, return an EMPTY list. Never guess a number or a URL: every entry is checked against the lex.uz page and a wrong one is discarded.`,
    `Return JSON: {"laws":[{"title":"…","type":"law","docNo":"…","docDate":"…","url":"https://lex.uz/docs/…"}]}`,
  ].join("\n");
}

/* ────────────────────────── parse ────────────────────────── */

/** `https://lex.uz/docs/5013009` → `5013009`; boshqa host/shakl → "". */
export function lexDocId(url: unknown): string {
  const m = String(url ?? "")
    .trim()
    .match(/^https?:\/\/(?:www\.)?lex\.uz\/(?:[a-z-]+\/)*docs?\/(\d{3,12})/i);
  return m ? m[1] : "";
}

function lawTypeOf(raw: unknown): LawType {
  const t = String(raw ?? "").trim().toLowerCase();
  return (LAW_TYPES as readonly string[]).includes(t) ? (t as LawType) : "law";
}

function clean(s: unknown, max = 300): string {
  return String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

/** Model javobi → nomzodlar. Havolasi lex.uz bo'lmagan yozuv TASHLANADI. */
export function parseLawCandidates(text: string | undefined, max = LEX_MAX): LawCandidate[] {
  const o = parseLlmObject<{ laws?: unknown }>(text ?? "");
  const list = Array.isArray(o?.laws) ? o!.laws : [];
  const out: LawCandidate[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    const row = (raw ?? {}) as Record<string, unknown>;
    const id = lexDocId(row.url);
    const title = clean(row.title);
    if (!id || !title || seen.has(id)) continue;
    seen.add(id);
    const cand: LawCandidate = { title, type: lawTypeOf(row.type), url: `${LEX_DOC_BASE}${id}` };
    const docNo = clean(row.docNo, 40);
    if (docNo) cand.docNo = docNo;
    const docDate = clean(row.docDate, 20);
    if (/^\d{4}-\d{2}-\d{2}$/.test(docDate)) cand.docDate = docDate;
    out.push(cand);
    if (out.length >= max) break;
  }
  return out;
}

/* ────────────────────────── sahifa tasdig'i ────────────────────────── */

const ENTITIES: Record<string, string> = { nbsp: " ", amp: "&", quot: '"', laquo: "«", raquo: "»", ndash: "–", mdash: "—", apos: "'" };

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&([a-z]+);/gi, (_, n: string) => ENTITIES[n.toLowerCase()] ?? " ")
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** `<h1>` + `og:title` + `<title>` — tasdiq uchun eng ishonchli bo'laklar. */
export function pageHeading(html: string): string {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "";
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']*)["']/i)?.[1] ?? "";
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
  return stripTags([h1, og, title].join(" "));
}

/** Apostrof shakllari bir xil, kichik harf, faqat harf/raqam/apostrof. */
export function normalizeLexText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’ʻ`´ʼ]/g, "'")
    .replace(/[^\p{L}\p{N}']+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** «O‘RQ-563» → «ORQ563»; taqqoslash uchun (kirill/lotin farqi saqlanadi). */
export function normalizeDocNo(s: string): string {
  return s.toUpperCase().replace(/[‘’ʻ`´ʼ]/g, "").replace(/[^\p{L}\p{N}]+/gu, "");
}

/** Sahifadagi hujjat raqami — «O‘RQ-563», «ПП-4947», «207-son». */
export function docNoInPage(text: string): string {
  const m = text.match(/((?:O['‘’`ʻ]?RQ|ЗРУ|PQ|ПП|PF|УП|QR|ВМ)\s*[-–—]\s*\d{1,6})/i) ?? text.match(/(\d{1,6}\s*-\s*son)/i);
  return m ? m[1].replace(/\s+/g, "") : "";
}

/** Sahifadagi birinchi `dd.mm.yyyy` → ISO; topilmasa "". */
export function docDateInPage(text: string): string {
  const m = text.match(/\b(\d{2})\.(\d{2})\.(\d{4})\b/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
}

/** ISO `2019-09-20` → `20.09.2019`; noto'g'ri shakl → "". */
export function isoToDotted(iso: string | undefined): string {
  const m = String(iso ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : "";
}

/** Hujjatni qabul qilgan organ — GOST tavsifi shundan tuziladi. */
export function issuerOf(type: LawType, language: "uz" | "ru" | "en" = "uz"): string {
  const uz: Record<LawType, string> = {
    law: "O‘zbekiston Respublikasi",
    decree: "O‘zbekiston Respublikasi Prezidenti",
    resolution: "O‘zbekiston Respublikasi Prezidenti",
    cabinet: "O‘zbekiston Respublikasi Vazirlar Mahkamasi",
    ministry: "O‘zbekiston Respublikasi vazirligi",
  };
  const ru: Record<LawType, string> = {
    law: "Республика Узбекистан",
    decree: "Президент Республики Узбекистан",
    resolution: "Президент Республики Узбекистан",
    cabinet: "Кабинет Министров Республики Узбекистан",
    ministry: "Министерство Республики Узбекистан",
  };
  const en: Record<LawType, string> = {
    law: "Republic of Uzbekistan",
    decree: "President of the Republic of Uzbekistan",
    resolution: "President of the Republic of Uzbekistan",
    cabinet: "Cabinet of Ministers of the Republic of Uzbekistan",
    ministry: "Ministry of the Republic of Uzbekistan",
  };
  return language === "ru" ? ru[type] : language === "en" ? en[type] : uz[type];
}

export type LawMatch = { docNo: boolean; docDate: boolean; titleShare: number; verified: boolean };

/** Nomzod ↔ sahifa mosligi (sof funksiya — test va mutatsiya shu yerda). */
export function matchLawPage(cand: LawCandidate, html: string): LawMatch {
  const heading = pageHeading(html);
  const body = stripTags(html);
  const hay = normalizeLexText(`${heading} ${body}`);
  const hayNo = normalizeDocNo(`${heading} ${body}`);

  const docNo = Boolean(cand.docNo) && hayNo.includes(normalizeDocNo(cand.docNo!));
  const dotted = isoToDotted(cand.docDate);
  const docDate = Boolean(dotted) && `${heading} ${body}`.includes(dotted);

  const words = [...new Set(normalizeLexText(cand.title).split(" ").filter((w) => w.length >= 4))];
  const hits = words.filter((w) => hay.includes(w)).length;
  const titleShare = words.length ? hits / words.length : 0;
  const titleOk = words.length >= LEX_TITLE_MIN_WORDS && titleShare >= LEX_TITLE_MATCH;

  return { docNo, docDate, titleShare, verified: docNo || docDate || titleOk };
}

/**
 * Sahifa matni → hukm. Tasdiqlanmasa RAD: hujjatga uydirma qonun
 * TUSHMAYDI. Sana/raqam model bermagan bo'lsa sahifadan olinadi.
 */
export function verifyLawPage(cand: LawCandidate, html: string, today: string, language: "uz" | "ru" | "en" = "uz"): LawVerdict {
  const m = matchLawPage(cand, html);
  if (!m.verified) return { ok: false, reason: "rejected" };
  const plain = `${pageHeading(html)} ${stripTags(html)}`;
  const docNo = cand.docNo || docNoInPage(plain);
  const docDate = cand.docDate || docDateInPage(plain);
  const ref: Reference = {
    id: `lex:${lexDocId(cand.url)}`,
    kind: "law",
    title: cand.title,
    authors: [],
    verified: "lexuz",
    cited: false,
    url: cand.url,
    issuer: issuerOf(cand.type, language),
    accessed: today,
  };
  if (docNo) ref.docNo = docNo;
  if (docDate) {
    ref.docDate = docDate;
    const y = Number(docDate.slice(0, 4));
    if (y >= 1900 && y <= 2100) ref.year = y;
  }
  return ref.title ? { ok: true, ref } : { ok: false, reason: "rejected" };
}

/* ────────────────────────── fetch ────────────────────────── */

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Bitta hujjat: sahifani olib tasdiqlaydi. Kesh `lex:` 30 kun — RAD
 * ETILGAN hukm ham keshlanadi (o'sha uydirma havolaga qayta urinmaslik);
 * BLOKLANGAN esa keshlanmaydi (o'tkinchi holat).
 */
export async function fetchLaw(cand: LawCandidate, opts: HttpOpts & { today?: string; language?: "uz" | "ru" | "en" } = {}): Promise<LawVerdict> {
  const id = lexDocId(cand.url);
  if (!id) return { ok: false, reason: "rejected" };
  const stamp = opts.today ?? today();
  const verdict = await cached<LawVerdict | null>(`lex:${id}`, LEX_CACHE_DAYS, async () => {
    const res = await getText(cand.url, { retries: 1, ...opts, timeoutMs: opts.timeoutMs ?? LEX_TIMEOUT_MS });
    if (!res.ok) {
      console.warn(`[lexuz] ${cand.url}: ${res.error}`);
      return null;
    }
    return verifyLawPage(cand, res.text, stamp, opts.language);
  });
  return verdict ?? { ok: false, reason: "blocked" };
}

/**
 * Mavzuga oid normativ hujjatlar. Model javob bermasa yoki hech biri
 * tasdiqlanmasa — BO'SH ro'yxat (xato emas).
 */
export async function findLaws(topic: string, opts: FindLawsOpts): Promise<LawsResult> {
  const empty: LawsResult = { refs: [], candidates: 0, rejected: 0, blocked: 0 };
  const t = topic.trim();
  if (!t) return empty;
  const max = Math.max(1, Math.min(LEX_MAX, opts.max ?? LEX_MAX));
  const deadline = opts.deadline ?? Date.now() + 25_000;
  if (remainingMs(deadline) < 3_000) return empty;

  const res = await opts.complete("fast", lawsSystemPrompt(), lawsPrompt(t, opts.keywords ?? [], max), {
    json: true,
    maxTokens: 800,
    timeoutMs: Math.min(12_000, remainingMs(deadline)),
  });
  opts.onUsage?.(res?.usage);
  const cands = parseLawCandidates(res?.text, max);
  if (!cands.length) return empty;

  const stamp = opts.today ?? today();
  const verdicts = await mapPool(cands, 3, async (c) => {
    if (remainingMs(deadline) < 2_000) return { ok: false, reason: "blocked" } as LawVerdict;
    return fetchLaw(c, { ...(opts.http ?? {}), today: stamp, language: opts.language, timeoutMs: Math.min(LEX_TIMEOUT_MS, remainingMs(deadline)) });
  });

  const out: LawsResult = { refs: [], candidates: cands.length, rejected: 0, blocked: 0 };
  for (const v of verdicts) {
    if (v.ok) out.refs.push(v.ref);
    else if (v.reason === "blocked") out.blocked++;
    else out.rejected++;
  }
  return out;
}
