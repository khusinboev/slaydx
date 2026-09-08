import type { FormValues, ToolConfig, ToolId } from "../types";
import type { SlideAudience, SlideTemplateId } from "./slide-templates";
import type { SlideModel, SlideThemeId } from "./slide-types";

export type GenImage = {
  id: string;
  url: string;
  alt?: string;
  w: number;
  h: number;
  /**
   * Haqiqiy MIME (`image/png` yoki `image/jpeg`).
   *
   * `url` aktivga chiqarilgandan keyin `/api/.../assets/<id>` ko'rinishiga
   * o'tadi va kengaytma yo'qoladi — ko'ruvchi yuklash nomini shundan
   * oladi, aks holda PNG ham `.jpg` nomi bilan tushardi.
   */
  mime?: string;
};

export type Block =
  | { kind: "p"; text: string }
  | { kind: "h1"; text: string }
  | { kind: "h2"; text: string }
  | { kind: "h3"; text: string }
  | { kind: "li"; text: string }
  | { kind: "quote"; text: string }
  | { kind: "code"; text: string; caption?: string; lang?: string };

export type DocSection = {
  id: string;
  title: string;
  blocks: Block[];
};

export type DocTable = {
  caption?: string;
  headers: string[];
  rows: string[][];
  /**
   * Ustun kengliklari (foiz). Berilmasa `table-columns.ts` ustun soniga
   * qarab taxmin qiladi. DOCX (`render-docx`) va sayt ko'ruvchisi
   * (`TableViewer`, `LessonViewer`) ikkalasi ham shu maydondan foydalanadi.
   */
  widths?: number[];
  /**
   * Shu `DocSection.id` dan KEYIN chizilsin.
   *
   * Ilgari barcha jadvallar hujjat oxirida, adabiyotlardan oldin
   * turardi. Dars rejasi va texnologik xaritada jadval — hujjatning
   * mazmuni, ilova emas: o'qituvchi darsni jadval bilan olib boradi.
   * Langar berilmasa eski xatti-harakat saqlanadi.
   */
  anchor?: string;
};

export type DocMeta = {
  toolId: ToolId;
  workLabel: string;
  topic: string;
  language: string;
  extra: string;
  /** «Fayl asosida» rejimida yuklangan hujjatdan olingan matn. */
  sourceText: string;
  author: string;
  university: string;
  faculty: string;
  department: string;
  subject: string;
  teacher: string;
  city: string;
  group: string;
  course: string;
  ministry: "oliy" | "maktab";
  kind: string;
  pagesLabel: string;
  targetPages: number;
  annotationLangs: "same" | "all";
  email: string;
  organization: string;
  degree: string;
  weeklyHours: number;
  totalHours: number;
  /** Glossariy: nechta atama so'ralsin (10/20/40). */
  termCount: number;
  grade: number;
  duration: number;
  fileNameHint: string;
  tocMethod: "ai" | "manual";
  tocText: string;
  includeVisuals: boolean;
  /** Slaydda titul slaydi bo'lsinmi. Formadagi belgi shu yerga tushadi. */
  titleSlide: boolean;
  /**
   * «Premium» paketlar tanlanganmi.
   *
   * Paketlar ikki o'lchovda farqlanadi: HAJM (`targetPages` — slaydlar soni)
   * va VIZUAL SIFAT (shu bayroq). Ilgari premium hech nimani o'zgartirmasdi.
   */
  premiumVisuals: boolean;
  /** Taqdimot kim uchun: himoya, ma'ruza, maktab darsi yoki pitch. */
  slideAudience?: SlideAudience;
  design: string;
  slideTheme?: SlideThemeId;
  slideTemplate?: SlideTemplateId;
  /**
   * Hujjat YARATILGAN yil — titul va «N–N+1 o'quv yili» shu yerdan.
   *
   * Ilgari `title-model.ts` uni `new Date()` dan olardi: DOCX baytlari
   * yaratilganda muzlar, sayt ko'ruvchisi esa har ochilganda qayta
   * hisoblardi. Yil chegarasida (dekabrda yaratilib, yanvarda ochilsa)
   * ekrandagi titul «2026», yuklab olingan fayl «2025» bo'lib ajralardi.
   * Endi yil `extractMeta` da bir marta muzlaydi.
   */
  year?: number;
};

/**
 * Va'da qilingan MIQDORNING qanchasi yetkazildi.
 *
 * Bitta joyda turadi, chunki uni to'rt qatlam o'qiydi: dvigatel
 * (`delivered.ts`, `image-studio.ts`), worker (`shortfallRatio` →
 * `refundPartial`), baza (`delivered_json`) va natija sahifasi.
 */
