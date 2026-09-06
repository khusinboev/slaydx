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
 *   npm run seed -- <username> [slug ...]
 *   npm run seed -- adkhambek_4 essay glossary lesson-plan
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
    slideAudience: "lecture",
    slideTemplate: "auto",
    slideTheme: "atlas",
    titleSlide: true,
    author: "Abdujabbor Husinboyev",
    university: "SlaydX",
  },
};

const DEFAULT_SLUGS = ["essay", "glossary", "lesson-plan", "article", "slide"];

const [username, ...slugArgs] = process.argv.slice(2);
if (!username) {
  console.error("Foydalanish: npm run seed -- <username> [slug ...]");
  process.exit(1);
}
const slugs = slugArgs.length ? slugArgs : DEFAULT_SLUGS;

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
