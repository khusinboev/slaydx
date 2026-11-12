/* eslint-disable @typescript-eslint/no-explicit-any -- Bot API bodies are read untyped here */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { createIsolatedDb } from "./helpers/isolated-db.mts";

/**
 * «✏️ Tahrirlash» / «⭐ Baholash» under the owner's file message (docs/ratings/GENERATION-RATING.md):
 * the exact keyboards (editable vs non-editable kinds, public vs non-public app URL, purged files,
 * three languages), the copies other people get (unchanged), and the whole `gr:*` callback flow end
 * to end through `handleUpdate` with the Bot API stubbed at `fetch` and a real, isolated Postgres.
 *
 * Mutations (each turned the named test red, then restored):
 *   1. `editUrlFor` without the `adapterFor` check                 -> «non-editable kinds get no edit button»;
 *   2. `editUrlFor` without `appUrl` (a raw URL on any deployment) -> «a non-public app URL: no edit button»;
 *   3. `savedPresentation` ignores the stored stars               -> «save after rating: ⭐ 4/5 on the resend»;
 *   4. `handleWorkRatingCallback` uses the dashed id without the owner (`ratingTarget` skipped, write by id only)
 *                                                                  -> «a foreign presser changes nothing»;
 *   5. 1-3 stars go straight back to the normal keyboard           -> «rate → 2 → reason»;
 *   6. `parseCallback` accepts a 6th part / an unknown reason      -> «callback codes»;
 *   7. `backLinkMarkup` given the owner keyboard                   -> «the copy other people receive is unchanged».
 */

const TOKEN = "123456:FAKE-work-rating-token";
process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters-long";
process.env.TELEGRAM_BOT_TOKEN = TOKEN;
process.env.NEXT_PUBLIC_TELEGRAM_BOT = "slaydx_test_bot";
process.env.APP_URL = "https://slaydx.test";
process.env.WORKER_INLINE = "false";
delete process.env.BOT_PREMIUM_EMOJI;
const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("workrating") : { isolated: false, drop: async () => {} };
const skip = hasDb && iso.isolated ? false : "isolated Postgres database is not available";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";

const dbm = await import("../lib/server/db.ts");
if (!skip) await dbm.migrate();
const { env } = await import("../lib/server/env.ts");
const tg = await import("../lib/server/telegram.ts");
const tf = await import("../lib/server/telegram-files.ts");
const wr = await import("../lib/server/bot/work-rating.ts");
const codes = await import("../lib/server/bot/codes.ts");
const { DOWNLOAD_FORMAT_IDS } = await import("../lib/downloads/formats.ts");

const realFetch = globalThis.fetch;
after(async () => {
  globalThis.fetch = realFetch;
  if (skip) return;
  await dbm.pool().end();
  await iso.drop();
});

/* ───────────────────────── fixtures ───────────────────────── */

type U = { id: string; telegramId: string; tg: number };
async function mkUser(lang = "uz"): Promise<U> {
  const tgId = randomInt(6_000_000_000, 6_900_000_000);
  const [row] = await dbm.query<{ id: string }>("INSERT INTO users (telegram_id, name, language) VALUES ($1, 'Baho Sinov', $2) RETURNING id::text AS id", [String(tgId), lang]);
  return { id: row!.id, telegramId: String(tgId), tg: tgId };
}

async function mkGen(userId: string, o: { tool?: string; status?: string; purged?: boolean } = {}): Promise<string> {
  const id = randomUUID();
  await dbm.query(
    `INSERT INTO generations (id, user_id, tool_id, topic, status, format, file_name, file_version, doc_version, files_purged_at)
     VALUES ($1, $2, $3, 'Quyosh tizimi', $4, 'pptx', 'Quyosh tizimi.pptx', 1, 1, $5)`,
    [id, userId, o.tool ?? "slide", o.status ?? "COMPLETED", o.purged ? new Date() : null],
  );
  return id;
}

const hex = (id: string) => id.replace(/-/g, "");
const stored = async (gen: string, user: string) =>
  (await dbm.query<any>("SELECT stars, reason, source FROM generation_ratings WHERE generation_id = $1 AND user_id = $2", [gen, user]))[0] ?? null;

