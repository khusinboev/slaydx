import "server-only";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Gate, runGroup, sofficeGate } from "./soffice-gate";

/**
 * DOCX / PPTX → PDF.
 *
 * Universitetlar ko'pincha PDF so'raydi, dvigatel esa faqat DOCX va PPTX
 * chiqaradi. O'girish LibreOffice bilan bajariladi: u hujjatni Word/
 * PowerPoint bilan bir xil maketda chizadi va shriftni PDF ichiga
 * joylashtiradi, ya'ni fayl boshqa kompyuterda ham xuddi shunday ochiladi.
 *
 * Konvertatsiya TALAB BO'YICHA qilinadi, generatsiya paytida emas: fayllar
 * Postgres `BYTEA` da saqlanadi va har hujjatning ikkinchi nusxasi bazani
 * ikki barobar og'irlashtirardi. Takroriy ko'rishlar uchun natija web
 * konteynerining vaqtinchalik diskida keshlanadi (`pdf-cache.ts`).
 *
 * C07: har chaqiruv umumiy `soffice` darvozasidan o'tadi (bir vaqtda
 * `PDF_MAX_CONCURRENCY` ta) va jarayonlar guruhida ishlaydi — vaqt
 * tugasa launcher ham, `soffice.bin` ham o'ldiriladi (`soffice-gate.ts`).
 */

const CANDIDATES = ["/usr/bin/soffice", "/usr/bin/libreoffice", "/usr/local/bin/soffice"];
const TIMEOUT_MS = 90_000;
/** Kirish fayli chegarasi — o'girish xotira va vaqt talab qiladi. */
const MAX_INPUT_BYTES = 30 * 1024 * 1024;

export function pdfBinary(): string | null {
  const explicit = process.env.SOFFICE_BIN?.trim();
  if (explicit) return existsSync(explicit) ? explicit : null;
  return CANDIDATES.find((p) => existsSync(p)) ?? null;
}

/** LibreOffice o'rnatilganmi. Yo'q bo'lsa PDF tugmasi UI da chiqmaydi. */
export function pdfAvailable(): boolean {
  return pdfBinary() !== null;
}

export function pdfFileName(name: string): string {
  return `${name.replace(/\.(docx|pptx)$/i, "")}.pdf`;
}

export type ToPdfDeps = {
  /** Test seam: umumiy darvoza o'rniga. */
  gate?: Gate;
  /** Test seam: vaqt chegarasi (standart 90 s). */
  timeoutMs?: number;
  /**
   * Slot OLINGANDAN KEYIN, `soffice` dan oldin (masalan foydalanuvchi
   * limiti). Band (503) urinishda chaqirilmaydi — `Retry-After` ga amal
   * qilgan foydalanuvchi kvotasini yoqmaydi (W2-A review R2). Xato
   * tashlasa `soffice` ishga tushmaydi, slot `run` ning `finally` sida qaytadi.
   */
  beforeRun?: () => Promise<void>;
};

/**
 * `null` — LibreOffice yo'q, kirish yaroqsiz yoki o'girish yiqildi/vaqti
 * tugadi. `SofficeBusyError` — hamma slot band va kutish muddati o'tdi
 * (chaqiruvchi 503 + `Retry-After` beradi); bu xato YUTILMAYDI.
 */
export async function toPdf(bytes: Uint8Array, fileName: string, deps: ToPdfDeps = {}): Promise<Buffer | null> {
  const bin = pdfBinary();
  if (!bin) return null;
  if (!bytes.byteLength || bytes.byteLength > MAX_INPUT_BYTES) return null;
  const gate = deps.gate ?? sofficeGate();
  return gate.run(async () => {
    await deps.beforeRun?.();
    return convert(bin, bytes, fileName, deps.timeoutMs ?? TIMEOUT_MS);
  });
}

async function convert(bin: string, bytes: Uint8Array, fileName: string, timeoutMs: number): Promise<Buffer | null> {
  const dir = await mkdtemp(join(tmpdir(), "slaydx-pdf-"));
  try {
    // Fayl nomi buyruq qatoriga tushadi — faqat xavfsiz belgilar qoldiramiz.
    const ext = /\.pptx$/i.test(fileName) ? "pptx" : "docx";
    const src = join(dir, `manba.${ext}`);
    await writeFile(src, bytes);

    // Guruh to'liq o'lgandan keyingina qaytadi — `finally` dagi `rm`
    // ishlayotgan `soffice.bin` ostidan profilni o'chirib yubormaydi (FILE-06).
    await runGroup(
      bin,
      [
        "--headless",
        "--norestore",
        "--nolockcheck",
        "--nodefault",
        // Har o'girish uchun ALOHIDA profil: umumiy profil bilan parallel
        // ishga tushirilgan LibreOffice nusxalari bir-birini bloklaydi.
        `-env:UserInstallation=file://${join(dir, "profile")}`,
        "--convert-to",
        "pdf",
        "--outdir",
        dir,
        src,
      ],
      { timeoutMs },
    );

    const out = (await readdir(dir)).find((f) => f.toLowerCase().endsWith(".pdf"));
    if (!out) {
      console.warn("[pdf] chiqish fayli topilmadi");
      return null;
    }
    const buf = await readFile(join(dir, out));
    return buf.byteLength ? buf : null;
  } catch (e) {
    console.warn("[pdf]", e instanceof Error ? e.message : "o‘girish xatosi");
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch((e) =>
      console.warn("[pdf] vaqtinchalik papka o'chmadi:", e instanceof Error ? e.message : e),
    );
  }
}
