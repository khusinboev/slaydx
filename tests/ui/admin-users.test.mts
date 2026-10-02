import "./setup.ts";
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createElement as h, useState, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext, SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import type * as CoreModule from "../../lib/admin-api/core.ts";
import type * as ToasterModule from "../../components/admin/ui/Toaster.tsx";
import type * as IdentityModule from "../../components/admin/shell/admin-identity.tsx";
import { UsersPage, userParamsFrom } from "../../components/admin/users/UsersPage.tsx";
import { UserDetail } from "../../components/admin/users/UserDetail.tsx";
import { deviceLabel } from "../../components/admin/users/labels.ts";

/*
 * Users screens (docs/admin/02-plan.md §7.0, §7.1 S4/S5): the four states of
 * the list and the user page (loading, empty with "Filtrlarni tozalash",
 * error with requestId + retry, 403), filters in the URL (junk dropped,
 * stale request aborted, cursor reset), keyset paging, the step-up export,
 * actions shown by permission, and one flow per mutation (reveal, block with
 * side effects, unblock, revoke sessions, message) plus the tabs.
 */
const req = createRequire(import.meta.url);
const core = req("../../lib/admin-api/core.ts") as typeof CoreModule;
const { useToastStore } = req("../../components/admin/ui/Toaster.tsx") as typeof ToasterModule;
const { AdminIdentityProvider } = req("../../components/admin/shell/admin-identity.tsx") as typeof IdentityModule;

const realFetch = globalThis.fetch;
beforeEach(() => core.setStepUpHandler(null));
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  useToastStore.getState().clear();
  core.setStepUpHandler(null);
});

const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

type Call = { url: string; path: string; params: URLSearchParams; method: string; init: RequestInit; body: Record<string, unknown> };
type Handler = (c: Call) => Response | Promise<Response>;

/** Routes by `METHOD /path`; an array answers the n-th call with the n-th handler (last one repeats). Honours the abort signal. */
function stubFetch(routes: Record<string, Handler | Handler[]>): Call[] {
  const calls: Call[] = [];
  const seen = new Map<string, number>();
  globalThis.fetch = ((input: string, init: RequestInit = {}) => {
    const url = String(input);
    const [path, qs = ""] = url.split("?");
    const method = (init.method ?? "GET").toUpperCase();
    const call: Call = { url, path: path!, params: new URLSearchParams(qs), method, init, body: typeof init.body === "string" ? JSON.parse(init.body) : {} };
    calls.push(call);
    const key = `${method} ${path}`;
    const route = routes[key];
    assert.ok(route, `kutilmagan so'rov: ${key}`);
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    const fn = Array.isArray(route) ? route[Math.min(n, route.length - 1)]! : route;
    return new Promise<Response>((resolve, reject) => {
      const signal = init.signal;
      const onAbort = () => reject(new DOMException("The operation was aborted.", "AbortError"));
      if (signal?.aborted) return onAbort();
      signal?.addEventListener("abort", onAbort, { once: true });
      Promise.resolve(fn(call)).then(resolve, reject);
    });
  }) as typeof fetch;
  return calls;
}

const never = () => new Promise<Response>(() => {});

function Harness({ initial, log, perms, children }: { initial: string; log: string[]; perms: string[]; children: ReactNode }) {
  const [url, setUrl] = useState(initial);
  const [pathname, search = ""] = url.split("?");
  const router: AppRouterInstance = {
    back() {},
    forward() {},
    refresh() {},
    prefetch() {},
    push: (href: string) => void log.push(`push ${href}`),
    replace: (href: string) => {
      log.push(`replace ${href}`);
      setUrl(href);
    },
  };
  return h(
    AppRouterContext.Provider,
    { value: router },
    h(
      PathnameContext.Provider,
      { value: pathname! },
      h(
        SearchParamsContext.Provider,
        { value: new URLSearchParams(search) },
        h(AdminIdentityProvider, { value: { adminId: "1", role: "support", permissions: perms, name: "Yordam", username: null }, children }),
      ),
    ),
  );
}

const OWNER_PERMS = [
  "users.view",
  "users.pii",
  "users.export",
  "users.block",
  "users.sessions",
  "users.wallet",
  "users.message",
  "jobs.view",
  "payments.view",
  "moderation.view",
  "audit.view",
  "admins.manage",
];
const SUPPORT_PERMS = ["users.view", "users.pii", "users.block", "users.sessions", "users.message", "jobs.view", "payments.view", "moderation.view"];
const VIEWER_PERMS = ["users.view", "jobs.view", "payments.view"];

function mount(node: ReactNode, initial = "/admin/users", perms = OWNER_PERMS) {
  const log: string[] = [];
  const utils = render(h(Harness, { initial, log, perms, children: node }));
  return { ...utils, log };
}

