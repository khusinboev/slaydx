import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * BEPUL LLM ENDPOINTLARI — sarf chegarasi (prod-readiness C10:
 * EXT-02, ABUSE-01, CONC-11, CONC-13, SCALE-14, BEA-11).
 *
 * Ilgari `outline`/`udk`/`rewrite`/`polish` faqat qisqa oynali chegara
 * bilan himoyalangan edi: bitta bepul akkaunt (3 000 bonus ball bilan)
 * kuniga ≈ $50–100 provayder pulini yoqa olardi, global shift va o'chirish
 * tugmasi yo'q edi, limitlagich esa baza xatosida OCHIQ qolardi.
 *
 * Egasi qarori (qulflanadi):
 *   1. har endpoint uchun foydalanuvchi bo'yicha KUNLIK chegara, kun
 *      Toshkent vaqti bilan (UTC+5) almashadi;
 *   2. barcha foydalanuvchilar bo'yicha GLOBAL kunlik chegara → 503;
 *   3. `FREE_LLM_DISABLED` → 503, provayder chaqirilmaydi;
 *   4. rewrite/polish faqat PUL (balans yoki Pro kvota) bilan to'langan
 *      hujjatda — faqat bonus ball bilan to'langanda 402;
 *   5. bu endpointlar uchun limitlagich baza xatosida YOPIQ (503);
 *   6. bitta hujjatda bir vaqtda bitta AI tahrir (409 `busy`), mijoz
 *      uzilsa keyingi provayder chaqiruvlari qilinmaydi.
 *
 * Haqiqiy Postgres kerak (`DATABASE_URL`, tashlab yuboriladigan baza).
 */

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";

type Policy = import("../lib/server/spend.ts").FreeLlmPolicy;

function policy(over: Partial<Policy> = {}, daily: Partial<Policy["daily"]> = {}): Policy {
  return {
    disabled: false,
    globalDaily: 1_000_000,
    ...over,
    daily: { outline: 100, udk: 100, rewrite: 100, polish: 100, ...daily },
  };
}

async function status(p: Promise<unknown>): Promise<{ status: number; code?: unknown; message: string }> {
  const { ApiError } = await import("../lib/server/api.ts");
  try {
    await p;
  } catch (e) {
    assert.ok(e instanceof ApiError, `ApiError kutilgan edi, keldi: ${e}`);
    return { status: e.status, code: e.extra.code, message: e.message };
  }
  return { status: 200, message: "" };
}

/* ═══════════════════════ sof qism (bazasiz) ═══════════════════════ */

test("Toshkent kuni: 19:00 UTC da almashadi, UTC yarim tunda emas", async () => {
  const { tashkentDayStart } = await import("../lib/server/spend.ts");
  assert.equal(tashkentDayStart(Date.parse("2026-09-23T18:59:59Z")).toISOString(), "2026-09-22T19:00:00.000Z");
  assert.equal(tashkentDayStart(Date.parse("2026-09-23T19:00:00Z")).toISOString(), "2026-09-23T19:00:00.000Z");
  assert.equal(tashkentDayStart(Date.parse("2026-09-24T00:30:00Z")).toISOString(), "2026-09-23T19:00:00.000Z");
});

test("siyosat: standartlar va env o'qilishi", async () => {
  const { FREE_LLM_DEFAULTS, freeLlmPolicy } = await import("../lib/server/spend.ts");
  assert.deepEqual(FREE_LLM_DEFAULTS.daily, { outline: 20, udk: 20, rewrite: 30, polish: 10 });
  assert.equal(FREE_LLM_DEFAULTS.globalDaily, 20_000);
  const p = freeLlmPolicy();
  assert.equal(p.disabled, false);
  assert.deepEqual(p.daily, FREE_LLM_DEFAULTS.daily);
});

test("o'chirish tugmasidagi tanilmagan qiymat ogohlantiradi", async () => {
  const { runtimeWarnings } = await import("../lib/server/env.ts");
  const prev = process.env.FREE_LLM_DISABLED;
  try {
    process.env.FREE_LLM_DISABLED = "on";
    assert.ok(runtimeWarnings().some((w) => w.includes("FREE_LLM_DISABLED")));
    process.env.FREE_LLM_DISABLED = "true";
    assert.ok(!runtimeWarnings().some((w) => w.includes("FREE_LLM_DISABLED")));
  } finally {
    if (prev === undefined) delete process.env.FREE_LLM_DISABLED;
    else process.env.FREE_LLM_DISABLED = prev;
  }
});

