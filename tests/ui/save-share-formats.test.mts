import "./setup.ts";
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { ResultActions, rowShows, sendOrder } from "../../components/files/ResultActions.tsx";
import { DEFAULT_ROW_BADGE, SHEET_TITLE, sendRowStatusText } from "../../components/files/DownloadSheet.tsx";
import { useAppStore } from "../../lib/store.ts";
import { compareVersions } from "../../lib/telegram-webapp.ts";
import { DELIVER_TEXT, resetGesture } from "../../lib/downloads/deliver.ts";
import { downloadFormats, downloadSubject, type DownloadFormat } from "../../lib/downloads/formats.ts";
import type { GenerationDetail, ServerUser } from "../../lib/api-client.ts";

/**
 * T4 (docs/todo-2026-10-07/PLAN.md): «Saqlash» and «Ulashish» offer the same
 * per-material format choice as «Yuklab olish». A material with several
 * formats opens `DownloadSheet` in `save` / `share` mode (the registry's
 * formats, the stored file first and marked «Asosiy»); a row runs the action
 * in exactly that format (`POST …/telegram/{save|share} {format}`) and shows
 * its own state; one-format materials act from the button. `fetch` is stubbed
 * per route; a fake `Telegram.WebApp` records `shareMessage` / `close` /
 * `requestWriteAccess`.
 */

const ID = "22222222-2222-4222-8222-222222222222";
const router: AppRouterInstance = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };
const realFetch = globalThis.fetch;
const realCreate = URL.createObjectURL;
const realClick = window.HTMLAnchorElement.prototype.click;
const w = window as unknown as Record<string, unknown>;
const nav = navigator as unknown as Record<string, unknown>;

type Call = { url: string; method: string; body?: string };
let calls: Call[] = [];
let tgCalls: string[] = [];
let saved: string[] = [];

const json = (status: number, data: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });
const exp = () => new Date(Date.now() + 15 * 60_000).toISOString();
const fmtOf = (c: Call) => (c.body ? (JSON.parse(c.body) as { format?: string }).format : undefined);

type Route = (c: Call) => Response | Promise<Response> | undefined;

/** Default answers: prepare → ready (2 KB), signed URL → bytes, save → ok, share → a prepared id naming the format. */
function stub(route: Route = () => undefined) {
  calls = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const c: Call = { url: String(input), method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : undefined };
    calls.push(c);
    const r = await route(c);
    if (r) return r;
    const f = fmtOf(c);
    if (c.method === "POST" && c.url.endsWith("/download")) {
      return json(200, { state: "ready", url: `/api/dl/tok-${f}`, fileName: `fayl-${f}.bin`, size: 2048, mime: "application/octet-stream", expiresAt: exp() });
    }
    if (c.method === "POST" && c.url.endsWith("/telegram/save")) return json(200, { ok: true, duplicate: false, format: f ?? "native", botUrl: "https://t.me/SlaydX_bot" });
    if (c.method === "POST" && c.url.endsWith("/telegram/share")) return json(200, { preparedId: `prep-${f}`, expiresAt: exp(), format: f, botUrl: null });
    if (c.url.startsWith("/api/dl/")) return new Response(new Uint8Array(2048), { status: 200, headers: { "content-length": "2048" } });
    return json(404, { error: "yo'q" });
  }) as typeof fetch;
}

const posts = (suffix: string) => calls.filter((c) => c.method === "POST" && c.url === `/api/generations/${ID}${suffix}`);
const bodies = (suffix: string) => posts(suffix).map(fmtOf);

