import test from "node:test";
import assert from "node:assert/strict";

/**
 * Slayd logotipi yuklash (WP-F).
 *
 * Forma va klient WP-G da — bu yerda faqat SERVER: `lib/server/logo.ts`
 * (`uploadLogo`, `putLogo`, `getLogo`, `logoDataUrl`) va `assets.ts`
 * (`extractAssets` ga qo'shilgan `slideLogo` skaneri).
 *
 * `uploadLogo` ATAYIN autentifikatsiyadan (`requireUser`) ajratilgan —
 * Next.js `cookies()` faqat so'rov konteksti ICHIDA ishlaydi va bu
 * yerda haqiqiy `Request` bilan to'g'ridan-to'g'ri chaqirish uchun
 * kerak. Shuning uchun 413/415/200 testlari route'ni emas, aynan shu
 * funksiyani chaqiradi — lekin route ham AYNAN shuni chaqiradi
 * (`app/api/uploads/logo/route.ts`), demak sinov haqiqiy kod yo'lini
 * sinaydi, o'zining nusxasini emas.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");

const { ApiError } = await import("../lib/server/api.ts");
const { uploadLogo, putLogo, getLogo, logoDataUrl, LOGO_MAX_BYTES } = await import(
  "../lib/server/logo.ts"
);
const { extractAssets, assetUrl } = await import("../lib/server/assets.ts");
import type { AcademicDoc } from "../lib/generation/types.ts";

/** 8 baytlik PNG sarlavha (`sniffImageType` faqat shuni tekshiradi) + to'ldiruvchi. */
function pngBytes(extra = 16): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([sig, Buffer.alloc(extra, 0x01)]);
}

/** GIF sarlavhasi — PNG/JPEG EMAS, `sniffImageType` `null` qaytarishi kerak. */
function gifBytes(): Buffer {
  return Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 2, 3, 4]);
}

/**
 * `File`ning `BlobPart` tipi `Buffer`ni to'g'ridan-to'g'ri qabul qilmaydi
 * (`Buffer.buffer` `ArrayBufferLike` — `SharedArrayBuffer` ham bo'lishi
 * mumkin). `extract.test.mts` dagi naqsh: haqiqiy `ArrayBuffer`ga kesib
 * olib, shundan yangi `Uint8Array` yasaymiz.
 */
function blobPart(b: Buffer): Uint8Array<ArrayBuffer> {
  const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  return new Uint8Array(ab);
}

function formReq(file: File | null, extraHeaders: Record<string, string> = {}): Request {
  const fd = new FormData();
  if (file) fd.set("file", file);
  return new Request("http://x/api/uploads/logo", {
    method: "POST",
    headers: extraHeaders,
    body: file ? fd : undefined,
  });
}

async function expectApiError(p: Promise<unknown>, status: number): Promise<InstanceType<typeof ApiError>> {
  try {
    await p;
  } catch (e) {
    assert.ok(e instanceof ApiError, `ApiError kutilgan edi, keldi: ${e}`);
    assert.equal((e as InstanceType<typeof ApiError>).status, status);
    return e as InstanceType<typeof ApiError>;
  }
  assert.fail(`xato tashlanishi kerak edi (status ${status})`);
}

// ---------------------------------------------------------------------------
// DB kerak emas — sof mantiq.
// ---------------------------------------------------------------------------

test("logoDataUrl: bo'sh yoki noto'g'ri id — undefined, xato emas", async () => {
  // `userId` bo'sh — DB ga umuman so'rov ketmasligi kerak (DATABASE_URL
  // sozlanmagan bo'lsa ham bu test o'tishi shart).
  assert.equal(await logoDataUrl("", "a".repeat(24)), undefined);
  assert.equal(await logoDataUrl("123", ""), undefined);
  // Format noto'g'ri (24 hex emas) — `getLogo` regex bosqichida to'xtaydi.
  assert.equal(await logoDataUrl("123", "not-a-valid-asset-id"), undefined);
  assert.equal(await getLogo("123", "short"), null);
});

