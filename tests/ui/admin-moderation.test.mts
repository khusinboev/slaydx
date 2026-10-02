import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createElement as h, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext, SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import type * as CoreModule from "../../lib/admin-api/core.ts";
import type * as IdentityModule from "../../components/admin/shell/admin-identity.tsx";
import type * as ToasterModule from "../../components/admin/ui/Toaster.tsx";
import { LinksTable, filtersFromParams, filtersToSearch } from "../../components/admin/moderation/LinksTable.tsx";

/**
 * S12 moderation screen (docs/admin/02-plan.md §7.0, §7.1): the four states of
 * the list, filters in the URL, the drawer (public preview rendered as DATA,
 * results with checkboxes), revoke with a reason, single and bulk delete (typed
 * confirmation above 10 rows, a hard cap of 100), and role visibility
 * (moderator acts, support only looks).
 *
 * Mutation checks (each made the named test fail, then restored):
 *   - `canAct` forced to true in LinkDrawer → "support sees no actions" fails;
 *   - typedConfirmation condition `> TYPED_CONFIRM_ABOVE` changed to `> 100` →
 *     "typed confirmation above 10" fails;
 *   - the `tooMany` disable removed → "more than 100 selected" fails;
 *   - the bulk branch sending `deleteGameResult` for every length → "bulk
 *     delete sends all selected ids" fails;
 *   - the player-name cell rendered through dangerouslySetInnerHTML →
 *     "player names stay text" fails.
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
});

const PERMS = {
  moderator: ["moderation.view", "moderation.act"],
  support: ["moderation.view"],
} as const;
type Role = keyof typeof PERMS;

const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

type Call = { url: string; method: string; body: Record<string, unknown> | null; path: string; search: URLSearchParams };

/** Routes by method + path, so the order of the list / detail refetches does not matter. */
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
  const role = opts.role ?? "moderator";
  render(
    h(
      AppRouterContext.Provider,
      { value: router },
      h(
        PathnameContext.Provider,
        { value: "/admin/moderation" },
        h(
          SearchParamsContext.Provider,
          { value: new URLSearchParams(opts.search ?? "") },
          h(AdminIdentityProvider, { value: { adminId: "1", role, permissions: PERMS[role], name: "Admin", username: null }, children: node }),
        ),
      ),
    ),
  );
  return calls;
}

const LID = "3fa1c2d4-5b6e-4f70-8a91-b2c3d4e5f607";
const LINK = {
  id: LID,
  generationId: "9a1c2d4e-5b6e-4f70-8a91-b2c3d4e5f600",
  userId: "7",
  userName: "Ali Valiyev",
  kind: "quiz",
  topic: "Biologiya testi",
  createdAt: "2026-10-01T05:00:00.000Z",
  expiresAt: "2026-10-31T05:00:00.000Z",
  active: true,
  results: 2,
};
const list = (items: unknown[], extra: Record<string, unknown> = {}) => ({ items, nextCursor: null, total: items.length, totalCapped: false, ...extra });

const mkResult = (i: number, name = `O'yinchi ${i}`) => ({
  id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
  playerName: name,
  score: 3,
  total: 5,
  createdAt: "2026-10-01T06:00:00.000Z",
});

const PREVIEW = {
  kind: "quiz",
  title: "Biologiya testi",
  total: 1,
  questions: [{ id: "q1", kind: "single", stem: "Hujayra nima?", options: ["Tirik birlik", "Tosh"] }],
};

function detail(over: { link?: Record<string, unknown>; preview?: unknown; results?: unknown[] } = {}) {
  const results = over.results ?? [mkResult(1), mkResult(2)];
  return {
    link: { ...LINK, results: results.length, ...(over.link ?? {}) },
    preview: over.preview === undefined ? PREVIEW : over.preview,
    results,
  };
}

/** Standard handler: list + detail, plus whatever POSTs the test expects. */
function standard(d: ReturnType<typeof detail>, post?: (c: Call) => Response | Promise<Response>) {
  return (c: Call): Response | Promise<Response> => {
    if (c.method === "POST") return post ? post(c) : json(500, { error: "kutilmagan" });
    if (c.path === "/api/admin/moderation/game-links") return json(200, list([d.link]));
    if (c.path === `/api/admin/moderation/game-links/${d.link.id}`) return json(200, d);
    return json(404, { error: "Topilmadi" });
  };
}

