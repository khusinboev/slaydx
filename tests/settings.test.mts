import test from "node:test";
import assert from "node:assert/strict";
import { createIsolatedDb } from "./helpers/isolated-db.mts";

/**
 * Runtime settings service `lib/server/settings.ts` (docs/admin/02-plan.md
 * §6.10, §17.7).
 *
 * Unit: the catalog validates strictly (unknown tool ids, negative/fractional
 * ints, out-of-range markup, wrong JSON types) and its defaults equal the env
 * values the product used before the module existed.
 * DB (separate throwaway database): no row → env/default; a row wins; the
 * 15 s cache serves the old value until `invalidateSettingsCache()`; writes
 * return audit snapshots and reject bad input without writing; invalid stored
 * rows and a failing DB never throw into product code.
 */

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.WORKER_INLINE = "false";
// Env read by `lib/server/env.ts` at import time — set before importing.
process.env.FREE_LLM_DAILY_OUTLINE = "7";
process.env.SOUM_PER_USD = "12500";
delete process.env.FREE_LLM_DISABLED;
delete process.env.FREE_LLM_DAILY_UDK;

const iso = hasDb ? await createIsolatedDb("settings") : { isolated: false, drop: async () => {} };
const skip = !hasDb ? "DATABASE_URL yo'q" : iso.isolated ? false : "alohida Postgres baza yaratilmadi";

const s = await import("../lib/server/settings.ts");
const { env } = await import("../lib/server/env.ts");
const { TOOL_BY_ID } = await import("../lib/tools.ts");
const { soumPerUsd } = await import("../lib/generation/llm-pricing.ts");

const bad = (key: Parameters<typeof s.validateSetting>[0], value: unknown) =>
  assert.equal(s.validateSetting(key, value).ok, false, `${key} = ${JSON.stringify(value)} qabul qilindi`);
const good = (key: Parameters<typeof s.validateSetting>[0], value: unknown, expected: unknown = value) => {
  const r = s.validateSetting(key, value);
  assert.ok(r.ok, `${key} = ${JSON.stringify(value)} rad etildi`);
  assert.deepEqual(r.value, expected);
};

test("katalog: kalitlar, guruh/yorliq/tavsif bor", () => {
  assert.deepEqual([...s.SETTING_KEYS], [
    "free_llm.disabled",
    "free_llm.daily.outline",
    "free_llm.daily.udk",
    "free_llm.daily.rewrite",
    "free_llm.daily.polish",
    "free_llm.daily.global",
    "generation.paused",
    "generation.paused_tools",
    "admin.wallet_confirm_threshold",
    "finance.soum_per_usd",
    "payment_bonus_percent",
    "pricing.target_markup",
    "pricing.payment_fee_percent",
  ]);
  for (const k of s.SETTING_KEYS) {
    const d = s.settingDef(k);
    assert.equal(d.key, k);
    assert.ok(d.group && d.label && d.description, `${k}: matn yo'q`);
  }
  assert.equal(s.isSettingKey("generation.paused"), true);
  assert.equal(s.isSettingKey("constructor"), false);
  assert.equal(s.isSettingKey("nope"), false);
  assert.equal(s.isSettingKey(1), false);
});

test("standart qiymatlar = env (mahsulot xulqi o'zgarmaydi)", () => {
  const d = <K extends (typeof s.SETTING_KEYS)[number]>(k: K) => s.settingDef(k).envDefault();
  assert.equal(d("free_llm.disabled"), env.freeLlm.disabled);
  assert.equal(d("free_llm.disabled"), false);
  assert.equal(d("free_llm.daily.outline"), env.freeLlm.dailyOutline);
  assert.equal(d("free_llm.daily.outline"), 7);
  assert.equal(d("free_llm.daily.udk"), env.freeLlm.dailyUdk);
  assert.equal(d("free_llm.daily.rewrite"), env.freeLlm.dailyRewrite);
  assert.equal(d("free_llm.daily.polish"), env.freeLlm.dailyPolish);
  assert.equal(d("free_llm.daily.global"), env.freeLlm.dailyGlobal);
  assert.equal(d("generation.paused"), false);
  assert.deepEqual(d("generation.paused_tools"), []);
  assert.equal(d("admin.wallet_confirm_threshold"), 1_000_000);
  assert.equal(d("finance.soum_per_usd"), soumPerUsd());
  assert.equal(d("finance.soum_per_usd"), 12_500);
  assert.equal(d("pricing.target_markup"), 3);
  assert.equal(d("pricing.payment_fee_percent"), 0, "komissiya standart bo'yicha hisobga olinmaydi");
});

