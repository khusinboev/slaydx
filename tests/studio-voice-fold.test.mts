import "./helpers/next-request.mts";
import test, { after, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createIsolatedDb } from "./helpers/isolated-db.mts";
import { inRequest } from "./helpers/next-request.mts";
import { VOICE_TEMPLATE_TOOLS, isVoiceTemplate, voiceFoldPath, voiceTemplateFromSearch } from "../lib/media/voice-templates.ts";

/**
 * Studio P8b (docs/studio/P8-SPEC.md «P8b»): «Podkast» / «Tabriknoma» as «Tayyor shablonlar» of the «Ovoz» tab while the
 * dark switch `studio.legacy_fold` is on. Server side, on a real Postgres (own isolated database):
 *
 *   - `/uz/podcast`, `/uz/greeting`: the switch off → no redirect (the tool page as before); on → the Studio «Ovoz»
 *     tab with the template, the old link's other query kept; the pages are per-request (`force-dynamic`) and the
 *     `[slug]` route no longer pre-renders these two slugs;
 *   - the gallery: switch off → a podcast / greeting result is NOT listed (exactly as before); on → listed as
 *     `kind: "audio"` (player URL, measured seconds from `doc.audio`, the tool's title as the label, the topic as the
 *     line), newest first among the Studio items; another user's podcast never; an unfinished one never;
 *   - favourites: a podcast is starrable only while the switch is on (404 off, as any non-Studio job).
 *
 * Mutations (each turned the named test red, then restored):
 *   1. `studioGalleryToolIds` ignores the switch (always adds podcast / greeting)      -> «gallery: off»;
 *   2. `studioGalleryToolIds` never adds them                                          -> «gallery: on», «favourites»;
 *   3. gallery `isAudio` without `isVoiceTemplate(r.tool_id)` (a podcast drawn as a picture) -> «gallery: on»;
 *   4. the gallery `speech` COALESCE without `doc_json->'audio'` (no seconds)         -> «gallery: on»;
 *   5. `voiceFoldTarget` answers the path while the switch is off                     -> «redirect»;
 *   6. `voiceFoldPath` drops the old query                                            -> «redirect»;
 *   7. favourites star CTE keeps the hard-coded STUDIO_GALLERY_TOOLS                  -> «favourites».
 */

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("voicefold") : { isolated: false, drop: async () => {} };
const skipDb = hasDb && iso.isolated ? false : "isolated Postgres database is not available";

const quiet = (t: TestContext) => {
  for (const m of ["log", "info", "warn", "error"] as const) t.mock.method(console, m, () => {});
};

let dbReady: Promise<void> | null = null;
async function db() {
  const mod = await import("../lib/server/db.ts");
  dbReady ??= mod.migrate();
  await dbReady;
  return mod;
}
after(async () => {
  if (!dbReady) return;
  const { pool } = await import("../lib/server/db.ts");
  await pool().end();
  await iso.drop();
});