test("uploadLogo: content-length 2 MB dan katta — tana o'qilmasdan 413", async () => {
  // MUTATSIYA: agar shu tekshiruv olib tashlansa, bu so'rov (multipart
  // sarlavhasi yo'q, `body: undefined`) `formData()` bosqichiga o'tib,
  // 413 o'rniga 400 ("Fayl yuborilmadi") berardi — shu farq ushlaydi.
  const req = formReq(null, { "content-length": String(LOGO_MAX_BYTES + 5 * 1024 * 1024) });
  await expectApiError(uploadLogo(req, "1"), 413);
});

test("uploadLogo: haqiqiy fayl hajmi 2 MB dan katta — 413 (content-length yolg'on bo'lsa ham)", async () => {
  const big = pngBytes(LOGO_MAX_BYTES + 1024);
  const file = new File([blobPart(big)], "logo.png", { type: "image/png" });
  const req = formReq(file);
  // `new Request({body: FormData})` `content-length` ni o'zi qo'ymaydi —
  // demak birinchi (sarlavha) tekshiruv o'tib, `file.size` tekshiruvi ushlaydi.
  assert.equal(req.headers.get("content-length"), null);
  await expectApiError(uploadLogo(req, "1"), 413);
});

test("uploadLogo: PNG sarlavhali/nomli, lekin baytlari GIF — 415 (baytlardan, content-type dan emas)", async () => {
  // MUTATSIYA: agar `sniffImageType(bytes)` o'rniga `file.type`/nomga
  // ishonilsa, bu fayl (type: image/png, nom: logo.png) 200 bilan o'tib
  // ketardi. Bayt darajasida u GIF.
  const file = new File([blobPart(gifBytes())], "logo.png", { type: "image/png" });
  const req = formReq(file);
  await expectApiError(uploadLogo(req, "1"), 415);
});

test("extractAssets: slideLogo data: URL bo'lsa aktivga aylanadi (slides[].image bilan bir xil naqsh)", () => {
  const bytes = pngBytes();
  const dataUrl = `data:image/png;base64,${bytes.toString("base64")}`;
  const doc = {
    meta: {},
    titlePage: false,
    toc: false,
    sections: [],
    slideLogo: { url: dataUrl },
  } as unknown as AcademicDoc;

  const out = extractAssets("gen-1", doc, "<html></html>");
  assert.equal(out.assets.length, 1);
  const [asset] = out.assets;
  assert.equal(asset.mime, "image/png");
  assert.equal(asset.bytes.equals(bytes), true);
  assert.equal(out.doc?.slideLogo?.url, assetUrl("gen-1", asset.assetId));
  // Xuddi shu naqsh slayd rasmlari uchun ishlatiladi — ko'ruvchi bir xil
  // yo'ldan o'qishi kerak.
  assert.match(out.doc!.slideLogo!.url, /^\/api\/generations\/gen-1\/assets\/[0-9a-f]{24}$/);
});

test("extractAssets: slideLogo data: URL bo'lmasa tegilmaydi", () => {
  const doc = {
    meta: {},
    titlePage: false,
    toc: false,
    sections: [],
    slideLogo: { url: "https://cdn.example.uz/logo.png" },
  } as unknown as AcademicDoc;

  const out = extractAssets("gen-1", doc, "<html></html>");
  assert.equal(out.assets.length, 0);
  assert.equal(out.doc?.slideLogo?.url, "https://cdn.example.uz/logo.png");
});

test("extractAssets: slideLogo umuman yo'q bo'lsa xato bermaydi", () => {
  const doc = { meta: {}, titlePage: false, toc: false, sections: [] } as unknown as AcademicDoc;
  const out = extractAssets("gen-1", doc, "<html></html>");
  assert.equal(out.assets.length, 0);
  assert.equal(out.doc?.slideLogo, undefined);
});

// ---------------------------------------------------------------------------
// Haqiqiy Postgres kerak (DATABASE_URL bo'lsa ishlaydi, aks holda skip).
// ---------------------------------------------------------------------------

/**
 * EGALIK — BAZASIZ ham qulflanadi.
 *
 * Pastdagi to'liq oqim testi haqiqiy Postgres talab qiladi va `npm run
 * check` da O'TKAZIB YUBORILADI — ya'ni loyihaning eng qattiq qoidasi
 * («egalik SQL darajasida», `CLAUDE.md`) CI da sinovsiz qolardi.
 * Shuning uchun bu yerda hovuzning `query` metodi ushlanadi va
 * `getLogo` yuboradigan SQL matni tekshiriladi: `user_id` predikati
 * yo'qolsa test qizil bo'ladi, baza bo'lmasa ham.
 */
