import "./helpers/next-request.mts";
import test from "node:test";
import assert from "node:assert/strict";
import { createIsolatedDb } from "./helpers/isolated-db.mts";
import { inRequest } from "./helpers/next-request.mts";

/**
 * Studio P8a (docs/studio/P8-SPEC.md «P8a»): with the dark switch `studio.legacy_fold` on, the old «Rasm» (`/uz/rasm`)
 * and «Video yaratish» (`/uz/video`) pages redirect to the Studio tabs (query kept), the bot keyboard «Rasm» button and
 * the AI chat knowledge link the Studio — all through ONE link builder (`lib/media/legacy-fold.ts`). Off = today.
 *
 * Pure part (no DB): the link builder, the bot keyboard and the two pages' wiring (from their source: they import the
 * client `ToolWorkspace`). DB part (real Postgres, isolated database): the fold service the pages call, the session flag,
 * the chat knowledge pack, the old tools' server price unchanged.
 *
 * Mutations (each turned a test red, then restored):
 *   M1. `legacyFoldTarget` ignores `legacyFold` (always folds) → «off: no target», «page off: the old form»;
 *   M2. the query is dropped on the redirect (only `tab`) → «query kept (bt)»;
 *   M3. the request's own `tab` wins over the fold's → «the fold's tab wins»;
 *   M4. `LEGACY_FOLD.video` mapped to `tab=rasm` → «video → video tab» (pure + page);
 *   M5. the keyboard ignores `opts.legacyFold` → «bot keyboard: fold on → Studio»;
 *   M6. the session route sends `legacyFold: false` constantly → «session: features.legacyFold follows the switch»;
 *   M7. the knowledge line printed regardless of the switch → «knowledge: Studio links only while on»;
 *   M8. `if (target) redirect(target);` removed from `app/uz/video/page.tsx` → «page wiring … video: redirects».
 */

process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters-long";
process.env.APP_URL = "https://slaydx.test";
process.env.WORKER_INLINE = "false";
delete process.env.BOT_PREMIUM_EMOJI;

const fold = await import("../lib/media/legacy-fold.ts");
const { TOOL_BY_ID, TOOLS } = await import("../lib/tools.ts");

test("link builder: off = today's /uz/<slug> for every tool; on = only image / video move to their Studio tab", () => {
  for (const t of TOOLS) {
    assert.equal(fold.toolHref(t, false), `/uz/${t.slug}`, `${t.id} off`);
    assert.equal(fold.toolHref(t, undefined), `/uz/${t.slug}`, `${t.id} unknown`);
  }
  assert.equal(fold.toolHref(TOOL_BY_ID.image, true), "/uz/studio?tab=rasm");
  assert.equal(fold.toolHref(TOOL_BY_ID.video, true), "/uz/studio?tab=video", "M4: video → video tab");
  const moved = TOOLS.filter((t) => fold.toolHref(t, true) !== `/uz/${t.slug}`).map((t) => t.id);
  assert.deepEqual(moved.sort(), ["image", "video"], "P8a folds exactly these two");
  // Every folded tab is a real Studio tab (`StudioPage` STUDIO_TABS; the UI test ui/studio-page opens them by `?tab=`).
  const studioTabs = ["rasm", "video", "ovoz", "audio"];
  for (const [id, q] of Object.entries(fold.LEGACY_FOLD)) assert.ok(studioTabs.includes(q.tab!), `${id}: ${q.tab}`);
});