async function openDrawer() {
  await screen.findByText("Biologiya testi", { selector: "tr span" });
  fireEvent.click(document.querySelector(`tr[data-row-key="${LID}"] td`)!);
  return screen.findByRole("dialog", { name: "O'yin havolasi" });
}

const rowBox = (key: string) => document.querySelector(`tr[data-row-key="${key}"] input[type="checkbox"]`) as HTMLInputElement;

/* ───────────────────────────── URL codec ───────────────────────────── */

test("filters ↔ URL: round trip, defaults omitted, junk dropped, q capped at 100", () => {
  const f = filtersFromParams(new URLSearchParams("active=1&kind=sorting&userId=7&q=Bio&from=2026-09-01&to=2026-09-30"));
  assert.equal(f.active, "1");
  assert.equal(f.kind, "sorting");
  assert.equal(filtersToSearch(f), "active=1&kind=sorting&userId=7&q=Bio&from=2026-09-01&to=2026-09-30");
  const junk = filtersFromParams(new URLSearchParams("active=2&kind=audio&userId=1e3&from=2026-02-30&to=2026-03-01"));
  assert.equal(filtersToSearch(junk), "");
  assert.equal(filtersFromParams(new URLSearchParams(`q=${"a".repeat(150)}`)).q.length, 100);
});

/* ───────────────────────────── list states ───────────────────────────── */

test("list: skeleton while loading, then rows with kind, owner, results and status", async () => {
  let release: (r: Response) => void = () => {};
  const calls = stubRoutes(() => new Promise<Response>((res) => (release = res)));
  mount(h(LinksTable));
  assert.ok(document.querySelector("[data-skeleton-row]"), "skeleton rows");
  assert.equal(calls[0].url, "/api/admin/moderation/game-links?limit=50");
  release(json(200, list([LINK, { ...LINK, id: "aaaaaaaa-5b6e-4f70-8a91-b2c3d4e5f607", topic: "Tarix", kind: "crossword", active: false, expiresAt: null, results: 0 }])));
  const row = await waitFor(() => {
    const r = document.querySelector(`tr[data-row-key="${LID}"]`);
    assert.ok(r);
    return r as HTMLElement;
  });
  const cells = within(row);
  assert.ok(cells.getByText("Biologiya testi"));
  assert.ok(cells.getByText("Test"));
  assert.ok(cells.getByText("Ali Valiyev"));
  assert.ok(cells.getByText("Faol"));
  const dead = within(document.querySelector('tr[data-row-key="aaaaaaaa-5b6e-4f70-8a91-b2c3d4e5f607"]') as HTMLElement);
  assert.ok(dead.getByText("Faol emas"));
  assert.ok(dead.getByText("Muddatsiz"));
  assert.ok(screen.getByText("2 ta natija"));
});

test("list: empty with filters offers 'Filtrlarni tozalash', which resets the URL", async () => {
  stubRoutes((c) => (assert.equal(c.search.get("kind"), "sorting"), json(200, list([]))));
  const router = mount(h(LinksTable), { search: "kind=sorting" });
  await screen.findByText("Havola topilmadi");
  const clear = screen.getAllByRole("button", { name: "Filtrlarni tozalash" });
  fireEvent.click(clear[clear.length - 1]);
  assert.deepEqual(router.replace, ["/admin/moderation"]);
});

test("list: empty without filters has no clear button", async () => {
  stubRoutes(() => json(200, list([])));
  mount(h(LinksTable));
  await screen.findByText("Hali birorta o'yin havolasi yaratilmagan.");
  assert.ok(!screen.queryByRole("button", { name: "Filtrlarni tozalash" }));
});

test("list: error shows the request id; retry refetches", async () => {
  let n = 0;
  const calls = stubRoutes(() => (++n === 1 ? json(500, { error: "Server xatosi", requestId: "req-123" }) : json(200, list([LINK]))));
  mount(h(LinksTable));
  await screen.findByText("req-123");
  fireEvent.click(screen.getByRole("button", { name: "Qayta urinish" }));
  await screen.findByText("Biologiya testi", { selector: "tr span" });
  assert.equal(calls.length, 2);
});

test("list: 403 renders Forbidden", async () => {
  stubRoutes(() => json(403, { error: "Ruxsat yo'q", code: "forbidden" }));
  mount(h(LinksTable));
  await screen.findByText("Ruxsat yo'q");
  // Forbidden is the only state: no filter bar above it (UX #9).
  assert.ok(!screen.queryByLabelText("Mavzu bo'yicha qidirish"));
  assert.ok(!screen.queryByRole("radiogroup", { name: "Havola holati" }));
  assert.ok(!screen.queryByLabelText("Turi"));
});

