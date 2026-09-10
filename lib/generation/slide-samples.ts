import type { SlideModel } from "./slide-types";
import type { SlideTemplateId } from "./slide-templates";

/**
 * Galereya va ko'z bilan tekshiruv uchun NAMUNA dekalar (Shablonlar 2).
 *
 * Har shablon uchun 7 slayd: titul, reja, bo'lim, bandlar, ikki ustun,
 * raqamlar, bosqichlar, iqtibos, yakun — dizaynning barcha asosiy
 * maketlari ko'rinadi. Matn o'zbekcha va shablonning mavzusiga mos
 * («Ma'ruza» — fotosintez, «Pitch» — startap…), rasm — `public/samples/`
 * dagi bepul stock foto (Pexels, `CREDITS.md`). Tarmoqqa chiqilmaydi.
 *
 * `TemplateGallery` `SlideCanvas` bilan shu dekani chizadi;
 * `scripts/visual-shots.mts` esa PPTX → PDF → PNG qiladi — ikkalasi
 * BIR XIL manbadan («ko'rdim = oldim» galereyada ham).
 */
export const SAMPLE_IMAGE_PATH = "/samples";

export function sampleImage(id: SlideTemplateId): string {
  return `${SAMPLE_IMAGE_PATH}/tpl-${id === "auto" ? "lecture" : id}.jpg`;
}

type Content = {
  kicker: string;
  title: string;
  subtitle: string;
  agenda: string[];
  section: [string, string];
  bulletsTitle: string;
  bullets: string[];
  twoCol: { title: string; l: string; left: string[]; r: string; right: string[] };
  stats: { title: string; items: { value: string; label: string }[] };
  steps: { title: string; items: { title: string; text: string }[] };
  quote: { text: string; by: string };
  closing: [string, string];
};

