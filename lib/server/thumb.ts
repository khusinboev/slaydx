import "server-only";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { queryOne } from "./db";
import { getAsset, putAssets } from "./assets";
import { env } from "./env";
import { pdfAvailable, toPdf } from "./pdf";
import { getOrConvertPdf } from "./pdf-cache";
import { Gate } from "./soffice-gate";

const run = promisify(execFile);

/**
 * Fayl kartasi ESKIZI (AUDIT-14): DOCX/PPTX natijaning 1-sahifasi kichik
 * JPEG (~300×420 px, ~15–25 KB).
 *
 * «Mening fayllarim» kartasida asl faylning bir qismi ko'rinsin — slayd va
 * rasm allaqachon shunday (`SlideCanvas`, aktiv URL), hujjatlar esa
 * matn qatorlari edi. To'liq faylni (yoki PDF ni) kartaga berish og'ir:
 * 40 betlik kurs ishi 1–3 MB, 20 karta — bosh sahifa yuklanmaydi. Shuning
 * uchun:
 *   - eskiz TALAB BO'YICHA, web konteynerida (LibreOffice + pdftoppm shu
 *     yerda; worker'da yo'q) — birinchi so'rovda 2–8 s, keyin aktiv
 *     (`generation_assets`, `THUMB_ASSET_ID`) va brauzer keshi (1 kun);
 *   - past ruxsat (`THUMB_DPI`) va JPEG sifati — hajm karta uchun yetarli;
 *   - LibreOffice umumiy `soffice` darvozasidan o'tadi (C07 — PDF yuklab
 *     olish va shablon bilan BITTA hovuz); eskizlar esa undan ko'pi bilan
 *     `PDF_MAX_CONCURRENCY − 1` slotni egallaydi (`thumbGate`) — bosh
 *     sahifadagi 20 karta foydalanuvchining «PDF» tugmasini navbatda
 *     qoldirmasin. Band bo'lsa 503 — karta matn ko'rinishiga qaytadi;
 *   - bitta id uchun bitta ish (`inflight`);
 *   - o'girilgan PDF umumiy keshga tushadi (`pdf-cache.ts`) — keyin shu
 *     hujjatni PDF sifatida ochish `soffice` ni qayta ishlatmaydi;
 *   - faqat TAYYOR (`COMPLETED`) generatsiya fayli (W1-C R3).
 */

/** Aktiv id — kontent hashi emas, sobit belgi (route `^[0-9a-f]{8,64}$` talab qiladi). */
export const THUMB_ASSET_ID = "ab00000000000000000000e1";
const THUMB_DPI = 36;
const THUMB_QUALITY = 72;
const CONVERTIBLE = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

export function thumbAvailable(): boolean {
  return pdfAvailable() && Boolean(pdftoppmBin());
}

function pdftoppmBin(): string | null {
  const explicit = process.env.PDFTOPPM_BIN?.trim();
  if (explicit) return existsSync(explicit) ? explicit : null;
  return ["/usr/bin/pdftoppm", "/usr/local/bin/pdftoppm"].find((p) => existsSync(p)) ?? null;
}

