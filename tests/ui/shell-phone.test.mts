import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type * as api from "../../lib/api-client.ts";
import { PathnameContext, SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";

/**
 * Shell + overlays on phones (docs/mobile/PLAN.md O5 «44 px everywhere on
 * touch», lead decision «topbar keeps all icons with 44 px hit areas»,
 * package P4): the top bar, the drawer, and the search / notifications / pay /
 * login overlays. A coarse pointer / narrow window (stubbed `matchMedia`)
 * switches them to the phone variant; no `matchMedia` (jsdom default) keeps
 * the desktop markup — locked as well.
 *
 * jsdom has no layout, so sizes are asserted through the Tailwind classes
 * that decide them; the real pixel numbers come from the Chromium smoke.
 *
 * Mutations (each turned this file red, see the sprint report):
 *   - TopBar `size-11` → `size-10` for the icon buttons;
 *   - TopBar balance chip `h-11` → `h-8`;
 *   - TopBar avatar wrapper 44 → 32 (`size-11` → `size-8`);
 *   - Sidebar `h-12` → `h-10` rows;
 *   - SearchDialog input `text-base` → `text-sm`, rows `min-h-12` → `min-h-9`;
 *   - Notifications / Pay / Login close button `size-11` → `size-8`;
 *   - PayDialog presets `h-11` → `h-10`;
 *   - OverlayFrame dropping the `visualViewport` height (keyboard) or the safe padding;
 *   - LoginForm input `text-base` removed.
 */

const win = window as unknown as { matchMedia?: unknown; visualViewport?: unknown };

function phoneMedia(on: boolean) {
  if (!on) {
    delete win.matchMedia;
    return;
  }
  win.matchMedia = (q: string) => ({
    matches: true,
    media: q,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  });
}

const nav = await import("../../lib/nav/history.ts");
const { TopBar } = await import("../../components/shell/TopBar.tsx");
const { Sidebar } = await import("../../components/shell/Sidebar.tsx");
const { AppShell } = await import("../../components/shell/AppShell.tsx");
const { SearchDialog } = await import("../../components/overlays/SearchDialog.tsx");
const { NotificationsPanel } = await import("../../components/overlays/NotificationsPanel.tsx");
const { PayDialog } = await import("../../components/overlays/PayDialog.tsx");
const { LoginModal } = await import("../../components/overlays/LoginModal.tsx");
const { useAppStore } = await import("../../lib/store.ts");
const { useUi } = await import("../../lib/ui.ts");
const { TOOLS } = await import("../../lib/tools.ts");

const tree = (href: string) => ["", { children: [href] }];
const router = {
  push(href: string) {
    window.history.pushState({ __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: tree(href) }, "", href);
  },
  replace(href: string) {
    window.history.replaceState({ __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: tree(href) }, "", href);
  },
  refresh() {},
  back() {
    window.history.back();
  },
  forward() {},
  prefetch() {},
} as unknown as AppRouterInstance;

const sx = () => (window.history.state as { sx?: { i: number; o?: string } } | null)?.sx;

async function settle() {
  await act(async () => {
    for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 2));
  });
}

function fresh(path = "/uz") {
  nav.__resetNavForTests();
  window.history.pushState(null, "", path);
  window.sessionStorage.clear();
  nav.installNav();
  nav.setNavRouter(router);
}

const realFetch = globalThis.fetch;
afterEach(async () => {
  cleanup();
  await settle();
  nav.__resetNavForTests();
  phoneMedia(false);
  delete win.visualViewport;
  useUi.setState({ overlay: null, returnTo: null });
  useAppStore.setState({ loggedIn: false, user: null });
  globalThis.fetch = realFetch;
});

function inRouter(node: React.ReactElement) {
  return h(
    AppRouterContext.Provider,
    { value: router },
    h(
      PathnameContext.Provider,
      { value: "/uz" },
      h(SearchParamsContext.Provider, { value: new URLSearchParams("") }, node),
    ),
  );
}