const ROW = {
  id: "42",
  name: "Ali Valiyev",
  username: "ali",
  telegramId: "5123456789",
  phoneMasked: "+998 ** *** ** 67",
  points: 300,
  quota: 40,
  balance: 12_000,
  isBlocked: true,
  isAdmin: true,
  createdAt: "2026-09-01T05:00:00.000Z",
  lastSeenAt: "2026-10-01T07:30:00.000Z",
  generations: 7,
};
const ROW2 = { ...ROW, id: "43", name: "Bek", username: null, isBlocked: false, isAdmin: false, quota: 0, phoneMasked: null };
const page = (items: unknown[], nextCursor: string | null = null, total = items.length) => ({ items, nextCursor, total, totalCapped: false });
const dataRows = (container: HTMLElement) => container.querySelectorAll("tbody tr[data-row-key]");

/* ───────────────────────────── helpers ───────────────────────────── */

test("userParamsFrom: junk in the URL is dropped, never sent", () => {
  const p = userParamsFrom({ q: "  @ali ", blocked: "2", isAdmin: "1", from: "2026-09-30", to: "2026-09-01", sort: "name_asc" });
  assert.deepEqual(p, { q: "@ali", blocked: undefined, isAdmin: true, from: undefined, to: undefined, sort: "created_desc" });
  assert.equal(deviceLabel("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/153.0 Mobile Safari/537.36"), "Chrome · Android");
  assert.equal(deviceLabel(null), "Noma'lum qurilma");
});

/* ───────────────────────────── UsersPage (S4) ───────────────────────────── */

test("UsersPage: skeleton, then rows (links from ids, masked phone, badges); URL filters sent, junk dropped", async () => {
  let release: (r: Response) => void = () => {};
  const calls = stubFetch({ "GET /api/admin/users": () => new Promise<Response>((r) => (release = r)) });
  const { container } = mount(h(UsersPage), "/admin/users?blocked=1&plan=pro&isAdmin=0&sort=balance_desc&q=%40ali");
  assert.ok(container.querySelector("[data-skeleton-row]"));
  await waitFor(() => assert.equal(calls.length, 1));
  const p = calls[0]!.params;
  assert.equal(p.get("blocked"), "1");
  assert.equal(p.get("isAdmin"), "0");
  assert.equal(p.get("plan"), null, "the removed plan filter is never sent");
  assert.equal(p.get("sort"), "balance_desc");
  assert.equal(p.get("q"), "@ali");
  assert.equal(p.get("limit"), "50");
  release(json(200, page([ROW, ROW2], null, 2)));
  await waitFor(() => assert.equal(dataRows(container).length, 2));
  const row = container.querySelector('tr[data-row-key="42"]') as HTMLElement;
  assert.equal(within(row).getByText("Ali Valiyev").closest("a")?.getAttribute("href"), "/admin/users/42");
  assert.ok(within(row).getByText("+998 ** *** ** 67"));
  assert.ok(within(row).getByText("Bloklangan"));
  assert.ok(within(row).getByText("Admin"));
  // Subscriptions are removed: no plan column or filter; legacy quota is a column only while a row holds some.
  assert.ok(!within(row).queryByText("Pro"));
  assert.ok(!screen.queryByLabelText("Tarif"), "no plan filter");
  const head = container.querySelector("thead") as HTMLElement;
  assert.ok(!within(head).queryByText("Tarif"));
  assert.ok(within(head).getByText("Kvota (eski)"), "ROW still holds 40 quota");
  assert.ok(within(row).getByText("40"));
  assert.ok(screen.getByText("2 ta natija"));
  assert.ok(screen.getByRole("button", { name: "CSV yuklab olish" }));
});

test("UsersPage: filter change writes the URL, aborts the stale request and resets the cursor; search too", async () => {
  const calls = stubFetch({ "GET /api/admin/users": [() => never(), () => json(200, page([ROW])), () => json(200, page([ROW]))] });
  const { log } = mount(h(UsersPage));
  await waitFor(() => assert.equal(calls.length, 1));
  fireEvent.change(screen.getByLabelText("Holat"), { target: { value: "1" } });
  await waitFor(() => assert.equal(calls.length, 2));
  assert.equal(calls[0]!.init.signal?.aborted, true);
  assert.deepEqual(log, ["replace /admin/users?blocked=1"]);
  assert.equal(calls[1]!.params.get("blocked"), "1");
  assert.equal(calls[1]!.params.get("cursor"), null);
  const search = screen.getByLabelText("Foydalanuvchi qidirish");
  fireEvent.change(search, { target: { value: "+998901234567" } });
  fireEvent.keyDown(search, { key: "Enter" });
  await waitFor(() => assert.equal(calls.length, 3));
  assert.equal(log.at(-1), "replace /admin/users?blocked=1&q=%2B998901234567");
  assert.equal(calls[2]!.params.get("q"), "+998901234567");
});

