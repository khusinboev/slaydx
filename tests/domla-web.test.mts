/**
 * «Qattiqqo'l domla» on the website (owner decision 2026-11-13, migration 079): one active channel per session
 * (`bot` | `web`), the web chat API (`/api/domla/sessions/[id]`, `/answer`, `/channel`, `/audio/[idx]`), web voice
 * answers (stored -> scored -> deleted; WebM remuxed to Ogg), the engine routing (a web ask sends NOTHING to Telegram,
 * a bot ask still does and carries «Saytda davom etish»), the move between bot and web continuing from the same
 * question with the voice made once, and the WebM -> Ogg remuxer. Real Postgres (own throwaway database), Telegram
 * stubbed at `fetch` (any other URL throws), the LLM / TTS / scorer injected as stubs.
 *
 * Mutation checks (each broken on purpose, the named test failed, then restored) -- listed in the commit message.
 */
process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters-long";
process.env.APP_URL = "https://slaydx.test";
process.env.TELEGRAM_BOT_TOKEN = "123456:FAKE-domla-web-token";
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
const iso = hasDb ? await createIsolatedDb("domlaweb") : { isolated: false, drop: async () => {} };
const skip = !hasDb ? "Postgres kerak (DATABASE_URL)" : iso.isolated ? false : "alohida Postgres baza yaratilmadi";
if (!hasDb) process.env.DATABASE_URL = "postgres://unused/unused";

const remux = await import("../lib/domla/webm-ogg.ts");
const { query, queryOne, pool, ensureMigrated } = await import("../lib/server/db.ts");
const svc = await import("../lib/server/domla.ts");
const engine = await import("../lib/server/domla-engine.ts");
const edges = await import("../lib/server/domla-deps.ts");
const tg = await import("../lib/server/telegram.ts");
const settings = await import("../lib/server/settings.ts");
const { topUp } = await import("../lib/server/credits.ts");
const { upsertTelegramUser } = await import("../lib/server/auth.ts");
const { createSession, SESSION_COOKIE } = await import("../lib/server/session.ts");
const startRoute = await import("../app/api/domla/route.ts");
const sessionRoute = await import("../app/api/domla/sessions/[id]/route.ts");
const answerRoute = await import("../app/api/domla/sessions/[id]/answer/route.ts");
const channelRoute = await import("../app/api/domla/sessions/[id]/channel/route.ts");
const audioRoute = await import("../app/api/domla/sessions/[id]/audio/[idx]/route.ts");
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
let nextMessageId = 9000;
function installFetch(): void {
  calls = [];
  globalThis.fetch = (async (url: string | URL, init?: { body?: unknown }) => {
    const u = String(url);
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
    return new Response(JSON.stringify({ ok: true, result: method === "sendMessage" || method === "sendAudio" ? { message_id: ++nextMessageId } : true }));
  }) as typeof fetch;
}
const sent = (method = "sendMessage") => calls.filter((c) => c.method === method);
const tgMessages = () => calls.filter((c) => c.method === "sendMessage" || c.method === "sendAudio");

/* ───────────────────────── fixtures ───────────────────────── */

const QUESTIONS: import("../lib/domla/rules.ts").DomlaQuestion[] = [
  { kind: "why", text: "Nega fotosintez faqat yorug'likda ketadi?", ideal: "IDEAL-0 xlorofill yorug'lik energiyasini yutadi." },
  { kind: "method", text: "Fotosintez qanday bosqichlarda o'tadi?", ideal: "IDEAL-1 yorug'lik va qorong'ilik bosqichlari." },
  { kind: "definition", text: "Xlorofill nima?", ideal: "IDEAL-2 o'simlikdagi yashil pigment." },
  { kind: "number", text: "Slaydda yoritilgan kunlik yorug'lik necha soat?", ideal: "IDEAL-3 to'rt soat." },
  { kind: "practice", text: "Bu bilimni issiqxonada qanday qo'llaysiz?", ideal: "IDEAL-4 lampalar bilan yorug'lik vaqtini oshirish." },
];
const SLIDES = [
  { id: "s1", layout: "title", title: "Fotosintez" },
  { id: "s2", layout: "bullets", title: "Yorug'lik", bullets: ["Xlorofill yorug'likni yutadi", "Kuniga 4 soat yorug'lik"] },
  { id: "s3", layout: "bullets", title: "Bosqichlar", bullets: ["Yorug'lik bosqichi", "Qorong'ilik bosqichi"] },
  { id: "s4", layout: "stats", title: "Raqamlar", stats: [{ value: "4", label: "soat yorug'lik" }] },
];
const VOICE = new Uint8Array([73, 68, 51, 4, 0, 9, 9]);

type TestUser = { id: string; tg: number | null };
async function newUser(opts: { points?: number; telegram?: boolean } = {}): Promise<TestUser> {
  const tgId = 7_800_000_000 + randomInt(0, 99_999_999);
  const u = await upsertTelegramUser({ telegramId: String(tgId), username: null, name: "Domla Web", photoUrl: null });
  await query("UPDATE users SET points = 0 WHERE id = $1", [u.id]);
  const pts = opts.points ?? 10_000;
  if (pts > 0) await topUp(u.id, { points: pts }, `test:domlaweb:${u.id}`, "bonus", "test");
  if (opts.telegram === false) {
    await query("UPDATE users SET telegram_id = NULL WHERE id = $1", [u.id]);
    return { id: u.id, tg: null };
  }
  return { id: u.id, tg: tgId };
}
async function newWork(userId: string): Promise<string> {
  const id = randomUUID();
  await query(`INSERT INTO generations (id, user_id, tool_id, topic, status, doc_json) VALUES ($1, $2, 'slide', 'Fotosintez', 'COMPLETED', $3::jsonb)`, [
    id,
    userId,
    JSON.stringify({ slides: SLIDES }),
  ]);
  return id;
}
const points = async (id: string) => Number((await queryOne<{ p: string }>("SELECT points::text AS p FROM users WHERE id = $1", [id]))!.p);
const jobKinds = async () => (await query<{ kind: string; idx: number }>("SELECT kind, idx FROM domla_jobs ORDER BY id")).map((j) => `${j.kind}:${j.idx}`);
const audioRows = async (sessionId: string) =>
  (await query<{ kind: string; idx: number; mime: string; n: number }>("SELECT kind, idx, mime, octet_length(bytes) AS n FROM domla_audio WHERE session_id = $1 ORDER BY kind, idx", [sessionId])).map(
    (r) => `${r.kind}:${r.idx}:${r.mime}:${r.n}`,
  );
