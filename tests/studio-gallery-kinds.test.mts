import "./helpers/next-request.mts";
import test, { after, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createIsolatedDb } from "./helpers/isolated-db.mts";
import { inRequest } from "./helpers/next-request.mts";

/**
 * Studio gallery kinds (docs/studio/P11-SPEC.md §D, `lib/server/media/public.ts`): the «Montaj», «Transkripsiya» and
 * «Dublyaj» results are gallery items, each item carries its `kind`, and `?kind=` lists one kind — on a real Postgres.
 *
 * Locked here:
 *   - kinds: a Rasm job is `image`; a Video job, a «Montaj» MP4, a dubbed MP4 and a burned transcript are `video`; a
 *     speech, an Audio result, a «Montaj» MP3 and a dubbed MP3 are `audio`; a transcript without a burn is `text` with its
 *     excerpt and language; a «Montaj» is labelled «Montaj»;
 *   - `?kind=` narrows to that kind and keeps the order and the keyset cursor; an unknown kind is a 400;
 *   - OWNERSHIP in SQL: another user's results of the new tools never appear, whatever the filter;
 *   - the star takes a «Montaj» / «Transkripsiya» / «Dublyaj» result (they are gallery items now).
 *
 * Mutations (each turned the named test red, then restored):
 *   `KIND_SQL` without the `doc_json ? 'video'` branch (mix / dub MP4 → audio)   -> «kinds»;
 *   the kind filter `($7::text IS NULL OR g.kind = $7)` removed                  -> «filter»;
 *   `parseGalleryKind` accepting any string                                      -> «filter» (the 400);
 *   `STUDIO_GALLERY_TOOLS` without `studio-mix`                                  -> «kinds» (the mix is missing), «star»;
 *   the inner `user_id = $1` dropped                                             -> «ownership».
 */

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("studiokinds") : { isolated: false, drop: async () => {} };
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

let seq = 0;
async function mkUser(): Promise<string> {
  const { query } = await db();
  return String((await query<{ id: string }>("INSERT INTO users (username, name) VALUES ($1, 'Kinds') RETURNING id", [`kinds-${process.pid}-${seq++}`]))[0]!.id);
}
async function cookieOf(userId: string): Promise<string> {
  const { createSession, SESSION_COOKIE } = await import("../lib/server/session.ts");
  return `${SESSION_COOKIE}=${(await createSession(userId)).token}`;
}
async function gen(userId: string, tool: string, doc: Record<string, unknown>, minutesAgo: number, format = "mp4"): Promise<string> {
  const { query } = await db();
  const id = randomUUID();
  await query(
    `INSERT INTO generations (id, user_id, tool_id, topic, status, price, format, doc_json, created_at)
     VALUES ($1, $2, $3, $4, 'COMPLETED', 500, $5, $6::jsonb, now() - $7::int * interval '1 minute')`,
    [id, userId, tool, `T ${seq++}`, format, JSON.stringify(doc), minutesAgo],
  );
  return id;
}
const video = (model: string, prompt = "p") => ({ provider: "x", prompt, aspect: "16:9", requestedSeconds: 5, seconds: 5, fromImage: false, model });
const imageDoc = (id: string) => ({ imageModel: "google/nano-banana", imagePrompt: "rasm", images: [{ id: "a", url: `/api/generations/${id}/assets/abc123`, w: 1, h: 1 }] });

type Item = { id: string; kind: string; favorite: boolean; modelLabel: string | null; text: { excerpt: string; language: string | null } | null; video: unknown; audio: unknown };
type Page = { items: Item[]; nextCursor: string | null };
async function gallery(cookie: string, query = ""): Promise<{ status: number; page: Page }> {
  const route = await import("../app/api/media/gallery/route.ts");
  const req = new Request(`http://localhost/api/media/gallery${query}`, { headers: { cookie } });
  const r = await inRequest(req, () => route.GET(req));
  return { status: r.status, page: (await r.json()) as Page };
}
async function star(cookie: string, id: string): Promise<number> {
  const route = await import("../app/api/media/favorites/[id]/route.ts");
  const req = new Request(`http://localhost/api/media/favorites/${id}`, { method: "PUT", headers: { cookie } });
  return (await inRequest(req, () => route.PUT(req, { params: Promise.resolve({ id }) }))).status;
}

