/**
 * «Qattiqqo'l domla» (owner request 15, migration 057): `lib/domla/*` (rules, prompts, persona), `lib/server/domla.ts`
 * (service), `domla-engine.ts` (worker jobs), `domla-deps.ts` (Gemini scoring / Telegram edges) and the bot layer
 * (`bot/domla.ts`, `/domla`, voice + text answers) on real Postgres (own throwaway database). Telegram is stubbed at
 * `fetch` (so the REAL sendAudio / getFile / download code runs); the question LLM, the TTS and the scorer are
 * injected stubs. Any other outgoing URL (Gemini!) throws, so a webhook that did heavy work inline would fail.
 *
 * Mutation checks (each broken on purpose, the named test failed, then restored):
 *   1. a repeated start charges again (early `alreadyOpen` return + the unique index handling removed,
 *      charge reference made per call)                                       -> «start charges once»;
 *   2. no refund when question generation fails (`refundInTx` removed from `failSession`)
 *                                                                            -> «question generation fails»;
 *   3. grade mapping off by one (`>=` thresholds shifted by one point)      -> «grade table»;
 *   4. heavy work inline in the webhook (`handleVoice` runs the worker tick) -> «voice answer … webhook is fast».
 */
process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters-long";
process.env.APP_URL = "https://slaydx.test";
process.env.TELEGRAM_BOT_TOKEN = "123456:FAKE-domla-token";
process.env.NEXT_PUBLIC_TELEGRAM_BOT = "slaydx_test_bot";
process.env.GEMINI_API_KEY = "test-gemini-key";
delete process.env.BOT_PREMIUM_EMOJI;
import "./helpers/next-request.mts";
import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { createIsolatedDb } from "./helpers/isolated-db.mts";
import { inRequest } from "./helpers/next-request.mts";

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("domla") : { isolated: false, drop: async () => {} };
const skip = !hasDb ? "Postgres kerak (DATABASE_URL)" : iso.isolated ? false : "alohida Postgres baza yaratilmadi";
if (!hasDb) process.env.DATABASE_URL = "postgres://unused/unused";

const rules = await import("../lib/domla/rules.ts");
const persona = await import("../lib/domla/persona.ts");
const prompts = await import("../lib/domla/prompts.ts");
const { deckText } = await import("../lib/domla/deck-text.ts");
const { query, queryOne, pool, ensureMigrated } = await import("../lib/server/db.ts");
const svc = await import("../lib/server/domla.ts");
const engine = await import("../lib/server/domla-engine.ts");
const edges = await import("../lib/server/domla-deps.ts");
const tg = await import("../lib/server/telegram.ts");
const settings = await import("../lib/server/settings.ts");
const { topUp } = await import("../lib/server/credits.ts");
const { upsertTelegramUser } = await import("../lib/server/auth.ts");
const { createSession, SESSION_COOKIE } = await import("../lib/server/session.ts");
const { ApiError } = await import("../lib/server/api.ts");
const codes = await import("../lib/server/bot/codes.ts");
const i18n = await import("../lib/server/bot/i18n.ts");
const route = await import("../app/api/domla/route.ts");
if (!skip) await ensureMigrated();

const realFetch = globalThis.fetch;
after(async () => {
  globalThis.fetch = realFetch;
  if (skip) return;
  await pool().end();
  await iso.drop();
});

/* ───────────────────────── Telegram stub (at fetch) ───────────────────────── */

type Call = { method: string; body: Record<string, unknown>; audioBytes?: number };
let calls: Call[] = [];
let outbound: string[] = [];
let nextMessageId = 5000;
/** What the file download answers. */
let fileInfo: { size: number | undefined } = { size: 20_000 };
let fileBody: Uint8Array = new Uint8Array([79, 103, 103, 83, 1, 2, 3, 4]);
let fileHeaders: Record<string, string> = {};
function installFetch(): void {
  calls = [];
  outbound = [];
  fileInfo = { size: 20_000 };
  fileBody = new Uint8Array([79, 103, 103, 83, 1, 2, 3, 4]);
  fileHeaders = {};
  globalThis.fetch = (async (url: string | URL, init?: { body?: unknown; method?: string }) => {
    const u = String(url);
    outbound.push(u);
    const file = /^https:\/\/api\.telegram\.org\/file\/bot[^/]+\/(.+)$/.exec(u);
    if (file) return new Response(new Uint8Array(fileBody), { headers: fileHeaders });
    const m = /^https:\/\/api\.telegram\.org\/bot[^/]+\/(\w+)$/.exec(u);
    assert.ok(m, `unexpected outgoing URL ${u}`);
    const method = m[1]!;
    if (init?.body instanceof FormData) {
      const body: Record<string, unknown> = {};
      let audioBytes: number | undefined;
      for (const [k, v] of init.body.entries()) {
        if (v instanceof Blob) audioBytes = v.size;
        else body[k] = v;
      }
      calls.push({ method, body, ...(audioBytes !== undefined ? { audioBytes } : {}) });
    } else calls.push({ method, body: init?.body ? JSON.parse(String(init.body)) : {} });
    const result =
      method === "getFile" ? { file_id: "x", file_path: "voice/file_1.oga", ...(fileInfo.size !== undefined ? { file_size: fileInfo.size } : {}) } : method === "sendMessage" || method === "sendAudio" ? { message_id: ++nextMessageId } : true;
    return new Response(JSON.stringify({ ok: true, result }));
  }) as typeof fetch;
}
const sent = (method = "sendMessage") => calls.filter((c) => c.method === method);
const texts = () => sent().map((c) => String(c.body.text));

/* ───────────────────────── fixtures ───────────────────────── */

const QUESTIONS: import("../lib/domla/rules.ts").DomlaQuestion[] = [
  { kind: "why", text: "Nega fotosintez faqat yorug'likda ketadi?", ideal: "Chunki xlorofill yorug'lik energiyasini yutadi va shu energiya reaksiyani boshlaydi." },
  { kind: "method", text: "Fotosintez qanday bosqichlarda o'tadi?", ideal: "Yorug'lik va qorong'ilik bosqichlari: avval ATF hosil bo'ladi, keyin glyukoza." },
  { kind: "definition", text: "Xlorofill nima?", ideal: "Xlorofill — o'simlikdagi yashil pigment, yorug'likni yutadi." },
  { kind: "number", text: "Slaydda yoritilgan kunlik yorug'lik necha soat?", ideal: "To'rt soat." },
  { kind: "practice", text: "Bu bilimni issiqxonada qanday qo'llaysiz?", ideal: "Lampalar bilan yorug'lik vaqtini oshirib, hosilni ko'paytiraman." },
];
const SLIDES = [
  { id: "s1", layout: "title", title: "Fotosintez" },
  { id: "s2", layout: "bullets", title: "Yorug'lik", bullets: ["Xlorofill yorug'likni yutadi", "Kuniga 4 soat yorug'lik"] },
  { id: "s3", layout: "bullets", title: "Bosqichlar", bullets: ["Yorug'lik bosqichi", "Qorong'ilik bosqichi"] },
  { id: "s4", layout: "stats", title: "Raqamlar", stats: [{ value: "4", label: "soat yorug'lik" }] },
];

