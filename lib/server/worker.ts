import "server-only";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { buildArtifact } from "../generation";
import { TOOL_BY_ID } from "../tools";
import { GENERATION_STEPS } from "../generation-steps";
import { env } from "./env";
import { Client } from "pg";
import { ensureMigrated, poolConfig } from "./db";
import {
  claimJob,
  commitJobResult,
  failJob,
  heartbeat,
  newLease,
  reclaimStaleJobs,
  releaseJobs,
  setCost,
  setProgress,
  type ClaimedJob,
} from "./jobs";
import { refund, refundPartial } from "./credits";
import { deleteGenerationFile } from "./storage";
import { deleteAssets, extractAssets, putAssetBytes } from "./assets";
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
import { purgePaymentEvents } from "./payment-events";
import { queryOne } from "./db";
import type { ToolConfig, ToolId } from "../types";
import { refundRatio } from "../generation/delivered";
import { cleanText, safeSlice } from "../generation/safe-text";
import type { Delivered } from "../generation/types";
import { log, withFreshLogContext, type LogFields } from "./log";
import { providerOf, userMessage } from "./user-error";

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

/**
 * To'lov webhook izi (`payment_events`, OBS-09) — 365 kundan eskisi shu
 * cadence bilan (6 soat) tozalanadi. Yil chegarasi uchun daqiqa aniqligi
 * kerak emas; har daqiqada skaner bazani behuda urardi.
 */
const PAYMENT_EVENTS_RETENTION_DAYS = 365;
let lastPaymentEventsPurgeAt = -Infinity;

/**
 * Sinov uchun: keyingi `housekeeping()` 6 soatlik qadamlarni (saqlash
 * skaneri, `payment_events` tozalash) darhol yurgizsin.
 */
export function resetRetentionScan(): void {
  lastRetentionAt = -Infinity;
  lastPaymentEventsPurgeAt = -Infinity;
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
      log("warn", `[worker] ${WORKER_ALIVE_FILE} yozilmadi`, { err: e });
    }
  }
}

/**
 * Tez-tez takrorlanadigan ogohlantirish (heartbeat/progress har 2 s) —
 * kalit bo'yicha daqiqasiga bir marta (OBS-06: jim `.catch(() => {})`
 * o'rniga; baza yiqilganda jurnal to'lib ketmasin).
 */
const WARN_EVERY_MS = 60_000;
const lastWarnAt = new Map<string, number>();
function throttledWarn(key: string, msg: string, fields: LogFields): void {
  const now = Date.now();
  if (now - (lastWarnAt.get(key) ?? -Infinity) < WARN_EVERY_MS) return;
  if (lastWarnAt.size > 1_000) lastWarnAt.clear();
  lastWarnAt.set(key, now);
  log("warn", msg, fields);
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
  /*
   * Yozuv chastotasi (DB-12, SCALE-13). Ilgari HAR 2 s da UPDATE (180 s lik
   * ish = 90 ta). Endi ijara (`locked_at`) kamida har `LEASE_EVERY_MS` da,
   * soxta progress esa faqat O'ZGARGANDA va ko'pi bilan har
   * `PROGRESS_MIN_GAP_MS` da yoziladi; jonli rejimda `LiveReporter` ning
   * o'z yozuvi (`setLive` ham `locked_at` ni suradi) ijarani yangilagan
   * bo'lsa heartbeat yuborilmaydi. `tests/worker-heartbeat-rate.test.mts`.
   */
  let lastLeaseAt = -Infinity;
  let lastProgress = -1;
  let lastStep = "";
  let liveMode = false;
  const timer = setInterval(() => {
    const now = Date.now();
    if (live?.started || isLive?.()) {
      // Qulf «heartbeat»i — `progress`/`step`ni endi `LiveReporter` yoki
      // dvigatelning `onStage` i yozadi. Rejim almashgan birinchi tickda
      // darhol (10 s sanog'i shu yerdan boshlanadi), keyin faqat ijara
      // oxirgi yozuvdan beri `LEASE_EVERY_MS` yangilanmagan bo'lsa.
      const touched = Math.max(lastLeaseAt, live?.lastWriteAt ?? -Infinity);
      if (liveMode && now - touched < LEASE_EVERY_MS) return;
      liveMode = true;
      lastLeaseAt = now;
      void heartbeat(job.id, job.lease).catch((e) => {
        throttledWarn(`hb:${job.id}`, "[worker] heartbeat yozilmadi", { jobId: job.id, err: e });
      });
      return;
    }
    const ratio = 1 - Math.exp(-(now - started) / expected);
    const progress = Math.min(95, Math.round(5 + ratio * 90));
    const idx = Math.min(steps.length - 1, Math.floor((progress / 96) * steps.length));
    const step = steps[idx];
    const gap = now - lastLeaseAt;
    const changed = progress !== lastProgress || step !== lastStep;
    const due = (changed && gap >= PROGRESS_MIN_GAP_MS) || gap >= LEASE_EVERY_MS;
    if (!due) return;
    lastLeaseAt = now;
    lastProgress = progress;
    lastStep = step;
    // Bu ayni paytda qulf «heartbeat»i ham — `locked_at` suriladi.
    void setProgress(job.id, job.lease, progress, step).catch((e) => {
      throttledWarn(`hb:${job.id}`, "[worker] progress yozilmadi", { jobId: job.id, err: e });
    });
  }, PROGRESS_TICK_MS);
  return () => clearInterval(timer);
}