test("redirect target: off / unknown tool → null; on → the tab with the rest of the query kept, the fold's tab wins", () => {
  assert.equal(fold.legacyFoldTarget("image", false, { bt: "x" }), null, "M1: off: no target");
  assert.equal(fold.legacyFoldTarget("slide", true, {}), null, "slide is not folded");
  assert.equal(fold.legacyFoldTarget("image", true, {}), "/uz/studio?tab=rasm");
  assert.equal(fold.legacyFoldTarget("image", true, undefined), "/uz/studio?tab=rasm");
  assert.equal(fold.legacyFoldTarget("video", true, null), "/uz/studio?tab=video");
  const u = new URL(fold.legacyFoldTarget("image", true, { bt: "AbC-12_", tgWebAppStartParam: "ref", multi: ["1", "2"], none: undefined })!, "https://x.test");
  assert.equal(u.pathname, "/uz/studio");
  assert.equal(u.searchParams.get("tab"), "rasm");
  assert.equal(u.searchParams.get("bt"), "AbC-12_", "M2: query kept (bt)");
  assert.equal(u.searchParams.get("tgWebAppStartParam"), "ref");
  assert.deepEqual(u.searchParams.getAll("multi"), ["1", "2"]);
  assert.ok(!u.searchParams.has("none"));
  const v = new URL(fold.legacyFoldTarget("video", true, { tab: "rasm" })!, "https://x.test");
  assert.deepEqual(v.searchParams.getAll("tab"), ["video"], "M3: the fold's tab wins");
});

test("bot keyboard: fold off → /uz/rasm (today); fold on → the Studio «Rasm» tab with the personal bt link; other tools unchanged", async () => {
  process.env.DATABASE_URL ||= "postgres://unused/unused";
  const kbd = await import("../lib/server/bot/keyboard.ts");
  type Btn = { text: string; web_app?: { url: string } };
  const urls = (opts: { legacyFold?: boolean }) =>
    (kbd.mainKeyboard("uz", 7_300_000_001, { llm: true, images: true }, opts) as { keyboard: Btn[][] }).keyboard
      .slice(0, 3)
      .flat()
      .map((b) => b.web_app!.url);
  const off = urls({});
  const on = urls({ legacyFold: true });
  assert.equal(new URL(off[4]!).pathname, "/uz/rasm");
  const img = new URL(on[4]!);
  assert.equal(`${img.pathname}?tab=${img.searchParams.get("tab")}`, "/uz/studio?tab=rasm", "M5: bot keyboard: fold on → Studio");
  assert.ok(img.searchParams.get("bt"), "the personal link token is still there");
  assert.deepEqual(on.map((u, i) => (i === 4 ? null : new URL(u).pathname)), off.map((u, i) => (i === 4 ? null : new URL(u).pathname)), "the other five buttons do not move");
  assert.equal(kbd.keyboardPath("image", true), fold.toolHref(TOOL_BY_ID.image, true), "the bot uses the web's builder");
  assert.equal(kbd.keyboardPath("files", true), null);
  // A blocked image tool stays a text button with the fold on (same block rule as today).
  const blocked = kbd.mainKeyboard("uz", 1, { llm: true, images: false }, { legacyFold: true }) as { keyboard: Btn[][] };
  assert.equal(blocked.keyboard[2]![0]!.web_app, undefined);
});

/*
 * The pages themselves import the client `ToolWorkspace` (it cannot load under `--conditions=react-server`), so their
 * wiring is locked from the source; the decision they call is tested on the DB below and the rendering in the browser
 * smoke (docs/studio/P8-SPEC.md «P8a — what shipped»).
 */
test("page wiring: /uz/rasm and /uz/video are dynamic, ask the fold service, redirect, else draw the old ToolWorkspace; [slug] leaves them", async () => {
  const { readFileSync } = await import("node:fs");
  const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  for (const [slug, id] of [
    ["rasm", "image"],
    ["video", "video"],
  ] as const) {
    assert.equal(TOOL_BY_ID[id].slug, slug);
    const page = src(`app/uz/${slug}/page.tsx`);
    assert.ok(page.includes(`const tool = TOOL_BY_ID.${id};`), `${slug}: its own tool`);
    assert.ok(page.includes('export const dynamic = "force-dynamic";'), `${slug}: read per request, not pre-rendered`);
    assert.ok(page.includes("const target = await legacyFoldRedirect(tool.id, await searchParams);"), `${slug}: asks the fold service with the query`);
    assert.ok(page.includes("if (target) redirect(target);"), `${slug}: redirects`);
    assert.ok(page.includes("return <ToolWorkspace tool={tool} />;"), `${slug}: else the old form`);
    assert.ok(page.includes("export const metadata: Metadata = { title: tool.title, description: tool.description };"), `${slug}: same metadata as [slug]`);
  }
  const slugPage = src("app/uz/[slug]/page.tsx");
  const own = /OWN_PAGE_SLUGS: readonly string\[\] = \[([^\]]*)\]/.exec(slugPage)?.[1] ?? "";
  for (const slug of ["rasm", "video"]) assert.ok(own.includes(`"${slug}"`), `[slug] must not pre-render ${slug}`);
});

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("legacyfold") : { isolated: false, drop: async () => {} };
const skip = !hasDb ? "DATABASE_URL yo'q" : iso.isolated ? false : "alohida Postgres baza yaratilmadi";

