import "./helpers/next-request.mts";
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomInt } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createIsolatedDb } from "./helpers/isolated-db.mts";
import { inRequest } from "./helpers/next-request.mts";

/**
 * Studio P2b — prompt library + templates (docs/studio/P2B-SPEC.md, PLAN §5.6), 2FA mode (step-up enforced).
 *
 *   pure       `fillSkeleton` (slot values, placeholders, braces stripped, tidy), `templateError` against the catalog
 *              (unknown model, a preset key the model lacks, `prompt` preset, a value the ParamSchema refuses, slot ↔
 *              skeleton mismatch, prompt length), `slotsError`;
 *   seed       every seeded template (migration 067) validates against the CURRENT catalog; 40 prompts, every category;
 *   public     `GET /api/media/library` only enabled rows, only public fields, category filter, unknown category 400;
 *              `GET /api/media/templates` only enabled + valid + model AVAILABLE now (fal key absent → fal templates
 *              hidden; admin switch off → hidden; an invalid stored row → hidden);
 *   admin      read `settings.view` (viewer 200), writes `settings.edit` (viewer 403 + denied audit; stale step-up 401
 *              reauth); reason required (400); template validated (400 `template_invalid`, nothing stored); create /
 *              update / delete each write an audit row with before / after in the same transaction; unchanged 409
 *              `state`; stale `expectedUpdatedAt` 409 `stale`; reorder (one category, sort 10/20/…, one audit row);
 *              the public read follows a write at once (cache dropped);
 *   enhance    `POST /api/media/enhance`: free (no charge), the rewrite returned, burst limit 10 / 10 min → 429.
 *
 *   kinds      (docs/studio/P11-SPEC.md «G») video / music / sfx rows, a clip template listed whichever models are on, the
 *              English seed and its «only the seeded text» rule, the kind checked against the model and the category.
 *
 * Mutations (each turned the named test(s) red, then restored) — see docs/studio/P2B-SPEC.md «Mutations»:
 *   the `AND p.prompt = v.seeded` condition removed from 076 -> "seed: the English rewrite";
 *   `publicTemplates` filters clips by their model -> "public: kinds";
 *   `templateModel` allows avatars and effects -> "admin: the kind";
 *   reorder without the `media` check -> "admin: the kind";
 *   `fillSkeleton` without `fallback` -> "pure: an empty slot" and "seed: video, music and effect rows";
 *   `templateError` validate() call removed -> "pure: templateError", "admin: template validation";
 *   public templates without the availability filter -> "public: templates";
 *   public library without `WHERE enabled` -> "public: library";
 *   audit call removed from `updatePrompt` -> "admin: prompts CRUD";
 *   `invalidateLibrary()` dropped after a write -> "admin: prompts CRUD" (public read stale);
 *   `checkExpected` disabled -> "admin: prompts CRUD" (409 stale);
 *   enhance burst bucket removed (FREE_LLM_BURST.enhance) -> "enhance".
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.APP_URL = "http://localhost:3000";
process.env.TRUST_PROXY = "true";
process.env.WORKER_INLINE = "false";
process.env.ADMIN_TOTP_KEY = randomBytes(32).toString("base64");
process.env.ADMIN_2FA_REQUIRED = "true";
process.env.GEMINI_API_KEY = "test-gemini-key";
delete process.env.OPENAI_API_KEY;
delete process.env.FAL_KEY;
const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";
const skip = hasDb ? false : "DATABASE_URL yo'q";
const iso = hasDb ? await createIsolatedDb("studiolib") : { isolated: false, drop: async () => {} };

const lib = await import("../lib/media/library.ts");
const { MEDIA_CATALOG } = await import("../lib/media/catalog.ts");
const { query, queryOne, ensureMigrated, transaction, pool } = await import("../lib/server/db.ts");
const { createSession, SESSION_COOKIE } = await import("../lib/server/session.ts");
const { createAdminSession, adminCookieName } = await import("../lib/server/admin-session.ts");
const { invalidateMediaOverrides } = await import("../lib/server/media/overrides.ts");
const { reloadProviderKeys, stopProviderKeyRefresh } = await import("../lib/server/providers/store.ts");
const { invalidateLibrary } = await import("../lib/server/media/library.ts");
const libraryRoute = await import("../app/api/media/library/route.ts");
const templatesRoute = await import("../app/api/media/templates/route.ts");
const enhanceRoute = await import("../app/api/media/enhance/route.ts");
const adminRoot = await import("../app/api/admin/studio-library/route.ts");
const adminPrompts = await import("../app/api/admin/studio-library/prompts/route.ts");
const adminPrompt = await import("../app/api/admin/studio-library/prompts/[id]/route.ts");
const adminTemplates = await import("../app/api/admin/studio-library/templates/route.ts");
const adminTemplate = await import("../app/api/admin/studio-library/templates/[id]/route.ts");
const adminReorder = await import("../app/api/admin/studio-library/reorder/route.ts");
const adminPreviews = await import("../app/api/admin/studio-library/previews/route.ts");
const adminPreview = await import("../app/api/admin/studio-library/previews/[id]/route.ts");
const previewRoute = await import("../app/api/media/library/preview/[id]/route.ts");
const { purgeUnusedPreviews } = await import("../lib/server/admin-studio-library.ts");

const REAL_FETCH = globalThis.fetch;
after(async () => {
  globalThis.fetch = REAL_FETCH;
  if (!hasDb) return;
  stopProviderKeyRefresh();
  await pool().end();
  await iso.drop();
});
if (hasDb) {
  await ensureMigrated();
  await reloadProviderKeys();
}

const REASON = "Studio kutubxonasini yangilash";
const NANO = "google/nano-banana";
const nano = MEDIA_CATALOG.byId(NANO)!;

/* ───────────────────────── pure ───────────────────────── */

test("pure: fillSkeleton fills slots, falls back to placeholders, strips braces, tidies", () => {
  const slots = [
    { name: "ism", label: "Ism", placeholder: "Dilnoza", max: 10 },
    { name: "bezak", label: "Bezak", max: 20 },
  ];
  assert.equal(lib.fillSkeleton("Tabrik, {bezak}, «{ism}»", slots, { ism: "Aziza", bezak: "sharlar" }), "Tabrik, sharlar, «Aziza»");
  assert.equal(lib.fillSkeleton("Tabrik, {bezak}, «{ism}»", slots, {}), "Tabrik, «Dilnoza»", "empty slot: placeholder, else nothing (commas tidied)");
  assert.equal(lib.fillSkeleton("{ism}", slots, { ism: "{bezak} uzun-uzun-ism" }), "bezak uzun", "no slot injection, clipped to max");
  assert.deepEqual(lib.skeletonSlots("{a} {b} {a} {Bad}"), ["a", "b"]);
  assert.equal(lib.fillSkeleton("{ism} reklamasi, {bezak}", slots, { ism: "qahva" }), "qahva reklamasi", "no dangling separator at the end");
});