test("getLogo: egalik predikati SQL da (bazasiz — hovuz so'rovi ushlanadi)", async (t) => {
  const { pool } = await import("../lib/server/db.ts");
  const p = pool();
  const seen: { text: string; params: unknown[] }[] = [];
  t.mock.method(p, "query", async (text: string, params: unknown[]) => {
    seen.push({ text, params });
    return { rows: [], rowCount: 0 };
  });

  assert.equal(await getLogo("7", "a".repeat(24)), null);
  assert.equal(seen.length, 1, "getLogo aynan bitta so'rov yuborishi kerak");
  const sql = seen[0].text.replace(/\s+/g, " ");
  assert.match(sql, /FROM logo_uploads/);
  assert.match(sql, /WHERE user_id = \$1/, "egalik SQL da bo'lishi SHART — route darajasi yetarli emas");
  assert.match(sql, /asset_id = \$2/);
  assert.deepEqual(seen[0].params, ["7", "a".repeat(24)]);

  // `logoDataUrl` ham AYNAN shu yo'ldan o'tadi (o'z so'rovini yozmaydi).
  seen.length = 0;
  assert.equal(await logoDataUrl("7", "b".repeat(24)), undefined);
  assert.match(seen[0]?.text.replace(/\s+/g, " ") ?? "", /WHERE user_id = \$1/);
});

