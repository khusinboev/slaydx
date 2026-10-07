import "./setup.ts";
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { ResultActions, toastDuration } from "../../components/files/ResultActions.tsx";
import { useAppStore } from "../../lib/store.ts";
import { compareVersions } from "../../lib/telegram-webapp.ts";
import { resetGesture } from "../../lib/downloads/deliver.ts";
import type { GenerationDetail, ServerUser } from "../../lib/api-client.ts";

/**
 * Result actions (docs/mobile/PLAN.md §4.5): «Yuklab olish» sheet state
 * machine, the one-format button, «Saqlash» and «Ulashish» capability
 * branches with a fake `Telegram.WebApp`, error codes → Uzbek toasts.
 * `fetch` is stubbed per route; Telegram methods record their calls.
 *
 * jsdom's origin is http://localhost, so Telegram `downloadFile` (https only)
 * answers `unsupported` here → the fallback rows; the https call itself is
 * pinned in `tests/download-deliver.test.mts`.
 */

const ID = "11111111-1111-4111-8111-111111111111";
const router: AppRouterInstance = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };
const realFetch = globalThis.fetch;
const realCreate = URL.createObjectURL;
const realClick = window.HTMLAnchorElement.prototype.click;
const w = window as unknown as Record<string, unknown>;
const nav = navigator as unknown as Record<string, unknown>;

type Call = { url: string; method: string; body?: string };
let calls: Call[] = [];
let saved: { name: string; size: number }[] = [];
let tgCalls: string[] = [];

const json = (status: number, data: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });
const exp = () => new Date(Date.now() + 15 * 60_000).toISOString();
const ready = (format: string, name = `deck.${format === "native" ? "pptx" : format === "pdf" ? "pdf" : "zip"}`) =>
  json(200, { state: "ready", url: `/api/dl/tok-${format}`, fileName: name, size: 2048, mime: "application/octet-stream", expiresAt: exp() });

type Route = (c: Call) => Response | Promise<Response> | undefined;

function stub(route: Route = () => undefined) {
  calls = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const c: Call = { url: String(input), method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : undefined };
    calls.push(c);
    const r = await route(c);
    if (r) return r;
    if (c.method === "POST" && c.url === `/api/generations/${ID}/download`) return ready(JSON.parse(c.body ?? "{}").format);
    if (c.url.startsWith("/api/dl/")) return new Response(new Uint8Array(2048), { status: 200, headers: { "content-length": "2048" } });
    return json(404, { error: "yo'q" });
  }) as typeof fetch;
}

const posts = (suffix: string) => calls.filter((c) => c.method === "POST" && c.url === `/api/generations/${ID}${suffix}`);

function fakeTelegram(o: { version?: string; platform?: string; userId?: number; share?: boolean; shareError?: string; writeAccess?: boolean } = {}) {
  const version = o.version ?? "8.0";
  const listeners: Record<string, ((p?: unknown) => void)[]> = {};
  w.TelegramWebviewProxy = { postEvent() {} };
  w.Telegram = {
    WebApp: {
      initData: "user=1",
      version,
      platform: o.platform ?? "android",
      initDataUnsafe: { user: { id: o.userId ?? 700 } },
      isVersionAtLeast: (v: string) => compareVersions(version, v) >= 0,
      downloadFile: (p: { url: string }, cb: (ok: boolean) => void) => {
        tgCalls.push(`download ${p.url}`);
        cb(true);
      },
      shareMessage: (id: string, cb: (ok: boolean) => void) => {
        tgCalls.push(`share ${id}`);
        cb(o.shareError ? false : (o.share ?? true));
        // tg-web-app.js: callback first, then `shareMessageFailed {error}`.
        if (o.shareError) for (const f of listeners.shareMessageFailed ?? []) f({ error: o.shareError });
      },
      requestWriteAccess: (cb: (ok: boolean) => void) => {
        tgCalls.push("writeAccess");
        cb(o.writeAccess ?? true);
      },
      close: () => tgCalls.push("close"),
      openLink: (u: string) => tgCalls.push(`openLink ${u}`),
      openTelegramLink: (u: string) => tgCalls.push(`openTg ${u}`),
      onEvent: (e: string, f: (p?: unknown) => void) => void (listeners[e] ??= []).push(f),
      offEvent: (e: string, f: (p?: unknown) => void) => {
        listeners[e] = (listeners[e] ?? []).filter((x) => x !== f);
      },
    },
  };
}

beforeEach(() => {
  tgCalls = [];
  saved = [];
  resetGesture();
  const blobs = new Map<string, Blob>();
  URL.createObjectURL = (b: Blob | MediaSource) => {
    const id = `blob:${blobs.size}`;
    blobs.set(id, b as Blob);
    return id;
  };
  window.HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    saved.push({ name: this.download, size: blobs.get(this.getAttribute("href") ?? "")?.size ?? -1 });
  };
});

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  URL.createObjectURL = realCreate;
  window.HTMLAnchorElement.prototype.click = realClick;
  delete w.TelegramWebviewProxy;
  delete w.Telegram;
  delete nav.canShare;
  delete nav.share;
});

