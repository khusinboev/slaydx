import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, chmod, lstat, mkdir, mkdtemp, open, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toPdf } from "./pdf";

/**
 * O'girilgan (hosila) fayllar keshi (C07: FILE-03, CONC-01, BEA-20; mobile
 * sprint `docs/mobile/PLAN.md` §4.2 — derived files cached by
 * `{genId, sha(bytes), format}`).
 *
 * Tarjimon «Fayl» tabi har ochilganda `?format=pdf` iframe'ini qayta
 * yuklaydi, «PDF» tugmasi ham har bosilganda — ilgari har biri yangi
 * `soffice` edi. Endi natija diskda saqlanadi. Bitta kesh PDF, slayd
 * rasmlari ZIP (`slides-png`) va JPG uchun ishlatiladi:
 *   - yozuv = generatsiya id + fayl MAZMUNI hashi + FORMAT
 *     (`<id>-<sha>.<format>`) — tahrirdan keyin fayl o'zgarsa kalit ham
 *     o'zgaradi, eski hosila hech qachon berilmaydi («ko'rdim = oldim»);
 *   - umumiy hajm chegarasi (LRU — eng kam ishlatilgani chiqariladi) va
 *     yosh chegarasi (24 soat — o'chirilgan hujjatning hosilasi diskda uzoq qolmasin);
 *   - yozuv atomar: `.tmp` ga yoziladi va `rename` — yarim fayl berilmaydi;
 *   - bir xil kalit + formatga parallel so'rovlar BITTA o'girishni kutadi.
 *
 * Live download links (mobile sprint m1): `touch` (called when a signed
 * `/api/dl` URL is minted) pins an entry for `pinMs` (20 min > the 15 min
 * token TTL) — LRU size eviction skips pinned entries unless the cache grows
 * past `hardMaxBytes` — and refreshes its mtime, so the age limit counts from
 * the last mint, not from the conversion. Pins live in memory: after a
 * restart the token route regenerates within its budget or answers 503.
 *
 * Papka (m5): `DERIVED_CACHE_DIR` (prod: docker volume — deploy keshni
 * o'chirmaydi). U HAQIQIY papka (symlink emas), shu jarayon egasiniki va
 * yozish mumkin bo'lishi shart; o'zimiz yaratsak yoki egasi bo'lsak `0700`
 * qilinadi. Berilmagan yoki yaroqsiz bo'lsa — jarayonga xos, `mkdtemp`
 * bilan yaratilgan yopiq papka (`/tmp/slaydx-derived-XXXXXX`, oldindan
 * taxmin qilib bo'lmaydigan nom; umumiy `/tmp` dagi sobit nom emas).
 * Kesh fayllari symlink orqali o'qilmaydi (`O_NOFOLLOW`, `lstat`).
 *
 * Kesh jarayon bo'yicha (bazada emas — `BYTEA` ikkinchi nusxasi bazani
 * og'irlashtirardi); qayta ishga tushganda diskdagi fayllar qayta
 * indekslanadi. Egalik bu yerda EMAS, chaqiruvchida tekshiriladi:
 * baytlar egalik SQL dan o'tgan qatordan keladi.
 */

const DEFAULT_MAX_BYTES = 500 * 1024 * 1024;
const DEFAULT_MAX_AGE_MS = 24 * 3600 * 1000;
/** `get` dagi yosh supurishi oralig'i. */
const SWEEP_EVERY_MS = 60_000;
/** A minted download link lives 15 min (`token.ts`); its derived file stays pinned a bit longer. */
export const DERIVED_PIN_MS = 20 * 60 * 1000;
/** Private per-process fallback directory prefix (under `os.tmpdir()`). */
const PRIVATE_DIR_PREFIX = "slaydx-derived-";

/** Sozlangan kesh papkasi (`DERIVED_CACHE_DIR`) yoki `null` — jarayonga xos yopiq papka ishlatiladi. */
export function derivedCacheDir(): string | null {
  return process.env.DERIVED_CACHE_DIR?.trim() || null;
}

