import type { FieldOption, FormValues, ToolConfig, ToolField, ToolGroup, ToolId, UserProfile } from "./types";
import { gameTypesOf } from "./generation/games/registry";
import { GAME_LIMITS } from "./generation/games/types";
import { audioTypesOf } from "./generation/audio/registry";
import { AUDIO_LIMITS } from "./generation/audio/types";
import { infographicTypes } from "./generation/infographic/registry";
import { INFOGRAPHIC_LIMITS, INFOGRAPHIC_SIZES, PALETTES } from "./generation/infographic/types";
import { PRO_SLIDE_DEFAULT, PRO_SLIDE_MAX, PRO_SLIDE_MIN, PRO_SLIDE_PER_SLIDE, clampInt, slidePrice } from "./generation/slide-params";
import { SOURCE_LANGUAGES } from "./languages";
import { isArticleTypeId } from "./generation/article/types-registry";
import { isPublicationProfileId } from "./generation/article/profiles";
import { articleTypeOf, normalizeArticlePages } from "./generation/article/input";
import { ARTICLE_TYPES } from "./generation/article/types-registry";
import type { PagesId } from "./generation/article/types";
import { normalizeWorkPages, workKindOf } from "./generation/work/registry";
import { workGenreOfTool } from "./generation/work/types";
import { essayInputFromValues } from "./generation/essay/input";
import { ESSAY_CONTEXTS, essayWords } from "./generation/essay/registry";
import { ESSAY_LIMITS } from "./generation/essay/types";
import { glossaryTermCount } from "./generation/teacher/input";

const TOPIC_FILE_MODES = [
  {
    id: "topic" as const,
    title: "Mavzu asosida",
    hint: "Mavzuni yozing — AI noldan yaratadi",
  },
  {
    id: "file" as const,
    title: "Fayl asosida",
    hint: "Hujjat yuklang — AI shu asosda yaratadi",
  },
];

/**
 * Maxsus formali vositalarning MAJBURIY maydonlari.
 *
 * `image`, `resume` va `translation` o'z formalarini chizadi
 * (`ImageStudio`, `ResumeComposer`, `TranslationForm`), shuning uchun
 * `fields` bo'sh qolgan edi. `missingRequired` esa aynan `fields` ni
 * aylanadi — natijada serverda UCHALASI ham tekshirilmasdi:
 *
 *   missingRequired(image, {})       → []
 *   missingRequired(resume, {})      → []
 *   missingRequired(translation, {}) → []
 *
 * Ya'ni bo'sh so'rov navbatga tushar, PUL YECHILAR, keyin dvigatel
 * xato berib kredit qaytarardi. Foydalanuvchi uchun bu «yaratilmoqda…»
 * dan keyin kelgan tushunarsiz xato edi.
 *
 * Maydonlar shu yerda e'lon qilinadi, formada emas: `fields` — vosita
 * SHARTNOMASI, custom forma esa uning muqobil chizuvchisi. Shartnoma
 * bitta joyda tursa, klient va server bir xil javob beradi.
 *
 * `legend` xato xabarida ko'rinadi («To'ldirilmagan maydon: …»),
 * shuning uchun u foydalanuvchi tilida yozilgan.
 */
const CUSTOM_REQUIRED: Record<string, ToolField[]> = {
  image: [{ kind: "textarea", name: "prompt", legend: "Rasm tavsifi", required: true }],
  resume: [
    { kind: "text", name: "fullName", legend: "To'liq ism", required: true },
    { kind: "text", name: "targetRole", legend: "Maqsadli lavozim", required: true },
  ],
  translation: [
    { kind: "textarea", name: "sourceText", legend: "Tarjima qilinadigan matn", required: true },
  ],
  /*
   * Maqola 2: mavzu (`topicLegend`) + tur. Mualliflar/manbalar ixtiyoriy —
   * ular JSON maydonlar (`article/input.ts`), noto'g'ri qiymat jimgina
   * tashlanadi; turning o'zi esa `preflightError` da reyestr bilan
   * tekshiriladi.
   */
  article: [{ kind: "text", name: "articleType", legend: "Maqola turi", required: true }],
  /*
   * Insho 2 (AUDIT-19): mavzu (`topicLegend`) + KONTEKST. Tur/til/hajm
   * kontekstdan normallashadi (`essayInputFromValues`) — nomuvofiq qiymat
   * xato bermaydi, kontekstning birinchi turiga/tiliga tushadi, shuning
   * uchun ular majburiy emas. Kontekstning o'zi esa bo'sh kelsa so'rov
   * umuman navbatga tushmasligi kerak: IELTS deb to'lagan foydalanuvchi
   * maktab inshosini olmasin (janrlar butunlay boshqa).
   */
  essay: [{ kind: "text", name: "essayContext", legend: "Insho konteksti", required: true }],
  /*
   * Talaba ishlari 2 (AUDIT-19 WP-E2): kurs ishi / referat / mustaqil ish
   * `WorkComposer` o'z formasini chizadi (`work-params.ts` reyestri, 28
   * maydon). Mavzu `tool.topicLegend` orqali allaqachon tekshiriladi
   * (pastdagi umumiy qoida); bu yerda faqat OTM/muallif — ular titul
   * sahifasiz hujjat chiqarib bo'lmaydigan ikkita maydon (`tests/pricing.test.mts`
   * «OTME ishlari universitetsiz qabul qilinmaydi»).
   */
  work: [
    { kind: "text", name: "university", legend: "Oliy ta'lim muassasasi", required: true },
    { kind: "text", name: "author", legend: "Muallif (F.I.Sh.)", required: true },
  ],
  /*
   * O'qituvchi vositalari 2 (AUDIT-20): dars rejasi, texnologik xarita,
   * glossariy, keys va test bitta `TeacherComposer` ga o'tadi (WP-E,
   * `teacher-params.ts` reyestri) — qolgan maydonlar `teacher/registry.ts`
   * dan chiziladi, shuning uchun `fields` bo'sh.
   *
   * Majburiy IKKITASI shu yerda qoladi, chunki ularsiz rasmiy SHAPKA
   * chizib bo'lmaydi: hujjat «__ maktabi» va «tuzuvchi: __» bilan
   * chiqsa, o'qituvchi uni ishlata olmaydi. Ilgari ular shunchaki
   * `TEACHER_FIELDS` da ixtiyoriy edi va amalda bo'sh kelardi.
   */
  teacher: [
    { kind: "text", name: "university", legend: "Ta'lim muassasasi nomi", required: true },
    { kind: "text", name: "author", legend: "Tuzuvchi (F.I.Sh)", required: true },
  ],
};

/**
 * Maqola narxi — HAJMGA qarab, hammasi ichida (mahsulot egasi qarori 4):
 * tezis 1–2 bet 4 000, 3–5 bet 6 000, 5–10 bet 8 000, 10–15 bet 12 000.
 * Tannarx modeli (docs/AUDIT-17.md): Gemini 907…2 871 so'm + baholovchi
 * ≈1 150 → 10–15 bet ≈ 4 000 so'm, ya'ni 3× marja; 2027 da narx qayta
 * ko'riladi (`scripts/cost-report.mts`). `tests/pricing.test.mts` qulflaydi.
 */
export const ARTICLE_PRICES: Record<PagesId, number> = { "1-2": 4000, "3-5": 6000, "5-10": 8000, "10-15": 12000 };

/**
 * Tezis (AUDIT-19): maqola dvigatelidagi konferensiya turlari — 1–2 bet
 * (tezis, 200–300 so'z) 4 000, 3–5 bet (kengaytirilgan tezis) 5 000.
 * Eski 5–10…20–25 betlik «tezis» paketlari (5–8 ming) tezis emas edi —
 * shu hajm kerak bo'lsa «Maqola» vositasi.
 */
export const THESIS_TYPE_IDS = ["conference_thesis", "conference_extended"] as const;
export type ThesisTypeId = (typeof THESIS_TYPE_IDS)[number];
export const THESIS_PRICES: Record<"1-2" | "3-5", number> = { "1-2": 4000, "3-5": 5000 };
export const isThesisType = (v: unknown): v is ThesisTypeId => (THESIS_TYPE_IDS as readonly string[]).includes(String(v));
/** Tezis vositasidagi maqola turi: ruxsatsiz/bo'sh → `conference_thesis` (narx ham, dvigatel ham shu qoida bilan). */
export function thesisTypeId(values: FormValues): ThesisTypeId {
  const t = String(values.articleType ?? "").trim();
  return isThesisType(t) ? t : "conference_thesis";
}

/**
 * O'qituvchi vositalari uchun MUASSASA maydoni.
 *
 * To'rttala vosita ham (dars rejasi, texnologik xarita, glossariy,
 * kalitlar) muassasa nomini so'ramasdi, lekin DOCX titul sahifasi uni
 * CHIZARDI — qiymat profildan jim kelardi. Profil maydonining yorlig'i
 * esa «Oliy ta'lim muassasasi»: maktab o'qituvchisi u yerga o'z
 * maktabini yozmaydi, shuning uchun amalda titulda bu qator BO'SH
 * qolardi (AUDIT-5 P1-5).
 *
 * Maydon MAJBURIY emas: glossariy yoki kalitlar shaxsiy ish daftari
 * bo'lishi ham mumkin. Lekin so'ralishi shart — aks holda foydalanuvchi
 * uni to'ldira olmaydi.
 *
 * eski `writerFields` (AUDIT-19 da o'chirildi) dagi `university` dan alohida: yorliq va namuna
 * maktabga mo'ljallangan, `author` esa «Bajardi» emas, «Tuzuvchi».
 */
const TEACHER_FIELDS: ToolField[] = [
  {
    kind: "text",
    name: "university",
    legend: "Ta'lim muassasasi nomi",
    placeholder: "15-son umumiy o'rta ta'lim maktabi",
  },
  {
    kind: "text",
    name: "author",
    legend: "Tuzuvchi (F.I.Sh)",
    placeholder: "Karimova Dilnoza",
  },
];

