import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext, SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import type { AuditEntry, AuditItem } from "../../lib/admin-api/audit.ts";
import * as core from "../../lib/admin-api/core.ts";
import { AuditPage } from "../../components/admin/audit/AuditPage.tsx";
import { AdminIdentityProvider } from "../../components/admin/shell/admin-identity.tsx";
import { useToastStore } from "../../components/admin/ui/Toaster.tsx";
import { activeFilterCount, diffSnapshots, parseFilters, parseOpenId, targetHref } from "../../components/admin/audit/shared.ts";

/**
 * S17 `/admin/audit` (docs/admin/02-plan.md §7.0, §7.1):
 *   - the four states (skeleton, empty with "Filtrlarni tozalash", error with requestId + retry, 403);
 *   - filters and the open drawer live in the URL, a deep link `?targetType=user&targetId=42`
 *     filters the request, a filter change aborts the pending request and returns to page one;
 *   - targets link to the matching admin screen only when the type maps to one;
 *   - the drawer shows a before / after diff (changed keys highlighted) and meta, all as text;
 *   - the CSV export is offered to audit.export only and asks for step-up first.
 */

const realFetch = globalThis.fetch;
const realClick = window.HTMLAnchorElement.prototype.click;
const realCreateObjectURL = URL.createObjectURL;
const realRevokeObjectURL = URL.revokeObjectURL;
afterEach(() => {
  cleanup();
  useToastStore.getState().clear();
  core.setStepUpHandler(null);
  globalThis.fetch = realFetch;
  window.HTMLAnchorElement.prototype.click = realClick;
  URL.createObjectURL = realCreateObjectURL;
  URL.revokeObjectURL = realRevokeObjectURL;
});

const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

type Call = { url: URL; method: string; signal: AbortSignal | null | undefined };
function stubFetch(handler: (call: Call, n: number) => Response | Promise<Response>): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: string, init: RequestInit = {}) => {
    const call: Call = { url: new URL(String(input), "http://localhost"), method: init.method ?? "GET", signal: init.signal };
    calls.push(call);
    return handler(call, calls.length);
  }) as typeof fetch;
  return calls;
}

const OWNER = ["audit.view", "audit.export", "admins.view"];
const ADMIN = ["audit.view", "admins.view"];

function renderAt(query: string, permissions: string[] = OWNER, role = "owner") {
  const calls = { replace: [] as string[], push: [] as string[] };
  const router: AppRouterInstance = {
    back() {},
    forward() {},
    refresh() {},
    prefetch() {},
    push: (href: string) => void calls.push.push(href),
    replace: (href: string) => void calls.replace.push(href),
  };
  const node: ReactNode = h(AdminIdentityProvider, {
    value: { adminId: "1", role, permissions, name: "Test", username: null, twoFactor: true },
    children: h(AppRouterContext.Provider, { value: router }, h(PathnameContext.Provider, { value: "/admin/audit" }, h(SearchParamsContext.Provider, { value: new URLSearchParams(query) }, h(AuditPage)))),
  });
  return { ...render(node), calls };
}

const UUID_GEN = "11111111-2222-4333-8444-555566667777";
const UUID_ORDER = "0b3a2f6e-1111-4222-8333-444455556666";
const UUID_GAME = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function item(over: Partial<AuditItem> & { id: string }): AuditItem {
  return {
    at: "2026-03-09T08:00:00.000Z",
    adminId: "2",
    adminName: "Admin Test",
    adminUsername: "admintest",
    actorRole: "admin",
    action: "users.block",
    targetType: "user",
    targetId: "77",
    outcome: "ok",
    reason: "spam akkaunt",
    ip: "10.9.9.9",
    ...over,
  };
}

