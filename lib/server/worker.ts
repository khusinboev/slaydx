import "server-only";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { buildArtifact } from "../generation";
import { TOOL_BY_ID } from "../tools";
import { GENERATION_STEPS } from "../generation-steps";
import { env } from "./env";
import { ensureMigrated } from "./db";
import {
  claimJob,
  completeJob,
  failJob,
  heartbeat,
  reclaimStaleJobs,
  setCost,
  setProgress,
  type ClaimedJob,
} from "./jobs";
import { refund, refundPartial } from "./credits";
import { deleteGenerationFile, putGenerationFile } from "./storage";
import { deleteAssets, extractAssets, putAssetBytes, putAssets } from "./assets";
import { buildPreview } from "./preview";
import { logoDataUrl } from "./logo";
import { photoDataUrl, purgeOldPhotos } from "./photo";
import { templateForJob } from "./template-upload";
import { purgeOldSources, sourceForJob } from "./source-upload";
import { LiveReporter } from "./live";
import { purgeExpiredSessions } from "./session";
// `game-sessions.ts`ning O'YIN havolalari (`game_sessions`) — auth
// sessiyalari (`session.ts`) bilan bir xil nomdagi, lekin BOSHQA jadval;
// alias shu to'qnashuvni ochiq qiladi (AUDIT-22 R).
import { purgeExpiredSessions as purgeExpiredGameSessions } from "./game-sessions";
import { purgeRateLimits } from "./ratelimit";
import { purgeExpiredTickets } from "./telegram";
import { expireQueuedJobs } from "./queue-ttl";
import { purgeBonusFiles } from "./retention";
import { purgeSourceCache } from "../generation/research/cache";
import { refundUnrefundedFailed } from "./refund-reconcile";
import { queryOne } from "./db";
import type { ToolId } from "../types";
import { refundRatio } from "../generation/delivered";
import { cleanText, safeSlice } from "../generation/safe-text";
import type { Delivered } from "../generation/types";

/**
 * Navbatni bajaruvchi worker.
 *
 * Odatiy holda web process ichida ishlaydi (`WORKER_INLINE=true`) — kichik
 * o'rnatish uchun yetarli. Yuk oshganda `WORKER_INLINE=false` qilib,
 * `npm run worker` ni alohida konteynerda ko'tarish kifoya: kod bir xil.
 */

const WORKER_ID = `${process.pid}-${randomUUID().slice(0, 8)}`;
const IDLE_POLL_MS = 1500;
const BUSY_POLL_MS = 150;
const HOUSEKEEPING_MS = 60_000;

/**
 * «Tiriklik» fayli (W2 shartnomasi, `audit/designs/w2-contracts.md`).
 *
 * Sikl sog'lom ekan (`tick` xatosiz o'tdi) shu faylning mtime'i kamida
 * har 30 s da yangilanadi; Docker HEALTHCHECK (W2-D1)
 * `find /tmp/slaydx-worker-alive -mmin -2 | grep -q .` bilan tekshiradi.
 * Sikl osilib qolsa (masalan cheksiz kutilayotgan so'rov) yoki baza
 * yiqilgan bo'lsa fayl eskiradi va konteyner «unhealthy» bo'ladi.
 */
export const WORKER_ALIVE_FILE = "/tmp/slaydx-worker-alive";

/**
 * Saqlash skaneri (`purgeBonusFiles`) har daqiqada EMAS (W2-D2 review R3).
 *
 * Pullik ishlar hech qachon `files_purged_at` olmaydi, ya'ni 180 kundan
 * eski HAR tayyor qator indeksda abadiy qoladi va har skanerda qayta
 * ko'rib chiqiladi (har biriga `transactions` bo'yicha ikki indeks
 * zondi). 180 kunlik chegara uchun daqiqa aniqligi hech narsa bermaydi —
 * 6 soatda bir marta yetarli. Vaqt belgisi process ichida: qayta ishga
 * tushishda birinchi housekeeping darhol skanerlaydi.
 */
const RETENTION_EVERY_MS = 6 * 3600_000;
let lastRetentionAt = -Infinity;