const channelOf = async (sessionId: string) => (await queryOne<{ channel: string }>("SELECT channel FROM domla_sessions WHERE id = $1", [sessionId]))!.channel;

type Stubs = { deps: import("../lib/server/domla-deps.ts").DomlaDeps; scored: import("../lib/server/domla-deps.ts").ScoreInput[]; spoken: string[]; scoreQueue: number[]; emptyTranscript: boolean; failScore: boolean };
function makeStubs(): Stubs {
  const base = edges.defaultDeps();
  const st: Stubs = { deps: base, scored: [], spoken: [], scoreQueue: [], emptyTranscript: false, failScore: false };
  st.deps = {
    ...base,
    generateQuestions: async () => QUESTIONS,
    synthesize: async (text) => {
      st.spoken.push(text);
      return { bytes: VOICE, seconds: 4 };
    },
    score: async (input) => {
      st.scored.push(input);
      if (st.failScore) throw new Error("gemini down");
      const score = st.scoreQueue.shift() ?? 4;
      return {
        transcript: st.emptyTranscript ? "" : input.audio ? `eshitildi ${st.scored.length}` : (input.text ?? ""),
        score,
        verdict: `Izoh ${st.scored.length}`,
        mistake: "Asosiy faktni aytmadingiz",
      };
    },
  };
  return st;
}
async function drain(st: Stubs, max = 30): Promise<number> {
  let n = 0;
  for (;;) {
    await query("UPDATE domla_jobs SET run_after = now(), locked_until = NULL");
    if (!(await engine.domlaTick(st.deps)) || ++n >= max) return n;
  }
}

/* ───────────────────────── HTTP helpers ───────────────────────── */

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
async function call(
  fn: Handler | ((req: Request) => Promise<Response>),
  userId: string | null,
  path: string,
  init: { method?: string; json?: unknown; form?: FormData; params?: Record<string, string> } = {},
): Promise<Response> {
  const headers: Record<string, string> = { origin: "https://slaydx.test" };
  if (userId) headers.cookie = `${SESSION_COOKIE}=${(await createSession(userId)).token}`;
  if (init.json !== undefined) headers["content-type"] = "application/json";
  const req = new Request(`https://slaydx.test${path}`, {
    method: init.method ?? "GET",
    headers,
    ...(init.json !== undefined ? { body: JSON.stringify(init.json) } : init.form ? { body: init.form } : {}),
  });
  return inRequest(req, () => (fn as Handler)(req, { params: Promise.resolve(init.params ?? {}) }));
}
const getChat = (userId: string | null, id: string) => call(sessionRoute.GET as Handler, userId, `/api/domla/sessions/${id}`, { params: { id } });
const answerText = (userId: string, id: string, text: string) =>
  call(answerRoute.POST as Handler, userId, `/api/domla/sessions/${id}/answer`, { method: "POST", json: { text }, params: { id } });
const answerVoice = (userId: string, id: string, bytes: Uint8Array, seconds = 6, type = "audio/webm") => {
  const form = new FormData();
  form.set("audio", new Blob([new Uint8Array(bytes)], { type }), "javob");
  form.set("seconds", String(seconds));
  return call(answerRoute.POST as Handler, userId, `/api/domla/sessions/${id}/answer`, { method: "POST", form, params: { id } });
};
const move = (userId: string, id: string, channel: unknown) =>
  call(channelRoute.POST as Handler, userId, `/api/domla/sessions/${id}/channel`, { method: "POST", json: { channel }, params: { id } });
const getAudio = (userId: string | null, id: string, idx: string) => call(audioRoute.GET as Handler, userId, `/api/domla/sessions/${id}/audio/${idx}`, { params: { id, idx } });

/** A web defence (started from the page) with question 1 asked. */
async function webStarted(opts: { telegram?: boolean } = {}): Promise<{ u: TestUser; sessionId: string; st: Stubs }> {
  const u = await newUser(opts);
  const gen = await newWork(u.id);
  const res = await call(startRoute.POST, u.id, "/api/domla", { method: "POST", json: { generationId: gen } });
  assert.equal(res.status, 200, await res.clone().text());
  const body = await res.json();
  assert.equal(body.channel, "web");
  const st = makeStubs();
  await drain(st);
  return { u, sessionId: body.sessionId, st };
}

/* ───────────────────────── WebM fixtures ───────────────────────── */

const UNKNOWN = [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];
function size8(n: number): number[] {
  const out = [0x01, 0, 0, 0, 0, 0, 0, 0];
  for (let i = 7; i >= 1; i--) {
    out[i] = n & 0xff;
    n = Math.floor(n / 256);
  }
  return out;
}
const el = (id: number[], payload: number[] | Uint8Array, unknown = false): number[] => [...id, ...(unknown ? UNKNOWN : size8(payload.length)), ...payload];
const text = (s: string) => [...new TextEncoder().encode(s)];
const OPUS_HEAD = [...text("OpusHead"), 1, 1, 0x38, 0x01, 0x80, 0xbb, 0, 0, 0, 0, 0];
/** A Chrome-style live recording: Segment and Cluster of UNKNOWN size, `count` Opus packets of 20 ms (TOC 0xF8). */
function webm(count: number, opts: { laced?: boolean; codec?: string } = {}): Uint8Array {
  const header = el([0x1a, 0x45, 0xdf, 0xa3], el([0x42, 0x82], text("webm")));
  const track = el([0xae], [...el([0xd7], [1]), ...el([0x86], text(opts.codec ?? "A_OPUS")), ...el([0x63, 0xa2], OPUS_HEAD), ...el([0xe1], el([0x9f], [1]))]);
  const tracks = el([0x16, 0x54, 0xae, 0x6b], track);
  const blocks: number[] = [];
  for (let i = 0; i < count; i++) blocks.push(...el([0xa3], [0x81, 0, 0, opts.laced ? 0x82 : 0x80, 0xf8, i & 0xff, 0x55]));
  const cluster = [0x1f, 0x43, 0xb6, 0x75, ...UNKNOWN, ...el([0xe7], [0]), ...blocks];
  const segment = [0x18, 0x53, 0x80, 0x67, ...UNKNOWN, ...el([0x15, 0x49, 0xa9, 0x66], el([0x2a, 0xd7, 0xb1], [0x0f, 0x42, 0x40])), ...tracks, ...cluster];
  return new Uint8Array([...header, ...segment]);
}

