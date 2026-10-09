import test from "node:test";
import assert from "node:assert/strict";
import {
  canShareFile,
  copyToClipboard,
  isShareAbort,
  isShareableUrl,
  openTelegramShare,
  resolveShareUrl,
  shareFiles,
  shareLink,
  telegramShareHref,
  type ShareEnv,
  type ShareNavigator,
} from "../lib/share.ts";

/**
 * `lib/share.ts` with stubbed environments (docs/share/AUDIT.md): phone browser, desktop without
 * Web Share, Telegram phone, Telegram Desktop. The helper reads everything through `ShareEnv`, so
 * no DOM is needed here (the UI side is `tests/ui/share-everywhere.test.mts`).
 *
 * Mutations (each turned a test red, then restored):
 *   1. AbortError treated as a failure (`fallback`) → «AbortError is cancelled».
 *   2. the fallback removed (`unsupported` becomes `shared`/`cancelled`) → «no Web Share → fallback».
 *   3. Telegram's sheet skipped inside the Mini App → «Telegram phone / Telegram Desktop».
 *   4. `isShareableUrl` allows `?bt=` → «private links are never shareable».
 */

const GAME = "https://slaydx.uz/o/AbC123xyz";
const REF = "https://t.me/slaydx_bot?start=ref_k7m3p9qx";
const TEXT = "SlaydX — havola orqali kiring:";

type Calls = { shared: ShareData[]; tg: string[]; windows: string[]; canShare: ShareData[] };

function env(o: {
  nav?: ShareNavigator | null;
  inTelegram?: boolean;
  platform?: string | null;
  tgOpens?: boolean;
  windowOpens?: boolean;
} = {}): { env: ShareEnv; calls: Calls } {
  const calls: Calls = { shared: [], tg: [], windows: [], canShare: [] };
  return {
    calls,
    env: {
      nav: o.nav === null ? undefined : (o.nav ?? {}),
      inTelegram: o.inTelegram ?? false,
      telegramPlatform: o.platform ?? null,
      openTelegramLink: (u) => {
        calls.tg.push(u);
        return o.tgOpens ?? true;
      },
      openWindow: (u) => {
        calls.windows.push(u);
        return o.windowOpens ?? true;
      },
    },
  };
}

/** A `navigator` with Web Share; `share` records, `canShare` answers `can`. */
function webShare(calls: Calls, o: { can?: boolean; fail?: unknown } = {}): ShareNavigator {
  return {
    share: async (d) => {
      calls.shared.push(d);
      if (o.fail !== undefined) throw o.fail;
    },
    canShare: (d) => {
      calls.canShare.push(d);
      return o.can ?? true;
    },
  };
}

const abort = () => new DOMException("Share canceled", "AbortError");

/* ───────────────────────────── URL safety ───────────────────────────── */

test("isShareableUrl: public links pass — referral (bot and web) and the game link", () => {
  for (const u of [REF, "https://slaydx.uz/uz?ref=k7m3p9qx", GAME, "http://localhost:3000/o/abc"]) {
    assert.equal(isShareableUrl(u), true, u);
  }
});

test("isShareableUrl: private links are never shareable — ?bt= sign-in, signed /api/dl/ downloads, Telegram launch data, credentials, non-pages", () => {
  const bad = [
    "https://slaydx.uz/uz?bt=ticket123",
    "https://slaydx.uz/uz/files?x=1&BT=ticket123",
    "https://slaydx.uz/api/dl/signed-token",
    "https://slaydx.uz/api/generations/1/download",
    "https://slaydx.uz/uz#tgWebAppData=user%3D1%26hash%3Dabc",
    "https://slaydx.uz/uz?tgWebAppData=x",
    "https://user:pass@slaydx.uz/o/abc",
    "javascript:alert(1)",
    "ftp://slaydx.uz/o/abc",
    "/o/relative",
    "",
  ];
  for (const u of bad) assert.equal(isShareableUrl(u), false, `MUTATION 4: ${u}`);
  assert.equal(isShareableUrl(undefined), false);
  assert.equal(isShareableUrl(42), false);
});

test("resolveShareUrl: a same-origin path becomes absolute; an absolute URL is untouched", () => {
  assert.equal(resolveShareUrl("/o/abc", "https://slaydx.uz/uz/files/1"), "https://slaydx.uz/o/abc");
  assert.equal(resolveShareUrl(GAME, "https://other.test/"), GAME);
});

