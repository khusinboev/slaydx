import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import sharp from "sharp";
import { renderPptx } from "../lib/generation/render-pptx.ts";
import { renderPptxWithTemplate } from "../lib/generation/render-pptx-template.ts";
import { parsePptxTemplate } from "../lib/generation/pptx-template.ts";
import { IMAGE_COMPACT, IMAGE_NORMAL, PPTX_SIZE_LIMIT, shrinkBuffer } from "../lib/generation/pptx-image.ts";
import { MAX_FILE_BYTES } from "../lib/server/storage.ts";
import { extractMeta } from "../lib/generation/meta.ts";
import { TOOL_BY_ID } from "../lib/tools.ts";
import type { AcademicDoc } from "../lib/generation/types.ts";
import type { SlideModel } from "../lib/generation/slide-types.ts";

/**
 * PPTX hajmi (prod 2026-10-10): 20 slaydli dekalar ~28 MB chiqib, 25 MB chegarada
 * yiqilardi — rasmlar provayder bergan holda, o'lchamsiz joylanardi.
 *
 *  - rasm joylashda kichraytiriladi (uzun tomon 1600 px, JPEG q80; alfa bo'lsa PNG; kattalashtirilmaydi);
 *  - fayl baribir katta bo'lsa BITTA marta kuchliroq siqish (1100 px, q70) bilan qayta paketlanadi;
 *  - shablonli dekalar ishlayveradi.
 */

/** Siqilmaydigan shovqinli PNG (haqiqiy generatsiya rasmi kabi og'ir). */
async function noisePng(w: number, h: number, alpha = false): Promise<Buffer> {
  return sharp({
    create: { width: w, height: h, channels: alpha ? 4 : 3, background: { r: 120, g: 120, b: 120, ...(alpha ? { alpha: 0.5 } : {}) }, noise: { type: "gaussian", mean: 128, sigma: 40 } },
  })
    .png({ compressionLevel: 1 })
    .toBuffer();
}

const dataUrl = (buf: Buffer, mime = "image/png") => `data:${mime};base64,${buf.toString("base64")}`;

function doc(images: string[]): AcademicDoc {
  const meta = extractMeta(TOOL_BY_ID.slide, { topic: "Fotosintez", slideTemplate: "lecture", slideTheme: "atlas" } as never);
  const slides: SlideModel[] = images.map((url, i) => ({
    id: `s${i}`,
    layout: i === 0 ? "title" : "bullets",
    bullets: ["Birinchi band", "Ikkinchi band"],
    title: `Slayd ${i + 1}`,
    subtitle: "Izoh",
    image: { url },
  }));
  return { meta, titlePage: false, toc: false, sections: [], slides, slideTemplate: "lecture", slideVisual: "academic" };
}

async function media(bytes: Uint8Array): Promise<{ name: string; size: number; w: number; h: number; format: string }[]> {
  const zip = await JSZip.loadAsync(bytes);
  const out = [];
  for (const name of Object.keys(zip.files).filter((n) => /^ppt\/media\/[^/]+$/.test(n))) {
    const buf = await zip.file(name)!.async("nodebuffer");
    const m = await sharp(buf).metadata();
    out.push({ name, size: buf.byteLength, w: m.width ?? 0, h: m.height ?? 0, format: m.format ?? "" });
  }
  return out;
}

// 10 ta ~7 MB shovqinli PNG ≈ 70 MB asl — 25 MB dan ancha ortiq.
const N = 10;
let ORIGINALS: Buffer[] = [];
test.before(async () => {
  ORIGINALS = await Promise.all(Array.from({ length: N }, (_, i) => noisePng(2000 + i, 1400)));
});

test("chegara: storage.ts MAX_FILE_BYTES va PPTX_SIZE_LIMIT bitta qiymat (25 MB)", () => {
  assert.equal(MAX_FILE_BYTES, PPTX_SIZE_LIMIT);
  assert.equal(PPTX_SIZE_LIMIT, 25 * 1024 * 1024);
});