/** Independent bitwise Ogg CRC (not the module's table), to check every page. */
function crcBitwise(d: Uint8Array): number {
  let crc = 0;
  for (const x of d) {
    crc ^= x << 24;
    for (let j = 0; j < 8; j++) crc = crc & 0x80000000 ? ((crc << 1) ^ 0x04c11db7) >>> 0 : (crc << 1) >>> 0;
  }
  return crc >>> 0;
}
function oggPages(b: Uint8Array): { type: number; granule: bigint; seq: number; packets: Uint8Array[] }[] {
  const out = [];
  let p = 0;
  while (p < b.length) {
    assert.equal(String.fromCharCode(...b.subarray(p, p + 4)), "OggS", `page at ${p}`);
    const v = new DataView(b.buffer, b.byteOffset + p);
    const n = b[p + 26]!;
    const lace = [...b.subarray(p + 27, p + 27 + n)];
    const len = 27 + n + lace.reduce((a, x) => a + x, 0);
    const pg = new Uint8Array(b.subarray(p, p + len));
    const crc = v.getUint32(22, true);
    new DataView(pg.buffer).setUint32(22, 0, true);
    assert.equal(crcBitwise(pg), crc, `page CRC at ${p}`);
    const packets: Uint8Array[] = [];
    let o = p + 27 + n;
    let cur: number[] = [];
    for (const l of lace) {
      cur.push(...b.subarray(o, o + l));
      o += l;
      if (l < 255) {
        packets.push(new Uint8Array(cur));
        cur = [];
      }
    }
    out.push({ type: b[p + 5]!, granule: v.getBigUint64(6, true), seq: v.getUint32(18, true), packets });
    p += len;
  }
  return out;
}

beforeEach(async () => {
  if (skip) return;
  await query("DELETE FROM app_settings WHERE key LIKE 'domla.%'");
  settings.invalidateSettingsCache();
  await query("DELETE FROM domla_sessions");
  installFetch();
});

/* ───────────────────────── the remuxer (pure) ───────────────────────── */

test("webm -> ogg: Chrome's unknown-size live recording becomes valid Ogg/Opus pages (CRC, OpusHead, granule, EOS)", () => {
  const out = remux.webmToOgg(webm(120));
  assert.equal(out.seconds, 2.4, "120 packets x 20 ms, measured from the packets");
  const pages = oggPages(out.bytes);
  assert.equal(pages[0]!.type, 0x02, "first page is BOS");
  assert.equal(String.fromCharCode(...pages[0]!.packets[0]!.subarray(0, 8)), "OpusHead");
  assert.deepEqual([...pages[0]!.packets[0]!], OPUS_HEAD, "the CodecPrivate OpusHead is copied as is");
  assert.equal(String.fromCharCode(...pages[1]!.packets[0]!.subarray(0, 8)), "OpusTags");
  assert.equal(pages.at(-1)!.type & 0x04, 0x04, "last page is EOS");
  assert.equal(pages.at(-1)!.granule, BigInt(120 * 960), "granule = total samples at 48 kHz");
  assert.deepEqual(pages.map((p) => p.seq), pages.map((_, i) => i), "page sequence numbers");
  const audio = pages.slice(2).flatMap((p) => p.packets);
  assert.equal(audio.length, 120);
  assert.deepEqual([...audio[7]!], [0xf8, 7, 0x55], "Opus packets are copied byte for byte");
  assert.equal(remux.sniffAnswerAudio(out.bytes), "ogg");
});

test("webm -> ogg refuses what it cannot copy; the sniffer reads the container from the bytes", () => {
  assert.throws(() => remux.webmToOgg(webm(5, { laced: true })), remux.RemuxError);
  assert.throws(() => remux.webmToOgg(webm(5, { codec: "A_VORBIS" })), remux.RemuxError);
  assert.throws(() => remux.webmToOgg(webm(0)), remux.RemuxError);
  assert.throws(() => remux.webmToOgg(new TextEncoder().encode("OggS not webm")), remux.RemuxError);
  assert.equal(remux.sniffAnswerAudio(webm(1)), "webm");
  assert.equal(remux.sniffAnswerAudio(new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70])), "mp4");
  assert.equal(remux.sniffAnswerAudio(new TextEncoder().encode("hello world")), null);
  assert.equal(remux.opusPacketSamples(new Uint8Array([0xf8])), 960, "CELT 20 ms, one frame");
  assert.equal(remux.opusPacketSamples(new Uint8Array([0xf9])), 2 * 960, "CELT 20 ms, code 1 = two frames");
  assert.equal(remux.opusPacketSamples(new Uint8Array([0x1b, 2])), 2 * 2880, "SILK 60 ms, code 3 with a frame count of 2");
});

/* ───────────────────────── start / channel ───────────────────────── */

test("migration 079: channel defaults to bot, the CHECK refuses junk, audio goes with its session", { skip }, async () => {
  const u = await newUser();
  const r = await svc.startDefence(u.id, await newWork(u.id));
  assert.equal(r.session.channel, "bot", "a bot start (the default) is a bot defence");
  await assert.rejects(query("UPDATE domla_sessions SET channel = 'sms' WHERE id = $1", [r.session.id]), /domla_sessions_channel_check/);
  await query("INSERT INTO domla_audio (session_id, kind, idx, mime, bytes) VALUES ($1, 'answer', 0, 'audio/ogg', '\\x00')", [r.session.id]);
  await assert.rejects(query("INSERT INTO domla_audio (session_id, kind, idx, mime, bytes) VALUES ($1, 'note', 1, 'x', '\\x00')", [r.session.id]), /check/i);
  await query("DELETE FROM domla_sessions WHERE id = $1", [r.session.id]);
  assert.deepEqual(await audioRows(r.session.id), [], "ON DELETE CASCADE");
});

