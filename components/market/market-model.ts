import { ApiError, PriceChangedError } from "@/lib/api-client";
import { MARKET_SUBJECTS, isMarketSubject } from "@/lib/market/subjects";
import { MARKET_TOOL_IDS, isDeckTool, isMarketTool, marketFamilyOf } from "@/lib/market/registry";
import type { MarketCard, MarketItemView, MarketLevel, MarketSort, MarketSubjectId, PurchaseFields } from "@/lib/market/types";
import { safeReturnTo } from "@/lib/safe-return";
import { TOOL_BY_ID } from "@/lib/tools";
import type { ToolId } from "@/lib/types";

/**
 * Pure model of the market pages (docs/market/PLAN.md §5): labels, filters ⇄ URL, the preview gallery plan, the buyer's
 * title-page fields, the top-up return path and the purchase errors. Everything money comes from the server: this file
 * never computes a price, the discount badge only compares the two numbers the server sent.
 */

export const MARKET_HOME = "/uz/market";
export const MARKET_PURCHASES = "/uz/market/purchases";
export const itemHref = (id: string): string => `${MARKET_HOME}/${id}`;

/** Search starts from this many characters (the API refuses less, §3.1). */
export const SEARCH_MIN = 2;
export const SEARCH_MAX = 100;
/** The catalog page size of the API. */
export const PAGE_SIZE = 24;
/** The last page the preview pipeline ever draws (`lib/server/market/previews.ts`). */
export const LAST_PREVIEW_PAGE = 6;

export type MarketFilters = { tool: ToolId | ""; subject: MarketSubjectId | ""; level: MarketLevel | ""; sort: MarketSort; q: string };

export const NO_FILTERS: MarketFilters = { tool: "", subject: "", level: "", sort: "new", q: "" };

export const SORT_OPTIONS: readonly { value: MarketSort; label: string }[] = [
  { value: "new", label: "Yangi" },
  { value: "popular", label: "Ommabop" },
  { value: "cheap", label: "Arzon" },
  { value: "rating", label: "Yuqori baho" },
];

export const LEVEL_OPTIONS: readonly { value: MarketLevel | ""; label: string }[] = [
  { value: "", label: "Hammasi" },
  { value: "maktab", label: "Maktab" },
  { value: "kollej", label: "Kollej" },
  { value: "otm", label: "OTM" },
];

export const SUBJECT_OPTIONS: readonly { value: MarketSubjectId | ""; label: string }[] = [
  { value: "", label: "Barcha fanlar" },
  ...MARKET_SUBJECTS.map((s) => ({ value: s.id, label: s.label })),
];

/** The chips in the catalog: every tool the market sells, in the registry order. */
export const TOOL_CHIPS: readonly { id: ToolId; label: string }[] = MARKET_TOOL_IDS.map((id) => ({ id, label: TOOL_BY_ID[id]?.title ?? id }));

const isSort = (v: unknown): v is MarketSort => SORT_OPTIONS.some((o) => o.value === v);
const isLevel = (v: unknown): v is MarketLevel => v === "maktab" || v === "kollej" || v === "otm";

/** The URL is untrusted: anything unknown reads as «no filter». */
export function parseFilters(params: Pick<URLSearchParams, "get"> | null | undefined): MarketFilters {
  const tool = params?.get("tool");
  const subject = params?.get("subject");
  const level = params?.get("level");
  const sort = params?.get("sort");
  return {
    tool: isMarketTool(tool) ? tool : "",
    subject: isMarketSubject(subject) ? subject : "",
    level: isLevel(level) ? level : "",
    sort: isSort(sort) ? sort : "new",
    q: (params?.get("q") ?? "").slice(0, SEARCH_MAX),
  };
}

/** Only what differs from the defaults, so the plain catalog keeps its clean URL. */
export function filtersToSearch(f: MarketFilters): URLSearchParams {
  const out = new URLSearchParams();
  if (f.tool) out.set("tool", f.tool);
  if (f.subject) out.set("subject", f.subject);
  if (f.level) out.set("level", f.level);
  if (f.sort !== "new") out.set("sort", f.sort);
  const q = f.q.trim();
  if (q.length >= SEARCH_MIN) out.set("q", q);
  return out;
}