/** Sinov uchun: keyingi `housekeeping()` saqlash skanerini darhol yurgizsin. */
export function resetRetentionScan(): void {
  lastRetentionAt = -Infinity;
}
/** Har iteratsiyada diskka yozmaslik uchun — 30 s shartnomadan ancha tez. */
const ALIVE_EVERY_MS = 10_000;
let lastAliveAt = 0;
let aliveWarned = false;

/** Tiriklik faylini yangilaydi. HECH QACHON xato tashlamaydi — sikl shu sabab to'xtamasin. */
async function touchAlive(): Promise<void> {
  const now = Date.now();
  if (now - lastAliveAt < ALIVE_EVERY_MS) return;
  lastAliveAt = now;
  try {
    await writeFile(WORKER_ALIVE_FILE, String(now));
    aliveWarned = false;
  } catch (e) {
    // Faqat birinchi marta — har 10 s da jurnalni to'ldirmasin.
    if (!aliveWarned) {
      aliveWarned = true;
      console.warn(`[worker] ${WORKER_ALIVE_FILE} yozilmadi:`, e instanceof Error ? e.message : e);
    }
  }
}

type Globals = typeof globalThis & { __slaydxWorker?: boolean };
const g = globalThis as Globals;

let running = 0;
let stopped = false;

function stepsFor(toolId: string): string[] {
  if (toolId === "image") {
    return ["So‘rov qabul qilindi", "Kompozitsiya tanlanmoqda", "Rasm chizilmoqda", "Fayl saqlanmoqda"];
  }
  if (toolId === "translation") {
    return ["So‘rov qabul qilindi", "Matn o‘qilmoqda", "Tarjima qilinmoqda", "Hujjat formatlanmoqda"];
  }
  return GENERATION_STEPS;
}

/**
 * Ish davomida progressni bazaga yozib turadi.
 *
 * Progress 95% dan oshmaydi va asimptotik yaqinlashadi — tugagani
 * `completeJob` da 100% bo'ladi. Shu sababli "99% da qotib qolgan"
 * ko'rinish chiqmaydi.
 *
 * `live` berilgan bo'lsa (slayd/pro-slayd) va u allaqachon kamida bitta
 * hodisa olgan bo'lsa (`live.started`), bu soxta egri chiziq HAQIQIY
 * progress bilan bir vaqtda ikkalasi ham yozib, bir-birini bosib
 * o'tmasin deb butunlay to'xtaydi — faqat `heartbeat` (qulfni tirik
 * tutish) qoladi, haqiqiy `progress`/`step`ni endi `LiveReporter`
 * (`setLive` orqali) yozadi.
 *
 * `isLive` — xuddi shu qoidaning DEKASIZ varianti (Tarjimon 2, WP1):
 * tarjima dvigateli `LiveReporter` ishlatmaydi, lekin `onStage` orqali
 * haqiqiy bosqichlarni yozadi («Tarjima qilinmoqda · 12/57»). Birinchi
 * haqiqiy bosqich kelgach predikat `true` bo'ladi va soxta egri chiziq
 * shu yerda to'xtaydi — aks holda ikkalasi navbatma-navbat yozib,
 * progress oldinga-orqaga sakrardi.
 */
export function progressTicker(job: ClaimedJob, live: LiveReporter | null, isLive?: () => boolean) {
  const steps = stepsFor(job.toolId);
  /*
   * Kutilayotgan davomiylik ishning O'Z byudjetidan olinadi.
   *
   * Ilgari u qattiq yozilgan edi (kurs ishi uchun 45 s), haqiqiy vaqt esa
   * ~280 s. `1 - exp(-t/45000)` formulasi 90 soniyada 95% ga yetar va
   * qolgan uch daqiqa progress qotib turardi — aynan yuqoridagi izohda
   * «bo'lmaydi» deb yozilgan holat.
   *
   * 0.7 koeffitsienti: ishlar odatda byudjetni to'liq ishlatmaydi,
   * shuning uchun 95% ga byudjet tugashidan biroz oldin yaqinlashadi.
   */
  const expected = Math.max(20_000, jobBudget(job) * 0.7);
  const started = Date.now();
  const timer = setInterval(() => {
    if (live?.started || isLive?.()) {
      // Qulf «heartbeat»i — `progress`/`step`ni endi `LiveReporter` yoki
      // dvigatelning `onStage` i yozadi.
      void heartbeat(job.id, WORKER_ID).catch(() => {});
      return;
    }
    const ratio = 1 - Math.exp(-(Date.now() - started) / expected);
    const progress = Math.min(95, Math.round(5 + ratio * 90));
    const idx = Math.min(steps.length - 1, Math.floor((progress / 96) * steps.length));
    // Bu ayni paytda qulf «heartbeat»i ham — `locked_at` suriladi.
    void setProgress(job.id, WORKER_ID, progress, steps[idx]).catch(() => {});
  }, 2000);
  return () => clearInterval(timer);
}

