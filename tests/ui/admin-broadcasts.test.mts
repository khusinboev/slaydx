import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createElement as h, type ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext, SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import type * as CoreModule from "../../lib/admin-api/core.ts";
import type * as IdentityModule from "../../components/admin/shell/admin-identity.tsx";
import type * as ToasterModule from "../../components/admin/ui/Toaster.tsx";
import { BroadcastsPage } from "../../components/admin/broadcasts/BroadcastsPage.tsx";
import { BroadcastsTable, statusesFromParams, statusesToSearch } from "../../components/admin/broadcasts/BroadcastsTable.tsx";
import { BroadcastDetail, progressPercent } from "../../components/admin/broadcasts/BroadcastDetail.tsx";
import { BROADCAST_POLL_MS } from "../../lib/admin-api/broadcasts.ts";

/**
 * S13 broadcasts screen (docs/admin/02-plan.md §7.0, §7.1, §9): the four states
 * of the list, the status filter in the URL, the editor (character counter,
 * audience picker with a live count, save as a draft), the draft page (test
 * send, send with a typed count + reason, count_changed, step-up replay), the
 * cancel dialog, the 5 s polling that runs ONLY while queued/sending and the
 * tab is visible, and role visibility (support looks, owner acts).
 *
 * Mutation checks (each made the named test fail, then restored):
 *   - polling condition widened to every status → "polling: only while queued or
 *     sending" and "polling: every 5 s while sending" fail (polls on a draft, a
 *     finished broadcast);
 *   - the initial visibility check removed → "polling: a tab that is already hidden"
 *     fails;
 *   - typedConfirmation dropped from SendDialog → "send: the button stays
 *     disabled until the exact count is typed" fails;
 *   - the send body sending the count from the first fetch after a 409 →
 *     "send: count_changed asks for the new number" fails (old count is sent);
 *   - `canSend` forced to true on the detail page → "support sees no actions"
 *     fails;
 *   - the body text rendered with dangerouslySetInnerHTML → "text stays text"
 *     fails (an <img> element appears).
 */
const req = createRequire(import.meta.url);
const core = req("../../lib/admin-api/core.ts") as typeof CoreModule;
const { AdminIdentityProvider } = req("../../components/admin/shell/admin-identity.tsx") as typeof IdentityModule;
const { useToastStore } = req("../../components/admin/ui/Toaster.tsx") as typeof ToasterModule;

const realFetch = globalThis.fetch;
const realReplaceState = window.history.replaceState;
afterEach(() => {
  window.history.replaceState = realReplaceState;
  cleanup();
  globalThis.fetch = realFetch;
  core.setStepUpHandler(null);
  useToastStore.getState().clear();
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
});

const PERMS = {
  owner: ["broadcasts.view", "broadcasts.send"],
  support: ["broadcasts.view"],
} as const;
type Role = keyof typeof PERMS;

const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

type Call = { url: string; method: string; body: Record<string, unknown> | null; path: string; search: URLSearchParams };

/** Routes by method + path, so the order of refetches does not matter. */
function stubRoutes(handler: (c: Call) => Response | Promise<Response>): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    const u = new URL(String(url), "http://localhost");
    const c: Call = {
      url: String(url),
      method: init.method ?? "GET",
      body: init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null,
      path: u.pathname,
      search: u.searchParams,
    };
    calls.push(c);
    return handler(c);
  }) as typeof fetch;
  return calls;
}

type RouterCalls = { replace: string[]; push: string[] };
function makeRouter(): { router: AppRouterInstance; calls: RouterCalls } {
  const calls: RouterCalls = { replace: [], push: [] };
  window.history.replaceState = (_data: unknown, _unused: string, url?: string | URL | null) => {
    calls.replace.push(String(url));
  };
  return {
    calls,
    router: {
      back() {},
      forward() {},
      refresh() {},
      prefetch() {},
      push: (href: string) => void calls.push.push(href),
      replace: (href: string) => void calls.replace.push(href),
    },
  };
}

function mount(node: ReactNode, opts: { role?: Role; search?: string } = {}) {
  const { router, calls } = makeRouter();
  const role = opts.role ?? "owner";
  render(
    h(
      AppRouterContext.Provider,
      { value: router },
      h(
        PathnameContext.Provider,
        { value: "/admin/broadcasts" },
        h(
          SearchParamsContext.Provider,
          { value: new URLSearchParams(opts.search ?? "") },
          h(AdminIdentityProvider, { value: { role, permissions: PERMS[role], name: "Admin", username: null }, children: node }),
        ),
      ),
    ),
  );
  return calls;
}

const flush = () =>
  act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
    await new Promise((r) => setImmediate(r));
  });

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new window.Event("visibilitychange"));
}

