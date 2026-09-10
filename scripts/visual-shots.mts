/**
 * Shablon dizaynlarini KO'Z BILAN tekshirish (Shablonlar 2).
 *
 *   npm run shots                 — 10 shablon × 9 namunaviy slayd
 *   npm run shots -- lesson case  — faqat tanlanganlar
 *   THEME=chalk npm run shots     — boshqa palitrada
 *
 * Har shablon: `sampleDeck` → `renderPptx` → LibreOffice PDF → `pdftoppm`
 * PNG → `eval-out/visuals/<id>-<n>.png`. Bu HAQIQIY chiqish (PPTX), sayt
 * ko'ruvchisi emas; `SlideCanvas` pariteti testlar bilan qulflangan.
 * Rasmlar `public/samples/` dan (`/samples/…` → fayl baytlari).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { renderPptx } from "../lib/generation/render-pptx.ts";
import { sampleDeck, SAMPLE_IMAGE_PATH } from "../lib/generation/slide-samples.ts";
import { SLIDE_TEMPLATES, type SlideTemplateId } from "../lib/generation/slide-templates.ts";
import { extractMeta } from "../lib/generation/meta.ts";
import { TOOL_BY_ID } from "../lib/tools.ts";
import type { AcademicDoc } from "../lib/generation/types.ts";
import type { ImageBytes } from "../lib/generation/slide-images.ts";

const run = promisify(execFile);
const OUT = path.resolve(process.cwd(), "eval-out", "visuals");

async function resolveSample(url: string): Promise<ImageBytes | null> {
  if (!url.startsWith(`${SAMPLE_IMAGE_PATH}/`)) return null;
  const file = path.resolve(process.cwd(), "public", url.replace(/^\//, ""));
  const bytes = await readFile(file).catch(() => null);
  if (!bytes) return null;
  return { data: `data:image/jpeg;base64,${bytes.toString("base64")}`, type: "jpg" };
}

async function shoot(id: SlideTemplateId, theme: string): Promise<void> {
  const tpl = SLIDE_TEMPLATES.find((t) => t.id === id)!;
  const meta = extractMeta(TOOL_BY_ID.slide, {
    topic: "Namuna",
    slideTemplate: id,
    slideTheme: theme || tpl.defaultTheme,
    author: "Karimova Nilufar",
    position: "O‘qituvchi",
    organization: "TDPU",
    language: "uz",
  } as never);
  const doc: AcademicDoc = {
    meta,
    titlePage: false,
    toc: false,
    sections: [],
    slides: sampleDeck(id),
    slideTemplate: id,
    slideTheme: (theme || tpl.defaultTheme) as never,
  };
  const file = await renderPptx(doc, `${id}.pptx`, { resolveImage: resolveSample });
  const pptx = path.join(OUT, file.fileName);
  await writeFile(pptx, file.bytes);
  await run("soffice", ["--headless", "--norestore", "--convert-to", "pdf", "--outdir", OUT, pptx], { timeout: 180_000 });
  await run("pdftoppm", ["-png", "-r", "50", pptx.replace(/\.pptx$/, ".pdf"), path.join(OUT, id)]);
  process.stdout.write(`✓ ${id} (${tpl.visual}, ${theme || tpl.defaultTheme})\n`);
}

const want = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const ids = (want.length ? want : SLIDE_TEMPLATES.map((t) => t.id).filter((t) => t !== "auto")) as SlideTemplateId[];
await mkdir(OUT, { recursive: true });
for (const id of ids) {
  try {
    await shoot(id, process.env.THEME ?? "");
  } catch (e) {
    process.stdout.write(`✘ ${id}: ${e instanceof Error ? e.message : String(e)}\n`);
  }
}
process.stdout.write(`→ ${OUT}\n`);