export type PdfCacheOptions = {
  /** Configured directory; `null` → the private per-process directory. Unusable → the same fallback. */
  dir: string | null;
  maxBytes: number;
  maxAgeMs: number;
  /** How long `touch` pins an entry against LRU eviction (default `DERIVED_PIN_MS`). */
  pinMs?: number;
  /** Ceiling above which even pinned entries are evicted (default `2 × maxBytes`). */
  hardMaxBytes?: number;
};

type Entry = { size: number; mtimeMs: number; pinnedUntil?: number };

/** Yozuv formati — fayl kengaytmasi sifatida (`[a-z0-9-]`, fayl nomiga xavfsiz). */
const FORMAT_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

/** Kalit — faqat `[0-9a-f-]` (fayl nomiga xavfsiz). Format — yozuvning kengaytmasi (`get`/`put` argumenti). */
export function pdfCacheKey(generationId: string, bytes: Uint8Array): string {
  const id = generationId.toLowerCase().replace(/[^0-9a-f-]/g, "").slice(0, 64);
  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 40);
  return `${id}-${hash}`;
}

/** Hosila kaliti `{genId, sha(bytes)}`; format `get`/`put`/`size` ning alohida argumenti. */
export const derivedCacheKey = pdfCacheKey;

function warn(what: string, e: unknown): void {
  console.warn(`[pdf-cache] ${what}:`, e instanceof Error ? e.message : e);
}

function entryName(key: string, format: string): string {
  if (!FORMAT_RE.test(format)) throw new Error(`derived cache: invalid format "${format}"`);
  return `${key}.${format}`;
}

type Globals = typeof globalThis & {
  __slaydxPdfCache?: DerivedDiskCache;
  __slaydxPdfInflight?: Map<string, Promise<Buffer | null>>;
  __slaydxPrivateCacheDir?: Promise<string>;
};
const g = globalThis as Globals;

/**
 * The per-process private cache directory: `mkdtemp` (random suffix, mode
 * 0700) under `os.tmpdir()`, created once per process. Never a fixed,
 * guessable path on a shared `/tmp` (m5).
 */
export function privateCacheDir(): Promise<string> {
  g.__slaydxPrivateCacheDir ??= mkdtemp(join(tmpdir(), PRIVATE_DIR_PREFIX)).then(async (dir) => {
    await chmod(dir, 0o700);
    return dir;
  });
  g.__slaydxPrivateCacheDir.catch(() => {
    g.__slaydxPrivateCacheDir = undefined;
  });
  return g.__slaydxPrivateCacheDir;
}

/**
 * A configured cache directory is used only when it is a real directory (not
 * a symlink) owned by this process's user; it is created 0700, and tightened
 * to 0700 when we own it with a looser mode (a Dockerfile `mkdir` makes 0755).
 */
async function openConfiguredDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const st = await lstat(dir);
  if (!st.isDirectory()) throw new Error("not a real directory (symlink or file)");
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  if (uid !== null && st.uid !== uid) throw new Error(`owned by uid ${st.uid}, not ${uid}`);
  if ((st.mode & 0o777) !== 0o700) await chmod(dir, 0o700);
  await access(dir, fsConstants.W_OK);
}

/** Opens a cache file without following a symlink planted in its place (ELOOP). */
async function openNoFollow(path: string, flags: number) {
  return open(path, flags | fsConstants.O_NOFOLLOW);
}

/**
 * Hosila fayllar disk keshi. `get(key)`/`put(key, bytes)` — PDF (avvalgi
 * API); `get(key, "slides-png")` — boshqa format, alohida yozuv
 * (`<key>.slides-png`). Hajm/yosh chegarasi hamma formatlar uchun umumiy.
 */
export class DerivedDiskCache {
  /** Kiritilish tartibi = LRU tartibi (birinchisi — eng eski). Kalit — fayl nomi `<key>.<format>`. */
  private readonly index = new Map<string, Entry>();
  private total = 0;
  private ready: Promise<void> | null = null;
  private lastSweep = Date.now();
  private dir = "";

  constructor(private readonly opts: PdfCacheOptions) {}

  totalBytes(): number {
    return this.total;
  }

  /** Amalda ishlatilayotgan papka (sozlangani yoki jarayonga xos yopiq papka). */
  async activeDir(): Promise<string> {
    await this.init();
    return this.dir;
  }