test("validatsiya: bool", () => {
  good("free_llm.disabled", true);
  good("generation.paused", false);
  for (const v of ["true", 1, 0, null, undefined, {}]) bad("generation.paused", v);
});

test("validatsiya: butun sonlar (manfiy, kasr, matn rad etiladi)", () => {
  for (const k of ["free_llm.daily.outline", "free_llm.daily.global", "admin.wallet_confirm_threshold"] as const) {
    good(k, 0);
    good(k, 25);
    for (const v of [-1, 1.5, "5", NaN, Infinity, null, 1e15]) bad(k, v);
  }
  good("finance.soum_per_usd", 12_700);
  bad("finance.soum_per_usd", 0);
  bad("finance.soum_per_usd", -12_700);
  bad("finance.soum_per_usd", 12_700.5);
});

test("validatsiya: pricing.target_markup 1.0–20.0", () => {
  good("pricing.target_markup", 1);
  good("pricing.target_markup", 3.5);
  good("pricing.target_markup", 20);
  for (const v of [0.99, 20.01, 0, -3, NaN, Infinity, "3", null]) bad("pricing.target_markup", v);
});

test("validatsiya: pricing.payment_fee_percent 0–10, qadam 0,1 (kasr shovqini tozalanadi)", () => {
  for (const v of [0, 0.1, 1.5, 2.5, 9.9, 10]) good("pricing.payment_fee_percent", v);
  // 0.1 × 3 is 0.30000000000000004 in floats: the stored value is the clean 0.3.
  good("pricing.payment_fee_percent", 0.1 * 3, 0.3);
  good("pricing.payment_fee_percent", 7 / 10, 0.7);
  for (const v of [-0.1, 10.1, 11, 100, 0.05, 1.25, NaN, Infinity, -Infinity, "1", "", null, undefined, true, {}]) bad("pricing.payment_fee_percent", v);
  const def = s.settingDef("pricing.payment_fee_percent");
  assert.equal(def.type, "number");
  assert.equal(def.group, "Narxlar");
  assert.equal(def.min, 0);
  assert.equal(def.max, 10);
  assert.match(def.label, /komissiya/i);
});

test("validatsiya: generation.paused_tools — faqat registrdagi vositalar, tartiblangan, takrorsiz", () => {
  const ids = Object.keys(TOOL_BY_ID);
  assert.ok(ids.includes("slide") && ids.includes("image"));
  const expected = ids.filter((id) => id === "slide" || id === "image");
  good("generation.paused_tools", ["image", "slide", "image"], expected);
  good("generation.paused_tools", [], []);
  bad("generation.paused_tools", ["slide", "nope"]);
  bad("generation.paused_tools", ["__proto__"]);
  bad("generation.paused_tools", ["constructor"]);
  bad("generation.paused_tools", [1]);
  bad("generation.paused_tools", "slide");
  bad("generation.paused_tools", null);
  bad("generation.paused_tools", { slide: true });
});