test("katta rasmli deka: kichraytirishsiz chegaradan oshardi, endi ≤ 25 MB; rasmlar ≤ 1600 px JPEG", async () => {
  const urls = ORIGINALS.map((b) => dataUrl(b));
  const raw = ORIGINALS.reduce((a, b) => a + b.byteLength, 0);
  assert.ok(raw > PPTX_SIZE_LIMIT, `sinov asosi: asl rasmlar ${raw} bayt chegaradan katta bo'lishi kerak`);

  const packs: string[] = [];
  const file = await renderPptx(doc(urls), "t.pptx", { onPack: (p) => packs.push(p) });
  // MUTATSIYA: `shrinkImage` chaqirilmasa fayl ≥ asl rasmlar yig'indisi bo'ladi — shu qator qizaradi.
  assert.ok(file.bytes.byteLength <= PPTX_SIZE_LIMIT, `fayl ${file.bytes.byteLength} bayt`);
  assert.ok(file.bytes.byteLength < raw / 4, `kichraytirish samarasi: ${file.bytes.byteLength} < ${raw}/4`);
  assert.deepEqual(packs, ["normal"], "yetarli bo'lsa qayta paketlash KERAK EMAS");

  const m = await media(file.bytes);
  assert.ok(m.length >= N, `media soni ${m.length}`);
  for (const x of m) {
    assert.ok(Math.max(x.w, x.h) <= IMAGE_NORMAL.maxSide, `${x.name}: ${x.w}×${x.h}`);
    assert.equal(x.format, "jpeg", `${x.name} shaffofsiz PNG → JPEG`);
  }
  // Slayd o'lchamida sifat: kamida 1000 px (kattalashtirilmagan, 1600 ga yaqin).
  assert.ok(m.every((x) => Math.max(x.w, x.h) >= 1000), "ortiqcha kichraymagan");
});

test("qayta paketlash faqat kerak bo'lganda: chegaradan oshsa BITTA kuchliroq siqish; undan keyin ham katta bo'lsa — qaytaradi (storage yiqitadi)", async () => {
  const urls = ORIGINALS.slice(0, 4).map((b) => dataUrl(b));
  const packs: { p: string; n: number }[] = [];
  // Sun'iy past chegara: normal paket undan katta, compact kichik.
  const normal = await renderPptx(doc(urls), "t.pptx");
  const limit = normal.bytes.byteLength - 1;
  const out = await renderPptx(doc(urls), "t.pptx", { sizeLimit: limit, onPack: (p, n) => packs.push({ p, n }) });
  assert.deepEqual(packs.map((x) => x.p), ["normal", "compact"], "chegaradan oshdi → aynan bitta qayta paket");
  assert.ok(packs[1].n < packs[0].n, `compact kichikroq: ${packs[1].n} < ${packs[0].n}`);
  assert.equal(out.bytes.byteLength, packs[1].n);
  const m = await media(out.bytes);
  for (const x of m) assert.ok(Math.max(x.w, x.h) <= IMAGE_COMPACT.maxSide, `${x.name}: ${x.w}×${x.h}`);

  // Hatto compact ham sig'masa: ikkinchi qayta urinish YO'Q (aynan 2 paket) va bayt qaytadi.
  const packs2: string[] = [];
  const tiny = await renderPptx(doc(urls), "t.pptx", { sizeLimit: 1_000, onPack: (p) => packs2.push(p) });
  assert.deepEqual(packs2, ["normal", "compact"]);
  assert.ok(tiny.bytes.byteLength > 1_000);
});

test("kichik/kichraytirilgan rasm tegilmaydi; kattalashtirilmaydi; alfali PNG PNG bo'lib qoladi", async () => {
  const smallJpeg = await sharp({ create: { width: 800, height: 600, channels: 3, background: "#336699" } }).jpeg({ quality: 80 }).toBuffer();
  assert.equal(await shrinkBuffer(smallJpeg, "jpg", IMAGE_NORMAL), null, "kichik JPEG qayta kodlanmaydi");

  const bigAlpha = await noisePng(1800, 1200, true);
  const a = await shrinkBuffer(bigAlpha, "png", IMAGE_NORMAL);
  assert.ok(a, "katta alfali PNG kichraytiriladi");
  assert.equal(a.type, "png", "shaffoflik saqlanadi");
  assert.ok(Math.max(a.w, a.h) <= 1600);
  assert.ok(a.bytes.byteLength < bigAlpha.byteLength);

  const mid = await noisePng(1000, 700);
  const m = await shrinkBuffer(mid, "png", IMAGE_NORMAL);
  assert.ok(m && m.type === "jpg", "shaffofsiz PNG → JPEG");
  assert.equal(m.w, 1000, "kattalashtirilmaydi / o'lcham saqlanadi");

  assert.equal(await shrinkBuffer(Buffer.from("not an image"), "png", IMAGE_NORMAL), null, "dekodlanmasa — asl holicha");
});

