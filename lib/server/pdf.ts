import "server-only";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

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
 * ikki barobar og'irlashtirardi.
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

export async function toPdf(bytes: Uint8Array, fileName: string): Promise<Buffer | null> {
  const bin = pdfBinary();
  if (!bin) return null;
  if (!bytes.byteLength || bytes.byteLength > MAX_INPUT_BYTES) return null;

  const dir = await mkdtemp(join(tmpdir(), "sodda-pdf-"));
  try {
    // Fayl nomi buyruq qatoriga tushadi — faqat xavfsiz belgilar qoldiramiz.
    const ext = /\.pptx$/i.test(fileName) ? "pptx" : "docx";
    const src = join(dir, `manba.${ext}`);
    await writeFile(src, bytes);

    await run(
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
      { timeout: TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 },
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
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