/** `putLogo` ham foydalanuvchiga bog'lab yozadi — begona qatorga yozilmasin. */
test("putLogo: user_id bilan yoziladi va ON CONFLICT (user_id, asset_id) (bazasiz)", async (t) => {
  const { pool } = await import("../lib/server/db.ts");
  const p = pool();
  const seen: { text: string; params: unknown[] }[] = [];
  t.mock.method(p, "query", async (text: string, params: unknown[]) => {
    seen.push({ text, params });
    return { rows: [], rowCount: 1 };
  });

  const bytes = pngBytes();
  const saved = await putLogo("42", bytes, "image/png");
  const sql = seen[0].text.replace(/\s+/g, " ");
  assert.match(sql, /INSERT INTO logo_uploads \(user_id, asset_id/);
  assert.match(sql, /ON CONFLICT \(user_id, asset_id\) DO NOTHING/);
  assert.equal(seen[0].params[0], "42");
  assert.equal(seen[0].params[1], saved.assetId);
});

test("logo_uploads: egalik, ON CONFLICT, uploadLogo to'liq yo'li, worker uzatish naqshi", {
  skip: hasDb ? false : "DATABASE_URL yo'q",
}, async (t) => {
  const { query, migrate, pool } = await import("../lib/server/db.ts");
  await migrate();

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const mkUser = async (tag: string) => {
    const rows = await query<{ id: string }>(
      `INSERT INTO users (username, name, points, quota, balance)
       VALUES ($1, 'Test', 0, 0, 100000) RETURNING id`,
      [`test-logo-${tag}-${stamp}`],
    );
    return String(rows[0].id);
  };

  const owner = await mkUser("owner");
  const stranger = await mkUser("stranger");

  t.after(async () => {
    for (const uid of [owner, stranger]) {
      await query("DELETE FROM logo_uploads WHERE user_id = $1", [uid]);
      await query("DELETE FROM users WHERE id = $1", [uid]);
    }
    await pool().end();
  });

  await t.test("putLogo + getLogo: egasi o'qiy oladi, begona o'qiy olmaydi", async () => {
    const bytes = pngBytes();
    const saved = await putLogo(owner, bytes, "image/png");
    assert.match(saved.assetId, /^[0-9a-f]{24}$/);
    assert.equal(saved.mime, "image/png");
    assert.equal(saved.size, bytes.byteLength);

    // Egalik SQL da tekshiriladi — so'rov matnida `user_id` bo'lishini
    // ham tasdiqlaymiz (MUTATSIYA: `WHERE user_id = $1` olib tashlansa,
    // bu assert yiqiladi hatto funksional natija tasodifan to'g'ri
    // chiqqan taqdirda ham).
    const p = pool();
    const calls: string[] = [];
    const orig = p.query.bind(p);
    t.mock.method(p, "query", ((text: unknown, params?: unknown) => {
      if (typeof text === "string") calls.push(text);
      return orig(text as never, params as never);
    }) as typeof p.query);

    const own = await getLogo(owner, saved.assetId);
    assert.ok(own, "egasi o'qiy olishi kerak");
    assert.equal(own!.mime, "image/png");
    assert.equal(Buffer.from(own!.bytes).equals(bytes), true);

    const foreign = await getLogo(stranger, saved.assetId);
    assert.equal(foreign, null, "begona foydalanuvchi begona logotipni ololmasligi kerak");

    assert.ok(
      calls.some((sql) => /user_id/i.test(sql)),
      "getLogo so'rovi user_id bo'yicha filtrlashi kerak",
    );

    t.mock.reset();
  });

  await t.test("putLogo: bir xil bayt ikki marta yuklansa bitta qator qoladi", async () => {
    const bytes = pngBytes(32);
    const first = await putLogo(owner, bytes, "image/png");
    const second = await putLogo(owner, bytes, "image/png");
    assert.equal(first.assetId, second.assetId, "bir xil bayt — bir xil assetId");

    const rows = await query(
      "SELECT 1 FROM logo_uploads WHERE user_id = $1 AND asset_id = $2",
      [owner, first.assetId],
    );
    assert.equal(rows.length, 1, "ON CONFLICT DO NOTHING — dublikat qator yo'q");
  });

  await t.test("uploadLogo: to'g'ri PNG — 200 + assetId 24 hex, bazaga yoziladi", async () => {
    const bytes = pngBytes(64);
    const file = new File([blobPart(bytes)], "logo.png", { type: "image/png" });
    const req = formReq(file);

    const result = await uploadLogo(req, owner);
    assert.match(result.assetId, /^[0-9a-f]{24}$/);
    assert.equal(result.mime, "image/png");
    assert.equal(result.size, bytes.byteLength);

    const row = await getLogo(owner, result.assetId);
    assert.ok(row, "yuklangan logotip bazada bo'lishi kerak");
    assert.equal(Buffer.from(row!.bytes).equals(bytes), true);
  });

  await t.test("uploadLogo: JPEG ham qabul qilinadi", async () => {
    const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(16, 2)]);
    const file = new File([blobPart(jpg)], "logo.jpg", { type: "image/jpeg" });
    const req = formReq(file);
    const result = await uploadLogo(req, owner);
    assert.equal(result.mime, "image/jpeg");
  });

  /*
   * Worker integratsiyasi (`lib/server/worker.ts`):
   *   const logo = await logoDataUrl(job.userId, String(job.values.logoAssetId ?? ""));
   *   const file = await buildArtifact(tool, job.values, { deadline, logo });
   *
   * `runJob` eksport qilinmagan (worker.ts ga faqat shu bitta chaqiruvni
   * o'zgartirish ruxsat etilgan — boshqa narsaga tegilmaydi), shuning
   * uchun butun ishni (haqiqiy LLM/rasm bilan) ishga tushirish o'rniga
   * AYNAN shu ifodani — worker chaqiradigan input bilan — sinaymiz:
   * yuklangan logotip haqiqatan to'g'ri `data:` URL ga aylanadimi va
   * `logoAssetId` yo'q/bo'sh bo'lganda `buildArtifact` `logo: undefined`
   * bilan chaqirilishini ta'minlaydigan qiymat qaytadimi.
   */
  await t.test("worker uzatish naqshi: logoAssetId → data: URL, aks holda undefined", async () => {
    const bytes = pngBytes(8);
    const saved = await putLogo(owner, bytes, "image/png");

    const values = { logoAssetId: saved.assetId } as Record<string, unknown>;
    const logo = await logoDataUrl(owner, String(values.logoAssetId ?? ""));
    assert.equal(logo, `data:image/png;base64,${bytes.toString("base64")}`);

    const noLogoValues = {} as Record<string, unknown>;
    const noLogo = await logoDataUrl(owner, String(noLogoValues.logoAssetId ?? ""));
    assert.equal(noLogo, undefined);

    // Boshqa foydalanuvchining `logoAssetId`si bilan kelsa ham sizib
    // chiqmaydi (worker qatoridagi `job.userId` — YAGONA egalik manbai).
    const crossUser = await logoDataUrl(stranger, String(values.logoAssetId ?? ""));
    assert.equal(crossUser, undefined);
  });
});