const createdUsers: string[] = [];
type TestUser = { id: string; tg: number };
async function newUser(points = 10_000): Promise<TestUser> {
  const tgId = 7_700_000_000 + randomInt(0, 99_999_999);
  const u = await upsertTelegramUser({ telegramId: String(tgId), username: null, name: "Domla Test", photoUrl: null });
  createdUsers.push(u.id);
  // The signup bonus is not part of these scenarios: start from an exact balance.
  await query("UPDATE users SET points = 0 WHERE id = $1", [u.id]);
  if (points > 0) await topUp(u.id, { points }, `test:domla:${u.id}`, "bonus", "test");
  return { id: u.id, tg: tgId };
}
async function newWork(userId: string, opts: { tool?: string; topic?: string; status?: string; slides?: unknown[]; at?: string } = {}): Promise<string> {
  const id = randomUUID();
  await query(
    `INSERT INTO generations (id, user_id, tool_id, topic, status, doc_json, created_at) VALUES ($1, $2, $3, $4, $5, $6::jsonb, COALESCE($7::timestamptz, now()))`,
    [id, userId, opts.tool ?? "slide", opts.topic ?? "Fotosintez", opts.status ?? "COMPLETED", JSON.stringify({ slides: opts.slides ?? SLIDES }), opts.at ?? null],
  );
  return id;
}
const points = async (id: string) => Number((await queryOne<{ p: string }>("SELECT points::text AS p FROM users WHERE id = $1", [id]))!.p);
const ledger = (id: string, kind: string) =>
  query<{ reference: string; points_delta: string }>("SELECT reference, points_delta::text AS points_delta FROM transactions WHERE user_id = $1 AND kind = $2 AND reference LIKE 'domla:%'", [id, kind]);
const sessionRows = (userId: string) => query<{ id: string; status: string }>("SELECT id, status FROM domla_sessions WHERE user_id = $1 ORDER BY created_at", [userId]);
const jobKinds = async () => (await query<{ kind: string; idx: number }>("SELECT kind, idx FROM domla_jobs ORDER BY id")).map((j) => `${j.kind}:${j.idx}`);