function fakeTelegram(o: { version?: string; platform?: string; userId?: number; share?: boolean; writeAccess?: boolean } = {}) {
  const version = o.version ?? "8.0";
  const listeners: Record<string, ((p?: unknown) => void)[]> = {};
  w.TelegramWebviewProxy = { postEvent() {} };
  w.Telegram = {
    WebApp: {
      initData: "user=1",
      version,
      platform: o.platform ?? "ios",
      initDataUnsafe: { user: { id: o.userId ?? 700 } },
      isVersionAtLeast: (v: string) => compareVersions(version, v) >= 0,
      downloadFile: (p: { url: string }, cb: (ok: boolean) => void) => {
        tgCalls.push(`download ${p.url}`);
        cb(true);
      },
      shareMessage: (id: string, cb: (ok: boolean) => void) => {
        tgCalls.push(`share ${id}`);
        cb(o.share ?? true);
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
  URL.createObjectURL = () => "blob:x";
  window.HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    saved.push(this.download);
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
    topic: "Suv aylanishi",
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

/** Materials with several formats (registry, `features.pdf`), as the result page sees them. */
const MATERIALS: { name: string; g: GenerationDetail; hasResults?: boolean; send: string[] }[] = [
  { name: "slide", g: gen(), send: ["native", "pdf", "slides-png"] },
  { name: "resume (PDF first in downloads; the stored DOCX first here)", g: gen({ type: "resume", format: "docx", fileName: "cv.docx" }), send: ["native", "pdf"] },
  { name: "image (PNG)", g: gen({ type: "image", format: "png", fileName: "r.png", doc: { meta: {}, images: [{}] } as unknown as GenerationDetail["doc"] }), send: ["native", "jpg"] },
  { name: "podcast", g: gen({ type: "podcast", format: "mp3", fileName: "p.mp3" }), send: ["native", "transcript-txt"] },
  { name: "glossary", g: gen({ type: "glossary", format: "docx", fileName: "g.docx" }), send: ["native", "pdf", "glossary-csv"] },
  {
    name: "translation (DOCX)",
    g: gen({ type: "translation", format: "docx", fileName: "t.docx", doc: { meta: {}, translation: { sourceKind: "docx" } } as unknown as GenerationDetail["doc"] }),
    send: ["native", "pdf"],
  },
  { name: "sorting game with results", g: gen({ type: "sorting", format: "docx", fileName: "s.docx" }), hasResults: true, send: ["native", "pdf", "results-csv"] },
];

/** Materials with exactly one format: «Saqlash» / «Ulashish» act from the button. */
const SINGLE: { name: string; g: GenerationDetail; pdf?: boolean }[] = [
  { name: "image ZIP (several images)", g: gen({ type: "image", format: "zip", fileName: "r.zip", doc: { meta: {}, images: [{}, {}, {}] } as unknown as GenerationDetail["doc"] }) },
  { name: "translated text (TXT)", g: gen({ type: "translation", format: "txt", fileName: "t.txt", doc: { meta: {}, translation: { sourceKind: "text" } } as unknown as GenerationDetail["doc"] }) },
  { name: "slide on a deployment without PDF", g: gen(), pdf: false },
];

function mount(o: { g?: GenerationDetail; telegramId?: string | null; hasResults?: boolean; pdf?: boolean } = {}) {
  useAppStore.setState({
    sessionChecked: true,
    loggedIn: true,
    features: { llm: true, images: true, telegram: true, telegramBot: "SlaydX_bot", devLogin: false, pdf: o.pdf ?? true, payments: { click: false, payme: false } },
    user: (o.telegramId === null ? { id: "u1", telegramId: null } : { id: "u1", telegramId: o.telegramId ?? "700" }) as unknown as ServerUser,
  });
  const props = (g: GenerationDetail) =>
    h(
      AppRouterContext.Provider,
      { value: router },
      h(ResultActions, {
        gen: g,
        lead: h("span", null, "lead"),
        editActions: null,
        fileStale: false,
        expired: false,
        hasResults: o.hasResults ?? false,
        del: { armed: false, trigger: () => {} },
        deleting: false,
      }),
    );
  const r = render(props(o.g ?? gen()));
  return { rerender: (g: GenerationDetail) => r.rerender(props(g)) };
}

const q = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const sheet = () => q("[data-download-sheet]");
const row = (id: string) => q(`[data-download-row="${id}"]`)!;
const state = (id: string) => row(id).getAttribute("data-row-state");
const status = (id: string) => row(id).querySelector("[data-row-status]")?.textContent ?? "";
const rowIds = () => [...document.querySelectorAll("[data-download-row]")].map((r) => r.getAttribute("data-download-row"));
const toast = () => q("[data-result-toast]");
const saveBtn = () => q("[data-save-to-bot]")!;
const shareBtn = () => q("[data-share-button]")!;

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
async function settle() {
  await act(async () => {
    for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 2));
  });
}

/* ───────────────────────────── pure helpers ───────────────────────────── */

test("sendOrder: the stored file first, the rest in registry order, nothing added or dropped", () => {
  const resume = downloadFormats({ type: "resume", format: "docx" }, { pdf: true });
  assert.deepEqual(resume.map((f) => f.id), ["pdf", "native"], "downloads: PDF first for the resume");
  assert.deepEqual(sendOrder(resume, "native").map((f) => f.id), ["native", "pdf"]);
  const slide = downloadFormats({ type: "slide", format: "pptx" }, { pdf: true });
  assert.deepEqual(sendOrder(slide, "native"), slide, "already first: same rows, same objects");
  const one = [{ id: "native" } as DownloadFormat];
  assert.deepEqual(sendOrder(one, "pdf"), one, "a missing default changes nothing");
});

test("rowShows: only a toast that names a row, and only while that action's sheet is open", () => {
  assert.equal(rowShows({ row: "pdf" }, "save", "save"), true);
  assert.equal(rowShows({ row: "pdf" }, "share", "save"), false);
  assert.equal(rowShows({ row: "pdf" }, null, "save"), false);
  assert.equal(rowShows({}, "save", "save"), false, "success toasts carry no row");
});

test("sendRowStatusText: hint + size when idle, «PDF tayyorlanmoqda… N s», «Tayyor — ulashish uchun bosing», the action's own text", () => {
  const pdf = { id: "pdf" as const, hint: "Chop etish va yuborish uchun" };
  assert.equal(sendRowStatusText({ s: "idle" }, pdf, { now: 0, size: 8_500_000 }), "Chop etish va yuborish uchun · 8,1 MB");
  assert.equal(sendRowStatusText({ s: "idle" }, { id: "native" }, { now: 0 }), "");
  assert.equal(sendRowStatusText({ s: "preparing", since: 1_000 }, pdf, { now: 4_200 }), "PDF tayyorlanmoqda… (odatda 5–15 soniya) 3 s");
  assert.equal(sendRowStatusText({ s: "preparing", since: 0 }, { id: "slides-png" }, { now: 2_000 }), "Tayyorlanmoqda… 2 s");
  assert.equal(sendRowStatusText({ s: "ready" }, pdf, { now: 0 }), "Tayyor — ulashish uchun bosing");
  assert.equal(sendRowStatusText({ s: "delivering", text: DELIVER_TEXT.sending }, pdf, { now: 0 }), "Botga yuborilmoqda…");
  assert.equal(sendRowStatusText({ s: "error", text: "x" }, pdf, { now: 0 }), "x");
});

/* ───────────────────────────── rows per material ───────────────────────────── */

test("save and share sheets list exactly the registry's formats for each material, the stored file first «Asosiy»; titles in Uzbek", async () => {
  for (const m of MATERIALS) {
    fakeTelegram();
    stub();
    mount({ g: m.g, hasResults: m.hasResults });
    const registry = downloadFormats(downloadSubject(m.g, { hasResults: m.hasResults }), { pdf: true });
    assert.deepEqual(sendOrder(registry, "native").map((f) => f.id), m.send, `${m.name}: the oracle agrees with the registry`);
    for (const kind of ["save", "share"] as const) {
      const b = kind === "save" ? saveBtn() : shareBtn();
      assert.equal(b.getAttribute("aria-haspopup"), "dialog", `${m.name} ${kind}: the button opens a picker`);
      await tap(b);
      const s = sheet()!;
      assert.equal(s.getAttribute("data-download-sheet"), kind, `${m.name} ${kind}: sheet mode`);
      assert.equal(s.getAttribute("aria-label"), kind === "save" ? "Qaysi formatda saqlaymiz?" : "Qaysi formatda ulashamiz?");
      assert.equal(s.querySelector("[data-sheet-title]")!.textContent, SHEET_TITLE[kind]);
      assert.deepEqual(rowIds(), m.send, `${m.name} ${kind}: rows`);
      for (const f of registry) assert.match(row(f.id).textContent ?? "", new RegExp(f.label.replace(/[()]/g, "\\$&")), `${m.name}: label of ${f.id}`);
      const defaults = [...s.querySelectorAll("[data-default-row]")].map((r) => r.getAttribute("data-download-row"));
      assert.deepEqual(defaults, ["native"], `${m.name} ${kind}: one default row, the stored file`);
      assert.equal(row("native").querySelector("[data-default-badge]")!.textContent, DEFAULT_ROW_BADGE);
      assert.equal(DEFAULT_ROW_BADGE, "Asosiy");
      // Identity check through assert.ok: a failing assert.equal on DOM nodes would serialize the whole jsdom tree.
      await waitFor(() => assert.ok(document.activeElement === row("native"), `${m.name} ${kind}: focus on the stored-file row`));
      assert.equal(posts(`/telegram/${kind}`).length, 0, `${m.name} ${kind}: opening sends nothing`);
      await act(async () => {
        fireEvent.keyDown(window, { key: "Escape" });
      });
      assert.ok(!sheet(), `${m.name} ${kind}: Escape closes`);
    }
    cleanup();
  }
});

test("one-format materials skip the sheet: «Saqlash» and «Ulashish» act at once with the only format", async () => {
  for (const m of SINGLE) {
    fakeTelegram();
    stub();
    mount({ g: m.g, pdf: m.pdf });
    assert.ok(!saveBtn().hasAttribute("aria-haspopup"), `${m.name}: no picker`);
    await tap(saveBtn());
    await waitFor(() => assert.equal(posts("/telegram/save").length, 1));
    assert.ok(!sheet(), `${m.name}: no save sheet`);
    assert.deepEqual(bodies("/telegram/save"), ["native"]);
    await waitFor(() => assert.ok(!saveBtn().hasAttribute("aria-busy")));
    await tap(shareBtn());
    await waitFor(() => assert.ok(tgCalls.includes("share prep-native")), `${m.name}: picker opened`);
    assert.ok(!sheet(), `${m.name}: no share sheet`);
    assert.deepEqual(bodies("/telegram/share"), ["native"]);
    cleanup();
    tgCalls = [];
  }
});

/* ───────────────────────────── the chosen format is what is sent ───────────────────────────── */

test("differential: every save row sends ITS format id (different rows → different bodies), toast + close() each time", async () => {
  for (const m of MATERIALS) {
    for (const id of m.send) {
      fakeTelegram();
      stub();
      tgCalls = [];
      mount({ g: m.g, hasResults: m.hasResults });
      await tap(saveBtn());
      await tap(row(id));
      await waitFor(() => assert.match(toast()?.textContent ?? "", /✅ Fayl bot chatiga yuborildi/), `${m.name} → ${id}`);
      assert.deepEqual(bodies("/telegram/save"), [id], `${m.name}: the ${id} row saves ${id}`);
      assert.ok(!sheet(), "success closes the sheet");
      if (id === m.send[0]) {
        await act(async () => new Promise((r) => setTimeout(r, 1_050)));
        assert.ok(tgCalls.includes("close"), `${m.name}: the Mini App closes after the toast`);
      }
      cleanup();
    }
  }
});

test("differential: every share row prepares ITS format and opens the picker with the id prepared for it", async () => {
  for (const m of MATERIALS) {
    for (const id of m.send) {
      fakeTelegram();
      stub();
      tgCalls = [];
      mount({ g: m.g, hasResults: m.hasResults });
      await tap(shareBtn());
      await tap(row(id));
      await waitFor(() => assert.match(toast()?.textContent ?? "", /Ulashildi/), `${m.name} → ${id}`);
      assert.deepEqual(bodies("/telegram/share"), [id]);
      assert.deepEqual(tgCalls, [`share prep-${id}`], `${m.name}: the picker gets the ${id} message`);
      cleanup();
    }
  }
});

/* ───────────────────────────── errors on the row ───────────────────────────── */

const ERRORS: { name: string; res: () => Response; text: RegExp; link?: boolean }[] = [
  { name: "409 no_telegram", res: () => json(409, { error: "Telegram akkaunti bog'lanmagan", code: "no_telegram" }), text: /^Telegram akkaunti bog‘lanmagan$/ },
  {
    name: "409 bot_unreachable (+ «Botni ochish»)",
    res: () => json(409, { error: "x", code: "bot_unreachable", botUrl: "https://t.me/SlaydX_bot" }),
    text: /^Bot sizga yoza olmadi\. Botni ochib \/start bosing, so‘ng qayta urinib ko‘ring\.$/,
    link: true,
  },
  {
    name: "413 too_large",
    res: () => json(413, { error: "Fayl Telegram uchun juda katta — «Yuklab olish» dan foydalaning.", code: "too_large" }),
    text: /^Fayl Telegram uchun juda katta — «Yuklab olish» dan foydalaning\.$/,
  },
  { name: "429 + Retry-After", res: () => json(429, { error: "Juda ko'p so'rov" }, { "retry-after": "12" }), text: /^Juda ko'p so'rov \(qayta urinish: 12 soniyadan keyin\)$/ },
  {
    name: "503 telegram_unavailable",
    res: () => json(503, { error: "Telegram hozir javob bermayapti. Birozdan keyin qayta urinib ko'ring.", code: "telegram_unavailable", retryAfter: 30 }),
    text: /^Telegram hozir javob bermayapti\. 30 soniyadan keyin qayta urinib ko'ring\.$/,
  },
];

test("error mapping: each Telegram route failure → the Uzbek text on THAT row (alert, «Qayta urinish»), no toast over the sheet; bot_unreachable adds «Botni ochish»; a retry tap works", async () => {
  for (const kind of ["save", "share"] as const) {
    for (const e of ERRORS) {
      fakeTelegram({ writeAccess: false });
      let fail = true;
      stub((c) => (c.url.endsWith(`/telegram/${kind}`) && fail ? e.res() : undefined));
      mount();
      await tap(kind === "save" ? saveBtn() : shareBtn());
      await tap(row("pdf"));
      await waitFor(() => assert.equal(state("pdf"), "error"), `${kind} ${e.name}`);
      assert.match(status("pdf"), e.text, `${kind} ${e.name}`);
      assert.equal(row("pdf").querySelector("[data-row-status]")!.getAttribute("role"), "alert");
      assert.match(row("pdf").textContent ?? "", /Qayta urinish/);
      assert.equal(state("native"), "idle", "the other rows keep their state");
      assert.ok(!toast(), `${kind} ${e.name}: no toast over the open sheet`);
      assert.ok(sheet(), "an error keeps the sheet open");
      const link = q('[data-download-item="pdf"] [data-row-link]');
      if (e.link) {
        assert.ok(link, "«Botni ochish» on the row");
        assert.equal(link!.textContent, "Botni ochish");
        await click(link!);
        assert.ok(tgCalls.includes("openTg https://t.me/SlaydX_bot"));
      } else assert.ok(!link);
      fail = false;
      await tap(row("pdf"));
      await waitFor(() => assert.ok(!sheet()), `${kind} ${e.name}: the retry succeeds and closes the sheet`);
      assert.deepEqual(bodies(`/telegram/${kind}`), ["pdf", "pdf"]);
      cleanup();
      tgCalls = [];
    }
  }
});

test("share: 501 share_unavailable / 409 telegram_id_unsupported → the chosen format is saved to the bot instead («u yerdan uzating»)", async () => {
  for (const code of ["share_unavailable", "telegram_id_unsupported"]) {
    fakeTelegram();
    stub((c) => (c.url.endsWith("/telegram/share") ? json(code === "share_unavailable" ? 501 : 409, { error: "x", code }) : undefined));
    mount();
    await tap(shareBtn());
    await tap(row("slides-png"));
    await waitFor(() => assert.match(toast()?.textContent ?? "", /Fayl bot chatiga yuborildi — u yerdan uzating/), code);
    assert.deepEqual(bodies("/telegram/share"), ["slides-png"]);
    assert.deepEqual(bodies("/telegram/save"), ["slides-png"], `${code}: the same format forwarded`);
    assert.ok(!tgCalls.some((c) => c.startsWith("share ")));
    assert.ok(!sheet());
    cleanup();
  }
});

test("bot_unreachable → requestWriteAccess → allowed → the same format is sent again (save and share)", async () => {
  for (const kind of ["save", "share"] as const) {
    fakeTelegram({ writeAccess: true });
    let n = 0;
    stub((c) => (c.url.endsWith(`/telegram/${kind}`) && n++ === 0 ? json(409, { error: "x", code: "bot_unreachable", botUrl: "https://t.me/SlaydX_bot" }) : undefined));
    tgCalls = [];
    mount();
    await tap(kind === "save" ? saveBtn() : shareBtn());
    await tap(row("pdf"));
    await waitFor(() => assert.ok(toast()?.getAttribute("data-result-toast") === "ok"), kind);
    assert.deepEqual(bodies(`/telegram/${kind}`), ["pdf", "pdf"]);
    assert.equal(tgCalls.filter((c) => c === "writeAccess").length, 1);
    cleanup();
  }
});

test("account switch guard: another Telegram account in the Mini App → «Saqlash» and «Ulashish» refuse before the sheet; nothing sent", async () => {
  fakeTelegram({ userId: 999 });
  stub();
  mount({ telegramId: "700" });
  for (const b of [saveBtn, shareBtn]) {
    await tap(b());
    assert.match(toast()?.textContent ?? "", /Bu Telegram akkaunti boshqa SlaydX akkauntiga kirgan/);
    assert.ok(!sheet(), "no sheet");
  }
  // The overflow entries take the same path.
  await click(q("[data-more-button]")!);
  await click(q('[data-menu-item="save-other"]')!);
  assert.ok(!sheet());
  assert.equal(posts("/telegram/save").length + posts("/telegram/share").length, 0);
});

/* ───────────────────────────── states, double tap, pre-warm ───────────────────────────── */

test("double tap safe: a row in flight ignores taps; the other rows wait (aria-disabled, dimmed) until it settles", async () => {
  fakeTelegram();
  let release!: (r: Response) => void;
  stub((c) => (c.url.endsWith("/telegram/save") ? new Promise((r) => (release = r)) : undefined));
  mount();
  await tap(saveBtn());
  await tap(row("pdf"));
  await tap(row("pdf"));
  await tap(row("native"));
  assert.deepEqual(bodies("/telegram/save"), ["pdf"], "one request");
  assert.equal(state("pdf"), "delivering");
  assert.equal(row("pdf").getAttribute("aria-busy"), "true");
  assert.equal(row("native").getAttribute("aria-disabled"), "true");
  assert.equal(row("native").getAttribute("data-row-blocked"), "1");
  assert.equal(saveBtn().hasAttribute("disabled"), true, "the header button waits too");
  await act(async () => release(json(409, { error: "x", code: "no_telegram" })));
  await waitFor(() => assert.equal(state("pdf"), "error"));
  assert.ok(!row("native").hasAttribute("aria-disabled"), "free again");
  await tap(row("native"));
  await waitFor(() => assert.deepEqual(bodies("/telegram/save"), ["pdf", "native"]));
});

test("the save/share sheet pre-warms like downloads: PDF and the stored file prepared on open (not the PNG ZIP); sizes on the rows; rows stay idle", async () => {
  for (const kind of ["save", "share"] as const) {
    fakeTelegram();
    stub();
    mount();
    await tap(kind === "save" ? saveBtn() : shareBtn());
    await waitFor(() => assert.equal(posts("/download").length, 2));
    assert.deepEqual(bodies("/download").sort(), ["native", "pdf"]);
    await waitFor(() => assert.equal(status("native"), "Tahrirlash uchun · 2 KB"));
    assert.equal(status("pdf"), "Chop etish va yuborish uchun · 2 KB");
    assert.equal(state("pdf"), "idle");
    cleanup();
  }
});

test("phone back closes the save and the share sheet (useDialog history entry), not the page", async () => {
  const navH = await import("../../lib/nav/history.ts");
  // Earlier tests closed sheets (history.go): let their popstates land before the engine is reset.
  await act(async () => new Promise((r) => setTimeout(r, 600)));
  navH.__resetNavForTests();
  window.history.pushState(null, "", "/uz/natija");
  window.sessionStorage.clear();
  navH.installNav();
  navH.setNavRouter(router);
  fakeTelegram();
  stub();
  mount();
  for (const b of [saveBtn, shareBtn]) {
    await tap(b());
    assert.ok(sheet());
    // (history.length is no measure on the second open: the push replaces the forward entry left by the first back.)
    assert.equal(navH.__layersForTests().filter((l) => l.kind === "overlay" && l.index >= 0 && !l.dead).length, 1, "the sheet owns a history entry");
    assert.ok((window.history.state as { sx?: { o?: string } } | null)?.sx?.o, "the current entry is the sheet's");
    await act(async () => {
      window.history.back();
      for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 2));
    });
    assert.ok(!sheet(), "back closed the sheet");
    assert.equal(navH.__layersForTests().filter((l) => !l.dead).length, 0, "no overlay entry left");
    assert.equal(window.location.pathname, "/uz/natija", "still on the result page");
  }
  assert.equal(posts("/telegram/save").length + posts("/telegram/share").length, 0);
});