test("pure: templateError against the catalog", () => {
  const ok = { modelId: NANO, params: { imageRatio: "16:9", imageCount: 2 }, skeleton: "{mavzu} rasmi", slots: [{ name: "mavzu", label: "Mavzu", max: 40 }] };
  assert.equal(lib.templateError(ok, nano), null);
  assert.match(String(lib.templateError(ok, null)), /Studio'da yo'q/);
  assert.match(String(lib.templateError({ ...ok, params: { quality: "high" } }, nano)), /«quality» parametri bu modelda yo'q/);
  assert.match(String(lib.templateError({ ...ok, params: { prompt: "x" } }, nano)), /skeletda yoziladi/);
  assert.match(String(lib.templateError({ ...ok, params: { imageRatio: "7:5" } }, nano)), /O'lcham: noma'lum qiymat/);
  assert.match(String(lib.templateError({ ...ok, params: { imageCount: 9 } }, nano)), /Soni: 1–4/);
  assert.match(String(lib.templateError({ ...ok, skeleton: "{mavzu} va {fon}" }, nano)), /\{fon\} slot sifatida e'lon qilinmagan/);
  assert.match(String(lib.templateError({ ...ok, skeleton: "rasm chizing" }, nano)), /«mavzu» sloti skeletda ishlatilmagan/);
  assert.match(String(lib.templateError({ ...ok, skeleton: "{mavzu}", slots: [{ name: "mavzu", label: "M", max: 10 }] }, nano)), /juda qisqa/);
  assert.match(String(lib.templateError({ ...ok, skeleton: `${"a".repeat(490)} {mavzu}`, slots: [{ name: "mavzu", label: "M", max: 50 }] }, nano)), /oshib ketadi/);
  // Review NIT-6: a brace that is not a well-formed slot never reaches the model as literal text.
  for (const sk of ["{Mavzu} rasmi {mavzu}", "{mavzu} rasmi {", "{mavzu} rasmi {}", "{mavzu} rasmi }"]) {
    assert.match(String(lib.templateError({ ...ok, skeleton: sk }, nano)), /noto'g'ri \{…\} belgisi/, sk);
  }
  assert.match(String(lib.slotsError([{ name: "Bad", label: "x", max: 20 }])), /nomi noto'g'ri/);
  assert.match(String(lib.slotsError([{ name: "a", label: "x", max: 20 }, { name: "a", label: "y", max: 20 }])), /takrorlangan/);
  assert.match(String(lib.slotsError([{ name: "a", label: "x", max: 5 }])), /uzunligi/);
});

/* ───────────────────────── DB ───────────────────────── */

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
async function mkUser(balance = 0) {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO users (telegram_id, username, name, points, quota, balance) VALUES ($1, $2, 'Lib', 0, 0, $3) RETURNING id::text AS id`,
    [String(randomInt(5_000_000_000, 9_000_000_000)), `l_${randomBytes(5).toString("hex")}`, balance],
  );
  const { token } = await createSession(row!.id);
  return { id: row!.id, token };
}
async function session(role: "owner" | "viewer", reauth = true) {
  const u = await mkUser();
  const a = await queryOne<{ id: string }>(
    `INSERT INTO admin_accounts (user_id, role, status, totp_enabled_at, totp_secret_enc) VALUES ($1, $2, 'active', now(), 'v1.fixture-never-opened') RETURNING id::text AS id`,
    [u.id, role],
  );
  const us = await queryOne<{ id: string }>(`SELECT id::text AS id FROM sessions WHERE token_hash = $1`, [sha256(u.token)]);
  const s = await transaction((c) => createAdminSession(c, { adminId: a!.id, userSessionId: us!.id, ip: "10.0.0.1", userAgent: "lib-test", reauth }));
  return { cookie: `${SESSION_COOKIE}=${u.token}; ${adminCookieName()}=${s.token}`, adminId: a!.id };
}
const headers = (cookie: string | null, origin = true) => {
  const h: Record<string, string> = { host: "localhost:3000", "x-forwarded-for": `10.1.${randomInt(0, 250)}.${randomInt(1, 250)}`, "user-agent": "lib-test", "content-type": "application/json" };
  if (cookie) h.cookie = cookie;
  if (origin) h.origin = "http://localhost:3000";
  return h;
};
type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
async function read(r: Response): Promise<{ status: number; body: Any }> {
  const text = await r.text();
  return { status: r.status, body: text ? (JSON.parse(text) as Any) : {} };
}
type Handler = (req: Request, ctx: unknown) => Promise<Response>;
async function call(h: Handler, method: string, path: string, cookie: string | null, body?: unknown, params?: Record<string, string>) {
  const req = new Request(`http://localhost:3000${path}`, { method, headers: headers(cookie, method !== "GET"), ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  return read(await inRequest(req, () => h(req, params ? { params: Promise.resolve(params) } : undefined)));
}
const publicGet = async (h: Handler, path: string) => {
  const req = new Request(`http://localhost${path}`, { headers: { "x-forwarded-for": `10.7.${randomInt(0, 250)}.${randomInt(1, 250)}` } });
  return read(await inRequest(req, () => h(req, undefined)));
};
const audits = (adminId: string, action: string) =>
  query<{ target_id: string; reason: string; before: Any | null; after: Any | null }>(
    "SELECT target_id, reason, before, after FROM admin_audit_log WHERE admin_id = $1 AND action = $2 ORDER BY id",
    [adminId, action],
  );
async function refresh() {
  await reloadProviderKeys();
  invalidateMediaOverrides();
  invalidateLibrary();
}

test("seed: 40 prompts across every category; every seeded template validates against the current catalog", { skip }, async () => {
  const prompts = await query<{ category: string; prompt: string }>("SELECT category, prompt FROM studio_prompts WHERE seed_key IS NOT NULL AND media = 'image'");
  assert.equal(prompts.length, 40);
  for (const c of lib.LIBRARY_CATEGORIES) assert.equal(prompts.filter((p) => p.category === c.id).length, 4, c.id);
  for (const p of prompts) assert.ok(p.prompt.length >= 3 && p.prompt.length <= 500);
  const templates = await query<{ seed_key: string; category: string; model_id: string; params: unknown; skeleton: string; slots: unknown }>(
    "SELECT seed_key, category, model_id, params, skeleton, slots FROM studio_templates WHERE seed_key IS NOT NULL AND media = 'image' ORDER BY seed_key",
  );
  assert.equal(templates.length, 10);
  const { MEDIA_PURPOSES } = await import("../lib/media/catalog.ts");
  const allowed = MEDIA_PURPOSES.byId("studio.image")!.allowed;
  for (const t of templates) {
    assert.ok(lib.isLibraryCategory(t.category), `${t.seed_key}: category`);
    assert.ok(allowed.includes(t.model_id), `${t.seed_key}: a Studio picture model`);
    assert.equal(lib.templateError({ modelId: t.model_id, params: t.params, skeleton: t.skeleton, slots: t.slots }, MEDIA_CATALOG.byId(t.model_id)), null, t.seed_key);
  }
  // The seed spans the current catalog: Nano Banana, FLUX 3, Seedream Lite / Pro, Ideogram 4.5, Recraft 4.1 / Pro.
  assert.deepEqual([...new Set(templates.map((t) => t.model_id))].sort(), [NANO, "bfl/flux", "bytedance/seedream", "bytedance/seedream-pro", "ideogram/ideogram", "recraft/recraft", "recraft/recraft-pro"].sort());
});

test("pure: an empty slot takes the English fallback before the Uzbek example", () => {
  const slots = [{ name: "joy", label: "Joy", placeholder: "tog‘ qishlog‘i", fallback: "a mountain village", max: 40 }];
  assert.equal(lib.fillSkeleton("A walk through {joy}", slots, {}), "A walk through a mountain village");
  assert.equal(lib.fillSkeleton("A walk through {joy}", slots, { joy: "Xiva" }), "A walk through Xiva", "the user's value wins");
  assert.match(String(lib.slotsError([{ ...slots[0], fallback: "x".repeat(81) }])), /zaxira/);
  assert.equal(lib.slotsError(slots), null);
  assert.deepEqual(lib.cleanSlots(slots), slots, "the stored shape keeps it");
});

test("pure: a template presets no picture", () => {
  const flash = MEDIA_CATALOG.byId("kling/kling-4-flash")!;
  const t = { modelId: flash.id, params: { imageAssetId: "0123456789abcdef01234567" }, skeleton: "A clip of {x}", slots: [{ name: "x", label: "X", max: 40 }] };
  assert.match(String(lib.templateError(t, flash)), /Surat/);
});

test("seed: video, music and effect rows; English text, Uzbek titles and labels, quoted text verbatim", { skip }, async () => {
  const { templateModel } = await import("../lib/server/media/library.ts");
  const looksUzbek = /\b(va|bilan|uchun|yozuvi|rangli|fon|kechasi|tabriknomasi|logotip|shablon)\b/i;
  const rows = await query<{ seed_key: string; media: string; category: string; title: string; prompt: string }>("SELECT seed_key, media, category, title, prompt FROM studio_prompts WHERE seed_key IS NOT NULL");
  const of = (m: string) => rows.filter((r) => r.media === m);
  assert.equal(of("video").length, 24);
  assert.equal(of("music").length, 8);
  assert.equal(of("sfx").length, 8);
  for (const c of lib.categoriesOf("video")) assert.equal(of("video").filter((r) => r.category === c.id).length, 4, c.id);
  for (const m of lib.LIBRARY_MEDIA) for (const r of of(m)) assert.ok(lib.isLibraryCategory(r.category, m), `${r.seed_key}: ${r.category} is a ${m} category`);
  for (const r of of("video")) {
    assert.match(r.prompt, /^One continuous shot: /, `${r.seed_key}: one shot`);
    assert.match(r.prompt, /camera|drone/i, `${r.seed_key}: camera`);
    assert.match(r.prompt, /light|lanterns|sunbeams/i, `${r.seed_key}: light`);
  }
  for (const r of rows) assert.ok(!looksUzbek.test(r.prompt.replace(/«[^»]*»/g, "")), `${r.seed_key} reads Uzbek: ${r.prompt}`);
  // The 40 old rows: quoted on-screen text kept verbatim, Uzbek titles unchanged.
  const sql = await readFile(new URL("../lib/server/migrations/067_studio_library.sql", import.meta.url), "utf8");
  for (const r of of("image")) {
    const line = sql.split("\n").find((l) => l.includes(`('${r.seed_key}', '`))!;
    assert.ok(line.includes(`'${r.title.replace(/'/g, "''")}'`), `${r.seed_key}: the title stays`);
    for (const q of line.matchAll(/«([^»]+)»/g)) assert.ok(r.prompt.includes(q[1]!.replace(/''/g, "'")), `${r.seed_key}: «${q[1]}» stays verbatim`);
  }
  const templates = await query<{ seed_key: string; media: "image" | "video"; title: string; model_id: string; params: unknown; skeleton: string; slots: { label: string; fallback?: string; placeholder?: string }[] }>(
    "SELECT seed_key, media, title, model_id, params, skeleton, slots FROM studio_templates WHERE seed_key IS NOT NULL ORDER BY seed_key",
  );
  assert.equal(templates.filter((t) => t.media === "video").length, 12);
  for (const t of templates) {
    assert.equal(lib.templateError({ modelId: t.model_id, params: t.params, skeleton: t.skeleton, slots: t.slots }, templateModel(t.media, t.model_id)), null, t.seed_key);
    assert.ok(!looksUzbek.test(t.skeleton.replace(/«[^»]*»|\{\w+\}/g, "")), `${t.seed_key}: ${t.skeleton}`);
    // A slot left empty must not put Uzbek into the English prompt, unless the slot IS on-screen text.
    const text = lib.fillSkeleton(t.skeleton, lib.cleanSlots(t.slots as never), {});
    assert.ok(!/[ʻ‘]/.test(text.replace(/«[^»]*»/g, "")), `${t.seed_key}: ${text}`);
    for (const s of t.slots) assert.ok(t.skeleton.includes(`«`) || s.fallback, `${t.seed_key}.${s.label}: an English fallback`);
  }
  for (const t of templates.filter((x) => x.media === "video")) assert.match(t.skeleton, /^One continuous shot: .*(camera|drone)/i, t.seed_key);
  assert.ok(new Set(templates.filter((t) => t.media === "video").map((t) => t.model_id)).size >= 2, "more than one suggested model");
});

test("seed: the English rewrite touches only rows still holding the seeded text, and running it again changes nothing", { skip }, async () => {
  const sql = await readFile(new URL("../lib/server/migrations/076_studio_library_media.sql", import.meta.url), "utf8");
  const seeded = await readFile(new URL("../lib/server/migrations/067_studio_library.sql", import.meta.url), "utf8");
  const uzPrompt = /\('p01', 'portret', 10, '[^']*', '((?:[^']|'')*)'\)/.exec(seeded)![1]!.replace(/''/g, "'");
  const uzSkeleton = /'Logotip', 'recraft\/recraft',\s*'[^']*',\s*'((?:[^']|'')*)',/.exec(seeded)![1]!.replace(/''/g, "'");
  const prompt = (k: string) => queryOne<{ prompt: string }>("SELECT prompt FROM studio_prompts WHERE seed_key = $1", [k]);
  const tpl = (k: string) => queryOne<{ skeleton: string; slots: { fallback?: string }[] }>("SELECT skeleton, slots FROM studio_templates WHERE seed_key = $1", [k]);
  const english = (await prompt("p01"))!.prompt;
  const englishSkeleton = (await tpl("t03"))!.skeleton;
  const row = { p: await query("SELECT count(*) FROM studio_prompts"), t: await query("SELECT count(*) FROM studio_templates") };
  // p01 and t03 are back at the seeded text; p02 and t04 carry an admin's own words; a seeded video row was edited too.
  await query("UPDATE studio_prompts SET prompt = $1 WHERE seed_key = 'p01'", [uzPrompt]);
  await query("UPDATE studio_templates SET skeleton = $1 WHERE seed_key = 't03'", [uzSkeleton]);
  await query("UPDATE studio_prompts SET prompt = 'Admin yozgan matn' WHERE seed_key = 'p02'");
  await query("UPDATE studio_templates SET skeleton = 'Admin skeleti {nom} {belgi} {ranglar}' WHERE seed_key = 't04'");
  await query("UPDATE studio_prompts SET prompt = 'Admin edited clip' WHERE seed_key = 'vp01'");
  await transaction((c) => c.query(sql));
  assert.equal((await prompt("p01"))!.prompt, english, "still the seeded text: rewritten");
  assert.equal((await tpl("t03"))!.skeleton, englishSkeleton);
  assert.equal((await prompt("p02"))!.prompt, "Admin yozgan matn", "MUTATSIYA: an admin's edit survives");
  assert.equal((await tpl("t04"))!.skeleton, "Admin skeleti {nom} {belgi} {ranglar}");
  assert.equal((await prompt("vp01"))!.prompt, "Admin edited clip", "a re-run never overwrites a new seed");
  assert.deepEqual({ p: await query("SELECT count(*) FROM studio_prompts"), t: await query("SELECT count(*) FROM studio_templates") }, row, "no duplicates");
  await query("UPDATE studio_prompts SET prompt = 'One continuous shot: a perfume bottle turns slowly, the camera orbits it, a thin line of warm light' WHERE seed_key = 'vp01'");
});

test("public: kinds — each asks for its own rows; a clip template stays listed whichever models are on", { skip }, async (t) => {
  await refresh();
  const video = await publicGet(libraryRoute.GET as Handler, "/api/media/library?media=video");
  assert.equal(video.status, 200);
  assert.equal(video.body.items.length, 24);
  assert.ok(video.body.items.every((i: Any) => i.media === "video"));
  assert.deepEqual(video.body.categories.map((c: Any) => c.id), ["reklama", "tabrik", "talim", "tabiat", "sayohat", "shahar"]);
  assert.equal(video.body.categories[0].count, 4, "the count is the kind's own");
  assert.equal((await publicGet(libraryRoute.GET as Handler, "/api/media/library?media=video&category=sayohat")).body.items.length, 4);
  assert.equal((await publicGet(libraryRoute.GET as Handler, "/api/media/library?media=video&category=logo")).status, 400, "a picture category");
  assert.equal((await publicGet(libraryRoute.GET as Handler, "/api/media/library?media=music")).body.items.length, 8);
  assert.equal((await publicGet(libraryRoute.GET as Handler, "/api/media/library?media=sfx")).body.items.length, 8);
  assert.equal((await publicGet(libraryRoute.GET as Handler, "/api/media/library?media=nope")).status, 400);
  assert.equal((await publicGet(libraryRoute.GET as Handler, "/api/media/library")).body.items.filter((i: Any) => i.media !== "image").length, 0, "the Rasm sheet stays as it was");
  assert.equal((await publicGet(templatesRoute.GET as Handler, "/api/media/templates?media=music")).status, 400, "no music templates");
  // Paid video off: nothing can be sold, nothing is listed.
  const setVideo = async (on: boolean) => {
    await query("INSERT INTO app_settings (key, value) VALUES ('video.enabled', $1::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [JSON.stringify(on)]);
    (await import("../lib/server/settings.ts")).invalidateSettingsCache();
  };
  t.after(() => setVideo(false));
  await setVideo(false);
  assert.equal((await publicGet(templatesRoute.GET as Handler, "/api/media/templates?media=video")).body.items.length, 0);
  // On, with only the Gemini key: the suggested Kling models are off, the templates stay and name them.
  await setVideo(true);
  const clips = await publicGet(templatesRoute.GET as Handler, "/api/media/templates?media=video");
  assert.equal(clips.body.items.length, 12, "MUTATSIYA: a clip template never hides with its suggested model");
  assert.ok(clips.body.items.every((i: Any) => i.media === "video" && i.modelId.startsWith("kling/")));
  assert.equal(clips.body.items[0].slots[0].fallback !== undefined, true, "the browser needs the fallback");
  assert.deepEqual((await publicGet(templatesRoute.GET as Handler, "/api/media/templates")).body.items.map((i: Any) => i.modelId), [NANO], "the picture rule is unchanged");
  // A clip template that stopped validating is hidden as a picture one is.
  await query(`UPDATE studio_templates SET params = '{"seconds": 999}'::jsonb WHERE seed_key = 'vt01'`);
  t.after(async () => void (await query(`UPDATE studio_templates SET params = '{"seconds": 5, "aspect": "9:16"}'::jsonb WHERE seed_key = 'vt01'`)));
  await refresh();
  assert.equal((await publicGet(templatesRoute.GET as Handler, "/api/media/templates?media=video")).body.items.length, 11);
});

test("public: library — enabled only, public fields only, category filter, unknown category 400", { skip }, async () => {
  await refresh();
  await query("UPDATE studio_prompts SET enabled = FALSE WHERE seed_key = 'p01'");
  invalidateLibrary();
  const all = await publicGet(libraryRoute.GET as Handler, "/api/media/library");
  assert.equal(all.status, 200);
  assert.equal(all.body.items.length, 39, "the disabled prompt is hidden");
  assert.ok(!all.body.items.some((i: Any) => i.title === "Studiyadagi portret"));
  for (const i of all.body.items) assert.deepEqual(Object.keys(i).sort(), ["category", "id", "media", "previewUrl", "prompt", "title"], "no seed key, sort, writer, timestamps");
  assert.equal(all.body.categories.find((c: Any) => c.id === "portret").count, 3);
  const logos = await publicGet(libraryRoute.GET as Handler, "/api/media/library?category=logo");
  assert.equal(logos.body.items.length, 4);
  assert.ok(logos.body.items.every((i: Any) => i.category === "logo"));
  assert.equal((await publicGet(libraryRoute.GET as Handler, "/api/media/library?category=nope")).status, 400);
  await query("UPDATE studio_prompts SET enabled = TRUE WHERE seed_key = 'p01'");
  invalidateLibrary();
});

test("public: templates — enabled, valid and model available now", { skip }, async (t) => {
  // No fal key: only the Nano Banana template (Gemini key set) is sellable.
  await refresh();
  const noFal = await publicGet(templatesRoute.GET as Handler, "/api/media/templates");
  assert.equal(noFal.status, 200);
  assert.deepEqual(noFal.body.items.map((i: Any) => i.modelId), [NANO]);
  assert.deepEqual(Object.keys(noFal.body.items[0]).sort(), ["category", "id", "media", "modelId", "params", "previewUrl", "skeleton", "slots", "title"]);
  process.env.FAL_KEY = "test-fal-key-0000:abcdef";
  t.after(() => void delete process.env.FAL_KEY);
  await refresh();
  const withFal = await publicGet(templatesRoute.GET as Handler, "/api/media/templates");
  assert.equal(withFal.body.items.length, 10);
  // The admin switches Recraft off in «Media modellari»: its template disappears.
  await query("INSERT INTO media_model_overrides (model_id, enabled) VALUES ('recraft/recraft', FALSE)");
  t.after(async () => void (await query("DELETE FROM media_model_overrides WHERE model_id = 'recraft/recraft'")));
  // A stored row that no longer validates (catalog change) is hidden too.
  await query(`UPDATE studio_templates SET params = '{"imageRatio": "7:5"}'::jsonb WHERE seed_key = 't09'`);
  t.after(async () => void (await query(`UPDATE studio_templates SET params = '{"imageRatio": "16:9", "imageCount": 1, "imageStyle": "illustration"}'::jsonb WHERE seed_key = 't09'`)));
  await refresh();
  const after2 = await publicGet(templatesRoute.GET as Handler, "/api/media/templates");
  const titles = after2.body.items.map((i: Any) => i.title);
  assert.ok(!titles.includes("Logotip"), "Recraft switched off");
  assert.ok(!titles.includes("Dars uchun illyustratsiya"), "invalid row hidden");
  assert.equal(after2.body.items.length, 8);
  // Review NIT-7: a category the code does not know hides the template, as in the prompt library.
  await query("UPDATE studio_templates SET category = 'retired' WHERE seed_key = 't10'");
  t.after(async () => void (await query("UPDATE studio_templates SET category = 'tabiat' WHERE seed_key = 't10'")));
  await refresh();
  const after3 = await publicGet(templatesRoute.GET as Handler, "/api/media/templates");
  assert.ok(!after3.body.items.some((i: Any) => i.title === "Manzara"), "unknown category hidden");
  assert.equal(after3.body.items.length, 7);
});

test("admin: the kind of a row is checked against its model and its category", { skip }, async (t) => {
  for (const m of ["warn", "error"] as const) t.mock.method(console, m, () => {});
  await refresh();
  const owner = await session("owner");
  const read = await call(adminRoot.GET as Handler, "GET", "/api/admin/studio-library", owner.cookie);
  assert.ok(read.body.models.some((m: Any) => m.id === "kling/kling-4-flash" && m.media === "video"), "the clip models are offered");
  assert.ok(!read.body.models.some((m: Any) => m.id === "kling/effects" || m.id === "heygen/avatar"), "an effect or an avatar cannot carry a skeleton");
  assert.ok(read.body.categories.some((c: Any) => c.id === "sayohat" && c.media === "video"));
  const body = { media: "video", category: "sayohat", title: "Yangi lavha", modelId: "kling/kling-4-flash", params: { seconds: 5, aspect: "9:16" }, skeleton: "One shot of {joy}", slots: [{ name: "joy", label: "Joy", max: 40 }], reason: REASON };
  const post = (b: Record<string, unknown>) => call(adminTemplates.POST as Handler, "POST", "/api/admin/studio-library/templates", owner.cookie, b);
  const made = await post(body);
  assert.equal(made.status, 200, JSON.stringify(made.body));
  assert.equal(made.body.media, "video");
  assert.equal((await post({ ...body, modelId: NANO, params: {} })).body.code, "template_invalid", "a picture model on a clip template");
  assert.equal((await post({ ...body, media: "image" })).body.code, "template_invalid", "a clip model on a picture template");
  assert.equal((await post({ ...body, modelId: "kling/effects", params: {} })).body.code, "template_invalid");
  assert.equal((await post({ ...body, modelId: "heygen/avatar", params: {} })).body.code, "template_invalid");
  assert.equal((await post({ ...body, media: "music" })).status, 400, "no music templates");
  assert.equal((await post({ ...body, category: "logo" })).status, 400, "a picture category");
  const prompt = await call(adminPrompts.POST as Handler, "POST", "/api/admin/studio-library/prompts", owner.cookie, { media: "sfx", category: "interfeys", title: "Klik", prompt: "A soft click", reason: REASON });
  assert.equal(prompt.status, 200);
  assert.equal(prompt.body.media, "sfx");
  assert.equal((await call(adminPrompts.POST as Handler, "POST", "/api/admin/studio-library/prompts", owner.cookie, { media: "sfx", category: "logo", title: "x", prompt: "abcd", reason: REASON })).status, 400);
  assert.equal((await call(adminPrompts.POST as Handler, "POST", "/api/admin/studio-library/prompts", owner.cookie, { media: "nope", category: "logo", title: "x", prompt: "abcd", reason: REASON })).status, 400);
  // An update keeps the kind it did not name.
  const edited = await call(adminPrompt.PUT as Handler, "PUT", `/api/admin/studio-library/prompts/${prompt.body.id}`, owner.cookie, { title: "Klik 2", reason: REASON }, { id: prompt.body.id });
  assert.equal(edited.body.media, "sfx");
  // Reorder stays inside one kind: `reklama` exists for pictures and clips alike.
  const ids = await query<{ id: string }>("SELECT id::text AS id FROM studio_prompts WHERE seed_key IN ('p25', 'vp01')");
  assert.equal((await call(adminReorder.POST as Handler, "POST", "/api/admin/studio-library/reorder", owner.cookie, { kind: "prompts", ids: ids.map((r) => r.id), reason: REASON })).status, 400);
  const tids = await query<{ id: string }>("SELECT id::text AS id FROM studio_templates WHERE seed_key IN ('t01', 'vt01')");
  assert.equal((await call(adminReorder.POST as Handler, "POST", "/api/admin/studio-library/reorder", owner.cookie, { kind: "templates", ids: tids.map((r) => r.id), reason: REASON })).status, 400);
  await query("DELETE FROM studio_templates WHERE id = $1", [made.body.id]);
  await query("DELETE FROM studio_prompts WHERE id = $1", [prompt.body.id]);
  invalidateLibrary();
});

test("admin: roles, reason, template validation", { skip }, async (t) => {
  for (const m of ["warn", "error"] as const) t.mock.method(console, m, () => {});
  await refresh();
  const owner = await session("owner");
  const viewer = await session("viewer");
  const read1 = await call(adminRoot.GET as Handler, "GET", "/api/admin/studio-library", viewer.cookie);
  assert.equal(read1.status, 200, "viewer reads");
  assert.equal(read1.body.prompts.filter((p: Any) => p.media === "image").length, 40);
  assert.equal(read1.body.templates.filter((x: Any) => x.media === "image").length, 10);
  assert.equal(read1.body.prompts.length, 80, "pictures, clips, music and sound effects");
  assert.equal(read1.body.templates.length, 22);
  assert.ok(read1.body.models.some((m: Any) => m.id === NANO && Array.isArray(m.params)));
  const denied = await call(adminPrompts.POST as Handler, "POST", "/api/admin/studio-library/prompts", viewer.cookie, { category: "logo", title: "x", prompt: "abcd", reason: REASON });
  assert.equal(denied.status, 403);
  const stale = await session("owner", false);
  assert.equal((await call(adminPrompts.POST as Handler, "POST", "/api/admin/studio-library/prompts", stale.cookie, { category: "logo", title: "x", prompt: "abcd", reason: REASON })).status, 401, "stale step-up");
  const noReason = await call(adminPrompts.POST as Handler, "POST", "/api/admin/studio-library/prompts", owner.cookie, { category: "logo", title: "x", prompt: "abcd" });
  assert.equal(noReason.status, 400);
  const before = await queryOne<{ n: string }>("SELECT count(*)::text AS n FROM studio_templates");
  const bad = await call(adminTemplates.POST as Handler, "POST", "/api/admin/studio-library/templates", owner.cookie, {
    category: "logo",
    title: "Yomon",
    modelId: NANO,
    params: { imageRatio: "7:5" },
    skeleton: "{a} logotip",
    slots: [{ name: "a", label: "A", max: 20 }],
    reason: REASON,
  });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.code, "template_invalid");
  assert.match(String(bad.body.error), /O'lcham/);
  const unknown = await call(adminTemplates.POST as Handler, "POST", "/api/admin/studio-library/templates", owner.cookie, { category: "logo", title: "Y", modelId: "bria/background-remove", params: {}, skeleton: "abc", slots: [], reason: REASON });
  assert.equal(unknown.status, 400, "only Studio picture models");
  assert.equal((await queryOne<{ n: string }>("SELECT count(*)::text AS n FROM studio_templates"))!.n, before!.n, "nothing stored");
});

test("admin: prompts CRUD with audit before/after, conflicts, reorder; public read follows", { skip }, async () => {
  await refresh();
  const owner = await session("owner");
  const created = await call(adminPrompts.POST as Handler, "POST", "/api/admin/studio-library/prompts", owner.cookie, { category: "logo", title: "Yangi logo", prompt: "Kitob do'koni uchun logotip", reason: REASON });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const id = created.body.id as string;
  const [c] = await audits(owner.adminId, "studio_prompt.create");
  assert.equal(c!.target_id, id);
  assert.equal(c!.reason, REASON);
  assert.equal(c!.before, null);
  assert.equal(c!.after!.title, "Yangi logo");
  assert.ok((await publicGet(libraryRoute.GET as Handler, "/api/media/library?category=logo")).body.items.some((i: Any) => i.id === id), "visible at once");

  const upd = await call(adminPrompt.PUT as Handler, "PUT", `/api/admin/studio-library/prompts/${id}`, owner.cookie, { enabled: false, reason: REASON, expectedUpdatedAt: created.body.updatedAt }, { id });
  assert.equal(upd.status, 200, JSON.stringify(upd.body));
  const [u] = await audits(owner.adminId, "studio_prompt.update");
  assert.equal(u!.before!.enabled, true);
  assert.equal(u!.after!.enabled, false);
  assert.ok(!(await publicGet(libraryRoute.GET as Handler, "/api/media/library?category=logo")).body.items.some((i: Any) => i.id === id), "hidden at once");
  const same = await call(adminPrompt.PUT as Handler, "PUT", `/api/admin/studio-library/prompts/${id}`, owner.cookie, { enabled: false, reason: REASON }, { id });
  assert.equal(same.status, 409);
  assert.equal(same.body.code, "state");
  const stale = await call(adminPrompt.PUT as Handler, "PUT", `/api/admin/studio-library/prompts/${id}`, owner.cookie, { title: "Boshqa", reason: REASON, expectedUpdatedAt: created.body.updatedAt }, { id });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, "stale");
  assert.equal((await audits(owner.adminId, "studio_prompt.update")).length, 1, "conflicts write nothing");

  // Reorder inside one category.
  const logos = await query<{ id: string }>("SELECT id::text AS id FROM studio_prompts WHERE category = 'logo' ORDER BY sort, id");
  const ids = logos.map((r) => r.id).reverse();
  const ro = await call(adminReorder.POST as Handler, "POST", "/api/admin/studio-library/reorder", owner.cookie, { kind: "prompts", ids, reason: REASON });
  assert.equal(ro.status, 200, JSON.stringify(ro.body));
  const now = await query<{ id: string; sort: number }>("SELECT id::text AS id, sort FROM studio_prompts WHERE category = 'logo' ORDER BY sort, id");
  assert.deepEqual(now.map((r) => r.id), ids);
  assert.deepEqual(now.map((r) => r.sort), ids.map((_, i) => (i + 1) * 10));
  assert.equal((await audits(owner.adminId, "studio_library.reorder")).length, 1);
  const mixed = await call(adminReorder.POST as Handler, "POST", "/api/admin/studio-library/reorder", owner.cookie, { kind: "prompts", ids: [ids[0], (await query<{ id: string }>("SELECT id::text AS id FROM studio_prompts WHERE category = 'tabiat' LIMIT 1"))[0]!.id], reason: REASON });
  assert.equal(mixed.status, 400, "one category at a time");

  const del = await call(adminPrompt.DELETE as Handler, "DELETE", `/api/admin/studio-library/prompts/${id}`, owner.cookie, { reason: REASON }, { id });
  assert.equal(del.status, 200);
  const [d] = await audits(owner.adminId, "studio_prompt.delete");
  assert.equal(d!.before!.title, "Yangi logo");
  assert.equal(d!.after, null);
  assert.equal((await call(adminPrompt.DELETE as Handler, "DELETE", `/api/admin/studio-library/prompts/${id}`, owner.cookie, { reason: REASON }, { id })).status, 404);
});

test("admin: templates create / update / delete with audit; the public read follows", { skip }, async () => {
  await refresh();
  const owner = await session("owner");
  const body = { category: "reklama", title: "Yangi shablon", modelId: NANO, params: { imageRatio: "1:1", imageCount: 2 }, skeleton: "{mahsulot} reklamasi, yorqin fon", slots: [{ name: "mahsulot", label: "Mahsulot", placeholder: "sharbat", max: 40 }], reason: REASON };
  const created = await call(adminTemplates.POST as Handler, "POST", "/api/admin/studio-library/templates", owner.cookie, body);
  assert.equal(created.status, 200, JSON.stringify(created.body));
  assert.equal(created.body.error, null);
  assert.equal(created.body.modelAvailable, true);
  const id = created.body.id as string;
  assert.ok((await publicGet(templatesRoute.GET as Handler, "/api/media/templates")).body.items.some((i: Any) => i.id === id));
  const bad = await call(adminTemplate.PUT as Handler, "PUT", `/api/admin/studio-library/templates/${id}`, owner.cookie, { params: { imageCount: 7 }, reason: REASON }, { id });
  assert.equal(bad.status, 400, "an update is validated too");
  const upd = await call(adminTemplate.PUT as Handler, "PUT", `/api/admin/studio-library/templates/${id}`, owner.cookie, { params: { imageRatio: "9:16", imageCount: 1 }, reason: REASON }, { id });
  assert.equal(upd.status, 200, JSON.stringify(upd.body));
  const [u] = await audits(owner.adminId, "studio_template.update");
  assert.deepEqual(u!.before!.params, { imageRatio: "1:1", imageCount: 2 });
  assert.deepEqual(u!.after!.params, { imageRatio: "9:16", imageCount: 1 });
  const pub = (await publicGet(templatesRoute.GET as Handler, "/api/media/templates")).body.items.find((i: Any) => i.id === id);
  assert.deepEqual(pub.params, { imageRatio: "9:16", imageCount: 1 });
  const del = await call(adminTemplate.DELETE as Handler, "DELETE", `/api/admin/studio-library/templates/${id}`, owner.cookie, { reason: REASON }, { id });
  assert.equal(del.status, 200);
  assert.equal((await audits(owner.adminId, "studio_template.delete")).length, 1);
  assert.ok(!(await publicGet(templatesRoute.GET as Handler, "/api/media/templates")).body.items.some((i: Any) => i.id === id));
});

test("templates: the session opens an admin's preview of a hidden model", { skip }, async (t) => {
  await refresh();
  const hidden = MEDIA_CATALOG.entries.find((e) => e.kind === "image" && e.defaultOff && e.routes.some((r) => r.provider === "fal") && lib.templateError({ modelId: e.id, params: {}, skeleton: "A picture of {x}", slots: [{ name: "x", label: "X", max: 40 }] }, e) === null);
  assert.ok(hidden, "a defaultOff picture model");
  process.env.FAL_KEY = "test-fal-key-0000:abcdef";
  t.after(() => void delete process.env.FAL_KEY);
  await refresh();
  await query("INSERT INTO studio_templates (category, title, model_id, skeleton, slots) VALUES ('logo', 'Sinov shabloni', $1, 'A picture of {x}', '[{\"name\": \"x\", \"label\": \"X\", \"max\": 40}]')", [hidden.id]);
  t.after(async () => void (await query("DELETE FROM studio_templates WHERE title = 'Sinov shabloni'")));
  invalidateLibrary();
  const titles = (b: Any) => b.items.map((i: Any) => i.title);
  assert.ok(!titles((await publicGet(templatesRoute.GET as Handler, "/api/media/templates")).body).includes("Sinov shabloni"), "a visitor does not see it");
  const owner = await session("owner");
  const req = new Request("http://localhost/api/media/templates", { headers: { cookie: owner.cookie, "x-forwarded-for": "10.9.9.9" } });
  const res = await read(await inRequest(req, () => (templatesRoute.GET as Handler)(req, undefined)));
  assert.ok(titles(res.body).includes("Sinov shabloni"), "MUTATSIYA: without `optionalUser` no preview opens");
});

test("enhance: free, the rewrite returned, burst limit 10 / 10 min → 429", { skip }, async (t) => {
  for (const m of ["warn", "error", "info", "log"] as const) t.mock.method(console, m, () => {});
  let llm = 0;
  globalThis.fetch = (async (u: string | URL) => {
    if (String(u).includes(":generateContent")) {
      llm++;
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"prompt":"Samarqand Registon maydoni, oltin soat, keng burchakli kadr"}' }] } }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;
  t.after(() => void (globalThis.fetch = REAL_FETCH));
  const u = await mkUser(5_000);
  const post = async (prompt: string, kind?: string) => {
    const req = new Request("http://localhost/api/media/enhance", { method: "POST", headers: { cookie: `${SESSION_COOKIE}=${u.token}`, "content-type": "application/json", "x-forwarded-for": "10.9.9.9" }, body: JSON.stringify({ prompt, kind }) });
    return read(await inRequest(req, () => (enhanceRoute.POST as Handler)(req, undefined)));
  };
  assert.equal((await post("ab")).status, 400, "too short");
  assert.equal((await post("Registon", "speech")).status, 400, "speech is never rewritten");
  assert.equal((await post("Naqorat: yur, yur, bahor keldi", "music")).status, 400, "MUTATSIYA: lyrics are never rewritten, by the button either");
  assert.equal(llm, 0);
  const r = await post("Registon");
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.prompt, "Samarqand Registon maydoni, oltin soat, keng burchakli kadr");
  for (let i = 0; i < 9; i++) assert.equal((await post("Registon")).status, 200, `call ${i + 2}`);
  const limited = await post("Registon");
  assert.equal(limited.status, 429, "the 11th call inside 10 minutes");
  assert.equal(llm, 10, "the refused call never reached the LLM");
  const bal = await queryOne<{ b: string }>("SELECT (points + quota + balance)::text AS b FROM users WHERE id = $1", [u.id]);
  assert.equal(bal!.b, "5000", "free: nothing charged");
});

/** A PNG head with a real IHDR (w × h) and padding (`imageDims` reads the size from it). */
function tinyPng(w: number, h: number, pad = 200): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]), Buffer.from("IHDR"), ihdr, Buffer.alloc(4), Buffer.alloc(pad, 1)]);
}
async function uploadPreviewAs(cookie: string, bytes: Buffer, reason = REASON) {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes)]), "p.png");
  form.append("reason", reason);
  const h = headers(cookie);
  delete h["content-type"];
  const req = new Request("http://localhost:3000/api/admin/studio-library/previews", { method: "POST", headers: h, body: form });
  return read(await inRequest(req, () => (adminPreviews.POST as Handler)(req, undefined)));
}