/**
 * Ishga ajratilgan vaqt.
 *
 * Navbatga qo'yishda hisoblanadi va qatorda saqlanadi. `budget_ms = 0` —
 * bu migratsiyadan oldin yaratilgan eski qator: unda global qiymat
 * ishlatiladi, shunda eski navbat ham to'g'ri tugaydi.
 */
export function jobBudget(job: Pick<ClaimedJob, "budgetMs">): number {
  return job.budgetMs > 0 ? job.budgetMs : env.worker.jobTimeoutMs;
}

/**
 * `buildArtifact` ga beriladigan byudjet (ms).
 *
 * Qulf muddatidan biroz qisqa: ish `reclaimStaleJobs` uni o'lik deb
 * hisoblashidan OLDIN o'zi tugashi va natijani yozishga ulgurishi kerak.
 */
export function jobDeadlineMs(job: Pick<ClaimedJob, "budgetMs">): number {
  return Math.max(30_000, jobBudget(job) - 15_000);
}

/**
 * Kam yetkazilganda qaytariladigan ulush. `null` — qaytarish shart emas.
 *
 * Alohida funksiya, chunki bu PUL qaroridir: `runJob` ichida qolganda
 * uni sinovdan o'tkazib bo'lmasdi (haqiqiy navbat, worker qulfi va
 * `buildArtifact` kerak bo'lardi), va aynan shu yo'l — 4 tadan 1 tasi
 * kelganda foydalanuvchiga pul qaytishi — jim buzilsa hech kim
 * sezmasdi.
 */
/**
 * Kamomad uchun qaytariladigan ulush.
 *
 * Formula `lib/generation/delivered.ts` da — u yerda kamomadning O'ZI
 * hisoblanadi, ya'ni ikkalasi bitta manbadan o'qiydi. Bu yerda faqat
 * worker uchun qulay nom va tashqi qobiq qoladi (testlar shu nomga
 * murojaat qiladi).
 */
export function shortfallRatio(delivered?: Delivered): number | null {
  return refundRatio(delivered);
}

