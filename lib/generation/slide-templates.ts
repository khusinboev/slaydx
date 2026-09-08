import type { SlideLayout } from "./slide-types";

/**
 * Shablonlar ro'yxati.
 *
 * Ilgari bu yerda 21 ta shablon turardi va foydalanuvchi «har xilini
 * tanlasam ham bir xil deck chiqadi» deb aytgan edi. O'lchov uni
 * tasdiqladi (`docs/AUDIT-7.md`), uch sabab bilan:
 *
 *   1. Shablonlar beats darajasida bir-birining nusxasi edi —
 *      `lesson` va `problem` layout XALTASI bo'yicha 1.00, ketma-ketlik
 *      bo'yicha 0.86 mos kelardi; `faq` va `literature` ham 1.00.
 *   2. `FILLER_BEATS` HAMMA shablon uchun bitta generik ro'yxat edi.
 *      «Premium uzun» (16 slayd) dekaning 50–63% i aynan shu bir xil
 *      to'ldirgichdan iborat bo'lardi — ya'ni qimmatroq paket
 *      shablonlarni bir-biriga YAQINLASHTIRARDI.
 *   3. `visual` maydonining `cards` qiymati kodda umuman ishlatilmasdi:
 *      5 ta shablon (`compare`, `case`, `lesson`, `debate`, `workshop`)
 *      `classic` bilan piksel-bapiksel bir xil chiqardi.
 *
 * Endi: 14 ta shablon (+`auto`), har birida O'ZINING to'ldirgichlari va
 * haqiqatan farq qiladigan `visual`. Olib tashlanganlari
 * `LEGACY_TEMPLATE_ALIASES` orqali eng yaqin qolganiga yo'naltiriladi —
 * bazadagi eski `doc_json` lar (`slideTemplate`) buzilmasligi uchun.
 */
export const SLIDE_TEMPLATE_IDS = [
  "auto",
  // dars
  "lecture",
  "lesson",
  "science",
  // ilmiy
  "defense",
  "literature",
  "bio",
  // tahlil
  "compare",
  "problem",
  "report",
  "pitch",
  // bayon
  "process",
  "timeline",
  "case",
  "magazine",
] as const;

export type SlideTemplateId = (typeof SLIDE_TEMPLATE_IDS)[number];

/**
 * Olib tashlangan shablonlar → eng yaqin qolgani.
 *
 * Bu jadval faqat MOSLIK uchun: eski generatsiyalarning `doc_json` ida
 * saqlangan `slideTemplate` ko'ruvchida ham, qayta renderda ham
 * ma'noli qolsin. Formada bu id lar ko'rinmaydi.
 */
export const LEGACY_TEMPLATE_ALIASES: Record<string, SlideTemplateId> = {
  faq: "lecture",       // savol-javob: agenda + bo'lim + band — ma'ruzaning o'zi
  workshop: "lesson",   // trening: maqsad → mashq → qoida — dars oqimi
  debate: "compare",    // munozara: ikki tomon + pozitsiya — qiyosning o'zi
  briefing: "report",   // brifing: hisobotning qisqartirilgan ko'rinishi
  story: "case",        // hikoya: vaziyat → burilish → yakun — keysning o'zi
  gallery: "magazine",  // foto-insho: katta rasm + kam matn — jurnal maketi
};

/**
 * `visual` — sahna maketi. Har bir qiymatning `slide-layout.ts` da
 * HAQIQIY tarmog'i bor (`cards` ilgari yo'q edi, endi bor):
 *
 *   classic     bazaviy: sarlavha + band ro'yxati
 *   cards       bandlar alohida kartalarda (ro'yxat emas)
 *   lab         bandlar laboratoriya daftarining raqamlangan kuzatuv
 *               qatorlarida: chap chekkada o'lchov chizig'i (`planLabRows`)
 *   dense       stats to'q fonda, jadval zich
 *   timeline    process gorizontal chiziqda
 *   magazine    title VA section to'la ekran rasm + pastki matn tasmasi
 *   hero-split  title chap yarmi rasm
 *
 * Yangi qiymat qo'shsangiz — `slide-layout.ts` da unga HAQIQIY tarmoq
 * yozing. Yuqoridagi ro'yxat va'da, `tests/generation.test.mts` dagi
 * «har bir visual qiymati renderda haqiqiy farq beradi» esa uni tekshiradi.
 */