const ITEMS: AuditItem[] = [
  item({ id: "9" }),
  item({ id: "8", action: "jobs.refund", targetType: "generation", targetId: UUID_GEN }),
  item({ id: "7", action: "payments.refund_record", targetType: "order", targetId: UUID_ORDER, actorRole: "owner", adminName: "Egasi" }),
  item({ id: "6", action: "settings.update", targetType: "setting", targetId: "free_llm.disabled" }),
  item({ id: "5", action: "admins.update", targetType: "admin", targetId: "3" }),
  item({ id: "4", action: "moderation.revoke", targetType: "game_session", targetId: UUID_GAME }),
  item({ id: "3", action: "auth.denied", outcome: "denied", targetType: null, targetId: null, reason: null }),
  item({ id: "2", action: "admins.create", adminId: null, adminName: null, adminUsername: null, actorRole: null, targetType: "admin", targetId: "1", reason: "CLI bootstrap", ip: null }),
  item({ id: "1", action: "errors.resolve", targetType: "error", targetId: "12" }),
  item({ id: "10", action: "something.new", targetType: "custom_thing", targetId: "abc" }),
];

type ListBody = { items: AuditItem[]; nextCursor: string | null; total: number | null; totalCapped: boolean };
const listBody = (over: Partial<ListBody> = {}): ListBody => ({ items: ITEMS, nextCursor: null, total: ITEMS.length, totalCapped: false, ...over });

const ADMINS = [
  { id: "2", userId: "20", name: "Admin Test", username: "admintest", role: "admin", status: "active", totpEnabled: true, lastLoginAt: null, createdAt: "2026-03-01T00:00:00.000Z", activeSessions: 1 },
  { id: "1", userId: "10", name: "Egasi", username: null, role: "owner", status: "active", totpEnabled: true, lastLoginAt: null, createdAt: "2026-03-01T00:00:00.000Z", activeSessions: 2 },
];

const ENTRY: AuditEntry = {
  ...item({ id: "9" }),
  actorUserId: "20",
  before: { is_blocked: false, note: "eski", same: 1 },
  after: { is_blocked: true, extra: "<img src=x onerror=alert(1)>", same: 1 },
  meta: { sessions_revoked: true, via: "<script>alert(1)</script>" },
  requestId: "req-block-1",
  userAgent: "Mozilla/5.0 test",
};

/** Answers list, detail and the admin picker like the API does. */
function auditApi(over: { list?: (c: Call) => Response; entry?: (id: string) => Response } = {}) {
  return (c: Call): Response => {
    const path = c.url.pathname;
    if (path === "/api/admin/audit") return over.list ? over.list(c) : json(200, listBody());
    if (path === "/api/admin/admins") return json(200, { items: ADMINS });
    const m = /^\/api\/admin\/audit\/(\d+)$/.exec(path);
    if (m) return over.entry ? over.entry(m[1]) : json(200, { entry: { ...ENTRY, id: m[1] } });
    return json(404, { error: "Topilmadi" });
  };
}

const listCalls = (calls: Call[]) => calls.filter((c) => c.url.pathname === "/api/admin/audit");
const rowOf = (container: HTMLElement, id: string) => container.querySelector(`tr[data-row-key="${id}"]`) as HTMLElement;

