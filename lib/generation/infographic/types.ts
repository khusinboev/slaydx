/**
 * INFOGRAFIKA (AUDIT-21 R0) — ta'lim plakatining modeli.
 * Izomorf: server/DOM/sharp importi YO'Q (`games/types.ts` naqshi).
 *
 * Bu oilada `sections` YO'Q: chiqish — bitta PNG (A4/A3 @300 dpi), ya'ni
 * hujjat MATNI plakatning O'ZI. Shuning uchun model «metama'lumot» emas,
 * to'liq SPETSIFIKATSIYA: `InfographicSpec` — LLM yozadigan yagona
 * narsa, `figures/infographic-svg.ts` (WP-C) undan SVG, `figurePng` esa
 * PNG quradi. Maket qoidalari (zona balandliklari, shrift o'lchamlari)
 * modelda emas — ular WP-C ning `layout-infographic.ts` ida.
 *
 * Manba: `docs/research/infographic.md` §3 (reyestr, JSON sxema,
 * palitralar, ikonlar) va §4 (qoidalar, judge). Raqamlar shu yerda
 * QULFLANADI (`tests/infographic-registry.test.mts`).
 */
import type { DocReview, PolishLog, UserNeed } from "../report/types";

/* ────────────────────────── turlar ────────────────────────── */

export const INFOGRAPHIC_TYPE_IDS = ["list", "process", "compare", "stat", "timeline", "cause-effect", "map-structure"] as const;
export type InfographicTypeId = (typeof INFOGRAPHIC_TYPE_IDS)[number];

export const isInfographicTypeId = (v: unknown): v is InfographicTypeId => (INFOGRAPHIC_TYPE_IDS as readonly string[]).includes(String(v));

/** Uch tilli yorliq — forma (uz), kelgusi lokalizatsiya (ru/en). */
export type InfographicLabel = { uz: string; ru: string; en: string };

/* ────────────────────────── palitra ────────────────────────── */

export const PALETTE_IDS = ["indigo", "forest", "sunset", "ocean", "berry", "slate"] as const;
export type PaletteId = (typeof PALETTE_IDS)[number];

export const isPaletteId = (v: unknown): v is PaletteId => (PALETTE_IDS as readonly string[]).includes(String(v));

/**
 * Palitra — ranglar JUFTLIK bo'lib e'lon qilinadi, yakka emas.
 *
 * Hisobot (§4 `contrast`) «matn/fon kontrasti ≥4.5:1» ni talab qiladi,
 * lekin §3 jadvali faqat to'rtta rangni sanaydi va qaysi rang qaysi fon
 * USTIDA chizilishini aytmaydi. Amalda bu farq hal qiluvchi: `indigo`
 * ning amber aksenti (#F59E0B) qora matn ostida ajoyib (6.87:1), lekin
 * o'sha rang bilan YOZILGAN raqam oq fonda o'qilmaydi (1.97:1). Ikkita
 * ish — «aksent FON» va «aksent SIYOH» — turli rang talab qiladi.
 *
 * Shuning uchun har palitra to'rt JUFTLIKNI e'lon qiladi va ularning
 * hammasi ≥4.5:1 (`tests/infographic-registry.test.mts` WCAG formulasi
 * bilan HISOBLAB tekshiradi, ro'yxatga ishonmaydi):
 *
 *   text       ustida surface     — blok matni;
 *   onDominant ustida dominant    — sarlavha tasmasi;
 *   onAccent   ustida accent      — statistika badge'i, ikon halqasi;
 *   accentInk  ustida surface     — aksent rangida YOZILGAN raqam/ikon;
 *   dominant   ustida surface     — blok sarlavhasi.
 */
export type Palette = {
  id: PaletteId;
  label: InfographicLabel;
  /** Sarlavha tasmasi va blok sarlavhalari. */
  dominant: string;
  onDominant: string;
  /** Badge/halqa FONI (statistika raqami ortidagi shakl). */
  accent: string;
  onAccent: string;
  /** `surface` ustida CHIZILADIGAN aksent (raqam, ikon chizig'i) — `accent` ning quyuq varianti. */
  accentInk: string;
  /** Plakat foni. */
  surface: string;
  /** Asosiy matn. */
  text: string;
};

