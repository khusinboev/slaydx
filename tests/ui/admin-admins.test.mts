import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { AdminAccountItem } from "../../lib/admin-api/admins.ts";
import * as core from "../../lib/admin-api/core.ts";
import { AdminsPage } from "../../components/admin/admins/AdminsPage.tsx";
import { AdminIdentityProvider } from "../../components/admin/shell/admin-identity.tsx";
import { useToastStore } from "../../components/admin/ui/Toaster.tsx";
import { ROLE_ORDER, WHY, assignableRoles, canManageRole, rowRules } from "../../components/admin/admins/shared.ts";

/**
 * S18 `/admin/admins` (docs/admin/02-plan.md §6.13, §7.1, §4.3 invariants) on the F2 API:
 *   - the four states and the list columns;
 *   - management controls only with `admins.manage`;
 *   - the rank rules are MIRRORED in the UI (self, equal / higher rank, last active owner,
 *     role pickers limited to roles below the actor, an owner may add owners) while the
 *     server's 403 / 409 messages are still shown as they come;
 *   - add admin / change role / disable / enable / reset 2FA / revoke sessions, each through a
 *     confirm dialog with a reason, a toast and a refreshed list;
 *   - the one-time enrollment URL is shown with copy + expiry and is gone once closed.
 */

const realFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  useToastStore.getState().clear();
  core.setStepUpHandler(null);
  globalThis.fetch = realFetch;
});

const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

type Call = { url: URL; method: string; body: Record<string, unknown> | undefined };
const toasts = () => useToastStore.getState().toasts.map((t) => t.message);

function acct(over: Partial<AdminAccountItem> & { id: string }): AdminAccountItem {
  return {
    userId: `${Number(over.id) * 10}`,
    name: `Admin ${over.id}`,
    username: `adm${over.id}`,
    role: "support",
    status: "active",
    totpEnabled: true,
    lastLoginAt: "2026-03-09T08:00:00.000Z",
    createdAt: "2026-03-01T00:00:00.000Z",
    activeSessions: 1,
    ...over,
  };
}

const OWNER_ME = acct({ id: "1", name: "Egasi Men", username: "owner_me", role: "owner", activeSessions: 2 });
const OWNER_2 = acct({ id: "4", name: "Ikkinchi Ega", username: "owner_two", role: "owner" });
const ADMIN_A = acct({ id: "2", name: "Admin Aziz", username: "aziz", role: "admin" });
const SUPPORT = acct({ id: "3", name: "Qo'llab Sardor", username: "sardor", role: "support", activeSessions: 3 });
const PENDING = acct({ id: "5", name: "Kutayotgan Mod", username: null, role: "moderator", status: "pending", totpEnabled: false, lastLoginAt: null, activeSessions: 0 });
const DISABLED = acct({ id: "6", name: "O'chgan Kuzatuvchi", username: "viewer6", role: "viewer", status: "disabled", activeSessions: 0 });
const ALL = [OWNER_ME, OWNER_2, ADMIN_A, SUPPORT, PENDING, DISABLED];

