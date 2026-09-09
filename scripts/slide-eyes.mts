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
import { applyDocOps, type DocOp } from "../lib/generation/slide-edit.ts";

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
      position: "O’qituvchi",
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
  {
    name: "edit",
    tool: "slide",
    values: {
      topic: "Tahrir testi",
      slideTemplate: "lecture",
      slideCount: 10,
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

async function renderAndCapture(doc: AcademicDoc, name: string): Promise<void> {
  const file = await renderPptx(doc, `${name}.pptx`);
  const pptx = path.join(OUT, file.fileName);
  await writeFile(pptx, file.bytes);
  try {
    await run("soffice", ["--headless", "--convert-to", "pdf", "--outdir", OUT, pptx], {
      timeout: 180_000,
    });
    const pdf = pptx.replace(/\.pptx$/, ".pdf");
    await run("pdftoppm", ["-png", "-r", "60", pdf, path.join(OUT, name)]);
  } catch (e) {
    process.stdout.write(`   ✘ PDF: ${e instanceof Error ? e.message : String(e)}\n`);
  }
}

async function editProfile(): Promise<void> {
  const p = PROFILES.find((x) => x.name === "edit")!;
  const tool = TOOL_BY_ID[p.tool];
  const meta = extractMeta(tool, p.values);
  const tpl = resolveDeckTemplate(meta);
  const want = wantSlides(meta, tpl);
  const beats = blocksToBeats(meta, tpl, expandBeats(tpl, want), want);
  let doc: AcademicDoc = {
    meta,
    titlePage: false,
    toc: false,
    sections: [],
    slides: fallbackSlides(meta, tpl, beats),
    slideTemplate: tpl.id,
  };

  process.stdout.write("▶ edit: tahrir qadamlari\n");

  // Qadam 1: Uzun sarlavha (80 belgiga chegaralandi)
  const ops1: DocOp[] = [{ op: "text", index: 0, src: { f: "title" }, value: "Buni o'ziga sig'dira olgan sarlavha bunda juda uzundan ham uzunroq bo'ladi" }];
  const r1 = applyDocOps(doc, ops1, { genId: "eyes" });
  if (r1.ok) {
    doc = r1.doc;
    process.stdout.write(`  Qadam 1: Uzun sarlavha · ${doc.slides?.length} slayd\n`);
    await renderAndCapture(doc, "eyes-edit-1");
  }

  // Qadam 2: Band qo'shish va o'chirish
  if (doc.slides && doc.slides[3] && doc.slides[3].layout === "bullets") {
    const ops2: DocOp[] = [
      { op: "text", index: 3, src: { f: "bullets", i: 0 }, value: "Yangi band matn" },
      { op: "text", index: 3, src: { f: "bullets", i: 0 }, value: "" },
    ];
    const r2 = applyDocOps(doc, ops2, { genId: "eyes" });
    if (r2.ok) {
      doc = r2.doc;
      process.stdout.write(`  Qadam 2: Band tahrirlash · ${doc.slides?.length} slayd\n`);
      await renderAndCapture(doc, "eyes-edit-2");
    }
  }

  // Qadam 3: Slayd o'chirish
  if (doc.slides && doc.slides.length > 1) {
    const ops3: DocOp[] = [{ op: "delete", index: 2 }];
    const r3 = applyDocOps(doc, ops3, { genId: "eyes" });
    if (r3.ok) {
      doc = r3.doc;
      process.stdout.write(`  Qadam 3: Slayd o'chirish · ${doc.slides?.length} slayd\n`);
      await renderAndCapture(doc, "eyes-edit-3");
    }
  }

  // Qadam 4: O'girrish (oxirgi slaydni birinchiga)
  if (doc.slides && doc.slides.length > 1) {
    const lastIdx = doc.slides.length - 1;
    const order = [lastIdx, ...Array.from({ length: lastIdx }, (_, i) => i)];
    const ops4: DocOp[] = [{ op: "reorder", order }];
    const r4 = applyDocOps(doc, ops4, { genId: "eyes" });
    if (r4.ok) {
      doc = r4.doc;
      process.stdout.write(`  Qadam 4: O'girrish · ${doc.slides?.length} slayd\n`);
      await renderAndCapture(doc, "eyes-edit-4");
    }
  }

  // Qadam 5: Maketni o'zgartirish (3-slaydni "process" ga)
  if (doc.slides && doc.slides[3] && doc.slides[3].layout === "bullets") {
    const ops5: DocOp[] = [{ op: "layout", index: 3, layout: "process" }];
    const r5 = applyDocOps(doc, ops5, { genId: "eyes" });
    if (r5.ok) {
      doc = r5.doc;
      process.stdout.write(`  Qadam 5: Maket o'zgartirish · ${doc.slides?.length} slayd\n`);
      await renderAndCapture(doc, "eyes-edit-5");
    }
  }

  // Qadam 6: Izoh qo'shish
  if (doc.slides && doc.slides[0]) {
    const ops6: DocOp[] = [{ op: "notes", index: 0, value: "Bu slaydning ma'ruzachi izohi" }];
    const r6 = applyDocOps(doc, ops6, { genId: "eyes" });
    if (r6.ok) {
      doc = r6.doc;
      process.stdout.write(`  Qadam 6: Izoh qo'shish · ${doc.slides?.length} slayd\n`);
      await renderAndCapture(doc, "eyes-edit-6");
    }
  }

  process.stdout.write(`   PNG: ${OUT}/eyes-edit-*.png\n`);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const list = only.length ? PROFILES.filter((p) => only.includes(p.name)) : PROFILES;

  for (const p of list) {
    if (p.name === "edit") {
      await editProfile();
    } else {
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
}

await main();
