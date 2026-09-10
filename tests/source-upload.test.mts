import test from "node:test";
import assert from "node:assert/strict";

/**
 * Tarjima manbasini yuklash (Tarjimon 2, WP1).
 *
 * `template-upload.test.mts` naqshi: `uploadSource` autentifikatsiyadan
 * ajratilgan va oddiy Web `Request` bilan chaqiriladi; saqlash (`put`) va
 * o'lchash (`count`) seam orqali almashtiriladi — baza ham, `unpdf` ham
 * kerak emas.
 *
 * NEGA bu testlar muhim: `chars` — PUL maydoni (narx shundan
 * hisoblanadi), `sniffSourceKind` esa yagona darvoza (nomga emas,
 * baytga qaraydi). Ikkalasi ham jim buzilsa hech kim sezmasdi.
 */
process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";

const { ApiError } = await import("../lib/server/api.ts");
const { uploadSource, sniffSourceKind, SOURCE_MAX_BYTES } = await import("../lib/server/source-upload.ts");
const { SOURCE_MIME } = await import("../lib/generation/source-types.ts");
import type { SourceKind, SourceUploadResult } from "../lib/generation/source-types.ts";

/* ─────────────────────────── fikstura ─────────────────────────── */

async function docxBytes(): Promise<Buffer> {
  const { Document, Packer, Paragraph, TextRun } = await import("docx");
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ text: "Sinov sarlavhasi", heading: "Heading1" }),
          new Paragraph({ children: [new TextRun("Bu oddiy paragraf matni.")] }),
        ],
      },
    ],
  });
  return Packer.toBuffer(doc) as unknown as Promise<Buffer>;
}

async function pptxBytes(): Promise<Buffer> {
  const PptxGenJS = (await import("pptxgenjs")).default;
  const pptx = new PptxGenJS();
  pptx.addSlide().addText("Birinchi slayd", { x: 1, y: 1, w: 6, h: 1 });
  return (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
}

/** Haqiqiy PNG bosh baytlari — «.docx deb nomlangan rasm» holati uchun. */
const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1]);

function fileOf(bytes: Buffer, name: string): File {
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new File([new Uint8Array(ab)], name);
}