test("telegramShareHref: t.me/share/url with the encoded link and text; no text → an empty text parameter, still valid", () => {
  const u = new URL(telegramShareHref({ url: REF, text: TEXT }));
  assert.equal(u.origin + u.pathname, "https://t.me/share/url");
  assert.equal(u.searchParams.get("url"), REF);
  assert.equal(u.searchParams.get("text"), TEXT);
  const bare = new URL(telegramShareHref({ url: GAME }));
  assert.equal(bare.searchParams.get("url"), GAME);
  assert.equal(bare.searchParams.get("text"), "");
});

/* ───────────────────────────── native share ───────────────────────────── */

test("phone browser: navigator.share({url,title,text}) is called, synchronously inside the tap, and the result is `shared`", async () => {
  const { env: e, calls } = env();
  e.nav = webShare(calls);
  const pending = shareLink({ url: GAME, title: "SlaydX", text: TEXT }, e);
  assert.equal(calls.shared.length, 1, "share() is reached before the first await — the tap's user activation is still valid");
  assert.deepEqual(calls.shared[0], { url: GAME, title: "SlaydX", text: TEXT });
  assert.deepEqual(await pending, { status: "shared" });
  assert.deepEqual(calls.tg, []);
});

test("phone browser: only the given fields are sent (no empty title/text)", async () => {
  const { env: e, calls } = env();
  e.nav = webShare(calls);
  await shareLink({ url: GAME }, e);
  assert.deepEqual(calls.shared, [{ url: GAME }]);
});

test("desktop without Web Share (Firefox, Linux Chrome) → fallback `unsupported` — the caller shows the menu", async () => {
  for (const nav of [null, {}, { canShare: () => true }, { clipboard: { writeText: async () => {} } }]) {
    const { env: e } = env({ nav });
    assert.deepEqual(await shareLink({ url: GAME }, e), { status: "fallback", reason: "unsupported" }, "MUTATION 2");
  }
});

test("canShare says no for this data → fallback `unsupported`, share() is not called", async () => {
  const { env: e, calls } = env();
  e.nav = webShare(calls, { can: false });
  assert.deepEqual(await shareLink({ url: GAME }, e), { status: "fallback", reason: "unsupported" });
  assert.equal(calls.shared.length, 0);
  assert.equal(calls.canShare.length, 1);
});

test("AbortError is cancelled: no fallback, no error (the user closed the sheet)", async () => {
  const { env: e, calls } = env();
  e.nav = webShare(calls, { fail: abort() });
  assert.deepEqual(await shareLink({ url: GAME }, e), { status: "cancelled" }, "MUTATION 1");
  // A cross-realm / non-DOMException error with the same name counts as well.
  e.nav = webShare(calls, { fail: Object.assign(new Error("x"), { name: "AbortError" }) });
  assert.deepEqual(await shareLink({ url: GAME }, e), { status: "cancelled" });
  assert.equal(isShareAbort(abort()), true);
  assert.equal(isShareAbort(new Error("boom")), false);
  assert.equal(isShareAbort(null), false);
});

test("any other share failure falls back to the menu — never silent", async () => {
  for (const fail of [new DOMException("not allowed", "NotAllowedError"), new TypeError("bad"), new Error("boom"), "string error"]) {
    const { env: e, calls } = env();
    e.nav = webShare(calls, { fail });
    assert.deepEqual(await shareLink({ url: GAME }, e), { status: "fallback", reason: "error" }, String(fail));
  }
});

test("a private link is blocked before anything is called", async () => {
  const { env: e, calls } = env({ inTelegram: true });
  e.nav = webShare(calls);
  for (const url of ["https://slaydx.uz/uz?bt=abc", "https://slaydx.uz/api/dl/tok", "/o/relative"]) {
    assert.deepEqual(await shareLink({ url }, e), { status: "blocked" }, url);
  }
  assert.deepEqual([calls.shared.length, calls.tg.length, calls.windows.length], [0, 0, 0]);
});

/* ───────────────────────────── Telegram ───────────────────────────── */