/** Filters behind the phone's «Filtr» button (the tool chips stay outside it): its badge. */
export const sheetFilterCount = (f: MarketFilters): number => [f.subject, f.level, f.sort !== "new"].filter(Boolean).length;

export const hasFilters = (f: MarketFilters): boolean => filtersToSearch(f).size > 0;

export const toolTitle = (id: string): string => TOOL_BY_ID[id as ToolId]?.title ?? "Ish";

const LANGUAGES: Readonly<Record<string, string>> = { uz: "O'zbekcha", "uz-cyr": "Kirill", ru: "Ruscha", en: "Inglizcha" };
export const languageLabel = (code: string): string => LANGUAGES[code] ?? code.toUpperCase();

export const levelLabel = (level: MarketLevel): string => LEVEL_OPTIONS.find((o) => o.value === level)?.label ?? "OTM";

/** «18 bet» / «12 slayd»; empty when the size is unknown. */
export function sizeLabel(c: Pick<MarketCard, "pages" | "slideCount">): string {
  if (c.slideCount) return `${c.slideCount} slayd`;
  return c.pages ? `${c.pages} bet` : "";
}

/** «Referat · 18 bet · O'zbekcha». */
export function metaLine(c: Pick<MarketCard, "toolId" | "pages" | "slideCount" | "language">): string {
  return [toolTitle(c.toolId), sizeLabel(c), languageLabel(c.language)].filter(Boolean).join(" · ");
}

/** The badge «−50 %». `0` when there is nothing to show (no original price, or no discount). */
export function discountPercent(c: Pick<MarketCard, "price" | "originalPrice">): number {
  if (c.originalPrice <= 0 || c.price >= c.originalPrice) return 0;
  return Math.round((1 - c.price / c.originalPrice) * 100);
}

/** Decks are 16:9, documents 3:4. */
export const isWideCover = (toolId: string): boolean => isDeckTool(toolId);

export const previewUrlOf = (cover: string, page: number): string => cover.replace("/preview/1", `/preview/${page}`);

export type GalleryPage = { page: number; url: string; kind: "page" | "stub" };

/** Readable pages first, then blurred stubs: the pages after them, never past the last one the pipeline draws. */
export function galleryPages(v: Pick<MarketItemView, "cover" | "previewPages" | "totalPages">): GalleryPage[] {
  const readable = v.totalPages ? Math.min(v.previewPages, v.totalPages) : v.previewPages;
  const last = v.totalPages ? Math.min(v.totalPages, LAST_PREVIEW_PAGE) : readable;
  const out: GalleryPage[] = [];
  for (let page = 1; page <= Math.max(readable, last); page += 1) {
    out.push({ page, url: previewUrlOf(v.cover, page), kind: page <= readable ? "page" : "stub" });
  }
  return out;
}

/** «Nima olasiz» (§5.3): the promise of a copy, by what the tool produces. */
export function benefitsOf(toolId: string): string[] {
  const deck = TOOL_BY_ID[toolId as ToolId]?.output === "pptx";
  return [
    deck ? "PowerPoint (PPTX) va PDF fayl" : "Word (DOCX) va PDF fayl",
    "Saytda ko'rish va tahrirlash",
    "Telegramga yuborish",
    deck ? "Birinchi slaydda o'z ismingiz" : "Titul sahifa o'z ismingiz bilan",
  ];
}

/** Title-page fields of a copy, by family, in the form order; what the tool requires is always among them. */
const FIELDS_BY_FAMILY = {
  slides: ["author", "university", "group"],
  essay: ["author", "university", "group"],
  thesis: ["author", "university", "city"],
  teacher: ["author", "university", "city"],
  work: ["author", "university", "faculty", "department", "group", "course", "teacher", "city"],
} as const satisfies Record<string, readonly (keyof PurchaseFields)[]>;