function formReq(file: File | null, headers: Record<string, string> = {}): Request {
  const fd = new FormData();
  if (file) fd.set("file", file);
  return new Request("http://x/api/uploads/source", { method: "POST", headers, body: file ? fd : undefined });
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

type PutArgs = { userId: string; size: number; name: string; kind: SourceKind; mime: string; chars: number; text: string };

function capturePut(sink: PutArgs[]) {
  return async (
    userId: string,
    bytes: Buffer,
    row: { name: string; kind: SourceKind; mime: string; chars: number; text: string },
  ): Promise<SourceUploadResult> => {
    sink.push({ userId, size: bytes.byteLength, ...row });
    return {
      assetId: "a".repeat(24),
      name: row.name,
      kind: row.kind,
      size: bytes.byteLength,
      chars: row.chars,
      text: row.text.slice(0, 20_000),
      truncatedPreview: row.text.length > 20_000,
    };
  };
}

/** Belgilangan sonni qaytaradigan o'lchagich — `DEFAULT_COUNTER` o'rniga. */
function fixedCount(chars: number, extra: { pages?: number } = {}) {
  return async () => ({ chars, text: "x".repeat(chars), ...extra });
}

/* ─────────────────────────── sniff ─────────────────────────── */

test("sniffSourceKind: kengaytma VA magic bayt — ikkalasi ham talab qilinadi", async () => {
  const docx = await docxBytes();
  const pptx = await pptxBytes();

  assert.equal(sniffSourceKind("hisobot.docx", docx), "docx");
  assert.equal(sniffSourceKind("taqdimot.pptx", pptx), "pptx");

  /*
   * ENG MUHIM holat: uchala OOXML ham ZIP. Faqat imzoga qarasak
   * DOCX «PPTX» deb qabul qilinar va adapter noto'g'ri yo'l tanlardi.
   */
  assert.equal(sniffSourceKind("hisobot.pptx", docx), null, "DOCX bayti .pptx nomi bilan o'tmasligi kerak");
  assert.equal(sniffSourceKind("taqdimot.docx", pptx), null, "PPTX bayti .docx nomi bilan o'tmasligi kerak");
  assert.equal(sniffSourceKind("jadval.xlsx", docx), null);

  // PNG `.docx` nomi bilan — ZIP imzosi yo'q.
  assert.equal(sniffSourceKind("rasm.docx", PNG_HEAD), null);

  // PDF — `%PDF-` imzosi.
  assert.equal(sniffSourceKind("maqola.pdf", Buffer.from("%PDF-1.7\n%\xE2\xE3\xCF\xD3\n", "latin1")), "pdf");
  assert.equal(sniffSourceKind("maqola.pdf", Buffer.from("Bu oddiy matn, PDF emas")), null);

  // Matn turlari: imzo yo'q, lekin NOL bayt — binar belgisi.
  assert.equal(sniffSourceKind("xat.txt", Buffer.from("Salom dunyo")), "txt");
  assert.equal(sniffSourceKind("qayd.md", Buffer.from("# Sarlavha\n\nMatn")), "md");
  assert.equal(sniffSourceKind("jadval.csv", Buffer.from("a,b\n1,2")), "csv");
  assert.equal(
    sniffSourceKind("xat.txt", Buffer.from([0x53, 0x61, 0x00, 0x6c, 0x6f, 0x6d])),
    null,
    "NOL bayti bor fayl matn emas",
  );

  // Ro'yxatda yo'q formatlar.
  assert.equal(sniffSourceKind("kitob.doc", Buffer.from("anything")), null);
  assert.equal(sniffSourceKind("nomsiz", Buffer.from("anything")), null);
});

/* ─────────────────────────── uploadSource ─────────────────────────── */

test("uploadSource: content-length 20 MB dan katta — tana O'QILMASDAN 413", async () => {
  const req = formReq(fileOf(Buffer.from("kichkina matn fayli"), "x.txt"), {
    "content-length": String(SOURCE_MAX_BYTES + 1024 * 1024),
  });
  const e = await expectApiError(uploadSource(req, "1", { count: fixedCount(500) }), 413);
  assert.match(e.message, /20 MB/);
});

test("uploadSource: fayl yo'q — 400", async () => {
  await expectApiError(uploadSource(formReq(null), "1"), 400);
});

test("uploadSource: PNG baytlari .docx nomi bilan — 415 (nomdan emas, BAYTDAN)", async () => {
  const e = await expectApiError(
    uploadSource(formReq(fileOf(PNG_HEAD, "hujjat.docx")), "1", { count: fixedCount(5_000) }),
    415,
  );
  assert.match(e.message, /Format qo'llanmaydi/);
});

test("uploadSource: skaner PDF — 422 `scanned`, saqlanmaydi", async () => {
  const put: PutArgs[] = [];
  /*
   * 3 sahifa, 5 belgi — sahifasiga 20 belgidan kam, ya'ni matn qatlami
   * yo'q. OCR bizda yo'q: pul yechilmasdan aniq xato beriladi, aks holda
   * foydalanuvchi 3 000 tangaga BO'SH hujjat olardi.
   */
  const e = await expectApiError(
    uploadSource(formReq(fileOf(Buffer.from("%PDF-1.7\nxxx"), "skaner.pdf")), "1", {
      count: async () => ({ chars: 5, text: "hello", pages: 3 }),
      put: capturePut(put),
    }),
    422,
  );
  assert.equal(e.extra.code, "scanned");
  assert.match(e.message, /skaner nusxa/);
  assert.equal(put.length, 0, "rad etilgan fayl saqlanmasligi kerak");
});

test("uploadSource: matnli PDF — sahifa qoidasidan o'tadi", async () => {
  const put: PutArgs[] = [];
  // 3 sahifa × 20 = 60; 5 000 belgi undan ancha katta.
  const r = await uploadSource(formReq(fileOf(Buffer.from("%PDF-1.7\nxxx"), "maqola.pdf")), "7", {
    count: async () => ({ chars: 5_000, text: "m".repeat(5_000), pages: 3 }),
    put: capturePut(put),
  });
  assert.equal(r.kind, "pdf");
  assert.equal(r.chars, 5_000);
  assert.equal(put[0].mime, SOURCE_MIME.pdf);
});

test("uploadSource: matn topilmadi (chegaradan qisqa) — 422", async () => {
  const e = await expectApiError(
    uploadSource(formReq(fileOf(Buffer.from("Salom"), "x.txt")), "1", { count: fixedCount(3) }),
    422,
  );
  assert.match(e.message, /tarjima qilinadigan matn topilmadi/i);
});

test("uploadSource: 200 000 dan uzun — 422 `too-long`, xabarda haqiqiy son", async () => {
  const e = await expectApiError(
    uploadSource(formReq(fileOf(Buffer.from("uzun"), "x.txt")), "1", { count: fixedCount(250_000) }),
    422,
  );
  assert.equal(e.extra.code, "too-long");
  assert.equal(e.extra.chars, 250_000);
  assert.match(e.message, /200 000|200 000/);
});

test("uploadSource: DOCX to'g'ri yo'l — nom tozalanadi, preview 20k da kesiladi", async () => {
  const put: PutArgs[] = [];
  const big = "s".repeat(50_000);
  const r = await uploadSource(
    formReq(fileOf(await docxBytes(), "  hisobot\n2026\t.docx  ")),
    "42",
    { count: async () => ({ chars: big.length, text: big }), put: capturePut(put) },
  );

  assert.equal(r.kind, "docx");
  assert.equal(r.chars, 50_000);
  assert.equal(r.text.length, 20_000, "javobdagi ko'rish nusxasi 20 000 da kesiladi");
  assert.equal(r.truncatedPreview, true);

  // `put` ga TOZALANGAN nom boradi: `\n`/`\t` `Content-Disposition` ni buzardi.
  assert.equal(put.length, 1);
  assert.equal(put[0].userId, "42");
  assert.equal(put[0].name, "hisobot 2026 .docx");
  assert.ok(!/[\r\n\t]/.test(put[0].name));
  assert.equal(put[0].kind, "docx");
  assert.equal(put[0].mime, SOURCE_MIME.docx);
  // To'liq matn bazaga boradi — kesilgani faqat JAVOBDA.
  assert.equal(put[0].text.length, 50_000);
});

test("uploadSource: qisqa matn — preview kesilmaydi", async () => {
  const r = await uploadSource(formReq(fileOf(Buffer.from("Salom dunyo, bu sinov."), "xat.txt")), "1", {
    count: async () => ({ chars: 22, text: "Salom dunyo, bu sinov." }),
    put: capturePut([]),
  });
  assert.equal(r.truncatedPreview, false);
  assert.equal(r.text, "Salom dunyo, bu sinov.");
  assert.equal(r.kind, "txt");
});

test("uploadSource: 120 belgidan uzun nom kesiladi", async () => {
  const put: PutArgs[] = [];
  await uploadSource(formReq(fileOf(Buffer.from("matn"), `${"u".repeat(200)}.txt`)), "1", {
    count: fixedCount(1_000),
    put: capturePut(put),
  });
  assert.equal(put[0].name.length, 120);
});