function gen(patch: Partial<GenerationDetail> = {}): GenerationDetail {
  return {
    id: ID,
    type: "slide",
    topic: "Fotosintez jarayoni",
    status: "COMPLETED",
    createdAt: "2026-10-01T08:00:00.000Z",
    finishedAt: "2026-10-01T08:01:00.000Z",
    price: 3000,
    fileName: "deck.pptx",
    format: "pptx",
    progress: 100,
    step: "Tayyor",
    expiresAt: null,
    error: null,
    preview: null,
    html: null,
    doc: null,
    hasFile: true,
    docVersion: 1,
    fileVersion: 1,
    ...patch,
  } as GenerationDetail;
}

function mount(o: { g?: GenerationDetail; telegramId?: string | null } = {}) {
  useAppStore.setState({
    sessionChecked: true,
    loggedIn: true,
    features: { llm: true, images: true, telegram: true, telegramBot: "SlaydX_bot", devLogin: false, pdf: true, payments: { click: false, payme: false } },
    user: (o.telegramId === null ? { id: "u1", telegramId: null } : { id: "u1", telegramId: o.telegramId ?? "700" }) as unknown as ServerUser,
  });
  render(
    h(
      AppRouterContext.Provider,
      { value: router },
      h(ResultActions, {
        gen: o.g ?? gen(),
        lead: h("span", null, "lead"),
        editActions: null,
        fileStale: false,
        expired: false,
        hasResults: false,
        del: { armed: false, trigger: () => {} },
        deleting: false,
      }),
    ),
  );
}

const q = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const row = (id: string) => q(`[data-download-row="${id}"]`)!;
const state = (id: string) => row(id).getAttribute("data-row-state");
const status = (id: string) => row(id).querySelector("[data-row-status]")?.textContent ?? "";
const toast = () => q("[data-result-toast]");
/** A one-format material (translated text → TXT): «Saqlash» / «Ulashish» act straight from the button. */
const oneFormat = () =>
  gen({ type: "translation", format: "txt", fileName: "t.txt", doc: { meta: {}, translation: { sourceKind: "text" } } as unknown as GenerationDetail["doc"] });

async function click(el: Element) {
  await act(async () => {
    fireEvent.click(el);
  });
}
async function tap(el: Element) {
  await act(async () => {
    fireEvent.pointerDown(el);
    fireEvent.click(el);
  });
}
/**
 * T4 (docs/todo-2026-10-07): a material with several formats — «Saqlash» /
 * «Ulashish» open the format sheet, a row runs the action in that format.
 */
async function via(kind: "save" | "share", id = "native") {
  await tap(q(kind === "save" ? "[data-save-to-bot]" : "[data-share-button]")!);
  assert.equal(q("[data-download-sheet]")?.getAttribute("data-download-sheet"), kind, `${kind} sheet open`);
  await tap(row(id));
}

/* ───────────────────────────── sheet ───────────────────────────── */

test("sheet: rows from the registry (slide: PPTX, PDF, PNG ZIP), PDF and the stored file prepared on open (not the PNG ZIP), Escape closes", async () => {
  stub();
  mount();
  const btn = q("[data-download-button]")!;
  assert.match(btn.textContent ?? "", /Yuklab olish/);
  assert.equal(btn.getAttribute("aria-haspopup"), "dialog");
  await click(btn);
  const sheet = q("[data-download-sheet]")!;
  assert.ok(sheet, "sheet open");
  assert.equal(sheet.getAttribute("role"), "dialog");
  const labels = [...sheet.querySelectorAll("[data-download-row]")].map((r) => r.getAttribute("data-download-row"));
  assert.deepEqual(labels, ["native", "pdf", "slides-png"]);
  assert.match(row("native").textContent ?? "", /PowerPoint \(PPTX\)/);
  assert.match(row("slides-png").textContent ?? "", /Slaydlar rasm \(PNG, ZIP\)/);
  await waitFor(() => assert.equal(posts("/download").length, 2));
  assert.deepEqual(posts("/download").map((c) => JSON.parse(c.body!).format).sort(), ["native", "pdf"]);
  // The prepared size shows on the row (R1 §5: «PPTX · 8,1 MB» before downloading).
  await waitFor(() => assert.equal(row("native").querySelector("[data-row-status]")!.textContent, "Tahrirlash uchun · 2 KB"));
  assert.equal(state("native"), "idle", "prewarming does not change the row state");
  await act(async () => {
    fireEvent.keyDown(window, { key: "Escape" });
  });
  assert.ok(!q("[data-download-sheet]"), "Escape closed the sheet");
});

test("browser: a row delivers the prepared file (signed URL → blob → <a download>), «Yuklab olindi»; the prewarmed URL is reused", async () => {
  stub();
  mount();
  await click(q("[data-download-button]")!);
  await waitFor(() => assert.equal(posts("/download").length, 2));
  await tap(row("native"));
  await waitFor(() => assert.equal(state("native"), "done"));
  assert.match(row("native").textContent ?? "", /Yuklab olindi/);
  assert.deepEqual(saved, [{ name: "deck.pptx", size: 2048 }]);
  assert.equal(posts("/download").length, 2, "no second prepare for the native row");
  assert.ok(calls.some((c) => c.url === "/api/dl/tok-native"));
});