test("list: filters write the URL and the request carries them", async () => {
  const calls = stubRoutes(() => json(200, list([LINK])));
  const router = mount(h(LinksTable), { search: "kind=quiz" });
  await screen.findByText("Biologiya testi", { selector: "tr span" });
  assert.equal(calls[0].search.get("kind"), "quiz");
  fireEvent.click(screen.getByRole("radio", { name: "Faol" }));
  fireEvent.change(screen.getByLabelText("Turi"), { target: { value: "sorting" } });
  assert.deepEqual(router.replace, ["/admin/moderation?active=1&kind=quiz", "/admin/moderation?kind=sorting"]);
});

test("list: 'Keyingi' sends the cursor", async () => {
  const calls = stubRoutes((c) => (c.search.get("cursor") === "CUR1" ? json(200, list([LINK], { total: 2 })) : json(200, list([LINK], { nextCursor: "CUR1", total: 2 }))));
  mount(h(LinksTable));
  await screen.findByText("2 ta natija");
  fireEvent.click(screen.getByRole("button", { name: "Keyingi" }));
  await waitFor(() => assert.equal(calls.length, 2));
  assert.equal(calls[1].search.get("cursor"), "CUR1");
});

/* ───────────────────────────── drawer ───────────────────────────── */

test("drawer: row click loads the detail; preview and results render as data; player names stay text", async () => {
  const evil = "<img src=x onerror=alert(1)>";
  const d = detail({
    results: [mkResult(1, evil), mkResult(2)],
    preview: { ...PREVIEW, questions: [{ id: "q1", kind: "single", stem: "<b>qalin</b> savol", options: ["<script>x</script>", "oddiy"] }] },
  });
  stubRoutes(standard(d));
  mount(h(LinksTable));
  const drawer = await openDrawer();
  await within(drawer).findByText("Natijalar (2)");
  const d$ = within(drawer);
  assert.ok(d$.getAllByText(/<b>qalin<\/b> savol/).length >= 1, "markup in the preview is shown literally");
  assert.ok(d$.getAllByText("<script>x</script>").length >= 1);
  assert.ok(d$.getAllByText(evil).length >= 1, "player name is plain text");
  assert.ok(!drawer.querySelector("img"), "no element was created from a player name");
  assert.ok(!drawer.querySelector("script"));
  assert.ok(d$.getAllByText(/Biologiya testi/).length >= 1);
  assert.ok(d$.getByText(/Xom JSON/));
});

