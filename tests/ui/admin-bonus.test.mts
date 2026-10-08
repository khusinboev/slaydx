import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createElement as h, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type * as IdentityModule from "../../components/admin/shell/admin-identity.tsx";
import type * as ToasterModule from "../../components/admin/ui/Toaster.tsx";
import { BonusPage } from "../../components/admin/bonus/BonusPage.tsx";
import { bonusText, checkAmounts, checkIntText, checkInviteText, defaultPreset, inviteHref } from "../../components/admin/bonus/format.ts";

/**
 * `/admin/bonus` «Bonus kanallar» (docs/bonus/PLAN.md K2): helpers; loading / empty (with the
 * bot-admin instructions) / error / forbidden; rows with link, «1 000 + 2 000 / 7 kun», stats
 * and the live bot status (+ «Qayta tekshirish»); viewers see no controls; add flow (resolve
 * preview → owner's default amounts → POST body); edit sends only changed fields; the active
 * switch; delete is disabled while claims exist and otherwise confirms before DELETE.
 *
 * Mutation checks (each made the named test fail, then restored):
 *   - `defaultPreset` always "extra" → "add: first channel" (POST joinBonus 1000, not 2000);
 *   - edit dialog sending every field instead of the diff → "edit: only changed fields";
 *   - `disabled={hasClaims}` removed from the delete button → "delete: disabled while claims exist";
 *   - the bot-status effect not started after the list loads → "ready: rows" (no «Bot admin»);
 *   - the preview kept after the address changes → "add: first channel";
 *   - the edit dialog never sending `inviteLink` → "invite link: private channel";
 *   - «Havola yaratish» not filling the field → "invite link: private channel";
 *   - `ChannelRow` using `item.inviteLink` as the href unchecked → "invite link: an unexpected stored value".
 */
const req = createRequire(import.meta.url);
const { AdminIdentityProvider } = req("../../components/admin/shell/admin-identity.tsx") as typeof IdentityModule;
const { useToastStore } = req("../../components/admin/ui/Toaster.tsx") as typeof ToasterModule;

const realFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  useToastStore.getState().clear();
});

const PERMS = { owner: ["bonus.view", "bonus.edit"], viewer: ["bonus.view"] } as const;
type Role = keyof typeof PERMS;

const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

type Call = { url: string; method: string; body: Record<string, unknown> };
type Route = (c: Call) => Response | Promise<Response> | null;

/** Routes by URL; every call is recorded. A call no route answers fails the test. */
function stubFetch(routes: Route[]): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    const c: Call = { url: String(url), method: init.method ?? "GET", body: init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {} };
    calls.push(c);
    for (const r of routes) {
      const res = await r(c);
      if (res) return res;
    }
    assert.fail(`kutilmagan so'rov: ${c.method} ${c.url}`);
  }) as typeof fetch;
  return calls;
}

function mount(node: ReactNode, role: Role = "owner") {
  render(h(AdminIdentityProvider, { value: { adminId: "1", role, permissions: PERMS[role], name: "Admin", username: null, twoFactor: true }, children: node }));
}

const NBSP = " ";
const stats = (s: Partial<Record<string, number>> = {}) => ({ joined: 0, joinPaidCount: 0, joinPaidSum: 0, stayPaidCount: 0, stayPaidSum: 0, left: 0, stayPending: 0, ...s });
const NEWS = {
  id: "1",
  chatId: "-1001000000001",
  username: "slaydx_news",
  inviteLink: null as string | null,
  title: "SlaydX Yangiliklar",
  joinBonus: 2000,
  stayBonus: 0,
  stayDays: 7,
  active: true,
  sort: 1,
  createdAt: "2026-10-08T08:00:00.000Z",
  updatedAt: "2026-10-08T08:00:00.000Z",
  stats: stats({ joined: 12, joinPaidCount: 12, joinPaidSum: 24_000, stayPending: 12 }),
};
const PARTNER = {
  ...NEWS,
  id: "2",
  chatId: "-1001000000002",
  username: null,
  title: "Hamkor kanal",
  joinBonus: 1000,
  stayBonus: 2000,
  sort: 2,
  stats: stats(),
};

