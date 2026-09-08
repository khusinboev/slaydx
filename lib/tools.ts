import type { FormValues, ToolConfig, ToolField, ToolId, UserProfile } from "./types";
import { PRO_SLIDE_DEFAULT, PRO_SLIDE_MAX, PRO_SLIDE_MIN, PRO_SLIDE_PER_SLIDE, clampInt } from "./generation/slide-params";

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
 * Akademik ish uchun umumiy maydonlar.
 *
 * `universityRequired` — OTME ishlari (kurs ishi, referat, tezis,
 * mustaqil ish) muassasa nomisiz qabul qilinmaydi, shuning uchun ular
 * uchun maydon majburiy. Insho ko'pincha maktab ishi bo'lgani sababli
 * undan talab qilinmaydi.
 */
function writerFields(opts: { universityRequired?: boolean } = {}): ToolConfig["fields"] {
  return WRITER_FIELDS.map((f) =>
    f.name === "university" && opts.universityRequired ? { ...f, required: true } : f,
  );
}

const WRITER_FIELDS: ToolConfig["fields"] = [
  {
    kind: "text",
    name: "author",
    legend: "To'liq ismingiz, kursingiz va guruhingizni yozing",
    placeholder: "Aliyev Ali — 3-kurs, 301-guruh",
    required: true,
  },
  {
    kind: "text",
    name: "university",
    legend: "Oliy ta'lim muassasasi",
    placeholder: "Toshkent davlat universiteti",
  },
  {
    kind: "text",
    name: "faculty",
    legend: "Fakultet nomini kiriting",
    placeholder: "Fakultet",
  },
  {
    kind: "text",
    name: "department",
    legend: "Kafedra",
    placeholder: "Kafedra nomi",
  },
  {
    kind: "text",
    name: "subject",
    legend: "Fan nomini kiriting",
    placeholder: "Misol: Ona tili",
  },
  {
    kind: "text",
    name: "teacher",
    legend: "O'qituvchi / rahbar",
    placeholder: "F.I.Sh",
  },
  {
    kind: "text",
    name: "city",
    legend: "Shahar",
    placeholder: "Toshkent",
  },
];