test("shablonli deka ishlaydi: rasm kichrayadi, namuna master/layoutlari saqlanadi", async () => {
  const PptxGenJS = (await import("pptxgenjs")).default;
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "WIDE", width: 13.333, height: 7.5 });
  pptx.layout = "WIDE";
  pptx.defineSlideMaster({
    title: "COVER",
    background: { color: "0B1F3A" },
    objects: [
      { placeholder: { options: { name: "t", type: "title", x: 0.8, y: 2.2, w: 11.7, h: 1.6, color: "FFFFFF", fontSize: 40 }, text: "Sarlavha" } },
      { placeholder: { options: { name: "s", type: "body", x: 0.8, y: 4.0, w: 11.7, h: 1.0, color: "C9A227", fontSize: 18 }, text: "Izoh" } },
    ],
  });
  pptx.defineSlideMaster({
    title: "CONTENT",
    background: { color: "F7F4EC" },
    objects: [
      { placeholder: { options: { name: "t", type: "title", x: 0.7, y: 0.5, w: 11.9, h: 1.0, fontSize: 28 }, text: "Sarlavha" } },
      { placeholder: { options: { name: "b", type: "body", x: 0.7, y: 1.7, w: 11.9, h: 4.9, fontSize: 18 }, text: "Matn" } },
    ],
  });
  pptx.defineSlideMaster({
    title: "PICTURE",
    background: { color: "FFFFFF" },
    objects: [
      { placeholder: { options: { name: "t", type: "title", x: 0.7, y: 0.5, w: 11.9, h: 1.0, fontSize: 28 }, text: "Sarlavha" } },
      { placeholder: { options: { name: "b", type: "body", x: 0.7, y: 1.7, w: 6.0, h: 4.9, fontSize: 18 }, text: "Matn" } },
      { placeholder: { options: { name: "p", type: "pic", x: 7.2, y: 1.7, w: 5.4, h: 4.9 }, text: "" } },
    ],
  });
  pptx.addSlide({ masterName: "COVER" }).addText("Eski muqova", { placeholder: "t" });
  pptx.addSlide({ masterName: "PICTURE" }).addText("Eski rasmli", { placeholder: "t" });
  pptx.addSlide({ masterName: "CONTENT" }).addText("Eski mazmun", { placeholder: "t" });
  // pptxgenjs writes no `type` for a pic placeholder: patch the PICTURE layout's third placeholder (idx 102) to a real picture placeholder.
  const zip0 = await JSZip.loadAsync((await pptx.write({ outputType: "nodebuffer" })) as Buffer);
  for (const n of Object.keys(zip0.files).filter((x) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(x))) {
    const xml = await zip0.file(n)!.async("string");
    const next = xml.replace(/<p:ph(\s+)idx="102"/, '<p:ph type="pic" idx="102"');
    if (next !== xml) zip0.file(n, next);
  }
  const tpl = await zip0.generateAsync({ type: "uint8array" });
  const profile = await parsePptxTemplate(tpl);

  assert.ok(Object.values(profile.roles).length > 0 && profile.layouts.some((l) => l.placeholders.some((p) => p.type === "pic")), "fikstura: rasm placeholder'i bor");
  const urls = ORIGINALS.slice(0, 3).map((b) => dataUrl(b));
  const d = doc(urls);
  const packs: string[] = [];
  const out = await renderPptxWithTemplate(d, "namuna.pptx", tpl, profile, { onPack: (p) => packs.push(p) });
  const zip = await JSZip.loadAsync(out.bytes);
  assert.ok(Object.keys(zip.files).filter((n) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(n)).length >= 2, "namuna layoutlari saqlangan");
  assert.ok(Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).length === d.slides!.length);
  assert.deepEqual(packs, ["normal"]);
  const m = await media(out.bytes);
  assert.ok(m.length >= 1, "rasm joylangan");
  for (const x of m) assert.ok(Math.max(x.w, x.h) <= IMAGE_NORMAL.maxSide, `${x.name}: ${x.w}×${x.h}`);
  const rawSum = ORIGINALS.slice(0, 3).reduce((a, b) => a + b.byteLength, 0);
  assert.ok(out.bytes.byteLength < rawSum / 3, `shablonli deka ham kichik: ${out.bytes.byteLength}`);

  // Chegaradan oshsa shablonli deka ham BITTA qayta paketlanadi.
  const packs2: string[] = [];
  await renderPptxWithTemplate(d, "namuna.pptx", tpl, profile, { sizeLimit: out.bytes.byteLength - 1, onPack: (p) => packs2.push(p) });
  assert.deepEqual(packs2, ["normal", "compact"]);
});