/* ────────────── O'yinlar va infografika maydonlari (AUDIT-21 R0) ────────────── */

/**
 * Chiplar REYESTRDAN quriladi — forma va dvigatel bitta manbadan.
 *
 * Ilgari har forma o'z ro'yxatini qo'lda yozardi va reyestr o'zgarganda
 * ular jimgina ajralib ketardi (`teacherTypesOf` naqshi shu sababdan
 * kiritilgan). Bu yerda ham: yangi krossvord turi qo'shilsa, chip
 * O'ZIDAN paydo bo'ladi.
 */
const numberChips = (values: readonly number[], suffix: string): FieldOption[] =>
  values.map((n) => ({ value: String(n), label: `${n} ${suffix}` }));

const LANGUAGE_FIELD: ToolField = { kind: "language", name: "language", legend: "Til" };

/**
 * `FieldKind` da `toggle` bor, lekin `FieldBlock` (`components/forms/
 * fields.tsx`) uni CHIZMAYDI — toggle deb e'lon qilingan maydon formada
 * KO'RINMAY qolardi, ya'ni aynan «bezak maydon» bo'lardi (egasi
 * qarori 14). Shuning uchun ha/yo'q tanlovi `chips` bilan beriladi;
 * dvigatel (`games/input.ts`, WP-B) `ha|true|1|yes` ni rost deb o'qiydi,
 * shunda zond `true`/`false` yuborganda ham xulq bir xil bo'ladi.
 */
const YES_NO: FieldOption[] = [
  { value: "yoq", label: "Yo'q" },
  { value: "ha", label: "Ha" },
];

const GAME_FIELDS: Record<"crossword" | "flashcards", ToolField[]> = {
  crossword: [
    {
      kind: "chips",
      name: "wordCount",
      legend: "Nechta so'z?",
      options: numberChips(GAME_LIMITS.counts, "so'z"),
      hint: "To'rga sig'magan so'z tashlanadi va hisobotda ko'rsatiladi.",
    },
    {
      kind: "chips",
      name: "crosswordType",
      legend: "Savol turi",
      options: gameTypesOf("crossword").map((t) => ({ value: t.id, label: t.label.uz, hint: t.hint })),
    },
    LANGUAGE_FIELD,
  ],
  flashcards: [
    { kind: "chips", name: "cardCount", legend: "Nechta karta?", options: numberChips(GAME_LIMITS.counts, "karta") },
    {
      kind: "chips",
      name: "cardType",
      legend: "Karta turi",
      options: gameTypesOf("flashcards").map((t) => ({ value: t.id, label: t.label.uz, hint: t.hint })),
    },
    { kind: "chips", name: "includeExample", legend: "Misol qo'shilsinmi?", options: YES_NO, hint: "Orqa yuzga atamani ishlatgan bitta jumla qo'shiladi." },
    LANGUAGE_FIELD,
  ],
};

/* ────────────── 3-dastur (AUDIT-22): interaktiv o'yinlar + audio ────────────── */

/**
 * Saralash va tinglash maydonlari (`sorting-game.md`/`listening-game.md`
 * §3 jadvallari; reyestr — `game-params.ts`).
 *
 * Tinglashda «Til» maydoni YO'Q va bu ataylab: ikkita til so'raladi
 * (variantlar ona tilida, eshitiladigan matn o'rganiladigan tilda), va
 * uchinchi «hujjat tili» tanlovi hech qayerga chiqmasdi — aynan «bezak
 * maydon» bo'lardi (egasi qarori 14).
 */
const INTERACTIVE_GAME_FIELDS: Record<"sorting" | "listening", ToolField[]> = {
  sorting: [
    {
      kind: "chips",
      name: "sortingType",
      legend: "O'yin turi",
      options: gameTypesOf("sorting").map((t) => ({ value: t.id, label: t.label.uz, hint: t.hint })),
    },
    {
      kind: "chips",
      name: "categoryCount",
      legend: "Nechta toifa?",
      options: numberChips(GAME_LIMITS.categoryCounts, "toifa"),
      // Toifa soni reyestrda qulflangan turlarda (`limits.categories` bitta
      // qiymat — «qarama-qarshi juftlik») chip inert bo'lardi — yashiriladi.
      hideWhen: { field: "sortingType", values: gameTypesOf("sorting").filter((t) => t.limits.categories.length === 1).map((t) => t.id) },
    },
    { kind: "chips", name: "itemsPerCategory", legend: "Har toifada nechta element?", options: numberChips(GAME_LIMITS.itemsPerCategoryCounts, "element") },
    LANGUAGE_FIELD,
  ],
  listening: [
    {
      kind: "chips",
      name: "listeningType",
      legend: "Topshiriq turi",
      options: gameTypesOf("listening").map((t) => ({ value: t.id, label: t.label.uz, hint: t.hint })),
    },
    { kind: "language", name: "nativeLanguage", legend: "Ona tili (variantlar tili)" },
    { kind: "language", name: "targetLanguage", legend: "O'rganiladigan til (audio tili)" },
    { kind: "chips", name: "itemCount", legend: "Nechta so'z?", options: numberChips(GAME_LIMITS.listeningCounts, "so'z") },
  ],
};

/**
 * Audio maydonlari (`podcast.md`/`greeting.md` §3; reyestr —
 * `audio-params.ts`).
 *
 * Ovoz TANLANMAYDI: u til jadvalidan (`TTS_LANG_VOICES`) olinadi —
 * foydalanuvchiga 18 til × 2 ovozli ro'yxat berish tanlovni ham
 * og'irlashtirar, ham provayder almashganda yaroqsiz bo'lib qolardi
 * (`tts.md` §3).
 */
const AUDIO_FIELDS: Record<"podcast" | "greeting", ToolField[]> = {
  podcast: [
    {
      kind: "textarea",
      name: "sourceText",
      legend: "Manba matni",
      placeholder: "«Matn asosida» rejimida: podkast tuziladigan matnni shu yerga qo'ying",
      hint: "Faqat «Matn asosida» rejimida ishlatiladi.",
    },
    {
      kind: "chips",
      name: "podcastType",
      legend: "Podkast turi",
      options: audioTypesOf("podcast").map((t) => ({ value: t.id, label: t.label.uz, hint: t.hint })),
    },
    {
      kind: "chips",
      name: "durationMin",
      legend: "Davomiyligi",
      options: numberChips(AUDIO_LIMITS.podcastMinutes, "daqiqa"),
      hint: "Davomiylik narxga ta'sir qilmaydi — 1 daqiqa ham, 5 daqiqa ham 4 000 tanga.",
    },
    LANGUAGE_FIELD,
  ],
  greeting: [
    { kind: "text", name: "recipient", legend: "Kimga?", placeholder: "Dilnoza opa", required: true },
    { kind: "text", name: "relation", legend: "Kim bo'ladi?", placeholder: "ustozim / do'stim / rahbarim", hint: "Murojaat ohangi shunga qarab tanlanadi." },
    {
      kind: "chips",
      name: "occasion",
      legend: "Sabab",
      options: audioTypesOf("greeting").map((t) => ({ value: t.id, label: t.label.uz, hint: t.hint })),
    },
    { kind: "chips", name: "durationMin", legend: "Davomiyligi", options: numberChips(AUDIO_LIMITS.greetingMinutes, "daqiqa") },
    LANGUAGE_FIELD,
  ],
};

const INFOGRAPHIC_FIELDS: ToolField[] = [
  {
    kind: "chips",
    name: "infographicType",
    legend: "Plakat turi",
    options: infographicTypes().map((t) => ({ value: t.id, label: t.label.uz, hint: t.hint })),
  },
  {
    kind: "chips",
    name: "blockCount",
    legend: "Nechta blok?",
    options: numberChips(INFOGRAPHIC_LIMITS.blockCounts, "blok"),
    hint: "Tanlangan tur chegarasidan oshsa avtomatik kamaytiriladi.",
  },
  { kind: "chips", name: "palette", legend: "Rang palitrasi", options: PALETTES.map((p) => ({ value: p.id, label: p.label.uz })) },
  { kind: "chips", name: "size", legend: "O'lcham", options: INFOGRAPHIC_SIZES.map((s) => ({ value: s, label: `${s} (portret)` })) },
  LANGUAGE_FIELD,
];