test("loading skeleton, then rows with time, admin, role, action, target, outcome, reason and IP", async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  const calls = stubFetch(async (c) => {
    await gate;
    return auditApi()(c);
  });
  const { container } = renderAt("");
  assert.ok(container.querySelector("[data-skeleton-row]"), "skeleton rows while loading");
  release();
  await waitFor(() => assert.ok(rowOf(container, "9")));
  const l = listCalls(calls)[0];
  assert.equal(l.url.searchParams.get("limit"), "50");
  assert.ok(l.signal, "the request carries an AbortSignal");

  const r9 = rowOf(container, "9");
  const text = r9.textContent ?? "";
  assert.match(text, /09\.03\.2026 13:00/, "Tashkent time");
  assert.match(text, /Admin Test/);
  assert.match(text, /@admintest/);
  assert.match(text, /Admin/);
  assert.match(text, /users\.block/);
  // Uzbek names for the stored enums (UX #5): target type and outcome.
  assert.match(text, /Foydalanuvchi/);
  assert.doesNotMatch(text, /\buser\b/);
  assert.match(text, /77/);
  assert.match(text, /Bajarildi/);
  assert.match(text, /spam akkaunt/);
  assert.match(text, /10\.9\.9\.9/);
  assert.match(container.textContent ?? "", /10 ta natija/);
  assert.match(rowOf(container, "7").textContent ?? "", /Egasi/);
  assert.match(rowOf(container, "3").textContent ?? "", /Rad etildi/);
  assert.doesNotMatch(rowOf(container, "3").querySelector("td:nth-child(6)")?.textContent ?? "", /denied/);
  assert.match(rowOf(container, "2").textContent ?? "", /Tizim \(CLI\)/);
});

test("targets link to the matching admin screen; types without a screen stay plain text", async () => {
  stubFetch(auditApi());
  const { container } = renderAt("");
  await waitFor(() => assert.ok(rowOf(container, "9")));
  const hrefOf = (id: string) => rowOf(container, id).querySelector('a[href]:not([href=""])')?.getAttribute("href") ?? null;
  assert.equal(hrefOf("9"), "/admin/users/77");
  assert.equal(hrefOf("8"), `/admin/generations/${UUID_GEN}`);
  assert.equal(hrefOf("7"), `/admin/payments/${UUID_ORDER}`);
  assert.equal(hrefOf("6"), "/admin/settings");
  assert.equal(hrefOf("5"), "/admin/admins");
  assert.equal(hrefOf("4"), "/admin/moderation");
  assert.equal(hrefOf("1"), "/admin/errors?id=12");
  assert.equal(hrefOf("3"), null, "no target, no link");
  assert.equal(hrefOf("10"), null, "an unknown type has no screen");
  assert.match(rowOf(container, "10").textContent ?? "", /custom_thing/);

  // The link builder only accepts well-formed ids (never raw data in an href).
  assert.equal(targetHref("user", "77"), "/admin/users/77");
  assert.equal(targetHref("user", "../x"), null);
  assert.equal(targetHref("user", "0"), null);
  assert.equal(targetHref("generation", "not-a-uuid"), null);
  assert.equal(targetHref("order", "javascript:alert(1)"), null);
  assert.equal(targetHref("admin", null), "/admin/admins");
  assert.equal(targetHref(null, "5"), null);
});

test("a deep link ?targetType=user&targetId=42 filters the request and fills the controls", async () => {
  const calls = stubFetch(auditApi());
  const { container } = renderAt("targetType=user&targetId=42");
  await waitFor(() => assert.ok(rowOf(container, "9")));
  const u = listCalls(calls)[0].url.searchParams;
  assert.equal(u.get("targetType"), "user");
  assert.equal(u.get("targetId"), "42");
  assert.equal((screen.getByLabelText("Nishon turi") as HTMLSelectElement).value, "user");
  assert.equal((screen.getByLabelText("Nishon identifikatori bo'yicha filtr") as HTMLInputElement).value, "42");
  assert.ok(screen.getAllByRole("button", { name: "Filtrlarni tozalash" }).length >= 1, "filters are active");
});