/** The normal keyboard as Telegram must receive it (uz). */
function normalKb(gen: string, o: { edit: boolean; stars?: number; format?: string } = { edit: true }) {
  const f = o.format ?? "native";
  const rate = { text: o.stars ? `⭐ ${o.stars}/5` : "⭐ Baholash", callback_data: `gr:o:${hex(gen)}:${f}` };
  return {
    inline_keyboard: [
      o.edit ? [{ text: "✏️ Tahrirlash", web_app: { url: `https://slaydx.test/uz/files/${gen}?edit=1` } }, rate] : [rate],
      [{ text: "📤 Ulashish", switch_inline_query: `f_${hex(gen)}_${f}` }],
    ],
  };
}

const starsKb = (gen: string, f = "native") => ({
  inline_keyboard: [
    [1, 2, 3, 4, 5].map((n) => ({ text: `${n}⭐`, callback_data: `gr:s:${hex(gen)}:${f}:${n}` })),
    [{ text: "‹ Orqaga", callback_data: `gr:b:${hex(gen)}:${f}` }],
  ],
});

const reasonsKb = (gen: string, f = "native") => ({
  inline_keyboard: [
    [
      { text: "Dizayn", callback_data: `gr:r:${hex(gen)}:${f}:d` },
      { text: "Rasmlar", callback_data: `gr:r:${hex(gen)}:${f}:i` },
      { text: "Matn", callback_data: `gr:r:${hex(gen)}:${f}:t` },
    ],
    [
      { text: "Xatolar", callback_data: `gr:r:${hex(gen)}:${f}:e` },
      { text: "Boshqa", callback_data: `gr:r:${hex(gen)}:${f}:o` },
    ],
    [{ text: "O‘tkazib yuborish", callback_data: `gr:r:${hex(gen)}:${f}:x` }],
  ],
});

/* ───────────────────────── Bot API stub ───────────────────────── */

type Call = { method: string; body: Record<string, any> };
let calls: Call[] = [];
let editReply: Record<string, unknown> = { ok: true, result: true };
function installFetch(): void {
  calls = [];
  editReply = { ok: true, result: true };
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const m = /^https:\/\/api\.telegram\.org\/bot[^/]+\/(\w+)$/.exec(String(url));
    assert.ok(m, `unexpected URL ${url}`);
    const body = init?.body instanceof FormData ? Object.fromEntries(init.body.entries()) : JSON.parse(String(init?.body ?? "{}"));
    calls.push({ method: m[1]!, body });
    return new Response(JSON.stringify(m[1] === "editMessageReplyMarkup" ? editReply : { ok: true, result: true }));
  }) as typeof fetch;
}
const edits = () => calls.filter((c) => c.method === "editMessageReplyMarkup");
const toasts = () => calls.filter((c) => c.method === "answerCallbackQuery").map((c) => c.body.text);

let updateSeq = Date.now() * 1000 + randomInt(0, 999);
const MESSAGE_ID = 4242;
/** A tap by `fromId` on a message in its own private chat (a forwarded copy lives in the presser's own chat too). */
async function tap(fromId: number, data: string): Promise<void> {
  await tg.handleUpdate({
    update_id: ++updateSeq,
    callback_query: { id: `cq-${updateSeq}`, from: { id: fromId, first_name: "Sinov" }, message: { message_id: MESSAGE_ID, chat: { id: fromId, type: "private" } }, data },
  } as never);
}

/* ───────────────────────── keyboards (pure) ───────────────────────── */

test("editable kinds get «✏️ Tahrirlash» on a public URL; the URL opens the viewer in edit mode", () => {
  const gen = "0a1b2c3d-4e5f-4061-8a9b-0c1d2e3f4a5b";
  for (const tool of ["slide", "pro-slide", "referat", "coursework", "mustaqil-ish", "essay", "article", "thesis", "resume", "lesson-plan", "glossary"]) {
    assert.equal(wr.editUrlFor(gen, tool), `https://slaydx.test/uz/files/${gen}?edit=1`, tool);
  }
  assert.deepEqual(wr.workKeyboard({ generationId: gen, format: "native", lang: "uz", editUrl: wr.editUrlFor(gen, "slide"), stars: null }), normalKb(gen));
});

test("non-editable kinds get no edit button: pictures, audio, video, games, AI-picture slides — MUTATSIYA 1", () => {
  const gen = "0a1b2c3d-4e5f-4061-8a9b-0c1d2e3f4a5b";
  for (const tool of ["image", "studio-image", "portrait", "infographic", "image-slide", "podcast", "greeting", "video", "studio-video", "crossword", "flashcards", "translation"]) {
    assert.equal(wr.editUrlFor(gen, tool), null, tool);
    assert.deepEqual(wr.workKeyboard({ generationId: gen, format: "native", lang: "uz", editUrl: wr.editUrlFor(gen, tool), stars: null }), normalKb(gen, { edit: false }), tool);
  }
  assert.equal(wr.editUrlFor(gen, "slide", true), null, "purged files: nothing left to edit");
});

