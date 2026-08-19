import type { AcademicDoc, Block, DocMeta, DocSection } from "./types";

function p(text: string): Block {
  return { kind: "p", text };
}

function paras(n: number, factory: (i: number) => string): Block[] {
  return Array.from({ length: Math.max(1, n) }, (_, i) => p(factory(i)));
}

function section(id: string, title: string, blocks: Block[]): DocSection {
  return { id, title, blocks };
}

function t(meta: DocMeta) {
  return meta.topic.replace(/\s+/g, " ").trim();
}

function extraNote(meta: DocMeta): Block[] {
  if (!meta.extra) return [];
  return [p(`Qo‘shimcha talab: ${meta.extra}`)];
}

function refs(meta: DocMeta): string[] {
  const year = new Date().getFullYear();
  const topic = t(meta);
  return [
    `${topic}. O‘quv qo‘llanma / soha adabiyoti. – Toshkent: O‘qituvchi.`,
    `Soha nazariyasi asoslari. O‘quv qo‘llanma. – Toshkent.`,
    `Amaliy mashg‘ulotlar to‘plami. – Toshkent.`,
    `O‘zbekiston Respublikasi Oliy ta’lim, fan va innovatsiyalar vazirligi. O‘quv-uslubiy ko‘rsatmalar. – Toshkent, ${year}.`,
    `O‘quv-uslubiy qo‘llanma. – ${meta.city}.`,
    `Ma’ruza matnlari. – Toshkent.`,
  ];
}

function kirish(meta: DocMeta, pages: number): Block[] {
  const topic = t(meta);
  const more = pages >= 10 ? 2 : pages >= 5 ? 1 : 0;
  return [
    p(
      `${topic} — tizimli o‘rganishni talab qiladigan mavzu. Uni aniqlash, unsurlarga ajratish va amaliy tomonini ko‘rsatish ishning asosiy yo‘nalishi hisoblanadi.`,
    ),
    p(
      `Ishning maqsadi — «${topic}» ning mohiyati, asosiy unsurlari va amaliy ahamiyatini bayon etish, muammo va tavsiyalarni ko‘rsatishdir.`,
    ),
    p(
      `Vazifalar: 1) tushuncha va tasnifni ochish; 2) asosiy unsurlarni tushuntirish; 3) amaliy holat va muammolarni ko‘rsatish; 4) xulosa berish.`,
    ),
    ...paras(more, (i) =>
      i === 0
        ? `Tadqiqot obyekti — ${topic.toLowerCase()} bilan bog‘liq nazariy va amaliy jarayonlar; predmeti — shu jarayonlarni samarali tashkil etish omillari.`
        : `Metodlar: tahlil va sintez, qiyoslash, tizimli yondashuv, hujjatlar tahlili. Manba sifatida qonun-hujjatlar, o‘quv-uslubiy adabiyot va ochiq ilmiy nashrlar olindi.`,
    ),
    ...extraNote(meta),
  ];
}

function nazariy(meta: DocMeta, pages: number): Block[] {
  const topic = t(meta);
  const n = pages >= 20 ? 5 : pages >= 12 ? 4 : pages >= 6 ? 3 : 2;
  return paras(n, (i) => {
    const parts = [
      `${topic} alohida fakt emas, balki bog‘liq tushunchalar tizimi sifatida o‘rganiladi.`,
      `Tasnif mohiyat, vazifa yoki qo‘llanishga qarab olib boriladi. Har bir tur o‘z imkoniyati va chekloviga ega.`,
      `Asosiy unsurlari o‘zaro bog‘liq: birining zaifligi butun holatga ta’sir qiladi.`,
      `Jarayon odatda shart — o‘zgarish — natija zanjiriga asoslanadi. Sharoit e’tiborsiz qolsa, xulosa yuzaki bo‘ladi.`,
      `Zamonaviy yondashuvda tahlil va amaliyot birga olib boriladi, lekin asosiy tushunchalar o‘zgarmaydi.`,
    ];
    return parts[i % parts.length];
  });
}