async function setFold(on: boolean | null): Promise<void> {
  const { query } = await db();
  if (on === null) await query("DELETE FROM app_settings WHERE key = 'studio.legacy_fold'");
  else await query("INSERT INTO app_settings (key, value) VALUES ('studio.legacy_fold', $1::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [JSON.stringify(on)]);
  (await import("../lib/server/settings.ts")).invalidateSettingsCache();
}

let seq = 0;
async function mkUser(): Promise<string> {
  const { query } = await db();
  return String((await query<{ id: string }>("INSERT INTO users (username, name) VALUES ($1, 'Fold') RETURNING id", [`fold-${process.pid}-${seq++}`]))[0]!.id);
}
async function cookieOf(userId: string): Promise<string> {
  const { createSession, SESSION_COOKIE } = await import("../lib/server/session.ts");
  return `${SESSION_COOKIE}=${(await createSession(userId)).token}`;
}
async function gen(userId: string, o: { tool: string; topic?: string; status?: string; minutesAgo?: number; doc?: unknown }): Promise<string> {
  const { query } = await db();
  const id = randomUUID();
  const doc =
    o.doc ??
    (o.tool === "studio-speech"
      ? { speech: { model: "google/gemini-tts", seconds: 7, voices: ["Kore"], clone: false } }
      : { audio: { v: 1, kind: o.tool, type: "x", language: "uz", script: [], seconds: 95.4, voice: "gemini:Kore" } });
  await query(
    `INSERT INTO generations (id, user_id, tool_id, topic, status, price, format, doc_json, created_at)
     VALUES ($1, $2, $3, $4, $5, 4000, 'mp3', $6::jsonb, now() - $7::int * interval '1 minute')`,
    [id, userId, o.tool, o.topic ?? "Mavzu", o.status ?? "COMPLETED", JSON.stringify(doc), o.minutesAgo ?? 0],
  );
  return id;
}

type Item = { id: string; kind: string; prompt: string; modelLabel: string | null; modelId: string | null; images: unknown[]; video: unknown; audio: { src: string; seconds: number | null } | null; fileUrl: string };
async function gallery(cookie: string): Promise<Item[]> {
  const route = await import("../app/api/media/gallery/route.ts");
  const req = new Request("http://localhost/api/media/gallery", { headers: { cookie } });
  const r = await inRequest(req, () => route.GET(req));
  assert.equal(r.status, 200);
  return ((await r.json()) as { items: Item[] }).items;
}
async function star(cookie: string, id: string): Promise<number> {
  const route = await import("../app/api/media/favorites/[id]/route.ts");
  const req = new Request(`http://localhost/api/media/favorites/${id}`, { method: "PUT", headers: { cookie } });
  return (await inRequest(req, () => route.PUT(req, { params: Promise.resolve({ id }) }))).status;
}

test("templates: the two tools, a Studio link's template only on the «Ovoz» tab, the fold path keeps the old query", () => {
  assert.deepEqual([...VOICE_TEMPLATE_TOOLS], ["podcast", "greeting"]);
  assert.ok(isVoiceTemplate("podcast") && isVoiceTemplate("greeting") && !isVoiceTemplate("studio-speech") && !isVoiceTemplate(undefined));
  assert.equal(voiceTemplateFromSearch("?tab=ovoz&template=podcast"), "podcast");
  assert.equal(voiceTemplateFromSearch("?tab=ovoz&template=greeting"), "greeting");
  assert.equal(voiceTemplateFromSearch("?tab=video&template=podcast"), null, "only the «Ovoz» tab opens a template");
  assert.equal(voiceTemplateFromSearch("?tab=ovoz&template=image"), null);
  assert.equal(voiceTemplateFromSearch(""), null);
  assert.equal(voiceFoldPath("podcast"), "/uz/studio?tab=ovoz&template=podcast");
  assert.equal(voiceFoldPath("greeting", { bt: "abc", tab: "rasm", template: "x", m: ["1", "2"] }), "/uz/studio?tab=ovoz&template=greeting&bt=abc&m=1&m=2");
});

test("redirect: off → none (the tool page as before); on → the «Ovoz» template with the old query", { skip: skipDb }, async (t) => {
  quiet(t);
  const { voiceFoldTarget } = await import("../lib/server/media/voice-fold.ts");
  await setFold(null);
  assert.equal(await voiceFoldTarget("podcast", {}), null, "default (switch never set) = off");
  await setFold(false);
  assert.equal(await voiceFoldTarget("greeting", { bt: "x" }), null);
  await setFold(true);
  assert.equal(await voiceFoldTarget("podcast", {}), "/uz/studio?tab=ovoz&template=podcast");
  assert.equal(await voiceFoldTarget("greeting", { bt: "tok" }), "/uz/studio?tab=ovoz&template=greeting&bt=tok");
  await setFold(null);
  // The pages: per request, redirect only on a target, else the same ToolWorkspace; `[slug]` leaves both slugs to them.
  for (const id of ["podcast", "greeting"]) {
    const src = readFileSync(new URL(`../app/uz/${id}/page.tsx`, import.meta.url), "utf8");
    assert.match(src, /export const dynamic = "force-dynamic"/, id);
    assert.match(src, new RegExp(`voiceFoldTarget\\("${id}", await searchParams\\);\\s*if \\(target\\) redirect\\(target\\);\\s*return <ToolWorkspace tool=\\{TOOL_BY_SLUG\\.${id}!\\} />`), id);
  }
  const slug = readFileSync(new URL("../app/uz/[slug]/page.tsx", import.meta.url), "utf8");
  const own = /OWN_PAGE_SLUGS[^=]*=\s*\[([^\]]*)\]/.exec(slug)?.[1] ?? "";
  assert.ok(own.includes('"podcast"') && own.includes('"greeting"'), "the static pages own these slugs");
});