/** In-memory API: the list changes with the mutations, like the real one. */
function adminsApi(opts: { items?: AdminAccountItem[]; ownId?: string | null; sessionFails?: boolean; post?: (c: Call) => Response | null } = {}) {
  const items = (opts.items ?? ALL).map((i) => ({ ...i }));
  const calls: Call[] = [];
  globalThis.fetch = (async (input: string, init: RequestInit = {}) => {
    const url = new URL(String(input), "http://localhost");
    const call: Call = { url, method: init.method ?? "GET", body: typeof init.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : undefined };
    calls.push(call);
    const path = url.pathname;
    if (path === "/api/admin/session") {
      if (opts.sessionFails) return json(500, { error: "Ichki xatolik" });
      return json(200, { admin: { id: opts.ownId ?? "1" }, session: null });
    }
    if (call.method !== "GET" && opts.post) {
      const r = opts.post(call);
      if (r) return r;
    }
    if (path === "/api/admin/admins" && call.method === "GET") return json(200, { items });
    if (path === "/api/admin/admins" && call.method === "POST") {
      const b = call.body!;
      const created = acct({ id: "9", name: "Yangi Xodim", username: "yangi", role: b.role as AdminAccountItem["role"], status: "pending", totpEnabled: false, lastLoginAt: null, activeSessions: 0 });
      items.push(created);
      return json(201, { admin: created, enrollUrl: "https://slaydxx.uz/admin/enroll?token=SECRET-TOKEN-ONCE", expiresAt: "2026-03-09T09:30:00.000Z" });
    }
    const m = /^\/api\/admin\/admins\/(\d+)(\/reset-2fa|\/sessions\/revoke)?$/.exec(path);
    if (m) {
      const a = items.find((i) => i.id === m[1])!;
      if (!m[2] && call.method === "PATCH") {
        if (call.body!.role) a.role = call.body!.role as AdminAccountItem["role"];
        if (call.body!.status) a.status = call.body!.status as AdminAccountItem["status"];
        return json(200, { admin: a });
      }
      if (m[2] === "/reset-2fa") return json(200, { enrollUrl: "https://slaydxx.uz/admin/enroll?token=RESET-TOKEN-ONCE", expiresAt: "2026-03-09T09:30:00.000Z" });
      if (m[2] === "/sessions/revoke") return json(200, { revoked: a.activeSessions });
    }
    return json(404, { error: "Topilmadi" });
  }) as typeof fetch;
  return { calls, items };
}

const IDENTITY = (role: string, permissions: string[]) => ({ role, permissions, name: "Test", username: null });
const VIEW = ["admins.view"];
const MANAGE = ["admins.view", "admins.manage"];

function renderPage(role = "owner", permissions: string[] = MANAGE) {
  return render(h(AdminIdentityProvider, { value: IDENTITY(role, permissions), children: h(AdminsPage) }));
}

const rowOf = (container: HTMLElement, id: string) => container.querySelector(`tr[data-row-key="${id}"]`) as HTMLElement;
async function waitRows(container: HTMLElement) {
  await waitFor(() => assert.ok(rowOf(container, "1")));
  // The own id arrives with a second request; the "Siz" badge marks that it did.
  await waitFor(() => assert.match(rowOf(container, "1").textContent ?? "", /Siz/));
}

/** Opens the manage modal of one row. */
async function manage(container: HTMLElement, id: string): Promise<HTMLElement> {
  fireEvent.click(within(rowOf(container, id)).getByRole("button", { name: /boshqarish/ }));
  return screen.findByRole("dialog", { name: "Adminni boshqarish" });
}

/** The modal has an X and a footer "Yopish"; the footer one is the last. */
async function closeManage(dialog: HTMLElement) {
  fireEvent.click(within(dialog).getAllByRole("button", { name: "Yopish" }).at(-1)!);
  await waitFor(() => assert.ok(!screen.queryByRole("dialog", { name: "Adminni boshqarish" })));
}

const actionBtn = (dialog: HTMLElement, name: string) => within(dialog).getByRole("button", { name }) as HTMLButtonElement;

/* ───────────────────────────── states and columns ───────────────────────────── */

test("loading skeleton, then name, @username, role, status, 2FA, last login and active sessions", async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  const real = adminsApi();
  const inner = globalThis.fetch;
  globalThis.fetch = (async (input: string, init?: RequestInit) => {
    if (String(input).startsWith("/api/admin/admins")) await gate;
    return inner(input as never, init);
  }) as typeof fetch;
  const { container } = renderPage();
  assert.ok(container.querySelector("[data-skeleton-row]"), "skeleton rows while loading");
  release();
  await waitRows(container);
  assert.ok(real.calls.some((c) => c.url.pathname === "/api/admin/admins"));

  const me = rowOf(container, "1").textContent ?? "";
  assert.match(me, /Egasi Men/);
  assert.match(me, /@owner_me/);
  assert.match(me, /Egasi/, "role label");
  assert.match(me, /Faol/);
  assert.match(me, /09\.03\.2026 13:00/, "Tashkent time");
  assert.match(me, /2/, "active sessions");
  assert.ok(rowOf(container, "1").querySelector(".sr-only")?.textContent, "2FA state has a text alternative");
  assert.match(rowOf(container, "1").textContent ?? "", /Yoqilgan/);
  const pending = rowOf(container, "5").textContent ?? "";
  assert.match(pending, /Kutilmoqda/);
  assert.match(pending, /Sozlanmagan/);
  assert.match(pending, /—/, "never logged in");
  assert.match(rowOf(container, "6").textContent ?? "", /O'chirilgan/);
  assert.ok(!/Siz/.test(rowOf(container, "2").textContent ?? ""), "only your own row says Siz");
});