function amaliy(meta: DocMeta, pages: number): Block[] {
  const topic = t(meta);
  const n = pages >= 20 ? 5 : pages >= 12 ? 4 : 3;
  return [
    p(
      `${topic} ni amaliyotda qo‘llashda sharoit, mezon va ketma-ketlikka rioya qilish birinchi darajali shart hisoblanadi.`,
    ),
    ...paras(n - 1, (i) => {
      const parts = [
        `Tipik muammolar: tushunchaning noaniqligi, sharoitni e’tiborsiz qoldirish, mezonning yo‘qligi.`,
        `Tahlil tartibi: avval holat, so‘ng sabab, keyin yechim. Yuzaki belgi e’tiborsiz qolmasin.`,
        `Amaliyot: reja, bajarish, natijani tekshirish. Takrorlash sifatni oshiradi.`,
        `Cheklov: resurs, vaqt va mahalliy sharoit hisobga olinishi kerak.`,
      ];
      return parts[i % parts.length];
    }),
  ];
}

function xulosa(meta: DocMeta): Block[] {
  const topic = t(meta);
  return [
    p(
      `${topic} tizimli tushunilsa, qaror aniqroq bo‘ladi: to‘g‘ri yondashuv tanlanadi, muammo erta seziladi.`,
    ),
    p(
      `Tavsiyalar: 1) tushunchani aniq belgilash; 2) unsurlarni ajratib tahlil qilish; 3) sharoitni hisobga olish; 4) amaliy qadamni mezonga bog‘lash.`,
    ),
    p(
      `Keyingi chuqurlashtirish: aniq misol, mahalliy holat va qo‘shimcha manbalar asosida amaliy mashg‘ulot.`,
    ),
  ];
}

function academicChapters(meta: DocMeta, work: string): AcademicDoc {
  const pages = meta.targetPages;
  const twoChapters = pages < 18;
  const sections: DocSection[] = [
    section("kirish", "Kirish", kirish(meta, pages)),
    section(
      "bob1",
      `I BOB. ${t(meta).toUpperCase()}NING NAZARIY ASOSLARI`,
      [
        { kind: "h2", text: "1.1. Tushuncha, mohiyat va tasnif" },
        ...nazariy(meta, pages),
        { kind: "h2", text: "1.2. Tuzilish va ishlash prinsipi" },
        ...paras(pages >= 15 ? 3 : 2, (i) =>
          i === 0
            ? `${t(meta)} asosiy qismlardan tashkil topadi; ularning har biri alohida vazifa bajaradi va umuman tizim ishini ta’minlaydi.`
            : `Jarayon shart — o‘zgarish — natija zanjiriga asoslanadi. Sharoit buzilsa, kutilgan natija o‘zgarmaydi.`,
        ),
      ],
    ),
  ];
  if (twoChapters) {
    sections.push(
      section("bob2", `II BOB. AMALIY TAHLIL VA TAVSIYALAR`, [
        { kind: "h2", text: "2.1. Amaliy mexanizmlar" },
        ...amaliy(meta, pages),
        { kind: "h2", text: "2.2. Texnik xizmat va tavsiyalar" },
        p(
          `${meta.subject || work} doirasida ${t(meta).toLowerCase()} ni ishlatishda ishchi muhit, tozalik va belgilangan rejimga rioya qilish zarur.`,
        ),
      ]),
    );
  } else {
    sections.push(
      section("bob2", `II BOB. AMALIY TAHLIL`, [
        { kind: "h2", text: "2.1. Holat tahlili" },
        ...amaliy(meta, pages),
      ]),
      section("bob3", `III BOB. TAKOMILLASHTIRISH YO‘LLARI`, [
        { kind: "h2", text: "3.1. Taklif etiladigan model" },
        p(
          `Taklif: ko‘rik — tashxis — bartaraf etish — nazorat. Har bir bosqichda ${t(meta).toLowerCase()} ning ish belgilari qayd etiladi.`,
        ),
        { kind: "h2", text: "3.2. Kutilgan natija" },
        p(
          `To‘g‘ri xizmat va rejimga rioya qilinsa, ish muddati uzayadi, avariya xavfi kamayadi.`,
        ),
      ]),
    );
  }
  sections.push(section("xulosa", "Xulosa", xulosa(meta)));
  return {
    meta,
    titlePage: true,
    toc: true,
    sections,
    references: refs(meta),
  };
}