test("filters live in the URL and the full filter set reaches the API", async () => {
  stubFetch(auditApi());
  const { calls, container } = renderAt("");
  await waitFor(() => assert.ok(rowOf(container, "9")));

  // The chip says "Rad etildi"; the URL keeps the raw filter value.
  assert.ok(screen.getByRole("radio", { name: "Bajarildi" }));
  assert.ok(screen.getByRole("radio", { name: "Muvaffaqiyatsiz" }));
  fireEvent.click(screen.getByRole("radio", { name: "Rad etildi" }));
  assert.equal(calls.replace.at(-1), "/admin/audit?outcome=denied");
  fireEvent.click(screen.getByRole("radio", { name: "Hammasi" }));
  assert.equal(calls.replace.at(-1), "/admin/audit", "the default drops the param");
  fireEvent.change(screen.getByLabelText("Nishon turi"), { target: { value: "setting" } });
  assert.equal(calls.replace.at(-1), "/admin/audit?targetType=setting");
  fireEvent.change(screen.getByLabelText("Admin"), { target: { value: "2" } });
  assert.equal(calls.replace.at(-1), "/admin/audit?adminId=2");

  fireEvent.click(screen.getByRole("button", { name: "Sana bo'yicha filtr" }));
  const range = new URL(calls.replace.at(-1)!, "http://localhost");
  assert.ok(range.searchParams.get("from")! < range.searchParams.get("to")!);
  cleanup();

  const calls2 = stubFetch(auditApi());
  const withFilters = renderAt("adminId=2&action=users.&targetType=user&targetId=77&outcome=ok&from=2026-03-01&to=2026-03-07");
  await waitFor(() => assert.ok(listCalls(calls2).length >= 1));
  const u = listCalls(calls2)[0].url.searchParams;
  assert.deepEqual(
    ["adminId", "action", "targetType", "targetId", "outcome", "from", "to"].map((k) => u.get(k)),
    ["2", "users.", "user", "77", "ok", "2026-03-01", "2026-03-07"],
  );
  fireEvent.click(screen.getAllByRole("button", { name: "Filtrlarni tozalash" })[0]);
  assert.equal(withFilters.calls.replace.at(-1), "/admin/audit");
});

test("invalid / over-long URL values fall back instead of reaching the API", async () => {
  const calls = stubFetch(auditApi());
  renderAt(`adminId=abc&outcome=maybe&action=${"a".repeat(300)}&targetType=${"t".repeat(100)}&targetId=${"i".repeat(300)}&from=2026-13-01&to=2026-03-07&id=abc`);
  await waitFor(() => assert.ok(listCalls(calls).length >= 1));
  const u = listCalls(calls)[0].url.searchParams;
  assert.equal(u.get("adminId"), null);
  assert.equal(u.get("outcome"), null);
  assert.equal(u.get("action")!.length, 100);
  assert.equal(u.get("targetType")!.length, 64);
  assert.equal(u.get("targetId")!.length, 200);
  assert.equal(u.get("from"), null);
  assert.equal(u.get("to"), null);
  assert.ok(!calls.some((c) => /\/api\/admin\/audit\/\w+$/.test(c.url.pathname)), "an invalid ?id= opens no drawer");

  const f = parseFilters(new URLSearchParams("outcome=denied&from=2026-03-01&to=2025-01-01&adminId=5"));
  assert.equal(f.outcome, "denied");
  assert.equal(f.from, "", "a reversed range is dropped");
  assert.equal(activeFilterCount(f), 2);
  assert.equal(parseOpenId(new URLSearchParams("id=123")), "123");
  assert.equal(parseOpenId(new URLSearchParams("id=0")), null);
  assert.equal(parseOpenId(new URLSearchParams("id=1e3")), null);
});

test("changing a filter aborts the pending request", async () => {
  const calls = stubFetch((c) => (c.url.pathname === "/api/admin/audit" ? new Promise<Response>(() => {}) : auditApi()(c)));
  const first = renderAt("");
  await waitFor(() => assert.ok(listCalls(calls).length >= 1));
  const signal = listCalls(calls)[0].signal;
  assert.ok(signal && !signal.aborted);
  const router: AppRouterInstance = { back() {}, forward() {}, refresh() {}, prefetch() {}, push() {}, replace() {} };
  first.rerender(
    h(AdminIdentityProvider, {
      value: { adminId: "1", role: "owner", permissions: OWNER, name: "Test", username: null, twoFactor: true },
      children: h(AppRouterContext.Provider, { value: router }, h(PathnameContext.Provider, { value: "/admin/audit" }, h(SearchParamsContext.Provider, { value: new URLSearchParams("outcome=failed") }, h(AuditPage)))),
    }),
  );
  await waitFor(() => assert.ok(signal.aborted, "stale request aborted"));
  await waitFor(() => assert.equal(listCalls(calls).at(-1)!.url.searchParams.get("outcome"), "failed"));
});