test("previews: tiny file 415 (not 500); upload, delete unreferenced (audited), 409 in use; purge of stale unreferenced", { skip }, async () => {
  const owner = await session("owner");
  // Review MINOR-1: 1–3 byte files are «not PNG/JPEG», never a RangeError.
  for (const n of [1, 2, 3]) assert.equal((await uploadPreviewAs(owner.cookie, Buffer.alloc(n, 0x89))).status, 415, `${n} bytes`);
  const up = await uploadPreviewAs(owner.cookie, tinyPng(300, 200));
  assert.equal(up.status, 200, JSON.stringify(up.body));
  const id = up.body.id as string;
  // In use by a prompt: 409, nothing removed.
  const p = await call(adminPrompts.POST as Handler, "POST", "/api/admin/studio-library/prompts", owner.cookie, { category: "logo", title: "Rasmli", prompt: "Rasmli namuna prompt", previewId: id, reason: REASON });
  assert.equal(p.status, 200, JSON.stringify(p.body));
  const inUse = await call(adminPreview.DELETE as Handler, "DELETE", `/api/admin/studio-library/previews/${id}`, owner.cookie, { reason: REASON }, { id });
  assert.equal(inUse.status, 409);
  assert.equal(inUse.body.code, "in_use");
  // The public byte route serves it, with an IP rate limit (review MINOR-3).
  const preq = new Request(`http://localhost/api/media/library/preview/${id}`, { headers: { "x-forwarded-for": "10.55.1.1" } });
  const served = await inRequest(preq, () => (previewRoute.GET as Handler)(preq, { params: Promise.resolve({ id }) }));
  assert.equal(served.status, 200);
  assert.equal(served.headers.get("content-type"), "image/png");
  // Detach, then delete: audited, gone.
  await call(adminPrompt.DELETE as Handler, "DELETE", `/api/admin/studio-library/prompts/${p.body.id}`, owner.cookie, { reason: REASON }, { id: p.body.id });
  const del = await call(adminPreview.DELETE as Handler, "DELETE", `/api/admin/studio-library/previews/${id}`, owner.cookie, { reason: REASON }, { id });
  assert.equal(del.status, 200, JSON.stringify(del.body));
  const [a] = await audits(owner.adminId, "studio_library.preview_delete");
  assert.equal(a!.target_id, id);
  assert.equal(a!.before!.mime, "image/png");
  assert.equal(a!.after, null);
  assert.equal(await queryOne("SELECT 1 FROM studio_library_previews WHERE id = $1", [id]), null);
  assert.equal((await call(adminPreview.DELETE as Handler, "DELETE", `/api/admin/studio-library/previews/${id}`, owner.cookie, { reason: REASON }, { id })).status, 404);
  assert.equal((await call(adminPreview.DELETE as Handler, "DELETE", `/api/admin/studio-library/previews/${id}`, owner.cookie, {}, { id })).status, 400, "reason required");

  // Housekeeping: only previews nobody points at AND older than 7 days.
  const old1 = (await uploadPreviewAs(owner.cookie, tinyPng(301, 200))).body.id as string;
  const old2 = (await uploadPreviewAs(owner.cookie, tinyPng(302, 200))).body.id as string;
  const fresh = (await uploadPreviewAs(owner.cookie, tinyPng(303, 200))).body.id as string;
  await query("UPDATE studio_library_previews SET created_at = now() - interval '8 days' WHERE id = ANY($1::text[])", [[old1, old2]]);
  await query("UPDATE studio_templates SET preview_id = $1 WHERE seed_key = 't01'", [old2]);
  assert.equal(await purgeUnusedPreviews(7), 1);
  assert.equal(await queryOne("SELECT 1 FROM studio_library_previews WHERE id = $1", [old1]), null, "stale + unreferenced: purged");
  assert.ok(await queryOne("SELECT 1 FROM studio_library_previews WHERE id = $1", [old2]), "referenced: kept");
  assert.ok(await queryOne("SELECT 1 FROM studio_library_previews WHERE id = $1", [fresh]), "fresh: kept");
  await query("UPDATE studio_templates SET preview_id = NULL WHERE seed_key = 't01'");
});

test("preview route: IP rate limit (300 / min), like its sibling library routes (review MINOR-3)", { skip }, async () => {
  const ip = `10.66.${randomInt(0, 250)}.${randomInt(1, 250)}`;
  const get = async () => {
    const req = new Request(`http://localhost/api/media/library/preview/${"0".repeat(24)}`, { headers: { "x-forwarded-for": ip } });
    return (await inRequest(req, () => (previewRoute.GET as Handler)(req, { params: Promise.resolve({ id: "0".repeat(24) }) }))).status;
  };
  // The limiter is a fixed 60 s window on the wall clock: 301 calls that straddle a window boundary would start a new
  // count (CI flake 2026-11-03). Start with at least 15 s of the current window left.
  const left = 60_000 - (Date.now() % 60_000);
  if (left < 15_000) await new Promise((r) => setTimeout(r, left + 50));
  for (let i = 0; i < 300; i++) assert.equal(await get(), 404, `call ${i + 1}`);
  assert.equal(await get(), 429, "the 301st call in a minute");
});