export type SlideVisual = "classic" | "hero-split" | "cards" | "lab" | "timeline" | "magazine" | "dense";

/** Formadagi yig'iluvchi guruhlar. */
export const SLIDE_TEMPLATE_GROUPS = [
  { id: "dars", label: "Dars va ma'ruza" },
  { id: "ilmiy", label: "Ilmiy ish" },
  { id: "tahlil", label: "Tahlil va qaror" },
  { id: "bayon", label: "Bayon va jarayon" },
] as const;

export type SlideTemplateGroup = (typeof SLIDE_TEMPLATE_GROUPS)[number]["id"];

/*
 * Auditoriya `lib/generation/slide-audience.ts` ga ko'chdi (AUDIT-9): 4 ta
 * o'rniga 14 ta, eski id lar alias bilan. Bu yerdan RE-EXPORT — pastki
 * importlar (`slide-layout.ts`, testlar) buzilmasin.
 */
export {
  AUDIENCE_RULES,
  LEGACY_AUDIENCE_ALIASES,
  SLIDE_AUDIENCES,
  audienceRules,
  bodyRules,
  isSlideAudience,
  normalizeAudienceId,
  type AudienceRule,
  type BodyRules,
  type SlideAudience,
} from "./slide-audience";

export type SlideBeat = {
  layout: SlideLayout;
  role: string;
  /** «Diagramma» bloki: `stats` majburiy chart rejimida (`blocksToBeats` qo'yadi, `SlideModel.chart` ga o'tadi). */
  chart?: boolean;
};

export type SlideTemplate = {
  id: SlideTemplateId;
  nameUz: string;
  blurb: string;
  group: SlideTemplateGroup;
  visual: SlideVisual;
  beats: SlideBeat[];
  /**
   * Paket beats'dan uzun bo'lganda qo'shiladigan slaydlar — HAR SHABLON
   * UCHUN O'ZINIKI. Ilgari bitta umumiy `FILLER_BEATS` ishlatilardi va
   * 16 slaydli dekaning yarmidan ko'pi hamma shablonda bir xil chiqardi.
   * `role` matni to'g'ridan-to'g'ri LLM promptiga tushadi, shuning uchun
   * bu yerdagi so'zlar KONTENTNI ham farqlantiradi, faqat maketni emas.
   */
  fillers: SlideBeat[];
};

export function isSlideTemplateId(v: string): v is SlideTemplateId {
  return (SLIDE_TEMPLATE_IDS as readonly string[]).includes(v);
}

/** Forma yoki eski `doc_json` dan kelgan id ni amaldagi id ga keltiradi. */
export function normalizeTemplateId(v: string | undefined): SlideTemplateId {
  if (!v) return "auto";
  if (isSlideTemplateId(v)) return v;
  return LEGACY_TEMPLATE_ALIASES[v] ?? "auto";
}