test("error shows the message and requestId, retry loads; 403 renders Forbidden; empty explains how to bootstrap", async () => {
  let n = 0;
  const api = adminsApi();
  const inner = globalThis.fetch;
  globalThis.fetch = (async (input: string, init?: RequestInit) => {
    if (String(input) === "/api/admin/admins" && (init?.method ?? "GET") === "GET") {
      n += 1;
      if (n === 1) return json(500, { error: "Ichki xatolik", requestId: "req-adm-4" });
    }
    return inner(input as never, init);
  }) as typeof fetch;
  const { container } = renderPage();
  const alert = await screen.findByRole("alert");
  assert.match(alert.textContent ?? "", /Ichki xatolik/);
  assert.match(alert.textContent ?? "", /req-adm-4/);
  fireEvent.click(within(alert).getByRole("button", { name: "Qayta urinish" }));
  await waitFor(() => assert.ok(rowOf(container, "1")));
  assert.ok(api.calls.length >= 2);
  cleanup();

  globalThis.fetch = (async () => json(403, { error: "Bu amal uchun ruxsatingiz yo'q", code: "forbidden" })) as typeof fetch;
  renderPage("viewer", VIEW);
  await screen.findByText("Ruxsat yo'q");
  cleanup();

  adminsApi({ items: [] });
  renderPage();
  await screen.findByText("Adminlar yo'q");
});

test("without admins.manage there is no add button and no manage controls", async () => {
  adminsApi();
  const { container } = renderPage("admin", VIEW);
  await waitFor(() => assert.ok(rowOf(container, "1")));
  assert.ok(!screen.queryByRole("button", { name: "Admin qo'shish" }));
  assert.ok(!container.textContent?.includes("Boshqarish"));
  assert.ok(!screen.queryByRole("columnheader", { name: "Amallar" }));
});

/* ───────────────────────────── rank mirroring ───────────────────────────── */

test("rank helpers mirror plan §4.1 / §4.3", () => {
  assert.deepEqual([...ROLE_ORDER], ["owner", "admin", "finance", "support", "moderator", "viewer"]);
  assert.ok(canManageRole("owner", "owner"), "an owner may manage owners");
  assert.ok(canManageRole("owner", "admin"));
  assert.ok(!canManageRole("admin", "admin"), "equal rank is refused");
  assert.ok(!canManageRole("admin", "owner"));
  assert.ok(canManageRole("admin", "finance"));
  assert.ok(!canManageRole("support", "viewer"), "support holds no admins.manage");
  assert.ok(!canManageRole("viewer", "viewer"));
  assert.ok(!canManageRole("owner", "bogus"));
  assert.deepEqual(assignableRoles("owner"), ["owner", "admin", "finance", "support", "moderator", "viewer"]);
  assert.deepEqual(assignableRoles("admin"), ["finance", "support", "moderator", "viewer"]);
  assert.deepEqual(assignableRoles("support"), []);
});

test("rowRules: self, rank, last active owner, nothing left to assign", () => {
  const solo = [acct({ id: "1", role: "owner" })];
  // Own row (known): every action refused with the self message.
  const own = rowRules("owner", "1", solo[0], solo);
  assert.deepEqual([own.role, own.status, own.reset2fa, own.revoke], [WHY.self, WHY.self, WHY.self, WHY.self]);
  // The sole active owner while our own id is unknown (session call failed): last-owner guard for role and status.
  const unknown = rowRules("owner", null, solo[0], solo);
  assert.equal(unknown.role, WHY.lastOwner);
  assert.equal(unknown.status, WHY.lastOwner);
  assert.equal(unknown.reset2fa, null);
  // Two active owners: the other one is manageable.
  const two = [acct({ id: "1", role: "owner" }), acct({ id: "4", role: "owner" })];
  assert.deepEqual(rowRules("owner", "1", two[1], two), { isSelf: false, role: null, status: null, reset2fa: null, revoke: null });
  // A disabled / pending owner is not "the last active owner".
  const gone = [acct({ id: "1", role: "owner" }), acct({ id: "4", role: "owner", status: "disabled" })];
  assert.equal(rowRules("owner", "1", gone[1], gone).status, null);
  // Rank: an admin cannot touch owners or equals.
  const mix = [acct({ id: "1", role: "owner" }), acct({ id: "2", role: "admin" }), acct({ id: "3", role: "support" })];
  assert.equal(rowRules("admin", "2", mix[0], mix).role, WHY.rank);
  assert.equal(rowRules("admin", "9", mix[1], mix).status, WHY.rank);
  assert.equal(rowRules("admin", "2", mix[2], mix).role, null);
});