async function setSetting(key: string, value: unknown): Promise<void> {
  await query("INSERT INTO app_settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [key, JSON.stringify(value)]);
  settings.invalidateSettingsCache();
}
async function resetSettings(): Promise<void> {
  await query("DELETE FROM app_settings WHERE key LIKE 'domla.%'");
  settings.invalidateSettingsCache();
}

/* ───────────────────────── injected stubs ───────────────────────── */

type Stubs = {
  deps: import("../lib/server/domla-deps.ts").DomlaDeps;
  scoreQueue: number[];
  scored: import("../lib/server/domla-deps.ts").ScoreInput[];
  spoken: string[];
  questionCalls: number;
  failQuestions: boolean;
  failTts: boolean;
};
function makeStubs(): Stubs {
  const base = edges.defaultDeps();
  const st: Stubs = { deps: base, scoreQueue: [], scored: [], spoken: [], questionCalls: 0, failQuestions: false, failTts: false };
  st.deps = {
    ...base,
    generateQuestions: async () => {
      st.questionCalls++;
      if (st.failQuestions) throw new Error("AI savollar tuzmadi");
      return QUESTIONS;
    },
    synthesize: async (text) => {
      st.spoken.push(text);
      if (st.failTts) throw new Error("tts down");
      return { bytes: new Uint8Array([73, 68, 51, 4, 0]), seconds: 4 };
    },
    score: async (input) => {
      st.scored.push(input);
      const score = st.scoreQueue.shift() ?? 4;
      return {
        transcript: input.audio ? `ovozli javob ${st.scored.length}` : (input.text ?? ""),
        score,
        verdict: score >= 4 ? "Yaxshi javob" : "Javob to'liq emas",
        mistake: score >= 5 ? "" : "Asosiy faktni aytmadingiz",
      };
    },
  };
  return st;
}

/** Runs queued jobs until none is left (a retry's back-off is skipped). */
async function drain(st: Stubs, max = 30): Promise<number> {
  let n = 0;
  for (;;) {
    await query("UPDATE domla_jobs SET run_after = now(), locked_until = NULL");
    if (!(await engine.domlaTick(st.deps)) || ++n >= max) return n;
  }
}

let seq = Date.now() * 1000 + 700_000;
const textUpdate = (from: number, text: string) => ({
  update_id: ++seq,
  message: { message_id: ++seq, chat: { id: from, type: "private" }, from: { id: from, first_name: "Talaba" }, text },
});
const voiceUpdate = (from: number, v: Record<string, unknown> = {}) => ({
  update_id: ++seq,
  message: {
    message_id: ++seq,
    chat: { id: from, type: "private" },
    from: { id: from, first_name: "Talaba" },
    voice: { file_id: "VOICE-1", duration: 6, mime_type: "audio/ogg", file_size: 20_000, ...v },
  },
});
const cbUpdate = (from: number, data: string, chatId = from, chatType = "private") => ({
  update_id: ++seq,
  callback_query: { id: `cq${++seq}`, from: { id: from }, message: { message_id: 777, chat: { id: chatId, type: chatType } }, data },
});
const toasts = () => sent("answerCallbackQuery").map((c) => String(c.body.text ?? ""));
const buttons = (c: Call): { text: string; callback_data?: string; web_app?: { url: string } }[] =>
  ((c.body.reply_markup as { inline_keyboard?: { text: string; callback_data?: string }[][] } | undefined)?.inline_keyboard ?? []).flat();

/** A user with a work, a started defence and question 1 spoken. */
async function started(points = 10_000): Promise<{ u: TestUser; gen: string; sessionId: string; st: Stubs }> {
  const u = await newUser(points);
  const gen = await newWork(u.id);
  const st = makeStubs();
  const r = await svc.startDefence(u.id, gen);
  await drain(st);
  return { u, gen, sessionId: r.session.id, st };
}

beforeEach(async () => {
  if (skip) return;
  await resetSettings();
  // Jobs of earlier scenarios must not be run by this scenario's stubs.
  await query("DELETE FROM domla_sessions");
  installFetch();
});

/* ───────────────────────── pure rules ───────────────────────── */

test("grade table: 86 / 71 / 55 % of the maximum, exact at every boundary, unanswered = 0", () => {
  const sum = (n: number) => [Math.min(5, n), Math.min(5, Math.max(0, n - 5)), Math.min(5, Math.max(0, n - 10)), Math.min(5, Math.max(0, n - 15)), Math.min(5, Math.max(0, n - 20))];
  const table: [number, number][] = [[25, 5], [22, 5], [21, 4], [18, 4], [17, 3], [14, 3], [13, 2], [0, 2]];
  for (const [total, grade] of table) assert.equal(rules.gradeOf(sum(total)), grade, `${total}/25`);
  assert.equal(rules.gradeOf([5, 5, 5, 5]), 4, "a missing 5th answer counts 0 (20/25)");
  assert.equal(rules.gradeOf([]), 2);
  assert.equal(rules.gradeOf([9, 9, 9, 9, 9]), 5, "a score above 5 is clamped");
  assert.equal(rules.gradeOf([-3, NaN as number, 0, 0, 0]), 2);
  assert.equal(rules.clampScore("4"), 4);
});

test("parsers: exactly 5 usable questions or nothing; a score needs a number", () => {
  assert.equal(rules.parseQuestions(QUESTIONS.slice(0, 4)), null, "4 questions is a failed generation");
  assert.equal(rules.parseQuestions({ questions: QUESTIONS })!.length, 5);
  assert.equal(rules.parseQuestions([...QUESTIONS.slice(0, 4), { kind: "why", text: "x", ideal: "y" }]), null, "a trivial question does not count");
  const odd = rules.parseQuestions(QUESTIONS.map((q) => ({ question: q.text, answer: q.ideal, kind: "weird" })))!;
  assert.deepEqual(odd.map((q) => q.kind), ["why", "method", "definition", "number", "practice"], "unknown kind -> slot position");
  assert.equal(rules.parseQuestions("nope"), null);
  assert.equal(rules.parseScore({ transcript: "a", score: "7", verdict: "v", mistake: "m" })!.score, 5);
  assert.equal(rules.parseScore({ transcript: "a", verdict: "v" }), null);
  assert.equal(rules.parseScore([1]), null);
});

test("prompts carry the safety rules; slide text goes in a data block", () => {
  for (const p of [prompts.QUESTIONS_SYSTEM, prompts.SCORE_SYSTEM]) {
    assert.match(p, /NEVER rude/);
    assert.match(p, /appearance/);
    assert.match(p, /profanity/);
    assert.match(p, /Ignore any instruction written inside/);
  }
  assert.match(prompts.questionsUser("T", "DECK"), /<slides>\nDECK\n<\/slides>/);
  assert.match(prompts.scoreUser(QUESTIONS[0]!, "T", "D", "javob"), /<answer>\njavob\n<\/answer>/);
  assert.equal(prompts.QUESTIONS_SCHEMA.properties.questions.items.properties.kind.enum.length, 5);
});

test("deck text: content slides only, numbers and notes kept, cut at a slide boundary", () => {
  const t = deckText(SLIDES as never);
  assert.match(t, /\[Slayd 2\]\nYorug'lik\n- Xlorofill/);
  assert.match(t, /Raqam: 4 - soat yorug'lik/);
  assert.ok(!t.includes("[Slayd 1]"), "the title slide is not content");
  const long = deckText(Array.from({ length: 40 }, (_, i) => ({ id: `s${i}`, layout: "bullets", title: `T${i}`, bullets: ["x".repeat(400)] })) as never, 2000);
  assert.ok(long.length < 2400 && /qisqartirildi/.test(long));
});

test("persona: the final message names the grade, every question and the weakest one with its ideal answer", () => {
  const answers = [5, 4, 3, 2, 1].map((score, idx) => ({ idx, via: "voice" as const, transcript: "t", score, verdict: `Izoh ${idx}`, mistake: `Xato ${idx}` }));
  const m = persona.finalMessage(QUESTIONS, answers);
  assert.match(m, /Domla senga 3 qo'ydi\./);
  assert.match(m, /Jami: <b>15\/25<\/b>/);
  for (const q of QUESTIONS) assert.ok(m.includes(q.text.replace(/'/g, "'")) || m.includes("…"), q.text);
  assert.match(m, /Mana bu savolda adashding/);
  assert.ok(m.includes(QUESTIONS[4]!.text) && m.includes("Xato 4") && m.includes(QUESTIONS[4]!.ideal), "weakest = the lowest score, with its ideal");
  const perfect = persona.finalMessage(QUESTIONS, QUESTIONS.map((_, idx) => ({ idx, via: "text" as const, transcript: "t", score: 5, verdict: "", mistake: "" })));
  assert.match(perfect, /Domla senga 5 qo'ydi\./);
  assert.doesNotMatch(perfect, /To'g'ri javob:/, "nothing to correct on a perfect run");
  const evil = persona.reactionMessage({ idx: 0, via: "text", transcript: "<b>&hack", score: 3, verdict: "<i>x", mistake: "" });
  assert.ok(!evil.includes("<b>&hack") && evil.includes("&lt;b&gt;&amp;hack"), "the transcript is escaped");
  for (const g of [2, 3, 4, 5] as const) assert.match(persona.headline(g), new RegExp(`^Domla senga ${g} qo'ydi\\.`));
});

test("callback codes: dm:l / dm:s:<uuid> / dm:r:<uuid>, 64-byte limit, junk is unknown", () => {
  const id = randomUUID();
  assert.deepEqual(codes.parseCallback(codes.cb.domlaList()), { kind: "domlaList" });
  assert.deepEqual(codes.parseCallback(codes.cb.domlaStart(id)), { kind: "domlaStart", generationId: id });
  assert.deepEqual(codes.parseCallback(codes.cb.domlaResume(id)), { kind: "domlaResume", sessionId: id });
  assert.ok(Buffer.byteLength(codes.cb.domlaStart(id)) <= 64);
  for (const bad of ["dm:s:123", "dm:s:", "dm:x", `dm:s:${id}:z`, "dm:s:' OR 1=1"]) assert.equal(codes.parseCallback(bad).kind, "unknown", bad);
});

test("i18n: every domla.* key has uz, ru and en with the same placeholders; the command text exists", () => {
  const keys = i18n.TEXT_KEYS.filter((k) => k.startsWith("domla."));
  assert.ok(keys.length >= 20);
  for (const k of keys) {
    const e = i18n.rawEntry(k);
    const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
    for (const l of ["uz", "ru", "en"] as const) assert.ok(e[l].trim(), `${k}.${l}`);
    assert.equal(vars(e.ru), vars(e.uz), k);
    assert.equal(vars(e.en), vars(e.uz), k);
  }
  assert.ok((tg.BOT_COMMANDS as readonly string[]).includes("domla"));
});

/* ───────────────────────── start / money ───────────────────────── */

test("start charges once: a repeated and a parallel start return the same session, one charge", { skip }, async () => {
  const u = await newUser(10_000);
  const gen = await newWork(u.id);
  const first = await svc.startDefence(u.id, gen);
  assert.equal(first.alreadyOpen, false);
  assert.equal(first.price, 3000);
  assert.equal(first.session.status, "preparing");
  assert.equal(first.session.chargedPoints, 3000);
  assert.equal(await points(u.id), 7000);

  const again = await svc.startDefence(u.id, gen);
  assert.equal(again.alreadyOpen, true);
  assert.equal(again.session.id, first.session.id);
  const [p1, p2] = await Promise.all([svc.startDefence(u.id, gen), svc.startDefence(u.id, gen)]);
  assert.equal(p1.session.id, first.session.id);
  assert.equal(p2.session.id, first.session.id);

  assert.equal(await points(u.id), 7000, "charged exactly once");
  assert.deepEqual((await ledger(u.id, "charge")).map((r) => [r.reference, r.points_delta]), [[`domla:${first.session.id}`, "-3000"]]);
  assert.equal((await sessionRows(u.id)).length, 1);
  assert.deepEqual(await jobKinds(), ["questions:0"], "one questions job");
});

test("start charges once, even for two simultaneous FIRST starts of a fresh user", { skip }, async () => {
  const u = await newUser(10_000);
  const gen = await newWork(u.id);
  const rs = await Promise.all([svc.startDefence(u.id, gen), svc.startDefence(u.id, gen), svc.startDefence(u.id, gen)]);
  assert.equal(new Set(rs.map((r) => r.session.id)).size, 1);
  assert.equal(rs.filter((r) => !r.alreadyOpen).length, 1, "exactly one start created it");
  assert.equal(await points(u.id), 7000);
  assert.equal((await ledger(u.id, "charge")).length, 1);
});

test("start refusals: another work while one is open, a foreign / unfinished / wrong-tool work, no money, no Telegram", { skip }, async () => {
  const a = await newUser(10_000);
  const b = await newUser(10_000);
  const genA = await newWork(a.id);
  const genA2 = await newWork(a.id, { topic: "Boshqa" });
  await svc.startDefence(a.id, genA);
  await assert.rejects(svc.startDefence(a.id, genA2), (e: unknown) => e instanceof ApiError && e.status === 409 && e.extra.code === "open_session");
  assert.equal(await points(a.id), 7000, "the refused start charged nothing");

  const genB = await newWork(b.id);
  await assert.rejects(svc.startDefence(a.id, genB), (e: unknown) => e instanceof ApiError && e.status === 404 && e.extra.code === "not_found", "someone else's work");
  const running = await newWork(b.id, { status: "IN_PROGRESS" });
  const essay = await newWork(b.id, { tool: "essay" });
  const thin = await newWork(b.id, { slides: SLIDES.slice(0, 2) });
  for (const g of [running, essay, thin, randomUUID()]) {
    await assert.rejects(svc.startDefence(b.id, g), (e: unknown) => e instanceof ApiError && e.extra.code === "not_found", g);
  }
  assert.equal(await points(b.id), 10_000);
  assert.equal((await sessionRows(b.id)).length, 0);

  const poor = await newUser(1000);
  const genP = await newWork(poor.id);
  await assert.rejects(svc.startDefence(poor.id, genP), (e: unknown) => e instanceof ApiError && e.status === 402 && e.extra.code === "insufficient" && e.extra.required === 3000);
  assert.equal(await points(poor.id), 1000);
  assert.equal((await sessionRows(poor.id)).length, 0, "no half-created session");
  assert.equal((await queryOne<{ n: string }>("SELECT count(*)::text AS n FROM domla_jobs WHERE session_id IN (SELECT id FROM domla_sessions WHERE user_id = $1)", [poor.id]))!.n, "0");

  const web = await newUser(10_000);
  await query("UPDATE users SET telegram_id = NULL WHERE id = $1", [web.id]);
  const genW = await newWork(web.id);
  await assert.rejects(svc.startDefence(web.id, genW), (e: unknown) => e instanceof ApiError && e.extra.code === "no_telegram");
  assert.equal(await points(web.id), 10_000);
});

test("price is the admin setting (client sends none); 0 is free", { skip }, async () => {
  await setSetting("domla.price", 1500);
  const u = await newUser(10_000);
  const r = await svc.startDefence(u.id, await newWork(u.id));
  assert.equal(r.price, 1500);
  assert.equal(await points(u.id), 8500);
  await query("UPDATE domla_sessions SET status = 'expired' WHERE user_id = $1", [u.id]);
  await setSetting("domla.price", 0);
  const free = await svc.startDefence(u.id, await newWork(u.id));
  assert.equal(free.session.chargedPoints, 0);
  assert.equal(await points(u.id), 8500, "free = no charge row, no change");
});

test("kill switch: no new defence, the bot says so, nothing is charged", { skip }, async () => {
  await setSetting("domla.enabled", false);
  const u = await newUser(10_000);
  const gen = await newWork(u.id);
  await assert.rejects(svc.startDefence(u.id, gen), (e: unknown) => e instanceof ApiError && e.status === 503 && e.extra.code === "disabled");
  assert.equal(await points(u.id), 10_000);
  assert.equal((await sessionRows(u.id)).length, 0);

  await tg.handleUpdate(textUpdate(u.tg, "/domla"));
  assert.match(texts().at(-1)!, /dam olyapti/);
  await tg.handleUpdate(cbUpdate(u.tg, codes.cb.domlaStart(gen)));
  assert.match(String(sent("editMessageText").at(-1)!.body.text), /dam olyapti/);
  assert.equal(await points(u.id), 10_000);

  await setSetting("domla.enabled", true);
  assert.equal((await svc.startDefence(u.id, gen)).alreadyOpen, false, "switched back on");
});

/* ───────────────────────── questions ───────────────────────── */

test("question generation fails: retried, then the session fails and the WHOLE charge comes back once", { skip }, async () => {
  const u = await newUser(10_000);
  const st = makeStubs();
  st.failQuestions = true;
  const r = await svc.startDefence(u.id, await newWork(u.id));
  assert.equal(await points(u.id), 7000);
  await drain(st);
  assert.equal(st.questionCalls, 3, "three attempts");
  const s = await svc.getSession(u.id, r.session.id);
  assert.equal(s!.status, "failed");
  assert.equal(await points(u.id), 10_000, "full refund");
  assert.deepEqual((await ledger(u.id, "refund")).map((x) => [x.reference, x.points_delta]), [[`domla:${r.session.id}`, "3000"]]);
  assert.match(texts().at(-1)!, /To'lov to'liq qaytarildi/);
  assert.deepEqual(await jobKinds(), []);

  assert.equal((await svc.failSession(r.session.id)).failed, false, "a second failure is a no-op");
  assert.equal(await points(u.id), 10_000);
  assert.equal((await ledger(u.id, "refund")).length, 1);
  assert.equal(await svc.openSession(u.id), null, "the failed session no longer blocks a new start");
  assert.equal((await svc.startDefence(u.id, await newWork(u.id))).alreadyOpen, false);
});

test("a failed answer scoring is NOT a refund case (only question generation is)", { skip }, async () => {
  const { u, st } = await started();
  st.deps = { ...st.deps, score: async () => { throw new Error("gemini down"); } };
  await tg.handleUpdate(textUpdate(u.tg, "javobim"));
  await drain(st);
  assert.match(texts().at(-1)!, /eshita olmadi/);
  assert.equal(await points(u.id), 7000, "no refund");
  assert.equal((await svc.openSession(u.id))!.answers.length, 0, "the question still waits for an answer");
  assert.deepEqual(await jobKinds(), [], "the failed job is gone, so the student can answer again");
});

test("questions: the opening is spoken (greeting + Q1, voice Charon path), captioned, and the session is active", { skip }, async () => {
  const { u, sessionId, st } = await started();
  const s = (await svc.getSession(u.id, sessionId))!;
  assert.equal(s.status, "active");
  assert.equal(s.questions.length, 5);
  assert.equal(s.asked, 1);
  assert.match(st.spoken[0]!, /^Assalomu alaykum\./);
  assert.match(st.spoken[0]!, /Birinchi savol\. Nega fotosintez/);
  const audio = sent("sendAudio");
  assert.equal(audio.length, 1);
  assert.equal(audio[0]!.body.chat_id, String(u.tg));
  assert.equal(audio[0]!.audioBytes, 5, "the MP3 bytes were uploaded");
  assert.equal(audio[0]!.body.parse_mode, "HTML");
  assert.match(String(audio[0]!.body.caption), /Savol 1\/5/);
  assert.match(String(audio[0]!.body.caption), /Nega fotosintez/);
  assert.match(String(audio[0]!.body.caption), /Assalomu alaykum/, "the greeting is in the text too");
  assert.ok(!JSON.stringify(sent("sendMessage")).includes("Nega fotosintez"), "voice sent: the question is not also sent as plain text");
});

test("no voice available: the question goes out as text only", { skip }, async () => {
  const u = await newUser();
  const st = makeStubs();
  st.failTts = true;
  await svc.startDefence(u.id, await newWork(u.id));
  await drain(st);
  assert.equal(sent("sendAudio").length, 0);
  assert.match(texts().at(-1)!, /Savol 1\/5[\s\S]*Nega fotosintez/);
  assert.equal((await svc.openSession(u.id))!.asked, 1);
});

/* ───────────────────────── answers ───────────────────────── */

test("voice answer: the webhook is fast (a row is enqueued, nothing heavy runs), the worker downloads, scores and asks the next", { skip }, async () => {
  const { u, sessionId, st } = await started();
  calls = [];
  outbound = [];
  await tg.handleUpdate(voiceUpdate(u.tg));
  // The webhook only wrote a job: no Telegram download, no scoring, no Gemini, no TTS.
  assert.deepEqual(await jobKinds(), ["score:0"]);
  assert.equal(st.scored.length, 0, "not scored inline");
  assert.ok(!outbound.some((url) => /getFile|\/file\/bot|generativelanguage/.test(url)), `no heavy network inline: ${outbound.join(",")}`);
  assert.equal(calls.length, 0, "the webhook did not even send a message");
  assert.deepEqual((await queryOne<{ payload: Record<string, unknown> }>("SELECT payload FROM domla_jobs"))!.payload, { via: "voice", fileId: "VOICE-1", mime: "audio/ogg", seconds: 6 }, "only the file id is stored");

  st.scoreQueue.push(3);
  await drain(st);
  assert.equal(st.scored.length, 1);
  assert.equal(st.scored[0]!.audio!.mime, "audio/ogg");
  assert.deepEqual([...st.scored[0]!.audio!.bytes], [79, 103, 103, 83, 1, 2, 3, 4], "the downloaded bytes reached the scorer");
  assert.equal(st.scored[0]!.question.kind, "why");
  assert.equal(sent("getFile").length, 1);
  const reaction = texts().find((x) => x.includes("ovozli javob 1"))!;
  assert.match(reaction, /<b>3\/5<\/b> — Hm… qisman to'g'ri\./);
  const s = (await svc.getSession(u.id, sessionId))!;
  assert.deepEqual(s.answers.map((a) => [a.idx, a.via, a.transcript, a.score]), [[0, "voice", "ovozli javob 1", 3]]);
  assert.equal(s.asked, 2, "question 2 was spoken after the reaction");
  assert.match(String(sent("sendAudio").at(-1)!.body.caption), /Savol 2\/5/);
  assert.match(st.spoken.at(-1)!, /^Ikkinchi savol\./);

  // Never keep raw audio: neither rows nor jobs hold the bytes.
  const dump = JSON.stringify(await query("SELECT * FROM domla_sessions")) + JSON.stringify(await query("SELECT * FROM domla_jobs"));
  assert.ok(!dump.includes("OggS") && !dump.includes("T2dnUw"), "no audio in the database");
  assert.deepEqual(await jobKinds(), []);
});

test("text fallback: a typed answer is scored like a voice one; text with no question waiting is not ours", { skip }, async () => {
  const stranger = await newUser();
  await tg.handleUpdate(textUpdate(stranger.tg, "salom"));
  assert.deepEqual(await jobKinds(), [], "no defence: plain text is not an answer");
  assert.equal(texts().length, 1, "the usual fallback reply");

  const { u, sessionId, st } = await started();
  st.scoreQueue.push(5);
  await tg.handleUpdate(textUpdate(u.tg, "  Chunki xlorofill yorug'likni yutadi.  "));
  assert.deepEqual(await jobKinds(), ["score:0"]);
  await drain(st);
  assert.equal(st.scored[0]!.audio, undefined, "no audio, text only");
  assert.equal(st.scored[0]!.text, "Chunki xlorofill yorug'likni yutadi.");
  const s = (await svc.getSession(u.id, sessionId))!;
  assert.deepEqual(s.answers.map((a) => [a.via, a.transcript, a.score]), [["text", "Chunki xlorofill yorug'likni yutadi.", 5]]);
  assert.equal(s.asked, 2);

  // A second answer while one is being processed, and one that arrives before the next question is spoken.
  await tg.handleUpdate(textUpdate(u.tg, "ikkinchi"));
  await tg.handleUpdate(textUpdate(u.tg, "uchinchi"));
  assert.deepEqual(await jobKinds(), ["score:1"], "the duplicate is refused while the first is queued");
  assert.match(texts().at(-1)!, /hali tinglayapti/);
});

test("an answer sent before the question was spoken is not accepted", { skip }, async () => {
  const u = await newUser();
  await svc.startDefence(u.id, await newWork(u.id));
  await tg.handleUpdate(voiceUpdate(u.tg));
  assert.deepEqual(await jobKinds(), ["questions:0"]);
  assert.match(texts().at(-1)!, /tayyorlanmoqda/);
});

test("voice limits: more than 2 MB or 120 s is rejected in the webhook; the download is capped too", { skip }, async () => {
  const { u, st } = await started();
  calls = [];
  await tg.handleUpdate(voiceUpdate(u.tg, { file_size: rules.DOMLA_VOICE_MAX_BYTES + 1 }));
  assert.match(texts().at(-1)!, /juda katta/);
  await tg.handleUpdate(voiceUpdate(u.tg, { duration: rules.DOMLA_VOICE_MAX_SECONDS + 1 }));
  assert.match(texts().at(-1)!, /juda uzun/);
  await tg.handleUpdate(voiceUpdate(u.tg, { file_size: rules.DOMLA_VOICE_MAX_BYTES, duration: rules.DOMLA_VOICE_MAX_SECONDS }));
  assert.deepEqual(await jobKinds(), ["score:0"], "exactly the limits are accepted");
  await query("DELETE FROM domla_jobs");
  await tg.handleUpdate(voiceUpdate(u.tg, { mime_type: "video/mp4" }));
  assert.deepEqual(await jobKinds(), [], "an unsupported audio type never reaches the queue");
  assert.match(texts().at(-1)!, /Oddiy ovozli xabar/);

  // Telegram reported nothing wrong, the real file is too big (getFile says so / the stream is longer than declared).
  for (const mode of ["getFile", "stream"] as const) {
    await query("DELETE FROM domla_jobs");
    installFetch();
    if (mode === "getFile") fileInfo = { size: rules.DOMLA_VOICE_MAX_BYTES + 5 };
    else fileBody = new Uint8Array(rules.DOMLA_VOICE_MAX_BYTES + 5);
    await tg.handleUpdate(voiceUpdate(u.tg, { file_size: undefined }));
    await drain(st);
    assert.equal(st.scored.length, 0, `${mode}: never scored`);
    assert.match(texts().at(-1)!, /juda katta/, mode);
    assert.equal((await svc.openSession(u.id))!.answers.length, 0);
  }
  await assert.rejects(edges.readCapped(new Response(new Uint8Array(10), { headers: { "content-length": String(rules.DOMLA_VOICE_MAX_BYTES + 1) } }), rules.DOMLA_VOICE_MAX_BYTES), edges.DomlaFileError);
});

test("an empty transcript (no speech) asks to resend and keeps the question open", { skip }, async () => {
  const { u, st } = await started();
  st.deps = { ...st.deps, score: async () => ({ transcript: "", score: 0, verdict: "", mistake: "" }) };
  await tg.handleUpdate(voiceUpdate(u.tg));
  await drain(st);
  assert.match(texts().at(-1)!, /eshita olmadi/);
  assert.equal((await svc.openSession(u.id))!.answers.length, 0);
  await tg.handleUpdate(voiceUpdate(u.tg));
  assert.deepEqual(await jobKinds(), ["score:0"], "can answer again");
});

test("a whole defence: five answers -> the grade, the final message, the history", { skip }, async () => {
  const { u, sessionId, st } = await started();
  st.scoreQueue.push(5, 4, 3, 2, 1);
  for (let i = 0; i < 5; i++) {
    await tg.handleUpdate(i % 2 ? textUpdate(u.tg, `javob ${i}`) : voiceUpdate(u.tg));
    await drain(st);
  }
  const s = (await svc.getSession(u.id, sessionId))!;
  assert.equal(s.status, "finished");
  assert.equal(s.grade, 3, "15/25 = 60 %");
  assert.ok(s.finishedAt);
  assert.equal(s.answers.length, 5);
  assert.equal(sent("sendAudio").length, 5, "five questions spoken");
  const final = sent().at(-1)!;
  const text = String(final.body.text);
  assert.match(text, /Domla senga 3 qo'ydi\./);
  assert.match(text, /Mana bu savolda adashding/);
  assert.ok(text.includes(QUESTIONS[4]!.ideal), "the weakest question's ideal answer");
  assert.ok(text.includes("Asosiy faktni aytmadingiz"));
  assert.deepEqual(buttons(final).map((b) => b.callback_data), [codes.cb.domlaList()]);
  assert.equal(await svc.openSession(u.id), null, "finished: a new defence may start");

  const pub = svc.publicSession(s);
  assert.equal(pub.grade, 3);
  assert.deepEqual(pub.results.map((r) => r.score), [5, 4, 3, 2, 1]);
  assert.equal(pub.weakest!.ideal, QUESTIONS[4]!.ideal);
  assert.equal((await svc.listHistory(u.id))[0]!.id, sessionId);
  // A replayed final job must not send the verdict twice.
  const before = sent().length;
  await engine.runJob({ id: "0", sessionId, kind: "score", idx: 4, payload: { via: "text", text: "x" }, attempts: 1 }, st.deps);
  assert.equal(sent().length, before);
});

test("grade 5 from 22/25 on a real run", { skip }, async () => {
  const { u, sessionId, st } = await started();
  st.scoreQueue.push(5, 5, 4, 4, 4);
  for (let i = 0; i < 5; i++) {
    await tg.handleUpdate(textUpdate(u.tg, `javob ${i}`));
    await drain(st);
  }
  assert.equal((await svc.getSession(u.id, sessionId))!.grade, 5);
  assert.match(texts().at(-1)!, /Domla senga 5 qo'ydi\./);
});

/* ───────────────────────── timeout / resume ───────────────────────── */

test("timeout: 30 minutes idle expires the defence (told once), no refund, answers are refused", { skip }, async () => {
  const { u, sessionId, st } = await started();
  await query("UPDATE domla_sessions SET last_activity_at = now() - interval '31 minutes' WHERE id = $1", [sessionId]);
  assert.equal(await svc.awaitingAnswer(u.id), false);
  await tg.handleUpdate(textUpdate(u.tg, "kech qoldim"));
  assert.deepEqual(await jobKinds(), [], "text after the window is not an answer");
  await tg.handleUpdate(voiceUpdate(u.tg));
  assert.deepEqual(await jobKinds(), []);
  assert.match(texts().at(-1)!, /muddati tugagan/);
  assert.equal((await svc.getSession(u.id, sessionId))!.status, "expired");
  assert.equal(await points(u.id), 7000, "no refund for an abandoned defence");

  // The housekeeping path (the student never wrote again).
  const b = await started();
  await query("UPDATE domla_sessions SET last_activity_at = now() - interval '45 minutes' WHERE id = $1", [b.sessionId]);
  installFetch();
  assert.equal(await engine.domlaHousekeeping(st.deps), 1);
  assert.equal(await engine.domlaHousekeeping(st.deps), 0, "told once");
  assert.equal((await svc.getSession(b.u.id, b.sessionId))!.status, "expired");
  assert.match(texts().at(-1)!, /30 daqiqa kutdi/);
  assert.equal(sent().filter((c) => c.body.chat_id === String(b.u.tg)).length, 1);
  assert.equal(await svc.openSession(b.u.id), null);
});

test("timeout boundary: 29 minutes is still alive", { skip }, async () => {
  const { u, sessionId } = await started();
  await query("UPDATE domla_sessions SET last_activity_at = now() - interval '29 minutes' WHERE id = $1", [sessionId]);
  await tg.handleUpdate(textUpdate(u.tg, "hali shu yerdaman"));
  assert.deepEqual(await jobKinds(), ["score:0"]);
});

test("resume inside the window re-asks the current question; after it, no", { skip }, async () => {
  const { u, sessionId, st } = await started();
  await tg.handleUpdate(textUpdate(u.tg, "birinchi javob"));
  await drain(st);
  const before = sent("sendAudio").length;
  await query("UPDATE domla_sessions SET last_activity_at = now() - interval '20 minutes' WHERE id = $1", [sessionId]);
  await tg.handleUpdate(textUpdate(u.tg, "/domla"));
  const list = sent().at(-1)!;
  assert.deepEqual(buttons(list).map((b) => b.callback_data).filter(Boolean), [codes.cb.domlaResume(sessionId)], "the open defence is offered, not the list");
  await tg.handleUpdate(cbUpdate(u.tg, codes.cb.domlaResume(sessionId)));
  await drain(st);
  assert.equal(sent("sendAudio").length, before + 1);
  assert.match(st.spoken.at(-1)!, /^Davom etamiz\. Ikkinchi savol\./);
  assert.equal((await svc.getSession(u.id, sessionId))!.asked, 2, "asked does not grow");
  assert.ok(Date.now() - new Date((await svc.getSession(u.id, sessionId))!.lastActivityAt).getTime() < 60_000, "resume refreshes the window");

  await query("UPDATE domla_sessions SET last_activity_at = now() - interval '40 minutes' WHERE id = $1", [sessionId]);
  await tg.handleUpdate(cbUpdate(u.tg, codes.cb.domlaResume(sessionId)));
  assert.equal(toasts().at(-1), "Himoya muddati tugagan");
  assert.deepEqual(await jobKinds(), []);
});

test("stuck preparing (the worker lost the job) is failed and refunded by housekeeping", { skip }, async () => {
  const u = await newUser(10_000);
  const r = await svc.startDefence(u.id, await newWork(u.id));
  await query("UPDATE domla_sessions SET last_activity_at = now() - interval '40 minutes' WHERE id = $1", [r.session.id]);
  await engine.domlaHousekeeping(makeStubs().deps);
  assert.equal((await svc.getSession(u.id, r.session.id))!.status, "failed");
  assert.equal(await points(u.id), 10_000);
  assert.deepEqual(await jobKinds(), []);
});

/* ───────────────────────── ownership ───────────────────────── */

test("foreign session / forged callbacks are rejected", { skip }, async () => {
  const { u: a, sessionId, gen } = await started();
  const b = await newUser(10_000);
  const genB = await newWork(b.id);

  await tg.handleUpdate(cbUpdate(b.tg, codes.cb.domlaResume(sessionId)));
  assert.equal(toasts().at(-1), "Bu ish topilmadi.", "B cannot resume A's defence");
  await tg.handleUpdate(cbUpdate(b.tg, codes.cb.domlaResume(randomUUID())));
  assert.equal(toasts().at(-1), "Bu ish topilmadi.");
  await tg.handleUpdate(cbUpdate(b.tg, codes.cb.domlaStart(gen)));
  assert.match(String(sent("editMessageText").at(-1)!.body.text), /topilmadi/, "B cannot defend A's work");
  assert.equal(await points(b.id), 10_000);
  assert.equal((await sessionRows(b.id)).length, 0);
  assert.deepEqual(await jobKinds(), []);

  // A's button pressed from another chat / by someone else's id is the existing «notYours» guard.
  await tg.handleUpdate(cbUpdate(b.tg, codes.cb.domlaResume(sessionId), a.tg));
  assert.equal(toasts().at(-1), i18n.t("uz", "toast.notYours"));
  await tg.handleUpdate(cbUpdate(a.tg, codes.cb.domlaResume(sessionId), a.tg, "group"));
  assert.equal(toasts().at(-1), i18n.t("uz", "toast.notYours"));

  // B's voice / text lands in B's (nonexistent) defence, never in A's.
  await tg.handleUpdate(voiceUpdate(b.tg));
  await tg.handleUpdate(textUpdate(b.tg, "javob"));
  assert.deepEqual(await jobKinds(), []);
  assert.equal((await svc.getSession(b.id, sessionId)), null, "ownership in SQL");
  assert.equal((await svc.getSession(a.id, sessionId))!.answers.length, 0);
  assert.equal(await svc.getSession(b.id, "not-a-uuid"), null);
  void genB;
});

test("a blocked account gets nothing from the voice route", { skip }, async () => {
  const { u } = await started();
  await query("UPDATE users SET is_blocked = true WHERE id = $1", [u.id]);
  await tg.handleUpdate(voiceUpdate(u.tg));
  assert.deepEqual(await jobKinds(), []);
});

/* ───────────────────────── /domla list ───────────────────────── */

test("/domla lists the last 5 slide works as start buttons, newest first, with the price", { skip }, async () => {
  const u = await newUser();
  const ids: string[] = [];
  for (let i = 0; i < 7; i++) ids.push(await newWork(u.id, { topic: `Mavzu ${i}`, tool: i % 2 ? "pro-slide" : "slide", at: `2026-01-0${i + 1}T10:00:00Z` }));
  await newWork(u.id, { tool: "essay", topic: "Insho" });
  await tg.handleUpdate(textUpdate(u.tg, "/domla"));
  const msg = sent().at(-1)!;
  assert.match(String(msg.body.text), /3\s?000 so‘m/);
  const starts = buttons(msg).filter((b) => b.callback_data?.startsWith("dm:s:"));
  assert.deepEqual(starts.map((b) => b.callback_data), ids.slice(2).reverse().map((id) => codes.cb.domlaStart(id)));
  assert.deepEqual(starts.map((b) => b.text), ["Mavzu 6", "Mavzu 5", "Mavzu 4", "Mavzu 3", "Mavzu 2"]);
  assert.ok(buttons(msg).some((b) => b.web_app?.url === "https://slaydx.test/uz/domla"), "the app page button");

  const none = await newUser();
  await tg.handleUpdate(textUpdate(none.tg, "/domla"));
  assert.match(texts().at(-1)!, /tayyor slayd yo‘q/);
});

test("starting from the bot: charged once, a double tap does not charge again", { skip }, async () => {
  const u = await newUser(10_000);
  const gen = await newWork(u.id);
  await tg.handleUpdate(cbUpdate(u.tg, codes.cb.domlaStart(gen)));
  assert.match(String(sent("editMessageText").at(-1)!.body.text), /Domla savollarni tayyorlayapti/);
  await tg.handleUpdate(cbUpdate(u.tg, codes.cb.domlaStart(gen)));
  assert.match(String(sent("editMessageText").at(-1)!.body.text), /allaqachon boshlangan/);
  assert.equal(await points(u.id), 7000);
  assert.equal((await ledger(u.id, "charge")).length, 1);

  const poor = await newUser(500);
  await tg.handleUpdate(cbUpdate(poor.tg, codes.cb.domlaStart(await newWork(poor.id))));
  assert.match(String(sent("editMessageText").at(-1)!.body.text), /mablag‘ yetarli emas[\s\S]*3\s?000 so‘m/);
});

/* ───────────────────────── Gemini scoring request ───────────────────────── */

test("the scorer is ONE Gemini call: audio inline, JSON schema, key in the header; errors throw", async () => {
  let seen: { url: string; headers: Record<string, string>; body: Record<string, any> } | null = null;
  const ok = (async (url: string, init: { headers: Record<string, string>; body: string }) => {
    seen = { url, headers: init.headers, body: JSON.parse(init.body) };
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ transcript: "salom", score: 4, verdict: "Yaxshi", mistake: "Kam" }) }] } }], usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 30 } }));
  }) as unknown as typeof fetch;
  const r = await edges.scoreWithGemini({ question: QUESTIONS[0]!, topic: "Fotosintez", deck: "DECK", audio: { bytes: new Uint8Array([1, 2, 3]), mime: "audio/ogg" } }, ok);
  assert.deepEqual(r, { transcript: "salom", score: 4, verdict: "Yaxshi", mistake: "Kam" });
  assert.match(seen!.url, /generativelanguage\.googleapis\.com\/v1beta\/models\/[^/]+:generateContent$/);
  assert.equal(seen!.headers["x-goog-api-key"], "test-gemini-key");
  assert.ok(!seen!.url.includes("test-gemini-key"), "the key is never in the URL");
  const parts = seen!.body.contents[0].parts;
  assert.equal(parts[1].inlineData.mimeType, "audio/ogg");
  assert.equal(parts[1].inlineData.data, Buffer.from([1, 2, 3]).toString("base64"));
  assert.match(parts[0].text, /Ideal answer: Chunki xlorofill/);
  assert.equal(seen!.body.generationConfig.responseMimeType, "application/json");
  assert.deepEqual(seen!.body.generationConfig.responseSchema.required, ["transcript", "score", "verdict", "mistake"]);
  assert.match(seen!.body.system_instruction.parts[0].text, /NEVER rude/);

  await edges.scoreWithGemini({ question: QUESTIONS[0]!, topic: "T", deck: "D", text: "mening javobim" }, ok);
  assert.equal(seen!.body.contents[0].parts.length, 1, "text answer: no audio part");
  assert.match(seen!.body.contents[0].parts[0].text, /<answer>\nmening javobim\n<\/answer>/);

  const bad = (async () => new Response(JSON.stringify({ error: { message: "quota" } }), { status: 429 })) as unknown as typeof fetch;
  await assert.rejects(edges.scoreWithGemini({ question: QUESTIONS[0]!, topic: "T", deck: "D", text: "x" }, bad), /Gemini 429/);
  const junk = (async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "not json" }] } }] }))) as unknown as typeof fetch;
  await assert.rejects(edges.scoreWithGemini({ question: QUESTIONS[0]!, topic: "T", deck: "D", text: "x" }, junk), /o‘qilmadi/);
  assert.equal(edges.geminiAudioMime("audio/ogg; codecs=opus"), "audio/ogg");
  assert.equal(edges.geminiAudioMime("video/mp4"), null);
});

