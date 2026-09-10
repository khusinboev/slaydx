import test from "node:test";
import assert from "node:assert/strict";
import { parsePptxTemplate, TemplateError } from "../lib/generation/pptx-template.ts";

/**
 * «O'z shablonim» — PPTX tahlilchisi (Sprint B, B1).
 *
 * Fikstura pptxgenjs bilan yasaladi: masterda `title`/`body` placeholder'lar,
 * ikki slayd. Tahlilchi slaydlarni emas, layoutlarni o'qiydi.
 */
async function fixture(opts: { placeholders?: boolean } = {}): Promise<Uint8Array> {
  const PptxGenJS = (await import("pptxgenjs")).default;
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "WIDE", width: 13.333, height: 7.5 });
  pptx.layout = "WIDE";
  pptx.theme = { headFontFace: "Georgia", bodyFontFace: "Verdana" };
  pptx.defineSlideMaster({
    title: "NAMUNA",
    background: { color: "F3EFE6" },
    objects: opts.placeholders === false
      ? [{ rect: { x: 0, y: 0, w: 13.333, h: 0.4, fill: { color: "0B1F3A" } } }]
      : [
          { rect: { x: 0, y: 0, w: 13.333, h: 0.4, fill: { color: "0B1F3A" } } },
          { placeholder: { options: { name: "title", type: "title", x: 0.7, y: 0.6, w: 11.9, h: 1.1 }, text: "Sarlavha" } },
          { placeholder: { options: { name: "body", type: "body", x: 0.7, y: 1.9, w: 11.9, h: 4.6 }, text: "Matn" } },
        ],
  });
  const s1 = pptx.addSlide({ masterName: "NAMUNA" });
  s1.addText("Namuna sarlavha", { placeholder: "title" });
  const s2 = pptx.addSlide({ masterName: "NAMUNA" });
  s2.addText("Ikkinchi", { placeholder: "title" });
  const buf = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
  return new Uint8Array(buf);
}

test("PPTX namunasi: o'lcham, tema ranglari/shriftlari, layout placeholder'lari (dyuym) va rollar", async () => {
  const p = await parsePptxTemplate(await fixture());
  assert.equal(p.size.w, 13.333);
  assert.equal(p.size.h, 7.5);
  assert.ok(p.layouts.length >= 1, "kamida bitta layout");
  const lay = p.layouts.find((l) => l.placeholders.some((x) => x.type === "title"))!;
  assert.ok(lay, "sarlavha placeholder'li layout");
  const title = lay.placeholders.find((x) => x.type === "title")!;
  const body = lay.placeholders.find((x) => x.type === "body")!;
  assert.ok(title.box && body.box, "placeholder qutilari");
  assert.ok(Math.abs(title.box!.x - 0.7) < 0.02 && Math.abs(title.box!.w - 11.9) < 0.02, `sarlavha qutisi dyuymda: ${JSON.stringify(title.box)}`);
  assert.ok(Math.abs(body.box!.y - 1.9) < 0.02 && Math.abs(body.box!.h - 4.6) < 0.02, `tana qutisi: ${JSON.stringify(body.box)}`);
  assert.equal(lay.kind, "content");
  assert.equal(p.roles.content, lay.path);
  assert.ok(p.roles.cover && p.roles.section && p.roles.blank, "rollar to'ldirilgan");
  // Tema: pptxgenjs `theme1.xml` — ranglar va bizning shriftlar.
  assert.match(p.colors.dk1 ?? "", /^#[0-9A-F]{6}$/);
  assert.match(p.colors.accent1 ?? "", /^#[0-9A-F]{6}$/);
  assert.equal(p.fonts.major, "Georgia");
  assert.equal(p.fonts.minor, "Verdana");
  assert.ok(p.masterPath.startsWith("ppt/slideMasters/"));
  assert.ok(p.themePath?.startsWith("ppt/theme/"));
});

test("PPTX emas → not-pptx; placeholder'siz namuna → no-content", async () => {
  await assert.rejects(parsePptxTemplate(new TextEncoder().encode("salom")), (e: unknown) => e instanceof TemplateError && e.code === "not-pptx");
  // Zip, lekin presentation.xml yo'q.
  const JSZip = (await import("jszip")).default;
  const z = new JSZip();
  z.file("x.txt", "1");
  await assert.rejects(parsePptxTemplate(await z.generateAsync({ type: "uint8array" })), (e: unknown) => e instanceof TemplateError && e.code === "not-pptx");
  // MUTATSIYA: `usable`/`roles.content` tekshiruvi olib tashlansa — placeholder'siz fayl «shablon» bo'lib o'tib ketadi.
  await assert.rejects(parsePptxTemplate(await fixture({ placeholders: false })), (e: unknown) => e instanceof TemplateError && e.code === "no-content");
});
