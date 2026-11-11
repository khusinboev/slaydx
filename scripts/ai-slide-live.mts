#!/usr/bin/env node
/**
 * AI slide live run (docs/ai-slide/SPEC.md): builds one real deck through `buildArtifact` with the real Gemini key
 * and writes the PPTX, the doc JSON and every slide picture to `eval-out/ai-slide/<case>/`. Paid: ≈ $0.07 per slide
 * (Nano Banana 2.1) or ≈ $0.21 (Pro) plus the text call.
 *
 *   npx tsx --conditions=react-server scripts/ai-slide-live.mts <case> [slides] [model] [style]
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildArtifact } from "../lib/generation/index.ts";
import { TOOL_BY_ID } from "../lib/tools.ts";

const CASES: Record<string, Record<string, string | number>> = {
  kimyo: { topic: "Kislotalarning turlari va asosiy xossalari", subject: "Kimyo", audience: "school", author: "Aliyev Ali", organization: "12-maktab" },
  fizika: { topic: "Nyutonning harakat qonunlari", subject: "Fizika", audience: "school", extra: "Har bir qonunga formula va hayotiy misol" },
  geometriya: { topic: "Uchburchaklar va ularning xossalari", subject: "Geometriya", audience: "school_low" },
  biznes: { topic: "Kichik biznesda raqamli marketing", audience: "business", author: "Karimova Dilnoza" },
};

const name = process.argv[2] ?? "kimyo";
const slides = Number(process.argv[3] ?? 5);
const model = process.argv[4] ?? "nb21";
const style = process.argv[5] ?? "clean";
const values = { ...CASES[name], language: "uz", slideCount: slides, imageModel: model, slideStyle: style };
const out = path.join("eval-out", "ai-slide", `${name}-${model}-${style}-${slides}`);
await mkdir(out, { recursive: true });
const started = Date.now();
const events: string[] = [];
const file = await buildArtifact(TOOL_BY_ID["image-slide"], values, {
  deadline: Date.now() + 640_000,
  onProgress: (ev) => events.push(`${Math.round((Date.now() - started) / 1000)}s ${ev.type}${"index" in ev ? ` #${ev.index}` : ""}${"stage" in ev ? ` ${ev.stage}` : ""}`),
});
await writeFile(path.join(out, "deck.pptx"), file.bytes);
const doc = file.doc!;
for (const [i, s] of (doc.slides ?? []).entries()) {
  const m = s.image?.url.match(/^data:image\/jpeg;base64,(.+)$/);
  if (m) await writeFile(path.join(out, `slide-${String(i + 1).padStart(2, "0")}.jpg`), Buffer.from(m[1], "base64"));
}
const slim = { ...doc, slides: doc.slides?.map((s) => ({ ...s, image: s.image ? { alt: s.image.alt, url: `${s.image.url.length} chars` } : undefined })) };
await writeFile(path.join(out, "deck.doc.json"), JSON.stringify(slim, null, 2));
console.log(JSON.stringify({ out, seconds: Math.round((Date.now() - started) / 1000), pptxKB: Math.round(file.bytes.length / 1024), slides: doc.slides?.length, drawn: doc.slideImages, delivered: file.delivered, cost: file.cost }, null, 2));
console.log(events.join("\n"));
