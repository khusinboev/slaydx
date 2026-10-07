import "./helpers/next-request.mts"; // AsyncLocalStorage before `next/*`
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";

/**
 * T4 (docs/todo-2026-10-07/PLAN.md): the format picked in the «Saqlash» /
 * «Ulashish» sheet is the file the server uploads and shares. Through the real
 * route handler (session cookie, ownership in SQL, `formatById` validation,
 * real `telegram_files` cache) with an injected producer and a stubbed Bot API
 * (fake token, nothing leaves the machine):
 *
 *   - every format the sheet lists for a slide / resume / podcast / image /
 *     glossary: `{format}` → exactly that format produced and uploaded (file
 *     name, mime, document vs audio), the copy's «📤 Ulashish» button names it,
 *     the answer echoes it; one cache row per (generation, format), each with
 *     its own `file_id`;
 *   - share `{format}` after save `{format}`: no new upload, the prepared
 *     message carries THAT format's `file_id` (pdf ≠ native — differential);
 *   - a format the sheet does not list for that material → 400 unsupported,
 *     nothing produced or sent.
 *
 * Mutations (each turned a test red, see the T4 report): the route ignoring
 * `body.format` (always `defaultShareFormat`); `prepareShare` looking up the
 * native row's `file_id` for every format.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.TELEGRAM_BOT_TOKEN = "123456:FAKE-format-choice-token-never-sent";
process.env.NEXT_PUBLIC_TELEGRAM_BOT = "slaydx_test_bot";
const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";
const skip = hasDb ? false : "Postgres kerak (DATABASE_URL)";

const { inRequest } = await import("./helpers/next-request.mts");
const { query, queryOne, pool, ensureMigrated } = await import("../lib/server/db.ts");
const { createSession, SESSION_COOKIE } = await import("../lib/server/session.ts");
const { telegramActionHandler } = await import("../app/api/generations/[id]/telegram/action.ts");
const { shareQuery } = await import("../lib/server/telegram-files.ts");
const { downloadFormats } = await import("../lib/downloads/formats.ts");
const { pdfAvailable } = await import("../lib/server/pdf.ts");
type Deps = import("../lib/server/telegram-files.ts").TelegramFilesDeps;
if (hasDb) await ensureMigrated();

// The registry offers PDF / slide images only with LibreOffice; nothing is converted here (the producer is injected).
const prevBin = process.env.SOFFICE_BIN;
before(() => {
  if (!pdfAvailable()) process.env.SOFFICE_BIN = process.execPath;
});

const userIds: string[] = [];
after(async () => {
  if (prevBin === undefined) delete process.env.SOFFICE_BIN;
  else process.env.SOFFICE_BIN = prevBin;
  if (!hasDb) return;
  if (userIds.length) {
    await query("DELETE FROM rate_limits WHERE bucket = ANY($1::text[])", [userIds.flatMap((id) => [`tgsave:${id}`, `tgshare:${id}`, `dlprep:${id}`])]).catch(() => {});
    await query("DELETE FROM users WHERE id = ANY($1::bigint[])", [userIds]);
  }
  await pool().end();
});

type U = { id: string; telegramId: string; cookie: string };
async function mkUser(): Promise<U> {
  const telegramId = String(randomInt(6_000_000_000, 6_900_000_000));
  const row = await queryOne<{ id: string }>("INSERT INTO users (telegram_id, name) VALUES ($1, 'Format Sinov') RETURNING id::text AS id", [telegramId]);
  userIds.push(row!.id);
  const { token } = await createSession(row!.id);
  return { id: row!.id, telegramId, cookie: `${SESSION_COOKIE}=${token}` };
}

async function mkGen(userId: string, tool: string, format: string): Promise<string> {
  const id = randomUUID();
  await query(
    `INSERT INTO generations (id, user_id, tool_id, topic, status, format, file_name, file_version, doc_version)
     VALUES ($1, $2, $3, 'Suv aylanishi', 'COMPLETED', $4, $5, 1, 1)`,
    [id, userId, tool, format, `Suv aylanishi.${format}`],
  );
  return id;
}

/** What each format's producer returns (name + mime), so the upload can be told apart. */
const FILES: Record<string, { ext: string; mime: string }> = {
  "native:pptx": { ext: "pptx", mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
  "native:docx": { ext: "docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  "native:mp3": { ext: "mp3", mime: "audio/mpeg" },
  "native:png": { ext: "png", mime: "image/png" },
  pdf: { ext: "pdf", mime: "application/pdf" },
  "slides-png": { ext: "zip", mime: "application/zip" },
  jpg: { ext: "jpg", mime: "image/jpeg" },
  "transcript-txt": { ext: "txt", mime: "text/plain; charset=utf-8" },
  "glossary-csv": { ext: "csv", mime: "text/csv; charset=utf-8" },
};

type Call = { method: string; json?: Record<string, unknown>; form?: Record<string, unknown> };

/** Bot API answer ids, unique across harnesses (every upload gets its own file_id). */
let seq = 0;

function harness(stored: string) {
  const calls: Call[] = [];
  const produced: string[] = [];
  const deps: Deps = {
    fetch: (async (url: string | URL, init?: RequestInit) => {
      const method = /\/(\w+)$/.exec(String(url))![1];
      const c: Call = { method };
      if (init?.body instanceof FormData) {
        c.form = Object.fromEntries(
          [...init.body.entries()].map(([k, v]) => [k, typeof v === "string" ? v : { name: (v as File).name, type: v.type }]),
        );
      } else c.json = JSON.parse(String(init?.body));
      calls.push(c);
      if (method === "savePreparedInlineMessage") return new Response(JSON.stringify({ ok: true, result: { id: `prep-${++seq}`, expiration_date: 1_900_000_000 } }));
      const field = method === "sendAudio" ? "audio" : "document";
      const given = c.json?.[field];
      const fileId = typeof given === "string" ? given : `FILE-${++seq}`;
      return new Response(JSON.stringify({ ok: true, result: { message_id: seq, [field]: { file_id: fileId, file_unique_id: `U-${fileId}`, file_size: 2048 } } }));
    }) as typeof fetch,
    produce: async (_g, _u, format) => {
      produced.push(format);
      const f = FILES[format === "native" ? `native:${stored}` : format];
      return { bytes: Buffer.alloc(2048, 3), fileName: `Suv aylanishi.${f.ext}`, mime: f.mime, fileVersion: 1 };
    },
  };
  return { deps, calls, produced };
}

type Res = { status: number; body: Record<string, unknown> };
async function post(action: "save" | "share", deps: Deps, u: U, id: string, body: unknown): Promise<Res> {
  const req = new Request(`http://localhost:3000/api/generations/${id}/telegram/${action}`, {
    method: "POST",
    headers: { host: "localhost:3000", "content-type": "application/json", "x-forwarded-for": "10.9.8.6", cookie: u.cookie },
    body: JSON.stringify(body),
  });
  const fn = telegramActionHandler(action, deps);
  const res = await inRequest(req, () => fn(req, { params: Promise.resolve({ id }) }));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const cacheRows = (genId: string) =>
  query<{ format: string; file_id: string; media: string }>("SELECT format, file_id, media FROM telegram_files WHERE generation_id = $1 ORDER BY format", [genId]);

const MATERIALS: { tool: string; format: string }[] = [
  { tool: "slide", format: "pptx" },
  { tool: "resume", format: "docx" },
  { tool: "podcast", format: "mp3" },
  { tool: "image", format: "png" },
  { tool: "glossary", format: "docx" },
];

test("save {format}: every format the sheet lists is produced, uploaded and cached as ITSELF; the «📤 Ulashish» button names it", { skip }, async () => {
  const u = await mkUser();
  for (const m of MATERIALS) {
    const gen = await mkGen(u.id, m.tool, m.format);
    const offered = downloadFormats({ type: m.tool, format: m.format }, { pdf: true }).map((f) => f.id);
    assert.ok(offered.length > 1, `${m.tool}: a material with a format choice`);
    const fileIds = new Set<string>();
    for (const id of offered) {
      const h = harness(m.format);
      const r = await post("save", h.deps, u, gen, { format: id });
      assert.equal(r.status, 200, `${m.tool} ${id}: ${JSON.stringify(r.body)}`);
      assert.equal(r.body.format, id, `${m.tool}: the answer echoes ${id}`);
      assert.deepEqual(h.produced, [id], `${m.tool}: exactly ${id} produced`);
      assert.equal(h.calls.length, 1, `${m.tool} ${id}: one upload`);
      const want = FILES[id === "native" ? `native:${m.format}` : id];
      const audio = want.mime === "audio/mpeg";
      assert.equal(h.calls[0].method, audio ? "sendAudio" : "sendDocument");
      assert.deepEqual(h.calls[0].form![audio ? "audio" : "document"], { name: `Suv aylanishi.${want.ext}`, type: want.mime }, `${m.tool} ${id}: the uploaded file`);
      assert.equal(h.calls[0].form!.chat_id, u.telegramId, "into the session user's own chat");
      const markup = JSON.parse(String(h.calls[0].form!.reply_markup)) as { inline_keyboard: { switch_inline_query: string }[][] };
      assert.equal(markup.inline_keyboard[0][0].switch_inline_query, shareQuery(gen, id), `${m.tool}: «📤 Ulashish» shares ${id}`);
    }
    const rows = await cacheRows(gen);
    assert.deepEqual(rows.map((r) => r.format).sort(), [...offered].sort(), `${m.tool}: one cache row per (generation, format)`);
    for (const r of rows) fileIds.add(r.file_id);
    assert.equal(fileIds.size, offered.length, `${m.tool}: every format has its own file_id`);
  }
});

test("share {format} after save {format}: no new upload, the prepared message carries THAT format's file_id (pdf ≠ native)", { skip }, async () => {
  const u = await mkUser();
  const gen = await mkGen(u.id, "slide", "pptx");
  for (const id of ["native", "pdf", "slides-png"]) {
    const h = harness("pptx");
    assert.equal((await post("save", h.deps, u, gen, { format: id })).status, 200);
  }
  const ids = Object.fromEntries((await cacheRows(gen)).map((r) => [r.format, r.file_id]));
  assert.equal(new Set(Object.values(ids)).size, 3);
  for (const id of ["pdf", "native", "slides-png"]) {
    const h = harness("pptx");
    const r = await post("share", h.deps, u, gen, { format: id });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.format, id);
    assert.deepEqual(h.produced, [], `${id}: the cached upload is reused`);
    assert.deepEqual(h.calls.map((c) => c.method), ["savePreparedInlineMessage"]);
    const result = h.calls[0].json!.result as Record<string, unknown>;
    assert.equal(result.document_file_id, ids[id], `${id}: the prepared message carries the ${id} file`);
    assert.equal(h.calls[0].json!.user_id, Number(u.telegramId));
  }
});

test("a format the sheet does not list for this material → 400 unsupported; nothing produced or sent", { skip }, async () => {
  const u = await mkUser();
  const cases: { tool: string; format: string; bad: string }[] = [
    { tool: "resume", format: "docx", bad: "slides-png" },
    { tool: "podcast", format: "mp3", bad: "pdf" },
    { tool: "slide", format: "pptx", bad: "glossary-csv" },
    { tool: "image", format: "png", bad: "transcript-txt" },
  ];
  for (const c of cases) {
    const gen = await mkGen(u.id, c.tool, c.format);
    for (const action of ["save", "share"] as const) {
      const h = harness(c.format);
      const r = await post(action, h.deps, u, gen, { format: c.bad });
      assert.equal(r.status, 400, `${c.tool} ${action} ${c.bad}`);
      assert.equal(r.body.code, "unsupported");
      assert.deepEqual(h.produced, []);
      assert.equal(h.calls.length, 0);
    }
  }
});
