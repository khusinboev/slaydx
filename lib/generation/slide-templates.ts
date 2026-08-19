import type { SlideLayout } from "./slide-types";

export const SLIDE_TEMPLATE_IDS = [
  "auto",
  "lecture",
  "defense",
  "pitch",
  "process",
  "compare",
  "case",
  "timeline",
  "lesson",
  "report",
  "magazine",
  "bio",
  "debate",
  "workshop",
  "briefing",
  "story",
  "science",
  "faq",
  "gallery",
  "literature",
  "problem",
] as const;

export type SlideTemplateId = (typeof SLIDE_TEMPLATE_IDS)[number];

export type SlideVisual = "classic" | "hero-split" | "cards" | "timeline" | "magazine" | "dense";

export type SlideBeat = {
  layout: SlideLayout;
  role: string;
};

export type SlideTemplate = {
  id: SlideTemplateId;
  nameUz: string;
  blurb: string;
  visual: SlideVisual;
  beats: SlideBeat[];
};

export function isSlideTemplateId(v: string): v is SlideTemplateId {
  return (SLIDE_TEMPLATE_IDS as readonly string[]).includes(v);
}

export const SLIDE_TEMPLATES: SlideTemplate[] = [
  {
    id: "auto",
    nameUz: "Avtomatik",
    blurb: "Mavzuga qarab tuzilmani o‘zi tanlaydi",
    visual: "classic",
    beats: [],
  },
  {
    id: "lecture",
    nameUz: "Ma’ruza",
    blurb: "Reja → tushuncha → mexanizm → xulosa",
    visual: "classic",
    beats: [
      { layout: "title", role: "Mavzu va fan" },
      { layout: "agenda", role: "Dars/ma’ruza reja" },
      { layout: "section", role: "1. Tushuncha" },
      { layout: "bullets", role: "Ta’rif va ahamiyat" },
      { layout: "twoCol", role: "Tarkib / natija" },
      { layout: "section", role: "2. Mexanizm" },
      { layout: "process", role: "Ketma-ketlik" },
      { layout: "quote", role: "Asosiy g‘oya" },
      { layout: "bullets", role: "Amaliy xulosa" },
      { layout: "closing", role: "Savollar" },
    ],
  },
  {
    id: "defense",
    nameUz: "Himoya",
    blurb: "Savol → metod → natija → hissa",
    visual: "dense",
    beats: [
      { layout: "title", role: "Himoya mavzusi" },
      { layout: "agenda", role: "Himoya reja" },
      { layout: "section", role: "Tadqiqot savoli" },
      { layout: "bullets", role: "Nima ma’lum / bo‘shliq" },
      { layout: "process", role: "Metod" },
      { layout: "stats", role: "Asosiy topilma" },
      { layout: "twoCol", role: "Kuchli tomon / cheklov" },
      { layout: "bullets", role: "Ilmiy hissa" },
      { layout: "closing", role: "Muhokama" },
    ],
  },
  {
    id: "pitch",
    nameUz: "Pitch",
    blurb: "Muammo → yechim → raqam → so‘rov",
    visual: "hero-split",
    beats: [
      { layout: "title", role: "Mahsulot / g‘oya nomi" },
      { layout: "section", role: "Muammo" },
      { layout: "bullets", role: "Kim og‘riyapti" },
      { layout: "section", role: "Yechim" },
      { layout: "twoCol", role: "Qanday ishlaydi / nima beradi" },
      { layout: "stats", role: "Ishonch raqamlari" },
      { layout: "compare", role: "Oldin / keyin" },
      { layout: "closing", role: "Keyingi qadam" },
    ],
  },
  {
    id: "process",
    nameUz: "Jarayon",
    blurb: "Bosqichma-bosqich yo‘riqnoma",
    visual: "timeline",
    beats: [
      { layout: "title", role: "Nimani qilamiz" },
      { layout: "bullets", role: "Nima uchun shu tartib" },
      { layout: "process", role: "Umumiy oqim" },
      { layout: "section", role: "Har bir bosqich" },
      { layout: "twoCol", role: "Vosita / natija" },
      { layout: "process", role: "Tekshiruv qadamlari" },
      { layout: "bullets", role: "Xatolar" },
      { layout: "closing", role: "Eslab qoling" },
    ],
  },
  {
    id: "compare",
    nameUz: "Qiyos",
    blurb: "Ikki yondashuv, mezon, xulosa",
    visual: "cards",
    beats: [
      { layout: "title", role: "Nimani solishtiramiz" },
      { layout: "agenda", role: "Mezonlar" },
      { layout: "compare", role: "Asosiy qiyos" },
      { layout: "twoCol", role: "Afzallik / kamchilik" },
      { layout: "stats", role: "Qisqa farqlar" },
      { layout: "bullets", role: "Qachon qaysi biri" },
      { layout: "closing", role: "Tavsiya" },
    ],
  },
  {
    id: "case",
    nameUz: "Keys",
    blurb: "Vaziyat → harakat → natija",
    visual: "cards",
    beats: [
      { layout: "title", role: "Keys nomi" },
      { layout: "section", role: "Kontekst" },
      { layout: "bullets", role: "Vaziyat" },
      { layout: "section", role: "Harakat" },
      { layout: "process", role: "Qadamlar" },
      { layout: "stats", role: "Natija" },
      { layout: "quote", role: "Sabot" },
      { layout: "closing", role: "Sabotlar" },
    ],
  },
  {
    id: "timeline",
    nameUz: "Tarix",
    blurb: "Davrlar, voqealar, shaxslar",
    visual: "timeline",
    beats: [
      { layout: "title", role: "Mavzu va davr" },
      { layout: "process", role: "Asosiy bosqichlar" },
      { layout: "section", role: "Erta davr" },
      { layout: "bullets", role: "Voqealar" },
      { layout: "section", role: "Keyingi davr" },
      { layout: "twoCol", role: "Shaxs / asar" },
      { layout: "quote", role: "Iqtibos" },
      { layout: "closing", role: "Meros" },
    ],
  },
  {
    id: "lesson",
    nameUz: "Dars",
    blurb: "Maqsad, tushuntirish, mashq, vazifa",
    visual: "cards",
    beats: [
      { layout: "title", role: "Dars mavzusi" },
      { layout: "bullets", role: "Maqsadlar" },
      { layout: "section", role: "Yangi bilim" },
      { layout: "process", role: "Dars oqimi" },
      { layout: "twoCol", role: "Misol / mashq" },
      { layout: "stats", role: "Eslab qolish" },
      { layout: "closing", role: "Uyga vazifa" },
    ],
  },
  {
    id: "report",
    nameUz: "Hisobot",
    blurb: "Xulosa, raqam, tavsiya",
    visual: "dense",
    beats: [
      { layout: "title", role: "Hisobot sarlavhasi" },
      { layout: "stats", role: "Qisqa ko‘rsatkichlar" },
      { layout: "section", role: "Topilmalar" },
      { layout: "bullets", role: "Asosiy xulosalar" },
      { layout: "twoCol", role: "Ijobiy / xavf" },
      { layout: "process", role: "Tavsiya qadamlari" },
      { layout: "closing", role: "Keyingi choralar" },
    ],
  },
  {
    id: "magazine",
    nameUz: "Jurnal",
    blurb: "Katta sarlavha, iqtibos, bo‘lim kartalari",
    visual: "magazine",
    beats: [
      { layout: "title", role: "Muqova sarlavha" },
      { layout: "quote", role: "Ochilish iqtibosi" },
      { layout: "section", role: "1-qism" },
      { layout: "twoCol", role: "Ikki nuqtai nazar" },
      { layout: "section", role: "2-qism" },
      { layout: "bullets", role: "Qisqa bandlar" },
      { layout: "quote", role: "Yakuniy ohang" },
      { layout: "closing", role: "Oxirgi so‘z" },
    ],
  },
  {
    id: "bio",
    nameUz: "Hayotnoma",
    blurb: "Shaxs: davr, asar, meros",
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
  },
  {
    id: "debate",
    nameUz: "Munozara",
    blurb: "Tezis, e’tiroz, xulosa",
    visual: "cards",
    beats: [
      { layout: "title", role: "Munozara savoli" },
      { layout: "section", role: "Nima muhokama" },
      { layout: "compare", role: "Ha / yo‘q" },
      { layout: "twoCol", role: "Dalil / e’tiroz" },
      { layout: "bullets", role: "Zaif joylar" },
      { layout: "quote", role: "Hal qiluvchi nuqta" },
      { layout: "closing", role: "Pozitsiya" },
    ],
  },
  {
    id: "workshop",
    nameUz: "Trening",
    blurb: "Maqsad, mashq, qoida",
    visual: "cards",
    beats: [
      { layout: "title", role: "Trening mavzusi" },
      { layout: "bullets", role: "Nima o‘rganamiz" },
      { layout: "process", role: "Sessiya tartibi" },
      { layout: "section", role: "Asosiy usul" },
      { layout: "twoCol", role: "Mashq / xato" },
      { layout: "stats", role: "Vaqt va hajm" },
      { layout: "bullets", role: "Uyga qoida" },
      { layout: "closing", role: "Keyingi qadam" },
    ],
  },
  {
    id: "briefing",
    nameUz: "Brifing",
    blurb: "Qisqa: holat, raqam, chora",
    visual: "dense",
    beats: [
      { layout: "title", role: "Brifing sarlavhasi" },
      { layout: "stats", role: "Holat raqamlari" },
      { layout: "bullets", role: "Nima bo‘lyapti" },
      { layout: "twoCol", role: "Xavf / imkon" },
      { layout: "process", role: "Tavsiya" },
      { layout: "closing", role: "Qaror so‘rovi" },
    ],
  },
  {
    id: "story",
    nameUz: "Hikoya",
    blurb: "Qahramon, to‘siq, burilish",
    visual: "magazine",
    beats: [
      { layout: "title", role: "Hikoya nomi" },
      { layout: "section", role: "Dunyo" },
      { layout: "bullets", role: "Qahramon" },
      { layout: "process", role: "Voqea oqimi" },
      { layout: "section", role: "Burilish" },
      { layout: "quote", role: "Kalit lahza" },
      { layout: "closing", role: "Yakun" },
    ],
  },
  {
    id: "science",
    nameUz: "Tajriba",
    blurb: "Gipoteza, usul, kuzatuv",
    visual: "classic",
    beats: [
      { layout: "title", role: "Tajriba savoli" },
      { layout: "agenda", role: "Ish reja" },
      { layout: "section", role: "Gipoteza" },
      { layout: "process", role: "Usul" },
      { layout: "twoCol", role: "Kuzatuv / izoh" },
      { layout: "stats", role: "O‘lchov" },
      { layout: "bullets", role: "Xulosa" },
      { layout: "closing", role: "Keyingi sinov" },
    ],
  },
  {
    id: "faq",
    nameUz: "Savol-javob",
    blurb: "Tez-tez so‘raladigan savollar",
    visual: "classic",
    beats: [
      { layout: "title", role: "Mavzu savollari" },
      { layout: "agenda", role: "Savollar ro‘yxati" },
      { layout: "section", role: "1-savol" },
      { layout: "bullets", role: "Javob" },
      { layout: "section", role: "2-savol" },
      { layout: "twoCol", role: "Ha / yo‘q tushunmovchilik" },
      { layout: "quote", role: "Qisqa javob" },
      { layout: "closing", role: "Yana savol" },
    ],
  },
  {
    id: "gallery",
    nameUz: "Foto-insho",
    blurb: "Katta rasm, kam matn, ohang",
    visual: "magazine",
    beats: [
      { layout: "title", role: "Muqova" },
      { layout: "section", role: "1-lavha" },
      { layout: "quote", role: "Izoh" },
      { layout: "section", role: "2-lavha" },
      { layout: "bullets", role: "Nimani ko‘ramiz" },
      { layout: "section", role: "3-lavha" },
      { layout: "closing", role: "Yakuniy kadr" },
    ],
  },
  {
    id: "literature",
    nameUz: "Adabiyot",
    blurb: "Asar, obraz, g‘oya, uslub",
    visual: "magazine",
    beats: [
      { layout: "title", role: "Asar nomi" },
      { layout: "agenda", role: "Tahlil reja" },
      { layout: "section", role: "Kontekst" },
      { layout: "twoCol", role: "Obraz / g‘oya" },
      { layout: "quote", role: "Parça" },
      { layout: "bullets", role: "Uslub" },
      { layout: "section", role: "Ahamiyat" },
      { layout: "closing", role: "Yakun" },
    ],
  },
  {
    id: "problem",
    nameUz: "Muammo–yechim",
    blurb: "Tashxis, sabab, chora",
    visual: "hero-split",
    beats: [
      { layout: "title", role: "Muammo nomi" },
      { layout: "section", role: "Nima yomon" },
      { layout: "bullets", role: "Kimga ta’sir" },
      { layout: "process", role: "Sabab zanjiri" },
      { layout: "twoCol", role: "Yechim / to‘siq" },
      { layout: "stats", role: "Kutilgan siljish" },
      { layout: "closing", role: "Birinchi qadam" },
    ],
  },
];