test("a non-public app URL: no edit button (Telegram refuses such web_app URLs) — MUTATSIYA 2", () => {
  const gen = "0a1b2c3d-4e5f-4061-8a9b-0c1d2e3f4a5b";
  const mutable = env as { appUrl: string };
  const prev = mutable.appUrl;
  try {
    for (const url of ["http://localhost:3000", "http://slaydx.test", "https://127.0.0.1:3000"]) {
      mutable.appUrl = url;
      assert.equal(wr.editUrlFor(gen, "slide"), null, url);
    }
  } finally {
    mutable.appUrl = prev;
  }
});

test("keyboards in three languages; rated button shows the stars", () => {
  const gen = "0a1b2c3d-4e5f-4061-8a9b-0c1d2e3f4a5b";
  const labels = (lang: "uz" | "ru" | "en", stars: number | null) =>
    wr.workKeyboard({ generationId: gen, format: "pdf", lang, editUrl: "https://slaydx.test/x", stars }).inline_keyboard.map((r) => r.map((b) => b.text));
  assert.deepEqual(labels("uz", null), [["✏️ Tahrirlash", "⭐ Baholash"], ["📤 Ulashish"]]);
  assert.deepEqual(labels("ru", null), [["✏️ Редактировать", "⭐ Оценить"], ["📤 Поделиться"]]);
  assert.deepEqual(labels("en", 4), [["✏️ Edit", "⭐ 4/5"], ["📤 Share"]]);
  assert.deepEqual(wr.starsKeyboard(gen, "native", "uz"), starsKb(gen));
  assert.deepEqual(wr.reasonsKeyboard(gen, "native", "uz"), reasonsKb(gen));
  assert.deepEqual(wr.reasonsKeyboard(gen, "native", "ru").inline_keyboard.flat().map((b) => b.text), ["Дизайн", "Картинки", "Текст", "Ошибки", "Другое", "Пропустить"]);
  assert.deepEqual(wr.reasonsKeyboard(gen, "native", "en").inline_keyboard.flat().map((b) => b.text), ["Design", "Images", "Text", "Mistakes", "Other", "Skip"]);
  assert.deepEqual(wr.starsKeyboard(gen, "native", "en").inline_keyboard[1]!.map((b) => b.text), ["‹ Back"]);
});

test("callback codes: every gr code for every download format is ≤ 64 bytes and round-trips; forged ones are unknown — MUTATSIYA 6", () => {
  const gen = "ffffffff-ffff-4fff-bfff-ffffffffffff";
  for (const f of DOWNLOAD_FORMAT_IDS) {
    const all: Array<[string, unknown]> = [
      [codes.cb.workRate(gen, f), { kind: "workRate", generationId: gen, format: f }],
      [codes.cb.workBack(gen, f), { kind: "workBack", generationId: gen, format: f }],
      ...[1, 2, 3, 4, 5].map((n): [string, unknown] => [codes.cb.workStars(gen, f, n), { kind: "workStars", generationId: gen, format: f, stars: n }]),
      ...(["design", "images", "text", "errors", "other", null] as const).map((r): [string, unknown] => [
        codes.cb.workReason(gen, f, r),
        { kind: "workReason", generationId: gen, format: f, reason: r },
      ]),
    ];
    for (const [c, parsed] of all) {
      assert.ok(Buffer.byteLength(c) <= 64, `${c}: ${Buffer.byteLength(c)} bytes`);
      assert.deepEqual(codes.parseCallback(c), parsed, c);
    }
  }
  const h = hex(gen);
  for (const bad of [
    `gr:o:${h}`,
    `gr:o:${h}:exe`,
    `gr:o:${h.toUpperCase()}:native`,
    `gr:o:${h.slice(1)}:native`,
    `gr:o:${gen}:native`,
    `gr:s:${h}:native:0`,
    `gr:s:${h}:native:6`,
    `gr:s:${h}:native`,
    `gr:r:${h}:native:z`,
    `gr:r:${h}:native:constructor`,
    `gr:r:${h}:native:d:1`,
    `gr:b:${h}:native:1`,
    `gr:x:${h}:native`,
    "gr",
  ]) {
    assert.equal(codes.parseCallback(bad).kind, "unknown", bad);
  }
});

/* ───────────────────────── the file message ───────────────────────── */