test("Telegram phone and Telegram Desktop: Telegram's own sheet (t.me/share/url), the native sheet is not used", async () => {
  for (const platform of ["android", "ios", "tdesktop", "macos", "weba", "webk"]) {
    const { env: e, calls } = env({ inTelegram: true, platform });
    e.nav = webShare(calls);
    assert.deepEqual(await shareLink({ url: REF, text: TEXT }, e), { status: "telegram" }, `MUTATION 3: ${platform}`);
    assert.equal(calls.tg.length, 1, platform);
    const u = new URL(calls.tg[0]);
    assert.equal(u.origin + u.pathname, "https://t.me/share/url");
    assert.equal(u.searchParams.get("url"), REF);
    assert.equal(u.searchParams.get("text"), TEXT);
    assert.equal(calls.shared.length, 0, `${platform}: navigator.share is not relied on inside Telegram`);
  }
});

test("Telegram shell without the accessor (script not loaded): the native sheet, else the menu", async () => {
  const a = env({ inTelegram: true, platform: "tdesktop", tgOpens: false });
  a.env.nav = webShare(a.calls);
  assert.deepEqual(await shareLink({ url: REF }, a.env), { status: "shared" });
  assert.equal(a.calls.tg.length, 1, "Telegram was tried first");
  const b = env({ inTelegram: true, platform: "tdesktop", tgOpens: false, nav: null });
  assert.deepEqual(await shareLink({ url: REF }, b.env), { status: "fallback", reason: "unsupported" });
});

test("openTelegramShare: inside Telegram → openTelegramLink; elsewhere → a new tab; both failing → false; private link → false", () => {
  const tg = env({ inTelegram: true });
  assert.equal(openTelegramShare({ url: REF, text: TEXT }, tg.env), true);
  assert.equal(tg.calls.tg.length, 1);
  assert.equal(tg.calls.windows.length, 0);

  const web = env();
  assert.equal(openTelegramShare({ url: GAME, text: TEXT }, web.env), true);
  assert.equal(web.calls.tg.length, 0);
  assert.equal(new URL(web.calls.windows[0]).searchParams.get("url"), GAME);

  const noScript = env({ inTelegram: true, tgOpens: false });
  assert.equal(openTelegramShare({ url: GAME }, noScript.env), true, "no accessor → the new-tab route");
  assert.equal(noScript.calls.windows.length, 1);

  const blocked = env({ tgOpens: false, windowOpens: false, inTelegram: true });
  assert.equal(openTelegramShare({ url: GAME }, blocked.env), false);
  const bt = env();
  assert.equal(openTelegramShare({ url: "https://slaydx.uz/uz?bt=x" }, bt.env), false);
  assert.deepEqual([bt.calls.tg.length, bt.calls.windows.length], [0, 0]);
});

/* ───────────────────────────── files ───────────────────────────── */

test("canShareFile: needs share AND canShare(files) === true; Chromium's refusal and a throwing probe are `false`", () => {
  const f = { ext: "pdf", mime: "application/pdf" };
  const ok: ShareNavigator = { share: async () => {}, canShare: () => true };
  assert.equal(canShareFile(f, ok), true);
  assert.equal(canShareFile(f, { ...ok, canShare: () => false }), false, "e.g. DOCX/PPTX in Chromium");
  assert.equal(canShareFile(f, { canShare: () => true }), false, "no share()");
  assert.equal(canShareFile(f, { share: async () => {} }), false, "no canShare() — Firefox/Linux Chrome");
  assert.equal(canShareFile(f, undefined), false);
  assert.equal(canShareFile(f, { ...ok, canShare: () => { throw new Error("x"); } }), false);
  const seen: ShareData[] = [];
  canShareFile({ ext: "pptx", mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }, { share: async () => {}, canShare: (d: ShareData) => (seen.push(d), true) });
  assert.equal(seen[0].files?.[0].name, "fayl.pptx");
  assert.equal(seen[0].files?.[0].type, "application/vnd.openxmlformats-officedocument.presentationml.presentation");
});

test("shareFiles: shared / cancelled (AbortError) / fallback on any other error or no Web Share; the probe is not repeated", async () => {
  const file = new File(["x"], "deck.pdf", { type: "application/pdf" });
  const a = env();
  a.env.nav = webShare(a.calls, { can: false });
  assert.deepEqual(await shareFiles([file], { title: "T" }, a.env), { status: "shared" }, "canShare was probed before the download; it is not asked again");
  assert.deepEqual(a.calls.shared[0], { files: [file], title: "T" });
  assert.equal(a.calls.canShare.length, 0);

  const b = env();
  b.env.nav = webShare(b.calls, { fail: abort() });
  assert.deepEqual(await shareFiles([file], {}, b.env), { status: "cancelled" }, "MUTATION 1");

  const c = env();
  c.env.nav = webShare(c.calls, { fail: new DOMException("denied", "NotAllowedError") });
  assert.deepEqual(await shareFiles([file], {}, c.env), { status: "fallback", reason: "error" });

  assert.deepEqual(await shareFiles([file], {}, env({ nav: null }).env), { status: "fallback", reason: "unsupported" });
});