test("server: pages, session flag, chat knowledge follow studio.legacy_fold; the old tools' price is untouched", { skip }, async (t) => {
  const { query, migrate, pool } = await import("../lib/server/db.ts");
  const { setSetting, clearSetting } = await import("./helpers/chat-fixtures.mts");
  const knowledge = await import("../lib/server/chat/knowledge.ts");
  const { effectivePrice } = await import("../lib/server/pricing.ts");
  const sessionRoute = await import("../app/api/auth/session/route.ts");
  await migrate({ lockRetryDelayMs: 50 });
  t.after(async () => {
    await pool().end().catch(() => {});
    await iso.drop();
  });
  // The pages' own decision (`app/uz/rasm|video/page.tsx` call exactly this; the page wiring is locked above).
  const { legacyFoldRedirect } = await import("../lib/server/media/legacy-fold.ts");
  const redirected = (toolId: string, search: Record<string, string>) => legacyFoldRedirect(toolId, search);
  const session = async () => {
    const req = new Request("http://localhost/api/auth/session");
    const res = await inRequest(req, () => sessionRoute.GET(req));
    assert.equal(res.status, 200);
    return ((await res.json()) as { features: Record<string, unknown> }).features;
  };
  const prices = async () => [
    await effectivePrice(TOOL_BY_ID.image, { prompt: "olma", imageCount: 4, model: "openai" }),
    await effectivePrice(TOOL_BY_ID.video, { prompt: "Registon tongda", provider: "kling", seconds: 10 }),
  ];

  await t.test("off (default): the old forms render, the session says false, no Studio line in the knowledge", async () => {
    await clearSetting(query, "studio.legacy_fold");
    for (const id of ["image", "video"]) assert.equal(await redirected(id, { bt: "x" }), null, `M1: page off: the old form (${id})`);
    assert.equal((await session()).legacyFold, false);
    knowledge.invalidateKnowledgeCache();
    assert.ok(!(await knowledge.knowledgePack()).includes("/uz/studio"), "M7: knowledge: Studio links only while on");
  });
  const before = await prices();

  await t.test("on: both pages redirect to their tab (query kept), the session says true, the knowledge links the Studio", async () => {
    await setSetting(query, "studio.legacy_fold", true);
    assert.equal(await redirected("image", {}), "/uz/studio?tab=rasm");
    assert.equal(await redirected("video", {}), "/uz/studio?tab=video", "M4: page: video → video tab");
    assert.equal(await redirected("image", { bt: "tok" }), "/uz/studio?tab=rasm&bt=tok", "the bot link token survives the redirect");
    assert.equal(await redirected("slide", {}), null, "other tools never redirect");
    assert.equal((await session()).legacyFold, true, "M6: session: features.legacyFold follows the switch");
    knowledge.invalidateKnowledgeCache();
    const pack = await knowledge.knowledgePack();
    assert.ok(pack.includes("https://slaydx.test/uz/studio?tab=rasm") && pack.includes("https://slaydx.test/uz/studio?tab=video"), "M7");
    // Navigation only: the old tools are still chat tools at the same prices and keep their server price.
    assert.ok(pack.includes("- image |"), "the chat still proposes the old «Rasm» engine");
    assert.deepEqual(await prices(), before, "prices unchanged by the fold");
  });

  await t.test("off again: back to the old pages at once (no cache past the settings invalidation)", async () => {
    await setSetting(query, "studio.legacy_fold", false);
    assert.equal(await redirected("image", {}), null);
    assert.equal(await redirected("video", {}), null);
    await clearSetting(query, "studio.legacy_fold");
    knowledge.invalidateKnowledgeCache();
  });
});
