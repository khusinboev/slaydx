import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";

/**
 * `lib/server/telegram-files.ts` — «Saqlash» / «Ulashish» through the bot
 * (docs/mobile/PLAN.md §4.4, R2 §5). Real Postgres (`telegram_files`,
 * ownership in SQL); the Bot API is a stubbed `fetch` with a fake token and
 * the bytes come from an injected `produce` (package A's `produceDownload`).
 *
 * Mutations (each turned a test red):
 *   1. `cacheValid` ignores `file_version` — «version bump → re-upload»;
 *   2. resend path calls `produce` again (no cache) — «second save resends by file_id»;
 *   3. debounce claim removed — «tap within 20 s → duplicate»;
 *   4. 403 mapped to telegram_unavailable — «403 → bot_unreachable»;
 *   5. `escapeHtml` drops the `&` rule — «caption escaping»;
 *   6. `allow_bot_chats: true` — «prepared message params»;
 *   7. `singleFlight` bypassed — «parallel double tap → one upload»;
 *   8. stale-file_id branch removed — «dead file_id → re-upload»;
 *   9. failed resend keeps the claimed `saved_at` — «failed resend frees the slot».
 */

const TOKEN = "123456:FAKE-files-token-never-sent";
process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters-long";
process.env.TELEGRAM_BOT_TOKEN = TOKEN;
process.env.NEXT_PUBLIC_TELEGRAM_BOT = "slaydx_test_bot";
const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";
const skip = hasDb ? false : "Postgres kerak (DATABASE_URL)";

const { query, queryOne, pool, ensureMigrated } = await import("../lib/server/db.ts");
const tf = await import("../lib/server/telegram-files.ts");
const { saveToBot, prepareShare, TelegramFileError, buildCaption, SAVE_DEBOUNCE_MS, CAPTION_LIMIT } = tf;
type Deps = import("../lib/server/telegram-files.ts").TelegramFilesDeps;
type Produced = import("../lib/server/telegram-files.ts").ProducedFile;
if (hasDb) await ensureMigrated();

const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

/* ───────────────────────────── fixtures ───────────────────────────── */

const userIds: string[] = [];
after(async () => {
  if (!hasDb) return;
  if (userIds.length) await query("DELETE FROM users WHERE id = ANY($1::bigint[])", [userIds]);
  await pool().end();
});

async function mkUser(withTelegram = true): Promise<{ id: string; telegramId: string | null }> {
  const telegramId = withTelegram ? String(randomInt(6_000_000_000, 6_900_000_000)) : null;
  const row = await queryOne<{ id: string }>(
    "INSERT INTO users (telegram_id, name) VALUES ($1, 'Fayl Sinov') RETURNING id::text AS id",
    [telegramId],
  );
  userIds.push(row!.id);
  return { id: row!.id, telegramId };
}

