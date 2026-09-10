import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";

/**
 * «O'z shablonim» — yuklash serveri (Shablonlar 2, B1).
 *
 * `logo.test.mts` naqshi: `uploadTemplate` autentifikatsiyadan ajratilgan,
 * oddiy `Request` bilan chaqiriladi; saqlash (`put`) va rasterlash
 * (`rasterize`) seam orqali almashtiriladi — DB kerak emas. Haqiqiy
 * rasterlash alohida testda, LibreOffice + pdftoppm bo'lsa.
 */
process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";

const { ApiError } = await import("../lib/server/api.ts");
const { uploadTemplate, looksLikePptx, pgmIsDark, rasterizeTemplate, TEMPLATE_MAX_BYTES } = await import("../lib/server/template-upload.ts");
const { parsePptxTemplate } = await import("../lib/generation/pptx-template.ts");
import type { TemplateProfile } from "../lib/generation/pptx-template.ts";

async function fixture(opts: { placeholders?: boolean; dark?: boolean } = {}): Promise<Buffer> {
  const PptxGenJS = (await import("pptxgenjs")).default;
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "WIDE", width: 13.333, height: 7.5 });
  pptx.layout = "WIDE";
  pptx.defineSlideMaster({
    title: "COVER",
    background: { color: opts.dark === false ? "FFFFFF" : "0B1F3A" },
    objects:
      opts.placeholders === false
        ? [{ rect: { x: 0, y: 0, w: 13.333, h: 0.4, fill: { color: "C9A227" } } }]
        : [
            { placeholder: { options: { name: "t", type: "title", x: 0.8, y: 2.2, w: 11.7, h: 1.6, color: "FFFFFF" }, text: "S" } },
            { placeholder: { options: { name: "s", type: "body", x: 0.8, y: 4.0, w: 11.7, h: 1.0, color: "C9A227" }, text: "I" } },
          ],
  });
  pptx.defineSlideMaster({
    title: "CONTENT",
    background: { color: "F7F4EC" },
    objects:
      opts.placeholders === false
        ? []
        : [
            { placeholder: { options: { name: "t", type: "title", x: 0.7, y: 0.5, w: 11.9, h: 1.0 }, text: "S" } },
            { placeholder: { options: { name: "b", type: "body", x: 0.7, y: 1.7, w: 11.9, h: 4.9 }, text: "M" } },
          ],
  });
  pptx.addSlide({ masterName: "COVER" }).addText("Eski", opts.placeholders === false ? { x: 1, y: 1, w: 4, h: 1 } : { placeholder: "t" });
  return (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
}

function blobPart(b: Buffer): Uint8Array<ArrayBuffer> {
  const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  return new Uint8Array(ab);
}

function formReq(file: File | null, headers: Record<string, string> = {}): Request {
  const fd = new FormData();
  if (file) fd.set("file", file);
  return new Request("http://x/api/uploads/template", { method: "POST", headers, body: file ? fd : undefined });
}

async function expectApiError(p: Promise<unknown>, status: number) {
  try {
    await p;
  } catch (e) {
    assert.ok(e instanceof ApiError, `ApiError kutilgan edi, keldi: ${e}`);
    assert.equal((e as InstanceType<typeof ApiError>).status, status);
    return e as InstanceType<typeof ApiError>;
  }
  assert.fail(`xato tashlanishi kerak edi (status ${status})`);
}

const noRaster = async () => ({});
type PutArgs = { userId: string; name: string; size: number; profile: TemplateProfile; previews: unknown };
function capturePut(sink: PutArgs[]) {
  return async (userId: string, bytes: Buffer, name: string, profile: TemplateProfile, previews: unknown) => {
    sink.push({ userId, name, size: bytes.byteLength, profile, previews });
    return { assetId: "a".repeat(24), name, size: bytes.byteLength, template: { assetId: "a".repeat(24), name, profile, previews: {} } };
  };
}

test("looksLikePptx: zip imzosi + ppt/presentation.xml; PNG/DOCX emas", async () => {
  assert.ok(looksLikePptx(await fixture()));
  assert.ok(!looksLikePptx(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])));
  const fakeZip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("word/document.xml".padEnd(40, " "))]);
  assert.ok(!looksLikePptx(fakeZip), "DOCX zip — PPTX emas");
});