test("a web start needs no Telegram (same price, one charge); a bot start still does", { skip }, async () => {
  const web = await newUser({ telegram: false });
  const gen = await newWork(web.id);
  await assert.rejects(svc.startDefence(web.id, gen), (e: unknown) => (e as { extra?: { code?: string } }).extra?.code === "no_telegram", "bot channel: no_telegram");
  assert.equal(await points(web.id), 10_000);
  const res = await call(startRoute.POST, web.id, "/api/domla", { method: "POST", json: { generationId: gen, channel: "bot", price: 1 } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.channel, "web", "the page always starts a web defence (a client channel is ignored)");
  assert.equal(body.price, 3000);
  assert.equal(await points(web.id), 7000, "the same domla.price, charged once");
  const again = await (await call(startRoute.POST, web.id, "/api/domla", { method: "POST", json: { generationId: gen } })).json();
  assert.equal(again.alreadyOpen, true);
  assert.equal(await points(web.id), 7000);
  const page = await (await call(startRoute.GET, web.id, "/api/domla")).json();
  assert.equal(page.open.channel, "web");
  assert.equal(page.telegramLinked, false);
});

/* ───────────────────────── the engine by channel ───────────────────────── */

test("web ask: the voice is made once and stored, NOTHING goes to Telegram; the chat shows the question, never an ideal", { skip }, async () => {
  const { u, sessionId, st } = await webStarted();
  assert.equal(tgMessages().length, 0, "no Telegram message for a web defence");
  assert.equal(sent("sendChatAction").length, 0);
  assert.equal(st.spoken.length, 1);
  assert.match(st.spoken[0]!, /^Assalomu alaykum\..*Birinchi savol\./);
  assert.deepEqual(await audioRows(sessionId), [`question:0:audio/mpeg:${VOICE.length}`]);
  const res = await getChat(u.id, sessionId);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "private, no-store");
  const chat = await res.json();
  assert.equal(chat.status, "active");
  assert.equal(chat.channel, "web");
  assert.deepEqual(chat.asked, [{ idx: 0, text: QUESTIONS[0]!.text, audio: true }], "only the asked question");
  assert.equal(chat.waiting, 0);
  assert.equal(chat.scoring, false);
  const raw = JSON.stringify(chat);
  for (const q of QUESTIONS) assert.ok(!raw.includes(q.ideal.slice(0, 7)), "no ideal answer leaks");
  assert.ok(!raw.includes(QUESTIONS[1]!.text), "a question not asked yet is not shown");
});

test("a bot ask still goes to Telegram, with the «Saytda davom etish» WebApp button, and keeps the voice for the web", { skip }, async () => {
  const u = await newUser();
  const r = await svc.startDefence(u.id, await newWork(u.id));
  const st = makeStubs();
  await drain(st);
  const audio = sent("sendAudio");
  assert.equal(audio.length, 1);
  assert.equal(audio[0]!.body.chat_id, String(u.tg));
  const markup = JSON.parse(String(audio[0]!.body.reply_markup)) as { inline_keyboard: { text: string; web_app?: { url: string } }[][] };
  const btn = markup.inline_keyboard.flat().find((b) => b.web_app);
  assert.ok(btn, "a WebApp button under the question");
  assert.match(btn!.text, /Saytda davom etish/);
  assert.equal(btn!.web_app!.url, "https://slaydx.test/uz/domla?davom=web");
  assert.deepEqual(await audioRows(r.session.id), [`question:0:audio/mpeg:${VOICE.length}`], "stored for a move to the web");
});

test("web text answer: queued (fast), scored by the worker, reaction in the state, next question on the web only", { skip }, async () => {
  const { u, sessionId, st } = await webStarted();
  st.scoreQueue.push(3);
  const res = await answerText(u.id, sessionId, "  Chunki xlorofill yorug'likni yutadi.  ");
  assert.equal(res.status, 200, await res.clone().text());
  assert.deepEqual(await res.json(), { ok: true, idx: 0 });
  assert.deepEqual(await jobKinds(), ["score:0"]);
  assert.equal(st.scored.length, 0, "not scored inline");
  let chat = await (await getChat(u.id, sessionId)).json();
  assert.equal(chat.scoring, true, "«Domla tinglayapti…» while the score job waits");
  assert.equal(chat.waiting, null);
  await drain(st);
  assert.equal(st.scored[0]!.text, "Chunki xlorofill yorug'likni yutadi.");
  chat = await (await getChat(u.id, sessionId)).json();
  assert.deepEqual(chat.answers, [{ idx: 0, via: "text", transcript: "Chunki xlorofill yorug'likni yutadi.", score: 3, verdict: "Izoh 1" }]);
  assert.equal(chat.asked.length, 2);
  assert.equal(chat.waiting, 1);
  assert.equal(tgMessages().length, 0, "neither the reaction nor question 2 went to Telegram");
  // A second answer while nothing waits (question 2 is waiting: OK) and a duplicate while scoring: busy.
  assert.equal((await answerText(u.id, sessionId, "ikkinchi")).status, 200);
  const dup = await answerText(u.id, sessionId, "yana");
  assert.equal(dup.status, 409);
  assert.equal((await dup.json()).code, "busy");
  assert.equal((await answerText(u.id, sessionId, "x".repeat(2001))).status, 413);
  assert.equal((await answerText(u.id, sessionId, "   ")).status, 400);
});

test("web voice answer: WebM remuxed to Ogg, stored until scored, then DELETED; nothing audio is left", { skip }, async () => {
  const { u, sessionId, st } = await webStarted();
  const res = await answerVoice(u.id, sessionId, webm(150), 3);
  assert.equal(res.status, 200, await res.clone().text());
  const rows = await audioRows(sessionId);
  assert.equal(rows.length, 2);
  assert.match(rows[0]!, /^answer:0:audio\/ogg:\d+$/, "the answer waits as Ogg/Opus");
  const job = (await queryOne<{ payload: Record<string, unknown> }>("SELECT payload FROM domla_jobs WHERE kind = 'score'"))!.payload;
  assert.deepEqual(job, { via: "voice", stored: true, mime: "audio/ogg", seconds: 3 }, "the job holds no bytes");
  await drain(st);
  assert.equal(st.scored.length, 1);
  assert.equal(st.scored[0]!.audio!.mime, "audio/ogg");
  assert.equal(String.fromCharCode(...st.scored[0]!.audio!.bytes.subarray(0, 4)), "OggS", "the scorer got the remuxed bytes");
  assert.deepEqual(await audioRows(sessionId), [`question:0:audio/mpeg:${VOICE.length}`, `question:1:audio/mpeg:${VOICE.length}`], "the answer audio is gone once scored");
  const chat = await (await getChat(u.id, sessionId)).json();
  assert.deepEqual(chat.answers.map((a: { via: string; transcript: string }) => [a.via, a.transcript]), [["voice", "eshitildi 1"]]);
  assert.equal(tgMessages().length, 0);
  assert.equal(sent("getFile").length, 0, "a web voice is never downloaded from Telegram");

  // Ogg (Firefox) passes as is; junk and an over-long recording are refused before anything is queued.
  assert.equal((await answerVoice(u.id, sessionId, new TextEncoder().encode("hello, not audio"))).status, 400);
  const long = await answerVoice(u.id, sessionId, webm(6100), 5);
  assert.equal(long.status, 413, "122 s measured from the packets, whatever the client says");
  assert.equal((await long.json()).code, "too_long");
  assert.deepEqual(await jobKinds(), []);
  const big = await answerVoice(u.id, sessionId, new Uint8Array(2 * 1024 * 1024 + 10).fill(0x4f), 5, "audio/ogg");
  assert.equal(big.status, 413);
});