/* ───────────────────────────── clipboard ───────────────────────────── */

/** The few `document` members `copyToClipboard` touches. */
function fakeDoc(o: { exec?: boolean | "throw" } = {}) {
  const log: string[] = [];
  const area = {
    value: "",
    style: { cssText: "" },
    attrs: {} as Record<string, string>,
    setAttribute(k: string, v: string) {
      this.attrs[k] = v;
    },
    focus: () => void log.push("area.focus"),
    select: () => void log.push("area.select"),
    setSelectionRange: (a: number, b: number) => void log.push(`area.range ${a}-${b}`),
    remove: () => void log.push("area.remove"),
  };
  const previous = { focus: () => void log.push("previous.focus") };
  const doc = {
    activeElement: previous,
    body: { appendChild: () => void log.push("append") },
    createElement: () => area,
    execCommand: (c: string) => {
      log.push(`exec ${c}`);
      if (o.exec === "throw") throw new Error("no");
      return o.exec ?? true;
    },
  } as unknown as Document;
  return { doc, log, area };
}

test("copyToClipboard: the Clipboard API first; its result is `true` and the document is not touched", async () => {
  const written: string[] = [];
  const d = fakeDoc();
  const ok = await copyToClipboard(GAME, { nav: { clipboard: { writeText: async (t) => void written.push(t) } }, doc: d.doc });
  assert.equal(ok, true);
  assert.deepEqual(written, [GAME]);
  assert.deepEqual(d.log, []);
});

test("copyToClipboard: no Clipboard API (HTTP, old webview) → hidden textarea + execCommand('copy'), focus restored, node removed", async () => {
  const d = fakeDoc();
  assert.equal(await copyToClipboard(GAME, { nav: {}, doc: d.doc }), true);
  assert.equal(d.area.value, GAME);
  assert.equal(d.area.attrs.readonly, "");
  assert.ok(d.area.style.cssText.includes("font-size:16px"), "16 px so iOS does not zoom");
  assert.deepEqual(d.log, ["append", "area.focus", "area.select", `area.range 0-${GAME.length}`, "exec copy", "area.remove", "previous.focus"]);
});

test("copyToClipboard: a refused Clipboard API (permission) falls through to execCommand; both failing → false", async () => {
  const refuse: ShareNavigator = { clipboard: { writeText: async () => Promise.reject(new DOMException("denied", "NotAllowedError")) } };
  assert.equal(await copyToClipboard(GAME, { nav: refuse, doc: fakeDoc().doc }), true);
  assert.equal(await copyToClipboard(GAME, { nav: refuse, doc: fakeDoc({ exec: false }).doc }), false);
  assert.equal(await copyToClipboard(GAME, { nav: refuse, doc: fakeDoc({ exec: "throw" }).doc }), false);
  const d = fakeDoc({ exec: "throw" });
  await copyToClipboard(GAME, { nav: {}, doc: d.doc });
  assert.ok(d.log.includes("area.remove"), "the textarea is removed even when execCommand throws");
  assert.equal(await copyToClipboard(GAME, { nav: {}, doc: { activeElement: null } as unknown as Document }), false, "no execCommand at all");
});

test("copyToClipboard: with a visible field it selects THAT field (the user can finish by hand) instead of a hidden textarea", async () => {
  const log: string[] = [];
  const field = {
    isConnected: true,
    focus: () => void log.push("focus"),
    select: () => void log.push("select"),
    setSelectionRange: (a: number, b: number) => void log.push(`range ${a}-${b}`),
  } as unknown as HTMLInputElement;
  const d = fakeDoc();
  assert.equal(await copyToClipboard(GAME, { field, nav: {}, doc: d.doc }), true);
  assert.deepEqual(log, ["focus", "select", `range 0-${GAME.length}`]);
  assert.deepEqual(d.log, ["exec copy"], "no textarea was created");
});
