/**
 * WP-I: slayd maketlarini KO'Z BILAN ko'rish uchun tez yo'l.
 *
 * LLM ham, navbat ham kerak emas — `fallbackSlides` deterministik deka
 * yasaydi, `renderPptx` PPTX ga chizadi, LibreOffice PDF ga, `pdftoppm`
 * PNG ga. `CLAUDE.md` ning uchinchi bosqichi (ko'z bilan ko'rish) shu
 * skript orqali bajariladi.
 *
 *   npx tsx --conditions=react-server scripts/slide-eyes.mts [nom...]
 *
 * Profillar: `logo`, `pro`, `styles`. Chiqish: `eval-out/eyes/`.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { TOOL_BY_ID } from "../lib/tools.ts";
import type { FormValues } from "../lib/types.ts";
import { extractMeta } from "../lib/generation/meta.ts";
import { fallbackSlides, resolveDeckTemplate } from "../lib/generation/slide-write.ts";
import { blocksToBeats } from "../lib/generation/slide-blocks.ts";
import { expandBeats } from "../lib/generation/slide-templates.ts";
import { wantSlides } from "../lib/generation/slide-write.ts";
import { renderPptx } from "../lib/generation/render-pptx.ts";
import type { AcademicDoc } from "../lib/generation/types.ts";

const run = promisify(execFile);
const OUT = path.resolve(process.cwd(), "eval-out", "eyes");

/** 1×1 shaffof PNG — logotip o'rniga (haqiqiy fayl kerak emas). */
const LOGO =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

type Profile = { name: string; tool: keyof typeof TOOL_BY_ID; values: FormValues; logo?: boolean };

const PROFILES: Profile[] = [
  {
    name: "logo",
    tool: "pro-slide",
    logo: true,
    values: {
      topic: "Suvning tabiatdagi aylanishi",
      slideTemplate: "lecture",
      slideTheme: "atlas",
      slideCount: 12,
      author: "Karimova Nilufar",
      position: "O‘qituvchi",
      organization: "TDPU",
      language: "uz",
    },
  },
  {
    name: "pro",
    tool: "pro-slide",
    logo: true,
    values: {
      topic: "Orol dengizi fojiasi",
      slidePurpose: "open_lesson",
      slideAudience: "school_8_9",
      blocks: "reja,maqsadlar,motivatsiya,amaliyot,test,uyga_vazifa,adabiyotlar",
      quizCount: 3,
      speakerNotes: false,
      slideCount: 14,
      author: "Karimova Nilufar",
      organization: "12-maktab",
      language: "uz",
    },
  },
];

function docFor(p: Profile): AcademicDoc {
  const tool = TOOL_BY_ID[p.tool];
  const meta = extractMeta(tool, p.values);
  const tpl = resolveDeckTemplate(meta);
  const want = wantSlides(meta, tpl);
  const beats = blocksToBeats(meta, tpl, expandBeats(tpl, want), want);
  const doc: AcademicDoc = {
    meta,
    titlePage: false,
    toc: false,
    sections: [],
    slides: fallbackSlides(meta, tpl, beats),
    slideTemplate: tpl.id,
  };
  if (meta.slideTheme) doc.slideTheme = meta.slideTheme;
  if (p.logo) doc.slideLogo = { url: LOGO };
  return doc;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const list = only.length ? PROFILES.filter((p) => only.includes(p.name)) : PROFILES;

  for (const p of list) {
    const doc = docFor(p);
    const file = await renderPptx(doc, `eyes-${p.name}.pptx`);
    const pptx = path.join(OUT, file.fileName);
    await writeFile(pptx, file.bytes);
    process.stdout.write(
      `▶ ${p.name}: ${doc.slides?.length} slayd · ${(doc.slides ?? []).map((s) => s.layout).join(" › ")}\n`,
    );
    try {
      await run("soffice", ["--headless", "--convert-to", "pdf", "--outdir", OUT, pptx], {
        timeout: 180_000,
      });
      const pdf = pptx.replace(/\.pptx$/, ".pdf");
      await run("pdftoppm", ["-png", "-r", "60", pdf, path.join(OUT, `eyes-${p.name}`)]);
      process.stdout.write(`   PDF+PNG: ${OUT}/eyes-${p.name}-*.png\n`);
    } catch (e) {
      process.stdout.write(`   ✘ PDF: ${e instanceof Error ? e.message : String(e)}\n`);
    }
  }
}

await main();