test("uploadTemplate: yaroqli PPTX → tahlil + saqlash; nom va profil to'g'ri", async () => {
  const puts: PutArgs[] = [];
  const bytes = await fixture();
  const file = new File([blobPart(bytes)], "Mening namunam.pptx", { type: "application/octet-stream" });
  const res = await uploadTemplate(formReq(file), "7", { put: capturePut(puts), rasterize: noRaster });
  assert.equal(puts.length, 1);
  assert.equal(puts[0].userId, "7");
  assert.equal(puts[0].name, "Mening namunam.pptx");
  assert.equal(puts[0].size, bytes.byteLength);
  assert.ok(puts[0].profile.roles.cover && puts[0].profile.roles.content, "rollar");
  assert.equal(res.template.profile.size.w, 13.333);
});

test("uploadTemplate: content-length 20 MB dan katta — tana o'qilmasdan 413", async () => {
  const req = formReq(null, { "content-length": String(TEMPLATE_MAX_BYTES + 1024 * 1024) });
  await expectApiError(uploadTemplate(req, "1", { put: capturePut([]), rasterize: noRaster }), 413);
});

test("uploadTemplate: fayl yo'q — 400; PNG baytlar .pptx nomi bilan — 415 (baytdan, nomdan emas)", async () => {
  await expectApiError(uploadTemplate(formReq(null), "1", { put: capturePut([]), rasterize: noRaster }), 400);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
  const file = new File([blobPart(png)], "x.pptx", { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
  await expectApiError(uploadTemplate(formReq(file), "1", { put: capturePut([]), rasterize: noRaster }), 415);
});

test("uploadTemplate: placeholder'siz namuna — 422 no-content, saqlanmaydi", async () => {
  const puts: PutArgs[] = [];
  const file = new File([blobPart(await fixture({ placeholders: false }))], "bosh.pptx");
  const e = await expectApiError(uploadTemplate(formReq(file), "1", { put: capturePut(puts), rasterize: noRaster }), 422);
  assert.equal(e.extra.code, "no-content");
  assert.equal(puts.length, 0);
});

test("pgmIsDark: P5 o'rtacha yorqinlik", () => {
  const mk = (v: number) => Buffer.concat([Buffer.from("P5\n4 2\n255\n", "latin1"), Buffer.alloc(8, v)]);
  assert.equal(pgmIsDark(mk(20)), true);
  assert.equal(pgmIsDark(mk(230)), false);
  assert.equal(pgmIsDark(Buffer.from("junk")), false);
});

test("rasterizeTemplate: pdftoppm yo'q → {} (yuklash yiqilmaydi)", async () => {
  const bytes = await fixture();
  const profile = await parsePptxTemplate(bytes);
  assert.deepEqual(await rasterizeTemplate(bytes, profile, { pdftoppm: null }), {});
});

test(
  "rasterizeTemplate (LibreOffice + pdftoppm): har rol uchun PNG, muqova qorong'i, mazmun och",
  { skip: !existsSync("/usr/bin/soffice") || !existsSync("/usr/bin/pdftoppm") },
  async () => {
    const bytes = await fixture();
    const profile = await parsePptxTemplate(bytes);
    const previews = await rasterizeTemplate(bytes, profile);
    assert.ok(previews.cover?.png.startsWith("data:image/png;base64,"), "muqova PNG");
    assert.ok(previews.content?.png.startsWith("data:image/png;base64,"), "mazmun PNG");
    assert.equal(previews.cover!.dark, true, "0B1F3A fon — qorong'i");
    assert.equal(previews.content!.dark, false, "F7F4EC fon — och");
    assert.notEqual(previews.cover!.png, previews.content!.png, "ikki har xil layout — ikki har xil rasm");
    assert.ok(previews.cover!.png.length < 400_000, `PNG hajmi oqilona: ${previews.cover!.png.length}`);
  },
);

test("extractAssets: customTemplate fon PNG lari aktivga chiqadi (bir xil rasm bir marta)", async () => {
  const { extractAssets } = await import("../lib/server/assets.ts");
  const png = `data:image/png;base64,${Buffer.alloc(96, 7).toString("base64")}`;
  const doc = {
    meta: {} as never,
    titlePage: false,
    toc: false,
    sections: [],
    customTemplate: { assetId: "a".repeat(24), name: "n.pptx", profile: {} as never, previews: { cover: { png, dark: true }, section: { png, dark: true } } },
  } as never;
  const out = extractAssets("11111111-1111-4111-8111-111111111111", doc, "");
  assert.equal(out.assets.length, 1, "bitta aktiv");
  const prev = (out.doc as { customTemplate: { previews: Record<string, { png: string; dark: boolean }> } }).customTemplate.previews;
  assert.match(prev.cover.png, /^\/api\/generations\//);
  assert.equal(prev.cover.png, prev.section.png);
  assert.equal(prev.cover.dark, true);
});