/** Ticker qadami — faqat hisoblash (xotirada); bazaga yozish quyidagi ikki chegarada. */
const PROGRESS_TICK_MS = 2_000;
/** Soxta progress yozuvlari orasidagi eng qisqa oraliq (o'zgargan bo'lsa ham). */
const PROGRESS_MIN_GAP_MS = 4_000;
/**
 * Ijara (`locked_at`) shundan kechikmay yangilanadi. `reclaimStaleJobs`
 * chegarasi oxirgi yozuvdan byudjet + 30 s — 10 s bilan bir necha ketma-ket
 * yozuv yo'qolsa ham (baza qisqa uzilishi) ish o'lik hisoblanmaydi.
 */
export const LEASE_EVERY_MS = 10_000;

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

/**
 * Qattiq to'xtash zaxirasi (C15 worker tomoni, `audit/designs/w3-contracts.md`).
 *
 * `deadline` (`jobDeadlineMs` = byudjet − 15 s) dvigatelga beriladi va u
 * (W3-B: LLM zanjiri) o'zi to'xtashi kerak. Lekin qurilish promise'ini
 * o'ldirib bo'lmaydi: osilgan so'rov yoki CPU ishi uni istalgancha ushlab
 * turardi, heartbeat esa qulfni abadiy tirik saqlardi — slot band,
 * foydalanuvchi natijasiz, pul yechilgan. `deadline + shu zaxira` o'tsa
 * worker ishni o'zi FAILED qiladi, pulni qaytaradi va slotni bo'shatadi.
 * Natija: byudjet + 15 s — `reclaimStaleJobs` chegarasidan (byudjet + 30 s)
 * oldin.
 */
export const HARD_STOP_GRACE_MS = 30_000;

/**
 * SIGTERM dan keyin ishlar tugashini kutish (C14). `docker-compose.yml`
 * da worker `stop_grace_period: 30s` — 20 s kutish + navbatga qaytarish +
 * chiqish shu oynaga bemalol sig'adi (Docker SIGKILL gacha).
 */
export const SHUTDOWN_GRACE_MS = 20_000;

/** `runJob` bog'liqliklari — sinovda `build` stub bilan almashtiriladi. */
export type RunOptions = {
  build?: typeof buildArtifact;
  /** Qattiq to'xtash muddati (ms, claim'dan). Berilmasa `jobDeadlineMs + HARD_STOP_GRACE_MS`. */
  hardStopMs?: number;
};

/**
 * Yurish holati: `abandoned` — muddat o'tgan yoki SIGTERM da navbatga qaytarilgan; natija tashlanadi.
 * `stage` — dvigatel yuborgan oxirgi haqiqiy bosqich (OBS-08: xato qaysi bosqichda bo'lganini jurnalga).
 */
type RunCtl = { abandoned: boolean; stage?: string };

/** Shu process bajarayotgan claimlar (`lease` bo'yicha) — SIGTERM da kutish/qaytarish uchun. */
const inflight = new Map<string, { job: ClaimedJob; ctl: RunCtl; done: Promise<void> }>();