const BASE = {
  id: "12",
  status: "draft",
  text: "Yangi vosita qo'shildi: Tinglash o'yini",
  audience: { kind: "all" },
  total: 0,
  sent: 0,
  failed: 0,
  createdBy: "3",
  createdByName: "Adhambek X.",
  createdAt: "2026-10-01T05:00:00.000Z",
  queuedAt: null,
  finishedAt: null,
};
const ZERO = { total: 0, sent: 0, failed: 0, pending: 0, failedReasons: [] };
const item = (over: Record<string, unknown> = {}) => ({ ...BASE, preview: String(over.text ?? BASE.text), textLength: String(over.text ?? BASE.text).length, ...over });
const list = (items: unknown[], extra: Record<string, unknown> = {}) => ({ items, nextCursor: null, total: items.length, totalCapped: false, ...extra });
const detailOf = (over: Record<string, unknown> = {}, stats: Record<string, unknown> = {}) => ({ broadcast: { ...BASE, ...over }, stats: { ...ZERO, ...stats } });

/* ───────────────────────────── pure helpers ───────────────────────────── */

test("status filter ↔ URL: round trip, junk and duplicates dropped", () => {
  assert.deepEqual(statusesFromParams(new URLSearchParams("status=draft,done")), ["draft", "done"]);
  assert.equal(statusesToSearch(["draft", "done"]), "status=draft,done");
  assert.equal(statusesToSearch([]), "");
  assert.deepEqual(statusesFromParams(new URLSearchParams("status=bogus,draft,draft,SENDING")), ["draft"]);
  assert.deepEqual(statusesFromParams(new URLSearchParams("")), []);
});

test("progressPercent: handled / total, floored, clamped, 0 without a total", () => {
  assert.equal(progressPercent(0, 0, 0), 0);
  assert.equal(progressPercent(1, 0, 3), 33);
  assert.equal(progressPercent(5, 2, 10), 70);
  assert.equal(progressPercent(10, 5, 10), 100);
});

/* ───────────────────────────── list ───────────────────────────── */

test("list: skeleton while loading, then rows with status, preview, audience, progress, author", async () => {
  let release: (r: Response) => void = () => {};
  const calls = stubRoutes(() => new Promise<Response>((res) => (release = res)));
  mount(h(BroadcastsTable));
  assert.ok(document.querySelector("[data-skeleton-row]"), "skeleton rows");
  assert.equal(calls[0].url, "/api/admin/broadcasts?limit=50");
  const long = "U".repeat(160);
  release(
    json(
      200,
      list([
        item({ id: "13", status: "done", total: 1840, sent: 1791, failed: 49, audience: { kind: "active_days", days: 30 }, text: long, preview: long, textLength: 400 }),
        item({ id: "12", status: "draft" }),
        item({ id: "11", status: "cancelled", audience: { kind: "paid" } }),
      ]),
    ),
  );
  const row = await waitFor(() => {
    const r = document.querySelector('tr[data-row-key="13"]');
    assert.ok(r);
    return within(r as HTMLElement);
  });
  assert.ok(row.getByText("Yuborildi"));
  assert.ok(row.getByText(/^U{160}…$/), "a longer text is cut with an ellipsis");
  assert.ok(row.getByText("Oxirgi 30 kunda faol"));
  assert.ok(row.getByText(/1\s*791 \/ 1\s*840/));
  assert.ok(row.getByText(/^49$/));
  assert.ok(row.getByText("Adhambek X."));
  const draft = within(document.querySelector('tr[data-row-key="12"]') as HTMLElement);
  assert.ok(draft.getByText("Qoralama"));
  assert.ok(draft.getByText("Barcha foydalanuvchilar"));
  assert.ok(within(document.querySelector('tr[data-row-key="11"]') as HTMLElement).getByText("Bekor qilingan"));
  assert.ok(within(document.querySelector('tr[data-row-key="11"]') as HTMLElement).getByText("To'lov qilganlar"));
  assert.ok(screen.getByText("3 ta natija"));
});

test("list: empty without filters has no clear button; with a filter it offers 'Filtrlarni tozalash' which resets the URL", async () => {
  stubRoutes(() => json(200, list([])));
  mount(h(BroadcastsTable));
  await screen.findByText("Hali birorta xabar yaratilmagan.");
  assert.ok(!screen.queryByRole("button", { name: "Filtrlarni tozalash" }));
  cleanup();

  stubRoutes((c) => (assert.equal(c.search.get("status"), "done"), json(200, list([]))));
  const router = mount(h(BroadcastsTable), { search: "status=done" });
  await screen.findByText("Bu filtr bo'yicha xabar yo'q.");
  const clear = screen.getAllByRole("button", { name: "Filtrlarni tozalash" });
  fireEvent.click(clear[clear.length - 1]);
  assert.deepEqual(router.replace, ["/admin/broadcasts"]);
});