export const TOOLS: ToolConfig[] = [
  {
    id: "slide",
    slug: "slide",
    title: "Slayd",
    pageTitle: "Slayd",
    group: "umumiy",
    icon: "presentation",
    tc: "244 63 94",
    description: "Professional taqdimotlar yarating",
    submitLabel: "Taqdimot yaratish",
    creatingLabel: "Taqdimot yaratilmoqda...",
    createdLabel: "taqdimot tayyor!",
    topicLegend: "Taqdimot mavzusini kiriting",
    topicPlaceholder: "Masalan: Fotosintez jarayoni",
    modes: TOPIC_FILE_MODES,
    extraOptional: true,
    output: "pptx",
    custom: "slide",
    basePrice: 3000,
    fields: [],
  },
  {
    /*
     * PRO SLAYD — alohida vosita, alohida narx (AUDIT-9).
     *
     * Oddiy `slide` dan farqi: har mos slaydda AI chizgan rasm (Gemini),
     * boy kontent brifi (auditoriya 14, taqdimot turi 9, tuzilma bloklari,
     * asosiy g'oyalar, mahalliy misollar), slaydlar soni 4–30 erkin, narx
     * har slaydga (`PRO_SLIDE_PER_SLIDE`). Forma `ProSlideForm` da,
     * maydonlar `slide-params.ts` reyestridan chiziladi.
     */
    id: "pro-slide",
    slug: "pro-slide",
    title: "Pro slayd",
    pageTitle: "Pro slayd",
    group: "umumiy",
    icon: "presentation",
    tc: "192 38 211",
    description: "Har slaydda AI chizgan rasm, boy brif, 4–30 slayd",
    submitLabel: "Slaydlarni yaratish",
    creatingLabel: "Pro taqdimot yaratilmoqda...",
    createdLabel: "pro taqdimot tayyor!",
    topicLegend: "Taqdimot mavzusini kiriting",
    topicPlaceholder: "Masalan: Suvning tabiatdagi aylanishi",
    modes: TOPIC_FILE_MODES,
    extraOptional: true,
    output: "pptx",
    custom: "pro-slide",
    basePrice: PRO_SLIDE_PER_SLIDE * PRO_SLIDE_MIN,
    fields: [],
  },
  {
    id: "image",
    slug: "rasm",
    title: "Rasm",
    pageTitle: "Rasm generate",
    group: "umumiy",
    icon: "image",
    tc: "234 88 12",
    description: "Matndan professional rasm — uslub, o‘lcham, bir nechta variant",
    submitLabel: "Rasm yaratish",
    creatingLabel: "Rasm chizilmoqda...",
    createdLabel: "rasm tayyor!",
    extraOptional: false,
    output: "png",
    custom: "image",
    basePrice: 2000,
    fields: [],
  },
  {
    id: "coursework",
    slug: "coursework",
    title: "Kurs ishi",
    pageTitle: "Kurs ishi sozlamalari",
    group: "talaba",
    icon: "file-text",
    tc: "59 130 246",
    description: "Akademik standartlarga mos ilmiy uslubda yozilgan kurs ishi",
    submitLabel: "Kurs ishini yaratish",
    creatingLabel: "Kurs ishi yaratilmoqda...",
    createdLabel: "kurs ishi tayyor!",
    topicLegend: "Kurs ishi mavzusini kiriting",
    topicPlaceholder: "Boshlang'ich sinf o'quvchilarida o'qish ko'nikmalarini rivojlantirish",
    extraOptional: true,
    output: "docx",
    custom: "work",
    basePrice: 12000,
    /*
     * Talaba ishlari 2 (AUDIT-19 WP-E2): eski chip maydonlari
     * `WorkComposer` (`components/forms/WorkComposer.tsx`) bilan
     * almashtirildi — 27 parametr, janr×tur reyestri (`work/registry.ts`),
     * 5 fan profili (`work/subjects.ts`). Majburiylari `CUSTOM_REQUIRED.work`
     * da. Narx JADVALI o'zgarmadi (`priceFor` pastda, `pages` chipi bilan).
     */
    fields: [],
  },
  {
    id: "referat",
    slug: "referat",
    title: "Referat",
    pageTitle: "Referat",
    group: "talaba",
    icon: "book-open",
    tc: "20 184 166",
    /*
     * Ilgari «Tadqiqot ishlarini yarating» deb yozilgan edi, prompt esa
     * aynan teskarisini talab qiladi: «BU REFERAT — YANGI tadqiqot
     * emas» (AUDIT-5 P1-11). Kartochka kurs ishini va'da qilar,
     * dvigatel adabiyot sharhini yozardi — foydalanuvchi nima
     * sotib olayotganini bilmasdi.
     */
    description: "Manbalarni umumlashtirgan adabiyot sharhi",
    submitLabel: "Referatni yaratish",
    creatingLabel: "Referat yaratilmoqda...",
    createdLabel: "referat tayyor!",
    topicLegend: "Referat mavzusini kiriting",
    topicPlaceholder: "Mavzuni kiriting...",
    modes: TOPIC_FILE_MODES,
    extraOptional: true,
    output: "docx",
    custom: "work",
    basePrice: 3000,
    // Talaba ishlari 2 (AUDIT-19 WP-E2) — `WorkComposer`, kurs ishi bilan bir izoh.
    fields: [],
  },
  {
    id: "essay",
    slug: "essay",
    title: "Insho",
    pageTitle: "Insho sozlamalari",
    group: "talaba",
    icon: "pen-tool",
    tc: "139 92 246",
    description: "Mavzu asosida badiiy-ilmiy insho",
    submitLabel: "Inshoni yaratish",
    creatingLabel: "Insho yaratilmoqda...",
    createdLabel: "insho tayyor!",
    topicLegend: "Insho mavzusini kiriting",
    topicPlaceholder: "Ona tilim — g'ururim va iftixorim",
    extraOptional: true,
    output: "docx",
    basePrice: 2000,
    /*
     * Insho 2 (AUDIT-19 WP-E1): o'z formasi — `EssayComposer`. Uch
     * KONTEKST (maktab/DTM · OTM akademik esse · IELTS Task 2) bir-biriga
     * o'xshamagan janrlar: turlar ro'yxati, hajm o'lchovi (varaq/so'z),
     * ruxsat etilgan til va epigraf siyosati — hammasi kontekstdan
     * chiqadi (`essay/registry.ts`). Standart forma buni chiza olmasdi:
     * u maydonlar orasidagi BOG'LIQLIKNI bilmaydi (IELTS uchun «o'zbek
     * tili» yoki akademik esse uchun «adabiy tahlil» tanlab bo'lardi).
     *
     * `fields: []` — eski `language`/`design`/`pages`/muallif maydonlari
     * composerga ko'chdi; majburiylari `CUSTOM_REQUIRED.essay` da.
     * NARX O'ZGARMAYDI: `priceFor` baribir `pages` chipidan (1–5 varaq,
     * 2 000–4 000 tanga), `defaultPages("essay") = "2"`.
     */
    custom: "essay",
    fields: [],
  },
  {
    id: "article",
    slug: "article",
    title: "Maqola",
    pageTitle: "Maqola sozlamalari",
    group: "umumiy",
    icon: "newspaper",
    tc: "99 102 241",
    description: "Professional maqolalar yarating",
    submitLabel: "Maqolani yaratish",
    creatingLabel: "Maqola yaratilmoqda...",
    createdLabel: "maqola tayyor!",
    topicLegend: "Maqola mavzusini kiriting",
    topicPlaceholder: "Sun'iy intellektning zamonaviy ta'limdagi o'rni",
    topicExamples: [
      "Sun'iy intellektning zamonaviy ta'limdagi o'rni",
      "Yoshlarda kitobxonlik madaniyatini shakllantirish",
      "Qayta tiklanuvchi energiya manbalari: muammo va yechimlar",
    ],
    extraOptional: true,
    output: "docx",
    /*
     * Maqola 2 (AUDIT-17): o'z formasi (`ArticleComposer`, WP6) — 12 tur,
     * 5 nashr profili, mualliflar ro'yxati, o'z manbalari, natijalar matni.
     * `fields` bo'sh: maydonlar `lib/generation/article-params.ts`
     * reyestrida; majburiylari `CUSTOM_REQUIRED.article` da. Narx —
     * `ARTICLE_PRICES` (hajmga qarab, hammasi ichida).
     */
    custom: "article",
    basePrice: 4000,
    fields: [],
  },
  {
    id: "resume",
    slug: "resume",
    title: "Rezyume",
    pageTitle: "Rezyume yaratuvchi",
    group: "umumiy",
    icon: "briefcase",
    tc: "249 115 22",
    description: "Sun'iy intellekt yordamida professional rezyume yarating. Har qanday lavozim uchun mos.",
    submitLabel: "Rezyume yaratish",
    creatingLabel: "AI rezyume yaratmoqda...",
    createdLabel: "rezyume tayyor!",
    extraOptional: false,
    output: "docx",
    custom: "resume",
    basePrice: 3000,
    fields: [],
  },
  {
    id: "thesis",
    slug: "thesis",
    title: "Tezis",
    pageTitle: "Tezis",
    group: "talaba",
    icon: "graduation-cap",
    tc: "6 182 212",
    description: "Konferensiya tezisi — tekshirilgan manbalar, annotatsiya, tayyorlik hisoboti",
    submitLabel: "Tezisni yaratish",
    creatingLabel: "Tezis yaratilmoqda...",
    createdLabel: "tezis tayyor!",
    topicLegend: "Tezis mavzusini kiriting",
    topicPlaceholder: "Mavzuni kiriting...",
    extraOptional: true,
    output: "docx",
    basePrice: 4000,
    /*
     * Talaba ishlari 2 (AUDIT-19, qaror 2): tezis MAQOLA dvigatelida —
     * `ArticleComposer` faqat `conference_thesis`/`conference_extended`
     * turlarini ko'rsatadi (`THESIS_TYPE_IDS`), manbalar OpenAlex/Crossref
     * bilan tekshiriladi, hisobot + sayqal + ko'ruvchida tahrir. Eski
     * `kind: standard|imrad` yo'li (`writeImradWithLlm`) o'chirildi; narx
     * `THESIS_PRICES` (konferensiya hajmi bo'yicha).
     */
    fields: [],
    custom: "article",
  },
  {
    id: "translation",
    slug: "translation",
    title: "Tarjimon",
    pageTitle: "Tarjimon",
    group: "umumiy",
    icon: "languages",
    tc: "16 185 129",
    description: "Matn yoki DOCX, PPTX, XLSX, PDF, TXT faylni — tuzilmasini saqlab — tarjima qiling",
    submitLabel: "Tarjima qilish",
    creatingLabel: "Tarjima qilinmoqda...",
    createdLabel: "tarjima tayyor!",
    extraOptional: false,
    output: "docx",
    custom: "translation",
    basePrice: 3000,
    fields: [],
  },
  {
    id: "texnologik-xarita",
    slug: "texnologik-xarita",
    title: "Texnologik xarita",
    pageTitle: "Texnologik xarita",
    group: "oqituvchi",
    icon: "file-spreadsheet",
    tc: "124 58 237",
    description: "Fan bo'yicha o'quv yili uchun texnologik xarita tuzing",
    submitLabel: "Xaritani yaratish",
    creatingLabel: "Texnologik xarita yaratilmoqda...",
    topicLegend: "Qaysi fan bo'yicha xarita kerak?",
    topicPlaceholder: "Informatika",
    createdLabel: "texnologik xarita tayyor!",
    extraOptional: true,
    output: "docx",
    custom: "teacher",
    basePrice: 6000,
    // O'qituvchi vositalari 2 (AUDIT-20 R0): forma `TeacherComposer` ga
    // o'tdi (WP-E) — maydonlar `teacher/registry.ts` va `teacher-params.ts`
    // reyestrlaridan chiziladi, shartnoma esa `CUSTOM_REQUIRED.teacher` da.
    fields: [],
  },
  {
    id: "glossary",
    slug: "glossary",
    title: "Glossariy",
    pageTitle: "Glossariy",
    group: "oqituvchi",
    icon: "book-open",
    tc: "219 39 119",
    description: "Mavzu bo'yicha atamalar lug'atini yarating",
    submitLabel: "Glossariyni yaratish",
    creatingLabel: "Glossariy yaratilmoqda...",
    createdLabel: "glossariy tayyor!",
    topicLegend: "Mavzu yoki fan nomi",
    topicPlaceholder: "Biologiya atamalari",
    extraOptional: true,
    output: "docx",
    custom: "teacher",
    basePrice: 6000,
    /*
     * Atama soni (`termCount`) formadan YO'QOLMADI — u endi
     * `teacher-params.ts` reyestrida va `TeacherComposer` da (WP-E).
     * NARX qoidasi esa `priceFor` da O'ZGARMAY qoladi (6 000/9 000/
     * 15 000), ya'ni maydon yo'qolgani narxni jimgina tushirmaydi.
     */
    fields: [],
  },
  {
    id: "keys",
    slug: "keys",
    title: "Kalitlar (Keys)",
    pageTitle: "Kalitlar (Keys)",
    group: "oqituvchi",
    icon: "key-round",
    tc: "202 138 4",
    description: "Vaziyatli topshiriqlar uchun kalitlar",
    submitLabel: "Kalitlarni yaratish",
    creatingLabel: "Kalitlar yaratilmoqda...",
    createdLabel: "kalitlar tayyor!",
    topicLegend: "Mavzu yoki fan nomi",
    topicPlaceholder: "Pedagogika keys-stadilari",
    extraOptional: true,
    output: "docx",
    custom: "teacher",
    basePrice: 6000,
    // O'qituvchi vositalari 2 (AUDIT-20 R0) — texnologik xarita bilan bir izoh.
    fields: [],
  },
  {
    id: "mustaqil-ish",
    slug: "mustaqil-ish",
    title: "Mustaqil ish",
    pageTitle: "Mustaqil ish",
    group: "talaba",
    icon: "files",
    tc: "2 132 199",
    description: "Mavzu bo'yicha mustaqil ish hujjatini tayyorlang",
    submitLabel: "Mustaqil ishni yaratish",
    creatingLabel: "Mustaqil ish yaratilmoqda...",
    createdLabel: "mustaqil ish tayyor!",
    topicLegend: "Mustaqil ish mavzusini kiriting",
    topicPlaceholder: "Suv resurslarini muhofaza qilish",
    modes: TOPIC_FILE_MODES,
    extraOptional: true,
    output: "docx",
    custom: "work",
    basePrice: 3000,
    // Talaba ishlari 2 (AUDIT-19 WP-E2) — `WorkComposer`, kurs ishi bilan bir izoh.
    fields: [],
  },
  {
    id: "lesson-plan",
    slug: "lesson-plan",
    title: "Dars rejasi",
    pageTitle: "Dars rejasi",
    group: "oqituvchi",
    icon: "graduation-cap",
    tc: "16 185 129",
    description: "Professional dars rejalari yarating",
    submitLabel: "Darsni yaratish",
    creatingLabel: "Dars rejasi yaratilmoqda...",
    createdLabel: "dars rejasi tayyor!",
    topicLegend: "Dars mavzusi nima?",
    topicPlaceholder: "Fotosintez jarayoni",
    extraOptional: true,
    output: "docx",
    custom: "teacher",
    basePrice: 4000,
    // O'qituvchi vositalari 2 (AUDIT-20 R0) — texnologik xarita bilan bir izoh.
    // `extra` maydoni ham shu yerda tiklanadi (AUDIT-20 R1: `extraOptional`
    // bayrog'i bor edi, maydon esa e'lon qilinmagan — o'lik bayroq).
    fields: [],
  },
  {
    id: "test",
    slug: "test",
    title: "Test yaratuvchi",
    pageTitle: "Test yaratuvchi",
    group: "oqituvchi",
    icon: "list-checks",
    tc: "239 68 68",
    description: "Mavzu yoki fayl asosida variantli test, javoblar kaliti va OMR varag'i",
    submitLabel: "Testni yaratish",
    creatingLabel: "Test yaratilmoqda...",
    createdLabel: "test tayyor!",
    topicLegend: "Test qaysi mavzu bo'yicha?",
    topicPlaceholder: "Hosila va uning tatbiqlari",
    /*
     * Uchinchi rejim — `curriculum` (darslik mavzulari, `/api/curriculum`)
     * — `ToolMode` da EMAS: `ToolMode.id` faqat `topic|file` bo'lishi
     * mumkin va uni kengaytirish worker'ning fayl yo'lini (`sourceForJob`)
     * ham o'zgartiradi. Darslik rejimi `TeacherComposer` ichida, mavzu
     * rejimining ustida ishlaydi (`teacher-params.ts mode`).
     */
    modes: TOPIC_FILE_MODES,
    extraOptional: true,
    output: "docx",
    custom: "teacher",
    // Raqobatchi darajasi (mahsulot egasi qarori 6): parametrlar — savol
    // soni, variant, qiyinlik, OMR — narxga TA'SIR QILMAYDI, tekis 3 000.
    basePrice: 3000,
    fields: [],
  },
  /* ────────────── 2-dastur (AUDIT-21): bosma o'yinlar + infografika ────────────── */
  {
    id: "crossword",
    slug: "crossword",
    title: "Krossvord",
    pageTitle: "Krossvord",
    group: "oyinlar",
    icon: "puzzle",
    tc: "217 70 239",
    description: "Mavzu yoki fayl asosida bosma krossvord — to'r, savollar va javoblar varag'i",
    submitLabel: "Krossvord yaratish",
    creatingLabel: "Krossvord tuzilmoqda...",
    createdLabel: "krossvord tayyor!",
    topicLegend: "Krossvord qaysi mavzu bo'yicha?",
    topicPlaceholder: "Fotosintez jarayoni",
    /*
     * Fayl rejimi — raqobatchida ham bor (`crossword.md` §2): o'qituvchi
     * darslik bobini yuklaydi va so'zlar SHU matndan olinadi. Worker
     * `sourceForJob` `tool.modes` bo'lgan har vosita uchun manbani
     * uzatadi, ya'ni qo'shimcha ulanish kerak emas.
     */
    modes: TOPIC_FILE_MODES,
    extraOptional: true,
    output: "docx",
    // Tekis 2 000 (mahsulot egasi qarori 6): so'z soni narxga ta'sir qilmaydi.
    basePrice: 2000,
    /*
     * Formalar 3 (AUDIT-24 WP-D1): forma — `GameComposer`.
     *
     * `fields` ATAYIN saqlanadi: u reyestrdan quriladi
     * (`gameTypesOf`/`GAME_LIMITS`, yuqoridagi `GAME_FIELDS`) va uch ishni
     * bajaradi — (1) `StandardForm` zaxira yo'li, (2) shartnoma testlari
     * chip variantlarini shu ro'yxatdan o'qiydi (`tests/pricing.test.mts`),
     * (3) `missingRequired` maydon yorliqlarini undan oladi. Composer
     * HAM AYNAN shu reyestrdan o'qiydi, ya'ni ikkinchi manba paydo
     * bo'lmaydi.
     */
    custom: "game",
    fields: GAME_FIELDS.crossword,
  },
  {
    id: "flashcards",
    slug: "flashcards",
    title: "Flesh kartalar",
    pageTitle: "Flesh kartalar",
    group: "oyinlar",
    icon: "layers",
    tc: "245 158 11",
    description: "A7 o'lchamdagi bosma kartalar — old yuzda atama yoki savol, orqa yuzda javob",
    submitLabel: "Kartalarni yaratish",
    creatingLabel: "Kartalar tayyorlanmoqda...",
    createdLabel: "kartalar tayyor!",
    topicLegend: "Kartalar qaysi mavzu bo'yicha?",
    topicPlaceholder: "Biologiya atamalari: hujayra",
    extraOptional: true,
    output: "docx",
    basePrice: 2000,
    // Formalar 3 (AUDIT-24 WP-D1): forma — `GameComposer` (izoh krossvordda).
    custom: "game",
    fields: GAME_FIELDS.flashcards,
  },
  {
    id: "infographic",
    slug: "infografika",
    title: "Infografika",
    pageTitle: "Infografika",
    group: "oqituvchi",
    icon: "pie-chart",
    tc: "6 182 212",
    description: "Bir betlik ta'lim plakati — 7 tur, 6 palitra, A4/A3 PNG (300 dpi)",
    submitLabel: "Infografika yaratish",
    creatingLabel: "Plakat chizilmoqda...",
    createdLabel: "infografika tayyor!",
    topicLegend: "Plakat qaysi mavzu bo'yicha?",
    topicPlaceholder: "Suv aylanishi",
    extraOptional: true,
    // Chiqish — RASM, hujjat emas: `viewerKind` → `image`, qadoqlash `packImages`.
    output: "png",
    basePrice: 2000,
    fields: INFOGRAPHIC_FIELDS,
    // Formalar 3 (AUDIT-24 WP-D2b): `InfographicComposer` — tur/blok/palitra
    // reyestrdan, `ToolWorkspace` dispatch.
    custom: "infographic",
  },
  /* ────────────── 3-dastur (AUDIT-22): interaktiv o'yinlar + Media ────────────── */
  {
    id: "sorting",
    slug: "sorting",
    title: "Saralash o'yini",
    pageTitle: "Saralash o'yini",
    group: "oyinlar",
    icon: "boxes",
    tc: "16 185 129",
    description: "Elementlarni toifalarga ajratish — ochiq havola bilan o'ynaladi, bosma jadval ham chiqadi",
    submitLabel: "O'yin yaratish",
    creatingLabel: "O'yin tuzilmoqda...",
    createdLabel: "o'yin tayyor!",
    topicLegend: "O'yin qaysi mavzu bo'yicha?",
    topicPlaceholder: "Hayvonlar sinflari",
    extraOptional: true,
    // Bosma versiya — DOCX (jadval + javob kaliti); interaktiv rejim
    // AYNI hujjatdan chiziladi (`publicGameView`), alohida fayl emas.
    output: "docx",
    // Tekis 2 000 (egasi qarori 6): toifa/element soni narxga ta'sir qilmaydi.
    basePrice: 2000,
    // Formalar 3 (AUDIT-24 WP-D1): forma — `GameComposer` (izoh krossvordda).
    custom: "game",
    fields: INTERACTIVE_GAME_FIELDS.sorting,
  },
  {
    id: "listening",
    slug: "listening",
    title: "Tinglash o'yini",
    pageTitle: "Tinglash o'yini",
    group: "oyinlar",
    icon: "headphones",
    tc: "14 165 233",
    description: "So'z eshitiladi — o'quvchi to'g'ri tarjimani tanlaydi; bosma versiyasi lug'at varag'i",
    submitLabel: "O'yin yaratish",
    creatingLabel: "So'zlar tanlanmoqda...",
    createdLabel: "o'yin tayyor!",
    topicLegend: "Qaysi mavzu bo'yicha so'zlar?",
    topicPlaceholder: "Shahardagi joylar",
    extraOptional: true,
    output: "docx",
    basePrice: 2000,
    // Formalar 3 (AUDIT-24 WP-D1): forma — `GameComposer` (izoh krossvordda).
    custom: "game",
    fields: INTERACTIVE_GAME_FIELDS.listening,
  },
  {
    id: "podcast",
    slug: "podcast",
    title: "Podkast",
    pageTitle: "Podkast",
    group: "media",
    icon: "mic",
    tc: "168 85 247",
    description: "Mavzu, matn yoki fayl asosida 1–5 daqiqalik suhbat — ssenariy va MP3",
    submitLabel: "Podkast yaratish",
    creatingLabel: "Ssenariy yozilmoqda...",
    createdLabel: "podkast tayyor!",
    topicLegend: "Podkast qaysi mavzu bo'yicha?",
    topicPlaceholder: "Sun'iy intellekt va ta'lim",
    /*
     * Uch rejim (`podcast.md` §3): mavzu / tayyor matn / fayl. Matn
     * rejimi ekstraksiyasiz — `sourceText` to'g'ridan-to'g'ri formadan;
     * fayl rejimida esa worker `sourceForJob` bilan matnni uzatadi
     * (`tool.modes` bo'lgan har vosita uchun).
     */
    modes: [
      ...TOPIC_FILE_MODES.slice(0, 1),
      { id: "text" as const, title: "Matn asosida", hint: "Tayyor matnni qo'ying — AI uni suhbatga aylantiradi" },
      ...TOPIC_FILE_MODES.slice(1),
    ],
    extraOptional: true,
    output: "mp3",
    // Tekis 4 000 (egasi qarori 6): davomiylik va tur narxga ta'sir qilmaydi.
    basePrice: 4000,
    fields: AUDIO_FIELDS.podcast,
    // Formalar 3 (AUDIT-24 WP-D2a): `MediaComposer` — rejim/tur reyestrdan.
    custom: "media",
  },
  {
    id: "greeting",
    slug: "greeting",
    title: "Tabriknoma",
    pageTitle: "Tabriknoma",
    group: "media",
    icon: "gift",
    tc: "244 63 94",
    description: "Ovozli tabrik — kimga, qaysi sabab bilan; 1–4 daqiqa, MP3",
    submitLabel: "Tabriknoma yaratish",
    creatingLabel: "Tabrik yozilmoqda...",
    createdLabel: "tabriknoma tayyor!",
    /*
     * Mavzu MAJBURIY emas: tabriknomada uning o'rnini «Kimga?»
     * (`recipient`) va sabab egallaydi. `topicLegend` ataylab yo'q —
     * aks holda `missingRequired` mavzusiz so'rovni rad etardi.
     */
    extraOptional: true,
    output: "mp3",
    basePrice: 4000,
    fields: AUDIO_FIELDS.greeting,
    custom: "media",
  },
];