function essayDoc(meta: DocMeta): AcademicDoc {
  const topic = t(meta);
  const pages = Math.min(5, Math.max(1, meta.targetPages));
  const bands = pages <= 1 ? 1 : pages <= 2 ? 2 : 3;
  const sections: DocSection[] = [
    section("kirish", "Kirish", [
      p(
        `${topic} — inson, jamiyat va ma’naviyat uchun muhim mavzulardan. Bu inshoda mavzuning mohiyati, ahamiyati va shaxsiy munosabat ochib beriladi.`,
      ),
    ]),
  ];
  const titles = [
    "Asosiy qism. Mohiyat va mazmun",
    "Asosiy qism. Hayotiy misollar va mushohada",
    "Asosiy qism. Xulosa sari yo‘l",
  ];
  for (let i = 0; i < bands; i++) {
    sections.push(
      section(`asosiy${i + 1}`, titles[i], paras(pages <= 2 ? 2 : 3, (j) => {
        const bank = [
          `${topic} haqida o‘ylaganda, avvalo uning inson qalbidagi o‘rni ko‘z oldimizga keladi. Bu nafaqat bilim, balki munosabat va mas’uliyat masalasidir.`,
          `Hayotiy misollar shuni ko‘rsatadiki, ${topic.toLowerCase()} ga e’tibor qaratilganda jamiyatda ishonch, mehnat va o‘zaro hurmat kuchayadi.`,
          `Aksincha, mavzu e’tibordan chetda qolsa, yuzaki yondashuv, befarqlik va ma’naviy bo‘shliq paydo bo‘ladi. Shu bois mushohada chuqur bo‘lishi kerak.`,
          `Yosh avlod tarbiyasida ${topic.toLowerCase()} ni so‘zda emas, kundalik odatda ko‘rsatish muhim. Kichik ishlar katta oqibatlarga olib keladi.`,
        ];
        return bank[(i + j) % bank.length];
      })),
    );
  }
  sections.push(
    section("xulosa", "Xulosa", [
      p(
        `Xulosa qilib aytganda, ${topic.toLowerCase()} — shaxs kamoloti va jamiyat taraqqiyotining ajralmas qismi. Uni anglash, qadrlash va amalda ko‘rsatish — har birimizning burchimiz.`,
      ),
    ]),
  );
  return { meta, titlePage: true, toc: false, sections };
}

function imradDoc(meta: DocMeta, label: string): AcademicDoc {
  const topic = t(meta);
  const abstracts =
    meta.annotationLangs === "all"
      ? [
          {
            lang: "uz",
            label: "Annotatsiya",
            text: `Maqolada «${topic}» masalasi IMRAD tuzilmasi asosida yoritiladi. Kirishda tadqiqot savoli qo‘yiladi, metodlarda tahlil usullari, natijalarda asosiy topilmalar, muhokamada ahamiyat bayon etiladi.`,
            keywords: `${topic.toLowerCase()}, tadqiqot, metod, natija, muhokama`,
          },
          {
            lang: "en",
            label: "Abstract",
            text: `The paper discusses “${topic}” using the IMRAD structure: research question, methods, main findings and implications.`,
            keywords: `${topic.toLowerCase()}, research, methods, results, discussion`,
          },
          {
            lang: "ru",
            label: "Аннотация",
            text: `В статье вопрос «${topic}» рассматривается по структуре IMRAD: постановка проблемы, методы, результаты и обсуждение.`,
            keywords: `${topic.toLowerCase()}, исследование, методы, результаты`,
          },
        ]
      : [
          {
            lang: meta.language,
            label: "Annotatsiya",
            text: `Ishda «${topic}» IMRAD (Introduction, Methods, Results, Discussion) tartibida yoritiladi.`,
            keywords: `${topic.toLowerCase()}, IMRAD, tadqiqot`,
          },
        ];

  const n = meta.targetPages >= 10 ? 3 : 2;
  return {
    meta,
    titlePage: true,
    toc: true,
    abstracts,
    sections: [
      section("intro", "1. Kirish (Introduction)", [
        p(`Tadqiqot savoli: ${topic} qanday mexanizmlar orqali samarali hal etiladi?`),
        ...paras(n, (i) =>
          i === 0
            ? `Mavzu keng kontekstda qo‘yiladi: nima ma’lum, qayerda bo‘shliq bor, nima uchun hozir o‘rganish kerak.`
            : `Maqsad — savolga tizimli javob berish va amaliy ahamiyatini ko‘rsatish. ${label} formati shu mantiqqa mos.`,
        ),
      ]),
      section("methods", "2. Metodlar (Methods)", [
        p(`Kim, qachon, qayerda, qanday: adabiyot tahlili, qiyoslash, hujjatlar tahlili va mantiqiy umumlashtirish qo‘llanildi.`),
        p(`Tanlov mezoni — ochiq, tekshiriladigan manbalar. Cheklov: empirik eksperiment o‘tkazilmagan, xulosa tahliliy xarakterga ega.`),
      ]),
      section("results", "3. Natijalar (Results)", nazariy(meta, meta.targetPages).slice(0, n + 1)),
      section("discussion", "4. Muhokama (Discussion)", [
        ...xulosa(meta),
        p(`Natijalar mavjud adabiyot bilan mos: tizimli yondashuv ${topic.toLowerCase()} samarasini oshiradi, lekin mahalliylashtirish shart.`),
      ]),
    ],
    references: refs(meta),
  };
}

