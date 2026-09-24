import "server-only";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { reviveError, runParseTask, type ParseResultOf, type ParseTask, type SerializedError } from "./parse-tasks";

/**
 * Foydalanuvchi faylini tahlil qilish — web jarayonining event loop'idan
 * TASHQARIDA (CONC-09, SECB-01/02/04 himoyasining oxirgi qatlami).
 *
 * Nega thread: `unpdf` ning pdf.js «soxta worker»i faqat microtask orqali
 * «bo'shatadi», JSZip/regex esa sinxron — ya'ni bitta PDF yoki g'alati XML
 * butun saytni (sessiya, polling, to'lov webhook'lari) o'nlab soniya to'xtatib
 * qo'yardi (AUDIT R2: 841 KB PDF = 28 s). Bir thread ichidagi `Promise.race`
 * yoki `loadingTask.destroy()` sinxron zanjirni TO'XTATA OLMAYDI — faqat
 * `worker.terminate()`. Shuning uchun har vazifa alohida `worker_threads`
 * workerida: devor soati bo'yicha timeout (keyin `terminate`), old-gen
 * xotira chegarasi (`resourceLimits`) va kichik navbat (N ta yuklash N ta
 * thread ochmasin). Oshib ketsa — toza 422/503, jarayon yiqilmaydi.
 *
 * Worker fayli qayerdan:
 *   1. `PARSE_WORKER_ENTRY` (aniq yo'l) yoki `<cwd>/parse-worker.mjs` —
 *      prod: esbuild bilan yig'ilgan o'zini-o'zi ta'minlaydigan to'plam
 *      (Next standalone to'plamida TS manba ham, tsx ham yo'q);
 *   2. `<cwd>/lib/server/parse-worker.ts` + `tsx` — dev (`next dev`) va testlar;
 *   3. hech biri yo'q — in-process zaxira (xuddi shu navbat chegarasi bilan,
 *      `[parse] FALLBACK in-process` ogohlantirishi daqiqasiga ko'pi bilan bir marta): parser
 *      darajasidagi chegaralar (chiziqli skanerlar, sahifa/zip byudjeti)
 *      baribir ishlaydi, faqat thread izolyatsiyasi bo'lmaydi.
 */

/** Bitta faylni tahlil qilish uchun devor soati chegarasi. */
export const PARSE_TIMEOUT_MS = 15_000;
/** Bir vaqtda ishlaydigan threadlar. */
export const PARSE_MAX_RUNNING = 2;
/** Navbatda kutadigan vazifalar; undan ortig'i darrov 503. */
export const PARSE_MAX_QUEUE = 8;
/** Thread old-gen heap chegarasi (MB): 20 MB fayl + 80 MB XML byudjeti + nusxalar. */
export const PARSE_MAX_OLD_MB = 512;

export type ParsePoolErrorCode = "timeout" | "busy" | "failed";

export class ParsePoolError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: ParsePoolErrorCode,
  ) {
    super(message);
    this.name = "ParsePoolError";
  }
}

const TIMEOUT_MSG = "Faylni o'qish juda uzoq davom etdi — fayl juda katta yoki murakkab. Uni bo'lib yuboring.";
const FAILED_MSG = "Faylni o'qib bo'lmadi — u juda katta, murakkab yoki buzilgan.";
const BUSY_MSG = "Server hozir band — bir daqiqadan so'ng qayta urinib ko'ring.";

export type ParseWorkerEntry = { file: string; execArgv: string[] };

export function resolveParseWorkerEntry(
  cwd: string = process.cwd(),
  env: Record<string, string | undefined> = process.env,
): ParseWorkerEntry | null {
  const explicit = env.PARSE_WORKER_ENTRY?.trim();
  if (explicit) return existsSync(explicit) ? { file: explicit, execArgv: [] } : null;
  const bundled = join(cwd, "parse-worker.mjs");
  if (existsSync(bundled)) return { file: bundled, execArgv: [] };
  const source = join(cwd, "lib", "server", "parse-worker.ts");
  if (existsSync(source) && existsSync(join(cwd, "node_modules", "tsx"))) {
    return { file: source, execArgv: ["--conditions=react-server", "--import", "tsx"] };
  }
  return null;
}

type WorkerReply = { ok: true; result: unknown } | { ok: false; error: SerializedError };