/*
 * Deklaratsiya TOOLS e'lonidan KEYIN biriktiriladi: `CUSTOM_REQUIRED`
 * ro'yxatga qo'lda ko'chirilsa, ikkalasi ajralib ketishi mumkin edi.
 */
for (const tool of TOOLS) {
  const extra = tool.custom ? CUSTOM_REQUIRED[tool.custom] : undefined;
  if (extra) tool.fields = [...tool.fields, ...extra];
  /*
   * O'qituvchi vositalari titul sahifasini chizadi, lekin muassasa va
   * tuzuvchini so'ramasdi — qiymat profildan jim kelar, forma esa uni
   * ko'rsatmasdi. Maydonlar `extra: true` bo'lgan `extra` textarea dan
   * OLDIN qo'shiladi, shunda ular asosiy qismda turadi.
   *
   * AUDIT-20 R0: `custom` formali vositalarga bu QO'SHILMAYDI — ular
   * o'z shartnomasini `CUSTOM_REQUIRED` da e'lon qiladi (`teacher` da
   * ikkalasi MAJBURIY). Aks holda bir xil ikkita `university` maydoni
   * qo'shilib, `missingRequired` ro'yxatida yorliq ikki marta chiqardi.
   *
   * AUDIT-21 R0: shart `output === "docx"` bilan ham cheklandi.
   * Infografika — o'qituvchi bo'limida, lekin u HUJJAT emas, PLAKAT:
   * titul sahifasi ham, «Tuzuvchi:» qatori ham yo'q, ya'ni muassasa va
   * tuzuvchi maydonlari hech qayerga chiqmasdi — aynan «bezak maydon»
   * bo'lardi (egasi qarori 14). Shox kelgusi DOCX li o'qituvchi
   * vositalari (atestatsiya) uchun saqlanadi.
   */
  if (tool.group === "oqituvchi" && !tool.custom && tool.output === "docx") {
    const rest = tool.fields.filter((f) => f.extra);
    const main = tool.fields.filter((f) => !f.extra);
    tool.fields = [...main, ...TEACHER_FIELDS, ...rest];
  }
}