const USER = {
  id: "u1", telegramId: null, username: null, name: "Ali", photoUrl: null, language: "uz", points: 0, quota: 0,
  balance: 12_500, university: "", faculty: "", department: "", group: "",
  course: "", author: "", subject: "", teacher: "", city: "", position: "", organization: "", phone: null, isAdmin: false,
} as unknown as api.ServerUser;

function signIn() {
  useAppStore.setState({ loggedIn: true, user: USER, sessionChecked: true });
}

const cls = (el: Element | null) => (el?.getAttribute("class") ?? "").split(/\s+/);
const has = (el: Element | null, c: string) => cls(el).includes(c);

// ------------------------------------------------------------------ top bar

const TOPBAR_LABELS = [
  "Yon panelni ko‘rsatish/yashirish",
  "Qidirish...",
  /^Mavzu:/,
  "Bildirishnomalar",
] as const;

test("TopBar phone: every control has a 44 px hit area, no scale, all icons kept (O5, lead decision)", () => {
  phoneMedia(true);
  signIn();
  render(h(TopBar, { onMenu: () => {} }));
  const header = document.querySelector("[data-topbar]");
  assert.ok(header);
  assert.ok(header.hasAttribute("data-phone"));
  for (const label of TOPBAR_LABELS) {
    const b = screen.getByLabelText(label);
    assert.ok(has(b, "size-11"), `${String(label)} is 44x44`);
    assert.ok(!has(b, "scale-95"), `${String(label)} is not shrunk by a transform`);
  }
  const chip = document.querySelector("[data-balance]");
  assert.ok(has(chip, "h-11") && has(chip, "min-w-11"), "balance chip is 44 px tall");
  assert.ok(has(chip, "shrink"), "chip may shrink so six controls fit at 360 px");
  assert.ok(chip?.querySelector(".truncate"), "balance digits truncate instead of overflowing");
  const avatar = document.querySelector("[data-avatar]");
  assert.ok(has(avatar, "size-11"), "avatar link is 44x44");
  assert.ok(avatar?.querySelector(".size-8"), "the visible avatar circle stays 32 px");
});

test("TopBar phone: signed out — «Kirish» is 44 px tall", () => {
  phoneMedia(true);
  render(h(TopBar, { onMenu: () => {} }));
  const btn = screen.getByText("Kirish");
  assert.ok(has(btn, "h-11") && !has(btn, "h-9"));
});