function glossaryDoc(meta: DocMeta): AcademicDoc {
  const topic = t(meta);
  const terms = [
    [topic, `«${topic}» — ushbu glossariyning markaziy tushunchasi.`],
    [`${topic}: asosiy tushuncha`, `Mavzuni boshqa hodisalardan ajratib turuvchi asosiy xususiyat.`],
    [`${topic}: tasnif`, `Turlarga ajratish: mohiyat, vazifa yoki qo‘llanish bo‘yicha.`],
    [`${topic}: jarayon`, `Hodisaning ketma-ket kechishi yoki amalga oshish tartibi.`],
    [`${topic}: omil`, `Natijaga ta’sir qiluvchi ichki yoki tashqi shart.`],
    [`${topic}: ko‘rsatkich`, `O‘zgarishni kuzatish uchun o‘lchanadigan belgi.`],
    [`${topic}: vosita`, `Maqsadga erishishda qo‘llaniladigan usul yoki vosita.`],
    [`${topic}: cheklov`, `Amalga oshirishni qiyinlashtiradigan shart yoki to‘siq.`],
    [`${topic}: natija`, `Kutilgan yoki kuzatilgan yakuniy holat.`],
    [`${topic}: baholash`, `Natijani oldindan belgilangan o‘lchovga solishtirish.`],
    [`${topic}: xavf`, `Salbiy oqibat ehtimoli va uning og‘irligi.`],
    [`${topic}: tavsiya`, `Amaliyot uchun qisqa, bajariladigan qadam.`],
  ];
  return {
    meta,
    titlePage: true,
    toc: false,
    sections: [
      section("kirish", "Kirish", [
        p(`Ushbu glossariy «${topic}» bo‘yicha asosiy atamalarni qisqa va bir xil uslubda izohlaydi.`),
      ]),
      section("atamalar", "Atamalar ro‘yxati", [
        ...terms.flatMap(([a, b]) => [
          { kind: "h3" as const, text: `${topic}: ${a}` },
          p(b),
        ]),
      ]),
    ],
    tables: [{ caption: "Qisqa jadval", headers: ["Atama", "Izoh"], rows: terms }],
  };
}

function keysDoc(meta: DocMeta): AcademicDoc {
  const topic = t(meta);
  const cases = [1, 2, 3, 4, 5].map((n) =>
    section(`keys${n}`, `Keys ${n}. ${topic} bo‘yicha vaziyat`, [
      p(
        `Vaziyat: resurs cheklangan, muddat qisqa, manfaatdor tomonlarning talabi turlicha. Siz ${topic.toLowerCase()} masalasida qaror qabul qilishingiz kerak.`,
      ),
      { kind: "h3", text: "Topshiriqlar" },
      { kind: "li", text: "Muammoni aniqlang va manfaatdor tomonlarni sanang." },
      { kind: "li", text: "Kamida ikkita yechim variantini mezonlar bilan asoslang." },
      { kind: "li", text: "Eng maqbul yechimni tanlang va 3 ta amaliy qadam yozing." },
      { kind: "h3", text: "Namunaviy kalit" },
      p(
        `Avval holat tahlili, so‘ng mezonlar (samaradorlik, xarajat, axloqiy jihat), keyin qisqa reja-jadval. Qaror asoslanishi ochiq bo‘lishi shart.`,
      ),
    ]),
  );
  return {
    meta,
    titlePage: true,
    toc: true,
    sections: [
      section("kirish", "Kirish", [
        p(`Kalitlar (keys) — vaziyatli topshiriq va namunaviy javob. Mavzu: ${topic}.`),
      ]),
      ...cases,
    ],
  };
}