/**
 * Bo'lim yorliqlari — YAGONA manba (AUDIT-21 R0).
 *
 * Ilgari ro'yxat `CreateGrid` va `Sidebar` da IKKI marta qo'lda
 * yozilgan edi (`as const` massiv). Yangi bo'lim qo'shilganda ular
 * ajralib ketishi muqarrar edi: bittasida «O'yinlar» paydo bo'lar,
 * ikkinchisida vositalar hech qaysi ro'yxatga tushmay YO'QOLIB qolardi
 * — foydalanuvchi uchun bu «vosita sotib olib bo'lmaydi» degani.
 */
export const TOOL_GROUPS: readonly { id: ToolGroup; label: string }[] = [
  { id: "umumiy", label: "Umumiy vositalar" },
  { id: "talaba", label: "Talaba ishlari" },
  { id: "oqituvchi", label: "O'qituvchi vositalari" },
  { id: "oyinlar", label: "O'yinlar" },
  { id: "media", label: "Media" },
];

/**
 * Chiziladigan bo'limlar — VOSITASI BOR lari.
 *
 * `media` (podkast, tabriknoma) AUDIT-22 da to'ladi; hozir u bo'sh va
 * ko'rinmasligi kerak — bo'sh sarlavha foydalanuvchiga mavjud bo'lmagan
 * xizmatni va'da qilardi.
 */
export function visibleToolGroups(): readonly { id: ToolGroup; label: string }[] {
  return TOOL_GROUPS.filter((g) => TOOLS.some((t) => t.group === g.id));
}

export const TOOL_BY_SLUG = Object.fromEntries(TOOLS.map((t) => [t.slug, t])) as Record<
  string,
  ToolConfig
>;

export const TOOL_BY_ID = Object.fromEntries(TOOLS.map((t) => [t.id, t])) as Record<
  ToolId,
  ToolConfig
>;

/**
 * Slug — ToolId emas: masalan «rasm» slug'ining id'si «image».
 * Ilgari bu funksiya `slug is ToolId` deb e'lon qilingan edi va tip xato edi.
 */
export function isToolSlug(slug: string): boolean {
  return Object.prototype.hasOwnProperty.call(TOOL_BY_SLUG, slug);
}

/**
 * To'ldirilmagan majburiy maydonlar ro'yxati.
 *
 * Bitta manba: klient ham, server ham shu funksiyani chaqiradi. Ilgari
 * tekshiruv FAQAT formada edi — to'g'ridan-to'g'ri yuborilgan so'rov
 * barcha talablarni chetlab o'tardi va universitetsiz, mavzusiz hujjat
 * navbatga tushib, puli yechilardi.
 */