/**
 * Maxsus formali vositalarning MAJBURIY maydonlari.
 *
 * `image`, `resume` va `translation` o'z formalarini chizadi
 * (`ImageStudio`, `ResumeWizard`, `TranslationForm`), shuning uchun
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
};

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
 * `writerFields` dagi `university` dan alohida: yorliq va namuna
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
    basePrice: 12000,
    fields: [
      { kind: "language", name: "language", legend: "Kurs ishi tilini tanlang" },
      ...writerFields({ universityRequired: true }),
      {
        kind: "chips",
        name: "ministry",
        legend: "Vazirlik",
        options: [
          {
            value: "oliy",
            label: "Oliy ta'lim, fan va innovatsiyalar",
          },
          { value: "maktab", label: "Maktabgacha va maktab ta'limi" },
        ],
      },
      {
        kind: "chips",
        name: "tocMethod",
        legend: "Mundarijani o'zingiz yozasizmi yoki AI avtomatik yaratishini xohlaysizmi?",
        options: [
          { value: "ai", label: "Avtomatik AI yaratishi" },
          { value: "manual", label: "O'zim yozaman" },
        ],
      },
      {
        kind: "textarea",
        name: "tocText",
        legend: "Mundarija matni",
        placeholder: "Kirish\nI bob. ...\nII bob. ...\nXulosa",
        extra: true,
      },
      {
        kind: "chips",
        name: "pages",
        legend: "Sahifalar soni",
        options: [
          { value: "10-15", label: "10-15 bet" },
          { value: "15-20", label: "15-20 bet" },
          { value: "20-25", label: "20-25 bet" },
          { value: "25-30", label: "25-30 bet" },
          { value: "30-35", label: "30-35 bet" },
          { value: "35-40", label: "35-40 bet" },
          { value: "40-45", label: "40-45 bet" },
        ],
      },
      {
        kind: "chips",
        name: "images",
        // Ilgari «Jadval va rasmlar» deb yozilgan, lekin dvigatel DOCX ga
        // hech qachon rasm qo'ymagan — faqat jadval. Yorliq shu sababli
        // aniqlashtirildi.
        legend: "Tasnif jadvali qo'shilsinmi?",
        options: [
          { value: "yes", label: "Ha" },
          { value: "no", label: "Yo'q" },
        ],
      },
    ],
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
    basePrice: 3000,
    fields: [
      { kind: "language", name: "language", legend: "Referat tilini tanlang" },
      ...writerFields({ universityRequired: true }),
      {
        kind: "chips",
        name: "pages",
        legend: "Referat hajmini tanlang (sahifalar soni)",
        options: [
          { value: "10-15", label: "10-15 bet" },
          { value: "15-20", label: "15-20 bet" },
          { value: "20-25", label: "20-25 bet" },
          { value: "25-30", label: "25-30 bet" },
        ],
      },
    ],
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
    fields: [
      { kind: "language", name: "language", legend: "Insho tilini tanlang" },
      ...writerFields({ universityRequired: false }),
      {
        kind: "design",
        name: "design",
        legend: "Hujjat dizaynini tanlang",
      },
      {
        kind: "chips",
        name: "pages",
        legend: "Insho necha varaq (A4) bo'lsin?",
        options: [
          { value: "1", label: "1 varaq" },
          { value: "2", label: "2 varaq" },
          { value: "3", label: "3 varaq" },
          { value: "4", label: "4 varaq" },
          { value: "5", label: "5 varaq" },
        ],
      },
    ],
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
    basePrice: 4000,
    fields: [
      { kind: "language", name: "language", legend: "Maqola tilini tanlang" },
      {
        kind: "text",
        name: "author",
        legend: "To'liq ismingiz, kursingiz va guruhingizni yozing",
        placeholder: "Aliyev Ali Valiyevich",
        required: true,
      },
      {
        kind: "text",
        name: "degree",
        legend: "Ilmiy daraja yoki lavozim",
        placeholder: "Talaba / PhD / dotsent",
      },
      {
        kind: "text",
        name: "organization",
        legend: "Tashkilot (to‘liq nomi)",
        placeholder: "Toshkent davlat universiteti, Toshkent",
        required: true,
      },
      {
        kind: "email",
        name: "email",
        legend: "E-mail manzil",
        placeholder: "name@example.com",
        required: true,
      },
      {
        kind: "chips",
        name: "kind",
        legend: "Maqola turini tanlang",
        options: [
          { value: "standard", label: "Standart maqola" },
          { value: "imrad", label: "IMRAD (ilmiy format)" },
        ],
      },
      {
        kind: "chips",
        name: "annotationLangs",
        legend: "Annotatsiya tillarini tanlang",
        options: [
          { value: "same", label: "Faqat maqola tilida" },
          { value: "all", label: "Barcha tillar (UZ + EN + RU)" },
        ],
      },
      {
        kind: "chips",
        name: "pages",
        legend: "Maqola hajmini tanlang (sahifalar soni)",
        options: [
          { value: "3-5", label: "3-5 bet" },
          { value: "5-10", label: "5-10 bet" },
          { value: "10-15", label: "10-15 bet" },
        ],
      },
    ],
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
    pageTitle: "Tezis sozlamalari",
    group: "talaba",
    icon: "graduation-cap",
    tc: "6 182 212",
    description: "Ilmiy tezislar yarating",
    submitLabel: "Tezisni yaratish",
    creatingLabel: "Tezis yaratilmoqda...",
    createdLabel: "tezis tayyor!",
    topicLegend: "Tezis mavzusini kiriting",
    topicPlaceholder: "Mavzuni kiriting...",
    extraOptional: true,
    output: "docx",
    basePrice: 4000,
    fields: [
      { kind: "language", name: "language", legend: "Tezis tilini tanlang" },
      {
        kind: "text",
        name: "author",
        legend: "To'liq ismingiz, kursingiz va guruhingizni yozing",
        placeholder: "Aliyev Ali — 4-kurs, 401-guruh",
        required: true,
      },
      ...writerFields({ universityRequired: true }).filter((f) => f.name !== "author"),
      {
        kind: "chips",
        name: "kind",
        legend: "Tezis turini tanlang",
        options: [
          { value: "standard", label: "Standart" },
          { value: "imrad", label: "Ilmiy (IMRAD)" },
        ],
      },
      {
        kind: "chips",
        name: "pages",
        legend: "Tezis hajmini tanlang (sahifalar soni)",
        options: [
          { value: "3-5", label: "3-5 bet" },
          { value: "5-10", label: "5-10 bet" },
          { value: "10-15", label: "10-15 bet" },
          { value: "15-20", label: "15-20 bet" },
          { value: "20-25", label: "20-25 bet" },
        ],
      },
      {
        kind: "chips",
        name: "annotationLangs",
        legend: "Annotatsiya va kalit so‘zlar qaysi tillarda bo‘lsin?",
        options: [
          { value: "same", label: "Faqat tezis tilida" },
          { value: "all", label: "Barcha tillar (UZ + EN + RU)" },
        ],
      },
    ],
  },
  {
    id: "translation",
    slug: "translation",
    title: "Tarjimon",
    pageTitle: "Tarjimon",
    group: "umumiy",
    icon: "languages",
    tc: "16 185 129",
    description: "Matn yoki DOCX, PDF, PPTX, TXT faylni tarjima qiling",
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
    createdLabel: "texnologik xarita tayyor!",
    extraOptional: true,
    output: "docx",
    basePrice: 6000,
    fields: [
      {
        kind: "text",
        name: "subject",
        legend: "Fan nomi",
        placeholder: "Informatika",
        required: true,
      },
      {
        kind: "number",
        name: "weeklyHours",
        legend: "Haftalik soatlar",
        placeholder: "4",
        min: 1,
        max: 20,
        required: true,
      },
      {
        kind: "number",
        name: "totalHours",
        legend: "Jami soatlar (o'quv yili bo'yicha)",
        placeholder: "136",
        min: 1,
        max: 400,
        required: true,
      },
      {
        kind: "textarea",
        name: "extra",
        legend: "Mavzu, yo'nalish va boshqa qo'shimchalar",
        placeholder: "Qo'shimcha talablar...",
        extra: true,
      },
    ],
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
    extraOptional: true,
    output: "docx",
    basePrice: 6000,
    fields: [
      {
        kind: "text",
        name: "topic",
        legend: "Mavzu yoki fan nomi",
        placeholder: "Biologiya atamalari",
        required: true,
      },
      { kind: "language", name: "language", legend: "Qaysi tilda?" },
      {
        kind: "chips",
        name: "termCount",
        legend: "Nechta atama kerak?",
        options: [
          { value: "10", label: "10 ta" },
          { value: "20", label: "20 ta" },
          { value: "40", label: "40 ta" },
        ],
      },
      {
        kind: "textarea",
        name: "extra",
        legend: "Modul, mavzu chegarasi va boshqa qo'shimchalar",
        extra: true,
      },
    ],
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
    extraOptional: true,
    output: "docx",
    basePrice: 6000,
    fields: [
      {
        kind: "text",
        name: "topic",
        legend: "Mavzu yoki fan nomi",
        placeholder: "Pedagogika keys-stadilari",
        required: true,
      },
      { kind: "language", name: "language", legend: "Qaysi tilda?" },
      {
        kind: "textarea",
        name: "extra",
        legend: "Seminar, kurs ishi, imtihon va boshqa vaziyatlar",
        extra: true,
      },
    ],
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
    basePrice: 3000,
    fields: [
      { kind: "language", name: "language", legend: "Mustaqil ish tilini tanlang" },
      ...writerFields({ universityRequired: true }),
      {
        kind: "chips",
        name: "pages",
        legend: "Hajm (sahifalar soni)",
        options: [
          { value: "10-15", label: "10-15 bet" },
          { value: "15-20", label: "15-20 bet" },
          { value: "20-25", label: "20-25 bet" },
          { value: "25-30", label: "25-30 bet" },
        ],
      },
      {
        kind: "chips",
        name: "tocMethod",
        legend: "Rejani o'zingiz yozasizmi yoki AI avtomatik yaratishini xohlaysizmi?",
        options: [
          { value: "ai", label: "Avtomatik AI yaratishi" },
          { value: "manual", label: "O'zim yozaman" },
        ],
      },
      {
        kind: "textarea",
        name: "tocText",
        legend: "Reja matni",
        extra: true,
      },
    ],
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
    extraOptional: true,
    output: "docx",
    basePrice: 4000,
    fields: [
      {
        kind: "text",
        name: "topic",
        legend: "Dars mavzusi nima?",
        placeholder: "Fotosintez jarayoni",
        required: true,
      },
      {
        kind: "text",
        name: "subject",
        legend: "Qaysi fan?",
        placeholder: "Biologiya",
        required: true,
      },
      {
        kind: "range",
        name: "grade",
        legend: "Nechinchi sinf?",
        min: 1,
        max: 11,
      },
      {
        kind: "chips",
        name: "duration",
        legend: "Dars necha daqiqa?",
        options: [
          { value: "30", label: "30" },
          { value: "45", label: "45" },
          { value: "90", label: "90" },
        ],
      },
      { kind: "language", name: "language", legend: "Qaysi tilda?" },
    ],
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
   */
  if (tool.group === "oqituvchi") {
    const rest = tool.fields.filter((f) => f.extra);
    const main = tool.fields.filter((f) => !f.extra);
    tool.fields = [...main, ...TEACHER_FIELDS, ...rest];
  }
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

  // «Fayl asosida» rejimida mavzu o'rniga manba matni bo'ladi.
  const fileMode = Boolean(tool.modes) && String(values.mode ?? "") === "file";
  if (tool.topicLegend && !fileMode && !filled("topic")) out.push(tool.topicLegend);
  if (fileMode && !filled("sourceText")) out.push("Manba fayl matni");

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
export const MAX_SOURCE_CHARS = 60_000;