/**
 * Bitta claimni bajaradi. Promise qurilish tugaganda YOKI qattiq muddat
 * o'tganda qaytadi — shu paytda slot bo'shaydi (`tick` `running--`).
 */
export async function runJob(job: ClaimedJob, opts: RunOptions = {}): Promise<void> {
  const ctl: RunCtl = { abandoned: false };
  // Shu ish ichidagi HAR jurnal qatori (`credits.ts` refund va h.k.) `jobId`/`userId` ni o'zi oladi (OBS-02).
  const done = withFreshLogContext({ jobId: job.id, userId: job.userId }, () => runWithHardStop(job, opts, ctl));
  inflight.set(job.lease, { job, ctl, done });
  try {
    await done;
  } finally {
    inflight.delete(job.lease);
  }
}

async function runWithHardStop(job: ClaimedJob, opts: RunOptions, ctl: RunCtl): Promise<void> {
  const build = opts.build ?? buildArtifact;
  const tool = TOOL_BY_ID[job.toolId as ToolId];
  log("info", "[worker] ish olindi", {
    jobId: job.id,
    userId: job.userId,
    toolId: job.toolId,
    attempt: job.attempts,
    budgetMs: job.budgetMs,
    lease: job.lease,
  });
  if (!tool) {
    log("error", "[worker] Noma'lum vosita", { jobId: job.id, toolId: job.toolId, attempt: job.attempts });
    if (await failJob(job.id, job.lease, "Noma'lum vosita")) {
      const refunded = await refund(job.userId, job.id, "Noma'lum vosita");
      log("info", "[worker] pul qaytarildi", { jobId: job.id, refunded });
    }
    return;
  }

  // Faqat slayd/pro-slayd jonli deka yuboradi (`slide-write.ts`/`slide-images.ts`
  // shu ikkisi uchun `onProgress` chaqiradi) — boshqa vositalarga reporter kerak
  // emas.
  const live = tool.id === "slide" || tool.id === "pro-slide" ? new LiveReporter(job.id, job.lease) : null;

  /*
   * Tarjima dvigateli haqiqiy bosqich yuborganidan keyin soxta egri
   * chiziq to'xtaydi (`progressTicker` ning `isLive` predikati).
   */
  let stageSeen = false;
  const onStage = (ev: { progress: number; step: string }) => {
    stageSeen = true;
    ctl.stage = String(ev.step ?? "").slice(0, 120);
    // 95 — `completeJob` 100 ni o'zi qo'yadi; dvigatel 100 yuborsa
    // «tayyor» ko'rinar, fayl esa hali yozilmagan bo'lardi.
    void setProgress(job.id, job.lease, Math.min(95, Math.max(0, Math.round(ev.progress))), ev.step).catch((e) => {
      throttledWarn(`hb:${job.id}`, "[worker] bosqich yozilmadi", { jobId: job.id, stage: ctl.stage, err: e });
    });
  };
  const stop = progressTicker(job, live, () => stageSeen);

  const hardStopMs = opts.hardStopMs ?? jobDeadlineMs(job) + HARD_STOP_GRACE_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<"expired">((resolve) => {
    timer = setTimeout(() => resolve("expired"), hardStopMs);
  });
  const work = execute(job, tool, build, ctl, live, onStage);
  try {
    const outcome = await Promise.race([work.then(() => "done" as const), expired]);
    if (outcome === "expired") {
      /*
       * Qurilishni to'xtatib bo'lmaydi — u yetim bo'lib davom etadi, lekin
       * slotni ushlamaydi. Uning kech natijasi `ctl.abandoned` va qulf
       * to'sig'i (`commitJobResult`) bilan tashlanadi; pul `failJob` qulf
       * to'sig'idan o'tgan BITTA yo'lda, `reference` bo'yicha idempotent qaytadi.
       */
      ctl.abandoned = true;
      log(
        "error",
        `[worker] job ${job.id}: qattiq muddat (${Math.round(hardStopMs / 1000)} s) o'tdi — FAILED, pul qaytariladi, slot bo'shatildi`,
        { jobId: job.id, attempt: job.attempts, stage: ctl.stage, hardStopMs, toolId: job.toolId },
      );
      work.catch((e) => {
        log("warn", `[worker] job ${job.id}: yetim qurilish xatosi`, { jobId: job.id, attempt: job.attempts, provider: providerOf(e), err: e });
      });
      await failAndCleanup(job, job.lease, "Ish vaqti tugadi");
    }
  } finally {
    clearTimeout(timer);
    await live?.stop();
    stop();
  }
}

