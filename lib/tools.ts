import type { FormValues, ToolConfig, ToolId } from "./types";

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

export const TOOLS: ToolConfig[] = [
  {
    id: "slide",
    slug: "slide",
    title: "Slayd",
    pageTitle: "Slayd",
    group: "mashhur",
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
    id: "image",
    slug: "rasm",
    title: "Rasm",
    pageTitle: "Rasm generate",
    group: "mashhur",
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
    group: "mashhur",
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
    group: "mashhur",
    icon: "book-open",
    tc: "20 184 166",
    description: "Tadqiqot ishlarini yarating",
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
    group: "hujjatlar",
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
    group: "hujjatlar",
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
    group: "hujjatlar",
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
    group: "hujjatlar",
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
    group: "hujjatlar",
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
    group: "hujjatlar",
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
    group: "hujjatlar",
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
    group: "hujjatlar",
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
    group: "hujjatlar",
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
    group: "hujjatlar",
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
    if (!filled(f.name)) out.push(f.legend);
  }
  return out;
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
  if (tool.id === "referat" || tool.id === "mustaqil-ish") {
    const pages = String(values.pages ?? "10-15");
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
    const pages = String(values.pages ?? "20-25");
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
    const pages = String(values.pages ?? "3-5");
    return { "3-5": 4000, "5-10": 5000, "10-15": 8000 }[pages] ?? 4000;
  }
  if (tool.id === "thesis") {
    const pages = String(values.pages ?? "3-5");
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
