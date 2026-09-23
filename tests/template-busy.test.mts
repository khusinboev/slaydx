import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

/**
 * «O'z shablonim»: LibreOffice navbati band — 503, ulush va kvota YEYILMAYDI
 * (W2-A review R1).
 *
 * `rasterizeTemplate` → `toPdf` → `sofficeGate` band bo'lsa
 * `SofficeBusyError` tashlaydi. Ilgari u `handler` ga yetib, umumiy 500
 * («Ichki xatolik») bo'lardi, foydalanuvchining 5/10 daqiqalik ulushi esa
 * kuyardi. Endi: 503 + `Retry-After`, chastota hisobi qaytariladi, bazaga
 * hech narsa yozilmaydi.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";
const skip = hasDb ? false : "Postgres kerak (DATABASE_URL)";

const { query, queryOne, pool } = await import("../lib/server/db.ts");
const { handleTemplateUpload, rasterizeTemplate, TEMPLATE_RATE, TEMPLATE_BUSY_REFUNDS } = await import("../lib/server/template-upload.ts");
const { SofficeBusyError } = await import("../lib/server/soffice-gate.ts");
const { windowStartOf } = await import("../lib/server/ratelimit.ts");

let uid = "";
const extraUsers: string[] = [];
after(async () => {
  if (!hasDb) return;
  for (const id of [uid, ...extraUsers].filter(Boolean)) await query(`DELETE FROM users WHERE id = $1`, [id]).catch(() => {});
  await pool().end();
});

async function fixture(): Promise<Buffer> {
  const PptxGenJS = (await import("pptxgenjs")).default;
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "WIDE", width: 13.333, height: 7.5 });
  pptx.layout = "WIDE";
  pptx.defineSlideMaster({
    title: "CONTENT",
    background: { color: "F7F4EC" },
    objects: [
      { placeholder: { options: { name: "t", type: "title", x: 0.7, y: 0.5, w: 11.9, h: 1.0 }, text: "S" } },
      { placeholder: { options: { name: "b", type: "body", x: 0.7, y: 1.7, w: 11.9, h: 4.9 }, text: "M" } },
    ],
  });
  pptx.addSlide({ masterName: "CONTENT" }).addText("Eski", { placeholder: "t" });
  return (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
}

test("template: LibreOffice band — 503 + Retry-After, chastota ulushi qaytadi, hech narsa yozilmaydi", { skip }, async () => {
  uid = (await queryOne<{ id: string }>(`INSERT INTO users (username) VALUES ($1) RETURNING id::text AS id`, [
    `tplbusy_${randomBytes(6).toString("hex")}`,
  ]))!.id;
  const bytes = await fixture();
  const fd = new FormData();
  fd.set("file", new File([new Uint8Array(bytes)], "namuna.pptx"));
  const req = new Request("http://x/api/uploads/template", { method: "POST", body: fd });

  // HAQIQIY `rasterizeTemplate` — faqat `toPdf` band darvozani taqlid qiladi:
  // xato ichkarida yutilib `{}` (fonsiz saqlash) ga aylanmasligi ham sinaladi.
  const res = await handleTemplateUpload(req, uid, {
    rasterize: (b, p) =>
      rasterizeTemplate(b, p, {
        pdftoppm: "/bin/true",
        toPdf: async () => {
          throw new SofficeBusyError(15);
        },
      }),
  });

  assert.equal(res.status, 503, "MUTATSIYA: band holat 503 ga aylanmadi");
  assert.equal(res.headers.get("retry-after"), "15");
  assert.equal(((await res.json()) as { code?: string }).code, "pdf_busy");

  const row = await queryOne<{ hits: number }>(`SELECT hits FROM rate_limits WHERE bucket = $1 AND window_start = $2`, [
    `template:${uid}`,
    windowStartOf(Date.now(), TEMPLATE_RATE.windowSec),
  ]);
  assert.equal(row?.hits ?? 0, 0, "MUTATSIYA: band 503 foydalanuvchi ulushini yedi");
  const stored = await queryOne<{ n: string }>(`SELECT count(*) AS n FROM template_uploads WHERE user_id = $1`, [uid]);
  assert.equal(Number(stored!.n), 0, "band holatda namuna yozildi");
});

test("template: band refund CHEKLANGAN — 10 daqiqada 3 tadan keyin band urinish ham ulushni yeydi (review R2)", { skip }, async () => {
  const user = (await queryOne<{ id: string }>(`INSERT INTO users (username) VALUES ($1) RETURNING id::text AS id`, [
    `tplbusy2_${randomBytes(6).toString("hex")}`,
  ]))!.id;
  extraUsers.push(user);
  const bytes = await fixture();
  const busy = { rasterize: async () => { throw new SofficeBusyError(15); } };
  const attempts = TEMPLATE_BUSY_REFUNDS.count + 2;
  const statuses: number[] = [];
  for (let i = 0; i < attempts; i++) {
    const fd = new FormData();
    fd.set("file", new File([new Uint8Array(bytes)], "namuna.pptx"));
    const res = await handleTemplateUpload(new Request("http://x/api/uploads/template", { method: "POST", body: fd }), user, busy);
    statuses.push(res.status);
  }
  assert.ok(statuses.every((s) => s === 503), `hammasi 503 bo'lishi kerak: ${statuses}`);
  const row = await queryOne<{ hits: number }>(`SELECT hits FROM rate_limits WHERE bucket = $1 AND window_start = $2`, [
    `template:${user}`,
    windowStartOf(Date.now(), TEMPLATE_RATE.windowSec),
  ]);
  // Birinchi 3 tasi qaytarildi, qolgan 2 tasi ulushdan ketdi — cheksiz qayta urinib
  // `soffice` navbatini band qilib turib bo'lmaydi.
  assert.equal(row?.hits ?? 0, attempts - TEMPLATE_BUSY_REFUNDS.count, "MUTATSIYA: band refund cheksiz");
});
