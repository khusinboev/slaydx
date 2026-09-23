import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toPdf } from "./pdf";

/**
 * O'girilgan PDF keshi (C07: FILE-03, CONC-01, BEA-20).
 *
 * Tarjimon «Fayl» tabi har ochilganda `?format=pdf` iframe'ini qayta
 * yuklaydi, «PDF» tugmasi ham har bosilganda — ilgari har biri yangi
 * `soffice` edi. Endi natija web konteynerining vaqtinchalik diskida
 * saqlanadi:
 *   - kalit = generatsiya id + fayl MAZMUNI hashi — tahrirdan keyin fayl
 *     o'zgarsa kalit ham o'zgaradi, eski PDF hech qachon berilmaydi
 *     («ko'rdim = oldim»);
 *   - umumiy hajm chegarasi (LRU — eng kam ishlatilgani chiqariladi) va
 *     yosh chegarasi (o'chirilgan hujjatning PDF i diskda uzoq qolmasin);
 *   - yozuv atomar: `.tmp` ga yoziladi va `rename` — yarim fayl berilmaydi;
 *   - bir xil kalitga parallel so'rovlar BITTA o'girishni kutadi.
 *
 * Kesh jarayon bo'yicha (bazada emas — `BYTEA` ikkinchi nusxasi bazani
 * og'irlashtirardi); qayta ishga tushganda diskdagi fayllar qayta
 * indekslanadi. Egalik bu yerda EMAS, chaqiruvchida tekshiriladi:
 * baytlar `getGenerationFile` (SQL da `user_id`) dan keladi.
 */

const DEFAULT_DIR = join(tmpdir(), "slaydx-pdf-cache");
const DEFAULT_MAX_BYTES = 500 * 1024 * 1024;
const DEFAULT_MAX_AGE_MS = 24 * 3600 * 1000;

export type PdfCacheOptions = { dir: string; maxBytes: number; maxAgeMs: number };

type Entry = { size: number; mtimeMs: number };

/** Kalit — faqat `[0-9a-f-]` (fayl nomiga xavfsiz). */
export function pdfCacheKey(generationId: string, bytes: Uint8Array): string {
  const id = generationId.toLowerCase().replace(/[^0-9a-f-]/g, "").slice(0, 64);
  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 40);
  return `${id}-${hash}`;
}

function warn(what: string, e: unknown): void {
  console.warn(`[pdf-cache] ${what}:`, e instanceof Error ? e.message : e);
}

export class PdfDiskCache {
  /** Kiritilish tartibi = LRU tartibi (birinchisi — eng eski). */
  private readonly index = new Map<string, Entry>();
  private total = 0;
  private ready: Promise<void> | null = null;

  constructor(private readonly opts: PdfCacheOptions) {}

  totalBytes(): number {
    return this.total;
  }

  private file(key: string): string {
    return join(this.opts.dir, `${key}.pdf`);
  }