/**
 * Bir marta tarjima qilinadigan eng katta matn.
 *
 * `writeTranslationWithLlm` matnni 4 000 belgilik bo'laklarga bo'ladi va
 * eng ko'pi 15 tasini ishlaydi. Chegara haqiqiy imkoniyatga teng va u
 * pul yechilishidan OLDIN tekshiriladi.
 */
export const TRANSLATION_MAX_CHARS = 48_000;

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
       * halolroq: aks holda 150 000 belgi yuborgan odam «60 000 belgi»
       * degan xatoni o'qib, nimani qisqartirishini tushunmasdi.
       */
      const clipped = n >= MAX_SOURCE_CHARS;
      const size = `${n.toLocaleString("uz-UZ")}${clipped ? " dan ortiq" : ""}`;
      return (
        `Matn juda uzun: ${size} belgi. ` +
        `Bir marta ${TRANSLATION_MAX_CHARS.toLocaleString("uz-UZ")} belgigacha tarjima qilinadi — ` +
        `hujjatni bo'laklarga bo'lib yuboring.`
      );
    }
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
  if (toolId === "article" || toolId === "thesis") return "3-5";
  if (toolId === "coursework") return "20-25";
  return "10-15";
}

export function priceFor(tool: ToolConfig, values: FormValues): number {
  if (tool.id === "image") {
    const n = Number(values.imageCount || 1);
    if (n >= 4) return 6000;
    if (n >= 2) return 3500;
    return 2000;
  }
  if (tool.id === "slide") {
    const q = String(values.quality ?? "standard");
    return (
      {
        standard: 3000,
        long: 5000,
        premium: 6000,
        premium_long: 8000,
      }[q] ?? 3000
    );
  }
  if (tool.id === "pro-slide") {
    // Har slaydga narx; son `extractMeta` bilan bir xil klamp — narx va
    // deka uzunligi ajralib ketmasin.
    const n = clampInt(values.slideCount, PRO_SLIDE_MIN, PRO_SLIDE_MAX, PRO_SLIDE_DEFAULT);
    return n * PRO_SLIDE_PER_SLIDE;
  }
  if (tool.id === "essay") {
    const pages = String(values.pages ?? defaultPages(tool.id));
    // Ilgari 1 varaq ham, 5 varaq ham 2 000 tanga turardi — forma 1–5
    // varaq tanlovini bersa ham, narx hech qachon o'zgarmasdi.
    return { "1": 2000, "2": 2500, "3": 3000, "4": 3500, "5": 4000 }[pages] ?? 2000;
  }
  if (tool.id === "referat" || tool.id === "mustaqil-ish") {
    const pages = String(values.pages ?? defaultPages(tool.id));
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
    const pages = String(values.pages ?? defaultPages(tool.id));
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
    const pages = String(values.pages ?? defaultPages(tool.id));
    return { "3-5": 4000, "5-10": 5000, "10-15": 8000 }[pages] ?? 4000;
  }
  if (tool.id === "thesis") {
    const pages = String(values.pages ?? defaultPages(tool.id));
    return (
      {
        "3-5": 4000,
        "5-10": 5000,
        "10-15": 6000,
        "15-20": 7000,
        "20-25": 8000,
      }[pages] ?? 4000
    );
  }
  if (tool.id === "glossary") {
    const n = String(values.termCount ?? "10");
    return { "10": 6000, "20": 9000, "40": 15000 }[n] ?? tool.basePrice;
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
