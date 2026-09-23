import "server-only";
import { spawn } from "node:child_process";
import { env } from "./env";

/**
 * LibreOffice (`soffice`) uchun JARAYON BO'YICHA YAGONA darvoza (C07:
 * FILE-03, CONC-01, BEA-20, SCALE-07) va jarayonlar guruhini o'ldiruvchi
 * ishga tushirgich (FILE-06).
 *
 * Nega: LibreOffice faqat web konteynerida bor va har o'girish alohida
 * `soffice` (~150–400 MB, bitta yadro, 2–90 s). Ilgari faqat eskizlarda
 * 2 slotli cheklov bor edi, `?format=pdf` va shablon rasterlash esa
 * cheksiz edi — 40 ta parallel so'rov 40 ta `soffice` degani, umumiy
 * VPS da OOM. Endi `toPdf` ning O'ZI shu darvozadan o'tadi, ya'ni
 * yuklab olish, eskiz, shablon — hammasi bitta hovuzni bo'lishadi.
 *
 * Slot band bo'lsa so'rov chegaralangan vaqt kutadi (`WAIT_MS`); undan
 * keyin, yoki navbat to'la bo'lsa darhol — `SofficeBusyError` (503 +
 * `Retry-After`). Cheksiz kutish nginx 504 dan keyin ham ish qoldirardi.
 */

/** Kutish chegarasi — nginx `proxy_read_timeout` (60/120 s) dan ancha kam. */
const WAIT_MS = 20_000;
/** Navbatdagi kutuvchilar chegarasi — undan ortig'i darhol 503. */
const MAX_WAITERS = 20;
/** Klientga tavsiya: shuncha soniyadan keyin qayta urinsin. */
const RETRY_AFTER_SEC = 15;

export const SOFFICE_BUSY_MESSAGE = "PDF tayyorlash navbati band — birozdan keyin qayta urinib ko'ring";

export class SofficeBusyError extends Error {
  constructor(readonly retryAfterSec: number) {
    super(SOFFICE_BUSY_MESSAGE);
    this.name = "SofficeBusyError";
  }
}

export type GateOptions = {
  /** Bir vaqtda nechta ish. */
  max: number;
  /** Navbatda eng ko'p kutish (ms). */
  waitMs: number;
  /** Navbat uzunligi chegarasi. */
  maxWaiters: number;
  retryAfterSec: number;
};

type Waiter = { resolve: () => void; timer: ReturnType<typeof setTimeout> };

/**
 * Chegaralangan kutishli semafor. Slot bo'shaganda u navbatdagi birinchi
 * kutuvchiga TO'G'RIDAN-TO'G'RI beriladi (`active` kamaymaydi) — shu
 * bilan yangi kelgan so'rov navbatni «sakrab» o'ta olmaydi.
 */
export class Gate {
  private active = 0;
  private readonly waiters: Waiter[] = [];

  constructor(private readonly opts: GateOptions) {}

  stats(): { active: number; waiting: number } {
    return { active: this.active, waiting: this.waiters.length };
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.opts.max && this.waiters.length === 0) {
      this.active += 1;
      return Promise.resolve();
    }
    if (this.waiters.length >= this.opts.maxWaiters) {
      return Promise.reject(new SofficeBusyError(this.opts.retryAfterSec));
    }
    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = {
        resolve,
        timer: setTimeout(() => {
          const i = this.waiters.indexOf(waiter);
          if (i >= 0) this.waiters.splice(i, 1);
          reject(new SofficeBusyError(this.opts.retryAfterSec));
        }, this.opts.waitMs),
      };
      this.waiters.push(waiter);
    });
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) {
      clearTimeout(next.timer);
      next.resolve();
      return;
    }
    this.active -= 1;
  }
}

/*
 * `globalThis` da: Next route'lari modulni alohida bo'laklarga yig'sa
 * ham (va dev HMR da) hovuz BITTA bo'lib qolsin — aks holda har nusxa
 * o'z slotlarini sanab, chegara ko'payib ketardi.
 */
type Globals = typeof globalThis & { __slaydxSofficeGate?: Gate };
const g = globalThis as Globals;