async function mkGen(
  userId: string,
  o: { tool?: string; topic?: string; status?: string; format?: string; fileVersion?: number; docVersion?: number } = {},
): Promise<string> {
  const id = randomUUID();
  await query(
    `INSERT INTO generations (id, user_id, tool_id, topic, status, format, file_name, file_version, doc_version)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [id, userId, o.tool ?? "slide", o.topic ?? "Quyosh tizimi", o.status ?? "COMPLETED", o.format ?? "pptx", "Quyosh tizimi.pptx", o.fileVersion ?? 1, o.docVersion ?? 1],
  );
  return id;
}

/* ───────────────────────────── stubs ───────────────────────────── */

type Call = { method: string; json?: Record<string, unknown>; form?: Record<string, unknown> };
type Reply = Record<string, unknown> | ((c: Call) => Record<string, unknown>);

let fileSeq = 0;
/** Default Bot API answer: a sent message carrying a fresh file_id in the uploaded/resent field. */
function okMessage(c: Call): Record<string, unknown> {
  if (c.method === "savePreparedInlineMessage") return { ok: true, result: { id: `prep-${++fileSeq}`, expiration_date: 1_900_000_000 } };
  const field = c.method === "sendAudio" ? "audio" : "document";
  const given = c.json?.[field];
  const fileId = typeof given === "string" ? given : `FILE-${++fileSeq}`;
  return { ok: true, result: { message_id: fileSeq, [field]: { file_id: fileId, file_unique_id: `U-${fileId}`, file_size: 4096 } } };
}

function harness(o: { replies?: Reply[]; file?: Partial<Produced>; now?: Date; produceDelayMs?: number } = {}) {
  const calls: Call[] = [];
  const produced: { genId: string; userId: string; format: string }[] = [];
  const replies = [...(o.replies ?? [])];
  let now = o.now ?? new Date("2026-10-04T10:00:00.000Z");
  const fetchStub = (async (url: string | URL, init?: RequestInit) => {
    const m = /^https:\/\/api\.telegram\.org\/bot([^/]+)\/(\w+)$/.exec(String(url));
    assert.ok(m, `unexpected URL ${url}`);
    assert.equal(m[1], TOKEN);
    const c: Call = { method: m[2] };
    if (init?.body instanceof FormData) {
      c.form = Object.fromEntries(
        [...init.body.entries()].map(([k, v]) => [k, typeof v === "string" ? v : { name: (v as File).name, type: v.type, size: v.size }]),
      );
    } else c.json = JSON.parse(String(init?.body));
    calls.push(c);
    const next = replies.shift() ?? okMessage;
    const body = typeof next === "function" ? next(c) : next;
    return new Response(JSON.stringify(body));
  }) as typeof fetch;
  const deps: Deps = {
    fetch: fetchStub,
    now: () => now,
    produce: async (genId, userId, format) => {
      produced.push({ genId, userId, format });
      if (o.produceDelayMs) await new Promise((r) => setTimeout(r, o.produceDelayMs));
      return {
        bytes: Buffer.alloc(4096, 7),
        fileName: "Quyosh tizimi.pptx",
        mime: PPTX,
        fileVersion: 1,
        ...o.file,
      };
    },
  };
  return { deps, calls, produced, advance: (ms: number) => (now = new Date(now.getTime() + ms)) };
}

async function cached(genId: string, format = "native") {
  return queryOne<{ file_id: string; file_version: number; media: string; saves: number; shares: number; saved_at: Date | null; file_unique_id: string | null }>(
    "SELECT file_id, file_version, media, saves, shares, saved_at, file_unique_id FROM telegram_files WHERE generation_id = $1 AND format = $2",
    [genId, format],
  );
}

async function rejectsWith(p: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(p, (e: unknown) => {
    assert.ok(e instanceof TelegramFileError, `TelegramFileError expected, got ${e}`);
    assert.equal((e as InstanceType<typeof TelegramFileError>).code, code);
    return true;
  });
}

/* ───────────────────────────── save ───────────────────────────── */

test("first save: one multipart upload into the user's own chat; file_id cached per (gen, format, version)", { skip }, async () => {
  const u = await mkUser();
  const gen = await mkGen(u.id, { topic: "Quyosh <tizimi> & \"yo‘ldoshlar\"" });
  const h = harness();
  assert.deepEqual(await saveToBot(gen, u, "native", h.deps), { duplicate: false, uploaded: true });

  assert.deepEqual(h.produced, [{ genId: gen, userId: u.id, format: "native" }]);
  assert.equal(h.calls.length, 1);
  const c = h.calls[0];
  assert.equal(c.method, "sendDocument");
  assert.deepEqual(c.form, {
    chat_id: u.telegramId,
    document: { name: "Quyosh tizimi.pptx", type: PPTX, size: 4096 },
    caption: "<b>Quyosh &lt;tizimi&gt; &amp; &quot;yo‘ldoshlar&quot;</b>\nSlayd · SlaydX yordamida tayyorlandi",
    parse_mode: "HTML",
    reply_markup: JSON.stringify({ inline_keyboard: [[{ text: "SlaydX'da ochish", url: "https://t.me/slaydx_test_bot" }]] }),
    disable_content_type_detection: "true",
  });
  const row = await cached(gen);
  assert.ok(row);
  assert.equal(row.file_id, "FILE-" + fileSeq);
  assert.equal(row.file_unique_id, `U-${row.file_id}`);
  assert.equal(row.file_version, 1);
  assert.equal(row.media, "document");
  assert.equal(row.saves, 1);
  assert.equal(row.saved_at?.toISOString(), "2026-10-04T10:00:00.000Z");
});

test("second save after the debounce window: JSON resend by file_id, no bytes, no produce", { skip }, async () => {
  const u = await mkUser();
  const gen = await mkGen(u.id);
  const h = harness();
  await saveToBot(gen, u, "native", h.deps);
  const fileId = (await cached(gen))!.file_id;
  h.advance(SAVE_DEBOUNCE_MS + 1);
  assert.deepEqual(await saveToBot(gen, u, "native", h.deps), { duplicate: false, uploaded: false });

  assert.equal(h.produced.length, 1, "bytes produced only for the first upload");
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[1].method, "sendDocument");
  assert.equal(h.calls[1].form, undefined, "resend is JSON");
  assert.equal(h.calls[1].json!.document, fileId);
  assert.equal(h.calls[1].json!.chat_id, u.telegramId);
  assert.equal(h.calls[1].json!.parse_mode, "HTML");
  assert.equal((await cached(gen))!.saves, 2);
});

test("a tap within the debounce window: duplicate, nothing sent", { skip }, async () => {
  const u = await mkUser();
  const gen = await mkGen(u.id);
  const h = harness();
  await saveToBot(gen, u, "native", h.deps);
  h.advance(SAVE_DEBOUNCE_MS - 1_000);
  assert.deepEqual(await saveToBot(gen, u, "native", h.deps), { duplicate: true, uploaded: false });
  assert.equal(h.calls.length, 1);
  assert.equal((await cached(gen))!.saves, 1);
});

test("parallel double tap: one upload, the second request joins it (duplicate)", { skip }, async () => {
  const u = await mkUser();
  const gen = await mkGen(u.id);
  // Slow bytes: both requests are past their DB read before the first upload lands,
  // so only the in-process single-flight can stop the second upload.
  const h = harness({ produceDelayMs: 100 });
  const [a, b] = await Promise.all([saveToBot(gen, u, "native", h.deps), saveToBot(gen, u, "native", h.deps)]);
  assert.deepEqual([a, b].map((r) => r.duplicate).sort(), [false, true]);
  assert.equal(h.calls.length, 1);
  assert.equal(h.produced.length, 1);
});

test("file_version bump (edited + re-rendered): re-upload, row overwritten with the new version", { skip }, async () => {
  const u = await mkUser();
  const gen = await mkGen(u.id);
  const h = harness();
  await saveToBot(gen, u, "native", h.deps);
  const first = (await cached(gen))!.file_id;
  await query("UPDATE generations SET file_version = 2, doc_version = 2 WHERE id = $1", [gen]);
  const h2 = harness({ file: { fileVersion: 2 } });
  assert.deepEqual(await saveToBot(gen, u, "native", h2.deps), { duplicate: false, uploaded: true });
  assert.equal(h2.produced.length, 1);
  assert.ok(h2.calls[0].form, "multipart upload");
  const row = (await cached(gen))!;
  assert.equal(row.file_version, 2);
  assert.notEqual(row.file_id, first);
  assert.equal(row.saves, 2);
});

test("an edit not yet re-rendered (doc_version > file_version) on an editable tool: no stale cache hit", { skip }, async () => {
  const u = await mkUser();
  const gen = await mkGen(u.id);
  const h = harness();
  await saveToBot(gen, u, "native", h.deps);
  await query("UPDATE generations SET doc_version = 2 WHERE id = $1", [gen]);
  h.advance(SAVE_DEBOUNCE_MS + 1);
  const h2 = harness({ file: { fileVersion: 2 } });
  await saveToBot(gen, u, "native", h2.deps);
  assert.equal(h2.produced.length, 1, "produce (which re-renders) was not asked");
  assert.ok(h2.calls[0].form);
});

test("non-editable tool with doc_version > file_version still uses the cache (it never re-renders)", { skip }, async () => {
  const u = await mkUser();
  const gen = await mkGen(u.id, { tool: "podcast", format: "mp3", docVersion: 3, fileVersion: 1 });
  const h = harness({ file: { mime: "audio/mpeg", fileName: "podcast.mp3" } });
  await saveToBot(gen, u, "native", h.deps);
  assert.equal(h.calls[0].method, "sendAudio");
  assert.deepEqual(h.calls[0].form!.audio, { name: "podcast.mp3", type: "audio/mpeg", size: 4096 });
  assert.equal(h.calls[0].form!.disable_content_type_detection, undefined);
  h.advance(SAVE_DEBOUNCE_MS + 1);
  await saveToBot(gen, u, "native", h.deps);
  assert.equal(h.produced.length, 1);
  assert.equal(h.calls[1].method, "sendAudio");
  assert.equal(h.calls[1].json!.audio, (await cached(gen))!.file_id);
  assert.equal((await cached(gen))!.media, "audio");
});

test("formats are cached separately: pdf has its own row and its own upload", { skip }, async () => {
  const u = await mkUser();
  const gen = await mkGen(u.id);
  const h = harness();
  await saveToBot(gen, u, "native", h.deps);
  const hp = harness({ file: { mime: "application/pdf", fileName: "Quyosh tizimi.pdf" } });
  await saveToBot(gen, u, "pdf", hp.deps);
  assert.deepEqual(hp.produced.map((p) => p.format), ["pdf"]);
  assert.deepEqual(hp.calls[0].form!.document, { name: "Quyosh tizimi.pdf", type: "application/pdf", size: 4096 });
  assert.ok(await cached(gen, "pdf"));
  assert.notEqual((await cached(gen, "pdf"))!.file_id, (await cached(gen, "native"))!.file_id);
});

/* ─────────── M1: content that changes without a file_version bump ─────────── */

/** A producer whose bytes change on every call (new game results keep arriving). */
function growingCsv(h: ReturnType<typeof harness>): Deps {
  let players = 0;
  return {
    ...h.deps,
    produce: async (genId, userId, format) => {
      h.produced.push({ genId, userId, format });
      players += 5;
      const csv = `﻿"Ism","Ball"\r\n${Array.from({ length: players }, (_, i) => `"O'quvchi ${i + 1}","${i}"\r\n`).join("")}`;
      return { bytes: Buffer.from(csv), fileName: "Saralash-natijalar.csv", mime: "text/csv; charset=utf-8", fileVersion: 1 };
    },
  };
}

test("M1: every registry id — instant serializations never reuse a cached file_id, stored/derived ones do", { skip }, async () => {
  const { DOWNLOAD_FORMAT_IDS } = await import("../lib/downloads/formats.ts");
  const instant = ["transcript-txt", "glossary-csv", "results-csv"];
  assert.deepEqual(DOWNLOAD_FORMAT_IDS.filter((f) => !tf.reusesFileId(f)).sort(), [...instant].sort());
  const u = await mkUser();
  const gen = await mkGen(u.id, { tool: "sorting", format: "docx" });
  for (const format of DOWNLOAD_FORMAT_IDS) {
    const h = harness();
    const deps = growingCsv(h);
    assert.equal((await saveToBot(gen, u, format, deps)).uploaded, true, `${format}: first save uploads`);
    h.advance(SAVE_DEBOUNCE_MS + 1);
    const second = await saveToBot(gen, u, format, deps);
    assert.equal(second.duplicate, false, format);
    if (instant.includes(format)) {
      assert.equal(second.uploaded, true, `${format}: the second save uploads the CURRENT bytes`);
      assert.equal(h.produced.length, 2, `${format}: produced again`);
      assert.ok(h.calls[1].form, `${format}: multipart, not a resend by file_id`);
      assert.ok((h.calls[1].form!.document as { size: number }).size > (h.calls[0].form!.document as { size: number }).size, `${format}: new content`);
      assert.equal((await cached(gen, format))!.file_id, `FILE-${fileSeq}`, `${format}: row points at the new upload`);
    } else {
      assert.equal(second.uploaded, false, `${format}: resend by file_id`);
      assert.equal(h.produced.length, 1, format);
      assert.equal(h.calls[1].form, undefined, format);
    }
  }
});

test("M1: results-csv share after new results uploads the current table; the prepared message never carries the old file_id", { skip }, async () => {
  const u = await mkUser();
  const gen = await mkGen(u.id, { tool: "sorting", format: "docx" });
  const h = harness();
  const deps = growingCsv(h);
  await saveToBot(gen, u, "results-csv", deps);
  const old = (await cached(gen, "results-csv"))!.file_id;
  h.advance(60_000);
  const r = await prepareShare(gen, u, "results-csv", deps);
  assert.equal(r.uploaded, true);
  assert.deepEqual(h.calls.map((c) => c.method), ["sendDocument", "sendDocument", "savePreparedInlineMessage"]);
  const sent = (h.calls[2].json!.result as Record<string, unknown>).document_file_id;
  assert.notEqual(sent, old);
  assert.equal(sent, (await cached(gen, "results-csv"))!.file_id);
});

test("n5: an always-uploaded format is still debounced in the DB (tap within 20 s → duplicate); a failed upload frees the slot", { skip }, async () => {
  const u = await mkUser();
  const gen = await mkGen(u.id, { tool: "sorting", format: "docx" });
  const h = harness();
  const deps = growingCsv(h);
  await saveToBot(gen, u, "results-csv", deps);
  h.advance(SAVE_DEBOUNCE_MS - 1_000);
  assert.deepEqual(await saveToBot(gen, u, "results-csv", deps), { duplicate: true, uploaded: false });
  assert.equal(h.produced.length, 1, "a double tap does not upload a second copy");

  h.advance(5_000);
  const failing = harness({ replies: [{ ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" }] });
  await rejectsWith(saveToBot(gen, u, "results-csv", { ...growingCsv(failing), now: deps.now }), "bot_unreachable");
  // Nothing was delivered: an immediate retry sends.
  assert.equal((await saveToBot(gen, u, "results-csv", deps)).uploaded, true);
  assert.equal(h.produced.length, 2);
});

test("403 on upload → bot_unreachable, nothing cached", { skip }, async () => {
  const u = await mkUser();
  const gen = await mkGen(u.id);
  const h = harness({ replies: [{ ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" }] });
  await rejectsWith(saveToBot(gen, u, "native", h.deps), "bot_unreachable");
  assert.equal(await cached(gen), null);
});

test("400 chat not found (never pressed /start) → bot_unreachable; 502 → telegram_unavailable", { skip }, async () => {
  const u = await mkUser();
  const gen = await mkGen(u.id);
  await rejectsWith(
    saveToBot(gen, u, "native", harness({ replies: [{ ok: false, error_code: 400, description: "Bad Request: chat not found" }] }).deps),
    "bot_unreachable",
  );
  await rejectsWith(
    saveToBot(gen, u, "native", harness({ replies: [{ ok: false, error_code: 502, description: "Bad Gateway" }] }).deps),
    "telegram_unavailable",
  );
});

test("failed resend (403) → bot_unreachable and the debounce slot is freed (an immediate retry sends)", { skip }, async () => {
  const u = await mkUser();
  const gen = await mkGen(u.id);
  const h = harness();
  await saveToBot(gen, u, "native", h.deps);
  h.advance(SAVE_DEBOUNCE_MS + 1);
  const h2 = harness({ replies: [{ ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" }], now: new Date(Date.parse("2026-10-04T10:00:00.000Z") + SAVE_DEBOUNCE_MS + 1) });
  await rejectsWith(saveToBot(gen, u, "native", h2.deps), "bot_unreachable");
  assert.equal((await cached(gen))!.saved_at?.toISOString(), "2026-10-04T10:00:00.000Z", "saved_at restored");
  assert.deepEqual(await saveToBot(gen, u, "native", h2.deps), { duplicate: false, uploaded: false });
  assert.equal(h2.calls.length, 2);
});

test("dead cached file_id (400 wrong file identifier) → re-upload and overwrite the row", { skip }, async () => {
  const u = await mkUser();
  const gen = await mkGen(u.id);
  const h = harness();
  await saveToBot(gen, u, "native", h.deps);
  const dead = (await cached(gen))!.file_id;
  h.advance(SAVE_DEBOUNCE_MS + 1);
  const h2 = harness({
    replies: [{ ok: false, error_code: 400, description: "Bad Request: wrong file identifier/HTTP URL specified" }],
    now: new Date(Date.parse("2026-10-04T10:00:00.000Z") + SAVE_DEBOUNCE_MS + 1),
  });
  assert.deepEqual(await saveToBot(gen, u, "native", h2.deps), { duplicate: false, uploaded: true });
  assert.equal(h2.calls.length, 2);
  assert.equal(h2.calls[0].json!.document, dead);
  assert.ok(h2.calls[1].form, "second call is the upload");
  assert.notEqual((await cached(gen))!.file_id, dead);
});

test("m2: a Telegram id above 2^53 → telegram_id_unsupported (buildPrepared and prepareShare), never a rounded user_id", async () => {
  const big = "9007199254740993"; // 2^53 + 1: Number() would make it ...992
  const args = {
    resultId: "r",
    kind: tf.mediaKindFor(PPTX),
    fileId: "F",
    title: "t",
    description: "d",
    presentation: { caption: "c" },
  };
  assert.throws(() => tf.buildPrepared({ ...args, telegramId: big }), (e: unknown) => (e as { code?: string }).code === "telegram_id_unsupported");
  assert.throws(() => tf.telegramUserId("12345678901234567890"), (e: unknown) => (e as { code?: string }).code === "telegram_id_unsupported");
  assert.equal(tf.buildPrepared({ ...args, telegramId: "6123456789" }).user_id, 6_123_456_789);
  assert.equal(tf.telegramUserId(String(Number.MAX_SAFE_INTEGER)), Number.MAX_SAFE_INTEGER);
  // Refused before anything is produced, uploaded or read.
  const h = harness();
  await rejectsWith(prepareShare(randomUUID(), { id: "1", telegramId: big }, "native", h.deps), "telegram_id_unsupported");
  assert.equal(h.calls.length, 0);
  assert.equal(h.produced.length, 0);
});

test("no telegram_id → no_telegram before any DB/Bot/produce work; foreign or unfinished generation", { skip }, async () => {
  const owner = await mkUser();
  const stranger = await mkUser();
  const local = await mkUser(false);
  const gen = await mkGen(owner.id);
  const h = harness();
  await rejectsWith(saveToBot(gen, local, "native", h.deps), "no_telegram");
  await rejectsWith(prepareShare(gen, local, "native", h.deps), "no_telegram");
  await rejectsWith(saveToBot(gen, stranger, "native", h.deps), "not_found");
  await rejectsWith(prepareShare(gen, stranger, "native", h.deps), "not_found");
  const running = await mkGen(owner.id, { status: "IN_PROGRESS" });
  await rejectsWith(saveToBot(running, owner, "native", h.deps), "not_ready");
  assert.equal(h.calls.length, 0);
  assert.equal(h.produced.length, 0);
});

test("a file above Telegram's 50 MB upload limit → too_large, no Bot API call", { skip }, async () => {
  const u = await mkUser();
  const gen = await mkGen(u.id);
  const h = harness({ file: { bytes: Buffer.alloc(50 * 1024 * 1024 + 1) } });
  await rejectsWith(saveToBot(gen, u, "native", h.deps), "too_large");
  assert.equal(h.calls.length, 0);
});

test("generation deleted → its telegram_files rows go with it (FK cascade)", { skip }, async () => {
  const u = await mkUser();
  const gen = await mkGen(u.id);
  await saveToBot(gen, u, "native", harness().deps);
  assert.ok(await cached(gen));
  await query("DELETE FROM generations WHERE id = $1", [gen]);
  assert.equal(await cached(gen), null);
});

/* ───────────────────────────── share ───────────────────────────── */

test("share without a cached file: upload into the user's chat, then savePreparedInlineMessage (users/groups/channels, no bots)", { skip }, async () => {
  const u = await mkUser();
  const gen = await mkGen(u.id, { topic: "Fotosintez <jarayoni>" });
  const h = harness();
  const r = await prepareShare(gen, u, "native", h.deps);
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[0].method, "sendDocument");
  assert.equal(h.calls[0].form!.chat_id, u.telegramId, "share implies save: uploaded into the user's own chat");
  const fileId = (await cached(gen))!.file_id;
  const p = h.calls[1];
  assert.equal(p.method, "savePreparedInlineMessage");
  const resultId = (p.json!.result as { id: string }).id;
  assert.ok(Buffer.byteLength(resultId) >= 1 && Buffer.byteLength(resultId) <= 64);
  assert.deepEqual(p.json, {
    user_id: Number(u.telegramId),
    result: {
      type: "document",
      id: resultId,
      document_file_id: fileId,
      caption: "<b>Fotosintez &lt;jarayoni&gt;</b>\nSlayd · SlaydX yordamida tayyorlandi",
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: [[{ text: "SlaydX'da ochish", url: "https://t.me/slaydx_test_bot" }]] },
      title: "Fotosintez <jarayoni>",
      description: "Slayd",
    },
    allow_user_chats: true,
    allow_bot_chats: false,
    allow_group_chats: true,
    allow_channel_chats: true,
  });
  assert.deepEqual(r, { preparedId: `prep-${fileSeq}`, expiresAt: new Date(1_900_000_000 * 1000).toISOString(), uploaded: true });
  const row = (await cached(gen))!;
  assert.equal(row.shares, 1);
  assert.equal(row.saves, 1);
});

test("share with a cached file: no upload, a fresh prepared id per call", { skip }, async () => {
  const u = await mkUser();
  const gen = await mkGen(u.id);
  const h = harness();
  await saveToBot(gen, u, "native", h.deps);
  const a = await prepareShare(gen, u, "native", h.deps);
  const b = await prepareShare(gen, u, "native", h.deps);
  assert.deepEqual(h.calls.map((c) => c.method), ["sendDocument", "savePreparedInlineMessage", "savePreparedInlineMessage"]);
  assert.equal(h.produced.length, 1);
  assert.notEqual(a.preparedId, b.preparedId);
  assert.equal(a.uploaded, false);
  const ids = h.calls.slice(1).map((c) => (c.json!.result as { id: string }).id);
  assert.notEqual(ids[0], ids[1], "inline result ids are unique per call");
  assert.equal((await cached(gen))!.shares, 2);
});

test("share of audio: InlineQueryResultCachedAudio (no title field)", { skip }, async () => {
  const u = await mkUser();
  const gen = await mkGen(u.id, { tool: "podcast", format: "mp3" });
  const h = harness({ file: { mime: "audio/mpeg", fileName: "podcast.mp3" } });
  await prepareShare(gen, u, "native", h.deps);
  const result = h.calls[1].json!.result as Record<string, unknown>;
  assert.equal(result.type, "audio");
  assert.equal(result.audio_file_id, (await cached(gen))!.file_id);
  assert.equal(result.title, undefined);
  assert.equal(result.document_file_id, undefined);
});

test("share refused (400, e.g. inline mode off) → share_unavailable; 403 → bot_unreachable; 5xx → telegram_unavailable", { skip }, async () => {
  const u = await mkUser();
  const gen = await mkGen(u.id);
  await saveToBot(gen, u, "native", harness().deps);
  await rejectsWith(
    prepareShare(gen, u, "native", harness({ replies: [{ ok: false, error_code: 400, description: "Bad Request: BOT_INLINE_DISABLED" }] }).deps),
    "share_unavailable",
  );
  await rejectsWith(
    prepareShare(gen, u, "native", harness({ replies: [{ ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" }] }).deps),
    "bot_unreachable",
  );
  await rejectsWith(
    prepareShare(gen, u, "native", harness({ replies: [{ ok: false, error_code: 500, description: "Internal Server Error" }] }).deps),
    "telegram_unavailable",
  );
  assert.equal((await cached(gen))!.shares, 0, "failed shares are not counted");
});

test("share with a dead cached file_id: re-upload once, then prepare again", { skip }, async () => {
  const u = await mkUser();
  const gen = await mkGen(u.id);
  await saveToBot(gen, u, "native", harness().deps);
  const dead = (await cached(gen))!.file_id;
  const h = harness({ replies: [{ ok: false, error_code: 400, description: "Bad Request: wrong file identifier/HTTP URL specified" }] });
  const r = await prepareShare(gen, u, "native", h.deps);
  assert.deepEqual(h.calls.map((c) => c.method), ["savePreparedInlineMessage", "sendDocument", "savePreparedInlineMessage"]);
  const fresh = (await cached(gen))!.file_id;
  assert.notEqual(fresh, dead);
  assert.equal((h.calls[2].json!.result as Record<string, unknown>).document_file_id, fresh);
  assert.equal(r.uploaded, true);
});

/* ───────────────────────────── pure ───────────────────────────── */

test("caption: user title escaped, long titles cut, visible length far below 1024", () => {
  assert.equal(
    buildCaption("A & B <i>x</i> \"q\"", "Referat"),
    "<b>A &amp; B &lt;i&gt;x&lt;/i&gt; &quot;q&quot;</b>\nReferat · SlaydX yordamida tayyorlandi",
  );
  const long = buildCaption("&".repeat(5000), "Kurs ishi");
  const visible = long.replace(/<\/?b>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
  assert.ok(Array.from(visible).length <= CAPTION_LIMIT, `visible caption ${Array.from(visible).length}`);
  assert.match(long, /…<\/b>/);
  assert.equal(buildCaption("   ", "Slayd"), "<b>SlaydX</b>\nSlayd · SlaydX yordamida tayyorlandi");
});

test("bot link: plain https://t.me/<bot>, none for an empty or malformed username", () => {
  assert.equal(tf.botChatUrl("@SlaydX_bot"), "https://t.me/SlaydX_bot");
  assert.equal(tf.botChatUrl(""), null);
  assert.equal(tf.botChatUrl("bad name/../x"), null);
  assert.equal(tf.backLinkMarkup(null), undefined);
});

test("media kind: mp3 → audio, everything else (images included) → document", () => {
  assert.equal(tf.mediaKindFor("audio/mpeg").method, "sendAudio");
  for (const m of [PPTX, "application/pdf", "image/png", "image/jpeg", "application/zip", "text/csv; charset=utf-8", "audio/wav"]) {
    assert.equal(tf.mediaKindFor(m).method, "sendDocument", m);
  }
});