async function execute(
  job: ClaimedJob,
  tool: ToolConfig,
  build: typeof buildArtifact,
  ctl: RunCtl,
  live: LiveReporter | null,
  onStage: (ev: { progress: number; step: string }) => void,
): Promise<void> {
  const startedAt = Date.now();
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
    const file = await build(tool, job.values, {
      deadline,
      logo,
      template,
      source,
      photo,
      onStage,
      onProgress: live?.sink,
      // Tinglash o'yini TTS parchalari — shu ishning aktivlariga (`/api/o/[token]/audio/[assetId]` orqali ochiq).
      // Tashlab ketilgan (muddati o'tgan / SIGTERM da qaytarilgan) yurish
      // FAILED yoki begona ishga yetim aktiv yozmasin.
      putAsset: (bytes, mime) =>
        ctl.abandoned
          ? Promise.reject(new Error("Ish to'xtatilgan — aktiv yozilmadi"))
          : putAssetBytes(job.id, mime, Buffer.from(bytes)),
    });

    if (ctl.abandoned) {
      // Qattiq muddat o'tgan yoki SIGTERM da navbatga qaytarilgan — ish
      // allaqachon FAILED/QUEUED, natija tashlanadi (C15).
      log("warn", `[worker] job ${job.id}: kech natija tashlandi (claim ${job.lease} tashlab ketilgan)`, {
        jobId: job.id,
        attempt: job.attempts,
      });
      return;
    }

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
      await setCost(job.id, job.lease, file.cost).catch((e) => {
        log("warn", `[worker] job ${job.id}: cost_json yozilmadi`, { jobId: job.id, err: e });
      });
    }

    // Yuklab olinadigan fayl (DOCX/PPTX/PNG) rasmni allaqachon o'z ichiga
    // olgan. Ko'ruvchi uchun `data:` URL larni alohida aktivga chiqaramiz,
    // shunda JSONB va HTML kichik qoladi.
    const extracted = extractAssets(job.id, scrubDoc(job, file.doc ?? null), file.html);

    /*
     * Fayl + aktivlar + COMPLETED — bitta tranzaksiyada va FAQAT qulf hali
     * shu claimda bo'lsa (C26). Ega bo'lmasak hech narsa yozilmaydi va
     * hech narsa O'CHIRILMAYDI: ilgarigi «yozib, keyin tozalash» yangi
     * egasining tayyor faylini va aktivlarini yo'q qilardi.
     */
    const won = await commitJobResult(
      job.id,
      job.lease,
      { bytes: file.bytes, mime: file.mime, fileName: file.fileName },
      extracted.assets,
      {
        html: extracted.html,
        doc: extracted.doc,
        fileName: file.fileName,
        preview: buildPreview(extracted.doc),
        delivered: file.delivered,
      },
    );
    if (!won) {
      // Qulf boshqada (ish qayta navbatga tushgan, muddat o'tib FAILED
      // bo'lgan yoki bekor qilingan) — natija tashlandi, hech narsa yozilmadi.
      log("warn", `[worker] job ${job.id}: qulf yo'qolgan (claim ${job.lease}), natija tashlandi`, {
        jobId: job.id,
        attempt: job.attempts,
      });
    } else {
      log("info", "[worker] ish tayyor", {
        jobId: job.id,
        attempt: job.attempts,
        durationMs: Date.now() - startedAt,
        bytes: file.bytes.byteLength,
        delivered: file.delivered,
      });
    }
    if (won && file.delivered && file.delivered.got < file.delivered.want) {
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
        log("warn", `[worker] job ${job.id}: kam yetkazildi ${label} — narxda ulushi yo'q, pul qaytarilmadi`, {
          jobId: job.id,
          delivered: file.delivered,
        });
      } else {
        const ok = await refundPartial(job.userId, job.id, ratio, `${label} yaratildi — farq qaytarildi`);
        log("warn", `[worker] job ${job.id}: qisman yetkazildi ${label}, ulush=${ratio.toFixed(3)}, qaytarish=${ok}`, {
          jobId: job.id,
          ratio,
          refunded: ok,
          delivered: file.delivered,
        });
      }
    }
  } catch (e) {
    /*
     * Foydalanuvchiga — faqat qisqa o'zbekcha matn (BEA-09, EXT-12): pg/
     * provayder/kutubxona matni `generations.error` va refund izohiga
     * tushmaydi. Xom tafsilot (stack, provayder, bosqich, urinish) —
     * jurnalda, ish id si bilan (OBS-03, OBS-08).
     */
    const message = userMessage(e);
    log("error", `[worker] job ${job.id} failed`, {
      jobId: job.id,
      userId: job.userId,
      toolId: job.toolId,
      attempt: job.attempts,
      stage: ctl.stage,
      provider: providerOf(e),
      durationMs: Date.now() - startedAt,
      userError: message,
      err: e,
    });
    // Tashlab ketilgan yurishda `failJob` qulf to'sig'idan o'tmaydi — pul
    // ikkinchi marta qaytmaydi, yangi egasining fayliga tegilmaydi.
    await failAndCleanup(job, job.lease, message);
  }
}