async function runJob(job: ClaimedJob): Promise<void> {
  const tool = TOOL_BY_ID[job.toolId as ToolId];
  if (!tool) {
    if (await failJob(job.id, WORKER_ID, "Noma'lum vosita")) {
      await refund(job.userId, job.id, "Noma'lum vosita");
    }
    return;
  }

  // Faqat slayd/pro-slayd jonli deka yuboradi (`slide-write.ts`/`slide-images.ts`
  // shu ikkisi uchun `onProgress` chaqiradi) — boshqa vositalarga reporter kerak
  // emas.
  const live = tool.id === "slide" || tool.id === "pro-slide" ? new LiveReporter(job.id, WORKER_ID) : null;

  /*
   * Tarjima dvigateli haqiqiy bosqich yuborganidan keyin soxta egri
   * chiziq to'xtaydi (`progressTicker` ning `isLive` predikati).
   */
  let stageSeen = false;
  const onStage = (ev: { progress: number; step: string }) => {
    stageSeen = true;
    // 95 — `completeJob` 100 ni o'zi qo'yadi; dvigatel 100 yuborsa
    // «tayyor» ko'rinar, fayl esa hali yozilmagan bo'lardi.
    void setProgress(job.id, WORKER_ID, Math.min(95, Math.max(0, Math.round(ev.progress))), ev.step).catch(() => {});
  };
  const stop = progressTicker(job, live, () => stageSeen);
  try {
    const deadline = Date.now() + jobDeadlineMs(job);
    // `logoAssetId` bo'lsa foydalanuvchining o'z logotipi (`logo_uploads`)
    // `data:` URL ga aylantiriladi. Topilmasa/bo'sh bo'lsa `undefined` —
    // xato emas, deka logosiz chiqadi (`lib/server/logo.ts` izohiga qarang).
    const logo = await logoDataUrl(job.userId, String(job.values.logoAssetId ?? ""));
    // «O'z shablonim» (faqat pro): namuna topilmasa deka ichki shablon bilan chiqadi.
    const template = tool.id === "pro-slide" ? await templateForJob(job.userId, String(job.values.templateAssetId ?? "")) : undefined;
    /*
     * Yuklangan MANBA fayl (Tarjimon 2 dan boshlangan yo'l). Topilmasa
     * `undefined` — dvigatel matn rejimiga tushadi (`logo`/`template` naqshi).
     *
     * Shart ENDI REYESTRDAN: `tool.modes` e'lon qilgan HAR vosita fayl
     * rejimini ko'rsatadi (`StandardForm` «Fayl asosida» chipi), ya'ni
     * `tool.id === "translation"` bilan cheklash forma va'da qilgan
     * rejimni JIMGINA o'chirardi — AUDIT-20 test vositasi aynan shunga
     * urilgan bo'lardi: «faylingizdan test tuzaman» deb yuklatib, testni
     * mavzu nomidan yozardi. Reyestrda `modes` yo'q vositalar
     * (glossariy, keys, xarita, rezyume) uchun so'rov ham qilinmaydi.
     */
    const source = tool.modes ? await sourceForJob(job.userId, String(job.values.sourceAssetId ?? "")) : undefined;
    /*
     * Rezyume surati (Rezyume 2): kesilgan nusxa `data:` URL ga aylanadi
     * va `extractAssets` uni keyin generatsiya aktiviga chiqaradi.
     * Topilmasa `undefined` — rezyume suratsiz chiqadi (`logo` naqshi).
     */
    const photo =
      tool.id === "resume" ? await photoDataUrl(job.userId, String(job.values.photoAssetId ?? "")) : undefined;
    const file = await buildArtifact(tool, job.values, {
      deadline,
      logo,
      template,
      source,
      photo,
      onStage,
      onProgress: live?.sink,
      // Tinglash o'yini TTS parchalari — shu ishning aktivlariga (`/api/o/[token]/audio/[assetId]` orqali ochiq).
      putAsset: (bytes, mime) => putAssetBytes(job.id, mime, Buffer.from(bytes)),
    });

    if (!file.bytes?.byteLength) {
      throw new Error("Fayl bo'sh chiqdi — qayta urinib ko'ring");
    }

    /*
     * LLM sarf telemetriyasi (Maqola 2 / AUDIT-17, WP4) — hozircha faqat
     * maqola dvigateli to'ldiradi (`file.cost`), boshqa vositalarda
     * `undefined` va bu qadam sukut o'tkazib yuboriladi. `completeJob`DAN
     * OLDIN: u qulfni bo'shatadi, shundan keyin yozish «qulf boshqada»
     * deb jim o'tardi. Xato bo'lsa faqat jurnalga — ish YIQILMAYDI,
     * kredit/fayl bilan bog'liq emas.
     */
    if (file.cost) {
      await setCost(job.id, WORKER_ID, file.cost).catch((e) => {
        console.warn(`[worker] job ${job.id}: cost_json yozilmadi:`, e instanceof Error ? e.message : e);
      });
    }

    // Yuklab olinadigan fayl (DOCX/PPTX/PNG) rasmni allaqachon o'z ichiga
    // olgan. Ko'ruvchi uchun `data:` URL larni alohida aktivga chiqaramiz,
    // shunda JSONB va HTML kichik qoladi.
    const extracted = extractAssets(job.id, file.doc ?? null, file.html);

    await putGenerationFile(job.id, {
      bytes: file.bytes,
      mime: file.mime,
      fileName: file.fileName,
    });
    await putAssets(job.id, extracted.assets);

    const won = await completeJob(job.id, WORKER_ID, {
      html: extracted.html,
      doc: extracted.doc,
      fileName: file.fileName,
      preview: buildPreview(extracted.doc),
      delivered: file.delivered,
    });
    if (!won) {
      // Qulf boshqada (ish qayta navbatga tushgan yoki bekor qilingan) —
      // yozganimizni tozalaymiz, aks holda begona natija qolib ketardi.
      console.warn(`[worker] job ${job.id}: qulf yo'qolgan, natija tashlandi`);
      await Promise.all([
        deleteGenerationFile(job.id, job.userId).catch(() => {}),
        deleteAssets(job.id).catch(() => {}),
      ]);
    } else if (file.delivered && file.delivered.got < file.delivered.want) {
      /*
       * Va'da qilinganidan kam yetkazildi — farq qaytariladi.
       *
       * Ishni yiqitish noto'g'ri bo'lardi: 4 tadan 3 tasi kelgan bo'lsa,
       * foydalanuvchi uchta yaxshi rasmni ham yo'qotardi. Narx esa faqat
       * SONGA bog'langan (4 ta = 6 000 tanga), shuning uchun kam
       * yetkazilganda to'liq pul olish halol emas.
       */
      const { got, want, unit } = file.delivered;
      const label = `${want} tadan ${got} ta${unit ? ` ${unit}` : "si"}`;
      const ratio = shortfallRatio(file.delivered);
      if (ratio === null) {
        // `refundShare: 0` — kamomad bor, lekin narxda unga ustama yo'q
        // (masalan standart paketda rasm). Jim o'tmasin: qayd etiladi.
        console.warn(`[worker] job ${job.id}: kam yetkazildi ${label} — narxda ulushi yo'q, pul qaytarilmadi`);
      } else {
        const ok = await refundPartial(job.userId, job.id, ratio, `${label} yaratildi — farq qaytarildi`);
        console.warn(
          `[worker] job ${job.id}: qisman yetkazildi ${label}, ulush=${ratio.toFixed(3)}, qaytarish=${ok}`,
        );
      }
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "Yaratishda xatolik";
    console.error(`[worker] job ${job.id} failed:`, message);
    await failAndCleanup(job, WORKER_ID, message);
  } finally {
    await live?.stop();
    stop();
  }
}

/**
 * Ishni FAILED qiladi, pulni qaytaradi va shu ishga allaqachon yozilgan
 * fayl/aktivlarni O'CHIRADI (AUDIT prod-readiness C03, BEB-01).
 *
 * `putGenerationFile`/`putAssets` `completeJob`dan OLDIN ishlaydi: undan
 * keyingi har qanday xato (JSONB rad etishi, ulanish uzilishi…) ilgari
 * FAILED + to'liq qaytarish, lekin bazada TAYYOR fayl qoldirardi — ya'ni
 * bepul hujjat. Endi FAILED ishda fayl ham, aktiv ham qolmaydi
 * (`!won` tarmog'idagi tozalash naqshi). `getGenerationFile`dagi
 * `status = 'COMPLETED'` sharti — tozalash ham yiqilgan holat uchun
 * ikkinchi to'siq.
 *
 * Pul ham, tozalash ham faqat `failJob` BIZDA yutganda: qulf boshqa
 * worker'da bo'lsa, uning fayli/natijasiga tegilmaydi va pul ikki marta
 * qaytmaydi.
 */
export async function failAndCleanup(
  job: Pick<ClaimedJob, "id" | "userId">,
  workerId: string,
  message: string,
): Promise<void> {
  if (!(await failJob(job.id, workerId, message))) return;
  await refundThenCleanup(job, cleanText(safeSlice(`Xatolik: ${message}`, 200)));
}

/**
 * FAILED ish uchun: pulni qaytaradi va fayl/aktivlarni o'chiradi.
 *
 * O'chirish `finally` da — `refund` yiqilsa ham (ulanish uzilishi, CHECK)
 * FAILED ishning fayli bazada qolmasin; refund xatosi jurnalga yoziladi va
 * yuqoriga qaytariladi (chaqiruvchi o'z xatti-harakatini saqlaydi).
 * `failAndCleanup` va `housekeeping` (`reclaimStaleJobs` FAILED qilganlar) umumiy yo'li.
 */
async function refundThenCleanup(job: Pick<ClaimedJob, "id" | "userId">, note: string): Promise<void> {
  try {
    await refund(job.userId, job.id, note);
  } catch (e) {
    console.error(`[worker] job ${job.id}: pul qaytarilmadi:`, e instanceof Error ? e.message : e);
    throw e;
  } finally {
    await Promise.all([
      deleteGenerationFile(job.id, job.userId).catch((e) => {
        console.warn(`[worker] job ${job.id}: FAILED ish fayli o'chirilmadi:`, e instanceof Error ? e.message : e);
      }),
      deleteAssets(job.id).catch((e) => {
        console.warn(`[worker] job ${job.id}: FAILED ish aktivlari o'chirilmadi:`, e instanceof Error ? e.message : e);
      }),
    ]);
  }
}

async function tick(): Promise<boolean> {
  if (running >= env.worker.concurrency) return true;
  const job = await claimJob(WORKER_ID);
  if (!job) return false;

  running++;
  void runJob(job)
    .catch((e) => console.error("[worker] unexpected:", e))
    .finally(() => {
      running--;
    });
  return true;
}

/**
 * Bitta housekeeping qadami — ALOHIDA (AUDIT prod-readiness DB-10).
 *
 * Ilgari hamma qadam bitta `try` ichida edi: birinchisi (masalan
 * `reclaimStaleJobs` ulanish uzilishida) yiqilsa, qolganlari — navbat
 * muddati, saqlash muddati, sessiya/fayl tozalash — shu daqiqada umuman
 * bajarilmasdi. Endi xato faqat o'z qadamini to'xtatadi va jurnalga yoziladi.
 */
async function step(name: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    console.error(`[worker] housekeeping/${name}:`, e instanceof Error ? e.message : e);
  }
}