test("paging passes the cursor; a filter change returns to the first page", async () => {
  const calls = stubFetch(
    auditApi({
      list: (c) =>
        c.url.searchParams.get("cursor")
          ? json(200, listBody({ items: [ITEMS[9]], nextCursor: null, total: 10 }))
          : json(200, listBody({ items: ITEMS.slice(0, 2), nextCursor: "CUR1", total: 10 })),
    }),
  );
  const view = renderAt("");
  const { container } = view;
  await waitFor(() => assert.ok(rowOf(container, "9")));
  fireEvent.click(screen.getByRole("button", { name: "Keyingi" }));
  await waitFor(() => assert.ok(rowOf(container, "10")));
  assert.equal(listCalls(calls).at(-1)!.url.searchParams.get("cursor"), "CUR1");
  assert.deepEqual([...container.querySelectorAll("tr[data-row-key]")].map((r) => r.getAttribute("data-row-key")), ["10"]);
  fireEvent.click(screen.getByRole("button", { name: "Oldingi" }));
  await waitFor(() => assert.ok(rowOf(container, "9")));
  assert.equal(listCalls(calls).at(-1)!.url.searchParams.get("cursor"), null, "back to the first page");

  // A filter change while on page two starts again at page one (a cursor belongs to one filter set).
  fireEvent.click(screen.getByRole("button", { name: "Keyingi" }));
  await waitFor(() => assert.equal(listCalls(calls).at(-1)!.url.searchParams.get("cursor"), "CUR1"));
  const router: AppRouterInstance = { back() {}, forward() {}, refresh() {}, prefetch() {}, push() {}, replace() {} };
  view.rerender(
    h(AdminIdentityProvider, {
      value: { adminId: "1", role: "owner", permissions: OWNER, name: "Test", username: null, twoFactor: true },
      children: h(AppRouterContext.Provider, { value: router }, h(PathnameContext.Provider, { value: "/admin/audit" }, h(SearchParamsContext.Provider, { value: new URLSearchParams("outcome=denied") }, h(AuditPage)))),
    }),
  );
  await waitFor(() => assert.equal(listCalls(calls).at(-1)!.url.searchParams.get("outcome"), "denied"));
  assert.equal(listCalls(calls).at(-1)!.url.searchParams.get("cursor"), null, "the new filter set starts at the first page");
});

test("empty: with filters it offers to clear them; without filters it just says there is nothing", async () => {
  stubFetch(auditApi({ list: () => json(200, listBody({ items: [], total: 0 })) }));
  const withFilters = renderAt("outcome=failed");
  await screen.findByText("Filtrlarga mos yozuv topilmadi");
  const empty = screen.getByText("Filtrlarga mos yozuv topilmadi").closest("div")!.parentElement as HTMLElement;
  fireEvent.click(within(empty).getByRole("button", { name: "Filtrlarni tozalash" }));
  assert.equal(withFilters.calls.replace.at(-1), "/admin/audit");
  cleanup();

  stubFetch(auditApi({ list: () => json(200, listBody({ items: [], total: 0 })) }));
  renderAt("");
  await screen.findByText("Audit yozuvlari yo'q");
  assert.ok(!screen.queryByRole("button", { name: "Filtrlarni tozalash" }));
});