/* ───────────────────────── API ───────────────────────── */

async function asUser(userId: string, path: string, init: { method?: string; body?: unknown } = {}): Promise<Response> {
  const { token } = await createSession(userId);
  const req = new Request(`https://slaydx.test${path}`, {
    method: init.method ?? "GET",
    headers: { cookie: `${SESSION_COOKIE}=${token}`, "content-type": "application/json", origin: "https://slaydx.test" },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  return inRequest(req, () => (init.method === "POST" ? route.POST(req) : route.GET(req)));
}

test("API: GET lists works, price, history; never leaks ideal answers of an open defence; POST starts (client price ignored)", { skip }, async () => {
  const unauth = await inRequest(new Request("https://slaydx.test/api/domla"), () => route.GET(new Request("https://slaydx.test/api/domla")));
  assert.equal(unauth.status, 401);

  const u = await newUser(10_000);
  const gen = await newWork(u.id);
  let res = await asUser(u.id, "/api/domla");
  let body = await res.json();
  assert.equal(res.status, 200);
  assert.deepEqual([body.enabled, body.price, body.telegramLinked, body.botUrl], [true, 3000, true, "https://t.me/slaydx_test_bot"]);
  assert.deepEqual(body.works.map((w: { id: string }) => w.id), [gen]);
  assert.equal(body.open, null);

  res = await asUser(u.id, "/api/domla", { method: "POST", body: { generationId: gen, price: 1 } });
  body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.price, 3000, "the client price is ignored");
  assert.equal(await points(u.id), 7000);
  res = await asUser(u.id, "/api/domla", { method: "POST", body: { generationId: gen } });
  assert.equal((await res.json()).alreadyOpen, true);
  assert.equal(await points(u.id), 7000);
  assert.equal((await asUser(u.id, "/api/domla", { method: "POST", body: {} })).status, 400);
  const other = await newUser();
  assert.equal((await asUser(other.id, "/api/domla", { method: "POST", body: { generationId: gen } })).status, 404);

  const st = makeStubs();
  await drain(st);
  const open = (await (await asUser(u.id, "/api/domla")).json()).open;
  assert.equal(open.status, "active");
  assert.deepEqual(open.progress, { answered: 0, total: 5 });
  const raw = JSON.stringify(open);
  for (const q of QUESTIONS) assert.ok(!raw.includes(q.ideal) && !raw.includes(q.text), "nothing of the questions leaks before they are asked and answered");

  // finish it, then the history carries the grade and the weakest question's ideal answer.
  st.scoreQueue.push(5, 5, 5, 5, 2);
  for (let i = 0; i < 5; i++) {
    await tg.handleUpdate(textUpdate(u.tg, `javob ${i}`));
    await drain(st);
  }
  body = await (await asUser(u.id, "/api/domla")).json();
  assert.equal(body.open, null);
  assert.equal(body.history.length, 1);
  assert.equal(body.history[0].grade, 5, "5+5+5+5+2 = 22/25");
});

/* ───────────────────────── the worker loop ───────────────────────── */

test("claimJob: one worker gets a job once (SKIP LOCKED); a dead worker's job comes back after the lease", { skip }, async () => {
  const u = await newUser();
  await svc.startDefence(u.id, await newWork(u.id));
  const [a, b] = await Promise.all([svc.claimJob(), svc.claimJob()]);
  assert.equal([a, b].filter(Boolean).length, 1, "claimed once");
  assert.equal(await svc.claimJob(), null, "leased: not offered again");
  await query("UPDATE domla_jobs SET locked_until = now() - interval '1 second'");
  const again = await svc.claimJob();
  assert.equal(again!.attempts, 2, "re-claimed after the lease expired");
});