test("rows are independent: PDF preparing does not block the PNG row; a failing row shows the server text and «Qayta urinish», a retry works", async () => {
  let pdfRelease!: (r: Response) => void;
  let zipFails = true;
  stub((c) => {
    if (c.method !== "POST" || !c.body) return undefined;
    const f = JSON.parse(c.body).format;
    if (f === "pdf") return new Promise((r) => (pdfRelease = r));
    if (f === "slides-png" && zipFails) return json(429, { error: "Juda ko'p so'rov", code: "rate_limited" }, { "retry-after": "12" });
    return undefined;
  });
  mount();
  await click(q("[data-download-button]")!);
  await tap(row("pdf"));
  assert.equal(state("pdf"), "preparing");
  assert.match(row("pdf").querySelector("[data-row-status]")!.textContent ?? "", /^PDF tayyorlanmoqda… \(odatda 5–15 soniya\) \d+ s$/);
  await tap(row("slides-png"));
  await waitFor(() => assert.equal(state("slides-png"), "error"));
  assert.match(row("slides-png").textContent ?? "", /Juda ko'p so'rov \(qayta urinish: 12 soniyadan keyin\)/);
  assert.match(row("slides-png").textContent ?? "", /Qayta urinish/);
  assert.equal(state("pdf"), "preparing", "the PDF row kept its own state");
  zipFails = false;
  await tap(row("slides-png"));
  await waitFor(() => assert.equal(state("slides-png"), "done"));
  await act(async () => pdfRelease(ready("pdf")));
  await waitFor(() => assert.equal(state("pdf"), "done"));
  assert.deepEqual(saved.map((s) => s.name).sort(), ["deck.pdf", "deck.zip"]);
});

test("double tap on a row starts one preparation", async () => {
  let release!: (r: Response) => void;
  stub((c) => (c.body && JSON.parse(c.body).format === "slides-png" ? new Promise((r) => (release = r)) : undefined));
  mount();
  await click(q("[data-download-button]")!);
  await tap(row("slides-png"));
  await tap(row("slides-png"));
  assert.equal(posts("/download").filter((c) => JSON.parse(c.body!).format === "slides-png").length, 1);
  await act(async () => release(ready("slides-png")));
  await waitFor(() => assert.equal(state("slides-png"), "done"));
  assert.equal(saved.length, 1);
});

/* ───────────────────────────── Telegram download ───────────────────────────── */

test("Telegram: a tap older than the gesture window → «Tayyor — yuklab olish» (downloadFile not called); the next tap delivers", async () => {
  fakeTelegram();
  stub();
  mount();
  await click(q("[data-download-button]")!);
  await waitFor(() => assert.equal(posts("/download").length, 2));
  // A click with no pointerdown: no gesture recorded → stale.
  await click(row("native"));
  await waitFor(() => assert.equal(state("native"), "ready"));
  assert.match(row("native").textContent ?? "", /Tayyor — yuklab olish uchun bosing/);
  assert.equal(tgCalls.filter((c) => c.startsWith("download")).length, 0, "no downloadFile outside the gesture window");
  // The next real tap: delivered (jsdom is http → Telegram says unsupported → fallback rows, see below).
  await tap(row("native"));
  await waitFor(() => assert.equal(state("native"), "fallback"));
});

test("Telegram refused/unsupported → «Botga yuborish» (save route, row format; 202 preparing polled) and «Brauzerda ochish» (openLink, absolute URL)", async () => {
  fakeTelegram();
  let saves = 0;
  stub((c) => {
    if (c.url === `/api/generations/${ID}/telegram/save`) {
      saves++;
      return saves === 1 ? json(202, { state: "preparing", retryAfterMs: 500 }) : json(200, { ok: true, duplicate: false, format: "pdf", botUrl: "https://t.me/SlaydX_bot" });
    }
    return undefined;
  });
  mount();
  await click(q("[data-download-button]")!);
  await tap(row("pdf"));
  await waitFor(() => assert.equal(state("pdf"), "fallback"));
  const item = q('[data-download-item="pdf"]')!;
  assert.match(item.textContent ?? "", /Telegram ilovangiz eski — faylni botga yuboramizmi\?/);
  await click(item.querySelector("[data-fallback-browser]")!);
  assert.deepEqual(tgCalls.filter((c) => c.startsWith("openLink")), ["openLink http://localhost/api/dl/tok-pdf"]);
  assert.equal(state("pdf"), "done");
  // Back to fallback via the native row and send it to the bot.
  await tap(row("native"));
  await waitFor(() => assert.equal(state("native"), "fallback"));
  await click(q('[data-download-item="native"] [data-fallback-bot]')!);
  await waitFor(() => assert.equal(state("native"), "done"), { timeout: 3000 });
  assert.match(row("native").textContent ?? "", /✅ Fayl bot chatiga yuborildi/);
  assert.deepEqual(posts("/telegram/save").map((c) => c.body), [JSON.stringify({ format: "native" }), JSON.stringify({ format: "native" })], "polled with the same body");
});

