import type { CustomTemplate } from "./pptx-template";
import type { TranslationReport } from "./translate/report";
import type { FormValues, ToolConfig, ToolId } from "../types";
import type { SlideAudience, SlideTemplateId, SlideVisual } from "./slide-templates";
import type { SlideModel, SlideThemeId } from "./slide-types";
import type { SlideBlockId } from "./slide-blocks";
import type { SlideImageStyle, SlideTextVolume } from "./slide-params";
import type { SlidePurpose } from "./slide-purpose";
import type { SlideResearch } from "./slide-research";
import type { ResumeModel } from "./resume/model";
import type { ArticleModel, ArticleTypeId, CiteStyle, PublicationProfileId, SelectableFigureKind } from "./article/types";
import type { ResumePaletteId, ResumeTemplateId } from "./resume/templates";

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
  | { kind: "code"; text: string; caption?: string; lang?: string }
  /*
   * ── Maqola 2 (AUDIT-17) bloklari. Rasm/formula/jadval matnning O'Z
   * joyida turadi — jurnal maqolasida vizual «havola qilingan joydan
   * keyin» keladi, hujjat oxirida emas. Raqamlash (1-rasm, (1)) bu yerda
   * YO'Q: uni `article/layout.ts planArticle` beradi — DOCX va ko'ruvchi
   * ikkalasi undan o'qiydi («ko'rdim = oldim»).
   */
  /*
   * Uchalasida ham `text` BOR — «har blokda matn» invarianti saqlanadi:
   * mavjud kod (`b.text` — qidiruv, karta, hajm, ko'ruvchilar) o'zgarmaydi.
   * Rasm/jadvalda `text` = sarlavha (caption), formulada = LaTeX manbasi.
   */
  /** Sxema/diagramma — `doc.article.figures` reyestridagi rasm; `text` — sarlavhasi. */
  | { kind: "figure"; text: string; figureId: string }
  /** Formula — `text` = LaTeX (cheklangan to'plam); DOCX da OMML, ko'ruvchida KaTeX SSR. */
  | { kind: "formula"; text: string; display?: boolean }
  /** Jadval matnning SHU joyida (`doc.tables[].id`); `text` — sarlavhasi. */
  | { kind: "tableRef"; text: string; tableId: string };

export type DocSection = {
  id: string;
  title: string;
  blocks: Block[];
};