  private file(name: string): string {
    return join(this.dir, name);
  }

  private get pinMs(): number {
    return this.opts.pinMs ?? DERIVED_PIN_MS;
  }

  private get hardMaxBytes(): number {
    return this.opts.hardMaxBytes ?? this.opts.maxBytes * 2;
  }

  /** Birinchi murojaatda: papka, yarim yozuvlarni tozalash, mavjud fayllarni indekslash. */
  private init(): Promise<void> {
    this.ready ??= (async () => {
      const configured = this.opts.dir;
      if (configured) {
        try {
          await openConfiguredDir(configured);
          this.dir = configured;
        } catch (e) {
          this.dir = await privateCacheDir();
          warn(`${configured} ishlatilmadi, jarayonga xos ${this.dir} ishlatiladi`, e);
        }
      } else {
        this.dir = await privateCacheDir();
      }
      const found: [string, Entry][] = [];
      for (const name of await readdir(this.dir)) {
        const path = join(this.dir, name);
        if (name.endsWith(".tmp")) {
          await rm(path, { force: true }).catch((e) => warn("tmp o'chmadi", e));
          continue;
        }
        const dot = name.lastIndexOf(".");
        if (dot <= 0 || !FORMAT_RE.test(name.slice(dot + 1))) continue;
        // `lstat`: a symlink planted under an entry name is never indexed (nor read).
        const st = await lstat(path).catch(() => null);
        if (st?.isFile()) found.push([name, { size: st.size, mtimeMs: st.mtimeMs }]);
      }
      found.sort((a, b) => a[1].mtimeMs - b[1].mtimeMs);
      for (const [name, entry] of found) {
        this.index.set(name, entry);
        this.total += entry.size;
      }
      await this.evict();
    })().catch((e) => {
      // Keyingi murojaat qayta urinadi; kesh ishlamasa ham o'girish ishlaydi.
      this.ready = null;
      throw e;
    });
    return this.ready;
  }

  private async drop(name: string): Promise<void> {
    const e = this.index.get(name);
    if (!e) return;
    this.index.delete(name);
    this.total -= e.size;
    await rm(this.file(name), { force: true }).catch((err) => warn("o'chmadi", err));
  }

  /** `keep` — the entry `put` just wrote: never its own eviction victim (it is about to be minted). */
  private async evict(keep?: string): Promise<void> {
    const now = Date.now();
    // Yoshi o'tganlar (LRU boshida bo'lmasligi mumkin — yaqinda o'qilgan). `touch` mtime ni yangilaydi.
    for (const [name, e] of [...this.index]) {
      if (now - e.mtimeMs > this.opts.maxAgeMs) await this.drop(name);
    }
    // Hajm: eng kam ishlatilgani birinchi; tirik havolaga bog'langan (pinned) yozuv o'tkazib yuboriladi…
    for (const [name, e] of [...this.index]) {
      if (this.total <= this.opts.maxBytes) break;
      if (name === keep || (e.pinnedUntil ?? 0) > now) continue;
      await this.drop(name);
    }
    // …faqat qattiq shiftdan oshganda pinned yozuvlar ham (eng eskisi birinchi) chiqariladi.
    for (const [name] of [...this.index]) {
      if (this.total <= this.hardMaxBytes) break;
      if (name === keep) continue;
      await this.drop(name);
    }
  }

  /**
   * Yosh chegarasi faqat `put` da tekshirilsa, yangi o'girish bo'lmagan
   * davrda o'chirilgan/tozalangan hujjatning hosilasi diskda 24 soatdan
   * uzoq qolardi. O'qishda ham supuramiz — lekin daqiqasiga ko'pi bilan bir marta.
   */
  private async sweepMaybe(): Promise<void> {
    if (Date.now() - this.lastSweep > SWEEP_EVERY_MS) {
      this.lastSweep = Date.now();
      await this.evict();
    }
  }

  /** Yaroqli yozuv yoki `null` (muddati o'tgani o'chiriladi). */
  private async live(name: string): Promise<Entry | null> {
    await this.init();
    await this.sweepMaybe();
    const e = this.index.get(name);
    if (!e) return null;
    if (Date.now() - e.mtimeMs > this.opts.maxAgeMs) {
      await this.drop(name);
      return null;
    }
    return e;
  }