test("error shows the message and requestId, retry reloads; 403 renders Forbidden", async () => {
  let n = 0;
  const api = auditApi();
  const { container } = (() => {
    stubFetch((c) => {
      if (c.url.pathname === "/api/admin/audit") {
        n += 1;
        return n === 1 ? json(500, { error: "Ichki xatolik", requestId: "req-aud-9" }) : api(c);
      }
      return api(c);
    });
    return renderAt("");
  })();
  const alert = await screen.findByRole("alert");
  assert.match(alert.textContent ?? "", /Ichki xatolik/);
  assert.match(alert.textContent ?? "", /req-aud-9/);
  fireEvent.click(within(alert).getByRole("button", { name: "Qayta urinish" }));
  await waitFor(() => assert.ok(rowOf(container, "9")));
  cleanup();

  stubFetch(auditApi({ list: () => json(403, { error: "Bu amal uchun ruxsatingiz yo'q", code: "forbidden" }) }));
  renderAt("", ["audit.view", "audit.export"]);
  await screen.findByText("Ruxsat yo'q");
  // Forbidden is the only state: no filter bar, date filter, export or pager above or below it (UX #9).
  assert.ok(!screen.queryByLabelText("Amal bo'yicha filtr"));
  assert.ok(!screen.queryByRole("button", { name: "Sana bo'yicha filtr" }));
  assert.ok(!screen.queryByRole("button", { name: /CSV/ }));
});

/* ───────────────────────────── drawer ───────────────────────────── */

test("a row opens the drawer via ?id=; the drawer shows who/what, a highlighted diff and meta as text", async () => {
  stubFetch(auditApi());
  const { calls: nav, container } = renderAt("");
  await waitFor(() => assert.ok(rowOf(container, "9")));
  fireEvent.click(rowOf(container, "9"));
  // N3: the row PUSHES ?id=, so the URL entry is the drawer's history entry (phone back closes it).
  assert.equal(nav.push.at(-1), "/admin/audit?id=9");
  assert.equal(nav.replace.length, 0, "opening the drawer is not a replace");
  cleanup();

  const calls = stubFetch(auditApi());
  const view = renderAt("id=9");
  const dialog = await screen.findByRole("dialog", { name: "Audit yozuvi" });
  await within(dialog).findByText("req-block-1");
  assert.ok(calls.some((c) => c.url.pathname === "/api/admin/audit/9"));
  const text = dialog.textContent ?? "";
  assert.match(text, /Admin Test/);
  assert.match(text, /users\.block/);
  assert.match(text, /Mozilla\/5\.0 test/);
  assert.match(text, /spam akkaunt/);
  assert.match(text, /09\.03\.2026 13:00:00/, "the drawer shows the second too");

  // Diff: changed / added / removed / same, each key on its own row.
  const kind = (key: string) => [...dialog.querySelectorAll("tr[data-diff]")].find((r) => r.querySelector("th")!.textContent!.startsWith(key))!.getAttribute("data-diff");
  assert.equal(kind("is_blocked"), "changed");
  assert.equal(kind("extra"), "added");
  assert.equal(kind("note"), "removed");
  assert.equal(kind("same"), "same");
  const changed = dialog.querySelector('tr[data-diff="changed"]')!;
  assert.match(changed.textContent ?? "", /false/);
  assert.match(changed.textContent ?? "", /true/);
  assert.match(dialog.textContent ?? "", /sessions_revoked/, "meta");

  // Everything is text: markup in values never becomes an element.
  assert.ok(!view.container.querySelector("img") && !document.querySelector("img"), "no element created from a value");
  assert.ok(!document.querySelector("script"));
  assert.ok(within(dialog).getAllByText(/<img src=x onerror=alert\(1\)>/).length >= 1);
  assert.ok(within(dialog).getAllByText(/<script>alert\(1\)<\/script>/).length >= 1);

  // The target link inside the drawer points at the user screen.
  assert.equal(dialog.querySelector('a[href="/admin/users/77"]')?.getAttribute("href"), "/admin/users/77");
});

