/**
 * Bo'lak (chunk) yuklanmadi → BIR MARTALIK to'liq qayta yuklash (W4-D R1).
 *
 * FE-11 dan keyin har vositaning formasi va har hujjat ko'ruvchisi
 * `React.lazy` bo'lagi. Deploydan keyin ochiq qolgan yorliq ESKI xeshli
 * bo'lakni so'raydi, server esa uni endi bermaydi → xato `app/error.tsx`
 * ga tushadi. `reset()` yordam bermaydi: `React.lazy` rad etilgan promise
 * ni keshlaydi va o'sha xatoni qayta otadi. Yagona yechim — sahifani
 * to'liq qayta yuklash (yangi HTML → yangi bo'lak xeshlari).
 *
 * Sikl bo'lmasligi uchun `sessionStorage` da vaqt belgisi: `WINDOW_MS`
 * ichida ikkinchi marta qayta yuklanmaydi (bo'lak haqiqatan yo'q bo'lsa,
 * foydalanuvchi odatiy xato oynasini ko'radi). Xotira ishlamasa
 * (maxfiy rejim, bloklangan) — umuman qayta yuklamaymiz: himoyasiz
 * qayta yuklash cheksiz siklga olib borishi mumkin.
 */
export const CHUNK_RELOAD_KEY = "slaydx-chunk-reload-at";
const WINDOW_MS = 60_000;

const CHUNK_RE = /Loading chunk|Failed to load chunk|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i;

export function isChunkLoadError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const err = e as { name?: unknown; message?: unknown };
  if (err.name === "ChunkLoadError") return true;
  return typeof err.message === "string" && CHUNK_RE.test(err.message);
}

type StorageLike = { getItem(k: string): string | null; setItem(k: string, v: string): void };

/**
 * Bo'lak xatosi bo'lsa va yaqinda qayta yuklanmagan bo'lsa — belgi qo'yib
 * `reload()` ni chaqiradi va `true` qaytaradi; aks holda `false`.
 */
export function reloadOnceForChunkError(
  e: unknown,
  deps: { storage?: StorageLike | null; now?: number; reload?: () => void } = {},
): boolean {
  if (!isChunkLoadError(e)) return false;
  const now = deps.now ?? Date.now();
  try {
    const storage = deps.storage ?? (typeof window !== "undefined" ? window.sessionStorage : null);
    if (!storage) return false;
    const last = Number(storage.getItem(CHUNK_RELOAD_KEY) ?? 0);
    if (Number.isFinite(last) && last > 0 && now - last < WINDOW_MS) return false;
    storage.setItem(CHUNK_RELOAD_KEY, String(now));
  } catch (err) {
    console.warn("[chunk-reload] sessionStorage ishlamadi — avtomatik qayta yuklash o'chiq", err);
    return false;
  }
  (deps.reload ?? (() => window.location.reload()))();
  return true;
}