function techMapDoc(meta: DocMeta): AcademicDoc {
  const subject = meta.subject || t(meta);
  const weekly = Math.max(1, meta.weeklyHours);
  const total = Math.max(weekly, meta.totalHours);
  const weeks = Math.max(8, Math.min(36, Math.round(total / weekly)));
  const methods = ["Ma’ruza + suhbat", "Amaliy mashg‘ulot", "Mustaqil ish / loyiha", "Laboratoriya", "Takror va nazorat"];
  const bank = [
    "Kirish. Fan predmeti va vazifasi",
    "Asosiy tushunchalar",
    "Tuzilish va tasnif",
    "Jarayonlar va qonuniyatlar",
    "Amaliy mashq",
    "Mustahkamlash",
    "Nazorat ishi",
    "Takrorlash",
  ];
  const rows = Array.from({ length: weeks }, (_, i) => [
    String(i + 1),
    String(weekly),
    `${subject}: ${bank[i % bank.length]}${i >= bank.length ? ` (${Math.floor(i / bank.length) + 1})` : ""}`,
    methods[i % methods.length],
    `${subject}: ${bank[i % bank.length]} bo‘yicha tushuntira oladi`,
    ["Og‘zaki so‘rov", "Yozma topshiriq", "Amaliy ish", "Test"][i % 4],
  ]);
  return {
    meta,
    titlePage: true,
    toc: false,
    sections: [
      section("passport", "1. Fan pasporti", [
        p(`Fan: ${subject}. Haftalik soat: ${weekly}. Jami soat (o‘quv yili): ${total}. Haftalar soni: ${weeks}.`),
        p(
          `Texnologik xarita — o‘qituvchi va o‘quvchi o‘rtasidagi pedagogik munosabatni rejalashtirish shakli: mavzu, soat, metod, natija, nazorat.`,
        ),
        ...extraNote(meta),
      ]),
    ],
    tables: [
      {
        caption: "O‘quv yili bo‘yicha taqsimot",
        headers: ["Hafta", "Soat", "Mavzu", "Metod", "Kutilgan natija", "Nazorat"],
        rows,
      },
    ],
  };
}

function lessonDoc(meta: DocMeta): AcademicDoc {
  const topic = t(meta);
  const d = meta.duration || 45;
  const main = Math.max(12, d - 20);
  return {
    meta,
    titlePage: true,
    toc: false,
    sections: [
      section("passport", "Dars pasporti", [
        p(`Fan: ${meta.subject || "Fan"}. Sinf: ${meta.grade}. Davomiyligi: ${d} daqiqa.`),
        p(`Mavzu: ${topic}`),
        p(
          `Maqsad: o‘quvchilar «${topic}» ni tushuntira olsin, 2–3 ta aniq misol yecha olsin va xatoni tuzata olsin.`,
        ),
        p(`Jihozlar: darslik, doska, tarqatma, proyektor.`),
        ...extraNote(meta),
      ]),
      section("map", "Darsning texnologik xaritasi", [
        { kind: "h3", text: `1. Tashkiliy qism (3 daq)` },
        p(`Salomlashish, davomat. Bugungi mavzu — «${topic}» — e’lon qilinadi.`),
        { kind: "h3", text: `2. Uyga vazifani tekshirish (5 daq)` },
        p(`Oldingi mavzudan 2–3 savol; javob «${topic}» ga bog‘lab tuzatiladi.`),
        { kind: "h3", text: `3. Yangi mavzuga yo‘naltirish (5 daq)` },
        p(`Muammoli savol: «${topic}» ni qayerda ishlatamiz? Qisqa vaziyat yoki doskada 1 misol.`),
        { kind: "h3", text: `4. Asosiy qism (${main} daq)` },
        p(`«${topic}» qoida bilan tushuntiriladi, 1–2 namuna, juftlikda mashq, mustahkamlash.`),
        { kind: "h3", text: `5. Baholash va xulosa (5 daq)` },
        p(`3 ta savol: ta’rif, misol, xato qidirish. Bugun «${topic}» dan nima qoldi?`),
        { kind: "h3", text: `6. Uyga vazifa (2 daq)` },
        p(`«${topic}» bo‘yicha 5 ta savol va 1 ta amaliy topshiriq.`),
      ]),
    ],
    tables: [
      {
        caption: "Vaqt taqsimoti",
        headers: ["Bosqich", "Daqiqa", "Faoliyat", "Natija"],
        rows: [
          ["Tashkiliy", "3", "Salom, maqsad", "Tayyor auditoriya"],
          ["Tekshiruv", "5", "So‘rov", "Tayanch bilim"],
          ["Motivatsiya", "5", "Muammo", "Qiziqish"],
          ["Asosiy", String(main), "Tushuntirish + mashq", "Yangi tushuncha"],
          ["Baholash", "5", "Mezonli baho", "Aks-sado"],
          ["Uyga vazifa", "2", "Topshiriq", "Mustaqil ish"],
        ],
      },
    ],
  };
}

