/**
 * Slayd matn chegaralari — YAGONA jadval.
 *
 * Bu fayl ATAYLAB bog'liqliksiz: uni ham dvigatel (`normalizeSlide`,
 * server tomonida), ham ko'ruvchidagi tahrir mantig'i (`slide-edit.ts`,
 * klient bundle'da) import qiladi. Shuning uchun bu yerda `llm.ts`,
 * `server-only` yoki React ga olib boradigan bironta import bo'lmasin.
 *
 * Raqamlar MAKETDAN o'lchangan (`slide-layout.ts` qutilari va
 * `fitSize`/`fitLines` pollari) — promptdagi so'z sonidan emas. O'lchov
 * izohlari `slide-write.ts` dagi asl joylarida qoldirilgan; bu yerda
 * faqat qiymat turadi, chunki endi ikki joyda ikki nusxa emas, bitta
 * manba bo'lishi kerak: tahrirda qirqilgan matn PPTX da ham aynan shu
 * chegara bilan chizilishi shart («ko'rdim = oldim»).
 */
export const SLIDE_LIMITS = {
  /** Har maketda sarlavha. Tahrirda bo'sh qoldirib bo'lmaydi. */
  title: 80,
  /** Sarlavha ustidagi mayda yorliq. */
  kicker: 40,
  /** Standart maketlar uchun izoh matni. */
  subtitle: 140,
  /** `section` qutisi 7.3 × 1.45", 16 pt → ~325 belgi. */
  subtitleSection: 300,
  /** `closing` qutisi 8.95 × 0.85", 16 pt → ~160 belgi. */
  subtitleClosing: 160,
  /** `twoCol`/`compare` ustun sarlavhasi. */
  colTitle: 40,
  /** Ustundagi bitta band: 4 band × 120 belgi → 16 pt (o'lchangan). */
  colItem: 120,
  /** Bitta ustunda eng ko'p band. */
  colItems: 4,
  /** Iqtibos matni. */
  quote: 220,
  /** Iqtibos muallifi. */
  quoteBy: 60,
  /** `stats` katta raqami. */
  statValue: 24,
  /** Yorliq: karta 3.58 × 2.3", 11 pt da ~480 belgi; diagrammada ~220. */
  statLabel: 110,
  /** `stats` kartalari soni. */
  statsMax: 4,
  /** Bosqich raqami («1», «I», «01»). */
  stepN: 8,
  /** Bosqich sarlavhasi. */
  stepTitle: 40,
  /** Bosqich matni: 4 kartali qatorda 2.47 × 1.75", 14 pt da ~138 belgi. */
  stepText: 160,
  /** `process` bosqichlari soni. */
  stepsMax: 5,
  /** Jadval sarlavhasi — ustun soni ≤3 bo'lganda (keng ustun). */
  tableHeaderWide: 40,
  /** Jadval sarlavhasi — 4+ ustun (tor ustun). */
  tableHeader: 26,
  /** Model javobidagi xom sarlavha (keyin ustun soniga qarab qisqaradi). */
  tableHeaderRaw: 60,
  /** Jadval katagi. */
  tableCell: 60,
  /** Jadval ustunlari soni. */
  tableCols: 5,
  /** Jadval qatorlari soni. */
  tableRows: 6,
  /** Test savoli: quti 12.1 × 1.25", 17 pt da ~250 belgi. */
  quizQ: 120,
  /** Variant kartasi 4.84 × 1.4", 15 pt polda ~150 belgi. */
  quizOption: 60,
  /** Variantlar soni — AYNAN shuncha (A/B/C/D kartalari). */
  quizOptions: 4,
  /** Deka bo'ylab savollar soni (formadagi `quizCount` chegarasi). */
  quizMax: 10,
  /** Manba nomi. */
  refTitle: 90,
  /** Manba havolasi — TO'LIQ saqlanadi, `planReferences` o'zi qisqartiradi. */
  refSource: 200,
  /** `references` bandlari soni. */
  refsMax: 6,
  /** `answers` slaydidagi bitta qator («1 — B»). */
  answersItem: 40,
  /** Rasm uchun ko'rsatma (rasm prompti manbasi). */
  imageHint: 180,
  /** Rasmning `alt` matni. */
  imageAlt: 180,
  /** Modeldan kelgan notiq izohi. */
  notes: 700,
  /**
   * Tahrirdagi notiq izohi — modelnikidan uzunroq: foydalanuvchi o'z
   * nutqini yozadi va uni PPTX «Speaker notes» maydoni ko'taradi.
   */
  notesEdit: 2000,
  /**
   * Dekadagi slaydlar soni — XAVFSIZLIK chegarasi, narx chegarasi EMAS.
   * Narx bo'yicha yuqori chegara `slide-params.ts` da (`SLIDE_MAX`) va
   * uni server qatlami qo'llaydi; bu yerda faqat «cheksiz o'smasin».
   */
  maxSlides: 60,
} as const;

export type SlideLimits = typeof SLIDE_LIMITS;

/** Foydalanuvchi yuklaydigan slayd rasmi (PNG/JPEG) uchun yuqori chegara. */
export const SLIDE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/** Klientdagi bekor qilish (Ctrl+Z) stegi chuqurligi. */
export const UNDO_DEPTH = 100;

/** Oxirgi tahrirdan keyin PPTX qayta yasalgunicha kutish (ms). */
export const REBUILD_DEBOUNCE_MS = 3000;

/**
 * Matnni bitta qatorga keltirib chegaraga qisqartiradi.
 *
 * `slide-write.ts` dagi `clip` bilan AYNAN bir xil xatti-harakat:
 * ketma-ket bo'shliqlar bittaga tushadi, chetlari kesiladi, chegaradan
 * uzun matn «…» bilan tugaydi (natija uzunligi aynan `n`). Ko'p qatorli
 * matn (notiq izohi) uchun EMAS — u qatorlarni yo'qotadi.
 */
export function clipTo(text: string, n: number): string {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  return t.length <= n ? t : `${t.slice(0, n - 1).trimEnd()}…`;
}