export const SLIDE_TEMPLATES: SlideTemplate[] = [
  {
    id: "auto",
    nameUz: "Avtomatik",
    blurb: "Mavzuga qarab tuzilmani o‘zi tanlaydi",
    group: "dars",
    visual: "classic",
    beats: [],
    fillers: [],
  },

  // ───────────────────────────────────────────────────── dars va ma'ruza
  {
    id: "lecture",
    nameUz: "Ma’ruza",
    blurb: "Reja → tushuncha → mexanizm → xulosa",
    group: "dars",
    visual: "classic",
    beats: [
      { layout: "title", role: "Mavzu va fan" },
      { layout: "agenda", role: "Ma’ruza reja" },
      { layout: "section", role: "1. Tushuncha" },
      { layout: "bullets", role: "Ta’rif va ahamiyat" },
      { layout: "twoCol", role: "Tarkib / natija" },
      { layout: "section", role: "2. Mexanizm" },
      { layout: "process", role: "Ketma-ketlik" },
      { layout: "quote", role: "Asosiy g‘oya" },
      { layout: "bullets", role: "Amaliy xulosa" },
      { layout: "closing", role: "Savollar" },
    ],
    fillers: [
      { layout: "table", role: "Turlari va farqlari jadvali" },
      { layout: "bullets", role: "Ko‘p uchraydigan xato va uni tuzatish" },
      { layout: "twoCol", role: "Nazariy ta’rif / hayotdagi ko‘rinishi" },
      { layout: "section", role: "Keyingi tushuncha" },
      { layout: "process", role: "Tushunchani qadamma-qadam qo‘llash" },
      { layout: "bullets", role: "Imtihonda so‘raladigan asosiy nuqtalar" },
      { layout: "stats", role: "Yodda qoladigan miqdoriy fakt" },
      { layout: "quote", role: "Fan asoschisining ta’rifi" },
    ],
  },
  {
    id: "lesson",
    nameUz: "Dars / trening",
    blurb: "Maqsad, mashq, mustahkamlash, vazifa",
    group: "dars",
    visual: "cards",
    beats: [
      { layout: "title", role: "Dars mavzusi" },
      { layout: "bullets", role: "Maqsad — o‘quvchi nimani bilib oladi" },
      { layout: "section", role: "Yangi bilim" },
      { layout: "process", role: "Dars oqimi" },
      { layout: "twoCol", role: "Misol / mashq" },
      { layout: "stats", role: "Eslab qolinadigan asosiy son" },
      { layout: "bullets", role: "Uyga vazifa" },
      { layout: "closing", role: "Yakun va baholash" },
    ],
    fillers: [
      { layout: "twoCol", role: "To‘g‘ri javob / tipik xato" },
      { layout: "bullets", role: "Sinfda 2 daqiqada bajariladigan mashq" },
      { layout: "process", role: "Guruh ishi tartibi" },
      { layout: "section", role: "Mustahkamlash" },
      { layout: "bullets", role: "Baholash mezoni" },
      { layout: "table", role: "Dars bosqichlari va vaqti" },
      { layout: "twoCol", role: "Kuchli o‘quvchi / qiynalayotgan o‘quvchi uchun" },
      { layout: "quote", role: "Darsning kalit jumlasi" },
    ],
  },
  {
    id: "science",
    nameUz: "Tajriba",
    blurb: "Gipoteza, usul, kuzatuv, xulosa",
    group: "dars",
    // AUDIT-7 O-3: ilgari `classic` edi — ya'ni `lecture` bilan aynan bir
    // xil chizilardi. `lab` tajriba daftari maketini beradi.
    visual: "lab",
    beats: [
      { layout: "title", role: "Tajriba savoli" },
      { layout: "agenda", role: "Ish reja" },
      { layout: "section", role: "Gipoteza" },
      { layout: "process", role: "Usul va jihozlar" },
      { layout: "table", role: "Kuzatuv natijalari" },
      { layout: "twoCol", role: "Kutilgan / olingan" },
      { layout: "stats", role: "O‘lchov" },
      { layout: "bullets", role: "Xulosa" },
      { layout: "closing", role: "Keyingi sinov" },
    ],
    fillers: [
      { layout: "bullets", role: "Xavfsizlik qoidalari" },
      { layout: "twoCol", role: "Nazorat guruhi / tajriba guruhi" },
      { layout: "process", role: "Takrorlash tartibi" },
      { layout: "bullets", role: "Natijaga ta’sir qiluvchi omillar" },
      { layout: "table", role: "Xatolik manbalari" },
      { layout: "section", role: "Qo‘shimcha kuzatuv" },
      { layout: "stats", role: "O‘lchov aniqligi" },
      { layout: "quote", role: "Xulosaning bir jumlali ifodasi" },
    ],
  },

  // ────────────────────────────────────────────────────────────── ilmiy
  {
    id: "defense",
    nameUz: "Himoya",
    blurb: "Savol → metod → natija → hissa",
    group: "ilmiy",
    visual: "dense",
    beats: [
      { layout: "title", role: "Himoya mavzusi" },
      { layout: "agenda", role: "Himoya reja" },
      { layout: "section", role: "Tadqiqot savoli" },
      { layout: "bullets", role: "Nima ma’lum / bo‘shliq" },
      { layout: "process", role: "Metod" },
      { layout: "stats", role: "Asosiy topilma" },
      { layout: "table", role: "Topilmalar jadvali" },
      { layout: "twoCol", role: "Kuchli tomon / cheklov" },
      { layout: "bullets", role: "Ilmiy hissa" },
      { layout: "closing", role: "Muhokama" },
    ],
    fillers: [
      { layout: "twoCol", role: "Gipoteza / tasdiq" },
      { layout: "table", role: "Tanlanma va o‘lchov mezonlari" },
      { layout: "bullets", role: "Adabiyotlar tahlilidagi bo‘shliq" },
      { layout: "stats", role: "Statistik ahamiyatlilik" },
      { layout: "process", role: "Tadqiqot bosqichlari" },
      { layout: "bullets", role: "Amaliyotga joriy etish natijasi" },
      { layout: "section", role: "Qo‘shimcha natija" },
      { layout: "twoCol", role: "Komissiya savoli / javob" },
    ],
  },
  {
    id: "literature",
    nameUz: "Adabiyot",
    blurb: "Asar, obraz, g‘oya, uslub",
    group: "ilmiy",
    visual: "magazine",
    beats: [
      { layout: "title", role: "Asar nomi va muallifi" },
      { layout: "agenda", role: "Tahlil reja" },
      { layout: "section", role: "Yozilgan davr va muhit" },
      { layout: "twoCol", role: "Obraz / g‘oya" },
      { layout: "quote", role: "Asardan parcha" },
      { layout: "bullets", role: "Badiiy uslub" },
      { layout: "section", role: "Ahamiyati" },
      { layout: "closing", role: "Yakun" },
    ],
    fillers: [
      { layout: "twoCol", role: "Bosh qahramon / unga qarshi kuch" },
      { layout: "quote", role: "Yana bir kalit parcha" },
      { layout: "bullets", role: "Asardagi ramzlar va ularning ma’nosi" },
      { layout: "process", role: "Syujet chizig‘i" },
      { layout: "section", role: "Syujet burilishi" },
      { layout: "twoCol", role: "Muallif nuqtai nazari / o‘quvchi qabuli" },
      { layout: "bullets", role: "Adabiyotshunoslar bahosi" },
      { layout: "quote", role: "Asar haqidagi mashhur fikr" },
    ],
  },
  {
    id: "bio",
    nameUz: "Hayotnoma",
    blurb: "Shaxs: davr, asar, meros",
    group: "ilmiy",
    visual: "magazine",
    beats: [
      { layout: "title", role: "Shaxs va davr" },
      { layout: "agenda", role: "Hayot chizig‘i" },
      { layout: "section", role: "Yoshlik va muhit" },
      { layout: "process", role: "Asosiy bosqichlar" },
      { layout: "twoCol", role: "Asar / g‘oya" },
      { layout: "quote", role: "O‘z so‘zi" },
      { layout: "bullets", role: "Meros" },
      { layout: "closing", role: "Yodda qolsin" },
    ],
    fillers: [
      { layout: "twoCol", role: "Yutuq / to‘siq" },
      { layout: "bullets", role: "Ustozlari va zamondoshlari" },
      { layout: "section", role: "Hayotidagi burilish nuqtasi" },
      { layout: "table", role: "Asarlari va ularning mavzusi" },
      { layout: "quote", role: "Zamondoshining bahosi" },
      { layout: "process", role: "Ijodiy kamolot bosqichlari" },
      { layout: "twoCol", role: "O‘z davrida / bugun" },
      { layout: "stats", role: "Hayotidagi muhim sanalar" },
    ],
  },

  // ───────────────────────────────────────────────────── tahlil va qaror
  {
    id: "compare",
    nameUz: "Qiyos / munozara",
    blurb: "Ikki yondashuv, mezon, pozitsiya",
    group: "tahlil",
    visual: "cards",
    beats: [
      { layout: "title", role: "Nimani solishtiramiz" },
      { layout: "agenda", role: "Qiyos mezonlari" },
      { layout: "compare", role: "Asosiy qarama-qarshilik" },
      { layout: "twoCol", role: "Afzallik / kamchilik" },
      { layout: "table", role: "Mezonlar bo‘yicha jadval" },
      { layout: "stats", role: "Raqamli farq" },
      { layout: "bullets", role: "Qachon qaysi biri" },
      { layout: "closing", role: "Tavsiya va pozitsiya" },
    ],
    fillers: [
      { layout: "compare", role: "Yana bir mezon bo‘yicha qiyos" },
      { layout: "bullets", role: "Umumiy jihatlari" },
      { layout: "twoCol", role: "Tarafdor dalili / e’tiroz" },
      { layout: "section", role: "Qo‘shimcha mezon" },
      { layout: "table", role: "Xarajat va natija qiyosi" },
      { layout: "quote", role: "Bahsdagi hal qiluvchi jumla" },
      { layout: "bullets", role: "Keng tarqalgan noto‘g‘ri tushuncha" },
      { layout: "stats", role: "Nisbat va ulush" },
    ],
  },
  {
    id: "problem",
    nameUz: "Muammo–yechim",
    blurb: "Tashxis, sabab, chora",
    group: "tahlil",
    visual: "hero-split",
    beats: [
      { layout: "title", role: "Muammo nomi" },
      { layout: "section", role: "Nima yomon ketyapti" },
      { layout: "bullets", role: "Kimga ta’sir qiladi" },
      { layout: "process", role: "Sabab zanjiri" },
      { layout: "compare", role: "Hozirgi holat / kerakli holat" },
      { layout: "twoCol", role: "Yechim / to‘siq" },
      { layout: "stats", role: "Kutilgan siljish" },
      { layout: "closing", role: "Birinchi qadam" },
    ],
    fillers: [
      { layout: "bullets", role: "Muammoning ko‘rinadigan belgilari" },
      { layout: "twoCol", role: "Tez chora / uzoq muddatli yechim" },
      { layout: "process", role: "Joriy etish rejasi" },
      { layout: "table", role: "Mas’ullar va muddatlar" },
      { layout: "bullets", role: "Yechim ishlamasligi mumkin bo‘lgan holat" },
      { layout: "section", role: "Chuqurroq sabab" },
      { layout: "stats", role: "Xarajat va tejamkorlik" },
      { layout: "quote", role: "Muammoni bir jumlada ifodalash" },
    ],
  },
  {
    id: "report",
    nameUz: "Hisobot",
    blurb: "Xulosa, raqam, tavsiya",
    group: "tahlil",
    visual: "dense",
    beats: [
      { layout: "title", role: "Hisobot sarlavhasi va davri" },
      { layout: "stats", role: "Qisqa ko‘rsatkichlar" },
      { layout: "section", role: "Topilmalar" },
      { layout: "bullets", role: "Asosiy xulosalar" },
      { layout: "table", role: "Ko‘rsatkichlar jadvali" },
      { layout: "twoCol", role: "Ijobiy / xavf" },
      { layout: "process", role: "Tavsiya qadamlari" },
      { layout: "closing", role: "Keyingi choralar" },
    ],
    fillers: [
      { layout: "stats", role: "Davr bo‘yicha o‘zgarish" },
      { layout: "bullets", role: "Rejadan chetlanish sabablari" },
      { layout: "table", role: "Bo‘limlar kesimida natija" },
      { layout: "twoCol", role: "Reja / fakt" },
      { layout: "section", role: "Qo‘shimcha ko‘rsatkich" },
      { layout: "bullets", role: "Qaror talab qiladigan masalalar" },
      { layout: "process", role: "Nazorat jadvali" },
      { layout: "stats", role: "Resurs sarfi" },
    ],
  },
  {
    id: "pitch",
    nameUz: "Pitch",
    blurb: "Muammo → yechim → raqam → so‘rov",
    group: "tahlil",
    visual: "hero-split",
    beats: [
      { layout: "title", role: "Mahsulot / g‘oya nomi" },
      { layout: "section", role: "Muammo" },
      { layout: "bullets", role: "Kim og‘riyapti" },
      { layout: "section", role: "Yechim" },
      { layout: "twoCol", role: "Qanday ishlaydi / nima beradi" },
      { layout: "stats", role: "Ishonch raqamlari" },
      { layout: "compare", role: "Oldin / keyin" },
      { layout: "closing", role: "Keyingi qadam va so‘rov" },
    ],
    fillers: [
      { layout: "bullets", role: "Bozor va mijoz segmenti" },
      { layout: "twoCol", role: "Biz / raqobatchi" },
      { layout: "stats", role: "Biznes model va birlik iqtisodi" },
      { layout: "process", role: "Yo‘l xaritasi" },
      { layout: "bullets", role: "Jamoa va tajriba" },
      { layout: "table", role: "Xarajat va daromad rejasi" },
      { layout: "section", role: "Nega aynan hozir" },
      { layout: "quote", role: "Mijoz fikri" },
    ],
  },

  // ──────────────────────────────────────────────────── bayon va jarayon
  {
    id: "process",
    nameUz: "Yo‘riqnoma",
    blurb: "Bosqichma-bosqich qanday qilinadi",
    group: "bayon",
    visual: "timeline",
    beats: [
      { layout: "title", role: "Nimani qilamiz" },
      { layout: "bullets", role: "Nima uchun aynan shu tartib" },
      { layout: "process", role: "Umumiy oqim" },
      { layout: "section", role: "Har bir bosqich batafsil" },
      { layout: "twoCol", role: "Vosita / natija" },
      { layout: "process", role: "Tekshiruv qadamlari" },
      { layout: "bullets", role: "Tipik xatolar" },
      { layout: "closing", role: "Eslab qoling" },
    ],
    fillers: [
      { layout: "table", role: "Bosqich, vaqt, mas’ul" },
      { layout: "bullets", role: "Tayyorgarlik va kerakli narsalar" },
      { layout: "process", role: "Muqobil yo‘l" },
      { layout: "twoCol", role: "To‘g‘ri bajarish / xato bajarish" },
      { layout: "section", role: "Murakkabroq holat" },
      { layout: "bullets", role: "Xavfsizlik va ehtiyot choralari" },
      { layout: "stats", role: "Har bosqichga ketadigan vaqt" },
      { layout: "quote", role: "Amaliyotchi maslahati" },
    ],
  },
  {
    id: "timeline",
    nameUz: "Tarix",
    blurb: "Davrlar, voqealar, shaxslar",
    group: "bayon",
    visual: "timeline",
    beats: [
      { layout: "title", role: "Mavzu va davr" },
      { layout: "process", role: "Asosiy bosqichlar" },
      { layout: "section", role: "Erta davr" },
      { layout: "bullets", role: "Voqealar va sabablari" },
      { layout: "section", role: "Keyingi davr" },
      { layout: "twoCol", role: "Shaxs / asar" },
      { layout: "quote", role: "Manbadan iqtibos" },
      { layout: "closing", role: "Meros" },
    ],
    fillers: [
      { layout: "table", role: "Sana va voqea jadvali" },
      { layout: "bullets", role: "Davrning ijtimoiy sharoiti" },
      { layout: "twoCol", role: "Sabab / oqibat" },
      { layout: "section", role: "Uchinchi davr" },
      { layout: "process", role: "O‘zgarishlar zanjiri" },
      { layout: "bullets", role: "Tarixiy manbalar" },
      { layout: "quote", role: "Zamondosh guvohligi" },
      { layout: "stats", role: "Davr raqamlarda: hajm, muddat, miqdor" },
    ],
  },
  {
    id: "case",
    nameUz: "Keys / hikoya",
    blurb: "Vaziyat → burilish → natija → saboq",
    group: "bayon",
    visual: "cards",
    beats: [
      { layout: "title", role: "Keys nomi" },
      { layout: "section", role: "Kontekst va qahramon" },
      { layout: "bullets", role: "Boshlang‘ich vaziyat" },
      { layout: "section", role: "To‘siq va burilish" },
      { layout: "process", role: "Qilingan harakatlar" },
      { layout: "stats", role: "Natija" },
      { layout: "quote", role: "Kalit lahza" },
      { layout: "closing", role: "Saboqlar" },
    ],
    fillers: [
      { layout: "twoCol", role: "Tanlangan yo‘l / rad etilgan yo‘l" },
      { layout: "bullets", role: "Qaror qabul qilish sharoiti" },
      { layout: "section", role: "Kutilmagan burilish" },
      { layout: "table", role: "Vaqt va natija" },
      { layout: "bullets", role: "Ishtirokchilar va rollari" },
      { layout: "process", role: "Voqealar ketma-ketligi" },
      { layout: "twoCol", role: "Nima ishladi / nima ishlamadi" },
      { layout: "quote", role: "Ishtirokchi so‘zi" },
    ],
  },
  {
    id: "magazine",
    nameUz: "Esse / foto-insho",
    blurb: "Katta rasm, iqtibos, lavhalar",
    group: "bayon",
    visual: "magazine",
    beats: [
      { layout: "title", role: "Muqova sarlavha" },
      { layout: "quote", role: "Ochilish iqtibosi" },
      { layout: "section", role: "1-lavha" },
      { layout: "twoCol", role: "Ikki nuqtai nazar" },
      { layout: "section", role: "2-lavha" },
      { layout: "bullets", role: "Qisqa mulohazalar" },
      { layout: "quote", role: "Yakuniy ohang" },
      { layout: "closing", role: "Oxirgi so‘z" },
    ],
    fillers: [
      { layout: "section", role: "Yangi lavha" },
      { layout: "bullets", role: "Kuzatilgan tafsilotlar" },
      { layout: "quote", role: "Ochilgan fikr" },
      { layout: "twoCol", role: "Tashqi ko‘rinish / ichki mazmun" },
      { layout: "section", role: "Kontrast lavha" },
      { layout: "bullets", role: "Muallif mulohazasi" },
      { layout: "twoCol", role: "Ilgari / hozir" },
      { layout: "quote", role: "Eslab qolinadigan jumla" },
    ],
  },
];