test("one-format tool skips the sheet; a Telegram refusal opens the sheet on that row's fallback", async () => {
  const translation = gen({ type: "translation", format: "txt", fileName: "t.txt", doc: { meta: {}, translation: { sourceKind: "text" } } as unknown as GenerationDetail["doc"] });
  stub();
  mount({ g: translation });
  const btn = q("[data-download-button]")!;
  assert.ok(!btn.hasAttribute("aria-haspopup"), "no sheet for one format");
  await tap(btn);
  await waitFor(() => assert.equal(btn.getAttribute("data-row-state"), "done"));
  assert.ok(!q("[data-download-sheet]"));
  assert.match(btn.textContent ?? "", /Yuklab olindi/);
  assert.deepEqual(saved, [{ name: "deck.pptx", size: 2048 }]);
  cleanup();
  fakeTelegram({ version: "7.0" });
  stub();
  mount({ g: translation });
  await tap(q("[data-download-button]")!);
  await waitFor(() => assert.ok(q("[data-download-sheet]"), "sheet opened for the fallback"));
  assert.equal(state("native"), "fallback");
});

/* ───────────────────────────── «Saqlash» ───────────────────────────── */

test("«Saqlash» hidden without a Telegram id", async () => {
  stub();
  mount({ telegramId: null });
  assert.ok(!q("[data-save-to-bot]"));
  assert.ok(q("[data-share-button]"), "«Ulashish» stays (download fallback)");
});

// T4 rewrite (was: one tap on «Saqlash» POSTed `{}` at once). Several formats → the save sheet first; the
// stored-file row (first) sends `{format:"native"}`; double tap on the row = one request; same toast and close().
test("«Saqlash» in Telegram (slide): the button opens the save sheet (nothing sent); the stored-file row saves it — toast «✅ Fayl bot chatiga yuborildi», sheet closes, close() after ~1 s; double tap = one request", async () => {
  fakeTelegram();
  let release!: (r: Response) => void;
  stub((c) => (c.url.endsWith("/telegram/save") ? new Promise((r) => (release = r)) : undefined));
  mount();
  const b = q("[data-save-to-bot]")!;
  assert.equal(b.getAttribute("aria-haspopup"), "dialog");
  await tap(b);
  assert.equal(q("[data-download-sheet]")?.getAttribute("data-download-sheet"), "save");
  assert.equal(posts("/telegram/save").length, 0, "opening the sheet sends nothing");
  await tap(row("native"));
  await tap(row("native"));
  assert.equal(posts("/telegram/save").length, 1, "the row ignores a second tap while in flight");
  assert.equal(posts("/telegram/save")[0].body, JSON.stringify({ format: "native" }), "the stored file, named explicitly");
  assert.equal(state("native"), "delivering");
  assert.equal(status("native"), "Botga yuborilmoqda…");
  await act(async () => release(json(200, { ok: true, duplicate: false, format: "native", botUrl: "https://t.me/SlaydX_bot" })));
  await waitFor(() => assert.match(toast()?.textContent ?? "", /✅ Fayl bot chatiga yuborildi/));
  assert.ok(!q("[data-download-sheet]"), "success closes the sheet");
  assert.ok(!tgCalls.includes("close"), "not closed immediately");
  await act(async () => new Promise((r) => setTimeout(r, 1_150)));
  assert.ok(tgCalls.includes("close"), "Mini App closed after the toast");
});

test("«Saqlash» one-format tool: no sheet — saves from the button with its only format; double tap = one request; close() after ~1 s", async () => {
  fakeTelegram();
  let release!: (r: Response) => void;
  stub((c) => (c.url.endsWith("/telegram/save") ? new Promise((r) => (release = r)) : undefined));
  mount({ g: oneFormat() });
  const b = q("[data-save-to-bot]")!;
  assert.ok(!b.hasAttribute("aria-haspopup"), "no picker for one format");
  await tap(b);
  await tap(b);
  assert.ok(!q("[data-download-sheet]"), "no sheet");
  assert.equal(posts("/telegram/save").length, 1, "disabled while in flight");
  assert.equal(posts("/telegram/save")[0].body, JSON.stringify({ format: "native" }));
  await act(async () => release(json(200, { ok: true, duplicate: false, format: "native", botUrl: "https://t.me/SlaydX_bot" })));
  await waitFor(() => assert.match(toast()?.textContent ?? "", /✅ Fayl bot chatiga yuborildi/));
  await act(async () => new Promise((r) => setTimeout(r, 1_150)));
  assert.ok(tgCalls.includes("close"));
});

test("«Saqlash»: 409 bot_unreachable → requestWriteAccess → allowed → one retry succeeds", async () => {
  fakeTelegram({ writeAccess: true });
  let n = 0;
  stub((c) => {
    if (!c.url.endsWith("/telegram/save")) return undefined;
    n++;
    return n === 1
      ? json(409, { error: "Bot sizga yoza olmadi", code: "bot_unreachable", botUrl: "https://t.me/SlaydX_bot" })
      : json(200, { ok: true, duplicate: false, format: "native", botUrl: "https://t.me/SlaydX_bot" });
  });
  mount();
  await via("save"); // T4: through the save sheet (was one tap on «Saqlash»)
  await waitFor(() => assert.match(toast()?.textContent ?? "", /✅/));
  assert.deepEqual(tgCalls.filter((c) => c === "writeAccess"), ["writeAccess"]);
  assert.equal(posts("/telegram/save").length, 2);
  assert.deepEqual(posts("/telegram/save").map((c) => c.body), [JSON.stringify({ format: "native" }), JSON.stringify({ format: "native" })], "the retry keeps the format");
});

