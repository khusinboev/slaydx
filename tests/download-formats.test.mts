import test from "node:test";
import assert from "node:assert/strict";
import {
  DOWNLOAD_FORMAT_IDS,
  DOWNLOAD_TOOL_IDS,
  defaultShareFormat,
  downloadFormats,
  downloadSubject,
  formatById,
  isDownloadFormatId,
  type DownloadFormatId,
  type DownloadSubject,
} from "../lib/downloads/formats.ts";
import { TOOLS } from "../lib/tools.ts";

/**
 * The download format registry (docs/mobile/PLAN.md §4.1, owner decision O1).
 *
 * The matrix below is the product decision written out per tool. A new tool in
 * `lib/tools.ts` without a row here fails `every tool has a decision`; the
 * registry itself is a `Record<ToolId, …>`, so it also fails the typecheck.
 */

const ON = { pdf: true };
const OFF = { pdf: false };
const ids = (g: DownloadSubject, f = ON) => downloadFormats(g, f).map((x) => x.id);

/** Stored format per tool (what `tool.output` produces for a typical result). */
type Row = { format: string; on: DownloadFormatId[]; off: DownloadFormatId[] };
const MATRIX: Record<string, Row> = {
  slide: { format: "pptx", on: ["native", "pdf", "slides-png"], off: ["native"] },
  "pro-slide": { format: "pptx", on: ["native", "pdf", "slides-png"], off: ["native"] },
  coursework: { format: "docx", on: ["native", "pdf"], off: ["native"] },
  referat: { format: "docx", on: ["native", "pdf"], off: ["native"] },
  "mustaqil-ish": { format: "docx", on: ["native", "pdf"], off: ["native"] },
  essay: { format: "docx", on: ["native", "pdf"], off: ["native"] },
  article: { format: "docx", on: ["native", "pdf"], off: ["native"] },
  thesis: { format: "docx", on: ["native", "pdf"], off: ["native"] },
  resume: { format: "docx", on: ["pdf", "native"], off: ["native"] },
  translation: { format: "docx", on: ["native", "pdf"], off: ["native"] },
  "lesson-plan": { format: "docx", on: ["native", "pdf"], off: ["native"] },
  "texnologik-xarita": { format: "docx", on: ["native", "pdf"], off: ["native"] },
  keys: { format: "docx", on: ["native", "pdf"], off: ["native"] },
  test: { format: "docx", on: ["native", "pdf"], off: ["native"] },
  glossary: { format: "docx", on: ["native", "pdf", "glossary-csv"], off: ["native", "glossary-csv"] },
  crossword: { format: "docx", on: ["native", "pdf"], off: ["native"] },
  flashcards: { format: "docx", on: ["native", "pdf"], off: ["native"] },
  sorting: { format: "docx", on: ["native", "pdf"], off: ["native"] },
  listening: { format: "docx", on: ["native", "pdf"], off: ["native"] },
  image: { format: "png", on: ["native", "jpg"], off: ["native", "jpg"] },
  infographic: { format: "png", on: ["native", "jpg"], off: ["native", "jpg"] },
  podcast: { format: "mp3", on: ["native", "transcript-txt"], off: ["native", "transcript-txt"] },
  greeting: { format: "mp3", on: ["native", "transcript-txt"], off: ["native", "transcript-txt"] },
};

test("every tool in lib/tools.ts has a download decision (registry and this matrix)", () => {
  const toolIds = TOOLS.map((t) => t.id).sort();
  assert.deepEqual([...DOWNLOAD_TOOL_IDS].sort(), toolIds, "registry TOOL_PLANS keys = TOOLS ids");
  assert.deepEqual(Object.keys(MATRIX).sort(), toolIds, "test matrix keys = TOOLS ids");
});

test("full per-tool matrix with pdf on and off", () => {
  for (const [type, row] of Object.entries(MATRIX)) {
    assert.deepEqual(ids({ type, format: row.format }, ON), row.on, `${type} pdf=on`);
    assert.deepEqual(ids({ type, format: row.format }, OFF), row.off, `${type} pdf=off`);
  }
});