test("drawer: the filter shortcuts narrow the list by this action / admin and close the drawer; a system row has no admin shortcut", async () => {
  stubFetch(auditApi());
  const view = renderAt("outcome=ok&id=9");
  const dialog = await screen.findByRole("dialog", { name: "Audit yozuvi" });
  await within(dialog).findByText("req-block-1");
  fireEvent.click(within(dialog).getByRole("button", { name: "Shu amal bo'yicha filtrlash" }));
  assert.equal(view.calls.replace.at(-1), "/admin/audit?outcome=ok&action=users.block", "keeps the other filters, drops ?id=");
  fireEvent.click(within(dialog).getByRole("button", { name: "Shu admin bo'yicha filtrlash" }));
  assert.equal(view.calls.replace.at(-1), "/admin/audit?outcome=ok&adminId=2");
  cleanup();

  stubFetch(auditApi({ entry: (id) => json(200, { entry: { ...ENTRY, id, adminId: null, adminName: null, adminUsername: null, actorRole: null } }) }));
  renderAt("id=2");
  const d2 = await screen.findByRole("dialog", { name: "Audit yozuvi" });
  await within(d2).findByText("Tizim (CLI)");
  assert.ok(within(d2).getByRole("button", { name: "Shu amal bo'yicha filtrlash" }));
  assert.ok(!within(d2).queryByRole("button", { name: "Shu admin bo'yicha filtrlash" }));
});

test("rows are plain text: clicking the action or admin opens the drawer instead of filtering", async () => {
  stubFetch(auditApi());
  const { calls: nav, container } = renderAt("");
  await waitFor(() => assert.ok(rowOf(container, "9")));
  assert.ok(!within(rowOf(container, "9")).queryByRole("button"), "no buttons inside a row");
  fireEvent.click(within(rowOf(container, "9")).getByText("users.block"));
  assert.equal(nav.push.at(-1), "/admin/audit?id=9");
});

test("drawer: a row without snapshots says so; a missing row shows the server message", async () => {
  stubFetch(auditApi({ entry: (id) => json(200, { entry: { ...ENTRY, id, before: null, after: null, meta: null } }) }));
  renderAt("id=3");
  const dialog = await screen.findByRole("dialog", { name: "Audit yozuvi" });
  await within(dialog).findByText("Bu yozuvda oldingi va keyingi holat saqlanmagan.");
  assert.ok(!dialog.querySelector("tr[data-diff]"));
  assert.ok(!within(dialog).queryByText("Qo'shimcha (meta)"));
  cleanup();

  stubFetch(auditApi({ entry: () => json(404, { error: "Audit yozuvi topilmadi", code: "not_found" }) }));
  renderAt("id=999");
  const d2 = await screen.findByRole("dialog", { name: "Audit yozuvi" });
  await within(d2).findByText("Audit yozuvi topilmadi");
});

test("diffSnapshots: key union, types stay visible, non-object snapshots compare as one value", () => {
  assert.deepEqual(diffSnapshots({ a: 1, b: "x" }, { a: 2, c: true }), [
    { key: "a", before: "1", after: "2", kind: "changed" },
    { key: "b", before: '"x"', after: null, kind: "removed" },
    { key: "c", before: null, after: "true", kind: "added" },
  ]);
  assert.deepEqual(diffSnapshots({ a: "1" }, { a: 1 }), [{ key: "a", before: '"1"', after: "1", kind: "changed" }], "string vs number differs");
  assert.deepEqual(diffSnapshots(null, { role: "owner" }), [{ key: "role", before: null, after: '"owner"', kind: "added" }]);
  assert.deepEqual(diffSnapshots(null, null), []);
  assert.deepEqual(diffSnapshots(5, 6), [{ key: "(qiymat)", before: "5", after: "6", kind: "changed" }]);
  assert.deepEqual(diffSnapshots({ n: { x: 1 } }, { n: { x: 1 } }), [{ key: "n", before: '{"x":1}', after: '{"x":1}', kind: "same" }]);
});

