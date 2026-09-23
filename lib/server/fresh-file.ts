import "server-only";
import { limit } from "./api";
import { getVersions } from "./jobs";
import { ensureFreshFile } from "./slide-commit";

/**
 * `GET …/file` dagi qayta yasash (C07: CONC-08, SCALE-04).
 *
 * `ensureFreshFile` eskirgan PPTX/DOCX ni web jarayonida qayta chizadi.
 * Ilgari bu yo'lda limit yo'q edi (`POST …/rebuild` ning 30/soat limitini
 * aylanib o'tish mumkin edi), va bitta eskirgan faylga N ta parallel
 * yuklab olish N ta to'liq render boshlardi — advisory lock faqat YOZUVNI
 * ketma-ket qo'yadi, CPU esa allaqachon sarflangan bo'ladi.
 *
 * Endi:
 *   - bir hujjatga parallel so'rovlar BITTA renderni kutadi (jarayon
 *     ichida single-flight);
 *   - render foydalanuvchi bo'yicha chegaralanadi (`filerender:<user>`,
 *     30/soat), faqat haqiqatan render kerak bo'lganda — yangi faylni
 *     yuklab olish limit sarflamaydi. Limit tugasa 429: eskirgan fayl
 *     HECH QACHON berilmaydi («ko'rdim = oldim»).
 */

const RENDER_LIMIT = 30;
const RENDER_WINDOW_SEC = 3600;

export type FreshFileDeps = {
  versions?: (id: string, userId: string) => Promise<{ docVersion: number; fileVersion: number; status: string } | null>;
  ensure?: (id: string, userId: string) => Promise<void>;
  limitFn?: (userId: string) => Promise<void>;
};

type Globals = typeof globalThis & { __slaydxFreshInflight?: Map<string, Promise<void>> };
const g = globalThis as Globals;

function inflight(): Map<string, Promise<void>> {
  g.__slaydxFreshInflight ??= new Map();
  return g.__slaydxFreshInflight;
}

export async function ensureFreshFileShared(id: string, userId: string, deps: FreshFileDeps = {}): Promise<void> {
  const versions = deps.versions ?? getVersions;
  const ensure = deps.ensure ?? ((gid: string, uid: string) => ensureFreshFile(gid, uid));
  const limitFn = deps.limitFn ?? ((uid: string) => limit(`filerender:${uid}`, RENDER_LIMIT, RENDER_WINDOW_SEC));
  const map = inflight();
  const key = `${userId}:${id}`;

  /*
   * Ikki aylanish: boshqa so'rovning renderini kutgandan keyin versiya
   * QAYTA tekshiriladi — u render boshlanganidan keyin kelgan tahrirni
   * qamramagan bo'lishi mumkin.
   */
  for (let round = 0; round < 2; round++) {
    const running = map.get(key);
    if (running) {
      await running;
      continue;
    }
    const v = await versions(id, userId);
    // Yo'q/begona — 404 ni fayl yo'lining o'zi beradi; tayyor emas yoki yangi — ish yo'q.
    if (!v || v.status !== "COMPLETED" || v.fileVersion >= v.docVersion) return;
    const started = map.get(key);
    if (started) {
      await started;
      continue;
    }
    const job = (async () => {
      await limitFn(userId);
      await ensure(id, userId);
    })().finally(() => map.delete(key));
    map.set(key, job);
    await job;
    return;
  }
}
