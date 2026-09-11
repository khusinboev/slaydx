/**
 * Manba keshi (Maqola 2) — `source_cache` jadvali (020 migratsiya).
 *
 * Nega: bir mavzuga qayta murojaat (qayta yaratish, «Tuzatish», jonli
 * sinov) OpenAlex kvotasini yemasin — 2026-02 dan OpenAlex kunlik $1
 * bepul limit bilan ishlaydi. Kesh 30 kun (`ttlDays`): manba yozuvlari
 * o'zgarmaydi, qidiruv natijasi esa bir oyda sezilarli yangilanmaydi.
 *
 * Bazasiz muhit (jonli skript, kalitsiz dev) yoki baza xatosi keshni
 * to'xtatmaydi — `fetch` baribir chaqiriladi va natija qaytadi. Kesh
 * TEZLIK/KVOTA uchun, to'g'rilik uchun emas: u yo'q bo'lsa hech narsa
 * buzilmaydi. `null`/`undefined` natija SAQLANMAYDI — o'tkinchi xato
 * (timeout, 5xx) 30 kunga muzlab qolmasin.
 *
 * Testda `setSourceCacheStore` bilan xotira do'koni qo'yiladi; `db.ts`
 * `server-only` bo'lgani uchun u faqat kerak bo'lganda, dinamik import
 * bilan yuklanadi (`lib/generation` izomorf qatlamini iflos qilmaslik).
 */

export type SourceCacheEntry = { payload: unknown; fetchedAt: number };

export type SourceCacheStore = {
  get(key: string): Promise<SourceCacheEntry | null>;
  set(key: string, payload: unknown): Promise<void>;
};

const DAY_MS = 24 * 60 * 60 * 1000;

let override: SourceCacheStore | null | undefined;

/** Test seam: `null` — kesh butunlay o'chiq; `undefined` — standart (baza). */
export function setSourceCacheStore(store: SourceCacheStore | null | undefined): void {
  override = store;
}

/** Xotira do'koni — testlar va bazasiz jonli skript uchun. */
export function memorySourceCache(now: () => number = Date.now): SourceCacheStore & { size: number; map: Map<string, SourceCacheEntry> } {
  const map = new Map<string, SourceCacheEntry>();
  return {
    map,
    get size() {
      return map.size;
    },
    async get(key) {
      return map.get(key) ?? null;
    },
    async set(key, payload) {
      map.set(key, { payload, fetchedAt: now() });
    },
  };
}

let dbStore: SourceCacheStore | null | undefined;

/**
 * Bazaga tayangan do'kon. `DATABASE_URL` bo'lmasa `null` — kesh o'chiq.
 * Har xato jurnalga yoziladi, lekin tashlanmaydi.
 */
async function databaseStore(): Promise<SourceCacheStore | null> {
  if (dbStore !== undefined) return dbStore;
  if (!process.env.DATABASE_URL) {
    dbStore = null;
    return null;
  }
  try {
    const db = await import("../../server/db");
    dbStore = {
      async get(key) {
        const rows = await db.query<{ payload: unknown; fetched_at: string | Date }>(
          "SELECT payload, fetched_at FROM source_cache WHERE key = $1",
          [key],
        );
        const r = rows[0];
        if (!r) return null;
        return { payload: r.payload, fetchedAt: new Date(r.fetched_at).getTime() };
      },
      async set(key, payload) {
        await db.query(
          "INSERT INTO source_cache (key, payload, fetched_at) VALUES ($1, $2::jsonb, now()) ON CONFLICT (key) DO UPDATE SET payload = EXCLUDED.payload, fetched_at = now()",
          [key, JSON.stringify(payload)],
        );
      },
    };
  } catch (e) {
    console.warn("[source-cache] baza do'koni yuklanmadi — keshsiz davom:", e instanceof Error ? e.message : e);
    dbStore = null;
  }
  return dbStore;
}

async function store(): Promise<SourceCacheStore | null> {
  if (override !== undefined) return override;
  return databaseStore();
}

/**
 * `key` bo'yicha keshdan o'qiydi; yo'q yoki eskirgan (`ttlDays`) bo'lsa
 * `fetch` chaqiriladi va natija (agar `null`/`undefined` bo'lmasa) yoziladi.
 */
export async function cached<T>(key: string, ttlDays: number, fetch: () => Promise<T>, now: () => number = Date.now): Promise<T> {
  const s = await store().catch(() => null);
  if (s) {
    try {
      const hit = await s.get(key);
      if (hit && now() - hit.fetchedAt <= ttlDays * DAY_MS) return hit.payload as T;
    } catch (e) {
      console.warn("[source-cache] o'qish xatosi — keshsiz davom:", e instanceof Error ? e.message : e);
    }
  }
  const value = await fetch();
  if (s && value !== null && value !== undefined) {
    try {
      await s.set(key, value);
    } catch (e) {
      console.warn("[source-cache] yozish xatosi:", e instanceof Error ? e.message : e);
    }
  }
  return value;
}

/** Qidiruv so'rovi uchun barqaror kalit — `q:<hash>` (Node `crypto` siz, izomorf). */
export function queryKey(prefix: string, text: string): string {
  // FNV-1a 32-bit ×2 (turli urug') — to'qnashuv ehtimoli amaliy jihatdan nol,
  // `sha256` uchun `node:crypto` import qilishga hojat yo'q.
  const norm = text.toLowerCase().replace(/\s+/g, " ").trim();
  const fnv = (seed: number) => {
    let h = seed >>> 0;
    for (let i = 0; i < norm.length; i++) {
      h ^= norm.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, "0");
  };
  return `${prefix}:${fnv(0x811c9dc5)}${fnv(0x9747b28c)}:${norm.length}`;
}
