/**
 * Admin hisobiga rasm namunalarini qo'shadi — HAQIQIY navbat orqali.
 *
 * `seed-demo.mts` bilan bir xil mantiq (kredit yechiladi, worker
 * bajaradi, natija «Mening fayllarim»da chiqadi), lekin bitta vosita
 * ("rasm") uchun BIR NECHTA variantni ketma-ket yuboradi — Sprint 16
 * dagi uslub va O'zbek-voqelik tuzatishlarini foydalanuvchi o'z
 * hisobida ko'rishi uchun.
 *
 * Foydalanish:
 *   npx tsx --env-file-if-exists=.env.local --conditions=react-server scripts/seed-images.mts -- <username>
 */
import { queryOne, pool } from "../lib/server/db.ts";
import { budgetFor } from "../lib/generation/budget.ts";
import { enqueueGeneration } from "../lib/server/jobs.ts";
import { env } from "../lib/server/env.ts";
import { priceFor, TOOL_BY_SLUG } from "../lib/tools.ts";
import type { FormValues } from "../lib/types.ts";

const [username] = process.argv.slice(2);
if (!username) {
  console.error("Foydalanish: ... scripts/seed-images.mts -- <username>");
  process.exit(1);
}

const tool = TOOL_BY_SLUG["rasm"];
if (!tool) {
  console.error("«rasm» vositasi topilmadi");
  process.exit(1);
}

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

const REGISTON =
  "Registon maydoni erta tongda, tuman, qadimiy madrasalar, ko'k gumbazlar, keng kadr";

/**
 * 1)-2) bir xil sahna, TURLI uslub — foydalanuvchi xabar qilgan
 * "uslublar bir-biriga o'xshaydi" muammosi endi qanday farqlanishini
 * ko'rsatadi. 3) O'zbek gazetteer (`uz-gazetteer.ts`) tuzatishi ishlagan
 * mavzular — taom va bozor.
 */
const JOBS: { topic: string; values: FormValues }[] = [
  ...(["photo", "cinematic", "illustration", "watercolor", "render3d", "minimal", "pencil"] as const).map(
    (imageStyle) => ({
      topic: `Registon (${imageStyle})`,
      values: { prompt: REGISTON, imageStyle, imageRatio: "1:1", imageCount: 1 } as FormValues,
    }),
  ),
  {
    topic: "Palov (haqiqiy ko'rinish)",
    values: {
      prompt: "laganda issiq palov, guruch, sabzi, go'sht",
      imageStyle: "photo",
      imageRatio: "4:3",
      imageCount: 1,
    },
  },
  {
    topic: "Chorsu bozori",
    values: {
      prompt: "Chorsu bozori, ko'k gumbaz, mevalar, odamlar",
      imageStyle: "photo",
      imageRatio: "1:1",
      imageCount: 1,
    },
  },
];

let spent = 0;
for (const { topic, values } of JOBS) {
  const price = priceFor(tool, values);
  const res = await enqueueGeneration({
    userId: String(user.id),
    toolId: tool.id,
    topic,
    price,
    format: tool.output,
    values: { ...values, topic },
    budgetMs: budgetFor(tool, values, env.worker.jobTimeoutMs),
  });
  if (!res.ok) {
    console.error(`  ✘ ${topic}: balans yetmadi (kerak ${res.required}, bor ${res.available})`);
    continue;
  }
  spent += price;
  console.log(`  ✔ ${topic.padEnd(28)} ${String(price).padStart(6)} tanga  id=${res.id}`);
}

console.log(`\nJami yechildi: ${spent.toLocaleString("uz-UZ")} tanga.`);
console.log("Ishlarni worker bajaradi — natija «Mening fayllarim» da ko'rinadi.");
await pool().end();