test("native row follows the stored format", () => {
  const cases: [string, string, string, string][] = [
    ["slide", "pptx", "PowerPoint (PPTX)", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
    ["essay", "docx", "Word (DOCX)", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ["translation", "xlsx", "Excel (XLSX)", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    ["image", "png", "Rasm (PNG)", "image/png"],
    ["image", "jpg", "Rasm (JPG)", "image/jpeg"],
    ["image", "zip", "Barcha rasmlar (ZIP)", "application/zip"],
    ["podcast", "mp3", "Audio (MP3)", "audio/mpeg"],
    ["translation", "txt", "Matn (TXT)", "text/plain; charset=utf-8"],
    ["translation", "md", "Markdown (MD)", "text/markdown; charset=utf-8"],
    ["translation", "csv", "Jadval (CSV)", "text/csv; charset=utf-8"],
  ];
  for (const [type, format, label, mime] of cases) {
    const n = downloadFormats({ type, format }, ON)[0]!;
    assert.equal(n.id, "native");
    assert.equal(n.label, label, `${type}/${format}`);
    assert.equal(n.ext, format);
    assert.equal(n.mime, mime);
    assert.equal(n.cost, "instant");
    assert.equal(n.needs, undefined);
  }
  assert.equal(downloadFormats({ type: "slide", format: "pptx" }, ON)[0]!.hint, "Tahrirlash uchun");
});

test("translation: same-format output gets no PDF unless docx/pptx; text/pdf input is a DOCX with PDF", () => {
  const t = (format: string, translationKind: string) => ({ type: "translation", format, translationKind });
  assert.deepEqual(ids(t("docx", "docx")), ["native", "pdf"]);
  assert.deepEqual(ids(t("pptx", "pptx")), ["native", "pdf"]);
  assert.deepEqual(ids(t("xlsx", "xlsx")), ["native"]);
  assert.deepEqual(ids(t("txt", "txt")), ["native"]);
  assert.deepEqual(ids(t("md", "md")), ["native"]);
  assert.deepEqual(ids(t("csv", "csv")), ["native"]);
  assert.deepEqual(ids(t("docx", "text")), ["native", "pdf"]);
  assert.deepEqual(ids(t("docx", "pdf")), ["native", "pdf"]);
  // No slide images for a translated PPTX: that is a slide-tool decision only.
  assert.ok(!ids(t("pptx", "pptx")).includes("slides-png"));
  // Hint: a file-mode translation keeps the source format; text/PDF input is an editable DOCX.
  assert.equal(downloadFormats(t("xlsx", "xlsx"), ON)[0]!.hint, "Asl fayl formatida");
  assert.equal(downloadFormats(t("docx", "text"), ON)[0]!.hint, "Tahrirlash uchun");
  assert.equal(downloadFormats(t("docx", "pdf"), ON)[0]!.hint, "Tahrirlash uchun");
});

test("images: single PNG adds JPG; single JPG and multi ZIP offer the stored file only", () => {
  assert.deepEqual(ids({ type: "image", format: "png", imageCount: 1 }), ["native", "jpg"]);
  assert.deepEqual(ids({ type: "image", format: "jpg", imageCount: 1 }), ["native"]);
  assert.deepEqual(ids({ type: "image", format: "zip", imageCount: 4 }), ["native"]);
  assert.equal(downloadFormats({ type: "image", format: "zip", imageCount: 4 }, ON)[0]!.hint, "4 ta rasm");
  assert.equal(downloadFormats({ type: "image", format: "zip" }, ON)[0]!.hint, undefined);
  assert.deepEqual(ids({ type: "infographic", format: "jpg" }), ["native"]);
  const jpg = formatById({ type: "image", format: "png" }, ON, "jpg")!;
  assert.equal(jpg.mime, "image/jpeg");
  assert.equal(jpg.ext, "jpg");
  assert.equal(jpg.cost, "convert");
});

test("games: results CSV only when there are results", () => {
  for (const type of ["sorting", "listening"]) {
    assert.deepEqual(ids({ type, format: "docx", hasResults: true }), ["native", "pdf", "results-csv"]);
    assert.deepEqual(ids({ type, format: "docx", hasResults: false }), ["native", "pdf"]);
    assert.deepEqual(ids({ type, format: "docx", hasResults: true }, OFF), ["native", "results-csv"]);
  }
  // Printable games have no player results.
  assert.deepEqual(ids({ type: "crossword", format: "docx", hasResults: true }), ["native", "pdf"]);
});

test("features.pdf=false removes pdf and everything that needs it", () => {
  for (const [type, row] of Object.entries(MATRIX)) {
    const off = downloadFormats({ type, format: row.format, hasResults: true }, OFF);
    assert.ok(off.every((f) => f.needs === undefined), `${type}: nothing needing LibreOffice`);
  }
  const slides = downloadFormats({ type: "slide", format: "pptx" }, ON);
  assert.equal(slides.find((f) => f.id === "pdf")!.needs, "pdf");
  assert.equal(slides.find((f) => f.id === "slides-png")!.needs, "pdftoppm");
});

test("ordering: native first everywhere except resume (PDF first)", () => {
  for (const [type, row] of Object.entries(MATRIX)) {
    const first = ids({ type, format: row.format }, ON)[0];
    assert.equal(first, type === "resume" ? "pdf" : "native", type);
  }
  assert.equal(downloadFormats({ type: "resume", format: "docx" }, ON)[0]!.hint, "Ish beruvchiga yuborish uchun");
  assert.equal(downloadFormats({ type: "essay", format: "docx" }, ON)[1]!.hint, "Chop etish va yuborish uchun");
});

test("format preconditions: a stored format that cannot convert is not offered conversions", () => {
  assert.deepEqual(ids({ type: "slide", format: "png" }), ["native"], "no PDF/PNG-zip from a non-PPTX");
  assert.deepEqual(ids({ type: "essay", format: "zip" }), ["native"]);
  assert.deepEqual(ids({ type: "podcast", format: "wav" }), ["native"]);
  assert.deepEqual(ids({ type: "glossary", format: "pptx" }), ["native", "pdf"]);
  // Stored format case does not matter.
  assert.deepEqual(ids({ type: "slide", format: "PPTX" }), ["native", "pdf", "slides-png"]);
});

test("unknown tool type gets the stored file only (server rejects everything else)", () => {
  assert.deepEqual(ids({ type: "nope", format: "docx" }), ["native"]);
  assert.deepEqual(ids({ type: "__proto__", format: "docx" }), ["native"]);
  assert.deepEqual(ids({ type: "toString", format: "docx" }), ["native"]);
  const n = downloadFormats({ type: "nope", format: "bin" }, ON)[0]!;
  assert.equal(n.label, "Fayl (BIN)");
  assert.equal(n.mime, "application/octet-stream");
});

test("formatById validates against the generation's own list", () => {
  const slide = { type: "slide", format: "pptx" };
  assert.equal(formatById(slide, ON, "pdf")?.id, "pdf");
  assert.equal(formatById(slide, OFF, "pdf"), null, "feature off");
  assert.equal(formatById(slide, ON, "jpg"), null, "not offered for slides");
  assert.equal(formatById(slide, ON, "exe"), null, "not an id");
  assert.equal(formatById({ type: "sorting", format: "docx" }, ON, "results-csv"), null, "no results");
  assert.equal(formatById({ type: "sorting", format: "docx", hasResults: true }, ON, "results-csv")?.ext, "csv");
});

test("isDownloadFormatId accepts exactly the registry ids", () => {
  for (const id of DOWNLOAD_FORMAT_IDS) assert.ok(isDownloadFormatId(id), id);
  for (const v of ["", "PDF", "png", "image:abc", null, undefined, 1, {}, "native "]) {
    assert.equal(isDownloadFormatId(v), false, String(v));
  }
  assert.deepEqual(
    [...DOWNLOAD_FORMAT_IDS].sort(),
    ["glossary-csv", "jpg", "native", "pdf", "results-csv", "slides-png", "transcript-txt"],
  );
});

test("every format id is reachable from some tool (no dead ids)", () => {
  const seen = new Set<string>();
  for (const [type, row] of Object.entries(MATRIX)) {
    for (const f of downloadFormats({ type, format: row.format, hasResults: true }, ON)) seen.add(f.id);
  }
  assert.deepEqual([...seen].sort(), [...DOWNLOAD_FORMAT_IDS].sort());
});

test("labels and extensions of derived formats", () => {
  const all = new Map(
    Object.entries(MATRIX).flatMap(([type, row]) =>
      downloadFormats({ type, format: row.format, hasResults: true }, ON).map((f) => [f.id, f] as const),
    ),
  );
  assert.equal(all.get("pdf")!.label, "PDF");
  assert.equal(all.get("pdf")!.mime, "application/pdf");
  assert.equal(all.get("slides-png")!.label, "Slaydlar rasm (PNG, ZIP)");
  assert.equal(all.get("slides-png")!.ext, "zip");
  assert.equal(all.get("transcript-txt")!.ext, "txt");
  assert.equal(all.get("glossary-csv")!.ext, "csv");
  assert.equal(all.get("results-csv")!.ext, "csv");
  assert.equal(all.get("slides-png")!.cost, "convert");
  assert.equal(all.get("transcript-txt")!.cost, "instant");
});

test("defaultShareFormat is the stored file, also for the resume", () => {
  assert.equal(defaultShareFormat({ type: "resume", format: "docx" }).id, "native");
  assert.equal(defaultShareFormat({ type: "resume", format: "docx" }).ext, "docx");
  assert.equal(defaultShareFormat({ type: "slide", format: "pptx" }).label, "PowerPoint (PPTX)");
  assert.equal(defaultShareFormat({ type: "image", format: "zip", imageCount: 3 }).hint, "3 ta rasm");
});

test("downloadSubject reads translation kind and image count from the row's doc", () => {
  assert.deepEqual(downloadSubject({ type: "slide", format: "pptx" }), { type: "slide", format: "pptx" });
  assert.deepEqual(
    downloadSubject({ type: "translation", format: "xlsx", doc: { translation: { sourceKind: "xlsx" } } }),
    { type: "translation", format: "xlsx", translationKind: "xlsx" },
  );
  assert.deepEqual(
    downloadSubject({ type: "image", format: "zip", doc: { images: [{}, {}, {}] } }),
    { type: "image", format: "zip", imageCount: 3 },
  );
  assert.deepEqual(
    downloadSubject({ type: "sorting", format: "docx", doc: null }, { hasResults: true }),
    { type: "sorting", format: "docx", hasResults: true },
  );
});