test("Android share: a stale tap → the row is «Tayyor»; tapping ANOTHER format drops the stale message (row back to idle) and shares the new one", async () => {
  fakeTelegram({ platform: "android" });
  stub();
  mount();
  await click(shareBtn());
  await click(row("native")); // no pointerdown: stale gesture
  await waitFor(() => assert.equal(state("native"), "ready"));
  assert.equal(status("native"), DELIVER_TEXT.tapToShare);
  assert.equal(tgCalls.length, 0);
  await tap(row("pdf"));
  await waitFor(() => assert.match(toast()?.textContent ?? "", /Ulashildi/));
  assert.deepEqual(tgCalls, ["share prep-pdf"]);
  assert.deepEqual(bodies("/telegram/share"), ["native", "pdf"]);
  assert.ok(!shareBtn().hasAttribute("data-share-ready"), "nothing stays «ready»");
  await click(shareBtn());
  assert.equal(state("native"), "idle", "the dropped message's row is idle again");
});

test("picker closed without sending → the row is usable again (no success, no error); the sheet stays for another try", async () => {
  fakeTelegram({ share: false });
  stub();
  mount();
  await tap(shareBtn());
  await tap(row("pdf"));
  await waitFor(() => assert.equal(state("pdf"), "idle"));
  assert.ok(sheet());
  assert.ok(!toast());
  assert.deepEqual(tgCalls, ["share prep-pdf"]);
});