export type DocTable = {
  /** Maqola 2: `tableRef` bloki va tahrir oplari uchun barqaror id (eski hujjatlarda yo'q). */
  id?: string;
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
  /*
   * ── Slayd parametrlari (AUDIT-9). Har biri `lib/generation/slide-params.ts`
   * reyestrida e'lon qilingan va differensial test bilan qulflangan —
   * bezak maydon yo'q. Standart qiymatlar `extractMeta` da.
   */
  /** Muallif lavozimi («Fizika o‘qituvchisi») — titul va kolontitul. */
  position: string;
  /** Yuklangan logotip (`logo_uploads.asset_id`); bo'sh — logo yo'q. */
  logoAssetId: string;
  /** «O'z shablonim» — `template_uploads.asset_id` (faqat pro); bo'sh — ichki shablon. */
  templateAssetId: string;
  /** Taqdimot turi — standart shablon va tuzilma bloklarini beradi. */
  slidePurpose: SlidePurpose;
  /** 3 tagacha asosiy g'oya — har biri kamida bir slaydda ochiladi. */
  keyIdeas: string[];
  /** O‘zbekiston kontekstidagi misollar (matnda ham, rasm promptida ham). */
  localExamples: boolean;
  /** Tuzilma bloklari; bo'sh — taqdimot turi standarti. */
  blocks: SlideBlockId[];
  /** Reja slaydidagi bandlar soni (3–6). */
  planItems: number;
  /** Reja (agenda) slaydi bo'lsinmi. */
  agendaSlide: boolean;
  /** Matn hajmi — band soni/uzunligi; shrift poli o'zgarmaydi. */
  textVolume: SlideTextVolume;
  /** Nazorat testi savollari soni (0 — test yo'q). */
  quizCount: number;
  /** Gemini grounding bilan internet tadqiqoti. */
  internetSearch: boolean;
  /** Ma'ruzachi izohlari (PPTX notes) yozilsinmi. */
  speakerNotes: boolean;
  /** AI rasm uslubi. */
  slideImageStyle: SlideImageStyle;
  /*
   * ── Rezyume parametrlari (Rezyume 2, AUDIT-15). Har biri
   * `lib/generation/resume-params.ts` reyestrida e'lon qilingan va
   * differensial zond bilan qulflangan. Qolgan rezyume maydonlari
   * (tajriba, ta'lim, ko'nikma…) `DocMeta` ga TUSHMAYDI: ular
   * `ResumeInput` (`resume/input.ts`) orqali o'tadi, chunki ularning
   * shakli ro'yxat/JSON — meta esa yassi.
   */
  /** Rezyume maketi (`resume/templates.ts`); berilmasa `modern`. */
  resumeTemplate?: ResumeTemplateId;
  /** Rezyume palitrasi; berilmasa shablonning standarti. */
  resumePalette?: ResumePaletteId;
  /** Yuklangan surat (`photo_uploads.asset_id`); bo'sh — suratsiz. */
  photoAssetId: string;
  /** AI boyitish yoqilganmi (standart — yoqilgan). */
  enrich: boolean;
  /*
   * ── Maqola parametrlari (Maqola 2, AUDIT-17) — `lib/generation/article-params.ts`
   * reyestri. Mualliflar/manbalar/kalit so'zlar `DocMeta` ga TUSHMAYDI
   * (`ArticleInput`, `article/input.ts`).
   */
  /** Maqola turi (12 ta skelet, `article/types-registry.ts`); berilmasa `imrad_oak`. */
  articleType?: ArticleTypeId;
  /** Nashr profili (5 ta); berilmasa turning standarti. */
  pubProfile?: PublicationProfileId;
  /** Iqtibos uslubi — profil standartini bekor qiladi. */
  citeStyle?: CiteStyle;
  /** UDK (ixtiyoriy, ≤40 belgi). */
  udk: string;
  /** Sxema/diagramma soni (0–4). */
  figureCount: number;
  /** «Sxema turlari» oq ro'yxati (AUDIT-18 Q-6); yo'q/bo'sh — avtomatik. */
  figureKinds?: SelectableFigureKind[];
  /** Internetdan (OpenAlex/Crossref) manba qidirish. */
  research: boolean;
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
  /**
   * Deka RENDER QILINGAN vizual (dizayn) — «ko'rdim = oldim» ning vaqt
   * bo'yicha kafolati. Ilgari vizual har safar joriy reyestrdan
   * (`slideTemplate` → `visual`) olinardi: Shablonlar 2 da `defense`
   * `dense` (rasmli titul) dan `formal` (rasmsiz) ga o'tgach, eski PPTX
   * fayl bir xil, sayt ko'ruvchisi esa boshqacha chizardi; bosh sahifa
   * kartasi (`preview.slide.visual`, yakunlash vaqtida saqlangan) uchinchi
   * variant edi. Endi `buildSlideDeck` shu maydonga ustunlik beradi;
   * eski qatorlar `018_slide_visual_pin.sql` bilan `preview` dan to'ldiriladi.
   */
  slideVisual?: SlideVisual;
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
  /** Internet tadqiqoti natijasi (faktlar, manbalar, ToS entry point). */
  slideResearch?: SlideResearch;
  /**
   * Logotip. Dvigatelga `data:` URL sifatida kiradi (PPTX baytni shu
   * yerdan oladi), worker `extractAssets` bilan uni aktivga aylantiradi
   * — ko'ruvchi `/api/generations/{id}/assets/{id}` ni o'qiydi.
   */
  slideLogo?: { url: string };
  /**
   * «O'z shablonim» — yengil nusxa (profil + rol fonlari); bayt
   * `template_uploads` da. Bo'lsa PPTX `render-pptx-template`, ko'ruvchi
   * `planCustom` bilan chiziladi; fon PNG lari `extractAssets` bilan aktivga chiqadi.
   */
  customTemplate?: CustomTemplate;
  /** Tarjima hisoboti (Tarjimon 2): aniqlangan til, glossariy, ogohlantirishlar, asl↔tarjima juftlari. */
  translation?: TranslationReport;
  /**
   * Rezyume modeli (Rezyume 2, AUDIT-15) — `slides` bilan bir xil naqsh:
   * DOCX (`resume/render-docx.ts`) va ko'ruvchi (`ResumePage`) ikkalasi
   * `planResume(doc.resume)` dan chizadi. `sections` esa `resumeSections`
   * bilan sintez qilinadi (karta, qidiruv, eski kod). Eski qatorlarda yo'q —
   * `legacyResumeModel(doc)` bilan o'qiladi.
   */
  resume?: ResumeModel;
  /**
   * Maqola 2 (AUDIT-17): tur/profil, mualliflar, TEKSHIRILGAN manbalar,
   * sxemalar, tayyorlik hisoboti. Matn `sections` da qoladi (oqadigan
   * hujjat — `paginate.ts` va `render-docx` bloklari qayta ishlatiladi);
   * `planArticle` tartib va raqamlashni beradi. Eski maqolalarda yo'q —
   * `legacyArticleModel(doc)` bilan o'qiladi.
   */
  article?: ArticleModel;
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
  /**
   * LLM sarf telemetriyasi (Maqola 2 / AUDIT-17, WP4 «plumbing») —
   * `lib/generation/llm-roles.ts CostMeter.toJson()` bilan BIR XIL
   * shakl (dvigatel shu yerga import qilmasdan mos keladi, aylanma
   * import bo'lmasin). Faqat maqola dvigateli (WP1) to'ldiradi; boshqa
   * vositalarda `undefined` — worker `file.cost` bo'lgandagina
   * `generations.cost_json`ga yozadi (`lib/server/worker.ts`,
   * `lib/server/jobs.ts setCost`). Kredit/`price` ga TEGMAYDI.
   */
  cost?: CostJson;
};

export type CostJson = { provider: string; model: string; inputTokens: number; outputTokens: number; calls: number; usd: number };

export type BuildCtx = {
  tool: ToolConfig;
  values: FormValues;
};
