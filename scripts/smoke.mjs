#!/usr/bin/env node
/**
 * Uchidan-uchiga tutun sinovi (smoke test).
 *
 * `npm run check` kodni tekshiradi, `eval-services.mjs` esa chiqish
 * SIFATINI. Bu skript uchinchi savolga javob beradi: tizim umuman
 * ishlayaptimi — kirish, sahifalar, har bir ko'ruvchi, yaratish, yuklab
 * olish, o'chirish va xato yo'llari.
 *
 * Foydalanish (server ishlab turgan holda):
 *   npm run smoke
 *
 * Kirish uchun `DEV_LOGIN_ENABLED=true` kerak yoki `SMOKE_COOKIE` bering.
 * Foydalanuvchi: `SMOKE_USER` (standart — quyidagi raqam).
 */
const B = process.env.BASE || "http://127.0.0.1:3000";
const PHONE = process.env.SMOKE_USER || "+998997333896";
let COOKIE = process.env.SMOKE_COOKIE || "";
const H = (extra = {}) => ({
  "Content-Type": "application/json",
  Origin: B,
  "Sec-Fetch-Site": "same-origin",
  ...(COOKIE ? { Cookie: COOKIE } : {}),
  ...extra,
});
const pass = [], fail = [], skip = [];
const check = (name, ok, detail = "") => (ok ? pass : fail).push(`${name}${detail ? ` — ${detail}` : ""}`);
const skipped = (name, why) => skip.push(`${name} — ${why}`);

/**
 * LLM provayderi yiqilganini MAHSULOT nuqsonidan ajratadi.
 *
 * Kalit tugagan yoki kvota bitgan bo'lsa tizim to'g'ri ishlagan bo'ladi:
 * ish FAILED bo'ladi va kredit qaytadi. Buni «smoke yiqildi» deb
 * ko'rsatish operatorni chalg'itadi — u kodda muammo izlay boshlaydi.
 * Shuning uchun bunday holda mahsulot yo'li SKIP bo'ladi, lekin
 * fail-closed va REFUND yo'li aksincha TEKSHIRILADI: provayder uzilishi
 * bu yo'lni sinash uchun eng yaxshi imkoniyat.
 */
const PROVIDER_DOWN = /AI javob bermadi|prepayment|quota|RESOURCE_EXHAUSTED|429/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function login() {
  if (COOKIE) return check("kirish (SMOKE_COOKIE)", true);
  const req = await fetch(`${B}/api/auth/otp?action=request`, { method: "POST", headers: H(), body: JSON.stringify({ identifier: PHONE }) });
  const d = await req.json();
  if (!d.devCode) return check("kirish", false, d.error || "kod yo'q");
  const ver = await fetch(`${B}/api/auth/otp?action=verify`, { method: "POST", headers: H(), body: JSON.stringify({ identifier: PHONE, code: d.devCode }) });
  const raw = ver.headers.getSetCookie?.() ?? [];
  for (const line of raw) { const m = /(sodda_session=[^;]+)/.exec(line); if (m) COOKIE = m[1]; }
  check("kirish", ver.ok && Boolean(COOKIE));
}

async function pages() {
  for (const p of ["/uz", "/uz/create", "/uz/login", "/uz/profile", "/uz/purchase", "/uz/slide", "/uz/referat", "/uz/rasm"]) {
    const r = await fetch(`${B}${p}`, { headers: H() });
    check(`sahifa ${p}`, r.ok, r.ok ? "" : `HTTP ${r.status}`);
  }
}

async function viewers() {
  const r = await fetch(`${B}/api/generations`, { headers: H() });
  const list = (await r.json()).generations ?? [];
  const seen = new Set();
  for (const g of list) {
    if (g.status !== "COMPLETED" || seen.has(g.type)) continue;
    seen.add(g.type);
    const res = await fetch(`${B}/uz/files/${g.id}`, { headers: H() });
    check(`ko'ruvchi ${g.type}`, res.ok, res.ok ? "" : `HTTP ${res.status}`);
  }
  check("ko'ruvchi turlari qamrovi", seen.size >= 10, `${seen.size} tur`);
}