/**
 * Foydalanuvchiga qaytadigan `doc` dan provayderning xom xato matnini olib
 * tashlaydi (EXT-12): `slideImages.blockReason` rasm provayderi javobidan
 * keladi (Google hisob/kalit holati, ba'zan kalitning o'zi) va
 * `GET /api/generations/[id]` bilan klientga borardi. Tafsilot jurnalda qoladi.
 */
function scrubDoc<T>(job: Pick<ClaimedJob, "id">, doc: T): T {
  const images = (doc as { slideImages?: { blockReason?: unknown } } | null)?.slideImages;
  if (images && typeof images.blockReason === "string" && images.blockReason) {
    log("warn", `[worker] job ${job.id}: rasm provayderi so'rovlarni rad etdi`, { jobId: job.id, blockReason: images.blockReason });
    images.blockReason = "Rasm provayderi so'rovni rad etdi";
  }
  return doc;
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
  // Ikkinchi to'siq: chaqiruvchi xom matn uzatsa ham foydalanuvchiga (xato
  // ustuni, refund izohi) faqat xavfsiz o'zbekcha matn yetadi (BEA-09).
  const safe = userMessage(message);
  if (!(await failJob(job.id, workerId, safe))) {
    log("warn", `[worker] job ${job.id}: qulf boshqada — FAILED yozilmadi, pul qaytarilmadi`, { jobId: job.id, lease: workerId });
    return;
  }
  await refundThenCleanup(job, cleanText(safeSlice(`Xatolik: ${safe}`, 200)));
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
    const refunded = await refund(job.userId, job.id, note);
    // `false` — allaqachon qaytarilgan yoki yechilmagan (bepul ish): ikkalasi ham normal.
    log("info", `[worker] job ${job.id}: pul qaytarildi`, { jobId: job.id, userId: job.userId, refunded });
  } catch (e) {
    // `alert` — egasining ogohlantirish skripti shu qat'iy belgi bo'yicha qidiradi (OBS-05);
    // `refundUnrefundedFailed` (housekeeping) keyinroq qayta urinadi.
    log("error", `[worker] job ${job.id}: pul qaytarilmadi`, { jobId: job.id, userId: job.userId, alert: "REFUND_FAILED", err: e });
    throw e;
  } finally {
    await Promise.all([
      deleteGenerationFile(job.id, job.userId).catch((e) => {
        log("warn", `[worker] job ${job.id}: FAILED ish fayli o'chirilmadi`, { jobId: job.id, err: e });
      }),
      deleteAssets(job.id).catch((e) => {
        log("warn", `[worker] job ${job.id}: FAILED ish aktivlari o'chirilmadi`, { jobId: job.id, err: e });
      }),
    ]);
  }
}

/**
 * Navbatdan keyingi ishni oladi — har claim o'z to'siq tokeni bilan
 * (`newLease`, C26). To'xtatilgan worker yangi ish olmaydi (C14).
 */