const CONTENT: Record<Exclude<SlideTemplateId, "auto">, Content> = {
  lecture: {
    kicker: "Biologiya · 10-sinf",
    title: "Fotosintez jarayoni va uning bosqichlari",
    subtitle: "Yorug‘lik energiyasi qanday qilib kimyoviy energiyaga aylanadi",
    agenda: ["Fotosintez nima", "Yorug‘lik va qorong‘i fazalar", "Xlorofill va xloroplast", "Tabiat va inson uchun ahamiyati"],
    section: ["1. Tushuncha", "Fotosintez — o‘simlikning quyosh nuri bilan «ovqat pishirishi»"],
    bulletsTitle: "Fotosintezning asosiy shartlari",
    bullets: ["Quyosh nuri — energiya manbai", "Suv ildizdan, karbonat angidrid barg og‘izchalaridan", "Xlorofill — yashil pigment, nurni ushlaydi", "Natija: glyukoza va kislorod"],
    twoCol: { title: "Ikki faza", l: "Yorug‘lik fazasi", left: ["Tilakoid membranada", "Suv parchalanadi", "ATF va NADFH hosil bo‘ladi"], r: "Qorong‘i fazasi", right: ["Stromada", "CO₂ o‘zlashtiriladi", "Glyukoza sintezlanadi"] },
    stats: { title: "Raqamlarda", items: [{ value: "6", label: "CO₂ molekulasi bitta glyukoza uchun" }, { value: "30%", label: "atmosfera kislorodi okean suvo‘tlaridan" }, { value: "700 nm", label: "qizil nur — eng samarali to‘lqin" }] },
    steps: { title: "Jarayon ketma-ketligi", items: [{ title: "Nur yutilishi", text: "Xlorofill fotonni ushlaydi" }, { title: "Suv parchalanishi", text: "Kislorod ajraladi" }, { title: "ATF sintezi", text: "Energiya jamg‘ariladi" }, { title: "Kalvin sikli", text: "CO₂ → glyukoza" }] },
    quote: { text: "Har bir yashil barg — quyosh energiyasini hayotga aylantiruvchi kichik zavod.", by: "Yan Ingenhauz" },
    closing: ["Savollar va muhokama", "Fotosintezsiz sayyorada hayot bo‘lmas edi"],
  },
  lesson: {
    kicker: "Matematika · 5-sinf",
    title: "Kasrlar bilan tanishamiz",
    subtitle: "Butunni bo‘laklarga bo‘lish va ularni solishtirish",
    agenda: ["Kasr nima", "Surat va maxraj", "Kasrlarni solishtirish", "Mashq va uyga vazifa"],
    section: ["Yangi bilim", "Pitsani teng bo‘laklarga bo‘lsak — kasr paydo bo‘ladi"],
    bulletsTitle: "Dars maqsadi",
    bullets: ["Kasrning surat va maxrajini ajratish", "Bir xil maxrajli kasrlarni solishtirish", "Kundalik hayotdan kasrga misol topish"],
    twoCol: { title: "Misol / mashq", l: "Misol", left: ["3/4 — to‘rtdan uch bo‘lak", "Surat 3, maxraj 4"], r: "Mashq", right: ["Daftaringizga 5/8 ni chizing", "Qaysi katta: 2/5 yoki 4/5?"] },
    stats: { title: "Eslab qoling", items: [{ value: "1/2", label: "yarim" }, { value: "1/4", label: "chorak" }, { value: "3/4", label: "to‘rtdan uch" }] },
    steps: { title: "Dars oqimi", items: [{ title: "Qiziqtirish", text: "Pitsa misoli, 5 daqiqa" }, { title: "Tushuntirish", text: "Surat va maxraj" }, { title: "Mashq", text: "Juftlikda ishlash" }, { title: "Baholash", text: "3 ta tez savol" }] },
    quote: { text: "Matematika — fikrlashning gimnastikasi.", by: "Xalq maqoli" },
    closing: ["Uyga vazifa", "12-mashq, 3–5-topshiriqlar"],
  },
  science: {
    kicker: "Kimyo · laboratoriya",
    title: "Suvning elektrolizi: gaz hajmini o‘lchash",
    subtitle: "Gipoteza, usul, kuzatuv va xulosa",
    agenda: ["Gipoteza", "Jihozlar va xavfsizlik", "Kuzatuv", "Xulosa"],
    section: ["Gipoteza", "Vodorod hajmi kisloroddan ikki baravar ko‘p bo‘ladi"],
    bulletsTitle: "Kuzatuv natijalari",
    bullets: ["5 daqiqada katodda 12 ml gaz to‘plandi", "Anodda — 6 ml", "Nisbat 2:1 — gipoteza tasdiqlandi", "Xatolik: harorat va bosim hisobga olinmadi"],
    twoCol: { title: "Kutilgan / olingan", l: "Kutilgan", left: ["H₂ : O₂ = 2 : 1", "Rangsiz gazlar"], r: "Olingan", right: ["12 ml : 6 ml", "Katodda pufakchalar tezroq"] },
    stats: { title: "O‘lchov", items: [{ value: "12 ml", label: "vodorod" }, { value: "6 ml", label: "kislorod" }, { value: "9 V", label: "kuchlanish" }] },
    steps: { title: "Usul", items: [{ title: "Eritma", text: "Distillangan suv + NaOH" }, { title: "Elektrodlar", text: "Grafit, 9 V manba" }, { title: "O‘lchash", text: "Har daqiqada hajm" }] },
    quote: { text: "Tajriba — savolga tabiatning o‘zi bergan javob.", by: "Laboratoriya daftari" },
    closing: ["Keyingi sinov", "Elektrolit konsentratsiyasini o‘zgartirib takrorlash"],
  },
  defense: {
    kicker: "Magistrlik dissertatsiyasi",
    title: "Boshlang‘ich sinfda o‘qish ko‘nikmasini rivojlantirish metodikasi",
    subtitle: "Ilmiy rahbar: prof. N. Karimova · TDPU, 2026",
    agenda: ["Tadqiqot savoli va dolzarbligi", "Metodika", "Natijalar", "Ilmiy hissa va tavsiyalar"],
    section: ["Tadqiqot savoli", "Interfaol usullar o‘qish tezligi va tushunishga qanday ta’sir qiladi?"],
    bulletsTitle: "Nima ma’lum / bo‘shliq",
    bullets: ["Mavjud tadqiqotlar 5–7-sinflarga qaratilgan", "Boshlang‘ich sinf uchun o‘lchov mezoni yo‘q", "Mahalliy tajriba tizimlashtirilmagan"],
    twoCol: { title: "Kuchli tomon / cheklov", l: "Kuchli tomon", left: ["3 maktab, 240 o‘quvchi", "Nazorat guruhi bilan"], r: "Cheklov", right: ["Bitta o‘quv yili", "Faqat shahar maktablari"] },
    stats: { title: "Asosiy topilma", items: [{ value: "27%", label: "o‘qish tezligi o‘sdi" }, { value: "18%", label: "tushunish sifati" }, { value: "p < 0.05", label: "statistik ahamiyatli" }] },
    steps: { title: "Metod", items: [{ title: "Diagnostika", text: "Boshlang‘ich o‘lchov" }, { title: "Tajriba", text: "8 haftalik dastur" }, { title: "Nazorat", text: "Yakuniy o‘lchov" }, { title: "Tahlil", text: "t-test, SPSS" }] },
    quote: { text: "O‘qish — barcha bilimlarning darvozasi.", by: "Abdulla Avloniy" },
    closing: ["Muhokama", "Savollaringizga javob berishga tayyorman"],
  },
  story: {
    kicker: "Adabiyot · XV asr",
    title: "Alisher Navoiy: so‘z va davr",
    subtitle: "Shoir, davlat arbobi, turkiy adabiyot asoschisi",
    agenda: ["Davr va muhit", "Xamsa", "Obraz va g‘oya", "Meros"],
    section: ["Yozilgan davr va muhit", "Hirot — Temuriylar poytaxti, ilm va san’at markazi"],
    bulletsTitle: "Badiiy uslub va meros",
    bullets: ["Turkiy tilda «Xamsa» — birinchi to‘liq beshlik", "Insonparvarlik va adolat g‘oyasi", "30 dan ortiq asar, 5 devon"],
    twoCol: { title: "Obraz / g‘oya", l: "Farhod", left: ["Mehnat va sadoqat timsoli", "Tog‘ni yorib suv chiqaradi"], r: "G‘oya", right: ["Haqiqiy sevgi — fidoyilik", "Adolatli hukmdor orzusi"] },
    stats: { title: "Raqamlarda", items: [{ value: "1441", label: "tug‘ilgan yili" }, { value: "5", label: "doston «Xamsa»da" }, { value: "26", label: "ming misra «Xazoyin ul-maoniy»da" }] },
    steps: { title: "Hayot chizig‘i", items: [{ title: "Hirot", text: "Tug‘ilish va tahsil" }, { title: "Samarqand", text: "Ilm yillari" }, { title: "Vazirlik", text: "Husayn Boyqaro saroyi" }, { title: "Xamsa", text: "1483–1485" }] },
    quote: { text: "Odami ersang, demagil odami — onikim, yo‘q xalq g‘amidin g‘ami.", by: "Alisher Navoiy" },
    closing: ["Yodda qolsin", "So‘z — inson qadrining o‘lchovi"],
  },
  compare: {
    kicker: "Munozara",
    title: "Elektromobil yoki ichki yonuv dvigateli?",
    subtitle: "Narx, ekologiya, qulaylik — mezonlar bo‘yicha qiyos",
    agenda: ["Xarajat", "Ekologiya", "Infratuzilma", "Pozitsiya"],
    section: ["Qo‘shimcha mezon", "Umr davomidagi xarajat — 10 yillik hisob"],
    bulletsTitle: "Qachon qaysi biri",
    bullets: ["Shahar ichida kunlik 60 km — elektromobil", "Uzoq safar va tog‘ yo‘li — benzin", "Quyosh paneli bo‘lsa — elektr arzonroq"],
    twoCol: { title: "Afzallik / kamchilik", l: "Elektromobil", left: ["Arzon quvvat", "Sokin, tezkor", "Kam xizmat"], r: "Benzin", right: ["Tez quyish", "Arzon xarid", "Keng servis"] },
    stats: { title: "Raqamli farq", items: [{ value: "3×", label: "arzon 100 km" }, { value: "40%", label: "kam xizmat xarajati" }, { value: "45 daq", label: "tez quvvatlash" }] },
    steps: { title: "Tanlov qadamlari", items: [{ title: "Yo‘l", text: "Kunlik masofa" }, { title: "Quvvat", text: "Uyda rozetka bormi" }, { title: "Byudjet", text: "Xarid va 5 yil" }] },
    quote: { text: "To‘g‘ri tanlov mashinada emas, foydalanish tarzida.", by: "Avtomobil eksperti" },
    closing: ["Tavsiya va pozitsiya", "Shahar uchun elektr, viloyat uchun gibrid"],
  },
  pitch: {
    kicker: "Startap · EdTech",
    title: "DarsPlan — o‘qituvchi uchun 5 daqiqalik dars rejasi",
    subtitle: "Muammo → yechim → raqam → so‘rov",
    agenda: ["Muammo", "Yechim", "Bozor", "So‘rov"],
    section: ["Muammo", "O‘qituvchi haftasiga 6 soatni hujjat to‘ldirishga sarflaydi"],
    bulletsTitle: "Kim og‘riyapti",
    bullets: ["Boshlang‘ich sinf o‘qituvchilari — 120 ming kishi", "Har dars uchun 3 ta hujjat", "Shablon yo‘q, har safar noldan"],
    twoCol: { title: "Qanday ishlaydi / nima beradi", l: "Qanday ishlaydi", left: ["Mavzu kiritiladi", "AI reja tuzadi", "DOCX yuklab olinadi"], r: "Nima beradi", right: ["6 soat → 30 daqiqa", "Standartga mos", "Bir marta to‘lov"] },
    stats: { title: "Ishonch raqamlari", items: [{ value: "2 400", label: "faol o‘qituvchi" }, { value: "18 000", label: "yaratilgan reja" }, { value: "92%", label: "qayta foydalanadi" }] },
    steps: { title: "Yo‘l xaritasi", items: [{ title: "Q1", text: "Maktablar bilan pilot" }, { title: "Q2", text: "Viloyat boshqarmalari" }, { title: "Q3", text: "Mobil ilova" }] },
    quote: { text: "Endi dars rejasini emas, darsni o‘ylayman.", by: "Mijoz, 15-maktab" },
    closing: ["So‘rov", "200 ming dollar — 12 oylik o‘sish uchun"],
  },
  report: {
    kicker: "Choraklik hisobot · 2026 Q1",
    title: "Onlayn kurslar bo‘limi natijalari",
    subtitle: "Xulosa, ko‘rsatkichlar, tavsiyalar",
    agenda: ["Asosiy ko‘rsatkichlar", "Topilmalar", "Xavflar", "Tavsiyalar"],
    section: ["Topilmalar", "O‘sish mobil foydalanuvchilar hisobiga"],
    bulletsTitle: "Asosiy xulosalar",
    bullets: ["Faol foydalanuvchilar 34% ga o‘sdi", "Kursni tugatish ulushi 61% — reja 55%", "Qo‘llab-quvvatlash so‘rovlari 2 baravar kamaydi"],
    twoCol: { title: "Ijobiy / xavf", l: "Ijobiy", left: ["Mobil trafik +48%", "Takroriy xarid 27%"], r: "Xavf", right: ["Server xarajati +19%", "Bitta yirik mijozga bog‘liqlik"] },
    stats: { title: "Qisqa ko‘rsatkichlar", items: [{ value: "34%", label: "faol foydalanuvchi o‘sishi" }, { value: "61%", label: "tugatish ulushi" }, { value: "27%", label: "takroriy xarid" }] },
    steps: { title: "Tavsiya qadamlari", items: [{ title: "Aprel", text: "Server optimizatsiyasi" }, { title: "May", text: "Yangi 3 kurs" }, { title: "Iyun", text: "Korporativ paket" }] },
    quote: { text: "O‘lchanmagan narsa boshqarilmaydi.", by: "P. Druker" },
    closing: ["Keyingi choralar", "Q2 rejasi 15 aprelgacha tasdiqlanadi"],
  },
  timeline: {
    kicker: "Tarix · Markaziy Osiyo",
    title: "Temuriylar davri: 1370–1507",
    subtitle: "Davlat, ilm va san’atning yuksalishi",
    agenda: ["Amir Temur davri", "Ulug‘bek va ilm", "Hirot maktabi", "Meros"],
    section: ["Birinchi bosqich", "1370 — Samarqand poytaxt, davlat asoslari"],
    bulletsTitle: "Voqealar va sabablari",
    bullets: ["1370 — Amir Temur hokimiyatga keladi", "1420 — Ulug‘bek madrasasi, rasadxona", "1483 — Navoiy «Xamsa»ni yakunlaydi", "1507 — Shayboniylar Hirotni oladi"],
    twoCol: { title: "Sabab / oqibat", l: "Sabab", left: ["Savdo yo‘llari nazorati", "Ilm homiyligi"], r: "Oqibat", right: ["Me’morchilik gullab-yashnadi", "Astronomiya jadvallari"] },
    stats: { title: "Davr raqamlarda", items: [{ value: "137", label: "yil hukmronlik" }, { value: "1018", label: "yulduz Ulug‘bek jadvalida" }, { value: "3", label: "poytaxt: Samarqand, Hirot, Balx" }] },
    steps: { title: "Asosiy bosqichlar", items: [{ title: "1370", text: "Davlat asos" }, { title: "1405", text: "Temur vafoti" }, { title: "1449", text: "Ulug‘bek" }, { title: "1507", text: "Sulola tugashi" }] },
    quote: { text: "Kuch — adolatdadir.", by: "Amir Temur" },
    closing: ["Eslab qoling", "Davr merosi — bugungi me’morchilik va ilm"],
  },
  case: {
    kicker: "Keys · maktab boshqaruvi",
    title: "42-maktab: davomat 71% dan 94% ga",
    subtitle: "Vaziyat → burilish → natija → saboq",
    agenda: ["Kontekst", "Burilish", "Harakatlar", "Saboqlar"],
    section: ["Kontekst va qahramon", "Yangi direktor, 900 o‘quvchi, eski bino"],
    bulletsTitle: "Boshlang‘ich vaziyat",
    bullets: ["Davomat 71%, sabab noma’lum", "Ota-onalar bilan aloqa yo‘q", "O‘qituvchilar almashinuvi yuqori"],
    twoCol: { title: "Tanlangan yo‘l / rad etilgan yo‘l", l: "Tanlangan", left: ["Sinf rahbari — mentor", "SMS xabarnoma"], r: "Rad etilgan", right: ["Jarima tizimi", "Qo‘shimcha darslar"] },
    stats: { title: "Natija", items: [{ value: "94%", label: "davomat 6 oyda" }, { value: "2×", label: "ota-ona uchrashuvlari" }, { value: "−40%", label: "kechikishlar" }] },
    steps: { title: "Qilingan harakatlar", items: [{ title: "Tahlil", text: "Sabablarni so‘rov" }, { title: "Mentor", text: "Har sinfga" }, { title: "Aloqa", text: "Haftalik SMS" }, { title: "Rag‘bat", text: "Sinflar musobaqasi" }] },
    quote: { text: "Bola maktabga kelmasa — sabab maktabda.", by: "Direktor" },
    closing: ["Saboqlar", "Aloqa jazodan kuchli"],
  },
};