export function missingRequired(tool: ToolConfig, values: FormValues): string[] {
  const out: string[] = [];
  const filled = (name: string) => String(values[name] ?? "").trim().length > 0;

  /*
   * Tarjimonning FAYL rejimi (Tarjimon 2): manba `sourceText` emas,
   * yuklangan qator (`sourceAssetId`) bo'ladi va `sourceText` ataylab
   * bo'sh yuboriladi — matn bazadan olinadi, so'rov tanasida takrorlanmaydi.
   *
   * `CUSTOM_REQUIRED.translation` o'zgarmaydi: MATN rejimida `sourceText`
   * majburiy bo'lib qolishi kerak (aks holda bo'sh so'rov navbatga tushib
   * puli yechilardi — P0-5). Shuning uchun bu yerda faqat ISTISNO
   * qo'shiladi, ro'yxat emas.
   */
  if (tool.id === "translation" && filled("sourceAssetId")) return [];

  // «Fayl asosida» rejimida mavzu o'rniga manba matni bo'ladi.
  const mode = String(values.mode ?? "");
  const fileMode = Boolean(tool.modes) && mode === "file";
  /*
   * «Matn asosida» (AUDIT-22, podkast): manba — formadagi textarea,
   * ya'ni mavzu ham, fayl ham so'ralmaydi. Ilgari bunday rejim yo'q edi
   * va u qo'shilganda mavzusiz so'rov «Mavzu to'ldirilmagan» bilan rad
   * etilardi — foydalanuvchi butun matnni qo'ygan bo'lsa ham.
   */
  const textMode = Boolean(tool.modes) && mode === "text";
  if (tool.topicLegend && !fileMode && !textMode && !filled("topic")) out.push(tool.topicLegend);
  if (fileMode && !filled("sourceText")) out.push("Manba fayl matni");
  if (textMode && !filled("sourceText")) out.push("Manba matni");

  for (const f of tool.fields) {
    if (!f.required || f.extra) continue;
    if (!filled(f.name)) {
      out.push(f.legend);
      continue;
    }
    /*
     * Sonli maydonda «to'ldirilgan» yetarli emas — DIAPAZON ham
     * tekshirilishi kerak. `weeklyHours` uchun `min: 1` e'lon qilingan,
     * lekin hech kim uni o'qimasdi: `"0"` uzunligi 1 bo'lgani uchun
     * «to'ldirilgan» hisoblanar va serverdan o'tib ketardi (AUDIT-5
     * §4.10). Keyin dvigatel `Math.max(1, weeklyHours)` bilan uni jim
     * tuzatar — ya'ni foydalanuvchi kiritgan qiymat e'tiborsiz qolardi.
     */
    if (f.kind === "number") {
      const n = Number(values[f.name]);
      const low = f.min !== undefined && n < f.min;
      const high = f.max !== undefined && n > f.max;
      if (!Number.isFinite(n) || low || high) out.push(f.legend);
    }
  }
  return out;
}

/**
 * Manba matni chegaralari — UCHALASI SHU YERDA, bir-biriga bog'langan.
 *
 * Ilgari ular uch faylga tarqalgan edi va bir-birini bilmasdi (N-4-audit,
 * N-5). Foydalanuvchi uchun bu shunday ko'rinardi:
 *
 *   `/api/extract`  200 000 → «150 000 belgi tarjima qilinadi» deb yozardi;
 *   `sanitizeValues` 60 000 → shu yerda JIM kesilardi;
 *   `preflightError` 48 000 → «Matn juda uzun: 60 000 belgi» deb rad etardi.
 *
 * Ya'ni xatodagi son foydalanuvchi ko'rgan songa hech qachon mos
 * kelmasdi: `preflightError` allaqachon KESILGAN matnni o'lchardi.
 * Klientda esa umuman tekshiruv yo'q edi — yo'l boshidan noto'g'ri
 * boshqarilardi.
 *
 * Endi ular bitta joyda va munosabati yozilgan. `validate.ts` shu
 * konstantani import qiladi, ya'ni ular ajralib keta olmaydi.
 */

/**
 * So'rovga umuman kiradigan XOM matn (`sanitizeValues`).
 *
 * Bu «biz nimani qabul qilamiz» savoliga javob beradi — «biz nimani
 * uddalaymiz» ga emas. Undan oshgani kesiladi, shuning uchun server
 * kesilgan matnning HAQIQIY uzunligini bila olmaydi: xato xabari shuni
 * tan olishi kerak.
 */
export const MAX_SOURCE_CHARS = 200_000;

/**
 * Bir marta tarjima qilinadigan eng katta matn.
 *
 * Tarjimon 2 da chegara 48 000 dan 200 000 ga ko'tarildi: dvigatel endi
 * SEGMENTLAR bilan ishlaydi (band = bir paragraf/yacheyka), partiyalar
 * parallel ketadi va byudjet hajmdan hisoblanadi (`budget.ts`), ya'ni
 * cheklovchi omil «15 ta bo'lak» emas, VAQT bo'lib qoldi.
 *
 * `MAX_SOURCE_CHARS` bilan TENG bo'lishi ataylab: xom shift ham, tarjima
 * chegarasi ham bir xil bo'lsa, matn `sanitizeValues` da JIM kesilib,
 * keyin «chegaradan oshdi» xatosi chiqmaydi. Xom shift kichik bo'lishi
 * MUMKIN emas (kesilgan matn boshqa songa aylanardi), katta bo'lishi esa
 * keraksiz. Shu sababli munosabat `<=`.
 */
export const TRANSLATION_MAX_CHARS = 200_000;

/**
 * Tarjima narxi — HAJMGA bog'liq (Tarjimon 2).
 *
 * Ilgari 3 000 tanga hajmdan qat'i nazar olinardi: 500 belgilik xat ham,
 * 48 000 belgilik hujjat ham. Ikkinchisi ~40 marta ko'p token yeydi,
 * ya'ni katta hujjatlar zararga ishlanardi va kichiklari ortiqcha
 * to'lardi.
 *
 * Model: 10 000 belgigacha tayanch narx, keyingi HAR 5 000 (yoki uning
 * qismi) uchun +1 000. Yaxlitlash YUQORIGA (`ceil`) — 10 001 belgi ham
 * to'liq qadamni oladi, chunki modelga baribir yangi partiya ketadi.
 */
export const TRANSLATION_BASE_PRICE = 3000;
export const TRANSLATION_BASE_CHARS = 10_000;
export const TRANSLATION_STEP_CHARS = 5_000;
export const TRANSLATION_STEP_PRICE = 1000;

/**
 * Tarjima uslublari — forma chiplari va prompt qatori bitta ro'yxatdan.
 *
 * `value` model promptiga (`STYLE_LINE`, WP3) tushadi, `label` — formaga.
 * Ikki joyda mustaqil yozilsa, formada tanlangan uslub prompt'da yo'q
 * qiymatga aylanardi.
 */
export const TRANSLATION_STYLES = [
  { value: "formal", label: "Rasmiy / ilmiy" },
  { value: "business", label: "Biznes" },
  { value: "plain", label: "Oddiy" },
  { value: "literary", label: "Adabiy" },
] as const;

/**
 * Tarjima tillari — MANBA ro'yxati (18 til), ikkala yo'nalish uchun.
 *
 * `TARGET_LANGUAGES` (3 til) O'ZGARMAYDI: u «hujjat skeleti shu tilda
 * to'liq tarjima qilinganmi» degan boshqa savolga javob beradi va boshqa
 * vositalar unga tayanadi. Tarjimonda esa skelet yozilmaydi — asl
 * hujjatning o'z tuzilmasi saqlanadi, shuning uchun 18 tilning hammasi
 * maqsad sifatida ham yaroqli.
 */
export const TRANSLATION_LANGUAGES = SOURCE_LANGUAGES;

/** Formadagi «Avtomatik aniqlash» qiymati (manba tili uchun). */
export const TRANSLATION_AUTO_LANG = "avto";

function isTranslationStyle(v: string): boolean {
  return TRANSLATION_STYLES.some((s) => s.value === v);
}

function isTranslationLang(v: string, withAuto: boolean): boolean {
  if (withAuto && v === TRANSLATION_AUTO_LANG) return true;
  return TRANSLATION_LANGUAGES.some((l) => l.value === v);
}

/**
 * Tarjima hajmi — narx va byudjet UCHUN YAGONA manba.
 *
 * Fayl rejimida `sourceChars` SERVERDA to'ldiriladi
 * (`sourceCharsForRequest`, `app/api/generations/route.ts`) va klientning
 * qiymati ustidan yoziladi; matn rejimida esa `sourceText` ning o'z
 * uzunligi olinadi va klient yuborgan `sourceChars` e'tiborsiz qoladi.
 * Aks holda soxta `sourceChars` bilan 200 000 belgilik matnni 3 000
 * tangaga tarjima qilish mumkin bo'lardi.
 */
export function translationChars(values: FormValues): number {
  const asset = String(values.sourceAssetId ?? "").trim();
  if (asset) {
    const n = Number(values.sourceChars);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }
  return String(values.sourceText ?? "").length;
}

export function translationPrice(chars: number): number {
  const n = Number.isFinite(chars) ? Math.max(0, Math.floor(chars)) : 0;
  const over = Math.max(0, n - TRANSLATION_BASE_CHARS);
  return TRANSLATION_BASE_PRICE + Math.ceil(over / TRANSLATION_STEP_CHARS) * TRANSLATION_STEP_PRICE;
}

/**
 * Pul yechilishidan oldingi tekshiruv.
 *
 * `missingRequired` «to'ldirilmagan maydon» ni ushlaydi, bu esa
 * «to'ldirilgan, lekin biz uddalay olmaymiz» holatini. Ikkalasi ham
 * navbatga qo'yishdan oldin ishlaydi, shunda foydalanuvchi bajarilmaydigan
 * ish uchun to'lamaydi.
 */
/** Rasm tavsifi shundan qisqa bo'lsa model uchun ma'no tashimaydi. */
export const IMAGE_PROMPT_MIN = 3;
/** Tarjima uchun eng kam matn — bundan qisqasi hujjat emas. */
export const TRANSLATION_MIN_CHARS = 8;