async function journey() {
  // Refundni tekshirish uchun boshlang'ich hisob kerak.
  //
  // UCHALA hamyon qo'shiladi: pul avval `points`, keyin `quota`, oxirida
  // `balance` dan yechiladi. Faqat `balance` ga qaralsa tekshiruv bo'sh
  // tasdiqqa aylanardi — ball bilan to'lagan foydalanuvchida u doim
  // «0 → 0» ko'rsatardi.
  const wallets = async () => {
    const r = await (await fetch(`${B}/api/users/me`, { headers: H() })).json().catch(() => ({}));
    const u = r?.user ?? {};
    return Number(u.points ?? 0) + Number(u.quota ?? 0) + Number(u.balance ?? 0);
  };
  const before = await wallets();

  const create = await fetch(`${B}/api/generations`, {
    method: "POST", headers: H(),
    body: JSON.stringify({ slug: "essay", values: { topic: "Kitob — bilim manbai", language: "uz", pages: "1", author: "Test", design: "iris" } }),
  });
  const c = await create.json();
  if (!c.id) return check("yaratish", false, c.error || `HTTP ${create.status}`);
  check("yaratish", true, `${c.price} tanga`);

  let gen = null;
  for (let i = 0; i < 60; i++) {
    const s = await fetch(`${B}/api/generations/${c.id}`, { headers: H() });
    gen = (await s.json()).generation;
    if (gen?.status === "COMPLETED" || gen?.status === "FAILED") break;
    await sleep(3000);
  }
  if (gen?.status === "FAILED" && PROVIDER_DOWN.test(gen.error || gen.step || "")) {
    // Provayder yiqilgan — mahsulot yo'lini sinab bo'lmaydi, lekin
    // fail-closed va refund AYNAN shu paytda tekshirilishi kerak.
    skipped("yakunlandi", `LLM provayderi javob bermadi: ${(gen.error || "").slice(0, 70)}`);
    const after = await wallets();
    check("yiqilganda kredit qaytdi", after >= before, `${before} → ${after}`);
    return;
  }
  check("yakunlandi", gen?.status === "COMPLETED", gen?.status ?? "javob yo'q");
  if (gen?.status !== "COMPLETED") return;

  for (const [name, url, magic] of [
    ["DOCX yuklab olish", `${B}/api/generations/${c.id}/file`, "PK"],
    ["PDF yuklab olish", `${B}/api/generations/${c.id}/file?format=pdf`, "%PDF"],
  ]) {
    const f = await fetch(url, { headers: H() });
    const head = Buffer.from(await f.arrayBuffer()).subarray(0, 4).toString("latin1");
    check(name, f.ok && head.startsWith(magic), f.ok ? head.slice(0, 4) : `HTTP ${f.status}`);
  }

  const del = await fetch(`${B}/api/generations/${c.id}`, { method: "DELETE", headers: H() });
  check("o'chirish", del.ok, del.ok ? "" : `HTTP ${del.status}`);
}

async function errors() {
  const bad = await fetch(`${B}/api/generations`, { method: "POST", headers: H(), body: JSON.stringify({ slug: "yo-q-vosita", values: {} }) });
  check("noma'lum vosita → 400", bad.status === 400, `HTTP ${bad.status}`);

  const noAuth = await fetch(`${B}/api/generations`, { headers: { Origin: B, "Sec-Fetch-Site": "same-origin" } });
  check("sessiyasiz → 401", noAuth.status === 401, `HTTP ${noAuth.status}`);

  const csrf = await fetch(`${B}/api/generations`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: COOKIE, Origin: "https://yovuz.example", "Sec-Fetch-Site": "cross-site" }, body: "{}" });
  check("CSRF → 403", csrf.status === 403, `HTTP ${csrf.status}`);

  const idor = await fetch(`${B}/api/generations/00000000-0000-4000-8000-000000000000/file`, { headers: H() });
  check("begona fayl → 404", idor.status === 404, `HTTP ${idor.status}`);
}

await login();
if (!COOKIE) { console.log("kirish yiqildi — davom etilmadi"); process.exit(1); }
await pages(); await viewers(); await journey(); await errors();

console.log("\n=== O'TDI ===");
for (const p of pass) console.log("  ✓", p);
if (skip.length) { console.log("\n=== CHETLAB O'TILDI ==="); for (const s of skip) console.log("  ~", s); }
if (fail.length) { console.log("\n=== YIQILDI ==="); for (const f of fail) console.log("  ✗", f); }
console.log(`\n${pass.length}/${pass.length + fail.length}${skip.length ? ` (+${skip.length} chetlab o'tildi)` : ""}`);
process.exit(fail.length ? 1 : 0);