export const SLIDE_TEMPLATE_BY_ID = Object.fromEntries(SLIDE_TEMPLATES.map((t) => [t.id, t])) as Record<
  SlideTemplateId,
  SlideTemplate
>;

export function inferSlideTemplate(topic: string, extra = ""): Exclude<SlideTemplateId, "auto"> {
  const t = `${topic} ${extra}`.toLowerCase();
  if (/pitch|startup|invest|biznes[- ]reja|sotuv|mahsulot lans/.test(t)) return "pitch";
  if (/himoya|dissertats|diplom himoya|tadqiqot savol/.test(t)) return "defense";
  if (/munozara|debat|bahs|tezisga qarshi/.test(t)) return "debate";
  if (/qiyos|solishtir|\bvs\b|farqi|ikkita yondashuv/.test(t)) return "compare";
  if (/keys|vaziyat|case study|holat tahlil/.test(t)) return "case";
  if (/muammo|yechim|krizis|oldini olish/.test(t)) return "problem";
  if (/hayoti va ijodi|tarjimai hol|biograf|shaxsiyat/.test(t)) return "bio";
  if (/asar tahlil|adabiy|she’r|roman |doston|navoiy|bobur/.test(t)) return "literature";
  if (/tarix|davri|xronolog|bosqichlari tarix/.test(t)) return "timeline";
  if (/tajriba|gipoteza|laborator|eksperiment|kuzatuv/.test(t)) return "science";
  if (/trening|seminar|workshop|amaliy mashg/.test(t)) return "workshop";
  if (/dars|sinf|o‘quvchi|o'quvchi|mashg‘ulot mavzu/.test(t)) return "lesson";
  if (/brifing|qisqa hisobot|raqamlar/.test(t)) return "briefing";
  if (/hisobot|monitoring|ko‘rsatkich|kpi|natijalar tahlil/.test(t)) return "report";
  if (/faq|savol[- ]javob|tez-tez so‘ral/.test(t)) return "faq";
  if (/foto[- ]insho|lavha|galereya|vizual esse/.test(t)) return "gallery";
  if (/hikoya|qissa|syujet|qahramon/.test(t)) return "story";
  if (/qanday qilish|bosqichma|yo‘riqnoma|algoritm tartib|jarayon/.test(t)) return "process";
  if (/jurnal|esse|qarash|falsafa/.test(t)) return "magazine";
  return "lecture";
}

export function resolveSlideTemplate(id: string | undefined, topic: string, extra = ""): SlideTemplate {
  const raw = id && isSlideTemplateId(id) ? id : "auto";
  const chosen = raw === "auto" ? inferSlideTemplate(topic, extra) : raw;
  return SLIDE_TEMPLATE_BY_ID[chosen];
}