/**
 * Olti palitra — `docs/research/infographic.md` §3 jadvalidan.
 *
 * BITTA CHEKINISH: `berry` aksenti hisobotda #059669 edi, lekin u
 * hisobotning O'Z qoidasidan (≥4.5:1) o'tmaydi — oq matn bilan 3.77:1,
 * qora matn bilan 3.92:1, ya'ni ikkala yo'nalishda ham yiqiladi.
 * #047857 (bir qadam quyuq) oq matn bilan 5.48:1 beradi va rang oilasi
 * o'zgarmaydi. Hisobot §3 da HEX lar «bizning tanlov» deb belgilangan,
 * kontrast esa tashqi standart (WCAG 2.1 AA) — shuning uchun ziddiyat
 * kontrast foydasiga hal qilindi.
 */
export const PALETTES: readonly Palette[] = [
  {
    id: "indigo",
    label: { uz: "Indigo", ru: "Индиго", en: "Indigo" },
    dominant: "#3730A3",
    onDominant: "#FFFFFF",
    accent: "#F59E0B",
    onAccent: "#1F2933",
    accentInk: "#B45309",
    surface: "#F5F5F7",
    text: "#1F2933",
  },
  {
    id: "forest",
    label: { uz: "O'rmon", ru: "Лес", en: "Forest" },
    dominant: "#14532D",
    onDominant: "#FFFFFF",
    accent: "#CA8A04",
    onAccent: "#1F2933",
    accentInk: "#A16207",
    surface: "#F3F6F2",
    text: "#1F2933",
  },
  {
    id: "sunset",
    label: { uz: "Shafaq", ru: "Закат", en: "Sunset" },
    dominant: "#9A3412",
    onDominant: "#FFFFFF",
    accent: "#0E7490",
    onAccent: "#FFFFFF",
    accentInk: "#0E7490",
    surface: "#FBF5EF",
    text: "#1F2933",
  },
  {
    id: "ocean",
    label: { uz: "Okean", ru: "Океан", en: "Ocean" },
    dominant: "#0C4A6E",
    onDominant: "#FFFFFF",
    accent: "#DB2777",
    onAccent: "#FFFFFF",
    accentInk: "#BE185D",
    surface: "#F0F7FB",
    text: "#1F2933",
  },
  {
    id: "berry",
    label: { uz: "Rezavor", ru: "Ягода", en: "Berry" },
    dominant: "#6D28D9",
    onDominant: "#FFFFFF",
    accent: "#047857",
    onAccent: "#FFFFFF",
    accentInk: "#047857",
    surface: "#F6F3FC",
    text: "#1F2933",
  },
  {
    id: "slate",
    label: { uz: "Grafit", ru: "Графит", en: "Slate" },
    dominant: "#1E293B",
    onDominant: "#FFFFFF",
    accent: "#D97706",
    onAccent: "#1F2933",
    accentInk: "#B45309",
    surface: "#F4F5F7",
    text: "#1F2933",
  },
];

export const PALETTE_BY_ID = Object.fromEntries(PALETTES.map((p) => [p.id, p])) as Record<PaletteId, Palette>;

/** Noma'lum/bo'sh palitra → standart (`indigo`) — forma va dvigatel bitta qoidadan. */
export function paletteOf(v: unknown): Palette {
  return PALETTE_BY_ID[String(v ?? "") as PaletteId] ?? PALETTES[0];
}

/* ────────────────────────── o'lcham ────────────────────────── */

export const INFOGRAPHIC_SIZES = ["A4", "A3"] as const;
export type InfographicSize = (typeof INFOGRAPHIC_SIZES)[number];

export const isInfographicSize = (v: unknown): v is InfographicSize => (INFOGRAPHIC_SIZES as readonly string[]).includes(String(v));