export async function housekeeping(): Promise<void> {
  await step("reclaim", async () => {
    const dead = await reclaimStaleJobs();
    for (const id of dead) {
      // Osilib qolgan ish uchun ham pul qaytishi kerak — va o'lgan worker
      // `completeJob`dan oldin saqlab ulgurgan fayl/aktivlar qolmasin (C03).
      // Har ish alohida: bittasining qaytarish xatosi qolganlarini to'xtatmasin.
      await step(`reclaim-refund ${id}`, async () => {
        const owner = await queryOne<{ user_id: string }>(
          "SELECT user_id FROM generations WHERE id = $1",
          [id],
        );
        if (owner) await refundThenCleanup({ id, userId: String(owner.user_id) }, "Ish vaqti tugadi");
      });
    }
  });
  /*
   * Navbat muddati (capacity §4): `QUEUE_TTL_SEC` dan uzoq kutgan ish
   * FAILED + pul qaytariladi (bitta tranzaksiyada, bir marta).
   */
  await step("queue-ttl", () => expireQueuedJobs());
  /*
   * Xavfsizlik to'ri (review N3): FAILED qilingan, lekin puli qaytmay
   * qolgan ishlar (yuqoridagi yoki `failAndCleanup`dagi alohida refund
   * tranzaksiyasi yiqilgan bo'lsa) — aynan bir marta qaytariladi.
   */
  await step("refund-reconcile", () => refundUnrefundedFailed());
  /*
   * Saqlash muddati (C23): faqat bonus bilan to'langan tayyor ishlarning
   * fayllari `RETENTION_BONUS_DAYS` dan keyin tozalanadi. Pullik ishlar —
   * muddatsiz (`011_no_expiry.sql`). Soatlab bir marta (`RETENTION_EVERY_MS`);
   * belgi skanerdan OLDIN qo'yiladi — yiqilayotgan skaner ham har daqiqada
   * bazani qayta urmasin.
   */
  await step("retention", async () => {
    if (Date.now() - lastRetentionAt < RETENTION_EVERY_MS) return;
    lastRetentionAt = Date.now();
    await purgeBonusFiles();
  });
  await step("sessions", () => purgeExpiredSessions());
  /*
   * O'YIN havolalari (AUDIT-22 R, `game_sessions.expires_at`, standart
   * 30 kun) — `purgeOldSources`/`purgeOldPhotos` bilan bir qatorda.
   * Natijalar (`game_results`) alohida o'chirilmaydi: FK
   * `ON DELETE CASCADE` (`021_games.sql`) ularni sessiya bilan birga
   * olib tashlaydi.
   */
  await step("game-sessions", () => purgeExpiredGameSessions());
  await step("rate-limits", () => purgeRateLimits());
  // Webhook rejimida bot processi bo'lmaydi, shuning uchun chipta va
  // update tarixini ham shu yerda tozalaymiz.
  await step("tickets", () => purgeExpiredTickets());
  /*
   * Tarjima manbasi — bir martalik ish fayli (20 MB gacha har biri).
   * Namunadan (`template_uploads`, muddatsiz) farqi shu: tarjima
   * tayyor bo'lgach asl hujjat faqat joy va maxfiylik yuki bo'lib
   * qoladi.
   */
  await step("sources", () => purgeOldSources(30));
  /*
   * Rezyume surati — shaxsiy ma'lumot. Generatsiyaga tushgan nusxa
   * allaqachon `generation_assets` da, bu jadval esa faqat FORMA
   * uchun: 90 kundan keyin uni saqlash keraksiz yuk.
   */
  await step("photos", () => purgeOldPhotos(90));
  /*
   * Manba keshi (OpenAlex/Crossref xom JSON, EXT-08) — TTL 30 kun, ya'ni
   * 60 kundan eski yozuv hech qachon o'qilmaydi. Partiyalab o'chiriladi.
   * Foydalanilmagan logotip/shablon (`purgeUnusedUploads`) ATAYIN ulanmagan —
   * «O'z shablonim» muddati egasi qaroriga bog'liq.
   */
  await step("source-cache", () => purgeSourceCache(60));
}