/** Nine results of one user, oldest last: every tool and output the gallery lists. */
async function seed(me: string) {
  const image = await gen(me, "studio-image", {}, 1, "png");
  const { query } = await db();
  await query("UPDATE generations SET doc_json = $2::jsonb WHERE id = $1", [image, JSON.stringify(imageDoc(image))]);
  const clip = await gen(me, "studio-video", { video: video("kling/kling-3", "tong") }, 2);
  const speech = await gen(me, "studio-speech", { speech: { model: "elevenlabs/eleven-v3", seconds: 4, chars: 10, voices: ["A"], lines: [], clone: false } }, 3, "mp3");
  const music = await gen(me, "studio-audio", { studioAudio: { mode: "music", model: "elevenlabs/music", seconds: 30, prompt: "kuy", inputSeconds: null, voices: [], clone: false, variants: [] } }, 4, "mp3");
  const mixMp4 = await gen(me, "studio-mix", { mix: { mode: "video-voice", output: "mp4", seconds: 5, sources: [clip, speech], options: {} }, video: video("studio/mix-video", "Videoga ovoz") }, 5);
  const mixMp3 = await gen(me, "studio-mix", { mix: { mode: "voice-music", output: "mp3", seconds: 4, sources: [speech, music], options: {} } }, 6, "mp3");
  const dubMp4 = await gen(me, "studio-dub", { dub: { model: "elevenlabs/dubbing", source: "result", sourceId: clip, sourceKind: "video", sourceSeconds: 5, target: "ru", sourceLang: "auto", output: "mp4", seconds: 5 }, video: video("elevenlabs/dubbing", "Dublyaj") }, 7);
  const dubMp3 = await gen(me, "studio-dub", { dub: { model: "elevenlabs/dubbing", source: "result", sourceId: speech, sourceKind: "audio", sourceSeconds: 4, target: "ru", sourceLang: "auto", output: "mp3", seconds: 4 } }, 8, "mp3");
  const burned = await gen(me, "studio-transcribe", { transcribe: { model: "elevenlabs/scribe-v2", source: "result", sourceId: clip, sourceKind: "video", sourceSeconds: 5, requestedLanguage: "auto", language: "uz", speakers: false, burned: true, output: "mp4", text: "Salom", cues: [] }, video: video("elevenlabs/scribe-v2", "Subtitrli video") }, 9);
  const text = await gen(me, "studio-transcribe", { transcribe: { model: "elevenlabs/scribe-v2", source: "result", sourceId: speech, sourceKind: "audio", sourceSeconds: 4, requestedLanguage: "auto", language: "uz", speakers: false, burned: false, output: "txt", text: `Assalomu alaykum,  oʻrtoqlar. ${"x".repeat(400)}`, cues: [] } }, 10, "txt");
  return { image, clip, speech, music, mixMp4, mixMp3, dubMp4, dubMp3, burned, text };
}

test("kinds: image / video / audio / text by tool and output; the mix is labelled; the transcript carries its excerpt", { skip: skipDb }, async (t) => {
  quiet(t);
  const me = await mkUser();
  const s = await seed(me);
  const { page } = await gallery(await cookieOf(me));
  const kinds = Object.fromEntries(page.items.map((i) => [i.id, i.kind]));
  assert.equal(page.items.length, 10, "every result of every tool is listed");
  assert.equal(kinds[s.image], "image");
  assert.equal(kinds[s.clip], "video");
  assert.equal(kinds[s.speech], "audio");
  assert.equal(kinds[s.music], "audio");
  assert.equal(kinds[s.mixMp4], "video", "MUTATSIYA: a «Montaj» MP4 is a clip");
  assert.equal(kinds[s.mixMp3], "audio");
  assert.equal(kinds[s.dubMp4], "video");
  assert.equal(kinds[s.dubMp3], "audio");
  assert.equal(kinds[s.burned], "video", "a burned transcript is a clip");
  assert.equal(kinds[s.text], "text");
  const mix = page.items.find((i) => i.id === s.mixMp4)!;
  assert.equal(mix.modelLabel, "Montaj");
  assert.ok(mix.video, "the mix plays as a clip");
  // Only the three tools that can hold one look inside the document: a stray `video` key does not make a speech a clip.
  const stray = await gen(me, "studio-speech", { speech: { model: "x", seconds: 2 }, video: video("x") }, 90, "mp3");
  assert.equal((await gallery(await cookieOf(me), "?kind=audio")).page.items.some((i) => i.id === stray), true, "MUTATSIYA: `doc_json ? 'video'` on every tool");
  const derived = (id: string) => (page.items.find((i) => i.id === id)!.video as { derived: boolean }).derived;
  assert.equal(derived(s.clip), false, "a Video tab clip re-opens in its form");
  for (const id of [s.mixMp4, s.dubMp4, s.burned]) assert.equal(derived(id), true, "MUTATSIYA: another tool's clip has nothing to re-open");
  const text = page.items.find((i) => i.id === s.text)!;
  assert.ok(text.text);
  assert.equal(text.text!.language, "uz");
  assert.ok(text.text!.excerpt.startsWith("Assalomu alaykum, oʻrtoqlar."), "whitespace runs collapsed");
  assert.equal(text.text!.excerpt.length, 280, "cut to the excerpt length with an ellipsis");
  assert.ok(text.text!.excerpt.endsWith("…"));
  assert.equal(text.video, null);
  assert.equal(text.audio, null);
  const dubMp3 = page.items.find((i) => i.id === s.dubMp3)!;
  assert.deepEqual((dubMp3.audio as { seconds: number }).seconds, 4, "the dubbed MP3's length from `doc.dub`");
  assert.equal(dubMp3.modelLabel, "Dublyaj");
});