const listRoute = (items: unknown[]): Route => (c) => (c.method === "GET" && c.url === "/api/admin/bonus-channels" ? json(200, { items }) : null);
const botRoute = (status: Record<string, "admin" | "not_admin" | "unknown">): Route => (c) => {
  const m = /^\/api\/admin\/bonus-channels\/(\d+)\/bot-status$/.exec(c.url);
  if (!m) return null;
  const s = status[m[1]!] ?? "admin";
  return json(200, { id: m[1], botAdmin: s, warning: s === "admin" ? null : "Bot kanalda admin emas — obunani tekshira olmaydi" });
};

const rowOf = (id: string): HTMLElement => {
  const el = document.querySelector<HTMLElement>(`[data-channel="${id}"]`);
  assert.ok(el, `${id} qatori yo'q`);
  return el;
};
const button = (name: string | RegExp) => screen.getByRole("button", { name }) as HTMLButtonElement;
const toasts = () => useToastStore.getState().toasts.map((t) => t.message);

/* ───────────────────────────── helpers (no DOM) ───────────────────────────── */

test("format: bonusText, checkIntText, checkAmounts, defaultPreset", () => {
  assert.equal(bonusText({ joinBonus: 1000, stayBonus: 2000, stayDays: 7 }), `1${NBSP}000 + 2${NBSP}000 / 7 kun`);
  assert.equal(bonusText({ joinBonus: 2000, stayBonus: 0, stayDays: 7 }), `2${NBSP}000`);
  assert.deepEqual(checkIntText(" 1 500 ", 0, 1_000_000, "x"), { ok: true, value: 1500 });
  assert.deepEqual(checkIntText(`2${NBSP}000`, 0, 1_000_000, "x"), { ok: true, value: 2000 });
  for (const bad of ["", "-1", "1.5", "abc", "1000001", "1e3"]) assert.equal(checkIntText(bad, 0, 1_000_000, "x").ok, false, bad);
  assert.deepEqual(checkIntText("-5", -10, 10, "x"), { ok: true, value: -5 });
  assert.equal(checkAmounts({ joinBonus: "0", stayBonus: "0", stayDays: "7" }).ok, false, "at least one bonus");
  assert.equal(checkAmounts({ joinBonus: "1000", stayBonus: "0", stayDays: "0" }).ok, false, "days 1..365");
  assert.deepEqual(checkAmounts({ joinBonus: "1000", stayBonus: "2000", stayDays: "7" }), { ok: true, value: { joinBonus: 1000, stayBonus: 2000, stayDays: 7 } });
  // Per-channel cap 20 000 for each bonus (mirrors the server's MAX_BONUS).
  assert.deepEqual(checkAmounts({ joinBonus: "20 000", stayBonus: "20000", stayDays: "7" }), { ok: true, value: { joinBonus: 20000, stayBonus: 20000, stayDays: 7 } });
  const overJoin = checkAmounts({ joinBonus: "20001", stayBonus: "0", stayDays: "7" });
  assert.ok(!overJoin.ok && /^Obuna bonusi: 0 dan 20.000 gacha$/.test(overJoin.error), JSON.stringify(overJoin));
  const overStay = checkAmounts({ joinBonus: "1000", stayBonus: "1000000", stayDays: "7" });
  assert.ok(!overStay.ok && /^Qo'shimcha bonus: 0 dan 20.000 gacha$/.test(overStay.error), JSON.stringify(overStay));
  assert.equal(defaultPreset(0), "news");
  assert.equal(defaultPreset(3), "extra");
  assert.deepEqual(checkInviteText(" t.me/joinchat/AbCdEfGh12 "), { ok: true, value: "https://t.me/+AbCdEfGh12" });
  assert.deepEqual(checkInviteText(""), { ok: true, value: null });
  for (const bad of ["https://t.me/slaydx_news", "https://evil.example/+AbCdEfGh12", "https://t.me/+short"]) assert.equal(checkInviteText(bad).ok, false, bad);
});

/* ───────────────────────────── states ───────────────────────────── */

test("empty: explains that the bot must be a channel admin; owner gets «Kanal qo'shish», viewer does not", async () => {
  stubFetch([listRoute([])]);
  mount(h(BonusPage));
  await screen.findByText("Hali bonus kanal yo'q");
  assert.ok(screen.getByText(/botni kanalga admin qilib qo'shing/));
  assert.ok(screen.getByRole("note").textContent?.includes("Bot har bir kanalda admin bo'lishi shart"));
  assert.ok(button("Kanal qo'shish"));
  cleanup();

  stubFetch([listRoute([])]);
  mount(h(BonusPage), "viewer");
  await screen.findByText("Hali bonus kanal yo'q");
  assert.ok(!screen.queryByRole("button", { name: "Kanal qo'shish" }));
});

test("error and forbidden states", async () => {
  let n = 0;
  stubFetch([(c) => (c.url === "/api/admin/bonus-channels" ? (n++ === 0 ? json(500, { error: "Ichki xatolik", requestId: "req-42" }) : json(200, { items: [] })) : null)]);
  mount(h(BonusPage));
  await screen.findByText("Ichki xatolik");
  assert.ok(screen.getByText("req-42"));
  fireEvent.click(button("Qayta urinish"));
  await screen.findByText("Hali bonus kanal yo'q");
  cleanup();

  stubFetch([() => json(403, { error: "Bu amal uchun ruxsatingiz yo'q", code: "forbidden" })]);
  mount(h(BonusPage), "viewer");
  await screen.findByText("Ruxsat yo'q");
});

test("ready: rows with link, amounts, stats, live bot status; «Qayta tekshirish» checks again", async () => {
  const calls = stubFetch([listRoute([NEWS, PARTNER]), botRoute({ "2": "not_admin" })]);
  mount(h(BonusPage));
  await screen.findByText("SlaydX Yangiliklar");

  const news = within(rowOf("1"));
  const link = news.getByRole("link", { name: /@slaydx_news/ }) as HTMLAnchorElement;
  assert.equal(link.getAttribute("href"), "https://t.me/slaydx_news");
  assert.equal(link.getAttribute("rel"), "noopener noreferrer");
  assert.equal(rowOf("1").querySelector("[data-bonus]")?.textContent, `2${NBSP}000`);
  assert.ok(news.getByText("qo'shimcha yo'q"));
  assert.ok(news.getByText("12 ta · 24 000"), "join paid count · sum (getByText normalises the NBSP)");
  await waitFor(() => assert.ok(news.getByText("Bot admin")));

  const partner = within(rowOf("2"));
  assert.equal(rowOf("2").querySelector("[data-bonus]")?.textContent, `1${NBSP}000 + 2${NBSP}000 / 7 kun`);
  assert.ok(partner.getByText(/Yopiq kanal · ID -1001000000002/));
  await waitFor(() => assert.ok(partner.getByText("Bot admin emas")));
  assert.ok(partner.getByText("Bot kanalda admin emas — obunani tekshira olmaydi"));
  assert.ok(screen.getByText(/Faol: 2 \/ 2/));

  const before = calls.filter((c) => c.url.endsWith("/2/bot-status")).length;
  assert.equal(before, 1);
  fireEvent.click(partner.getByRole("button", { name: "Hamkor kanal: botni qayta tekshirish" }));
  await waitFor(() => assert.equal(calls.filter((c) => c.url.endsWith("/2/bot-status")).length, 2));

  // Delete is disabled while claims exist (row 1 has 12), enabled without (row 2).
  assert.equal((news.getByRole("button", { name: "SlaydX Yangiliklar: o'chirish" }) as HTMLButtonElement).disabled, true);
  assert.equal((partner.getByRole("button", { name: "Hamkor kanal: o'chirish" }) as HTMLButtonElement).disabled, false);
});

test("viewer: values and status only — no switch, edit, delete or add", async () => {
  stubFetch([listRoute([NEWS, { ...PARTNER, active: false }]), botRoute({})]);
  mount(h(BonusPage), "viewer");
  await screen.findByText("SlaydX Yangiliklar");
  assert.ok(!screen.queryByRole("switch"));
  assert.ok(!screen.queryByRole("button", { name: /tahrirlash/ }));
  assert.ok(!screen.queryByRole("button", { name: /o'chirish/ }));
  assert.ok(!screen.queryByRole("button", { name: "Kanal qo'shish" }));
  assert.ok(screen.getByText(/faqat ko'rish huquqi/));
  assert.ok(within(rowOf("2")).getAllByText("O'chiq").length >= 1);
});

/* ───────────────────────────── flows ───────────────────────────── */

test("add: first channel — resolve preview, news defaults (2 000, qo'shimcha yo'q), POST body, row appears with the bot warning", async () => {
  const created = { ...NEWS, stats: stats() };
  const calls = stubFetch([
    listRoute([]),
    (c) =>
      c.url.startsWith("/api/admin/bonus-channels/resolve")
        ? json(200, { chatId: NEWS.chatId, title: NEWS.title, username: NEWS.username, type: "channel", botAdmin: "not_admin", warning: "Bot kanalda admin emas — obunani tekshira olmaydi", existingId: null })
        : null,
    (c) => (c.method === "POST" ? json(201, { item: created, botAdmin: "not_admin", warning: "Bot kanalda admin emas — obunani tekshira olmaydi" }) : null),
  ]);
  mount(h(BonusPage));
  await screen.findByText("Hali bonus kanal yo'q");
  fireEvent.click(button("Kanal qo'shish"));
  const dialog = within(await screen.findByRole("dialog"));
  assert.equal(button("Qo'shish").disabled, true, "nothing resolved yet");

  fireEvent.change(dialog.getByLabelText("Kanal manzili"), { target: { value: "https://t.me/slaydx_news" } });
  fireEvent.click(dialog.getByRole("button", { name: "Tekshirish" }));
  await dialog.findByText("SlaydX Yangiliklar");
  assert.equal(calls.find((c) => c.url.startsWith("/api/admin/bonus-channels/resolve"))!.url, "/api/admin/bonus-channels/resolve?q=https%3A%2F%2Ft.me%2Fslaydx_news");
  assert.ok(dialog.getByText("Bot kanalda admin emas — obunani tekshira olmaydi"));
  assert.equal((dialog.getByLabelText("Obuna bonusi") as HTMLInputElement).value, "2000");
  assert.equal((dialog.getByLabelText("Qo'shimcha bonus") as HTMLInputElement).value, "0");
  assert.equal(dialog.getByRole("button", { name: "Yangiliklar kanali: 2 000, qo'shimcha yo'q" }).getAttribute("aria-pressed"), "true");

  // Editing the address invalidates the preview.
  fireEvent.change(dialog.getByLabelText("Kanal manzili"), { target: { value: "https://t.me/slaydx_newsX" } });
  assert.ok(!dialog.queryByLabelText("Obuna bonusi"));
  fireEvent.change(dialog.getByLabelText("Kanal manzili"), { target: { value: "https://t.me/slaydx_news" } });
  assert.ok(dialog.getByLabelText("Obuna bonusi"), "same address: the preview is valid again");

  fireEvent.click(button("Qo'shish"));
  await waitFor(() => assert.ok(!screen.queryByRole("dialog")));
  const post = calls.find((c) => c.method === "POST")!;
  assert.equal(post.url, "/api/admin/bonus-channels");
  assert.deepEqual(post.body, { input: "https://t.me/slaydx_news", joinBonus: 2000, stayBonus: 0, stayDays: 7 });
  await screen.findByText("SlaydX Yangiliklar");
  assert.ok(within(rowOf("1")).getByText("Bot admin emas"), "the create answer seeds the bot status");
  assert.ok(toasts().some((m) => m.includes("admin emas")), toasts().join(" | "));
});

test("add: later channels default to 1 000 + 2 000 / 7 kun; a known chat blocks saving", async () => {
  stubFetch([
    listRoute([NEWS]),
    botRoute({}),
    (c) =>
      c.url.startsWith("/api/admin/bonus-channels/resolve")
        ? json(200, { chatId: NEWS.chatId, title: NEWS.title, username: NEWS.username, type: "channel", botAdmin: "admin", warning: null, existingId: "1" })
        : null,
  ]);
  mount(h(BonusPage));
  await screen.findByText("SlaydX Yangiliklar");
  fireEvent.click(button("Kanal qo'shish"));
  const dialog = within(await screen.findByRole("dialog"));
  fireEvent.change(dialog.getByLabelText("Kanal manzili"), { target: { value: "@slaydx_news" } });
  fireEvent.keyDown(dialog.getByLabelText("Kanal manzili"), { key: "Enter" });
  await dialog.findByText("Bu kanal allaqachon qo'shilgan.");
  assert.equal((dialog.getByLabelText("Obuna bonusi") as HTMLInputElement).value, "1000");
  assert.equal((dialog.getByLabelText("Qo'shimcha bonus") as HTMLInputElement).value, "2000");
  assert.equal((dialog.getByLabelText("Necha kundan keyin") as HTMLInputElement).value, "7");
  assert.equal(button("Qo'shish").disabled, true);
});

test("edit: only changed fields are sent; the row updates from the answer", async () => {
  const saved = { ...PARTNER, joinBonus: 1500 };
  const calls = stubFetch([listRoute([NEWS, PARTNER]), botRoute({}), (c) => (c.method === "PATCH" ? json(200, { item: saved }) : null)]);
  mount(h(BonusPage));
  await screen.findByText("Hamkor kanal");
  fireEvent.click(button("Hamkor kanal: tahrirlash"));
  const dialog = within(await screen.findByRole("dialog"));
  assert.equal(button("Saqlash").disabled, true, "nothing changed yet");
  fireEvent.change(dialog.getByLabelText("Obuna bonusi"), { target: { value: "1 500" } });
  fireEvent.click(button("Saqlash"));
  await waitFor(() => assert.ok(!screen.queryByRole("dialog")));
  const p = calls.find((c) => c.method === "PATCH")!;
  assert.equal(p.url, "/api/admin/bonus-channels/2");
  assert.deepEqual(p.body, { joinBonus: 1500 });
  assert.equal(rowOf("2").querySelector("[data-bonus]")?.textContent, `1${NBSP}500 + 2${NBSP}000 / 7 kun`);
});

test("active switch: PATCH {active:false}; the row shows «O'chiq»", async () => {
  const calls = stubFetch([listRoute([NEWS]), botRoute({}), (c) => (c.method === "PATCH" ? json(200, { item: { ...NEWS, active: false } }) : null)]);
  mount(h(BonusPage));
  await screen.findByText("SlaydX Yangiliklar");
  const sw = within(rowOf("1")).getByRole("switch", { name: "SlaydX Yangiliklar: faol" });
  assert.equal(sw.getAttribute("aria-checked"), "true");
  fireEvent.click(sw);
  await waitFor(() => assert.equal(within(rowOf("1")).getByRole("switch").getAttribute("aria-checked"), "false"));
  assert.deepEqual(calls.find((c) => c.method === "PATCH")!.body, { active: false });
});

test("delete: confirm dialog, DELETE, the row disappears; a 409 has_claims stays in the dialog", async () => {
  const calls = stubFetch([listRoute([NEWS, PARTNER]), botRoute({}), (c) => (c.method === "DELETE" ? json(200, { id: "2", deleted: true }) : null)]);
  mount(h(BonusPage));
  await screen.findByText("Hamkor kanal");
  fireEvent.click(button("Hamkor kanal: o'chirish"));
  const dialog = within(await screen.findByRole("dialog"));
  assert.ok(dialog.getByText(/qaytarib bo'lmaydi/));
  fireEvent.click(dialog.getByRole("button", { name: "O'chirish" }));
  await waitFor(() => assert.ok(!screen.queryByRole("dialog")));
  const d = calls.find((c) => c.method === "DELETE")!;
  assert.equal(d.url, "/api/admin/bonus-channels/2");
  assert.ok(!document.querySelector('[data-channel="2"]'));
  assert.ok(rowOf("1"));
  cleanup();

  stubFetch([
    listRoute([PARTNER]),
    botRoute({}),
    (c) => (c.method === "DELETE" ? json(409, { error: "Bu kanal bo'yicha 1 ta foydalanuvchi bonus olgan — o'chirib bo'lmaydi.", code: "has_claims" }) : null),
  ]);
  mount(h(BonusPage));
  await screen.findByText("Hamkor kanal");
  fireEvent.click(button("Hamkor kanal: o'chirish"));
  const d2 = within(await screen.findByRole("dialog"));
  fireEvent.click(d2.getByRole("button", { name: "O'chirish" }));
  await d2.findByText(/o'chirib bo'lmaydi/);
});

test("invite link: an unexpected stored value is rendered as text, never as an href", async () => {
  assert.equal(inviteHref("https://t.me/+AbCdEfGh12"), "https://t.me/+AbCdEfGh12");
  for (const bad of [null, "", "javascript:alert(1)", "https://evil.example/+AbCdEfGh12", "http://t.me/+AbCdEfGh12", "https://t.me/+short", "https://t.me/+AbCdEfGh12?x=1", "https://t.me/slaydx_news", " https://t.me/+AbCdEfGh12"]) {
    assert.equal(inviteHref(bad), null, String(bad));
  }
  const EVIL = "javascript:alert(document.cookie)//https://t.me/+AbCdEfGh12";
  const OTHER = "https://evil.example/+AbCdEfGh12";
  stubFetch([
    listRoute([
      { ...PARTNER, id: "4", title: "Buzuq havola", inviteLink: EVIL },
      { ...PARTNER, id: "5", title: "Begona havola", inviteLink: OTHER },
      { ...PARTNER, id: "6", title: "To'g'ri havola", inviteLink: "https://t.me/+AbCdEfGh12" },
    ]),
    botRoute({}),
  ]);
  mount(h(BonusPage));
  await screen.findByText("Buzuq havola");
  for (const [id, value] of [["4", EVIL], ["5", OTHER]] as const) {
    const row = rowOf(id);
    assert.ok(!row.querySelector("[data-invite]"), `${id}: no invite anchor`);
    assert.ok(![...row.querySelectorAll("a")].some((a) => (a.getAttribute("href") ?? "").includes("+AbCdEfGh12")), `${id}: no href with the value`);
    assert.equal(row.querySelector("[data-invite-text]")?.textContent, value, `${id}: shown as text`);
  }
  const good = rowOf("6").querySelector<HTMLAnchorElement>("[data-invite]");
  assert.ok(good);
  assert.equal(good.getAttribute("href"), "https://t.me/+AbCdEfGh12");
});

test("invite link: private channel row warns without a link; add fills it via «Havola yaratish»; edit clears it", async () => {
  const LINK = "https://t.me/+AbCdEfGh12";
  const PRIV = { ...PARTNER, id: "3", chatId: "-1001000000003", title: "Yopiq hamkor" };
  const calls = stubFetch([
    listRoute([NEWS, PARTNER, { ...PRIV, inviteLink: LINK }]),
    botRoute({}),
    (c) =>
      c.url.startsWith("/api/admin/bonus-channels/resolve")
        ? json(200, { chatId: "-1001000000009", title: "Maxfiy kanal", username: null, type: "channel", botAdmin: "admin", warning: null, existingId: null })
        : null,
    (c) => (c.url === "/api/admin/bonus-channels/invite-link" ? json(200, { inviteLink: "https://t.me/+NewLink12345" }) : null),
    (c) => (c.method === "POST" && c.url === "/api/admin/bonus-channels" ? json(201, { item: { ...PRIV, id: "9", title: "Maxfiy kanal", inviteLink: "https://t.me/+NewLink12345" }, botAdmin: "admin", warning: null }) : null),
    (c) => (c.method === "PATCH" ? json(200, { item: { ...PRIV, inviteLink: null } }) : null),
  ]);
  mount(h(BonusPage));
  await screen.findByText("Yopiq hamkor");
  assert.ok(within(rowOf("2")).getByText("Taklif havolasi yo'q"), "private channel without a link is flagged");
  assert.ok(!within(rowOf("1")).queryByText("Taklif havolasi yo'q"), "public channels need no link");
  const invite = rowOf("3").querySelector<HTMLAnchorElement>("[data-invite]");
  assert.ok(invite);
  assert.equal(invite.getAttribute("href"), LINK);

  // Add a private channel: the field warns, «Havola yaratish» fills it, the POST carries it.
  fireEvent.click(button("Kanal qo'shish"));
  const dialog = within(await screen.findByRole("dialog"));
  fireEvent.change(dialog.getByLabelText("Kanal manzili"), { target: { value: "-1001000000009" } });
  fireEvent.click(dialog.getByRole("button", { name: "Tekshirish" }));
  await dialog.findByText("Maxfiy kanal");
  assert.ok(dialog.getByText(/havolasiz foydalanuvchi kanalga kira olmaydi/));
  fireEvent.click(dialog.getByRole("button", { name: "Havola yaratish" }));
  await waitFor(() => assert.equal((dialog.getByLabelText("Taklif havolasi") as HTMLInputElement).value, "https://t.me/+NewLink12345"));
  assert.deepEqual(calls.find((c) => c.url === "/api/admin/bonus-channels/invite-link")!.body, { input: "-1001000000009" });
  fireEvent.change(dialog.getByLabelText("Taklif havolasi"), { target: { value: "https://t.me/nope" } });
  assert.equal(button("Qo'shish").disabled, true, "an invalid link blocks saving");
  fireEvent.change(dialog.getByLabelText("Taklif havolasi"), { target: { value: "https://t.me/joinchat/NewLink12345" } });
  fireEvent.click(button("Qo'shish"));
  await waitFor(() => assert.ok(!screen.queryByRole("dialog")));
  assert.equal(calls.find((c) => c.method === "POST" && c.url === "/api/admin/bonus-channels")!.body.inviteLink, "https://t.me/+NewLink12345", "normalized before sending");

  // Edit: clearing the link sends exactly {inviteLink: null}.
  fireEvent.click(button("Yopiq hamkor: tahrirlash"));
  const edit = within(await screen.findByRole("dialog"));
  assert.equal((edit.getByLabelText("Taklif havolasi") as HTMLInputElement).value, LINK);
  fireEvent.change(edit.getByLabelText("Taklif havolasi"), { target: { value: "" } });
  fireEvent.click(button("Saqlash"));
  await waitFor(() => assert.ok(!screen.queryByRole("dialog")));
  assert.deepEqual(calls.find((c) => c.method === "PATCH")!.body, { inviteLink: null });
  await waitFor(() => assert.ok(within(rowOf("3")).getByText("Taklif havolasi yo'q")));
});
