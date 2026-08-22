import test from "node:test";
import assert from "node:assert/strict";

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.APP_URL = "https://example.uz";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";

const { checkOrigin } = await import("../lib/server/api.ts");

/**
 * CSRF tekshiruvi.
 *
 * `SameSite=None` yoqilganda (Telegram Mini App uchun kerak) bu
 * yagona himoya bo'lib qoladi, shuning uchun har bir holat sinaladi.
 */

function req(headers: Record<string, string>, method = "POST"): Request {
  return new Request("https://example.uz/api/x", { method, headers });
}

test("o'z domenidan kelgan so'rov o'tadi", () => {
  assert.equal(checkOrigin(req({ origin: "https://example.uz" })), true);
  assert.equal(
    checkOrigin(req({ origin: "https://example.uz", "sec-fetch-site": "same-origin" })),
    true,
  );
});

test("Origin Host bilan mos bo'lsa o'tadi (boshqa manzilda ochilgan sayt)", () => {
  // Sayt `APP_URL` dan boshqa manzilda ochilgan: 127.0.0.1, tarmoq IP,
  // prod'dagi `www` varianti. Bular hammasi same-origin — ilgari 403 edi
  // va «Kirish» tugmasi umuman ishlamasdi.
  assert.equal(
    checkOrigin(req({ origin: "http://127.0.0.1:3000", host: "127.0.0.1:3000" })),
    true,
  );
  assert.equal(
    checkOrigin(req({ origin: "http://10.16.71.109:3000", host: "10.16.71.109:3000" })),
    true,
  );
  assert.equal(
    checkOrigin(req({ origin: "https://www.example.uz", host: "www.example.uz" })),
    true,
  );
});

test("Origin Host bilan mos kelmasa rad etiladi", () => {
  // Host bizniki, lekin Origin begona — klassik CSRF.
  assert.equal(
    checkOrigin(req({ origin: "https://evil.example", host: "example.uz" })),
    false,
  );
  // Port ham hisobga olinadi.
  assert.equal(
    checkOrigin(req({ origin: "http://127.0.0.1:9999", host: "127.0.0.1:3000" })),
    false,
  );
});

test("begona domendan kelgan so'rov rad etiladi", () => {
  assert.equal(checkOrigin(req({ origin: "https://evil.example" })), false);
  assert.equal(checkOrigin(req({ origin: "http://example.uz" })), false, "sxema ham muhim");
  // Prefiks o'yini: evil.example.uz — bizning domen emas.
  assert.equal(checkOrigin(req({ origin: "https://evil.example.uz" })), false);
  // Subdomen ham alohida origin.
  assert.equal(checkOrigin(req({ origin: "https://example.uz.evil.com" })), false);
});

test("Sec-Fetch-Site cross-site bo'lsa rad etiladi", () => {
  assert.equal(checkOrigin(req({ "sec-fetch-site": "cross-site" })), false);
  assert.equal(checkOrigin(req({ "sec-fetch-site": "same-site" })), false);
  // Origin to'g'ri bo'lsa ham, Sec-Fetch-Site yolg'on gapira olmaydi.
  assert.equal(
    checkOrigin(req({ origin: "https://example.uz", "sec-fetch-site": "cross-site" })),
    false,
  );
});

test("brauzer bo'lmagan so'rov (curl) o'tadi — unda cookie yo'q", () => {
  assert.equal(checkOrigin(req({})), true);
  assert.equal(checkOrigin(req({ "sec-fetch-site": "none" })), true);
});

test("buzuq Origin rad etiladi", () => {
  assert.equal(checkOrigin(req({ origin: "not-a-url" })), false);
  assert.equal(checkOrigin(req({ origin: "javascript:alert(1)" })), false);
});

/**
 * Sirlar build vaqtida talab qilinmaydi.
 *
 * `next build` sahifa ma'lumotini yig'ayotganda API route modullarini
 * import qiladi va `NODE_ENV` allaqachon `production` bo'ladi. Sirlar esa
 * build muhitida yo'q — ular konteynerga ishga tushirishda beriladi.
 * Farq qilinmasa `docker build` «SESSION_SECRET yo'q» deb yiqiladi;
 * aynan shu birinchi haqiqiy deployda sodir bo'ldi.
 */
test("SESSION_SECRET build bosqichida majburiy emas, ishga tushirishda majburiy", async () => {
  const { execFileSync } = await import("node:child_process");

  // Modul BIR MARTA import qilinganda tekshiruvni bajaradi, shuning uchun
  // har holat alohida processda sinaladi.
  const load = (patch: Record<string, string | undefined>) => {
    const env: Record<string, string | undefined> = { ...process.env, NODE_ENV: "production", ...patch };
    for (const [k, v] of Object.entries(patch)) if (v === undefined) delete env[k];
    try {
      execFileSync(
        "npx",
        ["tsx", "--conditions=react-server", "-e", 'import("./lib/server/env.ts").then(()=>process.exit(0))'],
        { env: env as NodeJS.ProcessEnv, stdio: "ignore", timeout: 60_000 },
      );
      return "OK";
    } catch {
      return "THROW";
    }
  };

  // Build bosqichi: sir yo'q bo'lsa ham import bo'ladi.
  assert.equal(load({ NEXT_PHASE: "phase-production-build", SESSION_SECRET: undefined }), "OK");
  // Ishga tushirish, sir yo'q: xato.
  assert.equal(load({ NEXT_PHASE: undefined, SESSION_SECRET: undefined }), "THROW");
  // Ishga tushirish, sir bor: o'tadi.
  assert.equal(load({ NEXT_PHASE: undefined, SESSION_SECRET: "x".repeat(48) }), "OK");
});