test("browser Web Share decides per format: PDF shareable, PPTX not → the PPTX row explains and downloads it; the PDF row shares in two taps", async () => {
  const shared: File[][] = [];
  nav.canShare = (d: { files: File[] }) => d.files[0].type === "application/pdf";
  nav.share = async (d: { files: File[] }) => void shared.push(d.files);
  stub();
  mount({ telegramId: null });
  assert.ok(!q("[data-save-to-bot]"), "«Saqlash» is hidden without a Telegram account");
  await tap(shareBtn());
  assert.equal(sheet()?.getAttribute("data-download-sheet"), "share", "something is shareable → the share sheet");
  await tap(row("native"));
  assert.equal(toast()?.textContent?.trim(), DELIVER_TEXT.shareNoBrowser);
  assert.equal(sheet()?.getAttribute("data-download-sheet"), "download", "switched to the download list");
  await waitFor(() => assert.equal(state("native"), "done"));
  assert.deepEqual(saved, ["fayl-native.bin"], "and that format was downloaded");
  cleanup();
  stub();
  mount({ telegramId: null });
  await tap(shareBtn());
  await tap(row("pdf"));
  await waitFor(() => assert.equal(state("pdf"), "ready"));
  assert.equal(shared.length, 0);
  await tap(row("pdf"));
  await waitFor(() => assert.equal(shared.length, 1));
  assert.equal(shared[0][0].name, "fayl-pdf.bin");
});

test("nothing shareable in this browser → the toast says why and the download list opens (no share sheet)", async () => {
  stub();
  mount({ telegramId: null });
  await tap(shareBtn());
  assert.equal(sheet()?.getAttribute("data-download-sheet"), "download");
  assert.equal(toast()?.textContent?.trim(), DELIVER_TEXT.shareNoBrowser);
  await settle();
  assert.equal(posts("/telegram/share").length, 0);
});

test("an edit (new file version) clears the rows: a «sent» row of the old file is idle again", async () => {
  fakeTelegram();
  stub((c) => (c.url.endsWith("/telegram/save") ? json(409, { error: "x", code: "no_telegram" }) : undefined));
  const m = mount();
  await tap(saveBtn());
  await tap(row("pdf"));
  await waitFor(() => assert.equal(state("pdf"), "error"));
  m.rerender(gen({ fileVersion: 2 }));
  await settle();
  assert.equal(state("pdf"), "idle");
});