test("o'chirish tugmasi: 503, provayder va baza chaqirilmaydi", async () => {
  const { withFreeLlm, assertFreeLlmEnabled } = await import("../lib/server/spend.ts");
  const { pool } = await import("../lib/server/db.ts");
  const p = pool() as unknown as { query: unknown; connect: unknown };
  const [q0, c0] = [p.query, p.connect];
  let dbCalls = 0;
  p.query = async () => { dbCalls++; throw new Error("baza chaqirilmasligi kerak"); };
  p.connect = async () => { dbCalls++; throw new Error("baza chaqirilmasligi kerak"); };
  try {
    let provider = 0;
    for (const endpoint of ["outline", "udk", "rewrite", "polish"] as const) {
      const r = await status(
        withFreeLlm(
          { endpoint, userId: "1", ...(endpoint === "rewrite" || endpoint === "polish" ? { doc: { id: "a1b2c3d4-0000-4000-8000-000000000001", baseVersion: 0 } } : {}) },
          async () => { provider++; return 1; },
          { policy: policy({ disabled: true }) },
        ),
      );
      assert.equal(r.status, 503, endpoint);
      assert.match(r.message, /vaqtincha o'chirilgan/);
    }
    assert.equal(provider, 0);
    assert.equal(dbCalls, 0);
    assert.throws(() => assertFreeLlmEnabled(policy({ disabled: true })), (e: Error & { status?: number }) => e.status === 503);
    assert.doesNotThrow(() => assertFreeLlmEnabled(policy()));
  } finally {
    p.query = q0;
    p.connect = c0;
  }
});

test("limitlagich: bepul LLM uchun baza xatosida YOPIQ (503), umumiy chaqiruvchilar uchun OCHIQ qoladi", async () => {
  const { rateLimit } = await import("../lib/server/ratelimit.ts");
  const { withFreeLlm } = await import("../lib/server/spend.ts");
  const { pool } = await import("../lib/server/db.ts");
  const p = pool() as unknown as { query: unknown; connect: unknown };
  const [q0, c0] = [p.query, p.connect];
  p.query = async () => { throw new Error("connection timeout"); };
  p.connect = async () => { throw new Error("connection timeout"); };
  const err = console.error;
  console.error = () => {};
  try {
    // Eski xulq o'zgarmaydi: `failClosed` berilmasa — ochiq.
    assert.equal((await rateLimit("t:open", 0, 60)).ok, true);
    const closed = await rateLimit("t:closed", 100, 60, { failClosed: true });
    assert.equal(closed.ok, false);
    assert.equal(closed.error, true);

    let provider = 0;
    for (const endpoint of ["outline", "udk"] as const) {
      const r = await status(withFreeLlm({ endpoint, userId: "1" }, async () => { provider++; return 1; }, { policy: policy() }));
      assert.equal(r.status, 503, endpoint);
    }
    const r = await status(
      withFreeLlm({ endpoint: "polish", userId: "1", doc: { id: "a1b2c3d4-0000-4000-8000-000000000001", baseVersion: 0 } }, async () => { provider++; return 1; }, { policy: policy() }),
    );
    assert.equal(r.status, 503);
    assert.equal(provider, 0);
  } finally {
    console.error = err;
    p.query = q0;
    p.connect = c0;
  }
});

test("manba skani: har to'rt route provayderni faqat `withFreeLlm` ichida chaqiradi", () => {
  const routes: Record<string, RegExp> = {
    "app/api/outline/route.ts": /draftOutline\(/,
    "app/api/article/udk/route.ts": /complete\(/,
    "app/api/generations/[id]/rewrite/route.ts": /rewriteArticle\(/,
    "app/api/generations/[id]/polish/route.ts": /polishGeneration\(/,
  };
  for (const [file, call] of Object.entries(routes)) {
    const src = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    const gate = src.indexOf("withFreeLlm(");
    assert.ok(gate > 0, `${file}: withFreeLlm chaqirilmaydi`);
    const m = call.exec(src);
    assert.ok(m, `${file}: provayder chaqiruvi topilmadi`);
    assert.ok(m.index > gate, `${file}: provayder withFreeLlm dan OLDIN chaqiriladi`);
    // Eski, UTC ga bog'langan va egalikdan oldingi chelaklar qaytmasin.
    assert.doesNotMatch(src, /limit\(`polish:\$\{id\}`/, `${file}: polish:\${id} chelagi qaytdi`);
    assert.match(src, /assertFreeLlmEnabled\(\)/, `${file}: o'chirish tugmasi darhol tekshirilmaydi`);
  }
});

test("compose: bepul LLM sozlamalari web'ga uzatiladi va .env.example da hujjatlangan", () => {
  const yaml = readFileSync(new URL("../docker-compose.yml", import.meta.url), "utf8");
  const start = yaml.indexOf("\n  web:");
  assert.ok(start >= 0);
  const rest = yaml.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z]/);
  const web = next >= 0 ? rest.slice(0, next + 1) : rest;
  const example = readFileSync(new URL("../.env.example", import.meta.url), "utf8");
  for (const k of ["FREE_LLM_DISABLED", "FREE_LLM_DAILY_OUTLINE", "FREE_LLM_DAILY_UDK", "FREE_LLM_DAILY_REWRITE", "FREE_LLM_DAILY_POLISH", "FREE_LLM_DAILY_GLOBAL"]) {
    assert.match(web, new RegExp(`^\\s+${k}: \\$\\{${k}:-[^}]*\\}$`, "m"), `web: ${k} uzatilmaydi`);
    assert.match(example, new RegExp(`^#? ?${k}=`, "m"), `${k} .env.example da yo'q`);
  }
});

/* ═══════════════════════ haqiqiy Postgres ═══════════════════════ */

test("bepul LLM — Postgres", { skip: hasDb ? false : "DATABASE_URL yo'q" }, async (t) => {
  const { query, migrate, pool } = await import("../lib/server/db.ts");
  const { withFreeLlm } = await import("../lib/server/spend.ts");
  await migrate();

  const tag = `fl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const uids: string[] = [];
  async function user(): Promise<string> {
    const rows = await query<{ id: string }>(`INSERT INTO users (username, name) VALUES ($1, 'Test') RETURNING id::text AS id`, [`${tag}-${uids.length}`]);
    uids.push(rows[0].id);
    return rows[0].id;
  }
  /** COMPLETED hujjat + `charge` qatori (qaysi hamyondan qancha). */
  async function gen(uid: string, split: { points?: number; quota?: number; balance?: number } | null, refund?: { quota?: number; balance?: number }): Promise<string> {
    const id = crypto.randomUUID();
    await query(`INSERT INTO generations (id, user_id, tool_id, topic, status, price) VALUES ($1, $2, 'article', 't', 'COMPLETED', 4000)`, [id, uid]);
    if (split) {
      await query(
        `INSERT INTO transactions (user_id, kind, points_delta, quota_delta, balance_delta, reference) VALUES ($1, 'charge', $2, $3, $4, $5)`,
        [uid, -(split.points ?? 0), -(split.quota ?? 0), -(split.balance ?? 0), id],
      );
    }
    if (refund) {
      await query(
        `INSERT INTO transactions (user_id, kind, quota_delta, balance_delta, reference) VALUES ($1, 'refund', $2, $3, $4)`,
        [uid, refund.quota ?? 0, refund.balance ?? 0, id],
      );
    }
    return id;
  }
  const ok = async () => 1;

  t.after(async () => {
    await query(`DELETE FROM rate_limits WHERE bucket LIKE $1`, [`${tag}%`]);
    if (uids.length) await query(`DELETE FROM users WHERE id = ANY($1::bigint[])`, [uids]);
    await pool().end();
  });

  await t.test("foydalanuvchi kunlik chegarasi Toshkent kuni bilan almashadi", async () => {
    const uid = await user();
    const deps = (now: string) => ({ policy: policy({}, { udk: 3 }), now: Date.parse(now), bucketPrefix: tag });
    for (let i = 0; i < 3; i++) assert.equal(await withFreeLlm({ endpoint: "udk", userId: uid }, ok, deps("2026-09-23T05:00:00Z")), 1);
    const r = await status(withFreeLlm({ endpoint: "udk", userId: uid }, ok, deps("2026-09-23T18:59:00Z")));
    assert.equal(r.status, 429);
    assert.match(r.message, /Bugungi bepul chegara/);
    // Toshkent 00:00 = 19:00 UTC — yangi kun.
    assert.equal(await withFreeLlm({ endpoint: "udk", userId: uid }, ok, deps("2026-09-23T19:01:00Z")), 1);
    await withFreeLlm({ endpoint: "udk", userId: uid }, ok, deps("2026-09-23T20:00:00Z"));
    await withFreeLlm({ endpoint: "udk", userId: uid }, ok, deps("2026-09-23T21:00:00Z"));
    // UTC yarim tuni (Toshkentda 05:00) — hali O'SHA kun, chegara turadi.
    assert.equal((await status(withFreeLlm({ endpoint: "udk", userId: uid }, ok, deps("2026-09-24T00:30:00Z")))).status, 429);
    // Boshqa endpoint — alohida hisob.
    assert.equal(await withFreeLlm({ endpoint: "outline", userId: uid }, ok, deps("2026-09-24T00:30:00Z")), 1);
  });

  await t.test("global kunlik chegara → 503 (vazn bilan)", async () => {
    const a = await user();
    const b = await user();
    // O'z prefiksi: global chelak boshqa subtestlarning urinishlarini ko'rmasin.
    const deps = { policy: policy({ globalDaily: 3 }), now: Date.parse("2026-09-23T08:00:00Z"), bucketPrefix: `${tag}-g:` };
    assert.equal(await withFreeLlm({ endpoint: "outline", userId: a }, ok, deps), 1); // vazn 2
    assert.equal(await withFreeLlm({ endpoint: "udk", userId: b }, ok, deps), 1); // vazn 1 → 3
    let provider = 0;
    const r = await status(withFreeLlm({ endpoint: "udk", userId: b }, async () => { provider++; return 1; }, deps));
    assert.equal(r.status, 503);
    assert.match(r.message, /umumiy/);
    assert.equal(provider, 0);
    // Ertasi Toshkent kuni — yana ochiq.
    assert.equal(await withFreeLlm({ endpoint: "udk", userId: b }, ok, { ...deps, now: Date.parse("2026-09-23T19:30:00Z") }), 1);
  });

  await t.test("rewrite/polish faqat pul bilan to'langan hujjatda", async () => {
    const uid = await user();
    const other = await user();
    const deps = { policy: policy(), bucketPrefix: tag };
    let provider = 0;
    const run = async () => { provider++; return "ok"; };

    const bonusOnly = await gen(uid, { points: 4000 });
    for (const endpoint of ["rewrite", "polish"] as const) {
      const r = await status(withFreeLlm({ endpoint, userId: uid, doc: { id: bonusOnly, baseVersion: 0 } }, run, deps));
      assert.equal(r.status, 402, endpoint);
      assert.equal(r.code, "unpaid");
      assert.match(r.message, /bonus/);
    }
    const legacy = await gen(uid, null);
    assert.equal((await status(withFreeLlm({ endpoint: "rewrite", userId: uid, doc: { id: legacy, baseVersion: 0 } }, run, deps))).status, 402);
    // To'liq qaytarilgan pul — endi to'lanmagan.
    const refunded = await gen(uid, { balance: 4000 }, { balance: 4000 });
    assert.equal((await status(withFreeLlm({ endpoint: "rewrite", userId: uid, doc: { id: refunded, baseVersion: 0 } }, run, deps))).status, 402);
    assert.equal(provider, 0);

    const paid = await gen(uid, { points: 3000, balance: 1000 });
    assert.equal(await withFreeLlm({ endpoint: "rewrite", userId: uid, doc: { id: paid, baseVersion: 0 } }, run, deps), "ok");
    const pro = await gen(uid, { quota: 4000 });
    assert.equal(await withFreeLlm({ endpoint: "polish", userId: uid, doc: { id: pro, baseVersion: 0 } }, run, deps), "ok");
    assert.equal(provider, 2);

    // Begona hujjat — 404, uning egasining chelaklari ham yeyilmaydi.
    assert.equal((await status(withFreeLlm({ endpoint: "polish", userId: other, doc: { id: paid, baseVersion: 0 } }, run, deps))).status, 404);
    // Eskirgan versiya — chelak yeyilmasdan 409.
    const v = await status(withFreeLlm({ endpoint: "polish", userId: uid, doc: { id: paid, baseVersion: 7 } }, run, deps));
    assert.equal(v.status, 409);
    assert.equal(v.code, "version");
    const buckets = await query<{ bucket: string }>(`SELECT bucket FROM rate_limits WHERE bucket LIKE $1`, [`${tag}%`]);
    assert.deepEqual(buckets.filter((b) => b.bucket.split(":").includes(other)), [], "begona foydalanuvchi chelak yemasligi kerak");
  });

  await t.test("polish: hujjat bo'yicha 3/kun (egasi+hujjat kaliti) va foydalanuvchi kunlik chegarasi", async () => {
    const uid = await user();
    const doc = await gen(uid, { balance: 4000 });
    const doc2 = await gen(uid, { balance: 4000 });
    const deps = { policy: policy({}, { polish: 4 }), now: Date.parse("2026-09-23T08:00:00Z"), bucketPrefix: tag };
    for (let i = 0; i < 3; i++) await withFreeLlm({ endpoint: "polish", userId: uid, doc: { id: doc, baseVersion: 0 } }, ok, deps);
    assert.equal((await status(withFreeLlm({ endpoint: "polish", userId: uid, doc: { id: doc, baseVersion: 0 } }, ok, deps))).status, 429);
    // 4-chi urinish foydalanuvchi chelagini yedi (4/4) — boshqa hujjat ham 429.
    assert.equal((await status(withFreeLlm({ endpoint: "polish", userId: uid, doc: { id: doc2, baseVersion: 0 } }, ok, deps))).status, 429);
  });

  await t.test("bitta hujjatda bir vaqtda bitta AI tahrir (409 busy), tugagach yana ochiq", async () => {
    const uid = await user();
    const doc = await gen(uid, { balance: 4000 });
    const deps = { policy: policy(), bucketPrefix: tag };
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const first = withFreeLlm({ endpoint: "polish", userId: uid, doc: { id: doc, baseVersion: 0 } }, async () => { await gate; return "a"; }, deps);
    await new Promise((r) => setTimeout(r, 150));
    let provider = 0;
    const second = await status(withFreeLlm({ endpoint: "rewrite", userId: uid, doc: { id: doc, baseVersion: 0 } }, async () => { provider++; return "b"; }, deps));
    assert.equal(second.status, 409);
    assert.equal(second.code, "busy");
    assert.equal(provider, 0);
    release();
    assert.equal(await first, "a");
    assert.equal(await withFreeLlm({ endpoint: "rewrite", userId: uid, doc: { id: doc, baseVersion: 0 } }, async () => "c", deps), "c");
    // Yiqilgan ish ham qulfni bo'shatadi.
    await assert.rejects(withFreeLlm({ endpoint: "rewrite", userId: uid, doc: { id: doc, baseVersion: 0 } }, async () => { throw new Error("x"); }, deps));
    assert.equal(await withFreeLlm({ endpoint: "rewrite", userId: uid, doc: { id: doc, baseVersion: 0 } }, async () => "d", deps), "d");
  });

  /*
   * R1 (ko'rib chiqish): qulf eskirganligi EGASINING muddati bilan
   * o'lchanadi. Ilgari kiruvchi so'rovning TTL i ishlatilardi: 100 s
   * davom etayotgan «Hammasini tuzatish» qulfini (180 s) «Tuzatish»
   * (90 s) eskirgan deb o'chirib, ikkalasi ham LLM pulini yerdi.
   */
  await t.test("tirik polish qulfini rewrite o'g'irlamaydi (egasining muddati)", async () => {
    const uid = await user();
    const doc = await gen(uid, { balance: 4000 });
    const T = Date.parse("2026-09-23T08:00:00Z");
    const deps = (now: number) => ({ policy: policy(), bucketPrefix: tag, now });
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const first = withFreeLlm({ endpoint: "polish", userId: uid, doc: { id: doc, baseVersion: 0 } }, async () => { await gate; return "a"; }, deps(T - 100_000));
    await new Promise((r) => setTimeout(r, 150));
    let provider = 0;
    const r = await status(withFreeLlm({ endpoint: "rewrite", userId: uid, doc: { id: doc, baseVersion: 0 } }, async () => { provider++; return "b"; }, deps(T)));
    release();
    assert.equal(await first, "a");
    assert.equal(r.status, 409, "100 s lik polish qulfi hali tirik — rewrite 409 busy olishi kerak");
    assert.equal(r.code, "busy");
    assert.equal(provider, 0);
    // Egasining muddati o'tgach (jarayon yiqilgan holat) — qulf eskiradi.
    const stale = withFreeLlm({ endpoint: "polish", userId: uid, doc: { id: doc, baseVersion: 0 } }, () => new Promise<string>(() => {}), deps(T));
    void stale;
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(await withFreeLlm({ endpoint: "rewrite", userId: uid, doc: { id: doc, baseVersion: 0 } }, async () => "c", deps(T + 3_600_000)), "c");
  });

  /*
   * R2 (ko'rib chiqish): 409 `busy` rad etilgan so'rov chelak YEMAYDI —
   * nginx 504 dan keyin qayta bosish hujjatning 3/kun sayqalini, kunlik
   * va global hisobni kamaytirmasin (BEA-11).
   */
  await t.test("409 busy chelaklarni yemaydi", async () => {
    const uid = await user();
    const doc = await gen(uid, { balance: 4000 });
    const pre = `${tag}-busy:`;
    const deps = { policy: policy(), bucketPrefix: pre };
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const first = withFreeLlm({ endpoint: "polish", userId: uid, doc: { id: doc, baseVersion: 0 } }, async () => { await gate; return "a"; }, deps);
    await new Promise((r) => setTimeout(r, 150));
    const before = await hits(pre);
    for (const endpoint of ["polish", "rewrite"] as const) {
      const r = await status(withFreeLlm({ endpoint, userId: uid, doc: { id: doc, baseVersion: 0 } }, async () => "b", deps));
      assert.equal(r.code, "busy", endpoint);
    }
    const after = await hits(pre);
    release();
    await first;
    assert.deepEqual(after, before, "rad etilgan so'rov chelak yemasligi kerak");
    assert.equal(before[`${pre}polish:${uid}:${doc}`], 1);
  });

  await t.test("rateLimit: vazn birdan ortiq birlik yeydi", async () => {
    const { rateLimit } = await import("../lib/server/ratelimit.ts");
    const b = `${tag}-w`;
    assert.equal((await rateLimit(b, 5, 600, { weight: 3 })).ok, true);
    const second = await rateLimit(b, 5, 600, { weight: 3 });
    assert.equal(second.ok, false);
    assert.equal(second.remaining, 0);
  });

  async function hits(prefix: string): Promise<Record<string, number>> {
    const rows = await query<{ bucket: string; hits: number }>(
      `SELECT bucket, hits FROM rate_limits WHERE bucket LIKE $1 AND bucket NOT LIKE $2`,
      [`${prefix}%`, `${prefix}inflight:%`],
    );
    return Object.fromEntries(rows.map((r) => [r.bucket, r.hits]));
  }

  await t.test("mijoz uzilsa keyingi provayder chaqiruvlari qilinmaydi", async () => {
    const uid = await user();
    const ctrl = new AbortController();
    let calls = 0;
    const complete = (async () => { calls++; return { text: "{}" }; }) as never;
    const out = await withFreeLlm(
      { endpoint: "udk", userId: uid, signal: ctrl.signal },
      async (c) => {
        const a = await c("fast", "s", "u");
        ctrl.abort();
        const b = await c("fast", "s", "u");
        return [a, b];
      },
      { policy: policy(), bucketPrefix: tag, complete },
    );
    assert.equal(calls, 1);
    assert.deepEqual(out, [{ text: "{}" }, null]);
  });
});