test("as owner: my own row is fully disabled with the reason; every other row, owners included, is manageable", async () => {
  adminsApi();
  const { container } = renderPage("owner");
  await waitRows(container);

  const own = await manage(container, "1");
  for (const name of ["Rolni o'zgartirish", "O'chirish", "2FA ni tiklash", "Sessiyalarni bekor qilish"]) {
    assert.equal(actionBtn(own, name).disabled, true, `${name} disabled for myself`);
  }
  assert.ok(within(own).getAllByText(WHY.self).length >= 1, "the server's wording is shown as the reason");
  await closeManage(own);
  await waitFor(() => assert.ok(!screen.queryByRole("dialog", { name: "Adminni boshqarish" })));

  for (const id of ["2", "3", "4", "5"]) {
    const d = await manage(container, id);
    for (const name of ["Rolni o'zgartirish", "O'chirish", "2FA ni tiklash", "Sessiyalarni bekor qilish"]) {
      assert.equal(actionBtn(d, name).disabled, false, `${name} enabled for row ${id}`);
    }
    await closeManage(d);
  }
  // A disabled account offers "Yoqish" instead of "O'chirish".
  const dis = await manage(container, "6");
  assert.equal(actionBtn(dis, "Yoqish").disabled, false);
  assert.ok(!within(dis).queryByRole("button", { name: "O'chirish" }));
});

test("as admin (own id 2): owners, equal rank and myself are refused with the rank / self reason; lower roles are manageable", async () => {
  adminsApi({ ownId: "2" });
  const { container } = renderPage("admin");
  await waitFor(() => assert.match(rowOf(container, "2")?.textContent ?? "", /Siz/));

  for (const id of ["1", "4"]) {
    const d = await manage(container, id);
    for (const name of ["Rolni o'zgartirish", "O'chirish", "2FA ni tiklash", "Sessiyalarni bekor qilish"]) {
      assert.equal(actionBtn(d, name).disabled, true, `${name} disabled for owner row ${id}`);
    }
    assert.ok(within(d).getAllByText(WHY.rank).length >= 1);
    await closeManage(d);
  }
  const self = await manage(container, "2");
  assert.equal(actionBtn(self, "Rolni o'zgartirish").disabled, true);
  assert.ok(within(self).getAllByText(WHY.self).length >= 1);
  await closeManage(self);

  const ok = await manage(container, "3");
  assert.equal(actionBtn(ok, "Rolni o'zgartirish").disabled, false);
  fireEvent.click(actionBtn(ok, "Rolni o'zgartirish"));
  const dialog = await screen.findByRole("dialog", { name: "Rolni o'zgartirish" });
  // Roles below admin only, minus the current one (support).
  const opts = [...(within(dialog).getByLabelText("Yangi rol") as HTMLSelectElement).options].map((o) => o.value).filter(Boolean);
  assert.deepEqual(opts, ["finance", "moderator", "viewer"]);
});

test("a sole active owner whose identity could not be resolved is guarded against demotion and disabling", async () => {
  adminsApi({ items: [OWNER_ME, SUPPORT], sessionFails: true });
  const { container } = renderPage("owner");
  await waitFor(() => assert.ok(rowOf(container, "1")));
  const d = await manage(container, "1");
  assert.equal(actionBtn(d, "Rolni o'zgartirish").disabled, true);
  assert.equal(actionBtn(d, "O'chirish").disabled, true);
  assert.ok(within(d).getAllByText(WHY.lastOwner).length >= 1);
});