  /** Birinchi murojaatda: papka, yarim yozuvlarni tozalash, mavjud fayllarni indekslash. */
  private init(): Promise<void> {
    this.ready ??= (async () => {
      await mkdir(this.opts.dir, { recursive: true, mode: 0o700 });
      const found: [string, Entry][] = [];
      for (const name of await readdir(this.opts.dir)) {
        const path = join(this.opts.dir, name);
        if (name.endsWith(".tmp")) {
          await rm(path, { force: true }).catch((e) => warn("tmp o'chmadi", e));
          continue;
        }
        if (!name.endsWith(".pdf")) continue;
        const st = await stat(path).catch(() => null);
        if (st?.isFile()) found.push([name.slice(0, -4), { size: st.size, mtimeMs: st.mtimeMs }]);
      }
      found.sort((a, b) => a[1].mtimeMs - b[1].mtimeMs);
      for (const [key, entry] of found) {
        this.index.set(key, entry);
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

  private async drop(key: string): Promise<void> {
    const e = this.index.get(key);
    if (!e) return;
    this.index.delete(key);
    this.total -= e.size;
    await rm(this.file(key), { force: true }).catch((err) => warn("o'chmadi", err));
  }

  private async evict(): Promise<void> {
    const now = Date.now();
    for (const [key, e] of this.index) {
      if (this.total <= this.opts.maxBytes && now - e.mtimeMs <= this.opts.maxAgeMs) break;
      await this.drop(key);
    }
    // Yoshi o'tganlar LRU boshida bo'lmasligi mumkin (yaqinda o'qilgan) — alohida.
    for (const [key, e] of [...this.index]) {
      if (now - e.mtimeMs > this.opts.maxAgeMs) await this.drop(key);
    }
  }

  async get(key: string): Promise<Buffer | null> {
    await this.init();
    const e = this.index.get(key);
    if (!e) return null;
    if (Date.now() - e.mtimeMs > this.opts.maxAgeMs) {
      await this.drop(key);
      return null;
    }
    try {
      const buf = await readFile(this.file(key));
      // LRU: oxiriga ko'chiramiz (eng yangi ishlatilgan).
      this.index.delete(key);
      this.index.set(key, e);
      return buf;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") warn("o'qilmadi", err);
      this.index.delete(key);
      this.total -= e.size;
      return null;
    }
  }

  async put(key: string, pdf: Buffer): Promise<void> {
    await this.init();
    // Bitta fayl keshning yarmidan katta bo'lsa — boshqalarni haydab chiqarmaymiz.
    if (pdf.byteLength > this.opts.maxBytes / 2) return;
    const tmp = join(this.opts.dir, `${key}.${process.pid}.${randomUUID()}.tmp`);
    try {
      await writeFile(tmp, pdf, { mode: 0o600 });
      await rename(tmp, this.file(key));
    } catch (e) {
      await rm(tmp, { force: true }).catch(() => undefined);
      throw e;
    }
    const prev = this.index.get(key);
    if (prev) {
      this.index.delete(key);
      this.total -= prev.size;
    }
    this.index.set(key, { size: pdf.byteLength, mtimeMs: Date.now() });
    this.total += pdf.byteLength;
    await this.evict();
  }
}

type Globals = typeof globalThis & {
  __slaydxPdfCache?: PdfDiskCache;
  __slaydxPdfInflight?: Map<string, Promise<Buffer | null>>;
};
const g = globalThis as Globals;

/** Web jarayonining umumiy keshi (500 MB, 24 soat). */
export function pdfCache(): PdfDiskCache {
  g.__slaydxPdfCache ??= new PdfDiskCache({
    dir: DEFAULT_DIR,
    maxBytes: DEFAULT_MAX_BYTES,
    maxAgeMs: DEFAULT_MAX_AGE_MS,
  });
  return g.__slaydxPdfCache;
}

function inflight(): Map<string, Promise<Buffer | null>> {
  g.__slaydxPdfInflight ??= new Map();
  return g.__slaydxPdfInflight;
}

export type ConvertArgs = {
  generationId: string;
  bytes: Uint8Array;
  fileName: string;
  /**
   * HAQIQIY o'girishdan oldin (keshdan berilganda emas) — masalan
   * foydalanuvchi limiti. Xato tashlasa o'girish boshlanmaydi.
   */
  beforeConvert?: () => Promise<void>;
  convert?: (bytes: Uint8Array, fileName: string) => Promise<Buffer | null>;
  cache?: PdfDiskCache;
};

/**
 * Keshdan PDF, bo'lmasa o'girib keshlaydi. `null` — o'girib bo'lmadi.
 * `SofficeBusyError` va `beforeConvert` xatosi chaqiruvchiga (va shu
 * o'girishni kutayotganlarga) o'tadi.
 */
export async function getOrConvertPdf(args: ConvertArgs): Promise<Buffer | null> {
  const cache = args.cache ?? pdfCache();
  const convert = args.convert ?? toPdf;
  const key = pdfCacheKey(args.generationId, args.bytes);
  const map = inflight();

  const running = map.get(key);
  if (running) return running;
  const hit = await cache.get(key).catch((e) => {
    warn("kesh o'qilmadi", e);
    return null;
  });
  if (hit) return hit;
  // `await` oralig'ida boshqa so'rov boshlagan bo'lishi mumkin.
  const started = map.get(key);
  if (started) return started;

  const job = (async () => {
    await args.beforeConvert?.();
    const pdf = await convert(args.bytes, args.fileName);
    if (pdf) await cache.put(key, pdf).catch((e) => warn("yozilmadi", e));
    return pdf;
  })().finally(() => map.delete(key));
  map.set(key, job);
  return job;
}