/** Shablon uchun namunaviy deka — 9 slayd, asosiy maketlar. */
export function sampleDeck(id: SlideTemplateId): SlideModel[] {
  const key: Exclude<SlideTemplateId, "auto"> = id === "auto" ? "lecture" : id;
  const c = CONTENT[key];
  const img = { url: sampleImage(key) };
  const footer = "Karimova Nilufar · O‘qituvchi · TDPU";
  return [
    { id: "s0", layout: "title", kicker: c.kicker, title: c.title, subtitle: c.subtitle, image: img, footer },
    { id: "s1", layout: "agenda", title: "Reja", bullets: c.agenda, footer },
    { id: "s2", layout: "section", title: c.section[0], subtitle: c.section[1], image: img, footer },
    { id: "s3", layout: "bullets", title: c.bulletsTitle, bullets: c.bullets, image: img, footer },
    { id: "s4", layout: "twoCol", title: c.twoCol.title, leftTitle: c.twoCol.l, left: c.twoCol.left, rightTitle: c.twoCol.r, right: c.twoCol.right, footer },
    { id: "s5", layout: "stats", title: c.stats.title, stats: c.stats.items, footer },
    { id: "s6", layout: "process", title: c.steps.title, steps: c.steps.items.map((st, i) => ({ n: String(i + 1), ...st })), footer },
    { id: "s7", layout: "quote", title: "Iqtibos", quote: c.quote.text, quoteBy: c.quote.by, image: img, footer },
    { id: "s8", layout: "closing", title: c.closing[0], subtitle: c.closing[1], image: img, footer },
  ];
}

/** Galereya eskizlari uchun to'rt maket: titul, bo'lim, bandlar, raqamlar. */
export const GALLERY_SLIDES = [0, 2, 3, 5] as const;