test("voice that could not be heard / a scorer that gives up: the web notice is shown, the audio is deleted, the question stays open", { skip }, async () => {
  const { u, sessionId, st } = await webStarted();
  st.emptyTranscript = true;
  await answerVoice(u.id, sessionId, webm(50));
  await drain(st);
  let chat = await (await getChat(u.id, sessionId)).json();
  assert.match(chat.notice, /eshita olmadi/);
  assert.equal(chat.waiting, 0, "the same question waits again");
  assert.equal((await audioRows(sessionId)).filter((r) => r.startsWith("answer")).length, 0);
  assert.equal(tgMessages().length, 0, "the notice is not a Telegram message on the web channel");

  st.emptyTranscript = false;
  st.failScore = true;
  await answerVoice(u.id, sessionId, webm(50));
  chat = await (await getChat(u.id, sessionId)).json();
  assert.equal(chat.notice, null, "an accepted answer clears the notice");
  await drain(st);
  assert.equal(st.scored.length, 4, "1 + 3 attempts");
  chat = await (await getChat(u.id, sessionId)).json();
  assert.match(chat.notice, /eshita olmadi/);
  assert.equal((await audioRows(sessionId)).filter((r) => r.startsWith("answer")).length, 0, "given up: the stored answer is deleted too");
  assert.deepEqual(await jobKinds(), []);
});

/* ───────────────────────── moving between bot and web ───────────────────────── */

test("«Botda davom etish»: the waiting question is re-sent to the bot with the SAME voice (no second synthesis)", { skip }, async () => {
  const { u, sessionId, st } = await webStarted();
  const res = await move(u.id, sessionId, "bot");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, channel: "bot", resent: true });
  assert.equal(await channelOf(sessionId), "bot");
  await drain(st);
  assert.equal(st.spoken.length, 1, "not synthesized again");
  const audio = sent("sendAudio");
  assert.equal(audio.length, 1);
  assert.equal(audio[0]!.body.chat_id, String(u.tg));
  assert.equal(audio[0]!.audioBytes, VOICE.length, "the stored MP3 was sent");
  assert.match(String(audio[0]!.body.caption), /Savol 1\/5[\s\S]*Nega fotosintez/);
  assert.equal((await svc.getSession(u.id, sessionId))!.asked, 1, "asked does not grow");

  // The bot answer goes on in the bot: the reaction and question 2 are Telegram messages now.
  calls = [];
  await tg.handleUpdate({ update_id: Date.now(), message: { message_id: 1, chat: { id: u.tg!, type: "private" }, from: { id: u.tg!, first_name: "T" }, text: "botdan javob" } });
  await drain(st);
  assert.ok(sent().some((c) => /botdan javob/.test(String(c.body.text))), "reaction in the bot");
  assert.match(String(sent("sendAudio").at(-1)!.body.caption), /Savol 2\/5/);
});

test("an answer from the other channel moves the defence there (web -> bot by a bot message, bot -> web by a web answer)", { skip }, async () => {
  const { u, sessionId, st } = await webStarted();
  await tg.handleUpdate({ update_id: Date.now(), message: { message_id: 2, chat: { id: u.tg!, type: "private" }, from: { id: u.tg!, first_name: "T" }, text: "botda javob berdim" } });
  assert.equal(await channelOf(sessionId), "bot", "a bot answer switches to the bot");
  await drain(st);
  assert.ok(sent().some((c) => /botda javob berdim/.test(String(c.body.text))), "so the reaction went to the bot");
  assert.equal(sent("sendAudio").length, 1, "and question 2 too");

  calls = [];
  assert.equal((await answerText(u.id, sessionId, "saytdan javob")).status, 200);
  assert.equal(await channelOf(sessionId), "web", "a web answer switches back");
  await drain(st);
  assert.equal(tgMessages().length, 0, "the reaction and question 3 stay on the web");
  const chat = await (await getChat(u.id, sessionId)).json();
  assert.equal(chat.asked.length, 3);
  assert.deepEqual(chat.answers.map((a: { transcript: string }) => a.transcript), ["botda javob berdim", "saytdan javob"]);
});

test("«Saytda davom etish» from the bot: moved to the web, nothing re-sent, the stored voice plays on the page", { skip }, async () => {
  const u = await newUser();
  const r = await svc.startDefence(u.id, await newWork(u.id));
  const st = makeStubs();
  await drain(st);
  calls = [];
  const res = await move(u.id, r.session.id, "web");
  assert.deepEqual(await res.json(), { ok: true, channel: "web", resent: false });
  assert.deepEqual(await jobKinds(), [], "the page reads the state: no job");
  const chat = await (await getChat(u.id, r.session.id)).json();
  assert.deepEqual(chat.asked, [{ idx: 0, text: QUESTIONS[0]!.text, audio: true }]);
  const a = await getAudio(u.id, r.session.id, "0");
  assert.equal(a.status, 200);
  assert.equal(a.headers.get("content-type"), "audio/mpeg");
  assert.equal(a.headers.get("cache-control"), "private, no-store");
  assert.deepEqual([...new Uint8Array(await a.arrayBuffer())], [...VOICE]);
  assert.equal(st.spoken.length, 1, "the web player reuses the bot's voice");
  assert.equal((await getAudio(u.id, r.session.id, "1")).status, 404, "a question not asked yet has no voice");
  assert.equal((await getAudio(u.id, r.session.id, "x")).status, 404);
  // A no-op move and a junk channel.
  assert.equal((await move(u.id, r.session.id, "web")).status, 200);
  assert.equal((await move(u.id, r.session.id, "sms")).status, 400);
  assert.equal(tgMessages().length, 0);
});

test("«Botda davom etish» without a linked Telegram is refused (409 no_telegram), the defence stays on the web", { skip }, async () => {
  const { u, sessionId } = await webStarted({ telegram: false });
  const res = await move(u.id, sessionId, "bot");
  assert.equal(res.status, 409);
  assert.equal((await res.json()).code, "no_telegram");
  assert.equal(await channelOf(sessionId), "web");
  assert.deepEqual(await jobKinds(), []);
});

test("the bot's resume screen of an open defence offers «Saytda davom etish»", { skip }, async () => {
  const { u } = await webStarted();
  await tg.handleUpdate({ update_id: Date.now(), message: { message_id: 3, chat: { id: u.tg!, type: "private" }, from: { id: u.tg!, first_name: "T" }, text: "/domla" } });
  const m = sent().at(-1)!;
  const btns = ((m.body.reply_markup as { inline_keyboard: { text: string; web_app?: { url: string } }[][] }).inline_keyboard ?? []).flat();
  assert.ok(btns.some((b) => /Saytda davom etish/.test(b.text) && b.web_app?.url === "https://slaydx.test/uz/domla?davom=web"));
});

