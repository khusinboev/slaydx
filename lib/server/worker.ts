import "server-only";
import { randomUUID } from "node:crypto";
import { buildArtifact } from "../generation";
import { TOOL_BY_ID } from "../tools";
import { GENERATION_STEPS } from "../generation-steps";
import { env } from "./env";
import { ensureMigrated } from "./db";
import {
  claimJob,
  completeJob,
  failJob,
  purgeExpiredGenerations,
  reclaimStaleJobs,
  setProgress,
  type ClaimedJob,
  type GenerationPreview,
} from "./jobs";
import { refund, refundPartial } from "./credits";
import { deleteGenerationFile, putGenerationFile, purgeExpiredFiles } from "./storage";
import { deleteAssets, extractAssets, purgeExpiredAssets, putAssets } from "./assets";
import { purgeExpiredSessions } from "./session";
import { purgeRateLimits } from "./ratelimit";
import { purgeExpiredTickets } from "./telegram";
import { queryOne } from "./db";
import type { ToolId } from "../types";
import type { AcademicDoc } from "../generation/types";

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
 */
function progressTicker(job: ClaimedJob) {
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
    const ratio = 1 - Math.exp(-(Date.now() - started) / expected);
    const progress = Math.min(95, Math.round(5 + ratio * 90));
    const idx = Math.min(steps.length - 1, Math.floor((progress / 96) * steps.length));
    // Bu ayni paytda qulf «heartbeat»i ham — `locked_at` suriladi.
    void setProgress(job.id, WORKER_ID, progress, steps[idx]).catch(() => {});
  }, 2000);
  return () => clearInterval(timer);
}

/**
 * Ro'yxat kartochkasi uchun kichik ko'rinish.
 *
 * Ro'yxat endpointi butun hujjatni qaytarmaydi, shuning uchun rasm
 * havolasi va bir necha qator matn shu yerda oldindan tayyorlanadi.
 */
function buildPreview(doc: AcademicDoc | null): GenerationPreview | null {
  if (!doc) return null;
  const url =
    doc.images?.find((im) => im.url)?.url || doc.slides?.find((s) => s.image?.url)?.image?.url;
  const lines = (doc.sections ?? [])
    .flatMap((s) => s.blocks.filter((b) => b.kind === "p" || b.kind === "h2" || b.kind === "li"))
    .map((b) => b.text.trim())
    .filter((t) => t.length > 12)
    .slice(0, 5)
    .map((t) => t.slice(0, 160));
  if (!url && !lines.length) return null;
  return { ...(url ? { url } : {}), ...(lines.length ? { lines } : {}) };
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
export function shortfallRatio(delivered?: { got: number; want: number }): number | null {
  if (!delivered) return null;
  const { got, want } = delivered;
  if (!(want > 0) || got >= want) return null;
  return 1 - Math.max(0, got) / want;
}

async function runJob(job: ClaimedJob): Promise<void> {
  const tool = TOOL_BY_ID[job.toolId as ToolId];
  if (!tool) {
    if (await failJob(job.id, WORKER_ID, "Noma'lum vosita")) {
      await refund(job.userId, job.id, "Noma'lum vosita");
    }
    return;
  }

  const stop = progressTicker(job);
  try {
    const deadline = Date.now() + jobDeadlineMs(job);
    const file = await buildArtifact(tool, job.values, { deadline });

    if (!file.bytes?.byteLength) {
      throw new Error("Fayl bo'sh chiqdi — qayta urinib ko'ring");
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
    });
    if (!won) {
      // Qulf boshqada (ish qayta navbatga tushgan yoki bekor qilingan) —
      // yozganimizni tozalaymiz, aks holda begona natija qolib ketardi.
      console.warn(`[worker] job ${job.id}: qulf yo'qolgan, natija tashlandi`);
      await Promise.all([
        deleteGenerationFile(job.id, job.userId).catch(() => {}),
        deleteAssets(job.id).catch(() => {}),
      ]);
    } else if (shortfallRatio(file.delivered) !== null) {
      /*
       * Va'da qilinganidan kam yetkazildi — farq qaytariladi.
       *
       * Ishni yiqitish noto'g'ri bo'lardi: 4 tadan 3 tasi kelgan bo'lsa,
       * foydalanuvchi uchta yaxshi rasmni ham yo'qotardi. Narx esa faqat
       * SONGA bog'langan (4 ta = 6 000 tanga), shuning uchun kam
       * yetkazilganda to'liq pul olish halol emas.
       */
      const { got, want } = file.delivered!;
      const ok = await refundPartial(
        job.userId,
        job.id,
        shortfallRatio(file.delivered)!,
        `${want} tadan ${got} tasi yaratildi — farq qaytarildi`,
      );
      console.warn(`[worker] job ${job.id}: qisman yetkazildi ${got}/${want}, qaytarish=${ok}`);
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "Yaratishda xatolik";
    console.error(`[worker] job ${job.id} failed:`, message);
    // Pul faqat biz haqiqatan yakunlagan bo'lsak qaytadi — aks holda
    // qulfni olgan boshqa worker bilan ikki marta qaytarilardi.
    if (await failJob(job.id, WORKER_ID, message)) {
      await refund(job.userId, job.id, `Xatolik: ${message}`.slice(0, 200));
    }
  } finally {
    stop();
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

async function housekeeping(): Promise<void> {
  try {
    const dead = await reclaimStaleJobs();
    for (const id of dead) {
      // Osilib qolgan ish uchun ham pul qaytishi kerak.
      const owner = await queryOne<{ user_id: string }>(
        "SELECT user_id FROM generations WHERE id = $1",
        [id],
      );
      if (owner) await refund(String(owner.user_id), id, "Ish vaqti tugadi");
    }
    await purgeExpiredFiles();
    await purgeExpiredAssets();
    await purgeExpiredGenerations();
    await purgeExpiredSessions();
    await purgeRateLimits();
    // Webhook rejimida bot processi bo'lmaydi, shuning uchun chipta va
    // update tarixini ham shu yerda tozalaymiz.
    await purgeExpiredTickets();
  } catch (e) {
    console.error("[worker] housekeeping:", e instanceof Error ? e.message : e);
  }
}

async function loop(): Promise<void> {
  await ensureMigrated();
  console.log(`[worker] ${WORKER_ID} ishga tushdi (concurrency=${env.worker.concurrency})`);
  let sinceHousekeeping = 0;

  while (!stopped) {
    let busy = false;
    try {
      busy = await tick();
    } catch (e) {
      console.error("[worker] tick:", e instanceof Error ? e.message : e);
      // Baza tushgan bo'lishi mumkin — tez-tez urinmaymiz.
      await sleep(5000);
    }
    const wait = busy ? BUSY_POLL_MS : IDLE_POLL_MS;
    sinceHousekeeping += wait;
    if (sinceHousekeeping >= HOUSEKEEPING_MS) {
      sinceHousekeeping = 0;
      await housekeeping();
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