function filesHarness() {
  const sent: Call[] = [];
  let seq = 0;
  const fetchStub = (async (url: string | URL, init?: RequestInit) => {
    const method = /\/(\w+)$/.exec(String(url))![1]!;
    const body = init?.body instanceof FormData ? Object.fromEntries(init.body.entries()) : JSON.parse(String(init?.body));
    sent.push({ method, body });
    if (method === "savePreparedInlineMessage") return new Response(JSON.stringify({ ok: true, result: { id: `prep-${++seq}`, expiration_date: 1_900_000_000 } }));
    const given = typeof body.document === "string" ? body.document : `FILE-${randomUUID()}`;
    return new Response(JSON.stringify({ ok: true, result: { message_id: ++seq, document: { file_id: given, file_unique_id: `U-${given}`, file_size: 10 } } }));
  }) as typeof fetch;
  let now = new Date("2026-11-12T10:00:00.000Z");
  const deps = {
    fetch: fetchStub,
    now: () => now,
    produce: async () => ({ bytes: Buffer.alloc(10, 1), fileName: "Quyosh tizimi.pptx", mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", fileVersion: 1 }),
  };
  return { sent, deps, advance: (ms: number) => (now = new Date(now.getTime() + ms)) };
}

test("save of an editable work: the owner's copy carries [Tahrirlash | Baholash] [Ulashish]", { skip }, async () => {
  const u = await mkUser();
  const gen = await mkGen(u.id);
  const h = filesHarness();
  await tf.saveToBot(gen, u, "native", h.deps);
  assert.equal(h.sent[0]!.method, "sendDocument");
  assert.deepEqual(JSON.parse(String(h.sent[0]!.body.reply_markup)), normalKb(gen));
});

test("save of a picture / a purged work: no edit button; a Russian user gets Russian labels", { skip }, async () => {
  const u = await mkUser("ru");
  for (const o of [{ tool: "image" }, { tool: "slide", purged: true }]) {
    const gen = await mkGen(u.id, o);
    const h = filesHarness();
    await tf.saveToBot(gen, u, "native", h.deps);
    const kb = JSON.parse(String(h.sent[0]!.body.reply_markup));
    assert.deepEqual(kb, {
      inline_keyboard: [[{ text: "⭐ Оценить", callback_data: `gr:o:${hex(gen)}:native` }], [{ text: "📤 Поделиться", switch_inline_query: `f_${hex(gen)}_native` }]],
    }, JSON.stringify(o));
  }
});

test("save after rating: ⭐ 4/5 on the resend (the keyboard is built fresh, nothing is stored) — MUTATSIYA 3", { skip }, async () => {
  const u = await mkUser();
  const gen = await mkGen(u.id);
  const h = filesHarness();
  await tf.saveToBot(gen, u, "native", h.deps);
  const { rateGeneration } = await import("../lib/server/generation-ratings.ts");
  await rateGeneration({ userId: u.id, generationId: gen, stars: 4, source: "bot" });
  h.advance(tf.SAVE_DEBOUNCE_MS + 1);
  await tf.saveToBot(gen, u, "native", h.deps);
  const resend = h.sent[1]!;
  assert.equal(typeof resend.body.document, "string", "a JSON resend by file_id");
  assert.deepEqual(resend.body.reply_markup, normalKb(gen, { edit: true, stars: 4 }));
});

test("the copy other people receive is unchanged: prepared share and inline results keep only «SlaydX'da ochish» — MUTATSIYA 7", { skip }, async () => {
  const u = await mkUser();
  const gen = await mkGen(u.id);
  const h = filesHarness();
  await tf.prepareShare(gen, u, "native", h.deps);
  const link = { inline_keyboard: [[{ text: "SlaydX'da ochish", url: "https://t.me/slaydx_test_bot" }]] };
  assert.deepEqual(JSON.parse(String(h.sent[0]!.body.reply_markup)), normalKb(gen), "the owner's own copy");
  assert.deepEqual(h.sent[1]!.body.result.reply_markup, link, "the prepared message for other chats");
  const [r] = (await tf.inlineFileResults(tf.shareQuery(gen, "native"), u.tg))!;
  assert.deepEqual(r!.reply_markup, link, "the inline result");
  assert.ok(!JSON.stringify(h.sent[1]!.body).includes("web_app") && !JSON.stringify(r).includes("web_app"), "no web_app outside the private chat");
  assert.deepEqual(tf.backLinkMarkup("https://t.me/slaydx_test_bot"), link);
});

/* ───────────────────────── callback flow ───────────────────────── */

test("rate → stars → 5: stored, «Rahmat», normal keyboard with ⭐ 5/5", { skip }, async () => {
  const u = await mkUser();
  const gen = await mkGen(u.id);
  installFetch();
  await tap(u.tg, codes.cb.workRate(gen, "native"));
  assert.deepEqual(edits().map((c) => c.body), [{ chat_id: u.tg, message_id: MESSAGE_ID, reply_markup: starsKb(gen) }]);
  assert.deepEqual(toasts(), ["Ishni 1 dan 5 gacha baholang"]);
  assert.equal(await stored(gen, u.id), null, "opening the stars stores nothing");

  installFetch();
  await tap(u.tg, codes.cb.workStars(gen, "native", 5));
  assert.deepEqual(await stored(gen, u.id), { stars: 5, reason: null, source: "bot" });
  assert.deepEqual(edits().map((c) => c.body.reply_markup), [normalKb(gen, { edit: true, stars: 5 })]);
  assert.deepEqual(toasts(), ["Rahmat! Bahoyingiz qabul qilindi"]);

  // «‹ Orqaga» from the stars: the normal keyboard with the current value.
  installFetch();
  await tap(u.tg, codes.cb.workRate(gen, "native"));
  await tap(u.tg, codes.cb.workBack(gen, "native"));
  assert.deepEqual(edits().at(-1)!.body.reply_markup, normalKb(gen, { edit: true, stars: 5 }));
});

test("rate → 2 → reason: stored with the reason, then ⭐ 2/5; skip leaves no reason — MUTATSIYA 5", { skip }, async () => {
  const u = await mkUser();
  const gen = await mkGen(u.id);
  installFetch();
  await tap(u.tg, codes.cb.workStars(gen, "native", 2));
  assert.deepEqual(await stored(gen, u.id), { stars: 2, reason: null, source: "bot" }, "the stars are saved before the reason");
  assert.deepEqual(edits().map((c) => c.body.reply_markup), [reasonsKb(gen)]);
  assert.deepEqual(toasts(), ["Bahoyingiz qabul qilindi. Nima yoqmadi? Sababni tanlang"]);

  installFetch();
  await tap(u.tg, codes.cb.workReason(gen, "native", "images"));
  assert.deepEqual(await stored(gen, u.id), { stars: 2, reason: "images", source: "bot" });
  assert.deepEqual(edits().map((c) => c.body.reply_markup), [normalKb(gen, { edit: true, stars: 2 })]);
  assert.deepEqual(toasts(), ["Rahmat! Bahoyingiz qabul qilindi"]);

  // Change the rating: 1 star, then skip the reason.
  installFetch();
  await tap(u.tg, codes.cb.workStars(gen, "native", 1));
  await tap(u.tg, codes.cb.workReason(gen, "native", null));
  assert.deepEqual(await stored(gen, u.id), { stars: 1, reason: null, source: "bot" });
  assert.deepEqual(edits().at(-1)!.body.reply_markup, normalKb(gen, { edit: true, stars: 1 }));
});

test("change rating: 2 → 4, then a leftover reason button changes nothing", { skip }, async () => {
  const u = await mkUser();
  const gen = await mkGen(u.id, { tool: "image" });
  installFetch();
  await tap(u.tg, codes.cb.workStars(gen, "pdf", 2));
  await tap(u.tg, codes.cb.workStars(gen, "pdf", 4));
  assert.deepEqual(await stored(gen, u.id), { stars: 4, reason: null, source: "bot" });
  assert.deepEqual(edits().at(-1)!.body.reply_markup, normalKb(gen, { edit: false, stars: 4, format: "pdf" }), "a picture: no edit button");
  installFetch();
  await tap(u.tg, codes.cb.workReason(gen, "pdf", "design"));
  assert.deepEqual(await stored(gen, u.id), { stars: 4, reason: null, source: "bot" });
  assert.deepEqual(toasts(), ["Bu tugma eskirgan"]);
  assert.deepEqual(edits().map((c) => c.body.reply_markup), [normalKb(gen, { edit: false, stars: 4, format: "pdf" })]);
});

test("a foreign presser (a forwarded message) changes nothing: «Bu ish sizniki emas» — MUTATSIYA 4", { skip }, async () => {
  const owner = await mkUser();
  const other = await mkUser();
  const gen = await mkGen(owner.id);
  await (await import("../lib/server/generation-ratings.ts")).rateGeneration({ userId: owner.id, generationId: gen, stars: 3, source: "bot" });
  for (const data of [codes.cb.workRate(gen, "native"), codes.cb.workStars(gen, "native", 5), codes.cb.workReason(gen, "native", "text"), codes.cb.workBack(gen, "native")]) {
    installFetch();
    await tap(other.tg, data);
    assert.deepEqual(toasts(), ["Bu ish sizniki emas"], data);
    assert.equal(edits().length, 0, `${data}: the keyboard is not touched`);
  }
  assert.deepEqual(await stored(gen, owner.id), { stars: 3, reason: null, source: "bot" });
  assert.equal(await stored(gen, other.id), null);
});

test("a deleted generation, an unfinished one, a stale button: answered, nothing written", { skip }, async () => {
  const u = await mkUser("en");
  installFetch();
  await tap(u.tg, codes.cb.workStars(randomUUID(), "native", 5));
  assert.deepEqual(toasts(), ["This work was not found — it may have been deleted"]);
  const running = await mkGen(u.id, { status: "IN_PROGRESS" });
  installFetch();
  await tap(u.tg, codes.cb.workRate(running, "native"));
  await tap(u.tg, codes.cb.workStars(running, "native", 5));
  assert.deepEqual(toasts(), ["This work is not ready yet", "This work is not ready yet"]);
  assert.equal(edits().length, 0);
  assert.equal(await stored(running, u.id), null);
  installFetch();
  await tap(u.tg, `gr:s:${hex(running)}:native:9`);
  assert.deepEqual(toasts(), ["This button is out of date"]);
});

test("admin «Statistika»: «Baholar (30 kun)» line from the last 30 days, empty state in three languages", { skip }, async () => {
  const { botStats } = await import("../lib/server/bot/admin-stats.ts");
  const { statsScreen } = await import("../lib/server/bot/admin-screens.ts");
  const admin = (lang: "uz" | "ru" | "en") => ({ adminId: "1", userId: "1", role: "viewer" as const, telegramId: 1, name: "A", lang, permissions: [] });
  // This isolated database holds only this file's ratings: start from a clean table.
  await dbm.query("DELETE FROM generation_ratings");
  const empty = await botStats({ channelMembers: false });
  assert.deepEqual(empty.ratings, { count: 0, average: null, low: 0 });
  assert.match(statsScreen(admin("uz"), empty).text, /Baholar \(30 kun\): hali yo‘q/);
  const u = await mkUser();
  const ins = async (stars: number, ago: string) =>
    dbm.query(`INSERT INTO generation_ratings (generation_id, user_id, stars, source, created_at, updated_at) VALUES ($1, $2, $3, 'bot', now() - $4::interval, now() - $4::interval)`, [
      await mkGen(u.id),
      u.id,
      stars,
      ago,
    ]);
  await ins(5, "1 hour");
  await ins(4, "3 days");
  await ins(2, "20 days");
  await ins(1, "45 days"); // outside the window
  const s = await botStats({ channelMembers: false });
  assert.deepEqual(s.ratings, { count: 3, average: 3.67, low: 1 });
  assert.match(statsScreen(admin("uz"), s).text, /Baholar \(30 kun\): o‘rtacha <b>3\.7<\/b> · 3 ta · ≤3: 1 ta/);
  assert.match(statsScreen(admin("ru"), s).text, /Оценки \(30 дней\): в среднем <b>3\.7<\/b>/);
  assert.match(statsScreen(admin("en"), s).text, /Ratings \(30 days\): average <b>3\.7<\/b> · 3 · ≤3: 1/);
});

test("idempotent: a repeated tap stores the same value and «message is not modified» is fine; answers in Russian", { skip }, async () => {
  const u = await mkUser("ru");
  const gen = await mkGen(u.id);
  installFetch();
  await tap(u.tg, codes.cb.workStars(gen, "native", 5));
  editReply = { ok: false, error_code: 400, description: "Bad Request: message is not modified" };
  await tap(u.tg, codes.cb.workStars(gen, "native", 5));
  assert.deepEqual(toasts(), ["Спасибо! Ваша оценка принята", "Спасибо! Ваша оценка принята"]);
  assert.equal((await dbm.query("SELECT 1 FROM generation_ratings WHERE generation_id = $1", [gen])).length, 1);
  assert.deepEqual(edits()[0]!.body.reply_markup.inline_keyboard.map((r: any[]) => r.map((b) => b.text)), [["✏️ Редактировать", "⭐ 5/5"], ["📤 Поделиться"]]);
});