export function preflightError(tool: ToolConfig, values: FormValues): string | null {
  /*
   * «To'ldirilgan, lekin juda qisqa» — `missingRequired` ushlamaydigan
   * hol. Ilgari bu tekshiruvlar FAQAT custom formalarda edi
   * (`ImageStudio`: `< 3`, `TranslationForm`: `< 8`), ya'ni
   * to'g'ridan-to'g'ri yuborilgan so'rov ularni chetlab o'tardi.
   */
  if (tool.custom === "image") {
    const n = String(values.prompt ?? "").trim().length;
    if (n > 0 && n < IMAGE_PROMPT_MIN) return "Rasm tavsifi juda qisqa — nima chizilishini yozing.";
  }
  /*
   * Maqola 2: tur va profil — REYESTRDAN. `missingRequired` faqat
   * «to'ldirilgan»ni tekshiradi; `articleType: "zzz"` navbatga tushib
   * `imrad_oak` ga jim tushar va foydalanuvchi ko'rmagan tur uchun pul
   * yechilardi. Eski `kind` (`imrad`/`standard`) hali qabul qilinadi.
   */
  if (tool.id === "article" || tool.id === "thesis") {
    const t = String(values.articleType ?? "").trim();
    if (t && !isArticleTypeId(t)) return "Noma'lum maqola turi";
    if (tool.id === "thesis" && t && !isThesisType(t)) return "Tezis uchun faqat konferensiya turlari";
    const p = String(values.pubProfile ?? "").trim();
    if (p && !isPublicationProfileId(p)) return "Noma'lum nashr profili";
    const topicLen = String(values.topic ?? "").trim().length;
    if (topicLen > 0 && topicLen < 4) return "Mavzu juda qisqa.";
  }
  if (tool.id === "translation") {
    const n0 = String(values.sourceText ?? "").trim().length;
    if (n0 > 0 && n0 < TRANSLATION_MIN_CHARS) return "Matn juda qisqa.";
  }
  if (tool.id === "translation") {
    const n = String(values.sourceText ?? "").length;
    if (n > TRANSLATION_MAX_CHARS) {
      /*
       * Matn `MAX_SOURCE_CHARS` da kesilgan bo'lsa, bizdagi son
       * foydalanuvchidagidan KICHIK. Aniq son o'rniga «dan ortiq» deyish
       * halolroq: aks holda 250 000 belgi yuborgan odam «200 000 belgi»
       * degan xatoni o'qib, nimani qisqartirishini tushunmasdi. Hozir
       * ikki chegara TENG, ya'ni bu holat faqat ular ajralib ketsa
       * yuzaga keladi — tekshiruv o'sha kunga qoldirilgan himoya.
       */
      /*
       * Kesilgan matnning uzunligi AYNAN `MAX_SOURCE_CHARS` bo'ladi —
       * `>=` emas, `===`. Ilgari `>=` yozilgan edi va ikki chegara
       * tenglashtirilgach u har doim rost bo'lib qoldi: klientda
       * (matn KESILMAGAN joyda) 250 000 belgilik matn «250 000 dan
       * ortiq» deb ko'rsatilardi — soni aniq bo'lsa ham.
       */
      const clipped = n === MAX_SOURCE_CHARS;
      const size = `${n.toLocaleString("uz-UZ")}${clipped ? " dan ortiq" : ""}`;
      return (
        `Matn juda uzun: ${size} belgi. ` +
        `Chegara ${TRANSLATION_MAX_CHARS.toLocaleString("uz-UZ")} — hujjatni bo'lib yuboring.`
      );
    }
    /*
     * Fayl rejimi ham SHU chegaraga bo'ysunadi: hajm bazadan keladi
     * (`sourceChars`), ya'ni klient uni kichraytira olmaydi. Yuklashda
     * ham tekshiriladi, lekin eski `sourceAssetId` bilan qayta
     * yuborilgan so'rov yuklash yo'lidan o'tmaydi.
     */
    const total = translationChars(values);
    if (total > TRANSLATION_MAX_CHARS) {
      return (
        `Fayl ${total.toLocaleString("uz-UZ")} belgi. ` +
        `Chegara ${TRANSLATION_MAX_CHARS.toLocaleString("uz-UZ")} — hujjatni bo'lib yuboring.`
      );
    }
    if (total > 0 && total < TRANSLATION_MIN_CHARS) return "Matn juda qisqa.";

    /*
     * Uslub va tillar — RO'YXATDAN. Ilgari ular faqat formada tanlanardi
     * va serverda umuman tekshirilmasdi: to'g'ridan-to'g'ri yuborilgan
     * `language: "klingon"` prompt'ga tushar, model esa nima chiqarishini
     * o'zi hal qilardi — pul esa allaqachon yechilgan bo'lardi.
     */
    const style = String(values.style ?? "").trim();
    if (style && !isTranslationStyle(style)) return "Noma'lum uslub";

    const target = String(values.language ?? "").trim();
    if (target && !isTranslationLang(target, false)) return "Noma'lum til";

    const src = String(values.sourceLang ?? "").trim();
    if (src && !isTranslationLang(src, true)) return "Noma'lum til";

    if (src && target && src === target) return "Manba va maqsad tili bir xil";
  }
  return null;
}

/**
 * Muallif ma'lumotlari — HAR qanday hujjatga tushadigan umumiy maydonlar.
 *
 * Nega `lib/tools.ts` da: bu forma qoidasi, ya'ni `missingRequired` va
 * `priceFor` bilan bir joyda turishi kerak. Har forma o'z standartini
 * qo'lda yozganda ular ajralib ketardi — aynan shunday bo'lgan edi
 * (N-7): `StandardForm` profilni o'qir, `SlideForm` esa o'z qiymatlarini
 * noldan qurib, `author` va `university` ni umuman olmasdi. Natijada
 * `slide-write.ts` dagi
 *
 *   const footer = [meta.author, meta.university].filter(Boolean).join(" · ")
 *
 * har doim bo'sh satr berardi: himoya taqdimotida ham (deck da `defense`
 * auditoriyasi bor!) muallif ismi ko'rinmasdi — ko'ruvchida ham, PPTX da ham.
 */
export function profileDefaults(profile: Partial<UserProfile>): FormValues {
  return {
    author: profile.author || profile.name || "",
    university: profile.university || "",
    faculty: profile.faculty || "",
    department: profile.department || "",
    subject: profile.subject || "",
    teacher: profile.teacher || "",
    city: profile.city || "Toshkent",
    // Slayd muallifi (Formalar 2): tashkilot alohida saqlanadi, bo'lmasa universitet.
    position: profile.position || "",
    organization: profile.organization || profile.university || "",
  };
}

/**
 * Server imkoniyatlari — `/api/auth/session` qaytaradigan bayroqlar.
 *
 * `Features` turining kerakli qismi (klient `lib/api-client.ts` da to'liq
 * ko'rinishini biladi). Bu modul sof bo'lishi kerak, shuning uchun tur
 * shu yerda qayta e'lon qilinadi.
 */
export type ToolFeatures = { llm: boolean; images: boolean };

/**
 * Vosita hozir ishlay oladimi — yo'q bo'lsa SABABI.
 *
 * Bayroqlar `/api/auth/session` da allaqachon qaytarilardi, lekin UI da
 * `llm` ham, `images` ham HECH QAYERDA o'qilmasdi (N-6). Natijasi:
 *
 *   • `FAL_KEY` yo'q → «Rasm generate» to'liq ko'rinar va sotilardi.
 *     To'lov → navbat → `generateFalImage` «FAL_KEY missing» → xato →
 *     qaytarish. Ya'ni «xizmat ishlamayapti» xabari eng qimmat yo'l
 *     bilan yetkazilardi: pul qaytadi, vaqt qaytmaydi.
 *
 *   • `GEMINI_API_KEY` yo'q → `buildArtifact` xato TASHLAMAYDI (u faqat
 *     kalit BOR bo'lgan holatda tashlaydi), shablon hujjat qaytadi va
 *     to'liq narx olinadi. Foydalanuvchi har mavzuga bir xil umumiy
 *     matn olardi — bu shablon yo'lining dev/demo maqsadi, sotuv emas.
 *
 * `features` hali kelmagan bo'lsa (`null`) hech narsa to'silmaydi:
 * sessiya tekshiruvidan oldin vositani o'chirib qo'yish, uni bir lahza
 * yo'q qilib ko'rsatish bo'lardi.
 */
export function toolBlockedReason(tool: ToolConfig, features?: ToolFeatures | null): string | null {
  if (!features) return null;
  if (tool.custom === "image") {
    return features.images
      ? null
      : "Rasm xizmati vaqtincha o‘chiq: serverda rasm kaliti sozlanmagan.";
  }
  if (!features.llm) {
    return "AI xizmati vaqtincha o‘chiq: serverda matn kaliti sozlanmagan.";
  }
  return null;
}

/**
 * Vosita uchun standart hajm — `pages` yuborilmaganda.
 *
 * Bu qiymat UCH joyda kerak va ilgari uchalasida MUSTAQIL yozilgan edi:
 * `priceFor` (narx), `extractMeta` (dvigatel hajmi) va `defaultsFor`
 * (forma). Ular ajralib ketgan edi (AUDIT-5 P1-7):
 *
 *   maqola/tezis — narx «3–5 bet» (4 000 tanga), dvigatel «10–15» (13 bet)
 *   insho        — narx «1 varaq» (2 000), forma va dvigatel «2 varaq»
 *
 * Ya'ni `pages` siz yuborilgan so'rov 4 000 tangaga 13 betlik ish
 * so'rardi. Forma har doim `pages` yuborgani uchun bu faqat
 * to'g'ridan-to'g'ri API chaqiruvida ko'rinardi — lekin narx serverda
 * hisoblangani bilan maqtangan tizimda bu teshik bo'lib qolardi.
 *
 * Qiymatlar formaning o'z standartiga tenglashtirildi: foydalanuvchi
 * hech narsa tanlamasa nima ko'rsa, API ham shuni oladi.
 */
export function defaultPages(toolId: ToolId): string {
  if (toolId === "essay") return "2";
  if (toolId === "article") return "3-5";
  if (toolId === "thesis") return "1-2";
  if (toolId === "coursework") return "20-25";
  return "10-15";
}