/* ───────────────────────── ownership / closing ───────────────────────── */

test("ownership: another user's session is 404 on every web route; no session is 401", { skip }, async () => {
  const { u, sessionId } = await webStarted();
  const b = await newUser();
  assert.equal((await getChat(null, sessionId)).status, 401);
  assert.equal((await getChat(b.id, sessionId)).status, 404);
  assert.equal((await getChat(b.id, "not-a-uuid")).status, 404);
  assert.equal((await answerText(b.id, sessionId, "javob")).status, 404);
  assert.equal((await answerVoice(b.id, sessionId, webm(20))).status, 404);
  assert.equal((await move(b.id, sessionId, "bot")).status, 404);
  assert.equal((await getAudio(b.id, sessionId, "0")).status, 404);
  assert.deepEqual(await jobKinds(), [], "B wrote nothing into A's defence");
  assert.equal(await channelOf(sessionId), "web");
  // B's own open defence is not answered by a request naming A's session id.
  const genB = await newWork(b.id);
  await svc.startDefence(b.id, genB, "web");
  await drain(makeStubs());
  assert.equal((await answerText(b.id, sessionId, "javob")).status, 404, "the route's session must be the open one");
  assert.equal((await getAudio(u.id, sessionId, "0")).status, 200, "the owner still hears it");
});

test("a whole web defence: grade + weakest in the chat, every stored audio gone at the end; idle expiry tells no Telegram", { skip }, async () => {
  const { u, sessionId, st } = await webStarted();
  st.scoreQueue.push(5, 5, 4, 4, 2);
  for (let i = 0; i < 5; i++) {
    assert.equal((await answerText(u.id, sessionId, `javob ${i}`)).status, 200);
    await drain(st);
  }
  const chat = await (await getChat(u.id, sessionId)).json();
  assert.equal(chat.status, "finished");
  assert.equal(chat.grade, 4, "20/25");
  assert.equal(chat.results.length, 5);
  assert.equal(chat.weakest.question, QUESTIONS[4]!.text);
  assert.equal(chat.weakest.ideal, QUESTIONS[4]!.ideal, "the finished defence shows the weakest question's ideal");
  assert.deepEqual(await audioRows(sessionId), [], "no audio outlives the defence");
  assert.equal(tgMessages().length, 0, "not even the verdict went to Telegram");
  assert.equal((await answerText(u.id, sessionId, "kech")).status, 404);

  const b = await webStarted();
  await query("UPDATE domla_sessions SET last_activity_at = now() - interval '45 minutes' WHERE id = $1", [b.sessionId]);
  calls = [];
  assert.equal(await engine.domlaHousekeeping(b.st.deps), 1);
  assert.equal(tgMessages().length, 0, "a web defence is not told in the bot");
  assert.deepEqual(await audioRows(b.sessionId), []);
  assert.equal((await (await getChat(b.u.id, b.sessionId)).json()).status, "expired");
});

test("web activity refreshes the 30-minute window (an answer and a channel move)", { skip }, async () => {
  const { u, sessionId } = await webStarted();
  await query("UPDATE domla_sessions SET last_activity_at = now() - interval '25 minutes' WHERE id = $1", [sessionId]);
  assert.equal((await move(u.id, sessionId, "web")).status, 200);
  const at = new Date((await svc.getSession(u.id, sessionId))!.lastActivityAt).getTime();
  assert.ok(Date.now() - at < 60_000, "the move refreshed it");
  await query("UPDATE domla_sessions SET last_activity_at = now() - interval '25 minutes' WHERE id = $1", [sessionId]);
  assert.equal((await answerText(u.id, sessionId, "javob")).status, 200);
  assert.ok(Date.now() - new Date((await svc.getSession(u.id, sessionId))!.lastActivityAt).getTime() < 60_000, "the answer refreshed it");
  await query("UPDATE domla_sessions SET last_activity_at = now() - interval '31 minutes' WHERE id = $1", [sessionId]);
  const late = await move(u.id, sessionId, "bot");
  assert.equal(late.status, 410);
  assert.equal((await svc.getSession(u.id, sessionId))!.status, "expired");
});

/* ───────────────────────── review fixes (2026-11-13) ───────────────────────── */

const audioLen = await import("../lib/domla/audio-length.ts");

function gate(): { p: Promise<void>; open: () => void } {
  let open!: () => void;
  const p = new Promise<void>((r) => (open = r));
  return { p, open };
}
async function until(cond: () => boolean, ms = 5_000): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("timeout waiting");
    await new Promise((r) => setTimeout(r, 5));
  }
}
/** Runs exactly one due job. */
async function tickOnce(st: Stubs): Promise<boolean> {
  await query("UPDATE domla_jobs SET run_after = now(), locked_until = NULL");
  return engine.domlaTick(st.deps);
}

test("M1: «Botda davom etish» while the NEXT question's voice is being made -> the bot still gets that question, once", { skip }, async () => {
  const { u, sessionId, st } = await webStarted();
  assert.equal((await answerText(u.id, sessionId, "birinchi")).status, 200);
  assert.ok(await tickOnce(st), "score:0 ran");
  assert.deepEqual(await jobKinds(), ["ask:1"]);
  // Question 2's voice hangs until released.
  const g = gate();
  let speaking = false;
  const slow = {
    ...st.deps,
    synthesize: async (t: string) => {
      st.spoken.push(t);
      speaking = true;
      await g.p;
      return { bytes: VOICE, seconds: 4 };
    },
  };
  calls = [];
  await query("UPDATE domla_jobs SET run_after = now(), locked_until = NULL");
  const running = engine.domlaTick(slow);
  await until(() => speaking);
  const moved = await svc.setChannel(u.id, sessionId, "bot");
  assert.deepEqual(moved, { ok: true, channel: "bot", resent: false }, "asked == idx: setChannel cannot resend, the running job must");
  g.open();
  await running;
  await drain(st);
  const audio = sent("sendAudio");
  assert.equal(audio.length, 1, "question 2 reached the bot exactly once");
  assert.equal(audio[0]!.body.chat_id, String(u.tg));
  assert.match(String(audio[0]!.body.caption), /Savol 2\/5/);
  assert.equal(audio[0]!.audioBytes, VOICE.length);
  assert.equal((await svc.getSession(u.id, sessionId))!.asked, 2);
  assert.deepEqual(await jobKinds(), []);
});

test("M1: a move to the bot AFTER the web ask finished queues its own resend (no gap, no double)", { skip }, async () => {
  const { u, sessionId, st } = await webStarted();
  calls = [];
  assert.deepEqual(await svc.setChannel(u.id, sessionId, "bot"), { ok: true, channel: "bot", resent: true });
  await drain(st);
  assert.equal(sent("sendAudio").length, 1);
});