/** Portret o'lchamlari (mm) — `figurePng({ widthMm })` shu jadvaldan oladi. */
export const SIZE_MM: Record<InfographicSize, { width: number; height: number }> = {
  A4: { width: 210, height: 297 },
  A3: { width: 297, height: 420 },
};

/** Noma'lum/bo'sh o'lcham → A4 (hisobot §3: A3 — «keyin»). */
export function infographicSizeOf(v: unknown): InfographicSize {
  return isInfographicSize(v) ? v : "A4";
}

/* ────────────────────────── ikonlar ────────────────────────── */

/**
 * Ikon NOMLARI (Tabler Icons slug'lari, MIT — atributsiya shart emas).
 *
 * R0 da bu FAQAT NOMLAR: SVG `path` lari WP-C da (`figures/icons.ts`),
 * chunki ularni `@tabler/icons` paketidan ko'chirish va 24×24 panjarada
 * tekshirish alohida ish. Nomlar esa hozir kerak — promptga shu ro'yxat
 * tushadi va `iconKnown` qoidasi (§4) modelning javobini shunga solishtiradi.
 *
 * Ro'yxat hisobot §3 dan. Hisobotning o'zi ogohlantiradi: aniq slug lar
 * WP-C boshida paketdan TASDIQLANISHI shart — bu yerdagi nom paketda
 * bo'lmasa `iconKnown` uni standart ikonga tushiradi, plakat buzilmaydi.
 */
export const ICONS: readonly string[] = [
  "book",
  "books",
  "school",
  "backpack",
  "certificate",
  "pencil",
  "ruler",
  "ruler-2",
  "math-function",
  "sigma",
  "abacus",
  "atom",
  "flask",
  "test-pipe",
  "microscope",
  "dna",
  "world",
  "map",
  "globe",
  "language",
  "bulb",
  "target",
  "clipboard-check",
  "clipboard-list",
  "checklist",
  "chart-bar",
  "chart-pie",
  "chart-line",
  "trending-up",
  "users",
  "calendar",
  "clock",
  "award",
  "trophy",
  "star",
  "puzzle",
  "compass",
  "flag",
  "brain",
  "heart",
  "history",
];

/** Noma'lum ikon shunga tushadi (`iconKnown` qoidasi, §4). */
export const ICON_FALLBACK = "bulb";

export const isKnownIcon = (v: unknown): boolean => ICONS.includes(String(v ?? ""));

/** Noma'lum/bo'sh ikon → `ICON_FALLBACK`. */
export function iconOf(v: unknown): string {
  return isKnownIcon(v) ? String(v) : ICON_FALLBACK;
}

/* ────────────────────────── spetsifikatsiya ────────────────────────── */

/**
 * Bitta blok. `icon`/`heading`/`text` — HAR turda bor; qolganlari
 * TURGA bog'liq (§3 «maxsus maydon» ustuni) va shuning uchun ixtiyoriy:
 *
 *   `stat`        — `stat` turida MAJBURIY (`statPresent` qoidasi),
 *                   boshqa turlarda ixtiyoriy urg'u;
 *   `when`        — `timeline` turida majburiy (sana/davr);
 *   `role`        — `cause-effect` turida majburiy (chap/o'ng ustun);
 *   `side`        — `compare` turida majburiy (qaysi ustun);
 *   `order`       — `process` turida raqam badge'i (1→2→3);
 *   `parent`      — `map-structure` turida ierarxiya (blok id si).
 *
 * `stat` ATAYLAB tuzilmali (`{value, label}`), satr emas: hisobotning
 * halollik bandi (`honestyCheck`) raqamning O'ZINI foydalanuvchi bergan
 * ma'lumot bilan solishtiradi, izohni emas.
 */
export type InfographicBlock = {
  /** Barqaror id — `parent` ierarxiyasi va tahrir oplari (WP-C) shunga tayanadi. */
  id: string;
  icon: string;
  heading: string;
  text: string;
  stat?: { value: string; label: string };
  when?: string;
  role?: "cause" | "effect";
  side?: "left" | "right";
  order?: number;
  parent?: string;
};