/** Bitta vazifa — bitta thread; natija, xato, timeout yoki xotira — thread doim to'xtatiladi. */
function runInThread(entry: ParseWorkerEntry, task: ParseTask, timeoutMs: number, maxOldMb: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(entry.file, { execArgv: entry.execArgv, resourceLimits: { maxOldGenerationSizeMb: maxOldMb } });
    } catch (e) {
      console.warn("[parse] worker ochilmadi", e instanceof Error ? e.message : e);
      reject(new ParsePoolError(FAILED_MSG, 422, "failed"));
      return;
    }
    let settled = false;
    const finish = (settle: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate().catch((e: unknown) => console.warn("[parse] worker to'xtatilmadi", e));
      settle();
    };
    const timer = setTimeout(() => {
      console.warn(`[parse] ${task.kind}: ${timeoutMs} ms dan oshdi — thread to'xtatildi`);
      finish(() => reject(new ParsePoolError(TIMEOUT_MSG, 422, "timeout")));
    }, timeoutMs);
    worker.on("message", (msg: WorkerReply) =>
      finish(() => (msg?.ok ? resolve(msg.result) : reject(reviveError(msg?.error ?? { name: "Error", message: FAILED_MSG })))),
    );
    // `error` tinglovchisi DOIM turadi: aks holda thread xatosi asosiy jarayonni yiqitardi.
    worker.on("error", (e: Error) =>
      finish(() => {
        console.warn(`[parse] ${task.kind}: worker xatosi`, (e as { code?: string }).code ?? "", e.message);
        reject(new ParsePoolError(FAILED_MSG, 422, "failed"));
      }),
    );
    worker.on("exit", (code) =>
      finish(() => {
        console.warn(`[parse] ${task.kind}: worker javobsiz tugadi (${code})`);
        reject(new ParsePoolError(FAILED_MSG, 422, "failed"));
      }),
    );
    worker.postMessage({ task });
  });
}

export type ParsePoolOptions = {
  entry: ParseWorkerEntry | null;
  timeoutMs?: number;
  maxRunning?: number;
  maxQueue?: number;
  maxOldMb?: number;
  /** In-process zaxira bajaruvchisi (standart `runParseTask`; testda sekin soxta vazifa). */
  runLocal?: (task: ParseTask) => Promise<unknown>;
  /** Zaxira ogohlantirishlari orasidagi eng kam oraliq (ms). */
  fallbackLogMs?: number;
};

/** Zaxira ishlatilganda ogohlantirish har necha ms da bir marta (jurnal to'lib ketmasin). */
export const PARSE_FALLBACK_LOG_MS = 60_000;

export function createParsePool(opts: ParsePoolOptions) {
  const timeoutMs = opts.timeoutMs ?? PARSE_TIMEOUT_MS;
  const maxRunning = opts.maxRunning ?? PARSE_MAX_RUNNING;
  const maxQueue = opts.maxQueue ?? PARSE_MAX_QUEUE;
  const maxOldMb = opts.maxOldMb ?? PARSE_MAX_OLD_MB;
  const runLocal = opts.runLocal ?? runParseTask;
  const fallbackLogMs = opts.fallbackLogMs ?? PARSE_FALLBACK_LOG_MS;
  let running = 0;
  const queue: Array<() => void> = [];
  let fallbackRuns = 0;
  let lastFallbackLog = -Infinity;

  /*
   * Worker fayli yo'q (prod imijida `parse-worker.mjs` yig'ilmagan) — tahlil
   * web jarayonining O'ZIDA. Bu jim bo'lmasligi kerak: birinchi qator jurnalda
   * yo'qolib ketmasin deb har ishlatilishda, lekin `fallbackLogMs` da ko'pi
   * bilan bir marta, jami son bilan ogohlantiriladi (W1-D review R3).
   */
  const inProcess = (task: ParseTask): Promise<unknown> => {
    fallbackRuns++;
    const now = Date.now();
    if (now - lastFallbackLog >= fallbackLogMs) {
      lastFallbackLog = now;
      console.warn(
        `[parse] FALLBACK in-process: worker fayli yo'q — ${fallbackRuns} ta tahlil web jarayonida (oxirgisi: ${task.kind}). ` +
          "Imijda parse-worker.mjs yig'ilishi kerak (PARSE_WORKER_ENTRY).",
      );
    }
    return runLocal(task);
  };

  const release = () => {
    running--;
    const next = queue.shift();
    if (next) {
      running++;
      next();
    }
  };

  function run<T extends ParseTask>(task: T): Promise<ParseResultOf<T>> {
    const entry = opts.entry;
    // Zaxira ham xuddi shu navbat chegarasi ostida: N ta yuklash event loop'ga N ta tahlil yig'masin.
    const execute = (): Promise<unknown> => (entry ? runInThread(entry, task, timeoutMs, maxOldMb) : inProcess(task));
    return new Promise<ParseResultOf<T>>((resolve, reject) => {
      // Slot natija chaqiruvchiga yetishidan OLDIN bo'shatiladi.
      const start = () =>
        execute().then(
          (value) => {
            release();
            resolve(value as ParseResultOf<T>);
          },
          (e: unknown) => {
            release();
            reject(e);
          },
        );
      if (running < maxRunning) {
        running++;
        start();
      } else if (queue.length < maxQueue) {
        queue.push(start);
      } else {
        reject(new ParsePoolError(BUSY_MSG, 503, "busy"));
      }
    });
  }

  return { run, stats: () => ({ running, queued: queue.length }) };
}

let shared: ReturnType<typeof createParsePool> | null = null;

/** Web jarayonining umumiy hovuzi — upload route'lari shu orqali tahlil qiladi. */
export function parseInWorker<T extends ParseTask>(task: T): Promise<ParseResultOf<T>> {
  // Worker fayli yo'q bo'lsa hovuz in-process zaxiraga o'tadi va buni o'zi jurnalga yozadi.
  shared ??= createParsePool({ entry: resolveParseWorkerEntry() });
  return shared.run(task);
}