test("UsersPage: sortable headers write the whitelisted sort; keyset paging forward and back", async () => {
  const calls = stubFetch({ "GET /api/admin/users": (c) => (c.params.get("cursor") ? json(200, page([ROW2], null, 2)) : json(200, page([ROW], "CUR1", 2))) });
  const { container, log } = mount(h(UsersPage));
  await waitFor(() => assert.equal(dataRows(container).length, 1));
  fireEvent.click(screen.getByRole("button", { name: "Keyingi" }));
  await waitFor(() => assert.ok(container.querySelector('tr[data-row-key="43"]')));
  assert.equal(calls.at(-1)!.params.get("cursor"), "CUR1");
  fireEvent.click(screen.getByRole("button", { name: "Oldingi" }));
  await waitFor(() => assert.ok(container.querySelector('tr[data-row-key="42"]')));
  assert.equal(calls.at(-1)!.params.get("cursor"), null);
  const thead = container.querySelector("thead") as HTMLElement;
  fireEvent.click(within(thead).getByRole("button", { name: /Oxirgi faollik/ }));
  await waitFor(() => assert.equal(log.at(-1), "replace /admin/users?sort=last_seen_desc"));
  fireEvent.click(within(thead).getByRole("button", { name: /Ro'yxatdan/ }));
  await waitFor(() => assert.equal(log.at(-1), "replace /admin/users", "created_desc is the default and leaves the URL"));
});

test("UsersPage: empty without and with filters; clear removes them", async () => {
  stubFetch({ "GET /api/admin/users": () => json(200, page([])) });
  mount(h(UsersPage));
  assert.ok(await screen.findByText("Foydalanuvchilar yo'q"));
  assert.ok(!screen.queryByRole("button", { name: "Filtrlarni tozalash" }));
  cleanup();
  stubFetch({ "GET /api/admin/users": () => json(200, page([])) });
  const { log } = mount(h(UsersPage), "/admin/users?q=zzz&blocked=1");
  assert.ok(await screen.findByText("Hech narsa topilmadi"));
  const clear = screen.getAllByRole("button", { name: "Filtrlarni tozalash" });
  fireEvent.click(clear[clear.length - 1]!);
  await waitFor(() => assert.equal(log.at(-1), "replace /admin/users"));
});

test("UsersPage: error shows requestId and retry works; 403 renders Ruxsat yo'q; no export without users.export", async () => {
  const calls = stubFetch({ "GET /api/admin/users": [() => json(500, { error: "Ichki xatolik", requestId: "req-777" }), () => json(200, page([ROW]))] });
  const { container } = mount(h(UsersPage));
  assert.ok(await screen.findByText("req-777"));
  fireEvent.click(screen.getByRole("button", { name: "Qayta urinish" }));
  await waitFor(() => assert.equal(dataRows(container).length, 1));
  assert.equal(calls.length, 2);
  cleanup();
  stubFetch({ "GET /api/admin/users": () => json(403, { error: "Bu amal uchun ruxsatingiz yo'q", code: "forbidden" }) });
  mount(h(UsersPage), "/admin/users", VIEWER_PERMS);
  assert.ok(await screen.findByText("Ruxsat yo'q"));
  assert.ok(!screen.queryByRole("button", { name: "CSV yuklab olish" }));
});

test("UsersPage export: 401 reauth → step-up → retried once with the filters; saved under the server's name", async () => {
  const saved: string[] = [];
  const realCreate = URL.createObjectURL;
  const realRevoke = URL.revokeObjectURL;
  URL.createObjectURL = () => "blob:fake";
  URL.revokeObjectURL = () => {};
  const Anchor = (globalThis as unknown as { window: { HTMLAnchorElement: typeof HTMLAnchorElement } }).window.HTMLAnchorElement;
  const realClick = Anchor.prototype.click;
  Anchor.prototype.click = function (this: HTMLAnchorElement) {
    saved.push(this.download);
  };
  let stepUps = 0;
  core.setStepUpHandler(async () => {
    stepUps += 1;
    return true;
  });
  try {
    const calls = stubFetch({
      "GET /api/admin/users": () => json(200, page([ROW])),
      "GET /api/admin/users/export": [
        () => json(401, { error: "Bu amal uchun kodni qayta kiriting", code: "reauth" }),
        () => new Response("﻿\"ID\"\r\n", { status: 200, headers: { "content-type": "text/csv", "content-disposition": 'attachment; filename="foydalanuvchilar-2026-10-02.csv"' } }),
      ],
    });
    mount(h(UsersPage), "/admin/users?blocked=1&sort=created_asc");
    await waitFor(() => assert.equal(calls.length, 1));
    fireEvent.click(screen.getByRole("button", { name: "CSV yuklab olish" }));
    await waitFor(() => assert.deepEqual(saved, ["foydalanuvchilar-2026-10-02.csv"]));
    assert.equal(stepUps, 1);
    const exports = calls.filter((c) => c.path === "/api/admin/users/export");
    assert.equal(exports.length, 2);
    assert.equal(exports[1]!.params.get("blocked"), "1");
    assert.equal(exports[1]!.params.get("plan"), null);
    assert.equal(exports[1]!.params.get("sort"), "created_asc");
    assert.equal(exports[1]!.params.get("limit"), null);
  } finally {
    URL.createObjectURL = realCreate;
    URL.revokeObjectURL = realRevoke;
    Anchor.prototype.click = realClick;
  }
});

/* ───────────────────────────── UserDetail (S5) ───────────────────────────── */

const PROFILE = {
  university: "TATU",
  faculty: "",
  department: "",
  group: "",
  course: "",
  author: "Ali Valiyev",
  subject: "",
  teacher: "",
  city: "Toshkent",
  position: "",
  organization: "",
};
const USER = {
  id: "42",
  name: "Ali Valiyev",
  username: "ali",
  telegramId: "5123456789",
  points: 300,
  quota: 0,
  balance: 12_000,
  isBlocked: false,
  isAdmin: false,
  createdAt: "2026-09-01T05:00:00.000Z",
  lastSeenAt: "2026-10-01T07:30:00.000Z",
  phone: "+998 ** *** ** 67",
  localId: null,
  profile: PROFILE,
  language: "uz",
  updatedAt: "2026-09-02T05:00:00.000Z",
  revealed: false,
};
const DETAIL = {
  user: USER,
  stats: { generations: 7, completed: 5, failed: 1, spentTanga: 14_000, paidSoum: 50_000, storageBytes: 2_097_152 },
  flags: { isAdminAccount: false, adminRole: null, adminStatus: null, self: false },
  counts: { activeSessions: 2, queuedJobs: 1, activeGameLinks: 3 },
  walletConfirmThreshold: 1_000_000,
};
const REVEALED = { ...DETAIL, user: { ...USER, phone: "+998901234567", revealed: true, profile: PROFILE } };

const detailUrl = "/api/admin/users/42";

test("UserDetail: loading skeleton, then header, wallets, profile (masked) and stats; actions by permission", async () => {
  let release: (r: Response) => void = () => {};
  stubFetch({ [`GET ${detailUrl}`]: () => new Promise<Response>((r) => (release = r)) });
  const { container } = mount(h(UserDetail, { id: "42", tools: [] }), "/admin/users/42");
  assert.ok(container.querySelector('[aria-busy="true"]'));
  release(json(200, DETAIL));
  assert.ok(await screen.findByRole("heading", { name: /Ali Valiyev/ }));
  assert.ok(screen.getByText("+998 ** *** ** 67"));
  assert.ok(screen.getByText("TATU"), "profile fields shown (§6.0)");
  assert.ok(screen.getByText("Telefon yashirilgan"));
  // Wallet tiles carry their unit (UX #6): wallets are tanga, real money is so'm.
  assert.ok(screen.getByText(/^12\s000\stanga$/), "balance wallet tile");
  assert.ok(screen.getByText(/^300\stanga$/), "points wallet tile");
  // Quota is 0 after the merge: no legacy quota tile, no plan badge or "Tarif" row.
  assert.ok(!screen.queryByText(/Kvota/), "MUTATSIYA: a zero legacy quota tile is hidden");
  assert.ok(!screen.queryByText("Tarif"));
  assert.ok(!screen.queryByText("Pro"));
  const actions = screen.getByRole("group", { name: "Amallar" });
  for (const name of ["Hamyonni tuzatish", "Bloklash", "Sessiyalarni bekor qilish", "Xabar yuborish", "Telefonni ko'rsatish"]) {
    assert.ok(within(actions).getByRole("button", { name }), name);
  }
  const tabs = screen.getByRole("tablist", { name: "Foydalanuvchi bo'limlari" });
  assert.deepEqual(
    within(tabs)
      .getAllByRole("tab")
      .map((t) => t.textContent?.replace(/\d+$/, "")),
    ["Umumiy", "Generatsiyalar", "To'lovlar", "Hisob", "Sessiyalar", "O'yin havolalari", "Audit"],
  );
});

test("UserDetail: viewer sees no actions and no reveal; own account hides wallet/block/sessions; admin target needs admins.manage", async () => {
  stubFetch({ [`GET ${detailUrl}`]: () => json(200, DETAIL) });
  mount(h(UserDetail, { id: "42", tools: [] }), "/admin/users/42", VIEWER_PERMS);
  await screen.findByRole("heading", { name: /Ali Valiyev/ });
  assert.ok(!screen.queryByRole("group", { name: "Amallar" }));
  assert.ok(!screen.queryByRole("button", { name: "Ko'rsatish" }));
  assert.ok(screen.getByText("+998 ** *** ** 67"), "viewer: phone masked");
  assert.ok(screen.getByText("TATU"), "MUTATSIYA: viewer sees profile fields (§6.0)");
  const tabs = within(screen.getByRole("tablist")).getAllByRole("tab").map((t) => t.textContent?.replace(/\d+$/, ""));
  assert.deepEqual(tabs, ["Umumiy", "Generatsiyalar", "To'lovlar", "Hisob"]);
  cleanup();

  stubFetch({ [`GET ${detailUrl}`]: () => json(200, { ...DETAIL, flags: { ...DETAIL.flags, self: true } }) });
  mount(h(UserDetail, { id: "42", tools: [] }), "/admin/users/42", OWNER_PERMS);
  await screen.findByRole("heading", { name: /Ali Valiyev/ });
  for (const name of ["Hamyonni tuzatish", "Bloklash", "Sessiyalarni bekor qilish"]) assert.ok(!screen.queryByRole("button", { name }), name);
  cleanup();

  stubFetch({ [`GET ${detailUrl}`]: () => json(200, { ...DETAIL, flags: { ...DETAIL.flags, isAdminAccount: true, adminRole: "finance", adminStatus: "active" } }) });
  mount(h(UserDetail, { id: "42", tools: [] }), "/admin/users/42", SUPPORT_PERMS);
  await screen.findByRole("heading", { name: /Ali Valiyev/ });
  assert.ok(screen.getByText(/Admin · /));
  assert.ok(!screen.queryByRole("button", { name: "Bloklash" }), "support cannot block an admin's user");
  assert.ok(!screen.queryByRole("button", { name: "Hamyonni tuzatish" }), "support has no users.wallet");
  assert.ok(screen.getByRole("button", { name: "Xabar yuborish" }));
});

test("UserDetail: reveal asks for reveal=1 and shows the clear phone and profile", async () => {
  const calls = stubFetch({ [`GET ${detailUrl}`]: (c) => json(200, c.params.get("reveal") === "1" ? REVEALED : DETAIL) });
  mount(h(UserDetail, { id: "42", tools: [] }), "/admin/users/42", SUPPORT_PERMS);
  await screen.findByRole("heading", { name: /Ali Valiyev/ });
  fireEvent.click(screen.getByRole("button", { name: "Telefonni ko'rsatish" }));
  assert.ok(await screen.findByText("+998901234567"));
  assert.ok(screen.getByText("TATU"));
  assert.ok(screen.getByText("Telefon ochildi — audit jurnaliga yozildi"));
  assert.ok(!screen.queryByRole("button", { name: "Telefonni ko'rsatish" }));
  assert.equal(calls.filter((c) => c.params.get("reveal") === "1").length, 1);
});

test("UserDetail: block with side effects → POST body, toast, refetch; unblock sends only the flag", async () => {
  const blockedDetail = { ...DETAIL, user: { ...USER, isBlocked: true } };
  const calls = stubFetch({
    [`GET ${detailUrl}`]: [() => json(200, DETAIL), () => json(200, blockedDetail)],
    [`POST ${detailUrl}/block`]: (c) =>
      json(200, { user: { ...USER, isBlocked: c.body.blocked }, sideEffects: { sessionsRevoked: 2, jobsCancelled: 1, refunds: 1, linksRevoked: 0 } }),
  });
  mount(h(UserDetail, { id: "42", tools: [] }), "/admin/users/42", SUPPORT_PERMS);
  await screen.findByRole("heading", { name: /Ali Valiyev/ });
  fireEvent.click(screen.getByRole("button", { name: "Bloklash" }));
  const dialog = await screen.findByRole("dialog");
  assert.ok(within(dialog).getByText("Foydalanuvchini bloklash"));
  assert.ok(within(dialog).getByText(/1 ta\)/), "queued count shown");
  fireEvent.click(within(dialog).getByLabelText(/Navbatdagi ishlarni bekor qilish/));
  const confirm = within(dialog).getByRole("button", { name: "Bloklash" }) as HTMLButtonElement;
  assert.equal(confirm.disabled, true, "reason required");
  fireEvent.change(within(dialog).getByLabelText("Sabab"), { target: { value: "Spam tarqatgani uchun" } });
  fireEvent.click(confirm);
  await waitFor(() => assert.ok(calls.some((c) => c.method === "POST")));
  const post = calls.find((c) => c.method === "POST")!;
  assert.deepEqual(post.body, { blocked: true, reason: "Spam tarqatgani uchun", revokeSessions: true, cancelQueued: true, revokeLinks: false });
  assert.equal((post.init.headers as Record<string, string> | undefined)?.["Idempotency-Key"], undefined);
  await waitFor(() => assert.ok(useToastStore.getState().toasts.some((t) => t.message.includes("2 ta sessiya bekor qilindi"))));
  await waitFor(() => assert.ok(screen.getByRole("button", { name: "Blokdan chiqarish" }), "refetched as blocked"));
  assert.equal(calls.filter((c) => c.method === "GET").length, 2);

  fireEvent.click(screen.getByRole("button", { name: "Blokdan chiqarish" }));
  const un = await screen.findByRole("dialog");
  assert.ok(!within(un).queryByLabelText(/Navbatdagi ishlarni/), "no side effects on unblock");
  fireEvent.change(within(un).getByLabelText("Sabab"), { target: { value: "Xato bloklangan edi" } });
  fireEvent.click(within(un).getByRole("button", { name: "Blokdan chiqarish" }));
  await waitFor(() => assert.equal(calls.filter((c) => c.method === "POST").length, 2));
  assert.deepEqual(calls.filter((c) => c.method === "POST")[1]!.body, { blocked: false, reason: "Xato bloklangan edi" });
});

test("UserDetail: a refused block shows the server's error inline and keeps the dialog open", async () => {
  stubFetch({
    [`GET ${detailUrl}`]: () => json(200, DETAIL),
    [`POST ${detailUrl}/block`]: () => json(403, { error: "Admin hisobiga ega foydalanuvchi ustida bu amal uchun ruxsatingiz yo'q", code: "admin_target" }),
  });
  mount(h(UserDetail, { id: "42", tools: [] }), "/admin/users/42", SUPPORT_PERMS);
  await screen.findByRole("heading", { name: /Ali Valiyev/ });
  fireEvent.click(screen.getByRole("button", { name: "Bloklash" }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText("Sabab"), { target: { value: "Spam tarqatgani uchun" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Bloklash" }));
  assert.ok(await within(dialog).findByText(/ruxsatingiz yo'q/));
  assert.ok(screen.getByRole("dialog"));
});

test("UserDetail: revoke sessions → POST {reason}, toast; message → POST {text}, sent:false is an error toast", async () => {
  const calls = stubFetch({
    [`GET ${detailUrl}`]: () => json(200, DETAIL),
    [`POST ${detailUrl}/sessions/revoke`]: () => json(200, { revoked: 2 }),
    [`POST ${detailUrl}/message`]: [() => json(200, { sent: true }), () => json(200, { sent: false })],
  });
  mount(h(UserDetail, { id: "42", tools: [] }), "/admin/users/42", SUPPORT_PERMS);
  await screen.findByRole("heading", { name: /Ali Valiyev/ });
  fireEvent.click(screen.getByRole("button", { name: "Sessiyalarni bekor qilish" }));
  let dialog = await screen.findByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText("Sabab"), { target: { value: "Akkaunt o'g'irlangan" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Bekor qilish" }));
  await waitFor(() => assert.ok(useToastStore.getState().toasts.some((t) => t.message === "2 ta sessiya bekor qilindi")));
  assert.deepEqual(calls.find((c) => c.path.endsWith("/sessions/revoke"))!.body, { reason: "Akkaunt o'g'irlangan" });

  for (const [n, expectTone] of [
    [1, "success"],
    [2, "error"],
  ] as const) {
    await waitFor(() => assert.ok(!screen.queryByRole("dialog")));
    fireEvent.click(screen.getByRole("button", { name: "Xabar yuborish" }));
    dialog = await screen.findByRole("dialog");
    const send = within(dialog).getByRole("button", { name: "Yuborish" }) as HTMLButtonElement;
    assert.equal(send.disabled, true, "empty text cannot be sent");
    fireEvent.change(within(dialog).getByLabelText("Xabar"), { target: { value: "  Salom <b>do'st</b>  " } });
    fireEvent.click(send);
    await waitFor(() => assert.equal(calls.filter((c) => c.path.endsWith("/message")).length, n));
    assert.deepEqual(calls.filter((c) => c.path.endsWith("/message"))[n - 1]!.body, { text: "Salom <b>do'st</b>" });
    await waitFor(() => assert.ok(useToastStore.getState().toasts.some((t) => t.tone === expectTone && /Xabar/.test(t.message))));
  }
});

test("UserDetail: wallet button opens F6's dialog with the user's wallets", async () => {
  stubFetch({ [`GET ${detailUrl}`]: () => json(200, DETAIL) });
  mount(h(UserDetail, { id: "42", tools: [] }), "/admin/users/42", OWNER_PERMS);
  await screen.findByRole("heading", { name: /Ali Valiyev/ });
  fireEvent.click(screen.getByRole("button", { name: "Hamyonni tuzatish" }));
  const dialog = await screen.findByRole("dialog");
  assert.ok(within(dialog).getByText("Hamyonni tuzatish"));
  assert.ok(within(dialog).getByText(/Ali Valiyev/));
});

test("UserDetail: 404 and an invalid id show 'topilmadi' (no request for a bad id); error with requestId + retry; 403", async () => {
  let calls = stubFetch({ [`GET ${detailUrl}`]: () => json(404, { error: "Topilmadi", code: "not_found" }) });
  mount(h(UserDetail, { id: "42", tools: [] }), "/admin/users/42");
  assert.ok(await screen.findByText("Foydalanuvchi topilmadi"));
  cleanup();
  calls = stubFetch({});
  mount(h(UserDetail, { id: "abc", tools: [] }), "/admin/users/abc");
  assert.ok(screen.getByText("Foydalanuvchi topilmadi"));
  assert.equal(calls.length, 0);
  cleanup();
  calls = stubFetch({ [`GET ${detailUrl}`]: [() => json(500, { error: "Ichki xatolik", requestId: "req-42" }), () => json(200, DETAIL)] });
  mount(h(UserDetail, { id: "42", tools: [] }), "/admin/users/42");
  assert.ok(await screen.findByText("req-42"));
  fireEvent.click(screen.getByRole("button", { name: "Qayta urinish" }));
  assert.ok(await screen.findByRole("heading", { name: /Ali Valiyev/ }));
  cleanup();
  stubFetch({ [`GET ${detailUrl}`]: () => json(403, { error: "Ruxsat yo'q", code: "forbidden" }) });
  mount(h(UserDetail, { id: "42", tools: [] }), "/admin/users/42");
  assert.ok(await screen.findByText("Ruxsat yo'q"));
});

test("UserDetail tabs: tab in the URL; Hisob uses the user's ledger endpoint with kind filter and id-built links; Sessiyalar; link tabs", async () => {
  const GEN = "2b0d6a3e-9c1f-4e8a-b2d7-5f3c1a9e7d40";
  const calls = stubFetch({
    [`GET ${detailUrl}`]: () => json(200, DETAIL),
    [`GET ${detailUrl}/transactions`]: () =>
      json(200, page([{ id: "9", kind: "charge", points: 0, quota: 0, balance: -2_000, reference: GEN, note: "slide: Mavzu", createdAt: "2026-09-20T06:00:00.000Z", generationId: GEN, orderId: null }])),
    "GET /api/admin/audit": () =>
      json(200, {
        items: [
          { id: "71", at: "2026-10-01T06:00:00.000Z", adminId: "3", adminName: "Dilnoza Owner", adminUsername: null, actorRole: "owner", action: "users.block", targetType: "user", targetId: "42", outcome: "ok", reason: "Spam xabarlar", ip: "10.0.0.1" },
          { id: "70", at: "2026-09-30T06:00:00.000Z", adminId: "5", adminName: "Jasur", adminUsername: null, actorRole: "support", action: "users.wallet.adjust", targetType: "user", targetId: "42", outcome: "denied", reason: null, ip: null },
        ],
        nextCursor: "c1",
        total: 14,
        totalCapped: false,
      }),
    [`GET ${detailUrl}/sessions`]: () =>
      json(200, {
        items: [
          { id: "1", createdAt: "2026-09-20T06:00:00.000Z", lastSeenAt: "2026-10-01T06:00:00.000Z", expiresAt: "2026-10-20T06:00:00.000Z", revokedAt: null, userAgent: "Mozilla/5.0 (Linux; Android 14) Chrome/153.0", active: true },
          { id: "2", createdAt: "2026-09-10T06:00:00.000Z", lastSeenAt: "2026-09-11T06:00:00.000Z", expiresAt: "2026-10-10T06:00:00.000Z", revokedAt: "2026-09-12T06:00:00.000Z", userAgent: null, active: false },
        ],
      }),
  });
  const { log, container } = mount(h(UserDetail, { id: "42", tools: [] }), "/admin/users/42", OWNER_PERMS);
  await screen.findByRole("heading", { name: /Ali Valiyev/ });
  fireEvent.click(screen.getByRole("tab", { name: /Hisob/ }));
  await waitFor(() => assert.equal(log.at(-1), "replace /admin/users/42?tab=ledger"));
  await waitFor(() => assert.ok(container.querySelector('tr[data-row-key="9"]')));
  const row = container.querySelector('tr[data-row-key="9"]') as HTMLElement;
  assert.equal(within(row).getByText(GEN).closest("a")?.getAttribute("href"), `/admin/generations/${GEN}`);
  assert.ok(within(row).getByText(/^[−-]2\s000$/));
  const ledgerHead = container.querySelector('[role="tabpanel"] thead') as HTMLElement;
  assert.ok(!within(ledgerHead).queryByText(/Kvota/), "MUTATSIYA: no legacy quota column when no row moved quota");
  // The kind multi-select (its button is named by the current value).
  fireEvent.click(container.querySelector('[role="tabpanel"] button[aria-haspopup="true"]') as HTMLElement);
  fireEvent.click(screen.getByRole("checkbox", { name: "To'ldirish" }));
  await waitFor(() => assert.equal(calls.filter((c) => c.path.endsWith("/transactions")).at(-1)!.params.get("kind"), "topup"));
  assert.ok(!log.some((l) => l.includes("kind=")), "the ledger filter never touches the URL");

  fireEvent.click(screen.getByRole("tab", { name: /Sessiyalar/ }));
  await waitFor(() => assert.ok(container.querySelector('tr[data-row-key="2"]')));
  assert.ok(within(container.querySelector('tr[data-row-key="1"]') as HTMLElement).getByText("Chrome · Android"));
  assert.ok(within(container.querySelector('tr[data-row-key="2"]') as HTMLElement).getByText("Bekor qilingan"));
  fireEvent.click(screen.getByRole("tab", { name: /O'yin havolalari/ }));
  assert.equal(screen.getByRole("link", { name: "Moderatsiyada ochish" }).getAttribute("href"), "/admin/moderation?userId=42");
  fireEvent.click(screen.getByRole("tab", { name: "Audit" }));
  assert.equal(screen.getByRole("link", { name: "Audit jurnalida ochish" }).getAttribute("href"), "/admin/audit?targetType=user&targetId=42");
  // Plan S5: the tab itself lists the audit rows targeting this user (UX #13a).
  await waitFor(() => assert.ok(container.querySelector('tr[data-row-key="71"]')));
  const auditCall = calls.filter((c) => c.path === "/api/admin/audit").at(-1)!;
  assert.equal(auditCall.params.get("targetType"), "user");
  assert.equal(auditCall.params.get("targetId"), "42");
  assert.equal(auditCall.params.get("limit"), "10");
  const r71 = container.querySelector('tr[data-row-key="71"]') as HTMLElement;
  assert.match(r71.textContent ?? "", /users\.block/);
  assert.match(r71.textContent ?? "", /Bajarildi/);
  assert.match(r71.textContent ?? "", /Spam xabarlar/);
  assert.match(container.querySelector('tr[data-row-key="70"]')!.textContent ?? "", /Rad etildi/);
  assert.match(container.textContent ?? "", /jami 14 ta/);
  fireEvent.click(r71);
  assert.equal(log.at(-1), "push /admin/audit?targetType=user&targetId=42&id=71");
});

test("UserDetail: without audit.view there is no Audit tab and no audit request", async () => {
  const calls = stubFetch({ [`GET ${detailUrl}`]: () => json(200, DETAIL) });
  mount(h(UserDetail, { id: "42", tools: [] }), "/admin/users/42?tab=audit", SUPPORT_PERMS);
  await screen.findByRole("heading", { name: /Ali Valiyev/ });
  assert.ok(!screen.queryByRole("tab", { name: "Audit" }));
  assert.ok(!calls.some((c) => c.path === "/api/admin/audit"));
});

/* ───────────────────────────── subscription removal ───────────────────────────── */

test("UsersPage: the legacy quota column is hidden when every row on the page has 0", async () => {
  stubFetch({ "GET /api/admin/users": () => json(200, page([ROW2, { ...ROW2, id: "44", name: "Vali" }])) });
  const { container } = mount(h(UsersPage));
  await waitFor(() => assert.equal(dataRows(container).length, 2));
  const head = container.querySelector("thead") as HTMLElement;
  assert.ok(within(head).getByText("Balans"));
  assert.ok(!within(head).queryByText(/Kvota/), "MUTATSIYA: no all-zero quota column");
});

test("UserDetail: a non-zero legacy quota shows as a «Kvota (eski)» tile", async () => {
  stubFetch({ [`GET ${detailUrl}`]: () => json(200, { ...DETAIL, user: { ...USER, quota: 2_500 } }) });
  mount(h(UserDetail, { id: "42", tools: [] }), "/admin/users/42");
  await screen.findByRole("heading", { name: /Ali Valiyev/ });
  assert.ok(screen.getByText(/Kvota \(eski\)/));
  assert.ok(screen.getByText(/^2\s500\stanga$/));
});

test("UserDetail Hisob: a quota_merge row renders with its label and both legs; the kind filter offers it", async () => {
  const calls = stubFetch({
    [`GET ${detailUrl}`]: () => json(200, DETAIL),
    [`GET ${detailUrl}/transactions`]: () =>
      json(
        200,
        page([
          { id: "31", kind: "quota_merge", points: 0, quota: -12_000, balance: 12_000, reference: "quota-merge:42", note: "Kvota balansga o'tkazildi: 12000 tanga", createdAt: "2026-10-02T06:00:00.000Z", generationId: null, orderId: null },
          { id: "30", kind: "subscription", points: 0, quota: 15_000, balance: 0, reference: "click:991", note: "Pro obuna", createdAt: "2026-09-02T06:00:00.000Z", generationId: null, orderId: "7a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d" },
        ]),
      ),
  });
  const { container } = mount(h(UserDetail, { id: "42", tools: [] }), "/admin/users/42?tab=ledger", OWNER_PERMS);
  await waitFor(() => assert.ok(container.querySelector('tr[data-row-key="31"]')));
  const merge = container.querySelector('tr[data-row-key="31"]') as HTMLElement;
  assert.ok(within(merge).getByText("Kvota → balans"), "MUTATSIYA: KIND_LABEL.quota_merge");
  assert.ok(within(merge).getByText(/^[−-]12\s000$/));
  assert.ok(within(merge).getByText(/^\+12\s000$/));
  const sub = container.querySelector('tr[data-row-key="30"]') as HTMLElement;
  assert.ok(within(sub).getByText("Pro obuna (eski)"));
  const panel = container.querySelector('[role="tabpanel"]') as HTMLElement;
  assert.ok(within(panel.querySelector("thead") as HTMLElement).getByText("Kvota (eski)"), "rows moved quota → the column shows");
  fireEvent.click(panel.querySelector('button[aria-haspopup="true"]') as HTMLElement);
  fireEvent.click(screen.getByRole("checkbox", { name: "Kvota → balans" }));
  await waitFor(() => assert.equal(calls.filter((c) => c.path.endsWith("/transactions")).at(-1)!.params.get("kind"), "quota_merge"));
});