/** Web jarayonidagi umumiy `soffice` darvozasi (`PDF_MAX_CONCURRENCY`, standart 2). */
export function sofficeGate(): Gate {
  if (!g.__slaydxSofficeGate) {
    g.__slaydxSofficeGate = new Gate({
      max: Math.max(1, env.pdf.maxConcurrency),
      waitMs: WAIT_MS,
      maxWaiters: MAX_WAITERS,
      retryAfterSec: RETRY_AFTER_SEC,
    });
  }
  return g.__slaydxSofficeGate;
}

/** `SofficeBusyError` → 503 + `Retry-After` (W2 shartnomasi: `{ error }` o'zbekcha). */
export function busyResponse(e: SofficeBusyError): Response {
  return Response.json(
    { error: e.message, code: "pdf_busy", retryAfterSec: e.retryAfterSec },
    { status: 503, headers: { "Retry-After": String(e.retryAfterSec), "Cache-Control": "no-store" } },
  );
}

/** Guruh butunlay yo'qolishini kutish chegarasi (zombi qolsa ham osilib qolmaymiz). */
const GROUP_EXIT_WAIT_MS = 3000;

function groupAlive(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (e) {
    // EPERM — guruh bor, lekin boshqa foydalanuvchiniki (bo'lmasligi kerak).
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

function killGroup(pgid: number): void {
  try {
    process.kill(-pgid, "SIGKILL");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ESRCH") {
      console.warn("[soffice] guruhni o'ldirib bo'lmadi:", (e as Error).message);
    }
  }
}

/**
 * Guruhdan hech kim qolmaguncha kutadi (launcher chiqib ketgan, lekin
 * `soffice.bin` qolgan bo'lsa — uni o'ldiradi).
 *
 * Konteynerda PID 1 = node (init yo'q) bo'lsa, o'ldirilgan nevara zombi
 * bo'lib qolishi mumkin — u xotira egallamaydi, lekin guruh «tirik»
 * ko'rinadi. Shuning uchun kutish chegaralangan.
 */
async function reapGroup(pgid: number): Promise<void> {
  if (!groupAlive(pgid)) return;
  killGroup(pgid);
  const until = Date.now() + GROUP_EXIT_WAIT_MS;
  while (groupAlive(pgid) && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 25));
  }
  if (groupAlive(pgid)) console.warn(`[soffice] guruh ${pgid} ${GROUP_EXIT_WAIT_MS} ms da yo'qolmadi (zombi?)`);
}

/**
 * Buyruqni YANGI jarayonlar guruhida ishga tushiradi (`detached: true`).
 *
 * `execFile` ning `timeout` i faqat bevosita bolaga SIGTERM yuboradi;
 * `soffice` launcher'i esa haqiqiy `soffice.bin` ni alohida jarayon qilib
 * ochadi va u yetim bo'lib ~300 MB bilan ishlashda davom etardi (FILE-06).
 * Bu yerda vaqt tugasa `kill(-pgid, SIGKILL)` butun guruhni o'ldiradi va
 * va'da faqat guruh yo'qolgandan KEYIN qaytadi — chaqiruvchi vaqtinchalik
 * papkani shundan keyingina o'chiradi.
 */
export function runGroup(bin: string, args: string[], opts: { timeoutMs: number }): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (err: Error | null) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve();
    };

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(bin, args, { detached: true, stdio: ["ignore", "ignore", "pipe"] });
    } catch (e) {
      finish(e instanceof Error ? e : new Error(String(e)));
      return;
    }

    let stderr = "";
    child.stderr?.on("data", (d: Buffer) => {
      if (stderr.length < 2000) stderr += d.toString("utf8");
    });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid) killGroup(child.pid);
    }, opts.timeoutMs);

    child.on("error", (e) => {
      clearTimeout(timer);
      finish(e);
    });
    // `close` emas, `exit`: `close` stdio'ni ushlab turgan nevara o'lguncha kutadi.
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      const pid = child.pid;
      void (pid ? reapGroup(pid) : Promise.resolve()).then(() => {
        if (timedOut) finish(new Error(`vaqt tugadi (${opts.timeoutMs} ms) — jarayonlar guruhi o'ldirildi`));
        else if (code !== 0) finish(new Error(`chiqish kodi ${code ?? signal}: ${stderr.trim().slice(0, 300)}`));
        else finish(null);
      });
    });
  });
}