// T4 rewrite: in the sheet the row carries the error and «Botni ochish» (the toast would cover it); the
// toast form (was this test) is kept for the one-format button below.
test("«Saqlash» sheet: bot unreachable and write access declined → the row says the Uzbek text (alert) + «Botni ochish» (openTelegramLink); no toast over the sheet", async () => {
  fakeTelegram({ writeAccess: false });
  stub((c) => (c.url.endsWith("/telegram/save") ? json(409, { error: "x", code: "bot_unreachable", botUrl: "https://t.me/SlaydX_bot" }) : undefined));
  mount();
  await via("save");
  await waitFor(() => assert.equal(state("native"), "error"));
  assert.match(status("native"), /^Bot sizga yoza olmadi\. Botni ochib \/start bosing/);
  assert.equal(row("native").querySelector("[data-row-status]")!.getAttribute("role"), "alert");
  assert.match(row("native").textContent ?? "", /Qayta urinish/);
  assert.ok(!toast(), "the open sheet's row shows it");
  const link = q('[data-download-item="native"] [data-row-link]')!;
  assert.equal(link.textContent, "Botni ochish");
  await click(link);
  assert.ok(tgCalls.includes("openTg https://t.me/SlaydX_bot"));
  assert.equal(posts("/telegram/save").length, 1, "no retry without permission");
});

test("«Saqlash» one-format: bot unreachable and write access declined → Uzbek text + «Botni ochish» (openTelegramLink)", async () => {
  fakeTelegram({ writeAccess: false });
  stub((c) => (c.url.endsWith("/telegram/save") ? json(409, { error: "x", code: "bot_unreachable", botUrl: "https://t.me/SlaydX_bot" }) : undefined));
  mount({ g: oneFormat() });
  await tap(q("[data-save-to-bot]")!);
  await waitFor(() => assert.ok(toast()));
  assert.equal(toast()!.getAttribute("role"), "alert");
  assert.match(toast()!.textContent ?? "", /Bot sizga yoza olmadi\. Botni ochib \/start bosing/);
  const link = toast()!.querySelector("[data-toast-link]") as HTMLAnchorElement;
  assert.equal(link.getAttribute("href"), "https://t.me/SlaydX_bot");
  await click(link);
  assert.ok(tgCalls.includes("openTg https://t.me/SlaydX_bot"));
  assert.equal(posts("/telegram/save").length, 1, "no retry without permission");
});

test("«Saqlash»: the Mini App user is another Telegram account → refused, nothing sent", async () => {
  fakeTelegram({ userId: 999 });
  stub();
  mount({ telegramId: "700" });
  await tap(q("[data-save-to-bot]")!);
  assert.match(toast()?.textContent ?? "", /Bu Telegram akkaunti boshqa SlaydX akkauntiga kirgan/);
  assert.ok(!q("[data-download-sheet]"), "T4: refused before the format sheet opens");
  assert.equal(posts("/telegram/save").length, 0);
  // The one-format button refuses the same way.
  cleanup();
  fakeTelegram({ userId: 999 });
  stub();
  mount({ g: oneFormat(), telegramId: "700" });
  await tap(q("[data-save-to-bot]")!);
  assert.match(toast()?.textContent ?? "", /Bu Telegram akkaunti boshqa SlaydX akkauntiga kirgan/);
  assert.equal(posts("/telegram/save").length, 0);
});