test("M1: «Botda davom etish» while an answer is being scored -> the reaction and the next question go to the bot", { skip }, async () => {
  const { u, sessionId, st } = await webStarted();
  assert.equal((await answerText(u.id, sessionId, "saytdagi javob")).status, 200);
  const g = gate();
  let scoring = false;
  const slow = {
    ...st.deps,
    score: async (input: import("../lib/server/domla-deps.ts").ScoreInput) => {
      scoring = true;
      await g.p;
      return st.deps.score(input);
    },
  };
  calls = [];
  await query("UPDATE domla_jobs SET run_after = now(), locked_until = NULL");
  const running = engine.domlaTick(slow);
  await until(() => scoring);
  assert.equal((await svc.setChannel(u.id, sessionId, "bot")).ok, true);
  g.open();
  await running;
  assert.ok(sent().some((c) => /saytdagi javob/.test(String(c.body.text))), "the reaction went to the bot");
  await drain(st);
  assert.match(String(sent("sendAudio").at(-1)!.body.caption), /Savol 2\/5/);
});

test("m1: the housekeeping sweep drops audio of closed sessions and stale answer audio, keeps what a job still needs", { skip }, async () => {
  const a = await webStarted();
  // A closed session whose audio survived (a close racing a write).
  await query("UPDATE domla_sessions SET status = 'finished', finished_at = now() WHERE id = $1", [a.sessionId]);
  assert.equal((await audioRows(a.sessionId)).length, 1);
  // An open session: one stale orphan answer (no score job), one old answer whose score job is still pending.
  const b = await webStarted();
  await query("INSERT INTO domla_audio (session_id, kind, idx, mime, bytes, created_at) VALUES ($1, 'answer', 3, 'audio/ogg', '\\x00', now() - interval '11 minutes')", [b.sessionId]);
  assert.equal((await answerVoice(b.u.id, b.sessionId, webm(30))).status, 200);
  await query("UPDATE domla_audio SET created_at = now() - interval '20 minutes' WHERE session_id = $1 AND kind = 'answer' AND idx = 0", [b.sessionId]);
  await engine.domlaHousekeeping(b.st.deps);
  assert.deepEqual(await audioRows(a.sessionId), [], "closed session: nothing left");
  const left = await audioRows(b.sessionId);
  assert.ok(left.some((r) => r.startsWith("question:0")), "an open session's question voice stays");
  assert.ok(left.some((r) => r.startsWith("answer:0")), "an answer with a pending score job stays, however old");
  assert.ok(!left.some((r) => r.startsWith("answer:3")), "an orphan answer older than 10 min goes");
});