/** PDF → 1-sahifa JPEG. `null` — vosita yo'q yoki o'girish yiqildi. */
export async function pdfFirstPageJpeg(pdf: Buffer, deps: { pdftoppm?: string | null } = {}): Promise<Buffer | null> {
  const bin = deps.pdftoppm === undefined ? pdftoppmBin() : deps.pdftoppm;
  if (!bin) return null;
  const dir = await mkdtemp(join(tmpdir(), "slaydx-thumb-"));
  try {
    const src = join(dir, "d.pdf");
    await writeFile(src, pdf);
    await run(bin, ["-f", "1", "-l", "1", "-r", String(THUMB_DPI), "-jpeg", "-jpegopt", `quality=${THUMB_QUALITY}`, "-singlefile", src, join(dir, "t")], {
      timeout: 30_000,
    });
    const out = await readFile(join(dir, "t.jpg"));
    return out.byteLength ? out : null;
  } catch (e) {
    console.warn("[thumb]", e instanceof Error ? e.message : e);
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** DOCX/PPTX baytlaridan eskiz: LibreOffice → PDF → pdftoppm. */
export async function buildThumb(
  bytes: Uint8Array,
  fileName: string,
  mime: string,
  convert: (bytes: Uint8Array, fileName: string) => Promise<Buffer | null> = toPdf,
): Promise<Buffer | null> {
  if (!CONVERTIBLE.has(mime)) return null;
  const pdf = await convert(bytes, fileName);
  if (!pdf) return null;
  return pdfFirstPageJpeg(pdf);
}

type Globals = typeof globalThis & {
  __slaydxThumbGate?: Gate;
  __slaydxThumbInflight?: Map<string, Promise<Buffer | null>>;
};
const g = globalThis as Globals;

/**
 * Eskizlarning ICHKI chegarasi (umumiy `soffice` darvozasi ustidan):
 * `PDF_MAX_CONCURRENCY − 1` (kamida 1) — bitta slot doim foydalanuvchi
 * so'ragan PDF uchun qoladi. Kutish ham chegaralangan (ilgari cheksiz
 * `waiters` massivi edi — SCALE-07).
 */
function thumbGate(): Gate {
  g.__slaydxThumbGate ??= new Gate({
    max: Math.max(1, env.pdf.maxConcurrency - 1),
    waitMs: 20_000,
    maxWaiters: 20,
    retryAfterSec: 15,
  });
  return g.__slaydxThumbGate;
}

function inflight(): Map<string, Promise<Buffer | null>> {
  g.__slaydxThumbInflight ??= new Map();
  return g.__slaydxThumbInflight;
}

export type ThumbDeps = {
  /** Test seam: `thumbAvailable` o'rniga. */
  available?: () => boolean;
  /** Test seam: bayt → JPEG (standart: kesh orqali PDF → pdftoppm). */
  build?: (bytes: Uint8Array, fileName: string, mime: string) => Promise<Buffer | null>;
};

/**
 * Eskizni beradi: keshdan (aktiv) yoki yasab keshlaydi. Egalik SQL da.
 * `null` — fayl yo'q / tayyor emas / o'girib bo'lmaydi / vositalar yo'q.
 * `SofficeBusyError` — hamma slot band (route 503 + `Retry-After` beradi).
 */
export async function getOrBuildThumb(generationId: string, userId: string, deps: ThumbDeps = {}): Promise<Buffer | null> {
  const cached = await getAsset(generationId, THUMB_ASSET_ID, userId);
  if (cached) return cached.bytes;
  if (!(deps.available ?? thumbAvailable)()) return null;
  const build =
    deps.build ??
    ((bytes: Uint8Array, fileName: string, mime: string) =>
      buildThumb(bytes, fileName, mime, (b, n) => getOrConvertPdf({ generationId, bytes: b, fileName: n })));
  const map = inflight();
  const key = `${userId}:${generationId}`;
  const running = map.get(key);
  if (running) return running;
  const job = thumbGate()
    .run(async () => {
      /*
       * `getGenerationFile` yuklab olish hisoblagichini oshiradi — eskiz
       * yuklab olish emas, shuning uchun o'z so'rovi. `status = 'COMPLETED'`
       * — `getGenerationFile` bilan bir xil shart: yiqilgan/tugamagan ishning
       * (masalan qaytarilgan pul bilan FAILED) fayli LibreOffice ga
       * yuborilmaydi va ko'rsatilmaydi (W1-C R3).
       */
      const file = await queryOne<{ bytes: Buffer; file_name: string; mime: string }>(
        `SELECT f.bytes, f.file_name, f.mime FROM generation_files f JOIN generations g ON g.id = f.generation_id
          WHERE f.generation_id = $1 AND g.user_id = $2 AND g.status = 'COMPLETED'`,
        [generationId, userId],
      );
      if (!file) return null;
      const jpeg = await build(new Uint8Array(file.bytes), file.file_name, file.mime);
      if (jpeg) await putAssets(generationId, [{ assetId: THUMB_ASSET_ID, mime: "image/jpeg", bytes: jpeg }]);
      return jpeg;
    })
    .finally(() => map.delete(key));
  map.set(key, job);
  return job;
}