test("TopBar phone: the bar keeps the notch / Telegram safe inset above its 56 px", () => {
  phoneMedia(true);
  render(h(TopBar, { onMenu: () => {} }));
  const header = document.querySelector<HTMLElement>("[data-topbar]");
  const style = header?.getAttribute("style") ?? "";
  assert.match(style, /--tg-safe-top/, "uses the Telegram bridge var");
  assert.match(style, /env\(safe-area-inset-top/, "falls back to env()");
  assert.match(style, /3\.5rem/, "bar itself is still 56 px");
});

test("TopBar desktop: unchanged markup (40 px scaled icons, 32 px menu / avatar, 36 px login)", () => {
  signIn();
  render(h(TopBar, { onMenu: () => {} }));
  const header = document.querySelector("[data-topbar]");
  assert.ok(!header?.hasAttribute("data-phone"));
  assert.ok(!header?.getAttribute("style"), "no inline style on desktop");
  assert.ok(has(header, "h-14"));
  assert.ok(has(screen.getByLabelText("Qidirish..."), "size-10") && has(screen.getByLabelText("Qidirish..."), "scale-95"));
  assert.ok(has(screen.getByLabelText("Yon panelni ko‘rsatish/yashirish"), "size-8"));
  assert.ok(has(document.querySelector("[data-balance]"), "h-8"));
  assert.ok(has(document.querySelector("[data-avatar]"), "size-8"));
  cleanup();
  useAppStore.setState({ loggedIn: false, user: null });
  render(h(TopBar, { onMenu: () => {} }));
  assert.ok(has(screen.getByText("Kirish"), "h-9"));
});

// ------------------------------------------------------------------ drawer

test("Sidebar phone: tool rows, brand, «Yaratish» and footer rows are ≥ 48 px", () => {
  phoneMedia(true);
  signIn();
  useAppStore.setState({ user: { ...USER, isAdmin: true } });
  const { container } = render(inRouter(h(Sidebar, {})));
  const root = container.querySelector("[data-sidebar]");
  assert.ok(root?.hasAttribute("data-phone"));
  const toolLink = container.querySelector<HTMLAnchorElement>(`a[href="/uz/${TOOLS[0].slug}"]`);
  assert.ok(has(toolLink, "h-12") && !has(toolLink, "h-10"), "tool row 48 px");
  assert.ok(has(container.querySelector('a[href="/uz/create"]'), "h-12"));
  // Chromium smoke: inside the scrolling flex column «Yaratish» was squeezed to 16 px — rows must not shrink.
  assert.ok(has(container.querySelector('a[href="/uz/create"]'), "shrink-0") && has(toolLink, "shrink-0"));
  assert.ok(has(container.querySelector('a[href="/admin"]'), "h-12"), "admin row uses the shared 48 px row (UX review m10)");
  assert.ok(has(container.querySelector('a[href="/uz/profile"]'), "min-h-14"));
  assert.match(root?.getAttribute("style") ?? "", /--tg-safe-bottom/, "footer clears the home indicator");
  cleanup();
  useAppStore.setState({ loggedIn: false, user: null });
  const out = render(inRouter(h(Sidebar, {})));
  assert.ok(has(out.getByText("Tizimga kiring").closest("button"), "min-h-12"));
});

test("Sidebar desktop: 40 px rows, no inline style", () => {
  signIn();
  const { container } = render(inRouter(h(Sidebar, {})));
  const root = container.querySelector("[data-sidebar]");
  assert.ok(!root?.hasAttribute("data-phone"));
  assert.ok(!root?.getAttribute("style"));
  assert.ok(has(container.querySelector(`a[href="/uz/${TOOLS[0].slug}"]`), "h-10"));
});

// ------------------------------------------------------------------ search

test("SearchDialog phone: 16 px input, 44 px close, ≥ 48 px rows, inner scroll", () => {
  phoneMedia(true);
  signIn();
  useAppStore.setState({
    generations: [{ id: "g1", topic: "Sun’iy intellekt", type: "referat" }] as never,
  });
  useUi.setState({ overlay: "search" });
  render(inRouter(h(SearchDialog)));
  const frame = document.querySelector("[data-overlay-frame]");
  assert.ok(frame?.hasAttribute("data-phone"));
  const input = screen.getByPlaceholderText("Qidirish...");
  assert.ok(has(input, "text-base") && has(input, "h-14"), "16 px input");
  const closeBtns = screen.getAllByLabelText("Yopish").filter((b) => b.tagName === "BUTTON" && b.querySelector("svg"));
  assert.ok(has(closeBtns[0], "size-11"), "close is 44x44");
  const rows = [...document.querySelectorAll("button")].filter((b) => has(b, "w-full") && !has(b, "absolute"));
  assert.ok(rows.length > TOOLS.length, "tools + balance + files");
  for (const r of rows) assert.ok(has(r, "min-h-12"), `row «${(r.textContent ?? "").slice(0, 20)}» ≥ 48 px`);
  const list = input.closest(".overflow-hidden")?.querySelector(".overflow-y-auto");
  assert.ok(has(list ?? null, "overscroll-contain") && !has(list ?? null, "max-h-[60vh]"));
  assert.ok(has(input.closest(".overflow-hidden"), "max-h-full"), "card never taller than the frame");
});

test("SearchDialog desktop: unchanged (60vh list, 48 px input, 12vh offset)", () => {
  signIn();
  useUi.setState({ overlay: "search" });
  render(inRouter(h(SearchDialog)));
  const input = screen.getByPlaceholderText("Qidirish...");
  assert.ok(has(input, "h-12") && has(input, "text-[15.5px]"));
  assert.ok(has(input.closest(".overflow-hidden")?.querySelector(".overflow-y-auto") ?? null, "max-h-[60vh]"));
  const frame = document.querySelector("[data-overlay-frame]");
  assert.ok(has(frame, "pt-[12vh]"));
  assert.ok(!frame?.getAttribute("style"));
  assert.ok(!document.querySelector(".size-11"));
});

// ------------------------------------------------------------------ notifications

test("NotificationsPanel phone: 44 px close, anchored under the bar, scrolls inside", () => {
  phoneMedia(true);
  useUi.setState({ overlay: "notifications" });
  render(h(NotificationsPanel));
  const aside = document.querySelector("aside");
  assert.ok(has(aside, "overflow-y-auto") && has(aside, "max-h-full"));
  assert.ok(!has(aside, "absolute"), "in-flow inside the safe-area frame");
  const frame = document.querySelector<HTMLElement>("[data-overlay-frame]");
  assert.match(frame?.getAttribute("style") ?? "", /3\.5rem/, "starts below the 56 px bar");
  assert.match(frame?.getAttribute("style") ?? "", /--tg-safe-top/);
  const close = aside?.querySelector('button[aria-label="Yopish"]');
  assert.ok(has(close ?? null, "size-11"));
});

test("NotificationsPanel desktop: unchanged popover", () => {
  useUi.setState({ overlay: "notifications" });
  render(h(NotificationsPanel));
  const aside = document.querySelector("aside");
  assert.ok(has(aside, "absolute") && has(aside, "top-14"));
  assert.ok(has(aside?.querySelector('button[aria-label="Yopish"]') ?? null, "p-1.5"));
});

// ------------------------------------------------------------------ pay

test("PayDialog phone: 44 px amount chips and close, card scrolls inside the screen", () => {
  phoneMedia(true);
  signIn();
  useUi.setState({ overlay: "pay" });
  render(inRouter(h(PayDialog)));
  const chips = [...document.querySelectorAll("[aria-pressed]")];
  assert.equal(chips.length, 4);
  for (const c of chips) assert.ok(has(c, "h-11"), "amount chip 44 px");
  const card = chips[0].closest(".overflow-y-auto");
  assert.ok(card && has(card, "max-h-full"), "internal scroll");
  assert.ok(has(card.querySelector('button[aria-label="Yopish"]'), "size-11"));
  for (const m of ["Click", "Payme"]) {
    const b = screen.getByText(new RegExp(`^${m}`));
    assert.ok(has(b, "h-12"), `${m} button ≥ 48 px`);
  }
});

test("PayDialog desktop: unchanged (40 px chips)", () => {
  signIn();
  useUi.setState({ overlay: "pay" });
  render(inRouter(h(PayDialog)));
  for (const c of document.querySelectorAll("[aria-pressed]")) assert.ok(has(c, "h-10"));
  assert.ok(!document.querySelector(".size-11"));
});

// ------------------------------------------------------------------ login

function loginFeatures(over: Record<string, unknown> = {}) {
  useAppStore.setState({
    features: { llm: true, images: true, telegram: true, telegramBot: "slaydx_bot", devLogin: true, pdf: true, payments: { click: false, payme: false }, ...over },
    loggedIn: false,
    user: null,
  } as never);
}

test("LoginModal phone: 44 px close, card scrolls inside, buttons ≥ 44, dev-phone input is 16 px", async () => {
  phoneMedia(true);
  loginFeatures();
  useUi.setState({ overlay: "login" });
  render(inRouter(h(LoginModal)));
  const card = document.querySelector("[data-overlay-frame] .overflow-y-auto");
  assert.ok(card && has(card, "max-h-full"), "card scrolls inside 360x740");
  assert.ok(has(card.querySelector('button[aria-label="Yopish"]'), "size-11"));
  assert.ok(has(screen.getByText("Telegram orqali kirish"), "h-11"));
  const phoneLink = screen.getByText("Telefon raqami orqali kirish");
  assert.ok(has(phoneLink, "min-h-11"), "text link has a 44 px hit area");
  fireEvent.click(phoneLink);
  const input = document.querySelector<HTMLInputElement>("#login-phone");
  assert.ok(input && has(input, "text-base"), "phone input 16 px (no iOS focus zoom)");
  assert.ok(has(screen.getByText("Orqaga"), "h-11"));
  assert.ok(has(screen.getByText("Kod olish"), "h-11"));
});

test("LoginModal desktop: unchanged (32 px close, no inner scroll)", () => {
  loginFeatures();
  useUi.setState({ overlay: "login" });
  render(inRouter(h(LoginModal)));
  const card = document.querySelector("[data-overlay-frame] > div:last-child");
  assert.ok(!has(card ?? null, "overflow-y-auto"));
  assert.ok(has(card?.querySelector('button[aria-label="Yopish"]') ?? null, "size-8"));
  assert.ok(has(screen.getByText("Telegram orqali kirish"), "h-11"));
  assert.ok(has(screen.getByText("Telefon raqami orqali kirish"), "underline") && !has(screen.getByText("Telefon raqami orqali kirish"), "min-h-11"));
});

// ------------------------------------------------------------------ keyboard + safe area

test("OverlayFrame phone: the visible area follows the on-screen keyboard (iOS visualViewport)", async () => {
  phoneMedia(true);
  loginFeatures();
  const listeners: Array<() => void> = [];
  const vv = {
    height: 250,
    offsetTop: 40,
    scale: 1,
    addEventListener: (_: string, l: () => void) => void listeners.push(l),
    removeEventListener() {},
  };
  win.visualViewport = vv;
  useUi.setState({ overlay: "login" });
  render(inRouter(h(LoginModal)));
  await settle();
  const frame = document.querySelector<HTMLElement>("[data-overlay-frame]");
  assert.ok(frame?.hasAttribute("data-keyboard"), "keyboard detected");
  assert.equal(frame?.style.height, "250px");
  assert.equal(frame?.style.top, "40px");
  assert.ok(!/--tg-safe-bottom/.test(frame?.getAttribute("style") ?? ""), "no home-indicator inset under the keyboard");
});

test("OverlayFrame phone, keyboard closed: padded by the safe insets only", () => {
  phoneMedia(true);
  loginFeatures();
  useUi.setState({ overlay: "login" });
  render(inRouter(h(LoginModal)));
  const frame = document.querySelector<HTMLElement>("[data-overlay-frame]");
  assert.ok(!frame?.hasAttribute("data-keyboard"));
  const style = frame?.getAttribute("style") ?? "";
  for (const v of ["--tg-safe-top", "--tg-content-safe-top", "--tg-safe-bottom", "--tg-safe-left", "--tg-safe-right"]) {
    assert.ok(style.includes(v), `${v} used`);
  }
  assert.ok(style.includes("env(safe-area-inset-bottom"), "env() fallback");
});

// ------------------------------------------------------------------ phone back keeps closing overlays first

async function openAndBack(open: () => void, isOpen: () => boolean, label: string) {
  fresh("/uz");
  phoneMedia(true);
  loginFeatures();
  render(inRouter(h(AppShell, null, h("div", null, "sahifa"))));
  await settle();
  act(() => open());
  await settle();
  assert.ok(isOpen(), `${label} opened`);
  assert.ok(sx()?.o, `${label} owns a history entry`);
  await act(async () => {
    window.history.back();
  });
  await settle();
  assert.ok(!isOpen(), `${label}: back closed it`);
  assert.equal(window.location.pathname, "/uz", `${label}: page unchanged`);
}

for (const name of ["search", "notifications", "pay", "login"] as const) {
  test(`phone back closes the ${name} overlay first (phone layout)`, async () => {
    await openAndBack(
      () => useUi.getState().open(name),
      () => useUi.getState().overlay === name,
      name,
    );
  });
}

test("phone back closes the drawer first (phone layout, 48 px rows inside)", async () => {
  fresh("/uz");
  phoneMedia(true);
  render(inRouter(h(AppShell, null, h("div", null, "sahifa"))));
  fireEvent.click(screen.getByLabelText("Yon panelni ko‘rsatish/yashirish"));
  await settle();
  const drawer = document.querySelector(".fixed.inset-0.z-40");
  assert.ok(drawer);
  assert.ok(has(drawer.querySelector(`a[href="/uz/${TOOLS[0].slug}"]`), "h-12"));
  await act(async () => {
    window.history.back();
  });
  await settle();
  assert.ok(!document.querySelector(".fixed.inset-0.z-40"));
});
