/**
 * Hisobga namunaviy kontent qo'shadi — HAQIQIY navbat orqali.
 *
 * Nega kerak: yangi deploydan keyin (yoki demo ko'rsatishdan oldin)
 * hisobda ko'rsatadigan hujjat bo'lishi kerak. Fayllar TTL bilan
 * o'chadi (`FILE_TTL_HOURS`), shuning uchun eski hisobda odatda hech
 * narsa qolmaydi.
 *
 * MUHIM: bu skript bazaga qator YOZMAYDI. U `enqueueGeneration` ni
 * chaqiradi — ya'ni ilovaning O'Z yo'li: kredit yechiladi, ish navbatga
 * tushadi, uni jonli worker bajaradi, natija esa oddiy generatsiya
 * kabi «Mening fayllarim» da paydo bo'ladi. Qo'lda qo'yilgan qator
 * haqiqiy mahsulotni ko'rsatmasdi.
 *
 * Foydalanish:
 *   npm run seed -- <username> [slug ... | all]
 *   npm run seed -- adkhambek_4 essay glossary lesson-plan
 *   npm run seed -- adkhambek_4 all   # 14 turdagi vositaning HAMMASI
 *
 * Slug berilmasa standart to'plam ishlatiladi.
 */
import { queryOne, pool } from "../lib/server/db.ts";
import { budgetFor } from "../lib/generation/budget.ts";
import { enqueueGeneration } from "../lib/server/jobs.ts";
import { env } from "../lib/server/env.ts";
import { priceFor, TOOL_BY_SLUG, topicOf } from "../lib/tools.ts";
import type { FormValues } from "../lib/types.ts";

/** Namunalar `scripts/live-engine.mts` dagi keyslar bilan bir xil. */
const SAMPLES: Record<string, FormValues> = {
  coursework: {
    topic: "Boshlang'ich sinf o'quvchilarida o'qish ko'nikmalarini rivojlantirish",
    language: "uz",
    author: "Abdujabbor Husinboyev — 3-kurs, 301-guruh",
    university: "Toshkent davlat pedagogika universiteti",
    faculty: "Boshlang'ich ta'lim",
    department: "Pedagogika",
    ministry: "oliy",
    tocMethod: "ai",
    pages: "20-25",
    images: "yes",
  },
  referat: {
    topic: "Iqlim o'zgarishi va uning O'zbekistonga ta'siri",
    language: "uz",
    author: "Abdujabbor Husinboyev — 2-kurs, 201-guruh",
    university: "Toshkent davlat universiteti",
    pages: "15-20",
  },
  resume: {
    fullName: "Abdujabbor Husinboyev",
    location: "Toshkent, O'zbekiston",
    email: "info@slaydxx.uz",
    phone: "+998997333896",
    targetRole: "Frontend dasturchi",
    summary: "3 yillik tajribaga ega, React va Next.js bilan ishlaydi.",
    tone: "professional",
    experience: "SlaydX — Frontend dasturchi (2023–hozirgacha): foydalanuvchi interfeyslarini ishlab chiqish.",
    education: "Toshkent axborot texnologiyalari universiteti — Dasturiy injiniring (2020–2024)",
    skills: "React, TypeScript, Next.js, Tailwind CSS",
  },
  thesis: {
    topic: "Raqamli ta'limda sun'iy intellekt vositalarining o'rni",
    language: "uz",
    author: "Abdujabbor Husinboyev — 4-kurs, 401-guruh",
    university: "Toshkent davlat universiteti",
    kind: "standard",
    pages: "5-10",
    annotationLangs: "same",
  },
  translation: {
    mode: "text",
    sourceText:
      "O'zbekiston Markaziy Osiyoda joylashgan mamlakat bo'lib, boy tarixiy va madaniy merosga ega. " +
      "Samarqand, Buxoro va Xiva shaharlari Buyuk ipak yo'lining muhim bekatlari hisoblangan. " +
      "So'nggi yillarda mamlakatda raqamli texnologiyalar va ta'lim sohasida katta islohotlar amalga oshirilmoqda.",
    sourceLang: "uz",
    language: "en",
  },
  keys: {
    topic: "Pedagogika fanidan vaziyatli topshiriqlar",
    language: "uz",
  },
  "mustaqil-ish": {
    topic: "Suv resurslarini muhofaza qilish",
    language: "uz",
    author: "Abdujabbor Husinboyev — 2-kurs, 205-guruh",
    university: "Toshkent davlat texnika universiteti",
    pages: "15-20",
    tocMethod: "ai",
  },
  image: {
    prompt: "Registon maydoni erta tongda, tuman, qadimiy madrasalar, ko'k gumbazlar, keng kadr",
    imageStyle: "photo",
    imageRatio: "1:1",
    imageCount: 1,
  },
  essay: {
    topic: "Ona tilim — g‘ururim va iftixorim",
    pages: "5",
    language: "uz",
    author: "Abdujabbor Husinboyev",
    design: "iris",
  },
  article: {
    topic: "Quyosh energiyasidan foydalanishning iqtisodiy samaradorligi",
    kind: "imrad",
    pages: "3-5",
    language: "uz",
    author: "Abdujabbor Husinboyev",
    degree: "Tadqiqotchi",
    organization: "SlaydX",
    email: "info@slaydxx.uz",
    annotationLangs: "same",
  },
  glossary: {
    topic: "Fotosintez va o‘simlik fiziologiyasi",
    termCount: "20",
    language: "uz",
    university: "15-son umumiy o‘rta ta’lim maktabi",
    author: "Abdujabbor Husinboyev",
  },
  "lesson-plan": {
    topic: "Kasrlarni qo‘shish va ayirish",
    subject: "Matematika",
    grade: 5,
    duration: "45",
    language: "uz",
    university: "15-son umumiy o‘rta ta’lim maktabi",
    author: "Abdujabbor Husinboyev",
  },
  "texnologik-xarita": {
    subject: "Biologiya",
    weeklyHours: 4,
    totalHours: 136,
    language: "uz",
    university: "15-son umumiy o‘rta ta’lim maktabi",
    author: "Abdujabbor Husinboyev",
  },
  slide: {
    topic: "Fotosintez jarayoni",
    quality: "standard",
    language: "uz",
    // AUDIT-9: oddiy vosita ham boy brif oladi — namuna shuni ko'rsatsin.
    slideAudience: "school_8_9",
    slidePurpose: "lesson",
    slideTemplate: "auto",
    slideTheme: "atlas",
    titleSlide: true,
    agendaSlide: true,
    planItems: 4,
    textVolume: "standart",
    quizCount: 3,
    speakerNotes: true,
    localExamples: true,
    subject: "Biologiya",
    author: "Abdujabbor Husinboyev",
    position: "Biologiya o‘qituvchisi",
    organization: "SlaydX",
  },
  /*
   * Pro slayd (AUDIT-9) — namunada BARCHA yangi imkoniyat ko'rinsin:
   * tuzilma bloklari, asosiy g'oyalar, internet qidiruvi (manbalar
   * slaydi), test + javoblar kaliti (izoh o'chiq), rasm uslubi.
   * 12 slayd × 2 000 = 24 000 tanga.
   */
  "pro-slide": {
    topic: "Orol dengizi fojiasi va uni tiklash choralari",
    slideCount: 12,
    language: "uz",
    slideAudience: "school_8_9",
    slidePurpose: "open_lesson",
    blocks: "reja,maqsadlar,motivatsiya,amaliyot,test,uyga_vazifa,adabiyotlar",
    planItems: 4,
    keyIdeas: "Orol qurishi inson faoliyati oqibati\nOrolbo‘yida saksovul ekish\nSuvni tejash har kimga bog‘liq",
    localExamples: true,
    internetSearch: true,
    quizCount: 3,
    speakerNotes: false,
    textVolume: "standart",
    slideImageStyle: "illustration",
    slideTheme: "atlas",
    subject: "Geografiya",
    author: "Abdujabbor Husinboyev",
    position: "Geografiya o‘qituvchisi",
    organization: "SlaydX",
  },
};