// T4 rewrite: the same server text, now on the sheet row (was the toast after one tap).
test("«Saqlash» errors → Uzbek server text on the row (503 telegram_unavailable with the exact retry time)", async () => {
  fakeTelegram();
  stub((c) => (c.url.endsWith("/telegram/save") ? json(503, { error: "Telegram hozir javob bermayapti. Birozdan keyin qayta urinib ko'ring.", code: "telegram_unavailable", retryAfter: 30 }) : undefined));
  mount();
  await via("save");
  // UX review m12: the exact time replaces «Birozdan keyin», no second «(qayta urinish: …)».
  await waitFor(() => assert.equal(state("native"), "error"));
  assert.match(status("native"), /^Telegram hozir javob bermayapti\. 30 soniyadan keyin qayta urinib ko'ring\.(?!.*qayta urinish)/);
  assert.ok(q("[data-download-sheet]"), "an error keeps the sheet open (retry is one tap)");
  assert.ok(!tgCalls.includes("close"));
});

/* ───────────────────────────── «Ulashish» ───────────────────────────── */

// T4 rewrite (was one tap on «Ulashish»): the share sheet's stored-file row → the same request and picker.
test("«Ulashish» Telegram ≥ 8.0: share sheet → stored-file row → POST share {format:native} → shareMessage(preparedId) → «Ulashildi», sheet closes", async () => {
  fakeTelegram({ share: true });
  stub((c) => (c.url.endsWith("/telegram/share") ? json(200, { preparedId: "prep-1", expiresAt: exp(), format: "native", botUrl: null }) : undefined));
  mount();
  await via("share");
  await waitFor(() => assert.match(toast()?.textContent ?? "", /Ulashildi/));
  assert.deepEqual(tgCalls, ["share prep-1"]);
  assert.equal(posts("/telegram/share")[0].body, JSON.stringify({ format: "native" }));
  assert.ok(!q("[data-download-sheet]"), "success closes the sheet");
});

test("«Ulashish» one-format tool: no sheet — POST share with the only format → shareMessage → «Ulashildi»", async () => {
  fakeTelegram({ share: true });
  stub((c) => (c.url.endsWith("/telegram/share") ? json(200, { preparedId: "prep-1", expiresAt: exp(), format: "native", botUrl: null }) : undefined));
  mount({ g: oneFormat() });
  assert.ok(!q("[data-share-button]")!.hasAttribute("aria-haspopup"));
  await tap(q("[data-share-button]")!);
  await waitFor(() => assert.match(toast()?.textContent ?? "", /Ulashildi/));
  assert.ok(!q("[data-download-sheet]"));
  assert.deepEqual(tgCalls, ["share prep-1"]);
  assert.equal(posts("/telegram/share")[0].body, JSON.stringify({ format: "native" }));
});

// T4 rewrite: both branches through the share sheet (was one tap); the forwarded file keeps the row's format.
test("«Ulashish»: 501 share_unavailable (inline mode off) → save + «u yerdan uzating»; old client → save directly", async () => {
  fakeTelegram();
  stub((c) => {
    if (c.url.endsWith("/telegram/share")) return json(501, { error: "x", code: "share_unavailable" });
    if (c.url.endsWith("/telegram/save")) return json(200, { ok: true, duplicate: false, format: "native", botUrl: null });
    return undefined;
  });
  mount();
  await via("share");
  await waitFor(() => assert.match(toast()?.textContent ?? "", /Fayl bot chatiga yuborildi — u yerdan uzating/));
  assert.equal(posts("/telegram/save").length, 1);
  assert.equal(posts("/telegram/save")[0].body, JSON.stringify({ format: "native" }));
  assert.ok(!tgCalls.some((c) => c.startsWith("share")));
  cleanup();
  fakeTelegram({ version: "7.10" });
  stub((c) => (c.url.endsWith("/telegram/save") ? json(200, { ok: true, duplicate: false, format: "pdf", botUrl: null }) : undefined));
  mount();
  await via("share", "pdf");
  await waitFor(() => assert.match(toast()?.textContent ?? "", /u yerdan uzating/));
  assert.equal(posts("/telegram/share").length, 0, "7.x never asks for a prepared message");
  assert.deepEqual(posts("/telegram/save").map((c) => c.body), [JSON.stringify({ format: "pdf" })], "the chosen format is forwarded");
});

// T4 rewrite: the two taps now happen on the sheet row (the row shows «Tayyor — ulashish uchun bosing», the
// header button is marked ready too); the toast that asked for a second «Ulashish» tap is not shown over the sheet.
test("«Ulashish» in a browser with file Web Share: two taps on the row — fetch first, then navigator.share with the File", async () => {
  const shared: File[][] = [];
  nav.canShare = () => true;
  nav.share = async (d: { files: File[] }) => void shared.push(d.files);
  stub();
  mount();
  await via("share");
  await waitFor(() => assert.equal(state("native"), "ready"));
  assert.equal(status("native"), "Tayyor — ulashish uchun bosing");
  assert.equal(q("[data-share-button]")!.getAttribute("data-share-ready"), "1");
  assert.ok(!toast(), "the row says it; no toast over the sheet");
  assert.equal(shared.length, 0, "no share() after an async fetch (activation lost)");
  await tap(row("native"));
  await waitFor(() => assert.equal(shared.length, 1));
  assert.equal(shared[0][0].name, "deck.pptx");
  assert.equal(shared[0][0].size, 2048);
  assert.ok(!q("[data-download-sheet]"), "shared: the sheet closes");
});

test("«Ulashish» one-format in a browser with file Web Share: two taps on the button (toast asks for the second)", async () => {
  const shared: File[][] = [];
  nav.canShare = () => true;
  nav.share = async (d: { files: File[] }) => void shared.push(d.files);
  stub();
  mount({ g: oneFormat() });
  const b = q("[data-share-button]")!;
  await tap(b);
  await waitFor(() => assert.equal(b.getAttribute("data-share-ready"), "1"));
  assert.match(toast()?.textContent ?? "", /Tayyor — «Ulashish»ni yana bir bor bosing/);
  assert.equal(shared.length, 0);
  await tap(b);
  await waitFor(() => assert.equal(shared.length, 1));
  assert.equal(shared[0][0].size, 2048);
});

test("«Ulashish» with no share capability falls back to the download sheet", async () => {
  stub();
  mount({ telegramId: null });
  await tap(q("[data-share-button]")!);
  assert.equal(q("[data-download-sheet]")?.getAttribute("data-download-sheet"), "download");
  // UX review m13: the user asked to share — say why a download list opened.
  assert.equal(toast()?.textContent?.replace(/\s+$/, ""), "Bu brauzer faylni ulasha olmaydi — yuklab olib, o‘zingiz yuboring");
  assert.equal(toast()!.getAttribute("data-result-toast"), "info");
});

test("overflow «Boshqa formatda saqlash…» → sheet in save mode → PDF → POST save {format:pdf}", async () => {
  fakeTelegram();
  stub((c) => (c.url.endsWith("/telegram/save") ? json(200, { ok: true, duplicate: false, format: "pdf", botUrl: null }) : undefined));
  mount();
  await click(q("[data-more-button]")!);
  await click(q('[data-menu-item="save-other"]')!);
  const sheet = q("[data-download-sheet]")!;
  assert.equal(sheet.getAttribute("data-download-sheet"), "save");
  await tap(row("pdf"));
  await waitFor(() => assert.equal(posts("/telegram/save").length, 1));
  assert.equal(posts("/telegram/save")[0].body, JSON.stringify({ format: "pdf" }));
  assert.ok(!q("[data-download-sheet]"), "the picker closed");
});

test("contract additions: share 409 telegram_id_unsupported → saved to the bot instead; 202 {state, retryAfterMs, format} polled; save 413 too_large → Uzbek text", async () => {
  fakeTelegram();
  let saves = 0;
  stub((c) => {
    if (c.url.endsWith("/telegram/share")) {
      return json(409, { error: "Bu Telegram akkaunti bilan ulashib bo'lmadi — «Saqlash» yoki «Yuklab olish» dan foydalaning.", code: "telegram_id_unsupported" });
    }
    if (c.url.endsWith("/telegram/save")) {
      saves++;
      if (saves === 1) return json(202, { state: "preparing", retryAfterMs: 500, format: "native" });
      if (saves === 2) return json(200, { ok: true, duplicate: false, format: "native", botUrl: null });
      return json(413, { error: "Fayl Telegram uchun juda katta — «Yuklab olish» dan foydalaning.", code: "too_large" });
    }
    return undefined;
  });
  mount();
  // T4: both actions through their sheets (was one tap each); the save error is on the row.
  await via("share");
  await waitFor(() => assert.match(toast()?.textContent ?? "", /Fayl bot chatiga yuborildi — u yerdan uzating/), { timeout: 3000 });
  assert.equal(saves, 2, "202 then 200 (the same request repeated)");
  assert.ok(!tgCalls.some((c) => c.startsWith("share")), "no picker without a prepared message");
  await via("save");
  await waitFor(() => assert.equal(state("native"), "error"));
  assert.match(status("native"), /^Fayl Telegram uchun juda katta — «Yuklab olish» dan foydalaning\./);
  assert.equal(row("native").querySelector("[data-row-status]")!.getAttribute("role"), "alert");
});

/* ───────────────────────────── UX review fixes ───────────────────────────── */

test("M1 toastDuration: a toast with an action stays until dismissed; errors 10 s; confirmations 4.5 s", () => {
  assert.equal(toastDuration({ tone: "error", link: { label: "Botni ochish", href: "https://t.me/SlaydX_bot" } }), null);
  assert.equal(toastDuration({ tone: "ok", link: { label: "Botni ochish", href: "https://t.me/SlaydX_bot" } }), null);
  assert.equal(toastDuration({ tone: "error" }), 10_000);
  assert.equal(toastDuration({ tone: "ok" }), 4_500);
  assert.equal(toastDuration({ tone: "info" }), 4_500);
});

// T4: the toast form lives on the one-format button now (a sheet row carries the link itself, see above).
test("M1 «Botni ochish» toast is still there after 5 s; acting on the link dismisses it", async () => {
  fakeTelegram({ writeAccess: false });
  stub((c) => (c.url.endsWith("/telegram/save") ? json(409, { error: "x", code: "bot_unreachable", botUrl: "https://t.me/SlaydX_bot" }) : undefined));
  mount({ g: oneFormat() });
  await tap(q("[data-save-to-bot]")!);
  await waitFor(() => assert.ok(toast()?.querySelector("[data-toast-link]")));
  await act(async () => new Promise((r) => setTimeout(r, 5_000)));
  assert.ok(toast(), "an actionable toast does not auto-hide after 4.5 s");
  await click(toast()!.querySelector("[data-toast-link]")!);
  assert.ok(tgCalls.includes("openTg https://t.me/SlaydX_bot"));
  assert.ok(!toast(), "acting on it closes it");
});

test("M2 iOS Telegram: a click with no recent tap does not ask for a second tap (no «Tayyor — yuklab olish»)", async () => {
  fakeTelegram({ platform: "ios" });
  stub();
  mount();
  await click(q("[data-download-button]")!);
  await waitFor(() => assert.equal(posts("/download").length, 2));
  await click(row("native")); // no pointerdown → the gesture is stale
  // jsdom is http: Telegram answers «unsupported» → fallback; the point is it went straight to delivery.
  await waitFor(() => assert.equal(state("native"), "fallback"));
  cleanup();
  fakeTelegram({ platform: "android" });
  stub();
  mount();
  await click(q("[data-download-button]")!);
  await waitFor(() => assert.equal(posts("/download").length, 2));
  await click(row("native"));
  await waitFor(() => assert.equal(state("native"), "ready"), { timeout: 2000 });
});

test("m1 fallback text is shown once", async () => {
  fakeTelegram({ version: "7.0" });
  stub();
  mount();
  await click(q("[data-download-button]")!);
  await tap(row("native"));
  await waitFor(() => assert.equal(state("native"), "fallback"));
  const text = q('[data-download-item="native"]')!.textContent ?? "";
  assert.equal(text.split("Telegram ilovangiz eski").length - 1, 1);
  assert.ok(q('[data-download-item="native"] [data-fallback-bot]'));
});

test("m4 a busy row keeps focus (aria-disabled, not disabled) and ignores taps", async () => {
  let release!: (r: Response) => void;
  stub((c) => (c.body && JSON.parse(c.body).format === "slides-png" ? new Promise((r) => (release = r)) : undefined));
  mount();
  await click(q("[data-download-button]")!);
  const r = row("slides-png") as HTMLButtonElement;
  r.focus();
  await tap(r);
  assert.equal(state("slides-png"), "preparing");
  assert.equal(r.disabled, false);
  assert.equal(r.getAttribute("aria-disabled"), "true");
  assert.equal(document.activeElement, r, "focus stays on the row (the dialog's Tab trap keeps working)");
  await tap(r);
  assert.equal(posts("/download").filter((c) => JSON.parse(c.body!).format === "slides-png").length, 1);
  await act(async () => release(ready("slides-png")));
  await waitFor(() => assert.equal(state("slides-png"), "done"));
  assert.equal(document.activeElement, r);
});

// T4: the button label is pinned on the one-format button (a slide now converts from the sheet row, next test).
test("m3 while the route converts the button never shows a bare «N s»", async () => {
  fakeTelegram();
  let hold!: (r: Response) => void;
  let n = 0;
  stub((c) => {
    if (!c.url.endsWith("/telegram/save")) return undefined;
    n++;
    return n === 1 ? json(202, { state: "preparing", retryAfterMs: 500, format: "native" }) : new Promise((r) => (hold = r));
  });
  mount({ g: oneFormat() });
  const b = q("[data-save-to-bot]")!;
  await tap(b);
  await waitFor(() => assert.ok(b.querySelector("[data-action-progress]")), { timeout: 3000 });
  await waitFor(() => assert.equal(n, 2), { timeout: 3000 });
  assert.match(b.querySelector("[data-action-progress]")!.textContent ?? "", /^Tayyorlanmoqda… \d+ s$/);
  assert.match(b.textContent ?? "", /Saqlash/, "phones keep the verb");
  assert.doesNotMatch(b.textContent ?? "", /^\d+ s$/);
  await act(async () => hold(json(200, { ok: true, duplicate: false, format: "native", botUrl: null })));
  await waitFor(() => assert.ok(!b.querySelector("[data-action-progress]")));
});

test("T4 202 preparing on a sheet row: «PDF tayyorlanmoqda… (odatda 5–15 soniya) N s», the same body polled, then sent", async () => {
  fakeTelegram();
  let hold!: (r: Response) => void;
  let n = 0;
  stub((c) => {
    if (!c.url.endsWith("/telegram/save")) return undefined;
    n++;
    return n === 1 ? json(202, { state: "preparing", retryAfterMs: 500, format: "pdf" }) : new Promise((r) => (hold = r));
  });
  mount();
  await via("save", "pdf");
  await waitFor(() => assert.equal(state("pdf"), "preparing"));
  assert.match(status("pdf"), /^PDF tayyorlanmoqda… \(odatda 5–15 soniya\) \d+ s$/);
  await waitFor(() => assert.equal(n, 2), { timeout: 3000 });
  assert.deepEqual(posts("/telegram/save").map((c) => c.body), [JSON.stringify({ format: "pdf" }), JSON.stringify({ format: "pdf" })]);
  await act(async () => hold(json(200, { ok: true, duplicate: false, format: "pdf", botUrl: null })));
  await waitFor(() => assert.match(toast()?.textContent ?? "", /✅ Fayl bot chatiga yuborildi/));
});

// T4 rewrite: through the share sheet; the second expiry's message is on the row (was a toast).
test("m5 a second MESSAGE_EXPIRED in a row ends with a message, not silence", async () => {
  fakeTelegram({ shareError: "MESSAGE_EXPIRED" });
  stub((c) => (c.url.endsWith("/telegram/share") ? json(200, { preparedId: `p${calls.length}`, expiresAt: exp(), format: "native", botUrl: null }) : undefined));
  mount();
  await via("share");
  await waitFor(() => assert.equal(state("native"), "error"));
  assert.equal(status("native"), "Ulashish havolasi eskirdi — qayta urinib ko‘ring");
  assert.equal(posts("/telegram/share").length, 2, "one re-prepare, then the message");
});

test("m6 leaving the page aborts the preparation polling", async () => {
  // The first answer per format is `preparing`; the poll after it hangs until its signal aborts.
  const hanging: AbortSignal[] = [];
  const seen = new Set<string>();
  calls = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const body = typeof init?.body === "string" ? init.body : undefined;
    calls.push({ url, method: init?.method ?? "GET", body });
    if (url.endsWith("/download")) {
      if (!seen.has(body ?? "")) {
        seen.add(body ?? "");
        return json(200, { state: "preparing", retryAfterMs: 500 });
      }
      return new Promise<Response>((_, reject) => {
        const s = init!.signal!;
        hanging.push(s);
        s.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    }
    return json(404, {});
  }) as typeof fetch;
  mount();
  await click(q("[data-download-button]")!);
  await waitFor(() => assert.equal(hanging.length, 2), { timeout: 3000 });
  assert.ok(hanging.every((s) => !s.aborted));
  cleanup();
  assert.ok(hanging.every((s) => s.aborted), "every in-flight prepare request aborted on unmount");
  const before = posts("/download").length;
  await act(async () => new Promise((r) => setTimeout(r, 1_200)));
  assert.equal(posts("/download").length, before, "no polling after unmount");
});