export const SLIDE_TEMPLATE_BY_ID = Object.fromEntries(SLIDE_TEMPLATES.map((t) => [t.id, t])) as Record<
  SlideTemplateId,
  SlideTemplate
>;

/**
 * Mavzudan shablon taxmin qiladi.
 *
 * Naqshlar ATAYLAB tor: ilgari `/jarayon/` «Fotosintez jarayoni» ni,
 * `/dars/` esa har qanday akademik mavzuni, `/muammo|yechim/` esa
 * «Fotosintez muammolari» ni noto'g'ri ushlab olardi. Shubha bo'lsa
 * `lecture` ga tushish xato shablondan yaxshiroq.
 *
 * Olib tashlangan shablonlarning naqshlari YO'QOLMADI — ular endi
 * o'rnini bosgan shablonga yo'naltiriladi (munozara → qiyos, trening →
 * dars, brifing → hisobot, foto-insho → esse, hikoya → keys).
 */
export function inferSlideTemplate(topic: string, extra = ""): Exclude<SlideTemplateId, "auto"> {
  const t = `${topic} ${extra}`.toLowerCase();
  if (/pitch|startup|invest|biznes[- ]reja|sotuv|mahsulot lans/.test(t)) return "pitch";
  if (/himoya|dissertats|diplom himoya|tadqiqot savol/.test(t)) return "defense";
  if (/munozara|debat|bahs|tezisga qarshi/.test(t)) return "compare";
  if (/qiyos|solishtir|\bvs\b|farqi|ikkita yondashuv/.test(t)) return "compare";
  if (/keys|vaziyat|case study|holat tahlil/.test(t)) return "case";
  if (/muammo va yechim|muammolar va yechim|krizis|oldini olish yo‘l/.test(t)) return "problem";
  if (/hayoti va ijodi|tarjimai hol|biograf|shaxsiyat/.test(t)) return "bio";
  if (/asar tahlil|adabiy|she’r|roman |doston|navoiy|bobur/.test(t)) return "literature";
  if (/tarix|davri|xronolog|bosqichlari tarix/.test(t)) return "timeline";
  if (/tajriba|gipoteza|laborator|eksperiment|kuzatuv/.test(t)) return "science";
  if (/trening|seminar|workshop|amaliy mashg/.test(t)) return "lesson";
  if (/dars ishlanma|dars rejasi|ochiq dars|sinf soati/.test(t)) return "lesson";
  if (/brifing|qisqa hisobot|raqamlar/.test(t)) return "report";
  if (/hisobot|monitoring|ko‘rsatkich|kpi|natijalar tahlil/.test(t)) return "report";
  if (/foto[- ]insho|lavha|galereya|vizual esse/.test(t)) return "magazine";
  if (/hikoya qil|qissa|syujet|bosh qahramon/.test(t)) return "case";
  if (/qanday qilish|bosqichma-bosqich|yo‘riqnoma|algoritm tartibi|jarayonning bosqichlari/.test(t)) return "process";
  if (/jurnal|esse|qarash|falsafa/.test(t)) return "magazine";
  return "lecture";
}