test("gallery: off → a podcast / greeting result is not listed (as before)", { skip: skipDb }, async (t) => {
  quiet(t);
  await setFold(false);
  const me = await mkUser();
  const cookie = await cookieOf(me);
  const speech = await gen(me, { tool: "studio-speech" });
  await gen(me, { tool: "podcast" });
  await gen(me, { tool: "greeting" });
  assert.deepEqual((await gallery(cookie)).map((i) => i.id), [speech]);
  await setFold(null);
  assert.deepEqual((await gallery(cookie)).map((i) => i.id), [speech], "the default is off too");
});

test("gallery: on → podcast / greeting as audio items, newest first; never another user's or an unfinished one", { skip: skipDb }, async (t) => {
  quiet(t);
  await setFold(true);
  const me = await mkUser();
  const other = await mkUser();
  const cookie = await cookieOf(me);
  const speech = await gen(me, { tool: "studio-speech", minutesAgo: 3 });
  const podcast = await gen(me, { tool: "podcast", topic: "Sun'iy intellekt", minutesAgo: 2 });
  const greeting = await gen(me, { tool: "greeting", topic: "Dilnoza opa", minutesAgo: 1 });
  await gen(me, { tool: "podcast", status: "IN_PROGRESS" });
  await gen(other, { tool: "podcast" });
  const items = await gallery(cookie);
  assert.deepEqual(items.map((i) => i.id), [greeting, podcast, speech]);
  const p = items.find((i) => i.id === podcast)!;
  assert.equal(p.kind, "audio");
  assert.deepEqual(p.audio, { src: `/api/generations/${podcast}/file?inline=1`, seconds: 95.4, voices: [], clone: false });
  assert.equal(p.modelLabel, "Podkast");
  assert.equal(p.modelId, null);
  assert.equal(p.prompt, "Sun'iy intellekt");
  assert.deepEqual(p.images, []);
  assert.equal(p.video, null);
  assert.equal(p.fileUrl, `/api/generations/${podcast}/file`);
  const g = items.find((i) => i.id === greeting)!;
  assert.equal(g.kind, "audio");
  assert.equal(g.modelLabel, "Tabriknoma");
  assert.equal(g.prompt, "Dilnoza opa");
  // A Studio speech item keeps its own model label.
  assert.equal(items.find((i) => i.id === speech)!.modelId, "google/gemini-tts");
  await setFold(null);
});

test("favourites: a podcast is starrable only while the switch is on", { skip: skipDb }, async (t) => {
  quiet(t);
  const me = await mkUser();
  const cookie = await cookieOf(me);
  const podcast = await gen(me, { tool: "podcast" });
  await setFold(false);
  assert.equal(await star(cookie, podcast), 404, "off: not a Studio item");
  await setFold(true);
  assert.equal(await star(cookie, podcast), 200);
  const other = await mkUser();
  assert.equal(await star(cookie, await gen(other, { tool: "greeting" })), 404, "never another user's");
  await setFold(null);
});