test("list: error shows the request id; retry refetches; 403 renders Forbidden", async () => {
  let n = 0;
  const calls = stubRoutes(() => (++n === 1 ? json(500, { error: "Server xatosi", requestId: "req-bc-1" }) : json(200, list([item()]))));
  mount(h(BroadcastsTable));
  await screen.findByText("req-bc-1");
  fireEvent.click(screen.getByRole("button", { name: "Qayta urinish" }));
  await waitFor(() => assert.ok(document.querySelector('tr[data-row-key="12"]')));
  assert.equal(calls.length, 2);
  cleanup();

  stubRoutes(() => json(403, { error: "Ruxsat yo'q", code: "forbidden" }));
  mount(h(BroadcastsTable));
  await screen.findByText("Ruxsat yo'q");
});

test("list: the status filter writes the URL and the request carries it; 'Keyingi' sends the cursor; a row click opens the detail", async () => {
  const calls = stubRoutes((c) => (c.search.get("cursor") === "CUR1" ? json(200, list([item({ id: "9" })], { total: 2 })) : json(200, list([item()], { nextCursor: "CUR1", total: 2 }))));
  const router = mount(h(BroadcastsTable), { search: "status=draft,queued" });
  await waitFor(() => assert.ok(document.querySelector('tr[data-row-key="12"]')));
  assert.equal(calls[0].search.get("status"), "draft,queued");
  fireEvent.click(screen.getByRole("button", { name: "2 ta tanlangan" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Yuborildi" }));
  assert.deepEqual(router.replace, ["/admin/broadcasts?status=draft,queued,done"]);

  fireEvent.click(screen.getByRole("button", { name: "Keyingi" }));
  await waitFor(() => assert.equal(calls.length, 2));
  assert.equal(calls[1].search.get("cursor"), "CUR1");

  await waitFor(() => assert.ok(document.querySelector('tr[data-row-key="9"]')));
  fireEvent.click(document.querySelector('tr[data-row-key="9"] td')!);
  assert.deepEqual(router.push, ["/admin/broadcasts/9"]);
});

/* ───────────────────────────── page + editor ───────────────────────────── */

test("page: 'Yangi xabar' is shown to broadcasts.send only", async () => {
  stubRoutes(() => json(200, list([])));
  mount(h(BroadcastsPage), { role: "owner" });
  assert.ok(screen.getByRole("button", { name: "Yangi xabar" }));
  cleanup();
  mount(h(BroadcastsPage), { role: "support" });
  await screen.findByText("Hali birorta xabar yaratilmagan.");
  assert.ok(!screen.queryByRole("button", { name: "Yangi xabar" }));
});

function editorRoutes(extra?: (c: Call) => Response | undefined) {
  return (c: Call): Response => {
    const r = extra?.(c);
    if (r) return r;
    if (c.path === "/api/admin/broadcasts/audience") {
      const kind = c.search.get("kind");
      return json(200, { count: kind === "all" ? 1840 : kind === "paid" ? 412 : Number(c.search.get("days")) * 10 });
    }
    return json(200, list([]));
  };
}

async function openEditor() {
  fireEvent.click(screen.getByRole("button", { name: "Yangi xabar" }));
  return screen.findByRole("dialog", { name: "Yangi xabar" });
}

test("editor: character counter counts characters after trim, red over 3500, save is disabled until valid", async () => {
  stubRoutes(editorRoutes());
  mount(h(BroadcastsPage));
  const dialog = await openEditor();
  const save = within(dialog).getByRole("button", { name: "Qoralamani saqlash" }) as HTMLButtonElement;
  assert.equal(save.disabled, true, "empty text");
  assert.ok(within(dialog).getByText("0 / 3 500"));
  const area = within(dialog).getByLabelText(/Matn/) as HTMLTextAreaElement;
  fireEvent.change(area, { target: { value: "  Salom 😀  " } });
  assert.ok(within(dialog).getByText("7 / 3 500"), "an emoji is one character, padding is not counted");
  assert.equal(save.disabled, false);
  fireEvent.change(area, { target: { value: "a".repeat(3501) } });
  const counter = within(dialog).getByText("3 501 / 3 500");
  assert.match(counter.className, /text-destructive/);
  assert.equal(save.disabled, true);
  fireEvent.change(area, { target: { value: "a".repeat(3500) } });
  assert.equal(save.disabled, false);
});

test("editor: the audience picker shows a live count per audience; days are validated and debounced", async () => {
  const calls = stubRoutes(editorRoutes());
  mount(h(BroadcastsPage));
  const dialog = await openEditor();
  await within(dialog).findByText(/1\s*840 ta/);
  assert.equal(calls.filter((c) => c.path === "/api/admin/broadcasts/audience").length, 1);

  fireEvent.click(within(dialog).getByRole("radio", { name: "To'lov qilganlar" }));
  await within(dialog).findByText(/412 ta/);

  fireEvent.click(within(dialog).getByRole("radio", { name: "Faol foydalanuvchilar" }));
  await within(dialog).findByText(/300 ta/, undefined, { timeout: 2000 });
  const last = calls.filter((c) => c.path === "/api/admin/broadcasts/audience").pop()!;
  assert.equal(last.search.get("kind"), "active_days");
  assert.equal(last.search.get("days"), "30");

  const days = within(dialog).getByLabelText("Oxirgi") as HTMLInputElement;
  const before = calls.length;
  fireEvent.change(days, { target: { value: "0" } });
  await within(dialog).findByText("kunlar sonini kiriting");
  fireEvent.change(days, { target: { value: "366" } });
  await within(dialog).findByText("kunlar sonini kiriting");
  assert.equal(calls.length, before, "an invalid number of days is never sent");
  assert.equal((within(dialog).getByRole("button", { name: "Qoralamani saqlash" }) as HTMLButtonElement).disabled, true);
  fireEvent.change(days, { target: { value: "7" } });
  await within(dialog).findByText(/70 ta/);
  fireEvent.change(days, { target: { value: "abc" } });
  assert.equal(days.value, "", "only digits are accepted");
});

test("editor and send dialog: loading placeholders are inline (no block element inside a paragraph or span: hydration error found in the browser smoke)", async () => {
  // The audience count never answers, so every loading placeholder stays on screen.
  stubRoutes((c) => (c.path === "/api/admin/broadcasts/audience" ? new Promise<Response>(() => {}) : c.path === "/api/admin/broadcasts/12" ? json(200, detailOf()) : json(200, list([]))));
  mount(h(BroadcastsPage));
  const dialog = await openEditor();
  assert.ok(within(dialog).getByText(/Qabul qiluvchilar/));
  assert.ok(dialog.querySelector('[aria-live="polite"] span[aria-hidden="true"]'), "the placeholder is shown");
  assert.ok(!dialog.querySelector("p div"), "no <div> inside a <p>");
  cleanup();
  mount(h(BroadcastDetail, { id: "12" }));
  const send = await openSend();
  assert.ok(send.querySelector("span[aria-hidden='true'].animate-pulse"), "the placeholder is shown");
  assert.ok(!send.querySelector("p div, span div"), "no <div> inside a <p> or <span>");
});

test("editor: save POSTs the trimmed text and audience, toasts and opens the draft page", async () => {
  const calls = stubRoutes(
    editorRoutes((c) => (c.method === "POST" ? json(201, { broadcast: { ...BASE, id: "77" } }) : undefined)),
  );
  const router = mount(h(BroadcastsPage));
  const dialog = await openEditor();
  fireEvent.change(within(dialog).getByLabelText(/Matn/), { target: { value: "  Texnik ishlar <22:00>  " } });
  fireEvent.click(within(dialog).getByRole("radio", { name: "To'lov qilganlar" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Qoralamani saqlash" }));
  await waitFor(() => assert.ok(calls.some((c) => c.method === "POST")));
  const post = calls.find((c) => c.method === "POST")!;
  assert.equal(post.path, "/api/admin/broadcasts");
  assert.deepEqual(post.body, { text: "Texnik ishlar <22:00>", audience: { kind: "paid" } });
  await waitFor(() => assert.deepEqual(router.push, ["/admin/broadcasts/77"]));
  assert.ok(useToastStore.getState().toasts.some((t) => t.message === "Qoralama saqlandi"));
  await waitFor(() => assert.ok(!screen.queryByRole("dialog", { name: "Yangi xabar" })));
});

test("editor: a server error stays inline and nothing navigates", async () => {
  stubRoutes(editorRoutes((c) => (c.method === "POST" ? json(400, { error: "Matn bo'sh bo'lmasligi kerak" }) : undefined)));
  const router = mount(h(BroadcastsPage));
  const dialog = await openEditor();
  fireEvent.change(within(dialog).getByLabelText(/Matn/), { target: { value: "x" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Qoralamani saqlash" }));
  await within(dialog).findByText("Matn bo'sh bo'lmasligi kerak");
  assert.deepEqual(router.push, []);
});

/* ───────────────────────────── detail ───────────────────────────── */

const detailRoutes = (over: Record<string, unknown> = {}, stats: Record<string, unknown> = {}, extra?: (c: Call) => Response | undefined) => (c: Call): Response => {
  const r = extra?.(c);
  if (r) return r;
  if (c.path === "/api/admin/broadcasts/12") return json(200, detailOf(over, stats));
  if (c.path === "/api/admin/broadcasts/audience") return json(200, { count: 960 });
  return json(404, { error: "Topilmadi", code: "not_found" });
};

test("detail: skeleton, then the draft with its text, audience, author and the actions for an owner", async () => {
  let release: (r: Response) => void = () => {};
  stubRoutes(() => new Promise<Response>((res) => (release = res)));
  mount(h(BroadcastDetail, { id: "12" }));
  assert.ok(document.querySelector('[aria-busy="true"]'));
  release(json(200, detailOf()));
  await screen.findByRole("heading", { name: "Xabar #12" });
  assert.ok(screen.getAllByText("Qoralama").length >= 1);
  assert.ok(screen.getByText("Yangi vosita qo'shildi: Tinglash o'yini"));
  assert.ok(screen.getByText("Adhambek X."));
  assert.ok(screen.getByRole("button", { name: "O'zimga sinov" }));
  assert.ok(screen.getByRole("button", { name: "Yuborish…" }));
  assert.ok(screen.getByRole("button", { name: "Bekor qilish" }));
  assert.ok(screen.getByText(/Hali yuborilmagan/));
});

test("detail: support sees no actions; error, 404 and 403 states", async () => {
  stubRoutes(detailRoutes());
  mount(h(BroadcastDetail, { id: "12" }), { role: "support" });
  await screen.findByRole("heading", { name: "Xabar #12" });
  assert.ok(!screen.queryByRole("button", { name: "Yuborish…" }));
  assert.ok(!screen.queryByRole("button", { name: "O'zimga sinov" }));
  assert.ok(!screen.queryByRole("button", { name: "Bekor qilish" }));
  cleanup();

  let n = 0;
  stubRoutes(() => (++n === 1 ? json(500, { error: "Server xatosi", requestId: "req-d-1" }) : json(200, detailOf())));
  mount(h(BroadcastDetail, { id: "12" }));
  await screen.findByText("req-d-1");
  fireEvent.click(screen.getByRole("button", { name: "Qayta urinish" }));
  await screen.findByRole("heading", { name: "Xabar #12" });
  cleanup();

  stubRoutes(() => json(404, { error: "Topilmadi", code: "not_found" }));
  mount(h(BroadcastDetail, { id: "999" }));
  await screen.findByText("Xabar topilmadi");
  cleanup();

  stubRoutes(() => json(403, { error: "Ruxsat yo'q", code: "forbidden" }));
  mount(h(BroadcastDetail, { id: "12" }));
  await screen.findByText("Ruxsat yo'q");
});

test("detail: the text stays text (no element is created from it)", async () => {
  stubRoutes(detailRoutes({ text: '<img src=x onerror=alert(1)> <script>alert(2)</script> & "q"' }));
  mount(h(BroadcastDetail, { id: "12" }));
  await screen.findByRole("heading", { name: "Xabar #12" });
  assert.ok(screen.getByText(/<img src=x onerror=alert\(1\)>/));
  assert.ok(!document.querySelector("img"));
  assert.ok(!document.querySelector("script"));
});

test("detail: finished broadcast shows counters, progress bar and failure reasons", async () => {
  stubRoutes(
    detailRoutes(
      { status: "done", total: 10, sent: 7, failed: 3, queuedAt: "2026-10-01T06:00:00.000Z", finishedAt: "2026-10-01T06:10:00.000Z" },
      { total: 10, sent: 7, failed: 3, pending: 0, failedReasons: [{ error: "Telegram xabarni qabul qilmadi", count: 3 }] },
    ),
  );
  mount(h(BroadcastDetail, { id: "12" }));
  await screen.findByRole("heading", { name: "Xabar #12" });
  const bar = screen.getByRole("progressbar", { name: "Yuborish jarayoni" });
  assert.equal(bar.getAttribute("aria-valuenow"), "100");
  assert.equal(screen.getAllByText("Yuborildi").length, 2, "the status pill and the sent counter");
  assert.ok(screen.getByText("Telegram xabarni qabul qilmadi"));
  assert.ok(screen.getByText("3 ta"));
  assert.ok(!screen.queryByRole("button", { name: "Bekor qilish" }), "a finished broadcast cannot be cancelled");
  assert.ok(!screen.queryByRole("button", { name: "Yuborish…" }));
});

test("test send: POST to the test endpoint, success toast; a refusal and an error are shown as toasts", async () => {
  let result: Response = json(200, { sent: true });
  const calls = stubRoutes(detailRoutes({}, {}, (c) => (c.method === "POST" ? result : undefined)));
  mount(h(BroadcastDetail, { id: "12" }));
  await screen.findByRole("heading", { name: "Xabar #12" });
  fireEvent.click(screen.getByRole("button", { name: "O'zimga sinov" }));
  await waitFor(() => assert.ok(useToastStore.getState().toasts.some((t) => t.message === "Sinov xabari Telegram'ingizga yuborildi")));
  const post = calls.find((c) => c.method === "POST")!;
  assert.equal(post.path, "/api/admin/broadcasts/12/test");
  assert.deepEqual(post.body, {});

  result = json(409, { error: "Sizning hisobingizga Telegram ulanmagan — sinov xabarini yuborib bo'lmaydi", code: "no_telegram" });
  fireEvent.click(screen.getByRole("button", { name: "O'zimga sinov" }));
  await waitFor(() => assert.ok(useToastStore.getState().toasts.some((t) => t.tone === "error" && /Telegram ulanmagan/.test(t.message))));

  result = json(200, { sent: false });
  fireEvent.click(screen.getByRole("button", { name: "O'zimga sinov" }));
  await waitFor(() => assert.ok(useToastStore.getState().toasts.some((t) => t.tone === "error" && /qabul qilmadi/.test(t.message))));
});

/* ───────────────────────────── send ───────────────────────────── */

async function openSend() {
  fireEvent.click(await screen.findByRole("button", { name: "Yuborish…" }));
  return screen.findByRole("dialog", { name: "Xabarni yuborish" });
}

test("send: the button stays disabled until the exact count and a reason are typed; POST carries reason + confirmCount; the page shows it queued", async () => {
  let queued = false;
  const calls = stubRoutes(
    detailRoutes({}, {}, (c) => {
      if (c.method === "POST") {
        queued = true;
        return json(200, { broadcast: { ...BASE, status: "queued", total: 960, queuedAt: "2026-10-02T06:00:00.000Z" } });
      }
      return queued ? json(200, detailOf({ status: "queued", total: 960 }, { total: 960, pending: 960 })) : undefined;
    }),
  );
  mount(h(BroadcastDetail, { id: "12" }));
  const dialog = await openSend();
  await within(dialog).findByText(/960 ta qabul qiluvchi/);
  const confirm = within(dialog).getByRole("button", { name: "Yuborish" }) as HTMLButtonElement;
  assert.equal(confirm.disabled, true);
  fireEvent.change(within(dialog).getByLabelText("Sabab"), { target: { value: "Texnik ishlar haqida" } });
  assert.equal(confirm.disabled, true, "a reason alone is not enough");
  const typed = within(dialog).getByLabelText(/Tasdiqlash uchun/);
  fireEvent.change(typed, { target: { value: "96" } });
  assert.equal(confirm.disabled, true);
  fireEvent.change(typed, { target: { value: "961" } });
  assert.equal(confirm.disabled, true);
  fireEvent.change(typed, { target: { value: "960" } });
  assert.equal(confirm.disabled, false);
  fireEvent.click(confirm);
  await waitFor(() => assert.ok(calls.some((c) => c.method === "POST")));
  const post = calls.find((c) => c.method === "POST")!;
  assert.equal(post.path, "/api/admin/broadcasts/12/send");
  assert.deepEqual(post.body, { reason: "Texnik ishlar haqida", confirmCount: 960 });
  await waitFor(() => assert.ok(!screen.queryByRole("dialog")));
  assert.ok(useToastStore.getState().toasts.some((t) => /Navbatga qo'yildi/.test(t.message)));
  await screen.findByText("Navbatda", { selector: "span" });
  assert.ok(!screen.queryByRole("button", { name: "Yuborish…" }), "no second send");
  assert.ok(screen.getByRole("button", { name: "Bekor qilish" }), "cancel is available while queued");
});

test("send: count_changed shows the server's number and asks for it instead of sending to a different crowd", async () => {
  let attempt = 0;
  const calls = stubRoutes(
    detailRoutes({}, {}, (c) => {
      if (c.method !== "POST") return undefined;
      attempt++;
      return attempt === 1
        ? json(409, { error: "Auditoriya soni o'zgardi: hozir 955 ta", code: "count_changed", count: 955 })
        : json(200, { broadcast: { ...BASE, status: "queued", total: 955 } });
    }),
  );
  mount(h(BroadcastDetail, { id: "12" }));
  const dialog = await openSend();
  await within(dialog).findByText(/960 ta qabul qiluvchi/);
  fireEvent.change(within(dialog).getByLabelText("Sabab"), { target: { value: "Texnik ishlar haqida" } });
  fireEvent.change(within(dialog).getByLabelText(/Tasdiqlash uchun/), { target: { value: "960" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Yuborish" }));
  await within(dialog).findByText(/Auditoriya soni o'zgardi: endi 955 ta/);
  assert.ok(within(dialog).getByText(/955 ta qabul qiluvchi/));
  const confirm = within(dialog).getByRole("button", { name: "Yuborish" }) as HTMLButtonElement;
  assert.equal(confirm.disabled, true, "the old typed number no longer matches");
  fireEvent.change(within(dialog).getByLabelText(/Tasdiqlash uchun/), { target: { value: "955" } });
  fireEvent.click(confirm);
  await waitFor(() => assert.equal(calls.filter((c) => c.method === "POST").length, 2));
  const posts = calls.filter((c) => c.method === "POST");
  assert.equal(posts[0].body?.confirmCount, 960);
  assert.equal(posts[1].body?.confirmCount, 955, "the new, confirmed count");
});

test("send: an empty audience cannot be confirmed; the dialog can run the test send too", async () => {
  const calls = stubRoutes(
    detailRoutes({}, {}, (c) => (c.path === "/api/admin/broadcasts/audience" ? json(200, { count: 0 }) : c.method === "POST" ? json(200, { sent: true }) : undefined)),
  );
  mount(h(BroadcastDetail, { id: "12" }));
  const dialog = await openSend();
  await within(dialog).findByText(/0 ta qabul qiluvchi/);
  fireEvent.change(within(dialog).getByLabelText("Sabab"), { target: { value: "Texnik ishlar haqida" } });
  fireEvent.change(within(dialog).getByLabelText(/Tasdiqlash uchun/), { target: { value: "0" } });
  assert.equal((within(dialog).getByRole("button", { name: "Yuborish" }) as HTMLButtonElement).disabled, true);
  fireEvent.click(within(dialog).getByRole("button", { name: "O'zimga sinov" }));
  await waitFor(() => assert.ok(calls.some((c) => c.method === "POST" && c.path === "/api/admin/broadcasts/12/test")));
});

test("send: 401 reauth asks for the code once and replays the SAME request", async () => {
  let asked = 0;
  core.setStepUpHandler(async () => {
    asked += 1;
    return true;
  });
  let posts = 0;
  const calls = stubRoutes(
    detailRoutes({}, {}, (c) => {
      if (c.method !== "POST") return undefined;
      posts++;
      return posts === 1 ? json(401, { error: "Bu amal uchun kodni qayta kiriting", code: "reauth" }) : json(200, { broadcast: { ...BASE, status: "queued", total: 960 } });
    }),
  );
  mount(h(BroadcastDetail, { id: "12" }));
  const dialog = await openSend();
  await within(dialog).findByText(/960 ta qabul qiluvchi/);
  fireEvent.change(within(dialog).getByLabelText("Sabab"), { target: { value: "Texnik ishlar haqida" } });
  fireEvent.change(within(dialog).getByLabelText(/Tasdiqlash uchun/), { target: { value: "960" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Yuborish" }));
  await waitFor(() => assert.ok(!screen.queryByRole("dialog")));
  assert.equal(asked, 1);
  const sent = calls.filter((c) => c.method === "POST");
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[0].body, sent[1].body);
});

/* ───────────────────────────── cancel ───────────────────────────── */

test("cancel: reason required, POST {reason}, toast, the page shows the cancelled state", async () => {
  let cancelled = false;
  const calls = stubRoutes(
    detailRoutes({ status: "sending", total: 100, sent: 40, queuedAt: "2026-10-02T06:00:00.000Z" }, { total: 100, sent: 40, pending: 60 }, (c) => {
      if (c.method === "POST") {
        cancelled = true;
        return json(200, { broadcast: { ...BASE, status: "cancelled" } });
      }
      return cancelled ? json(200, detailOf({ status: "cancelled", total: 100, sent: 40 }, { total: 100, sent: 40, pending: 60 })) : undefined;
    }),
  );
  mount(h(BroadcastDetail, { id: "12" }));
  fireEvent.click(await screen.findByRole("button", { name: "Bekor qilish" }));
  const dialog = await screen.findByRole("dialog", { name: "Xabarni bekor qilish" });
  const confirm = within(dialog).getByRole("button", { name: "Bekor qilish" }) as HTMLButtonElement;
  assert.equal(confirm.disabled, true);
  fireEvent.change(within(dialog).getByLabelText("Sabab"), { target: { value: "Xato matn yuborilgan" } });
  assert.equal(confirm.disabled, false);
  fireEvent.click(confirm);
  await waitFor(() => assert.ok(calls.some((c) => c.method === "POST")));
  const post = calls.find((c) => c.method === "POST")!;
  assert.equal(post.path, "/api/admin/broadcasts/12/cancel");
  assert.deepEqual(post.body, { reason: "Xato matn yuborilgan" });
  await waitFor(() => assert.ok(!screen.queryByRole("dialog")));
  assert.ok(useToastStore.getState().toasts.some((t) => t.message === "Xabar bekor qilindi"));
  await screen.findByText("Bekor qilingan", { selector: "span" });
  assert.ok(screen.getByText("Yuborilmagan"), "pending recipients are labelled as never sent");
  assert.ok(!screen.queryByRole("button", { name: "Bekor qilish" }));
});

test("cancel: a 409 keeps the dialog open with the server message", async () => {
  stubRoutes(detailRoutes({}, {}, (c) => (c.method === "POST" ? json(409, { error: "Xabar holati o'zgargan — sahifani yangilang", code: "state" }) : undefined)));
  mount(h(BroadcastDetail, { id: "12" }));
  fireEvent.click(await screen.findByRole("button", { name: "Bekor qilish" }));
  const dialog = await screen.findByRole("dialog", { name: "Xabarni bekor qilish" });
  fireEvent.change(within(dialog).getByLabelText("Sabab"), { target: { value: "Xato matn yuborilgan" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Bekor qilish" }));
  await within(dialog).findByText("Xabar holati o'zgargan — sahifani yangilang");
});

/* ───────────────────────────── polling ───────────────────────────── */

const pollsOf = (calls: Call[]) => calls.filter((c) => c.path === "/api/admin/broadcasts/12").length;

test("polling: every 5 s while sending, progress follows, and it stops when the broadcast is done", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let sent = 10;
  let status = "sending";
  const calls = stubRoutes((c) =>
    c.path === "/api/admin/broadcasts/12"
      ? json(200, detailOf({ status, total: 100, sent }, { total: 100, sent, pending: 100 - sent }))
      : json(404, { error: "Topilmadi" }),
  );
  mount(h(BroadcastDetail, { id: "12" }));
  await flush();
  assert.equal(pollsOf(calls), 1, "first load");
  assert.equal(screen.getByRole("progressbar").getAttribute("aria-valuenow"), "10");

  sent = 60;
  act(() => t.mock.timers.tick(BROADCAST_POLL_MS));
  await flush();
  assert.equal(pollsOf(calls), 2, "one poll after 5 s");
  assert.equal(screen.getByRole("progressbar").getAttribute("aria-valuenow"), "60");

  sent = 100;
  status = "done";
  act(() => t.mock.timers.tick(BROADCAST_POLL_MS));
  await flush();
  assert.equal(pollsOf(calls), 3);
  assert.equal(screen.getByRole("progressbar").getAttribute("aria-valuenow"), "100");
  act(() => t.mock.timers.tick(BROADCAST_POLL_MS * 4));
  await flush();
  assert.equal(pollsOf(calls), 3, "no more polling once it is done");
});

test("polling: only while queued or sending (a draft, done and cancelled never poll)", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  for (const status of ["draft", "done", "cancelled"]) {
    const calls = stubRoutes((c) => (c.path === "/api/admin/broadcasts/12" ? json(200, detailOf({ status, total: 5, sent: 5 }, { total: 5, sent: 5 })) : json(404, { error: "x" })));
    mount(h(BroadcastDetail, { id: "12" }));
    await flush();
    act(() => t.mock.timers.tick(BROADCAST_POLL_MS * 3));
    await flush();
    assert.equal(pollsOf(calls), 1, `${status}: loaded once, never polled`);
    cleanup();
  }
  const calls = stubRoutes((c) => (c.path === "/api/admin/broadcasts/12" ? json(200, detailOf({ status: "queued", total: 5 }, { total: 5, pending: 5 })) : json(404, { error: "x" })));
  mount(h(BroadcastDetail, { id: "12" }));
  await flush();
  act(() => t.mock.timers.tick(BROADCAST_POLL_MS));
  await flush();
  assert.equal(pollsOf(calls), 2, "queued polls");
});

test("polling: a hidden tab does not poll and refreshes at once when it is visible again", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const calls = stubRoutes((c) => (c.path === "/api/admin/broadcasts/12" ? json(200, detailOf({ status: "sending", total: 100, sent: 5 }, { total: 100, sent: 5, pending: 95 })) : json(404, { error: "x" })));
  mount(h(BroadcastDetail, { id: "12" }));
  await flush();
  assert.equal(pollsOf(calls), 1);
  setVisibility("hidden");
  act(() => t.mock.timers.tick(BROADCAST_POLL_MS * 3));
  await flush();
  assert.equal(pollsOf(calls), 1, "no polling while hidden");
  setVisibility("visible");
  await flush();
  assert.equal(pollsOf(calls), 2, "immediate refresh on return");
  act(() => t.mock.timers.tick(BROADCAST_POLL_MS));
  await flush();
  assert.equal(pollsOf(calls), 3, "polling resumed");
});

test("polling: a tab that is already hidden when the page opens does not poll until it is shown", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
  const calls = stubRoutes((c) => (c.path === "/api/admin/broadcasts/12" ? json(200, detailOf({ status: "queued", total: 100 }, { total: 100, pending: 100 })) : json(404, { error: "x" })));
  mount(h(BroadcastDetail, { id: "12" }));
  await flush();
  act(() => t.mock.timers.tick(BROADCAST_POLL_MS * 3));
  await flush();
  assert.equal(pollsOf(calls), 1, "only the first load");
  setVisibility("visible");
  await flush();
  assert.equal(pollsOf(calls), 2);
  act(() => t.mock.timers.tick(BROADCAST_POLL_MS));
  await flush();
  assert.equal(pollsOf(calls), 3);
});

test("polling: a failed poll keeps the numbers on screen", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let fail = false;
  stubRoutes((c) =>
    c.path === "/api/admin/broadcasts/12"
      ? fail
        ? json(500, { error: "Baza javob bermadi", requestId: "r1" })
        : json(200, detailOf({ status: "sending", total: 100, sent: 30 }, { total: 100, sent: 30, pending: 70 }))
      : json(404, { error: "x" }),
  );
  mount(h(BroadcastDetail, { id: "12" }));
  await flush();
  assert.equal(screen.getByRole("progressbar").getAttribute("aria-valuenow"), "30");
  fail = true;
  act(() => t.mock.timers.tick(BROADCAST_POLL_MS));
  await flush();
  assert.equal(screen.getByRole("progressbar").getAttribute("aria-valuenow"), "30", "last numbers kept");
  assert.ok(!screen.queryByText("Baza javob bermadi"), "a poll error does not replace the page");
});