/**
 * Oxirgi chora to'ldirgichlari — shablonning o'z ro'yxati tugab, hamon
 * slayd yetishmasa. `expandBeats` ning takror-taqiqi tufayli bitta
 * ro'yxat aylantirilganda tiqilib qolish mumkin; bu ro'yxat layoutlarni
 * almashtirib turadi.
 */
const GENERIC_FILLERS: SlideBeat[] = [
  { layout: "bullets", role: "Mavzuga oid qo‘shimcha aniq misol" },
  { layout: "twoCol", role: "Sabab va oqibat" },
  { layout: "process", role: "Bosqichlar ketma-ketligi" },
  { layout: "stats", role: "Eslab qolinadigan ko‘rsatkich" },
  { layout: "quote", role: "Kalit jumla" },
  { layout: "section", role: "Keyingi bo‘lim" },
];

/**
 * Shablon beats'ini kerakli slaydlar soniga yetkazadi.
 * `closing` doim oxirida qoladi; yonma-yon bir xil layout takrorlanmaydi.
 *
 * To'ldirgichlar avval SHABLONNING o'z ro'yxatidan olinadi va faqat u
 * tugagach umumiy ro'yxatga o'tiladi. Shu sababli 16 slaydli «Tarix» va
 * 16 slaydli «Hisobot» endi bir xil quyruqqa ega emas.
 */
export function expandBeats(tpl: SlideTemplate, want: number): SlideBeat[] {
  const source = tpl.beats.length ? tpl : SLIDE_TEMPLATE_BY_ID.lecture;
  const beats = [...source.beats];
  if (want <= beats.length) return beats;
  const tail = beats[beats.length - 1]?.layout === "closing" ? beats.pop()! : null;
  const target = want - (tail ? 1 : 0);
  const pool = [...source.fillers, ...GENERIC_FILLERS];
  for (let i = 0, guard = 0; beats.length < target && guard < 256; i++, guard++) {
    const cand = pool[i % pool.length];
    if (beats[beats.length - 1]?.layout === cand.layout) continue;
    beats.push(cand);
  }
  if (tail) beats.push(tail);
  return beats;
}

export function resolveSlideTemplate(id: string | undefined, topic: string, extra = ""): SlideTemplate {
  const raw = normalizeTemplateId(id);
  const chosen = raw === "auto" ? inferSlideTemplate(topic, extra) : raw;
  return SLIDE_TEMPLATE_BY_ID[chosen];
}