/* ───────────────────────────── add admin ───────────────────────────── */

async function openAdd() {
  fireEvent.click(screen.getByRole("button", { name: "Admin qo'shish" }));
  return screen.findByRole("dialog", { name: "Admin qo'shish" });
}
const confirmBtn = (d: HTMLElement) => within(d).getByRole("button", { name: "Admin qo'shish" }) as HTMLButtonElement;

test("add admin by Telegram ID: confirm needs id + role + reason; the one-time enroll URL is shown with copy and expiry, then gone", async () => {
  const api = adminsApi();
  const { container } = renderPage("owner");
  await waitRows(container);
  const d = await openAdd();
  assert.equal(confirmBtn(d).disabled, true);

  // Owner may pick every role, owner included.
  const roleSel = within(d).getByLabelText("Rol") as HTMLSelectElement;
  assert.deepEqual([...roleSel.options].map((o) => o.value).filter(Boolean), ["owner", "admin", "finance", "support", "moderator", "viewer"]);

  fireEvent.change(within(d).getByLabelText("Telegram ID"), { target: { value: "12abc" } });
  assert.ok(within(d).getByText(/Faqat raqamlar kiriting/));
  fireEvent.change(within(d).getByLabelText("Telegram ID"), { target: { value: "555000111" } });
  fireEvent.change(roleSel, { target: { value: "support" } });
  assert.equal(confirmBtn(d).disabled, true, "reason still missing");
  fireEvent.change(within(d).getByLabelText(/Sabab/), { target: { value: "yangi qo'llab-quvvatlash xodimi" } });
  assert.equal(confirmBtn(d).disabled, false);
  fireEvent.click(within(d).getByLabelText("Havolani Telegram orqali ham yuborish"));
  fireEvent.click(confirmBtn(d));

  const link = await screen.findByRole("dialog", { name: "Admin qo'shildi" });
  const post = api.calls.find((c) => c.method === "POST")!;
  assert.equal(post.url.pathname, "/api/admin/admins");
  assert.deepEqual(post.body, { telegramId: "555000111", role: "support", reason: "yangi qo'llab-quvvatlash xodimi", sendViaTelegram: true });

  const url = within(link).getByLabelText("Ulanish havolasi") as HTMLInputElement;
  assert.equal(url.value, "https://slaydxx.uz/admin/enroll?token=SECRET-TOKEN-ONCE");
  assert.equal(url.readOnly, true);
  assert.ok(within(link).getByRole("button", { name: "Nusxa olish" }));
  assert.match(link.textContent ?? "", /faqat bir marta/);
  assert.match(link.textContent ?? "", /09\.03\.2026 14:30/, "expiry in Tashkent time");
  assert.match(link.textContent ?? "", /Telegram orqali ham yuborildi/);
  // The list was refreshed behind the dialog and has the new pending account.
  await waitFor(() => assert.ok(rowOf(container, "9")));
  assert.match(rowOf(container, "9").textContent ?? "", /Kutilmoqda/);

  fireEvent.click(within(link).getByRole("button", { name: "Nusxaladim, yopish" }));
  await waitFor(() => assert.ok(!screen.queryByRole("dialog", { name: "Admin qo'shildi" })));
  assert.ok(!document.body.textContent?.includes("SECRET-TOKEN-ONCE"), "the URL is gone from the page after closing");
});

test("add admin by user ID sends userId (and no sendViaTelegram unless ticked)", async () => {
  const api = adminsApi();
  const { container } = renderPage("owner");
  await waitRows(container);
  const d = await openAdd();
  fireEvent.click(within(d).getByRole("radio", { name: "Foydalanuvchi ID" }));
  fireEvent.change(within(d).getByLabelText("Foydalanuvchi ID"), { target: { value: "42" } });
  fireEvent.change(within(d).getByLabelText("Rol"), { target: { value: "viewer" } });
  fireEvent.change(within(d).getByLabelText(/Sabab/), { target: { value: "kuzatuvchi kerak edi" } });
  fireEvent.click(confirmBtn(d));
  await screen.findByRole("dialog", { name: "Admin qo'shildi" });
  assert.deepEqual(api.calls.find((c) => c.method === "POST")!.body, { userId: "42", role: "viewer", reason: "kuzatuvchi kerak edi" });
});