const DEFAULT_SLUGS = ["essay", "glossary", "lesson-plan", "article", "slide"];

/*
 * `SAMPLES` kaliti — tool ID (masalan `"lesson-plan"`), forma slug'i
 * bilan bir xil bo'lishi shart emas (masalan `image` tool ID, `rasm`
 * slug). Har biriga mos slug'ni `TOOL_BY_SLUG` dan emas, to'g'ridan-to'g'ri
 * tool ro'yxatidan qidiramiz — pastdagi silliq siklda.
 */
const ALL_SLUGS = Object.values(TOOL_BY_SLUG)
  .filter((t) => SAMPLES[t.id])
  .map((t) => t.slug);

const [username, ...slugArgs] = process.argv.slice(2);
if (!username) {
  console.error("Foydalanish: npm run seed -- <username> [slug ... | all]");
  process.exit(1);
}
const slugs = !slugArgs.length ? DEFAULT_SLUGS : slugArgs[0] === "all" ? ALL_SLUGS : slugArgs;

const user = await queryOne<{ id: string; points: string; quota: string; balance: string }>(
  "SELECT id, points, quota, balance FROM users WHERE username = $1 OR phone = $1",
  [username],
);
if (!user) {
  console.error(`Foydalanuvchi topilmadi: ${username}`);
  process.exit(1);
}
const wallet = Number(user.points) + Number(user.quota) + Number(user.balance);
console.log(`Foydalanuvchi ${username} (id=${user.id}), hisobda ${wallet.toLocaleString("uz-UZ")} tanga\n`);

let spent = 0;
for (const slug of slugs) {
  const tool = TOOL_BY_SLUG[slug];
  if (!tool) {
    console.error(`  ✘ noma'lum slug: ${slug}`);
    continue;
  }
  const values = SAMPLES[tool.id];
  if (!values) {
    console.error(`  ✘ ${slug}: namuna qiymatlari yo'q`);
    continue;
  }
  const price = priceFor(tool, values);
  const res = await enqueueGeneration({
    userId: String(user.id),
    toolId: tool.id,
    topic: topicOf(values, tool),
    price,
    format: tool.output,
    values,
    budgetMs: budgetFor(tool, values, env.worker.jobTimeoutMs),
  });
  if (!res.ok) {
    console.error(`  ✘ ${tool.title}: balans yetmadi (kerak ${res.required}, bor ${res.available})`);
    continue;
  }
  spent += price;
  console.log(`  ✔ ${tool.title.padEnd(20)} ${price.toLocaleString("uz-UZ").padStart(7)} tanga  id=${res.id}`);
}

console.log(`\nJami yechildi: ${spent.toLocaleString("uz-UZ")} tanga.`);
console.log("Ishlarni worker bajaradi — natija «Mening fayllarim» da ko'rinadi.");
await pool().end();