export function buyerFieldIds(toolId: string, required: readonly string[]): (keyof PurchaseFields)[] {
  const family = marketFamilyOf(toolId);
  // Konspekt shares the slides family for its copy cap, but its first page is a student's title page.
  const base: readonly (keyof PurchaseFields)[] = toolId === "konspekt" ? FIELDS_BY_FAMILY.work : family ? FIELDS_BY_FAMILY[family] : FIELDS_BY_FAMILY.slides;
  const extra = required.filter((k) => !base.includes(k as keyof PurchaseFields)) as (keyof PurchaseFields)[];
  return [...base, ...extra];
}

export const BUYER_LABELS: Readonly<Record<keyof PurchaseFields, string>> = {
  author: "Muallif",
  university: "OTM",
  faculty: "Fakultet",
  department: "Kafedra",
  group: "Guruh",
  course: "Kurs",
  teacher: "O‘qituvchi",
  city: "Shahar",
};

/** A school document says «Muassasa», the rest «OTM» (the form of the tool does the same). */
export const buyerLabelOverrides = (toolId: string): Partial<Record<keyof PurchaseFields, string>> =>
  marketFamilyOf(toolId) === "teacher" ? { university: "Muassasa" } : {};

export function missingBuyerFields(fields: PurchaseFields, required: readonly string[]): (keyof PurchaseFields)[] {
  return required.filter((k) => !(fields[k as keyof PurchaseFields] ?? "").trim()) as (keyof PurchaseFields)[];
}

/** Sent to the server: only non-empty, trimmed values of the fields on screen. */
export function purchaseFields(values: PurchaseFields, ids: readonly (keyof PurchaseFields)[]): PurchaseFields {
  const out: PurchaseFields = {};
  for (const id of ids) {
    const v = (values[id] ?? "").trim();
    if (v) out[id] = v;
  }
  return out;
}

/** The item page reopens the confirm sheet from here (§2.4). */
export const buyReturnPath = (id: string): string => `${itemHref(id)}?buy=1`;

export const walletReturnHref = (id: string): string => `/uz/wallet?return=${encodeURIComponent(buyReturnPath(id))}`;

/** Only a way back into the market: `?return=` is untrusted input. */
export function safeMarketReturn(v: unknown): string | null {
  const safe = safeReturnTo(v);
  return safe && safe.startsWith(`${MARKET_HOME}/`) ? safe : null;
}

/** What a refused purchase means to the sheet. */
export type PurchaseProblem =
  | { kind: "insufficient"; required: number | null; available: number | null; message: string }
  | { kind: "price_changed"; price: number }
  | { kind: "already_owned"; generationId: string | null }
  | { kind: "gone"; message: string }
  | { kind: "university_cap"; message: string }
  | { kind: "channel"; message: string }
  | { kind: "closed" }
  | { kind: "paused"; message: string }
  | { kind: "error"; message: string; retrySameKey: boolean };

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function purchaseProblem(e: unknown): PurchaseProblem {
  if (e instanceof PriceChangedError) return { kind: "price_changed", price: e.price };
  if (!(e instanceof ApiError)) return { kind: "error", message: "Xarid amalga oshmadi. Qayta urinib ko'ring.", retrySameKey: true };
  const code = e.data.code;
  if (e.status === 402) return { kind: "insufficient", required: num(e.data.required), available: num(e.data.available), message: e.message };
  if (code === "already_owned") return { kind: "already_owned", generationId: typeof e.data.generationId === "string" ? e.data.generationId : null };
  if (code === "gone" || code === "sold_out" || e.status === 410) return { kind: "gone", message: code === "sold_out" ? "Bu ish sotilib bo'ldi." : "Bu ish endi sotuvda yo'q." };
  if (code === "university_cap") return { kind: "university_cap", message: "Bu ish sizning muassasangizda allaqachon olingan. Boshqa variantni tanlang." };
  if (code === "channel_required" || code === "telegram_required") return { kind: "channel", message: e.message };
  if (code === "market_disabled") return { kind: "closed" };
  if (code === "paused") return { kind: "paused", message: "Hozircha xarid to'xtatilgan. Birozdan keyin urinib ko'ring." };
  // No answer or a server failure: the charge may have gone through, the retry must carry the same key.
  const unsure = e.status === 0 || e.status === 408 || e.status >= 500;
  return { kind: "error", message: e.message, retrySameKey: unsure };
}