export type InfographicSpec = {
  title: string;
  subtitle?: string;
  type: InfographicTypeId;
  blocks: InfographicBlock[];
  palette: PaletteId;
  /**
   * `size` va `language` — LLM tanlovi EMAS, formadan keladi; lekin
   * spetsifikatsiya ichida turadi, chunki WP-C ning `layoutInfographic
   * (spec, palette)` i SOF funksiya bo'lishi kerak: maket ustun sonini,
   * shrift o'lchamini va matn yo'nalishini shu ikkisidan hisoblaydi.
   * `doc.meta` ga qarasa, maketni testda `AcademicDoc` qurmasdan
   * chaqirib bo'lmasdi (aynan shu naqsh `planResume` da ishlagan).
   */
  size: InfographicSize;
  language: string;
  /**
   * Manba qatori (pastki qator). FAQAT foydalanuvchi bergan bo'lsa
   * to'ldiriladi (§4 halollik chegarasi) — model o'ylab topgan «Manba:
   * Jahon banki, 2024» yozilmaydi.
   */
  source?: string;
};

export type InfographicModel = {
  v: 1;
  spec: InfographicSpec;
  review?: DocReview;
  polish?: PolishLog;
  /** «Sizdan kutiladi» — statistika/manba (AI o'ylab topmaydigan narsa). */
  userNeeds?: UserNeed[];
};

/* ────────────────────────── chegaralar ────────────────────────── */

/**
 * Plakat chegaralari — hisobot §4 dagi `ReviewCheck` chegaralari.
 *
 * `textWordsMax` EGASI QARORI bilan yumshatildi: hisobot 120 so'zni
 * tavsiya qilgan (xalqaro 150–400 dan qattiqroq), lekin 8 blokli
 * plakatda bu blokka 12 so'zdan qoldiradi — sarlavha va statistika
 * izohlari bilan birga bu «yaxshi misol» (§5 dagi 25 so'zli blok)
 * ni ham rad etardi. 160 so'z — 8 × 18 so'z + sarlavha, ya'ni
 * hisobotning o'z namunasi o'tadi va xalqaro yuqori chegaradan
 * (400) hali ham ancha qattiq.
 */
export const INFOGRAPHIC_LIMITS = {
  /** Butun plakat matni (sarlavha + ost sarlavha + bloklar). */
  textWordsMax: 160,
  /** Bitta blok matni. */
  blockTextWordsMax: 40,
  /** Sarlavha (belgi) — hisobotda 60 edi, 18 tilda tarjima uchun 80 ga kengaytirildi. */
  titleCharsMax: 80,
  subtitleCharsMax: 90,
  headingCharsMax: 40,
  /** Statistika raqami («73%», «1 200 km») — badge ichiga sig'ishi kerak. */
  statValueCharsMax: 12,
  statLabelCharsMax: 40,
  sourceCharsMax: 120,

  /* blok soni */
  blocksMin: 3,
  blocksMax: 8,
  blocksDefault: 5,
  /** Formadagi chiplar (`blockCount`). */
  blockCounts: [3, 4, 5, 6, 8] as readonly number[],

  /* maket (A4 portret, §3 jadvali) */
  marginMm: 12,
  dpi: 300,
  /** 3 blok → 1 ustun; 4–6 → 2 ustun; 7–8 → 2×4. */
  oneColumnMaxBlocks: 3,
  iconMm: 14,

  /* kirish */
  topicChars: 300,
  extraChars: 1500,
} as const;

/** Ruxsat etilgan blok soni; noma'lum qiymat → standart 5. */
export function normalizeBlockCount(v: unknown): number {
  const n = Number(v);
  return INFOGRAPHIC_LIMITS.blockCounts.includes(n) ? n : INFOGRAPHIC_LIMITS.blocksDefault;
}