test("drawer: preview null explains itself; dead link shows no revoke button", async () => {
  stubRoutes(standard(detail({ preview: null, link: { active: false } })));
  mount(h(LinksTable));
  const drawer = await openDrawer();
  await within(drawer).findByText(/Ochiq ko'rinish mavjud emas/);
  assert.ok(!within(drawer).queryByRole("button", { name: "Havolani o'chirish" }));
});

test("drawer: detail error shows the request id and retries", async () => {
  let n = 0;
  stubRoutes((c) => {
    if (c.path === "/api/admin/moderation/game-links") return json(200, list([LINK]));
    return ++n === 1 ? json(500, { error: "Server xatosi", requestId: "req-detail" }) : json(200, detail());
  });
  mount(h(LinksTable));
  const drawer = await openDrawer();
  await within(drawer).findByText("req-detail");
  fireEvent.click(within(drawer).getByRole("button", { name: "Qayta urinish" }));
  await within(drawer).findByText("Natijalar (2)");
});

test("support sees the drawer but no actions or checkboxes", async () => {
  stubRoutes(standard(detail()));
  mount(h(LinksTable), { role: "support" });
  const drawer = await openDrawer();
  await within(drawer).findByText("Natijalar (2)");
  assert.ok(!within(drawer).queryByRole("button", { name: "Havolani o'chirish" }));
  assert.ok(!within(drawer).queryByRole("button", { name: "O'chirish" }));
  assert.ok(!drawer.querySelector('input[type="checkbox"]'));
  assert.ok(within(drawer).getAllByText("O'yinchi 1").length >= 1, "results are still listed");
});

test("revoke: reason required, POST with the reason, toast, detail and list refetched", async () => {
  let revoked = false;
  const calls = stubRoutes((c) => {
    if (c.method === "POST") {
      revoked = true;
      return json(200, { link: { ...LINK, active: false } });
    }
    if (c.path === "/api/admin/moderation/game-links") return json(200, list([{ ...LINK, active: !revoked }]));
    return json(200, detail({ link: { active: !revoked } }));
  });
  mount(h(LinksTable));
  const drawer = await openDrawer();
  fireEvent.click(await within(drawer).findByRole("button", { name: "Havolani o'chirish" }));
  const dialog = await screen.findByRole("dialog", { name: "Havolani o'chirish" });
  const confirm = within(dialog).getByRole("button", { name: "Havolani o'chirish" }) as HTMLButtonElement;
  assert.equal(confirm.disabled, true, "reason is required");
  fireEvent.change(within(dialog).getByLabelText("Sabab"), { target: { value: "abc" } });
  assert.equal(confirm.disabled, true, "5 characters minimum");
  fireEvent.change(within(dialog).getByLabelText("Sabab"), { target: { value: "Reklama havolasi bor" } });
  assert.equal(confirm.disabled, false);
  fireEvent.click(confirm);
  await waitFor(() => assert.ok(calls.some((c) => c.method === "POST")));
  const post = calls.find((c) => c.method === "POST")!;
  assert.equal(post.path, `/api/admin/moderation/game-links/${LID}/revoke`);
  assert.deepEqual(post.body, { reason: "Reklama havolasi bor" });
  await waitFor(() => assert.ok(!screen.queryByRole("dialog", { name: "Havolani o'chirish" })));
  assert.ok(useToastStore.getState().toasts.some((t) => t.message === "Havola o'chirildi"));
  // The drawer and the list were refetched: the revoke button is gone and the row is dead.
  await waitFor(() => assert.ok(!within(drawer).queryByRole("button", { name: "Havolani o'chirish" })));
  await waitFor(() => assert.ok(within(document.querySelector(`tr[data-row-key="${LID}"]`) as HTMLElement).getByText("Faol emas")));
});

test("revoke: a 409 keeps the dialog open with the server message and refetches", async () => {
  const calls = stubRoutes((c) => {
    if (c.method === "POST") return json(409, { error: "Havola allaqachon o'chirilgan yoki muddati tugagan", code: "state" });
    if (c.path === "/api/admin/moderation/game-links") return json(200, list([LINK]));
    return json(200, detail());
  });
  mount(h(LinksTable));
  const drawer = await openDrawer();
  fireEvent.click(await within(drawer).findByRole("button", { name: "Havolani o'chirish" }));
  const dialog = await screen.findByRole("dialog", { name: "Havolani o'chirish" });
  fireEvent.change(within(dialog).getByLabelText("Sabab"), { target: { value: "Reklama havolasi bor" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Havolani o'chirish" }));
  await within(dialog).findByText("Havola allaqachon o'chirilgan yoki muddati tugagan");
  assert.ok(calls.filter((c) => c.method === "GET").length >= 4, "list and detail refetched after the conflict");
});

test("single delete: the row button asks for a reason and calls the single endpoint", async () => {
  const d = detail();
  const calls = stubRoutes(standard(d, () => json(200, { ok: true })));
  mount(h(LinksTable));
  const drawer = await openDrawer();
  await within(drawer).findByText("Natijalar (2)");
  const r1 = d.results[0] as { id: string };
  fireEvent.click(document.querySelector(`tr[data-row-key="${r1.id}"] button`)!);
  const dialog = await screen.findByRole("dialog", { name: "Natijani o'chirish" });
  assert.ok(within(dialog).getByText(/O'yinchi 1/));
  fireEvent.change(within(dialog).getByLabelText("Sabab"), { target: { value: "Haqoratli ism" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "O'chirish" }));
  await waitFor(() => assert.ok(calls.some((c) => c.method === "POST")));
  const post = calls.find((c) => c.method === "POST")!;
  assert.equal(post.path, `/api/admin/moderation/game-results/${r1.id}/delete`);
  assert.deepEqual(post.body, { reason: "Haqoratli ism" });
  await waitFor(() => assert.ok(useToastStore.getState().toasts.some((t) => t.message === "Natija o'chirildi")));
});

test("bulk delete sends all selected ids to the bulk endpoint; no typed confirmation up to 10", async () => {
  const d = detail({ results: Array.from({ length: 5 }, (_, i) => mkResult(i + 1)) });
  const calls = stubRoutes(standard(d, () => json(200, { ok: true, deleted: 3 })));
  mount(h(LinksTable));
  const drawer = await openDrawer();
  await within(drawer).findByText("Natijalar (5)");
  const ids = d.results.map((r) => (r as { id: string }).id);
  assert.ok(!within(drawer).queryByRole("button", { name: /Tanlanganlarni o'chirish/ }), "no bulk button without a selection");
  for (const id of ids.slice(0, 3)) fireEvent.click(rowBox(id));
  fireEvent.click(within(drawer).getByRole("button", { name: "Tanlanganlarni o'chirish (3)" }));
  const dialog = await screen.findByRole("dialog", { name: "Natijalarni o'chirish" });
  assert.ok(within(dialog).getByText("3 ta natija"));
  assert.ok(!within(dialog).queryByLabelText(/deb yozing/), "no typed confirmation for 3 rows");
  fireEvent.change(within(dialog).getByLabelText("Sabab"), { target: { value: "Reklama ismlar" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "O'chirish" }));
  await waitFor(() => assert.ok(calls.some((c) => c.method === "POST")));
  const post = calls.find((c) => c.method === "POST")!;
  assert.equal(post.path, "/api/admin/moderation/game-results/delete");
  assert.deepEqual(post.body, { ids: ids.slice(0, 3), reason: "Reklama ismlar" });
  await waitFor(() => assert.ok(useToastStore.getState().toasts.some((t) => t.message === "3 ta natija o'chirildi")));
  // The selection is cleared after the refresh.
  await waitFor(() => assert.ok(!within(drawer).queryByRole("button", { name: /Tanlanganlarni o'chirish/ })));
});

test("typed confirmation above 10 rows: the button stays disabled until the count is typed", async () => {
  const d = detail({ results: Array.from({ length: 12 }, (_, i) => mkResult(i + 1)) });
  const calls = stubRoutes(standard(d, () => json(200, { ok: true, deleted: 12 })));
  mount(h(LinksTable));
  const drawer = await openDrawer();
  await within(drawer).findByText("Natijalar (12)");
  fireEvent.click(within(drawer).getByRole("checkbox", { name: "Hammasini tanlash" }));
  fireEvent.click(within(drawer).getByRole("button", { name: "Tanlanganlarni o'chirish (12)" }));
  const dialog = await screen.findByRole("dialog", { name: "Natijalarni o'chirish" });
  const confirm = within(dialog).getByRole("button", { name: "O'chirish" }) as HTMLButtonElement;
  fireEvent.change(within(dialog).getByLabelText("Sabab"), { target: { value: "Spam natijalar" } });
  assert.equal(confirm.disabled, true, "reason alone is not enough above 10 rows");
  const typed = within(dialog).getByLabelText(/deb yozing/);
  fireEvent.change(typed, { target: { value: "11" } });
  assert.equal(confirm.disabled, true);
  fireEvent.change(typed, { target: { value: "12" } });
  assert.equal(confirm.disabled, false);
  fireEvent.click(confirm);
  await waitFor(() => assert.ok(calls.some((c) => c.method === "POST")));
  assert.equal((calls.find((c) => c.method === "POST")!.body!.ids as string[]).length, 12);
});

test("more than 100 selected: the bulk button is disabled with an explanation", async () => {
  const d = detail({ results: Array.from({ length: 150 }, (_, i) => mkResult(i + 1)) });
  stubRoutes(standard(d));
  mount(h(LinksTable));
  const drawer = await openDrawer();
  await within(drawer).findByText(/Natijalar \(150\)/);
  fireEvent.click(within(drawer).getByRole("checkbox", { name: "Hammasini tanlash" }));
  const btn = within(drawer).getByRole("button", { name: "Tanlanganlarni o'chirish (150)" }) as HTMLButtonElement;
  assert.equal(btn.disabled, true);
  assert.ok(within(drawer).getByText(/ko'pi bilan 100 ta natija/));
});

test("detail 403 renders Forbidden inside the drawer", async () => {
  stubRoutes((c) => (c.path === "/api/admin/moderation/game-links" ? json(200, list([LINK])) : json(403, { error: "Ruxsat yo'q", code: "forbidden" })));
  mount(h(LinksTable));
  const drawer = await openDrawer();
  await within(drawer).findByText("Ruxsat yo'q");
});