  /** LRU: oxiriga ko'chiramiz (eng yangi ishlatilgan). */
  private bump(name: string, e: Entry): void {
    this.index.delete(name);
    this.index.set(name, e);
  }

  /** Yozuv hajmi baytni o'qimasdan (`HEAD /api/dl/…` shu bilan javob beradi) yoki `null`. */
  async size(key: string, format = "pdf"): Promise<number | null> {
    return (await this.live(entryName(key, format)))?.size ?? null;
  }

  /**
   * A signed download link for this entry was just minted: pin it against LRU
   * eviction for `pinMs`, move it to the LRU tail and refresh its mtime (the
   * age limit then counts from now; survives a restart's re-index). Returns
   * the size, or `null` when the entry is not cached.
   */
  async touch(key: string, format = "pdf"): Promise<number | null> {
    const name = entryName(key, format);
    const e = await this.live(name);
    if (!e) return null;
    const now = Date.now();
    try {
      const fh = await openNoFollow(this.file(name), fsConstants.O_RDONLY);
      try {
        await fh.utimes(now / 1000, now / 1000);
      } finally {
        await fh.close();
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") warn("touch", err);
      await this.drop(name);
      return null;
    }
    e.mtimeMs = now;
    e.pinnedUntil = now + this.pinMs;
    this.bump(name, e);
    return e.size;
  }

  async get(key: string, format = "pdf"): Promise<Buffer | null> {
    const name = entryName(key, format);
    const e = await this.live(name);
    if (!e) return null;
    try {
      const fh = await openNoFollow(this.file(name), fsConstants.O_RDONLY);
      let buf: Buffer;
      try {
        buf = await fh.readFile();
      } finally {
        await fh.close();
      }
      this.bump(name, e);
      return buf;
    } catch (err) {
      // ELOOP: a symlink replaced the entry — never read through it; drop the link.
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") warn("o'qilmadi", err);
      await this.drop(name);
      return null;
    }
  }

  async put(key: string, bytes: Buffer, format = "pdf"): Promise<void> {
    const name = entryName(key, format);
    await this.init();
    // Bitta fayl keshning yarmidan katta bo'lsa — boshqalarni haydab chiqarmaymiz.
    if (bytes.byteLength > this.opts.maxBytes / 2) return;
    const tmp = join(this.dir, `${key}.${process.pid}.${randomUUID()}.tmp`);
    try {
      // `wx` = O_CREAT | O_EXCL: never follows (or reuses) anything already at that path.
      await writeFile(tmp, bytes, { mode: 0o600, flag: "wx" });
      await rename(tmp, this.file(name));
    } catch (e) {
      await rm(tmp, { force: true }).catch(() => undefined);
      throw e;
    }
    const prev = this.index.get(name);
    if (prev) {
      this.index.delete(name);
      this.total -= prev.size;
    }
    this.index.set(name, { size: bytes.byteLength, mtimeMs: Date.now(), pinnedUntil: prev?.pinnedUntil });
    this.total += bytes.byteLength;
    await this.evict(name);
  }
}

/** Avvalgi nom (PDF keshi) — xuddi shu klass; mavjud chaqiruvchilar va testlar uchun. */
export const PdfDiskCache = DerivedDiskCache;
export type PdfDiskCache = DerivedDiskCache;

/** Web jarayonining umumiy hosila keshi (500 MB, 24 soat, `DERIVED_CACHE_DIR`). */
export function pdfCache(): DerivedDiskCache {
  g.__slaydxPdfCache ??= new DerivedDiskCache({
    dir: derivedCacheDir(),
    maxBytes: DEFAULT_MAX_BYTES,
    maxAgeMs: DEFAULT_MAX_AGE_MS,
  });
  return g.__slaydxPdfCache;
}

/** Xuddi shu umumiy kesh — hosila formatlar nomi bilan. */
export const derivedCache = pdfCache;

function inflight(): Map<string, Promise<Buffer | null>> {
  g.__slaydxPdfInflight ??= new Map();
  return g.__slaydxPdfInflight;
}

export type DeriveArgs = {
  generationId: string;
  /** Asl (saqlangan) fayl baytlari — kalit shulardan hisoblanadi. */
  bytes: Uint8Array;
  /** Hosila formati (`pdf`, `slides-png`, `jpg`). */
  format: string;
  /** Keshda bo'lmasa — hosilani yasaydi. `null` — yasab bo'lmadi (keshlanmaydi). */
  produce: () => Promise<Buffer | null>;
  cache?: DerivedDiskCache;
};

/**
 * Keshdan hosila, bo'lmasa yasab keshlaydi (bir kalit + formatga bitta
 * ish — single-flight). `produce` xatosi chaqiruvchiga (va shu ishni
 * kutayotganlarga) o'tadi.
 */
export async function getOrDerive(args: DeriveArgs): Promise<Buffer | null> {
  const cache = args.cache ?? pdfCache();
  const key = derivedCacheKey(args.generationId, args.bytes);
  const flight = `${key}.${args.format}`;
  const map = inflight();

  const running = map.get(flight);
  if (running) return running;
  const hit = await cache.get(key, args.format).catch((e) => {
    warn("kesh o'qilmadi", e);
    return null;
  });
  if (hit) return hit;
  // `await` oralig'ida boshqa so'rov boshlagan bo'lishi mumkin.
  const started = map.get(flight);
  if (started) return started;

  const job = (async () => {
    const out = await args.produce();
    if (out) await cache.put(key, out, args.format).catch((e) => warn("yozilmadi", e));
    return out;
  })().finally(() => map.delete(flight));
  map.set(flight, job);
  return job;
}

/** Keshdagi hosila hajmi (baytni o'qimasdan) yoki `null` — o'girish BOSHLANMAYDI. */
export async function derivedSize(
  generationId: string,
  bytes: Uint8Array,
  format: string,
  cache: DerivedDiskCache = pdfCache(),
): Promise<number | null> {
  return cache.size(derivedCacheKey(generationId, bytes), format).catch((e) => {
    warn("kesh o'qilmadi", e);
    return null;
  });
}

/** `derivedSize` + pin the entry for a link being minted (`DerivedDiskCache.touch`). Never converts. */
export async function touchDerived(
  generationId: string,
  bytes: Uint8Array,
  format: string,
  cache: DerivedDiskCache = pdfCache(),
): Promise<number | null> {
  return cache.touch(derivedCacheKey(generationId, bytes), format).catch((e) => {
    warn("kesh o'qilmadi", e);
    return null;
  });
}

export type ConvertArgs = {
  generationId: string;
  bytes: Uint8Array;
  fileName: string;
  /**
   * HAQIQIY o'girish uchun (keshdan berilganda emas) — masalan
   * foydalanuvchi limiti. Konvertorga `beforeRun` sifatida uzatiladi va
   * `soffice` slotini OLGANDAN KEYIN chaqiriladi: band (503) urinish
   * kvotani yoqmaydi (W2-A review R2). Xato tashlasa o'girish boshlanmaydi.
   */
  beforeConvert?: () => Promise<void>;
  /** Shartnoma: `beforeRun` ni slot olingandan keyin, o'girishdan oldin chaqirishi SHART. */
  convert?: PdfConverter;
  cache?: DerivedDiskCache;
};

export type PdfConverter = (
  bytes: Uint8Array,
  fileName: string,
  beforeRun?: () => Promise<void>,
) => Promise<Buffer | null>;

const defaultConvert: PdfConverter = (bytes, fileName, beforeRun) => toPdf(bytes, fileName, { beforeRun });

/**
 * Keshdan PDF, bo'lmasa o'girib keshlaydi. `null` — o'girib bo'lmadi.
 * `SofficeBusyError` va `beforeConvert` xatosi chaqiruvchiga (va shu
 * o'girishni kutayotganlarga) o'tadi.
 */
export async function getOrConvertPdf(args: ConvertArgs): Promise<Buffer | null> {
  const convert = args.convert ?? defaultConvert;
  return getOrDerive({
    generationId: args.generationId,
    bytes: args.bytes,
    format: "pdf",
    cache: args.cache,
    produce: () => convert(args.bytes, args.fileName, args.beforeConvert),
  });
}