/* m2: lengths measured from the bytes */
function wav(seconds: number, byteRate = 8000): Uint8Array {
  const data = Math.round(seconds * byteRate);
  const b = new Uint8Array(44 + data);
  const v = new DataView(b.buffer);
  b.set(new TextEncoder().encode("RIFF"), 0);
  v.setUint32(4, 36 + data, true);
  b.set(new TextEncoder().encode("WAVEfmt "), 8);
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, byteRate, true);
  v.setUint32(28, byteRate, true);
  v.setUint16(32, 1, true);
  v.setUint16(34, 8, true);
  b.set(new TextEncoder().encode("data"), 36);
  v.setUint32(40, data, true);
  return b;
}
function mp3(seconds: number): Uint8Array {
  const b = new Uint8Array(Math.round(seconds * 4000)); // 32 kbit/s
  b[0] = 0xff;
  b[1] = 0xfb; // MPEG-1 Layer III
  b[2] = 0x10; // bitrate index 1 = 32 kbit/s
  return b;
}
function box(type: string, ...parts: Uint8Array[]): Uint8Array {
  const len = 8 + parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(len);
  new DataView(out.buffer).setUint32(0, len);
  out.set(new TextEncoder().encode(type), 4);
  let o = 8;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
function u32s(...n: number[]): Uint8Array {
  const b = new Uint8Array(n.length * 4);
  n.forEach((x, i) => new DataView(b.buffer).setUint32(i * 4, x));
  return b;
}
const FTYP = box("ftyp", new TextEncoder().encode("M4A "), u32s(0));
/** mvhd v0: version/flags, created, modified, timescale, duration. */
const mp4Mvhd = (seconds: number) => new Uint8Array([...FTYP, ...box("moov", box("mvhd", u32s(0, 0, 0, 1000, seconds * 1000, 0, 0, 0)))]);
/** Fragmented (Safari): mvhd duration 0, mdhd timescale 48000, one moof: tfhd default duration 1024 + a trun of `samples`. */
const mp4Frag = (samples: number) =>
  new Uint8Array([
    ...FTYP,
    ...box("moov", box("mvhd", u32s(0, 0, 0, 1000, 0, 0, 0, 0)), box("trak", box("mdia", box("mdhd", u32s(0, 0, 0, 48000, 0, 0))))),
    ...box("moof", box("traf", box("tfhd", u32s(0x08, 1, 1024)), box("trun", u32s(0, samples)))),
  ]);

test("m2: Ogg / WAV / MP3 / MP4 lengths come from the bytes; over 120 s is refused whatever the client claims", { skip }, async () => {
  const ogg130 = remux.webmToOgg(webm(6500)).bytes;
  assert.equal(audioLen.oggSeconds(ogg130), 130);
  assert.equal(audioLen.wavSeconds(wav(130)), 130);
  assert.equal(audioLen.mp3Seconds(mp3(150)), 150);
  assert.equal(audioLen.mp4Seconds(mp4Mvhd(130)), 130);
  assert.equal(Math.round(audioLen.mp4Seconds(mp4Frag(7000))!), 149);
  assert.equal(audioLen.mp4Seconds(FTYP), null, "nothing to measure");
  assert.equal(audioLen.minSeconds(3_840_000), 120);

  const { u, sessionId } = await webStarted();
  const cases: [string, Uint8Array][] = [["ogg", ogg130], ["wav", wav(130)], ["mp3", mp3(150)], ["mp4", mp4Mvhd(130)], ["mp4-frag", mp4Frag(7000)]];
  for (const [name, bytes] of cases) {
    const r = await answerVoice(u.id, sessionId, bytes, 5, "audio/whatever");
    assert.equal(r.status, 413, name);
    assert.equal((await r.json()).code, "too_long", name);
  }
  assert.deepEqual(await jobKinds(), [], "nothing was queued");
  assert.equal((await answerVoice(u.id, sessionId, wav(20), 999)).status, 413, "a client claiming more than 120 s is refused too");
  assert.equal((await answerVoice(u.id, sessionId, mp3(60), 1)).status, 200, "a 60 s MP3 passes");
});

function bigWebm(count: number, size: number): Uint8Array {
  const header = el([0x1a, 0x45, 0xdf, 0xa3], el([0x42, 0x82], text("webm")));
  const track = el([0xae], [...el([0xd7], [1]), ...el([0x86], text("A_OPUS")), ...el([0x63, 0xa2], OPUS_HEAD)]);
  const blocks: number[] = [];
  for (let i = 0; i < count; i++) blocks.push(...el([0xa3], [0x81, 0, 0, 0x80, 0xf8, ...new Array<number>(size - 1).fill(i & 0xff)]));
  return new Uint8Array([...header, 0x18, 0x53, 0x80, 0x67, ...UNKNOWN, ...el([0x16, 0x54, 0xae, 0x6b], track), 0x1f, 0x43, 0xb6, 0x75, ...UNKNOWN, ...blocks]);
}

test("m4: big Opus packets are paged by lacing segments (never > 255), a packet that cannot fit a page is refused", () => {
  const pages = oggPages(remux.webmToOgg(bigWebm(60, 1275)).bytes);
  const audio = pages.slice(2).flatMap((p) => p.packets);
  assert.equal(audio.length, 60, "every packet survives");
  assert.ok(audio.every((p) => p.length === 1275));
  // 1275 bytes = 6 lacing values: at most 42 such packets fit 255 segments.
  assert.ok(pages.slice(2).every((p) => p.packets.length <= 42), "split by segments, not by a fixed 50");
  assert.throws(() => remux.webmToOgg(bigWebm(1, 70_000)), remux.RemuxError);
});

test("m4: hostile WebM input only ever fails as RemuxError (huge sizes, 8-byte vints, truncated blocks, random bytes)", () => {
  const header = el([0x1a, 0x45, 0xdf, 0xa3], el([0x42, 0x82], text("webm")));
  const seg = [0x18, 0x53, 0x80, 0x67, ...UNKNOWN];
  const cases: Uint8Array[] = [
    new Uint8Array([...header, ...seg, 0x86, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xfe, 1, 2]), // a leaf claiming ~2^56 bytes
    new Uint8Array([...header, ...seg, 0xa3, 0x01, 0, 0, 0, 0, 0, 0, 0x02, 0x81]), // a truncated block
    new Uint8Array([...header, ...seg, 0xa3, 0x80]), // an empty block
    new Uint8Array([...header, 0x00, 0x00, 0x00]), // an invalid id
    new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x01]), // a truncated size vint
    webm(10).subarray(0, 120), // cut mid-track
  ];
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) >>> 16) & 0xff;
  for (let i = 0; i < 200; i++) cases.push(new Uint8Array([...header, ...Array.from({ length: 64 }, rnd)]));
  const t0 = Date.now();
  for (const c of cases) {
    try {
      remux.webmToOgg(c);
    } catch (e) {
      assert.ok(e instanceof remux.RemuxError, `only RemuxError, got ${String(e)}`);
    }
  }
  assert.ok(Date.now() - t0 < 2_000, "no hang");
  // An 8-byte size vint with a small value is valid EBML (read correctly: this block's 4 bytes hold no packet).
  const eight = new Uint8Array([...header, ...seg, ...el([0x16, 0x54, 0xae, 0x6b], el([0xae], [...el([0xd7], [1]), ...el([0x86], text("A_OPUS"))])), 0xa3, ...size8(4), 0x81, 0, 0, 0x80]);
  assert.throws(() => remux.webmToOgg(eight), (e: unknown) => e instanceof remux.RemuxError && /audio yo/.test(e.message), "parsed to the end: no audio");
  const eightOk = new Uint8Array([...header, ...seg, ...el([0x16, 0x54, 0xae, 0x6b], el([0xae], [...el([0xd7], [1]), ...el([0x86], text("A_OPUS"))])), 0xa3, ...size8(5), 0x81, 0, 0, 0x80, 0xf8]);
  assert.equal(remux.webmToOgg(eightOk).seconds, 0.02);
});

test("a failed WEB defence: the whole charge comes back, no Telegram message", { skip }, async () => {
  const u = await newUser();
  const gen = await newWork(u.id);
  const res = await call(startRoute.POST, u.id, "/api/domla", { method: "POST", json: { generationId: gen } });
  const sid = (await res.json()).sessionId as string;
  assert.equal(await points(u.id), 7000);
  const st = makeStubs();
  st.deps = {
    ...st.deps,
    generateQuestions: async () => {
      throw new Error("AI savollar tuzmadi");
    },
  };
  calls = [];
  await drain(st);
  const chat = await (await getChat(u.id, sid)).json();
  assert.equal(chat.status, "failed");
  assert.equal(await points(u.id), 10_000, "refunded");
  assert.equal(tgMessages().length, 0);
});

test("web refusals: not_waiting while the next question is not out; audio idx >= asked / out of range; oversize chunked upload", { skip }, async () => {
  const { u, sessionId, st } = await webStarted();
  assert.equal((await answerText(u.id, sessionId, "javob")).status, 200);
  assert.ok(await tickOnce(st), "score:0 ran; ask:1 is queued, not run");
  const r = await answerText(u.id, sessionId, "erta javob");
  assert.equal(r.status, 409);
  assert.equal((await r.json()).code, "not_waiting");
  for (const idx of ["1", "4", "5", "99", "-1", "1e1"]) assert.equal((await getAudio(u.id, sessionId, idx)).status, 404, idx);
  // A chunked body with no Content-Length is cut at the limit.
  const boundary = "----domla";
  const chunk = new TextEncoder().encode("x".repeat(64 * 1024));
  let sentBytes = 0;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode(`--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="a"\r\nContent-Type: audio/ogg\r\n\r\n`));
    },
    pull(c) {
      if (sentBytes > 3 * 1024 * 1024) return c.close();
      sentBytes += chunk.length;
      c.enqueue(chunk);
    },
  });
  const headers = { origin: "https://slaydx.test", cookie: `${SESSION_COOKIE}=${(await createSession(u.id)).token}`, "content-type": `multipart/form-data; boundary=${boundary}` };
  const req = new Request(`https://slaydx.test/api/domla/sessions/${sessionId}/answer`, { method: "POST", headers, body, duplex: "half" } as RequestInit);
  assert.equal(req.headers.get("content-length"), null);
  const res = await inRequest(req, () => (answerRoute.POST as Handler)(req, { params: Promise.resolve({ id: sessionId }) }));
  assert.equal(res.status, 413);
  assert.ok(sentBytes < 3 * 1024 * 1024, "the reader stopped early");
});