test("filter: ?kind= lists one kind in order with the keyset cursor; an unknown kind is a 400", { skip: skipDb }, async (t) => {
  quiet(t);
  const me = await mkUser();
  const s = await seed(me);
  const cookie = await cookieOf(me);
  const of = async (kind: string) => (await gallery(cookie, `?kind=${kind}`)).page.items.map((i) => i.id);
  assert.deepEqual(await of("video"), [s.clip, s.mixMp4, s.dubMp4, s.burned], "MUTATSIYA: the filter ignored lists everything");
  assert.deepEqual(await of("audio"), [s.speech, s.music, s.mixMp3, s.dubMp3]);
  assert.deepEqual(await of("text"), [s.text]);
  assert.deepEqual(await of("image"), [s.image]);
  assert.equal((await gallery(cookie, "?kind=podcast")).status, 400, "MUTATSIYA: an unknown kind must be refused");
  assert.equal((await gallery(cookie, "?kind=")).page.items.length, 10, "an empty kind is no filter");
  // Paging inside a kind: 30 more clips → 24 + 10 of the 34 videos, the second page continues the filtered list.
  for (let i = 0; i < 30; i++) await gen(me, "studio-video", { video: video("kling/kling-3") }, 20 + i);
  const p1 = (await gallery(cookie, "?kind=video")).page;
  assert.equal(p1.items.length, 24);
  assert.ok(p1.items.every((i) => i.kind === "video"));
  assert.ok(p1.nextCursor);
  const p2 = (await gallery(cookie, `?kind=video&cursor=${encodeURIComponent(p1.nextCursor!)}`)).page;
  assert.equal(p2.items.length, 10);
  assert.ok(p2.items.every((i) => i.kind === "video"));
  assert.equal(p2.nextCursor, null);
  // Favorites and a kind combine.
  assert.equal(await star(cookie, s.mixMp4), 200);
  assert.deepEqual((await gallery(cookie, "?kind=video&favorites=1")).page.items.map((i) => i.id), [s.mixMp4]);
});

test("ownership: another user's mix / dub / transcript never appears, whatever the filter", { skip: skipDb }, async (t) => {
  quiet(t);
  const me = await mkUser();
  const other = await mkUser();
  await seed(other);
  const mine = await gen(me, "studio-mix", { mix: { mode: "voice-music", output: "mp3", seconds: 4, sources: [randomUUID(), randomUUID()], options: {} } }, 1, "mp3");
  const cookie = await cookieOf(me);
  for (const q of ["", "?kind=video", "?kind=audio", "?kind=text", "?favorites=1"]) {
    const ids = (await gallery(cookie, q)).page.items.map((i) => i.id);
    assert.ok(ids.every((id) => id === mine), `${q || "all"}: MUTATSIYA: only my rows`);
  }
  assert.deepEqual((await gallery(cookie, "?kind=audio")).page.items.map((i) => i.id), [mine]);
});

test("star: a Montaj, a Dublyaj and a Transkripsiya result take the star; the gallery reads it back", { skip: skipDb }, async (t) => {
  quiet(t);
  const me = await mkUser();
  const s = await seed(me);
  const cookie = await cookieOf(me);
  for (const id of [s.mixMp4, s.mixMp3, s.dubMp4, s.text]) assert.equal(await star(cookie, id), 200, `MUTATSIYA: star ${id}`);
  const { page } = await gallery(cookie, "?favorites=1");
  assert.deepEqual(page.items.map((i) => i.id), [s.mixMp4, s.mixMp3, s.dubMp4, s.text]);
});