test("as admin the role picker offers only roles below admin", async () => {
  adminsApi({ ownId: "2" });
  const { container } = renderPage("admin");
  await waitFor(() => assert.ok(rowOf(container, "2")));
  const d = await openAdd();
  const roleSel = within(d).getByLabelText("Rol") as HTMLSelectElement;
  assert.deepEqual([...roleSel.options].map((o) => o.value).filter(Boolean), ["finance", "support", "moderator", "viewer"]);
});

test("add admin: the server's 404 / 409 / 403 messages stay inline and the dialog stays open", async () => {
  let n = 0;
  const msgs = [
    json(404, { error: "Foydalanuvchi topilmadi" }),
    json(409, { error: "Bu foydalanuvchi allaqachon admin", code: "already_admin" }),
    json(403, { error: "Bu darajadagi hisobni boshqarishga ruxsatingiz yo'q", code: "rank" }),
  ];
  const api = adminsApi({ post: () => msgs[n++] ?? null });
  const { container } = renderPage("owner");
  await waitRows(container);
  const d = await openAdd();
  fireEvent.change(within(d).getByLabelText("Telegram ID"), { target: { value: "1" } });
  fireEvent.change(within(d).getByLabelText("Rol"), { target: { value: "admin" } });
  fireEvent.change(within(d).getByLabelText(/Sabab/), { target: { value: "sabab matni" } });
  for (const text of ["Foydalanuvchi topilmadi", "Bu foydalanuvchi allaqachon admin", "Bu darajadagi hisobni boshqarishga ruxsatingiz yo'q"]) {
    fireEvent.click(confirmBtn(d));
    await within(d).findByText(text);
    assert.ok(screen.getByRole("dialog", { name: "Admin qo'shish" }), "still open");
  }
  assert.equal(api.calls.filter((c) => c.method === "POST").length, 3);
});

test("a stale step-up is handled by core: the dialog asks once and the add is retried", async () => {
  let asked = 0;
  core.setStepUpHandler(async () => {
    asked += 1;
    return true;
  });
  let first = true;
  const api = adminsApi({
    post: () => {
      if (first) {
        first = false;
        return json(401, { error: "Qayta tasdiqlash kerak", code: "reauth" });
      }
      return null;
    },
  });
  const { container } = renderPage("owner");
  await waitRows(container);
  const d = await openAdd();
  fireEvent.change(within(d).getByLabelText("Telegram ID"), { target: { value: "7" } });
  fireEvent.change(within(d).getByLabelText("Rol"), { target: { value: "finance" } });
  fireEvent.change(within(d).getByLabelText(/Sabab/), { target: { value: "moliya xodimi" } });
  fireEvent.click(confirmBtn(d));
  await screen.findByRole("dialog", { name: "Admin qo'shildi" });
  assert.equal(asked, 1);
  assert.equal(api.calls.filter((c) => c.method === "POST").length, 2, "retried once after the step-up");
});

/* ───────────────────────────── manage actions ───────────────────────────── */