export type Delivered = {
  got: number;
  want: number;
  /**
   * Nima sanaladi — natija sahifasidagi jumla shu so'z bilan yoziladi
   * («16 tadan 14 ta slayd yaratildi»).
   *
   * Ilgari maydon faqat `{got, want}` edi va jumla «16 tadan 14 tasi»
   * bo'lardi. Slayd dekasida endi IKKI xil miqdor kam chiqishi mumkin —
   * slayd va rasm — ya'ni sonning o'zi noaniq: foydalanuvchi ekranda
   * 16 slaydni ko'rib turib «13 tadan 0 tasi» ni slayd deb o'qirdi.
   *
   * Ixtiyoriy: bazadagi eski qatorlarda yo'q, ularda eski jumla qoladi.
   */
  unit?: string;
  /**
   * Kamomad narxning qancha ULUSHIGA tegishli (0..1). Yo'q bo'lsa 1 —
   * butun narx shu songa bog'langan (rasm vositasi, glossariy, xarita).
   *
   * Slayd rasmi uchun 1 dan kichik: rasm chiqmasa ham matn, maket va
   * PPTX yetkazilgan — to'liq qaytarish tekin deka berish bo'lardi.
   * 0 — «qayd etiladi, lekin pul qaytarilmaydi» (paket rasm uchun
   * ustama olmagan holat).
   */
  refundShare?: number;
};

/** Rasm bosqichi natijasi — `slide-images.ts` `attachSlideImages` dan. */
export type SlideImageReport = {
  /** Rejalashtirilgan slot (va'da). */
  want: number;
  /** Haqiqatan biriktirilgan rasm. */
  got: number;
  /** Provayder hisob/kalit sababli rad etgan so'rovlar (403/401/402). */
  blocked: number;
  /** Vaqt tugagani uchun umuman yuborilmagan so'rovlar. */
  skipped: number;
  /** Qolgan sabablar: timeout, tarmoq, format, saqlanmadi. */
  failed: number;
  /** Bloklash sababi — jurnal uchun (masalan «403 User is locked»). */
  blockReason?: string;
};

export type AcademicDoc = {
  meta: DocMeta;
  titlePage: boolean;
  toc: boolean;
  sections: DocSection[];
  tables?: DocTable[];
  references?: string[];
  /**
   * Adabiyotlar ro'yxati tasdiqlanmagan bo'lsa ko'rsatiladigan izoh.
   * Uydirma muallif/DOI yozish o'rniga foydalanuvchi ogohlantiriladi.
   */
  referencesNote?: string;
  abstracts?: { lang: string; label: string; text: string; keywords: string }[];
  slideTheme?: SlideThemeId;
  slideTemplate?: SlideTemplateId;
  slides?: SlideModel[];
  /**
   * Rasm bosqichi nima qilgani — `deliveredCount` uchun YAGONA manba.
   *
   * Nega dokumentda: `attachSlideImages` reja sonini (`plannedImageSlots`)
   * o'zi biladi, `deliveredCount` esa undan keyin, boshqa modulda
   * chaqiriladi. Rejani u yerda QAYTA hisoblash ikkita nusxa bo'lardi va
   * ular jimgina ajralib ketardi (aynan shu naqsh `AUDIT-5`/`AUDIT-6`
   * da bir necha marta topilgan). Qiymat `doc_json` bilan saqlanadi —
   * keyin «nega bu deka rasmsiz chiqqan» degan savolga baza javob beradi.
   */
  slideImages?: SlideImageReport;
  images?: GenImage[];
  imagePrompt?: string;
  imageScene?: string;
  imageStyle?: string;
  imageRatio?: string;
};

export type BuiltFile = {
  html: string;
  bytes: Uint8Array;
  fileName: string;
  mime: string;
  doc: AcademicDoc;
  /**
   * Va'da qilinganning qanchasi yetkazildi.
   *
   * Berilgan va `got < want` bo'lsa worker farqni qaytaradi. Rasm
   * vositasi uchun kiritilgan: narx faqat SONGA bog'langan (4 ta = 6 000
   * tanga), yetkazish esa tekshirilmasdi — 4 tadan 1 tasi kelsa ham ish
   * `COMPLETED` bo'lib, pul to'liq yechilgan holida qolardi.
   *
   * Maydon ataylab universal: slaydda ham «16 ta so'raldi, 14 tasi
   * chiqdi» (slayd) va «13 ta so'raldi, 0 tasi chiqdi» (rasm) shu
   * mexanizmdan o'tadi.
   */
  delivered?: Delivered;
};

export type BuildCtx = {
  tool: ToolConfig;
  values: FormValues;
};