/* ───────────────────────────── export ───────────────────────────── */

/**
 * Exports go through `adminDownload` (fetch → blob → object URL); jsdom has no
 * `URL.createObjectURL`, so it is stubbed and the saved file names are recorded.
 */
function captureDownloads(): string[] {
  const saved: string[] = [];
  URL.createObjectURL = () => "blob:fake";
  URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    saved.push(this.download);
  };
  return saved;
}

const csv = (name: string) =>
  new Response('\uFEFF"ID"\r\n', { status: 200, headers: { "content-type": "text/csv", "content-disposition": `attachment; filename="${name}"` } });
const reauth = () => json(401, { error: "Bu amal uchun kodni qayta kiriting", code: "reauth" });

test("export: owner with a fresh step-up downloads the CSV with the current filters", async () => {
  const saved = captureDownloads();
  const api = auditApi();
  const calls = stubFetch((c) => (c.url.pathname === "/api/admin/audit/export" ? csv("audit-2026-10-02.csv") : api(c)));
  const { container } = renderAt("outcome=denied&action=auth.&targetType=admin");
  await waitFor(() => assert.ok(rowOf(container, "9")));
  fireEvent.click(screen.getByRole("button", { name: "CSV yuklab olish" }));
  await waitFor(() => assert.equal(saved.length, 1));
  assert.equal(saved[0], "audit-2026-10-02.csv", "saved under the server's name");
  const exports = calls.filter((c) => c.url.pathname === "/api/admin/audit/export");
  assert.equal(exports.length, 1);
  const u = exports[0]!.url;
  assert.equal(u.searchParams.get("outcome"), "denied");
  assert.equal(u.searchParams.get("action"), "auth.");
  assert.equal(u.searchParams.get("targetType"), "admin");
  assert.equal(u.searchParams.get("cursor"), null, "paging state is not part of the export");
  await waitFor(() => assert.ok(useToastStore.getState().toasts.some((t) => /Eksport boshlandi/.test(t.message))));
});

test("export: a stale step-up (401 reauth) opens the dialog; cancelling downloads nothing, confirming retries once", async () => {
  const saved = captureDownloads();
  let asked = 0;
  core.setStepUpHandler(async () => {
    asked += 1;
    return asked > 1;
  });
  const api = auditApi();
  let exportsSeen = 0;
  const calls = stubFetch((c) => {
    if (c.url.pathname !== "/api/admin/audit/export") return api(c);
    exportsSeen += 1;
    return exportsSeen <= 2 ? reauth() : csv("audit-2026-10-02.csv");
  });
  const { container } = renderAt("");
  await waitFor(() => assert.ok(rowOf(container, "9")));
  fireEvent.click(screen.getByRole("button", { name: "CSV yuklab olish" }));
  await waitFor(() => assert.equal(asked, 1));
  await waitFor(() => assert.equal((screen.getByRole("button", { name: "CSV yuklab olish" }) as HTMLButtonElement).disabled, false));
  assert.equal(saved.length, 0, "cancelled step-up: no download");
  fireEvent.click(screen.getByRole("button", { name: "CSV yuklab olish" }));
  await waitFor(() => assert.equal(saved.length, 1));
  assert.equal(asked, 2);
  const exports = calls.filter((c) => c.url.pathname === "/api/admin/audit/export");
  assert.equal(exports.length, 3, "one export request per click plus exactly one retry");
  assert.equal(exports[2]!.url.search, "");
});

test("export button is hidden for a role without audit.export (admin)", async () => {
  stubFetch(auditApi());
  const { container } = renderAt("", ADMIN, "admin");
  await waitFor(() => assert.ok(rowOf(container, "9")));
  assert.ok(!screen.queryByRole("button", { name: "CSV yuklab olish" }));
});