function resumeDoc(meta: DocMeta, values: Record<string, unknown>): AcademicDoc {
  const name = String(values.fullName || meta.author || "F.I.Sh");
  const role = String(values.targetRole || "Mutaxassis");
  return {
    meta: { ...meta, topic: role, author: name },
    titlePage: false,
    toc: false,
    sections: [
      section("summary", "Qisqacha", [
        p(String(values.summary || `${role} lavozimiga nomzod. Natijaga yo‘naltirilgan, jamoada ishlay oladi.`)),
        p(
          [values.location, values.email, values.phone].filter(Boolean).join(" · ") ||
            `${meta.city}`,
        ),
      ]),
      section("exp", "Ish tajribasi", [
        p(String(values.experience || "Tajriba bandi to‘ldirilmagan — shu yerga lavozim, yil va natijalarni yozing.")),
      ]),
      section("edu", "Ta’lim", [
        p(String(values.education || meta.university || "Ta’lim muassasasi, yo‘nalish, yil.")),
      ]),
      section("skills", "Ko‘nikmalar", [
        p(String(values.skills || "Tahlil, muloqot, Microsoft Office, jamoaviy ish.")),
      ]),
    ],
  };
}

function translationDoc(meta: DocMeta, fileName: string, target: string): AcademicDoc {
  return {
    meta,
    titlePage: true,
    toc: false,
    sections: [
      section("info", "Tarjima pasporti", [
        p(`Manba fayl: ${fileName || "yuklangan hujjat"}`),
        p(`Maqsad til: ${target}`),
        p("Tarjima matni topilmadi. Matn yozing yoki DOCX/PDF/TXT fayl biriktiring — matn avval olinadi, keyin tarjima qilinadi."),
        ...extraNote(meta),
      ]),
    ],
  };
}

export function buildAcademicDoc(
  meta: DocMeta,
  values: Record<string, unknown> = {},
): AcademicDoc {
  switch (meta.toolId) {
    case "essay":
      return essayDoc(meta);
    case "article":
      return meta.kind === "imrad" ? imradDoc(meta, "Maqola") : academicChapters(meta, "Maqola");
    case "thesis":
      return meta.kind === "imrad" ? imradDoc(meta, "Tezis") : academicChapters(meta, "Tezis");
    case "coursework":
      return academicChapters(meta, "Kurs ishi");
    case "referat":
      return academicChapters(meta, "Referat");
    case "mustaqil-ish":
      return academicChapters(meta, "Mustaqil ish");
    case "glossary":
      return glossaryDoc(meta);
    case "keys":
      return keysDoc(meta);
    case "texnologik-xarita":
      return techMapDoc(meta);
    case "lesson-plan":
      return lessonDoc(meta);
    case "resume":
      return resumeDoc(meta, values);
    case "translation":
      return translationDoc(meta, String(values.fileName || ""), String(values.language || meta.language));
    default:
      return academicChapters(meta, meta.workLabel);
  }
}