/** `ToolField.hideWhen` — maydon joriy qiymatlarda chiziladimi (forma ham, zond ham shu bilan o'qiydi). */
export function fieldVisible(field: Pick<ToolField, "hideWhen">, values: Record<string, unknown>): boolean {
  const h = field.hideWhen;
  if (!h) return true;
  return !h.values.includes(String(values[h.field] ?? ""));
}

/**
 * Kurs ishi / referat / mustaqil ish hajm paketi — dvigatel bilan BIR
 * XIL normalizatordan (`work/registry.ts normalizeWorkPages`, C12).
 *
 * Ilgari `priceFor` `pages`ni XOM satr sifatida, ANIQ moslikka
 * qidirardi: `"40-45 "` (oxirida bo'sh joy) yoki `"zzz"` (noma'lum)
 * jadvalda topilmay eng arzon tarifga tushardi, `work/input.ts`dagi
 * dvigatel esa AYNAN shu qiymatni kesib (`.trim()`) va noma'lum
 * bo'lsa `"20-25"` ga klamp qilib o'qirdi — narx va yozilgan hajm
 * ajralib ketardi (BEA-01/ABUSE-03).
 *
 * `pages` XOM holda (`?? defaultPages` bilan TO'LDIRMASDAN) shu
 * normalizatorga uzatiladi — `work/input.ts` ham AYNAN shunday qiladi
 * (`values.pages`, standart bilan oldindan to'ldirmaydi). Sharh (R1,
 * review `audit/reviews/W3-J.md`): `defaultPages("referat")` = "10-15"
 * bo'lsa-da, `WorkComposer.tsx` HAR DOIM `pages`ni aniq yuboradi
 * (forma standarti — `normalizeWorkPages(kind, defaultPages(id))` —
 * shunchaki forma HOLATI, so'rov maydoni emas). Ya'ni `pages`
 * berilmagan/`null` so'rov faqat qo'lda yozilgan (forma yubormaydi) —
 * bunda narx endi dvigatel chindan yozadigan «20-25» tarifiga (5 000)
 * to'g'ri keladi, 3 000 EMAS.
 */
function workPagesFor(toolId: ToolId, values: FormValues): string {
  const genre = workGenreOfTool(toolId);
  if (!genre) return String(values.pages ?? defaultPages(toolId));
  const kind = workKindOf(genre, values.workKind ?? values.kind);
  return normalizeWorkPages(kind, values.pages);
}

/**
 * Glossariy atama soni → narx tarifi (10/20/40) — YUQORIGA yaxlitlanadi:
 * dvigatel (`teacher/input.ts glossaryTermCount`) `termCount`ni
 * `glossarySpec.termsMin`..40 oralig'ida ISTALGAN songa klamp qiladi,
 * priceFor esa faqat 3 ta aniq tarif biladi. `39` kabi yaqin qiymat
 * eng yaqin YUQORI tarifga tushishi kerak — aks holda 40 talik hujjat
 * 10 talik narxda (yoki `tool.basePrice` zaxirasida) sotilib qoladi.
 */
function glossaryPriceTier(n: number): "10" | "20" | "40" {
  if (n <= 10) return "10";
  if (n <= 20) return "20";
  return "40";
}

/**
 * Insho narxi varag'i — dvigatel YOZADIGAN hajmdan (W3-J sharhi, C12 sinfi).
 *
 *   • varaq bilan o'lchanadigan kontekst (maktab) — `pages` (1–5, `pagesOf`);
 *   • IELTS — hajm qat'iy 250–330 so'z, `pages` e'tiborsiz → eng kichik varaq
 *     (forma ham aynan `pages = 1` yuboradi);
 *   • akademik esse — dvigatel hajmni `wordTarget` dan oladi va 500–1 000 ga
 *     qisadi (`essayWords`), narx esa «1 varaq ≈ 250 so'z» bilan shu so'zdan
 *     (`EssayComposer.pagesForWords` bilan bir formula).
 *
 * Kanonik forma qiymatlarida (`pages = pagesForWords(wordTarget)`) natija
 * avvalgi `pages` narxi bilan AYNAN bir xil — faqat `pages` va `wordTarget`
 * bir-biriga zid (qo'lda yasalgan) so'rov endi yoziladigan hajm narxini to'laydi.
 */
function essayPricePages(values: FormValues): number {
  const input = essayInputFromValues(values);
  const spec = ESSAY_CONTEXTS[input.context];
  if (spec.sizing === "pages") return input.pages;
  if (input.context === "ielts_task2") return ESSAY_LIMITS.pagesMin;
  const aim = essayWords(input.context, { pages: input.pages, wordTarget: input.wordTarget }).aim;
  const pages = Math.ceil(aim / ESSAY_LIMITS.academicWordsPerPage);
  return Math.max(ESSAY_LIMITS.pagesMin, Math.min(ESSAY_LIMITS.pagesMax, pages));
}

export function priceFor(tool: ToolConfig, values: FormValues): number {
  if (tool.id === "image") {
    const n = Number(values.imageCount || 1);
    if (n >= 4) return 6000;
    if (n >= 2) return 3500;
    return 2000;
  }
  if (tool.id === "slide") {
    // Slayder (4–30): 20 tagacha 3 000, keyingi har slayd +500 — `extractMeta`
    // bilan bir xil klamp (`slidePrice` ichida), narx va deka uzunligi ajralmasin.
    return slidePrice(Number(values.slideCount));
  }
  if (tool.id === "pro-slide") {
    // Har slaydga narx; son `extractMeta` bilan bir xil klamp — narx va
    // deka uzunligi ajralib ketmasin.
    const n = clampInt(values.slideCount, PRO_SLIDE_MIN, PRO_SLIDE_MAX, PRO_SLIDE_DEFAULT);
    return n * PRO_SLIDE_PER_SLIDE;
  }
  if (tool.id === "essay") {
    /*
     * Varaq dvigatel kirishidan (`essayInputFromValues` → `pagesOf`, C12):
     * 1–5 ga yaxlitlanadi/qisiladi, bo'sh/xato qiymat 2 ga tushadi. Ilgari
     * `pages` XOM satr sifatida qidirilardi — `"5 "`, `"99"`, `"4.6"`
     * jadvalda topilmay 2 000 (eng arzon) turardi, dvigatel esa 5
     * varaqlik insho yozardi (BEA-01). So'z bilan o'lchanadigan
     * kontekstlar — `essayPricePages` izohida.
     */
    const pages = essayPricePages(values);
    return { 1: 2000, 2: 2500, 3: 3000, 4: 3500, 5: 4000 }[pages] ?? 2000;
  }
  if (tool.id === "referat" || tool.id === "mustaqil-ish") {
    const pages = workPagesFor(tool.id, values);
    return (
      {
        "10-15": 3000,
        "15-20": 4000,
        "20-25": 5000,
        "25-30": 6000,
      }[pages] ?? 3000
    );
  }
  if (tool.id === "coursework") {
    const pages = workPagesFor(tool.id, values);
    return (
      {
        "10-15": 12000,
        "15-20": 14000,
        "20-25": 16000,
        "25-30": 18000,
        "30-35": 20000,
        "35-40": 22000,
        "40-45": 24000,
      }[pages] ?? tool.basePrice
    );
  }
  if (tool.id === "article") {
    /*
     * Hajm TURGA moslanadi (`articleInputFromValues` bilan bir xil
     * qoida): tezis «10–15» bo'lmaydi — nomuvofiq tanlov turning birinchi
     * paketiga tushadi, narx ham shunga. Aks holda «1–2» narxiga 10 betlik
     * sharh so'rab bo'lardi.
     */
    return ARTICLE_PRICES[normalizeArticlePages(articleTypeOf(values), values.pages ?? defaultPages(tool.id))];
  }
  if (tool.id === "thesis") {
    // Konferensiya hajmi: tur ruxsat bergan paket (`normalizeArticlePages`), narx `THESIS_PRICES`.
    const pages = normalizeArticlePages(ARTICLE_TYPES[thesisTypeId(values)], values.pages ?? defaultPages(tool.id));
    return THESIS_PRICES[pages === "3-5" ? "3-5" : "1-2"];
  }
  if (tool.id === "translation") {
    // Hajm `translationChars` dan — fayl rejimida u SERVER to'ldirgan
    // `sourceChars` ni, matn rejimida esa matnning o'z uzunligini oladi.
    return translationPrice(translationChars(values));
  }
  if (tool.id === "glossary") {
    /*
     * `glossaryTermCount` — dvigatel bilan BIR XIL klamp (C12):
     * tur standarti/`termsMin`..40. Ilgari `termCount` XOM satr
     * sifatida qidirilardi — `"39"` jadvalda topilmay `tool.basePrice`
     * (10 talik tarif, 6 000) turardi, dvigatel esa 39 atamalik (40
     * talik, 15 000) hujjat yozardi (ABUSE-03).
     */
    const n = glossaryTermCount(values);
    return { "10": 6000, "20": 9000, "40": 15000 }[glossaryPriceTier(n)];
  }
  return tool.basePrice;
}

export function formatTanga(n: number) {
  return `${n.toLocaleString("uz-UZ")} tanga`;
}

export function topicOf(values: FormValues, tool: ToolConfig) {
  if (tool.id === "image") {
    return String(values.prompt || values.topic || "Rasm").replace(/\s+/g, " ").trim().slice(0, 72) || "Rasm";
  }
  if (tool.id === "translation") {
    const name = String(values.fileName || "").replace(/\.[^.]+$/, "");
    const hint = String(values.sourceText || values.topic || "Tarjima").replace(/\s+/g, " ").trim().slice(0, 48);
    return name || `Tarjima: ${hint}` || "Tarjima";
  }
  const t = values.topic ?? values.subject ?? values.targetRole ?? tool.title;
  return String(t || tool.title);
}