async function loop(): Promise<void> {
  await ensureMigrated();
  console.log(`[worker] ${WORKER_ID} ishga tushdi (concurrency=${env.worker.concurrency})`);
  let sinceHousekeeping = 0;

  while (!stopped) {
    let busy = false;
    let healthy = true;
    try {
      busy = await tick();
    } catch (e) {
      healthy = false;
      console.error("[worker] tick:", e instanceof Error ? e.message : e);
      // Baza tushgan bo'lishi mumkin — tez-tez urinmaymiz.
      await sleep(5000);
    }
    // Faqat sog'lom iteratsiyada — baza yiqilsa fayl eskiradi (HEALTHCHECK).
    if (healthy) await touchAlive();
    const wait = busy ? BUSY_POLL_MS : IDLE_POLL_MS;
    sinceHousekeeping += wait;
    if (sinceHousekeeping >= HOUSEKEEPING_MS) {
      sinceHousekeeping = 0;
      await housekeeping();
      // Uzoq housekeeping (katta tozalash partiyasi) 30 s oynani yemasin.
      if (healthy) await touchAlive();
    }
    await sleep(wait);
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Web process ichida bir marta ishga tushiradi. Ikkinchi chaqiruv e'tiborsiz. */
export function startInlineWorker(): void {
  if (g.__slaydxWorker) return;
  g.__slaydxWorker = true;
  void loop().catch((e) => console.error("[worker] fatal:", e));
}

export function stopWorker(): void {
  stopped = true;
}

/**
 * Alohida worker processining global himoyasi (AUDIT prod-readiness C27:
 * BEB-03, CONC-04, BEA-18). `scripts/worker.ts` chaqiradi.
 *
 * - `unhandledRejection`: Node standarti processni YIQITADI — bitta
 *   ushlanmagan promise (masalan vaqtincha baza xatosi) shu paytda
 *   bajarilayotgan BARCHA ishlarni o'ldirardi. Jurnalga yoziladi va
 *   process davom etadi: navbat holati bazada, qulf o'z-o'zidan tiklanadi.
 * - `uncaughtException`: holat noma'lum — jurnal va nol bo'lmagan kod
 *   bilan chiqish; Docker (`restart:`) processni qayta ko'taradi, osilib
 *   qolgan ishlarni `reclaimStaleJobs` qaytaradi.
 */
export function installProcessGuards(proc: Pick<NodeJS.Process, "on" | "exit"> = process): void {
  proc.on("unhandledRejection", (reason: unknown) => {
    console.error(
      "[worker] unhandledRejection (process davom etadi):",
      reason instanceof Error ? (reason.stack ?? reason.message) : reason,
    );
  });
  proc.on("uncaughtException", (err: Error) => {
    console.error("[worker] uncaughtException — process to'xtaydi:", err?.stack ?? err);
    proc.exit(1);
  });
}

/** Alohida process uchun kirish nuqtasi (`npm run worker`). */
export async function runWorkerProcess(): Promise<void> {
  const shutdown = () => {
    console.log("[worker] to'xtatilmoqda...");
    stopWorker();
    setTimeout(() => process.exit(0), 2000);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  await loop();
}