export async function claimNext(): Promise<ClaimedJob | null> {
  if (stopped) return null;
  return claimJob(newLease(WORKER_ID));
}

async function tick(): Promise<boolean> {
  if (running >= env.worker.concurrency) return true;
  const job = await claimNext();
  if (!job) return false;
  if (stopped) {
    // SIGTERM claim so'rovi yo'lda bo'lganda keldi — ishni boshlamaymiz,
    // darhol navbatga qaytaramiz (aks holda u `shutdownWorker` ro'yxatidan
    // tashqarida qolib, o'lik qulf bilan kutardi).
    const ids = await releaseJobs([job.lease]);
    log("warn", "[worker] to'xtatilmoqda: olingan ish darhol navbatga qaytarildi", { jobId: job.id, released: ids });
    return false;
  }

  running++;
  void runJob(job)
    .catch((e) => log("error", "[worker] unexpected", { jobId: job.id, attempt: job.attempts, err: e }))
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
    log("error", `[worker] housekeeping/${name}`, { step: name, err: e });
  }
}

export async function housekeeping(): Promise<void> {
  await step("reclaim", async () => {
    const dead = await reclaimStaleJobs();
    if (dead.length) log("warn", "[worker] osilib qolgan ishlar yakuniy FAILED (Ish vaqti tugadi)", { jobIds: dead });
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
  /*
   * To'lov webhook izi (W3 wrap-up): 365 kundan eskisi, 6 soatda bir marta,
   * ALOHIDA qadam — yiqilsa ham qolgan tozalashlar ishlaydi. Belgi skanerdan
   * OLDIN qo'yiladi (saqlash qadami naqshi): yiqilayotgan DELETE har
   * daqiqada qayta urmasin.
   */
  await step("payment-events", async () => {
    if (Date.now() - lastPaymentEventsPurgeAt < RETENTION_EVERY_MS) return;
    lastPaymentEventsPurgeAt = Date.now();
    const n = await purgePaymentEvents(PAYMENT_EVENTS_RETENTION_DAYS);
    if (n) log("info", "[worker] payment_events tozalandi", { deleted: n, retentionDays: PAYMENT_EVENTS_RETENTION_DAYS });
  });
  await step("sessions", () => purgeExpiredSessions());
  /*
   * O'YIN havolalari (AUDIT-22 R, `game_sessions.expires_at`, standart
   * 30 kun) — `purgeOldSources`/`purgeOldPhotos` bilan bir qatorda.
   * Faqat NATIJASIZ muddati o'tgan havolalar o'chiriladi (W3-G, BEA-08):
   * natijasi bor sessiya qoladi — token `expires_at` bo'yicha ishlamay
   * qoladi, o'quvchilar natijalari (`game_results`) esa o'qituvchi uchun
   * generatsiya o'chirilguncha saqlanadi (FK `ON DELETE CASCADE` faqat
   * generatsiya/sessiya o'chganda ishlaydi).
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

/**
 * Housekeeping advisory qulfi (SCALE-16). Migratsiya qulfi (`db.ts`,
 * 727_000_001) bilan bir oilada, boshqa raqam.
 */
export const HOUSEKEEPING_LOCK_ID = 727_000_002;

/** Qulfni ushlab turgan alohida ulanish (shu process yetakchi bo'lsa). */
let hkLeader: Client | null = null;
/** Shu process ichida ikkita tick bir-birining ustiga tushmasin. */
let hkBusy = false;

export type HousekeepingTickOptions = {
  /** Test seam: `housekeeping` o'rniga. */
  run?: () => Promise<void>;
  /** Test seam: qulf ulanishini ochish (standart — `poolConfig()` bilan yangi `Client`). */
  connect?: () => Promise<Client>;
};

async function openLockClient(): Promise<Client> {
  const c = new Client(poolConfig());
  // Uzilgan ulanish xatosi processni yiqitmasin — keyingi tick qayta ulanadi.
  c.on("error", (err) => {
    log("warn", "[worker] housekeeping qulf ulanishi uzildi", { err });
  });
  await c.connect();
  return c;
}

/** Qulf HALI shu sessiyadami (ulanish uzilgan bo'lsa — `false`). */
async function stillLeader(c: Client): Promise<boolean> {
  try {
    const r = await c.query(
      `SELECT 1 FROM pg_locks
        WHERE locktype = 'advisory' AND pid = pg_backend_pid() AND classid = 0 AND objid = $1 AND granted`,
      [HOUSEKEEPING_LOCK_ID],
    );
    return r.rows.length > 0;
  } catch {
    return false;
  }
}

/**
 * Housekeeping'ni BITTA process yuritadi (SCALE-16).
 *
 * Ilgari har worker replikasi har 60 s da hamma tozalashni o'zi qilardi —
 * 2 replika = daqiqasiga ikki marta, parallel. Endi Postgres advisory
 * qulfi (`pg_try_advisory_lock`, pooldan TASHQARI alohida ulanishda):
 *   - band bo'lsa — shu daqiqa o'tkazib yuboriladi (`false`);
 *   - olgan process uni USHLAB turadi (yetakchi) — har tickda faqat u
 *     yuritadi, ya'ni daqiqasiga aynan bir marta;
 *   - yetakchi o'lsa yoki ulanishi uzilsa sessiya qulfi Postgres tomonida
 *     bo'shaydi, keyingi tickda boshqa process (yoki o'zi qayta) oladi.
 * HECH QACHON xato tashlamaydi — sikl to'xtamasin (baza yo'q bo'lsa `false`).
 */
export async function housekeepingTick(opts: HousekeepingTickOptions = {}): Promise<boolean> {
  if (hkBusy) return false;
  hkBusy = true;
  try {
    if (hkLeader && !(await stillLeader(hkLeader))) {
      log("warn", "[worker] housekeeping qulfi yo'qoldi (ulanish uzilgan) — qayta olinadi");
      await dropLeader();
    }
    if (!hkLeader) {
      const c = await (opts.connect ?? openLockClient)();
      let got = false;
      try {
        const r = await c.query<{ ok: boolean }>("SELECT pg_try_advisory_lock($1) AS ok", [HOUSEKEEPING_LOCK_ID]);
        got = r.rows[0]?.ok === true;
      } finally {
        if (!got) await c.end().catch(() => undefined);
      }
      if (!got) return false;
      hkLeader = c;
      log("info", "[worker] housekeeping yetakchisi — shu process", { workerId: WORKER_ID });
    }
    await (opts.run ?? housekeeping)();
    return true;
  } catch (e) {
    log("error", "[worker] housekeeping qulfi olinmadi", { err: e });
    return false;
  } finally {
    hkBusy = false;
  }
}

async function dropLeader(): Promise<void> {
  const c = hkLeader;
  hkLeader = null;
  // Ulanish yopilsa sessiya qulfi Postgres tomonida o'zi bo'shaydi.
  await c?.end().catch((e) => log("warn", "[worker] housekeeping qulf ulanishi yopilmadi", { err: e }));
}

/** Qulfni qo'yib yuboradi (to'xtashda va testlarda). */
export async function releaseHousekeepingLock(): Promise<void> {
  await dropLeader();
}

async function loop(): Promise<void> {
  await ensureMigrated();
  log("info", `[worker] ${WORKER_ID} ishga tushdi (concurrency=${env.worker.concurrency})`, {
    workerId: WORKER_ID,
    concurrency: env.worker.concurrency,
  });
  let sinceHousekeeping = 0;

  while (!stopped) {
    let busy = false;
    let healthy = true;
    try {
      busy = await tick();
    } catch (e) {
      healthy = false;
      log("error", "[worker] tick", { err: e });
      // Baza tushgan bo'lishi mumkin — tez-tez urinmaymiz.
      await sleep(5000);
    }
    // Faqat sog'lom iteratsiyada — baza yiqilsa fayl eskiradi (HEALTHCHECK).
    if (healthy) await touchAlive();
    const wait = busy ? BUSY_POLL_MS : IDLE_POLL_MS;
    sinceHousekeeping += wait;
    if (sinceHousekeeping >= HOUSEKEEPING_MS) {
      sinceHousekeeping = 0;
      // Faqat advisory qulf egasi (bitta process) tozalaydi — SCALE-16.
      await housekeepingTick();
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
  // So'rov kontekstidan tashqarida: sikl `POST /api/generations` ichidan uyg'onsa ham uning reqId si meros qolmasin.
  void withFreshLogContext({}, () => loop()).catch((e) => log("error", "[worker] fatal", { err: e }));
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
    log("error", "[worker] unhandledRejection (process davom etadi)", { err: reason });
  });
  proc.on("uncaughtException", (err: Error) => {
    log("error", "[worker] uncaughtException — process to'xtaydi", { err });
    proc.exit(1);
  });
}

let shuttingDown: Promise<string[]> | null = null;

/**
 * Yumshoq to'xtash (SIGTERM/SIGINT — har deploy; C14: INFRA-02, CONC-03,
 * DB-05, INFRA-08).
 *
 * Ilgari: `stopWorker()` va 2 s dan keyin `process.exit` — bajarilayotgan
 * ishlar o'lik qulf bilan `IN_PROGRESS` qolib, 2–12.5 daqiqa kutardi, keyin
 * boshidan qayta bajarilardi (provayderga ikki marta pul). Endi:
 *   1. yangi ish olinmaydi (`stopped`);
 *   2. bajarilayotganlar `graceMs` gacha kutiladi — tugaganlari odatdagidek
 *      COMPLETED/FAILED bo'ladi;
 *   3. qolganlari DARHOL navbatga qaytariladi (`releaseJobs`: faqat shu
 *      claimlar, urinish sanalmaydi, qulf bo'sh) — keyingi worker shu
 *      zahoti oladi. Ularning yetim yurishi endi hech narsa yoza olmaydi
 *      (`ctl.abandoned` + qulf to'sig'i).
 * Qayta chaqiruv (ikkinchi signal) o'sha jarayonni qaytaradi.
 * Qaytaradi: navbatga qaytarilgan ishlar id si.
 */
export function shutdownWorker(opts: { graceMs?: number } = {}): Promise<string[]> {
  shuttingDown ??= drainAndRelease(Math.max(0, opts.graceMs ?? SHUTDOWN_GRACE_MS));
  return shuttingDown;
}

async function drainAndRelease(graceMs: number): Promise<string[]> {
  stopWorker();
  const pending = [...inflight.values()].map((e) =>
    e.done.catch((err) => {
      // Kutish to'xtamasin — lekin jim ham qolmasin (OBS-06).
      log("warn", "[worker] to'xtatilmoqda: ish xato bilan tugadi", { jobId: e.job.id, err });
    }),
  );
  if (pending.length) {
    log("info", `[worker] to'xtatilmoqda: ${pending.length} ta ish tugashi kutilmoqda (≤ ${Math.round(graceMs / 1000)} s)`, {
      jobIds: [...inflight.values()].map((e) => e.job.id),
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      Promise.all(pending),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, graceMs);
      }),
    ]);
    clearTimeout(timer);
  }
  const left = [...inflight.values()];
  if (!left.length) {
    log("info", "[worker] to'xtatilmoqda: bajarilayotgan ish qolmadi");
    return [];
  }
  for (const e of left) e.ctl.abandoned = true;
  const ids = await releaseJobs(left.map((e) => e.job.lease));
  log(
    "warn",
    `[worker] to'xtatilmoqda: ${ids.length} ta tugallanmagan ish navbatga qaytarildi (urinish sanalmadi, boshqa worker darhol oladi): ${ids.join(", ")}`,
    { jobIds: ids, stages: left.map((e) => ({ jobId: e.job.id, attempt: e.job.attempts, stage: e.ctl.stage })) },
  );
  return ids;
}

/** Alohida process uchun kirish nuqtasi (`npm run worker`). */
export async function runWorkerProcess(): Promise<void> {
  const shutdown = (signal: NodeJS.Signals) => {
    log("info", `[worker] ${signal}: to'xtatilmoqda...`);
    void shutdownWorker()
      .catch((e) => {
        // Qaytarish yiqilsa (baza yo'q) — ishlar `reclaimStaleJobs` bilan keyinroq tiklanadi.
        log("error", "[worker] to'xtatishda ishlar navbatga qaytarilmadi", { err: e });
      })
      .finally(() => process.exit(0));
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  await loop();
}