test("change role: only assignable roles, before → after, PATCH {role, reason}, toast and refreshed list", async () => {
  const api = adminsApi();
  const { container } = renderPage("owner");
  await waitRows(container);
  const m = await manage(container, "3");
  fireEvent.click(actionBtn(m, "Rolni o'zgartirish"));
  const d = await screen.findByRole("dialog", { name: "Rolni o'zgartirish" });
  const confirm = within(d).getByRole("button", { name: "Rolni o'zgartirish" }) as HTMLButtonElement;
  assert.equal(confirm.disabled, true);
  const sel = within(d).getByLabelText("Yangi rol") as HTMLSelectElement;
  assert.deepEqual([...sel.options].map((o) => o.value).filter(Boolean), ["owner", "admin", "finance", "moderator", "viewer"], "current role excluded");
  fireEvent.change(sel, { target: { value: "finance" } });
  assert.match(d.textContent ?? "", /Qo'llab-quvvatlash/);
  assert.match(d.textContent ?? "", /Moliya/);
  fireEvent.change(within(d).getByLabelText(/Sabab/), { target: { value: "vazifasi o'zgardi" } });
  fireEvent.click(confirm);
  await waitFor(() => assert.ok(toasts().some((t) => /rol «Moliya» ga o'zgartirildi/.test(t))));
  const patch = api.calls.find((c) => c.method === "PATCH")!;
  assert.equal(patch.url.pathname, "/api/admin/admins/3");
  assert.deepEqual(patch.body, { role: "finance", reason: "vazifasi o'zgardi" });
  await waitFor(() => assert.match(rowOf(container, "3").textContent ?? "", /Moliya/));
  await waitFor(() => assert.ok(!screen.queryByRole("dialog", { name: "Rolni o'zgartirish" })));
});

test("disable then enable: PATCH {status} with a reason; disabling warns that sessions end", async () => {
  const api = adminsApi();
  const { container } = renderPage("owner");
  await waitRows(container);
  const m = await manage(container, "3");
  fireEvent.click(actionBtn(m, "O'chirish"));
  const d = await screen.findByRole("dialog", { name: "Adminni o'chirish" });
  assert.match(d.textContent ?? "", /sessiyalari tugatiladi/);
  fireEvent.change(within(d).getByLabelText(/Sabab/), { target: { value: "ishdan ketdi" } });
  fireEvent.click(within(d).getByRole("button", { name: "O'chirish" }));
  await waitFor(() => assert.ok(toasts().some((t) => /o'chirildi, sessiyalari tugatildi/.test(t))));
  assert.deepEqual(api.calls.find((c) => c.method === "PATCH")!.body, { status: "disabled", reason: "ishdan ketdi" });
  await waitFor(() => assert.match(rowOf(container, "3").textContent ?? "", /O'chirilgan/));

  const m2 = await manage(container, "3");
  fireEvent.click(actionBtn(m2, "Yoqish"));
  const e = await screen.findByRole("dialog", { name: "Adminni yoqish" });
  fireEvent.change(within(e).getByLabelText(/Sabab/), { target: { value: "qaytib keldi" } });
  fireEvent.click(within(e).getByRole("button", { name: "Yoqish" }));
  await waitFor(() => assert.ok(toasts().some((t) => /Admin Aziz|Qo'llab Sardor.*yoqildi/.test(t) || /yoqildi/.test(t))));
  assert.deepEqual(api.calls.filter((c) => c.method === "PATCH").at(-1)!.body, { status: "active", reason: "qaytib keldi" });
  await waitFor(() => assert.match(rowOf(container, "3").textContent ?? "", /Faol/));
});

test("enabling an account without 2FA says it goes to 'kutilmoqda'", async () => {
  adminsApi({ items: [OWNER_ME, { ...PENDING, status: "disabled" }] });
  const { container } = renderPage("owner");
  await waitRows(container);
  const m = await manage(container, "5");
  fireEvent.click(actionBtn(m, "Yoqish"));
  const d = await screen.findByRole("dialog", { name: "Adminni yoqish" });
  assert.match(d.textContent ?? "", /«kutilmoqda» holatiga o'tadi/);
});

test("reset 2FA: POST reset-2fa {reason}; the new enroll URL is shown once and cleared on close", async () => {
  const api = adminsApi();
  const { container } = renderPage("owner");
  await waitRows(container);
  const m = await manage(container, "2");
  fireEvent.click(actionBtn(m, "2FA ni tiklash"));
  const d = await screen.findByRole("dialog", { name: "2FA ni tiklash" });
  assert.match(d.textContent ?? "", /barcha sessiyalar tugatiladi/);
  fireEvent.change(within(d).getByLabelText(/Sabab/), { target: { value: "telefon yo'qolgan" } });
  fireEvent.click(within(d).getByRole("button", { name: "2FA ni tiklash" }));
  const link = await screen.findByRole("dialog", { name: "2FA tiklandi" });
  const post = api.calls.find((c) => c.method === "POST")!;
  assert.equal(post.url.pathname, "/api/admin/admins/2/reset-2fa");
  assert.deepEqual(post.body, { reason: "telefon yo'qolgan" });
  assert.equal((within(link).getByLabelText("Ulanish havolasi") as HTMLInputElement).value, "https://slaydxx.uz/admin/enroll?token=RESET-TOKEN-ONCE");
  assert.match(link.textContent ?? "", /Admin Aziz/);
  assert.match(link.textContent ?? "", /faqat bir marta/);
  fireEvent.click(within(link).getByRole("button", { name: "Nusxaladim, yopish" }));
  await waitFor(() => assert.ok(!screen.queryByRole("dialog", { name: "2FA tiklandi" })));
  assert.ok(!document.body.textContent?.includes("RESET-TOKEN-ONCE"));
});

test("revoke sessions: POST sessions/revoke {reason}, toast with the count", async () => {
  const api = adminsApi();
  const { container } = renderPage("owner");
  await waitRows(container);
  const m = await manage(container, "3");
  fireEvent.click(actionBtn(m, "Sessiyalarni bekor qilish"));
  const d = await screen.findByRole("dialog", { name: "Sessiyalarni bekor qilish" });
  assert.match(d.textContent ?? "", /3 ta faol sessiya/);
  fireEvent.change(within(d).getByLabelText(/Sabab/), { target: { value: "shubhali kirish" } });
  fireEvent.click(within(d).getByRole("button", { name: "Sessiyalarni tugatish" }));
  await waitFor(() => assert.ok(toasts().includes("3 ta sessiya bekor qilindi")));
  const post = api.calls.find((c) => c.method === "POST")!;
  assert.equal(post.url.pathname, "/api/admin/admins/3/sessions/revoke");
  assert.deepEqual(post.body, { reason: "shubhali kirish" });
});

test("server 409 last_owner / self and 403 rank are shown inline in the action dialog (the UI never hides them)", async () => {
  const api = adminsApi({
    post: (c) => {
      if (c.method !== "PATCH") return null;
      if (c.url.pathname.endsWith("/4")) return json(409, { error: "Oxirgi faol egani o'zgartirib bo'lmaydi", code: "last_owner" });
      return json(403, { error: "Bu darajadagi hisobni boshqarishga ruxsatingiz yo'q", code: "rank" });
    },
  });
  const { container } = renderPage("owner");
  await waitRows(container);

  // The UI offers the action (another owner exists as far as the list says); the server's 409 comes back inline.
  const m = await manage(container, "4");
  fireEvent.click(actionBtn(m, "O'chirish"));
  const d = await screen.findByRole("dialog", { name: "Adminni o'chirish" });
  fireEvent.change(within(d).getByLabelText(/Sabab/), { target: { value: "sabab matni" } });
  fireEvent.click(within(d).getByRole("button", { name: "O'chirish" }));
  await within(d).findByText("Oxirgi faol egani o'zgartirib bo'lmaydi");
  assert.ok(screen.getByRole("dialog", { name: "Adminni o'chirish" }), "dialog stays open");
  fireEvent.click(within(d).getByRole("button", { name: "Bekor qilish" }));
  await waitFor(() => assert.ok(!screen.queryByRole("dialog", { name: "Adminni o'chirish" })));

  const m2 = await manage(container, "3");
  fireEvent.click(actionBtn(m2, "O'chirish"));
  const d2 = await screen.findByRole("dialog", { name: "Adminni o'chirish" });
  fireEvent.change(within(d2).getByLabelText(/Sabab/), { target: { value: "sabab matni" } });
  fireEvent.click(within(d2).getByRole("button", { name: "O'chirish" }));
  await within(d2).findByText("Bu darajadagi hisobni boshqarishga ruxsatingiz yo'q");
  assert.equal(api.calls.filter((c) => c.method === "PATCH").length, 2);
  assert.ok(!toasts().some((t) => /o'chirildi/.test(t)), "no success toast on a refused action");
});

test("names and usernames are shown as text, never interpreted as markup", async () => {
  adminsApi({ items: [OWNER_ME, acct({ id: "7", name: "<img src=x onerror=alert(1)>", username: "<b>x</b>", role: "viewer" })] });
  const { container } = renderPage("owner");
  await waitRows(container);
  assert.ok(!container.querySelector("img"), "no element created from a name");
  assert.ok(!container.querySelector("b"));
  assert.match(rowOf(container, "7").textContent ?? "", /<img src=x onerror=alert\(1\)>/);
});