test("sozlamalar bazada (haqiqiy Postgres)", { skip }, async (t) => {
  const { migrate, pool, query, queryOne, transaction } = await import("../lib/server/db.ts");
  await migrate({ lockRetryDelayMs: 50 });
  t.after(async () => {
    await pool().end().catch(() => {});
    await iso.drop();
  });

  const userId = (await queryOne<{ id: string }>(
    "INSERT INTO users (username, name) VALUES ('settings_admin', 'Sozlama Admin') RETURNING id",
  ))!.id;
  const adminId = (await queryOne<{ id: string }>(
    "INSERT INTO admin_accounts (user_id, role, status) VALUES ($1, 'owner', 'active') RETURNING id",
    [userId],
  ))!.id;

  const setTable = async (on: boolean) =>
    query(on ? "ALTER TABLE app_settings_off RENAME TO app_settings" : "ALTER TABLE app_settings RENAME TO app_settings_off");

  await t.test("baza xatosi (snapshot yo'q): xato tashlanmaydi, env/standart qaytadi", async () => {
    await setTable(false);
    try {
      s.invalidateSettingsCache();
      assert.equal(await s.getSetting("free_llm.daily.outline"), 7);
      assert.equal(await s.getSetting("generation.paused"), false);
      assert.deepEqual(await s.getSetting("generation.paused_tools"), []);
    } finally {
      await setTable(true);
    }
  });

  await t.test("qator yo'q: qiymat = env/standart, manba to'g'ri", async () => {
    s.invalidateSettingsCache();
    for (const k of s.SETTING_KEYS) assert.deepEqual(await s.getSetting(k), s.settingDef(k).envDefault(), k);
    const items = new Map((await s.listSettings()).map((i) => [i.key, i]));
    assert.equal(items.size, s.SETTING_KEYS.length);
    assert.equal(items.get("free_llm.daily.outline")!.source, "env");
    assert.equal(items.get("finance.soum_per_usd")!.source, "env");
    assert.equal(items.get("free_llm.daily.udk")!.source, "default");
    assert.equal(items.get("free_llm.disabled")!.source, "default");
    assert.equal(items.get("generation.paused")!.source, "default");
    const o = items.get("free_llm.daily.outline")!;
    assert.deepEqual(
      { value: o.value, envValue: o.envValue, updatedBy: o.updatedBy, updatedAt: o.updatedAt, type: o.type },
      { value: 7, envValue: 7, updatedBy: null, updatedAt: null, type: "int" },
    );
  });

  await t.test("setSettingInTx: bazadagi qiymat ustun; kesh invalidatsiyagacha eski qiymatni beradi", async () => {
    assert.equal(await s.getSetting("free_llm.daily.outline"), 7); // snapshot loaded
    const res = await transaction((c) => s.setSettingInTx(c, "free_llm.daily.outline", 3, adminId));
    assert.deepEqual(res, {
      key: "free_llm.daily.outline",
      before: { value: 7, source: "env" },
      after: { value: 3, source: "db" },
    });
    // Same process, not invalidated yet: cached snapshot.
    assert.equal(await s.getSetting("free_llm.daily.outline"), 7);
    s.invalidateSettingsCache();
    assert.equal(await s.getSetting("free_llm.daily.outline"), 3);

    const item = (await s.listSettings()).find((i) => i.key === "free_llm.daily.outline")!;
    assert.equal(item.value, 3);
    assert.equal(item.source, "db");
    assert.equal(item.envValue, 7);
    assert.equal(item.updatedBy, adminId);
    assert.equal(item.updatedByName, "Sozlama Admin");
    assert.ok(item.updatedAt && !Number.isNaN(Date.parse(item.updatedAt)));

    // Second write: before is the DB value.
    const again = await transaction((c) => s.setSettingInTx(c, "free_llm.daily.outline", 4, adminId));
    assert.deepEqual(again.before, { value: 3, source: "db" });
    s.invalidateSettingsCache();
    assert.equal(await s.getSetting("free_llm.daily.outline"), 4);
  });

  await t.test("setSettingInTx: ro'yxat normallashtiriladi va JSONB sifatida saqlanadi", async () => {
    await transaction((c) => s.setSettingInTx(c, "generation.paused_tools", ["image", "slide"], adminId));
    await transaction((c) => s.setSettingInTx(c, "pricing.target_markup", 2.5, null));
    s.invalidateSettingsCache();
    const expected = Object.keys(TOOL_BY_ID).filter((id) => id === "slide" || id === "image");
    assert.deepEqual(await s.getSetting("generation.paused_tools"), expected);
    assert.equal(await s.getSetting("pricing.target_markup"), 2.5);
    const row = await queryOne<{ t: string; updated_by: string | null }>(
      "SELECT jsonb_typeof(value) AS t, updated_by FROM app_settings WHERE key = 'generation.paused_tools'",
    );
    assert.deepEqual(row, { t: "array", updated_by: adminId });
    const markup = await queryOne<{ updated_by: string | null }>(
      "SELECT updated_by FROM app_settings WHERE key = 'pricing.target_markup'",
    );
    assert.equal(markup!.updated_by, null);
  });

  await t.test("noto'g'ri qiymat/kalit: 400/404, hech narsa yozilmaydi", async () => {
    const before = await query("SELECT key, value::text FROM app_settings ORDER BY key");
    const cases: [string, unknown, number][] = [
      ["generation.paused_tools", ["slide", "nope"], 400],
      ["free_llm.daily.polish", -1, 400],
      ["free_llm.daily.polish", 2.5, 400],
      ["pricing.target_markup", 25, 400],
      ["pricing.target_markup", 0.5, 400],
      ["pricing.payment_fee_percent", 11, 400],
      ["pricing.payment_fee_percent", Number.NaN, 400],
      ["generation.paused", "true", 400],
      ["no.such.key", true, 404],
    ];
    for (const [key, value, status] of cases) {
      await assert.rejects(
        transaction((c) => s.setSettingInTx(c, key, value, adminId)),
        (e: unknown) => (e as { status?: number }).status === status,
        `${key} = ${JSON.stringify(value)}`,
      );
    }
    await assert.rejects(
      transaction((c) => s.resetSettingInTx(c, "no.such.key")),
      (e: unknown) => (e as { status?: number }).status === 404,
    );
    assert.deepEqual(await query("SELECT key, value::text FROM app_settings ORDER BY key"), before);
  });

  await t.test("resetSettingInTx: env/standartga qaytadi", async () => {
    const res = await transaction((c) => s.resetSettingInTx(c, "free_llm.daily.outline"));
    assert.deepEqual(res, {
      key: "free_llm.daily.outline",
      before: { value: 4, source: "db" },
      after: { value: 7, source: "env" },
    });
    s.invalidateSettingsCache();
    assert.equal(await s.getSetting("free_llm.daily.outline"), 7);
    // Resetting again is a no-op with equal snapshots.
    const noop = await transaction((c) => s.resetSettingInTx(c, "free_llm.daily.outline"));
    assert.deepEqual(noop.before, noop.after);
  });

  await t.test("bazadagi yaroqsiz qator mahsulotni buzmaydi", async () => {
    await query(
      `INSERT INTO app_settings (key, value) VALUES
         ('free_llm.daily.udk', '"ko''p"'),
         ('generation.paused_tools', '["slide", "olib-tashlangan-vosita"]')
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    );
    s.invalidateSettingsCache();
    assert.equal(await s.getSetting("free_llm.daily.udk"), env.freeLlm.dailyUdk);
    const tools = await s.getSetting("generation.paused_tools");
    assert.deepEqual(tools, ["slide"]);
    tools.push("image"); // a caller's copy — the cached snapshot is untouched
    assert.deepEqual(await s.getSetting("generation.paused_tools"), ["slide"]);
    const udk = (await s.listSettings()).find((i) => i.key === "free_llm.daily.udk")!;
    assert.equal(udk.source, "default");
    assert.equal(udk.value, env.freeLlm.dailyUdk);
  });

  await t.test("baza xatosi (snapshot bor): oxirgi yaxshi qiymat saqlanadi", async () => {
    await query(
      `INSERT INTO app_settings (key, value) VALUES ('generation.paused', 'true')
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    );
    s.invalidateSettingsCache();
    assert.equal(await s.getSetting("generation.paused"), true);
    await setTable(false);
    try {
      s.invalidateSettingsCache();
      assert.equal(await s.getSetting("generation.paused"), true);
      // listSettings is admin-only: it reports the error instead of guessing.
      await assert.rejects(s.listSettings());
    } finally {
      await setTable(true);
    }
    s.invalidateSettingsCache();
    assert.equal(await s.getSetting("generation.paused"), true);
  });

  await t.test("barcha kalitlar (parallel ham) bitta so'rov bilan o'qiladi, keyin keshdan", async () => {
    const p = pool();
    const original = p.query;
    let reads = 0;
    // Counts settings reads that go through the shared pool (`db.ts query`).
    p.query = function (this: typeof p, ...args: unknown[]) {
      if (typeof args[0] === "string" && args[0].includes("FROM app_settings")) reads++;
      return (original as (...a: unknown[]) => unknown).apply(this, args);
    } as typeof p.query;
    try {
      s.invalidateSettingsCache();
      const vals = await Promise.all(s.SETTING_KEYS.map((k) => s.getSetting(k)));
      assert.equal(vals[s.SETTING_KEYS.indexOf("generation.paused")], true);
      for (const k of s.SETTING_KEYS) await s.getSetting(k);
      assert.equal(reads, 1);
    } finally {
      p.query = original;
    }
  });
});
