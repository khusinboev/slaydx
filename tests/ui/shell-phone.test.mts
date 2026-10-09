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
 * Redesign F0 (docs/redesign/PLAN.md): the TopBar, the Sidebar and the drawer
 * are gone. Their phone rules moved to the successors: page-header icon
 * buttons (`HeaderIconButton`, `ThemeToggle`), the balance chip, the shell's
 * top inset strip, the «+» sheet (`CreateSheet`) and the tab bar
 * (`tests/ui/tab-bar.test.mts` holds the bar's own sizes and behaviour).
 *
 * Mutations (each turned this file red, see the sprint / F0 reports):
 *   - HeaderIconButton `size-11` → `size-10`; BalanceChip `h-11` → `h-8`;
 *   - PageHeader back link without the 44 px class; title `text-[24px]` → `text-xl`;
 *   - AppShell top strip without `TOP_INSET`;
 *   - CreateSheet tiles `min-h-[5.5rem]` → `min-h-8`, close `size-11` → `size-8`;
 *   - SearchDialog input `text-base` → `text-sm`, rows `min-h-12` → `min-h-9`;
 *   - Notifications / Pay / Login close button `size-11` → `size-8`;
 *   - PayDialog presets `h-11` → `h-10`;
 *   - OverlayFrame dropping the `visualViewport` height (keyboard) or the safe padding;
 *   - LoginForm input `text-base` removed.
 *   - W5: sheet without the grabber; `--sheet-pb` without the bottom safe area; search «Balansni
 *     to'ldirish» → `/uz/purchase`.
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
const { PageHeader, HeaderIconButton } = await import("../../components/shell/PageHeader.tsx");
const { ThemeToggle } = await import("../../components/shell/ThemeToggle.tsx");
const { BalanceChip } = await import("../../components/shell/BalanceChip.tsx");
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

// ------------------------------------------------------------------ page header (was: top bar)

/** A tab page header as Bosh draws it: search, theme, bell + the balance chip. */
function headerWithActions() {
  return inRouter(
    h(
      "div",
      null,
      h(PageHeader, {
        title: "Salom, Ali",
        subtitle: "Bugun nima yaratamiz?",
        actions: h(
          "span",
          null,
          h(HeaderIconButton, { label: "Qidirish" }, "q"),
          h(ThemeToggle),
          h(HeaderIconButton, { label: "Bildirishnomalar", title: "Bildirishnomalar (Alt+T)" }, "b"),
        ),
      }),
      h(BalanceChip),
    ),
  );
}

const HEADER_LABELS = ["Qidirish", /^Mavzu:/, "Bildirishnomalar"] as const;

test("page header phone: every icon button has a 44 px hit area with no scale; the balance chip is 44 px and truncates", () => {
  phoneMedia(true);
  signIn();
  render(headerWithActions());
  for (const label of HEADER_LABELS) {
    const b = screen.getByLabelText(label);
    assert.ok(has(b, "size-11"), `${String(label)} is 44x44`);
    assert.ok(!has(b, "scale-95"), `${String(label)} is not shrunk by a transform`);
    assert.ok(has(b, "focus-visible:ring-2"), `${String(label)}: keyboard ring`);
  }
  const chip = document.querySelector("[data-balance]");
  assert.ok(has(chip, "h-11") && has(chip, "min-w-11"), "balance chip is 44 px tall");
  assert.ok(has(chip, "shrink"), "chip may shrink in a 360 px header");
  assert.ok(chip?.querySelector(".truncate"), "balance digits truncate instead of overflowing");
  assert.equal(chip?.getAttribute("href"), "/uz/wallet");
});

test("page header: the step «←» is a 44 px link to the parent; the title is 24 px with -0.02em tracking", () => {
  fresh("/uz/profile/korinish");
  render(
    h(
      AppRouterContext.Provider,
      { value: router },
      h(PathnameContext.Provider, { value: "/uz/profile/korinish" }, h(PageHeader, { title: "Ko‘rinish", back: true })),
    ),
  );
  const back = document.querySelector<HTMLAnchorElement>("[data-page-header-back]")!;
  assert.ok(back, "back link");
  assert.equal(back.getAttribute("href"), "/uz/profile", "parent from lib/nav/parents.ts");
  assert.equal(back.getAttribute("aria-label"), "Orqaga");
  assert.ok(has(back, "size-11"), "44 px");
  const h1 = document.querySelector("[data-page-header] h1");
  assert.ok(has(h1, "text-[24px]") && has(h1, "tracking-[-0.02em]"));
  assert.ok(has(document.querySelector("[data-page-header]"), "sticky"), "sticky header");
});

test("shell phone: the page sits below the notch / Telegram header (the old TopBar inset now lives in a top strip)", () => {
  phoneMedia(true);
  fresh("/uz");
  render(inRouter(h(AppShell, null, h("div", null, "sahifa"))));
  const strip = document.querySelector<HTMLElement>("[data-top-inset]");
  const style = strip?.getAttribute("style") ?? "";
  assert.match(style, /--tg-safe-top/, "uses the Telegram bridge var");
  assert.match(style, /env\(safe-area-inset-top/, "falls back to env()");
  assert.match(style, /--tg-content-safe-top/, "Telegram's own header in fullscreen");
  assert.ok(!document.querySelector("[data-topbar]"), "no top bar any more");
  assert.ok(!document.querySelector("[data-sidebar]"), "no sidebar any more");
});

test("page header desktop: the same 44 px buttons (no phone/desktop split), no inline style", () => {
  signIn();
  render(headerWithActions());
  const header = document.querySelector("[data-page-header]");
  assert.ok(!header?.getAttribute("style"), "no inline style");
  for (const label of HEADER_LABELS) assert.ok(has(screen.getByLabelText(label), "size-11"));
  cleanup();
  useAppStore.setState({ loggedIn: false, user: null });
  render(headerWithActions());
  assert.ok(!document.querySelector("[data-balance]"), "signed out: no balance chip");
});

// ------------------------------------------------------------------ «+» sheet (was: drawer)

test("CreateSheet phone: tiles ≥ 44 px, 44 px close, 48 px «Barchasi», the card scrolls inside under the top inset", async () => {
  phoneMedia(true);
  fresh("/uz");
  signIn();
  render(inRouter(h(AppShell, null, h("div", null, "sahifa"))));
  await act(async () => {
    useUi.getState().open("create");
  });
  await settle();
  const sheet = document.querySelector("[data-create-sheet]");
  assert.ok(sheet);
  const tool = sheet.querySelector(`[data-create-tool="${TOOLS[0].id}"]`);
  assert.ok(has(tool, "min-h-[5.5rem]"), "tool tile ≥ 44 px");
  const close = [...sheet.querySelectorAll('button[aria-label="Yopish"]')].find((b) => !b.hasAttribute("data-create-scrim"));
  assert.ok(has(close ?? null, "size-11"), "close is 44x44");
  assert.ok(has(sheet.querySelector("[data-create-all]"), "h-12"), "«Barchasi» 48 px");
  const panel = sheet.querySelector<HTMLElement>(".slx-sheet-enter");
  assert.match(panel?.getAttribute("style") ?? "", /max-height: min\(88svh, calc\(100svh - calc\(var\(--tg-safe-top/, "never under the notch, the page peeks out above");
  assert.match(panel?.getAttribute("style") ?? "", /padding-bottom: calc\(var\(--tabbar-h, 0px\) \+ var\(--tg-safe-bottom/, "clears the bar and the home indicator");
  assert.ok(sheet.querySelector(".overflow-y-auto.overscroll-contain"), "inner scroll");
});

// ------------------------------------------------------------------ search
// Redesign W5 (variant A): rows carry the tool's icon chip and are ≥ 56 px on touch (was ≥ 48); the close
// button is the shared `OverlayClose` (44 px touch / 40 px mouse); desktop input 56 px / 16 px (was 48 / 15.5).

test("SearchDialog phone: 16 px input, 44 px close, ≥ 56 px rows with tool icon chips, inner scroll", () => {
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
  for (const r of rows) assert.ok(has(r, "min-h-14"), `row «${(r.textContent ?? "").slice(0, 20)}» ≥ 56 px`);
  // Every tool row shows its icon in the tool colour; the file row shows its tool's icon.
  for (const t of TOOLS) {
    const chip = document.querySelector(`[data-search-tool="${t.id}"] > span[aria-hidden]`) as HTMLElement | null;
    assert.ok(chip?.querySelector("svg"), `${t.id}: icon chip`);
    assert.equal(chip!.style.getPropertyValue("--tc"), t.tc, `${t.id}: chip in the tool colour`);
  }
  assert.ok(document.querySelector('[data-search-file="g1"] svg'), "file row icon");
  const list = input.closest(".overflow-hidden")?.querySelector(".overflow-y-auto");
  assert.ok(has(list ?? null, "overscroll-contain") && !has(list ?? null, "max-h-[60vh]"));
  assert.ok(has(input.closest(".overflow-hidden"), "max-h-full"), "card never taller than the frame");
});

test("SearchDialog desktop: 60vh list, 56 px / 16 px input, 12vh offset, 40 px close, no inline frame style", () => {
  signIn();
  useUi.setState({ overlay: "search" });
  render(inRouter(h(SearchDialog)));
  const input = screen.getByPlaceholderText("Qidirish...");
  assert.ok(has(input, "h-14") && has(input, "text-[16px]"));
  assert.ok(has(input.closest(".overflow-hidden")?.querySelector(".overflow-y-auto") ?? null, "max-h-[60vh]"));
  const frame = document.querySelector("[data-overlay-frame]");
  assert.ok(has(frame, "pt-[12vh]"));
  assert.ok(!frame?.getAttribute("style"));
  assert.ok(!document.querySelector(".size-11"));
  const close = screen.getAllByLabelText("Yopish").find((b) => b.querySelector("svg"));
  assert.ok(has(close ?? null, "size-10"), "40 px close with a mouse");
});

test("SearchDialog: «Balansni to'ldirish» opens Hamyon (/uz/wallet, not the /uz/purchase alias)", () => {
  signIn();
  const pushes: string[] = [];
  const spy = { ...router, push: (href: string) => void pushes.push(href) } as unknown as AppRouterInstance;
  useUi.setState({ overlay: "search" });
  render(h(AppRouterContext.Provider, { value: spy }, h(SearchDialog)));
  fireEvent.click(document.querySelector("[data-search-wallet]")!);
  assert.deepEqual(pushes, ["/uz/wallet"]);
  assert.equal(useUi.getState().overlay, null, "the dialog closed");
});

// ------------------------------------------------------------------ notifications
// Redesign W5: there is no 3.5rem top bar any more — the phone panel is a bottom sheet (was: a card
// anchored 3.5rem under the bar); the desktop panel is a centred dialog (was: an `absolute top-14` popover).

test("NotificationsPanel phone: a bottom sheet (grabber, 26 px top corners, slide-up) with a 44 px close, scrolls inside, clears the home indicator", () => {
  phoneMedia(true);
  useUi.setState({ overlay: "notifications" });
  render(h(NotificationsPanel));
  const aside = document.querySelector("aside");
  assert.ok(has(aside, "overflow-y-auto") && has(aside, "max-h-full"));
  assert.ok(!has(aside, "absolute"), "in-flow inside the safe-area frame");
  for (const c of ["rounded-t-[26px]", "slx-sheet-enter", "pb-[var(--sheet-pb,1rem)]"]) assert.ok(has(aside, c), c);
  assert.ok(aside?.querySelector("[data-sheet-grabber]"), "grabber");
  const frame = document.querySelector<HTMLElement>("[data-overlay-frame]");
  assert.ok(frame?.hasAttribute("data-sheet") && has(frame, "items-end"), "docked at the bottom");
  const style = frame?.getAttribute("style") ?? "";
  assert.doesNotMatch(style, /3\.5rem/, "no TopBar offset any more");
  assert.match(style, /--tg-safe-top/, "still below the notch / Telegram header");
  assert.match(style, /--sheet-pb: calc\(var\(--tg-safe-bottom, env\(safe-area-inset-bottom, 0px\)\) \+ 1rem\)/, "home indicator");
  const close = aside?.querySelector('button[aria-label="Yopish"]');
  assert.ok(has(close ?? null, "size-11"));
  assert.ok(has(document.querySelector("[data-overlay-scrim]"), "slx-scrim-enter"), "scrim fades in");
});

test("NotificationsPanel desktop: a centred dialog (no popover offset), 40 px close", () => {
  useUi.setState({ overlay: "notifications" });
  render(h(NotificationsPanel));
  const aside = document.querySelector("aside");
  assert.ok(!has(aside, "absolute") && !has(aside, "top-14"), "no popover anchored to the old top bar");
  assert.ok(has(aside, "max-w-sm") && has(aside, "rounded-[24px]"));
  const frame = document.querySelector("[data-overlay-frame]");
  assert.ok(has(frame, "items-center") && has(frame, "justify-center"), "centred");
  assert.ok(!frame?.getAttribute("style"));
  assert.ok(has(aside?.querySelector('button[aria-label="Yopish"]') ?? null, "size-10"));
  assert.ok(!aside?.querySelector("[data-sheet-grabber]"), "no grabber on a desktop");
});

// ------------------------------------------------------------------ pay
// Redesign W5: amount chips became ≥ 64 px cards (was: 44 px phone / 40 px desktop chips).

test("PayDialog phone: a bottom sheet with ≥ 64 px amount cards, 44 px close and ≥ 48 px methods; scrolls inside", () => {
  phoneMedia(true);
  signIn();
  useUi.setState({ overlay: "pay" });
  render(inRouter(h(PayDialog)));
  const chips = [...document.querySelectorAll("[aria-pressed]")];
  assert.equal(chips.length, 4);
  for (const c of chips) assert.ok(has(c, "min-h-16"), "amount card ≥ 64 px");
  const card = chips[0].closest(".overflow-y-auto");
  assert.ok(card && has(card, "max-h-full"), "internal scroll");
  assert.ok(has(card, "rounded-t-[26px]") && card.querySelector("[data-sheet-grabber]"), "bottom sheet");
  assert.ok(has(card.querySelector('button[aria-label="Yopish"]'), "size-11"));
  // Providers that are not configured are not drawn (no «o'chiq» placeholders): enable both here.
  assert.equal(screen.queryByText(/^Click/), null, "unconfigured: not drawn");
  cleanup();
  useAppStore.setState({
    features: { llm: true, images: true, telegram: false, telegramBot: null, devLogin: false, pdf: true, payments: { click: true, payme: true } } as never,
  });
  render(inRouter(h(PayDialog)));
  for (const m of ["Click", "Karta orqali", "Payme"]) {
    const b = screen.getByText(new RegExp(`^${m}`));
    assert.ok(has(b, "h-12"), `${m} button ≥ 48 px`);
  }
});

test("PayDialog desktop: a centred dialog, same ≥ 64 px amount cards, 40 px close", () => {
  signIn();
  useUi.setState({ overlay: "pay" });
  render(inRouter(h(PayDialog)));
  for (const c of document.querySelectorAll("[aria-pressed]")) assert.ok(has(c, "min-h-16"));
  assert.ok(!document.querySelector(".size-11"));
  assert.ok(!document.querySelector("[data-sheet-grabber]"));
  const frame = document.querySelector("[data-overlay-frame]");
  assert.ok(has(frame, "items-center") && !frame?.getAttribute("style"));
});

// ------------------------------------------------------------------ login

function loginFeatures(over: Record<string, unknown> = {}) {
  useAppStore.setState({
    features: { llm: true, images: true, telegram: true, telegramBot: "slaydx_bot", devLogin: true, pdf: true, payments: { click: false, payme: false }, ...over },
    loggedIn: false,
    user: null,
  } as never);
}

// Redesign W5: primary buttons 48 px (was 44 px), the close is the shared 44 / 40 px `OverlayClose`.
test("LoginModal phone: bottom sheet, 44 px close, card scrolls inside, buttons ≥ 44, dev-phone input is 16 px", async () => {
  phoneMedia(true);
  loginFeatures();
  useUi.setState({ overlay: "login" });
  render(inRouter(h(LoginModal)));
  const card = document.querySelector("[data-overlay-frame] .overflow-y-auto");
  assert.ok(card && has(card, "max-h-full"), "card scrolls inside 360x740");
  assert.ok(has(card, "slx-sheet-enter") && card.querySelector("[data-sheet-grabber]"), "slides up as a sheet");
  assert.ok(has(card.querySelector('button[aria-label="Yopish"]'), "size-11"));
  assert.ok(has(screen.getByText("Telegram orqali kirish"), "h-12"));
  const phoneLink = screen.getByText("Telefon raqami orqali kirish");
  assert.ok(has(phoneLink, "min-h-11"), "text link has a 44 px hit area");
  fireEvent.click(phoneLink);
  const input = document.querySelector<HTMLInputElement>("#login-phone");
  assert.ok(input && has(input, "text-base"), "phone input 16 px (no iOS focus zoom)");
  assert.ok(has(screen.getByText("Orqaga"), "h-11"));
  assert.ok(has(screen.getByText("Kod olish"), "h-12"));
});

test("LoginModal desktop: centred dialog, 40 px close, no inner scroll", () => {
  loginFeatures();
  useUi.setState({ overlay: "login" });
  render(inRouter(h(LoginModal)));
  const card = document.querySelector("[data-overlay-frame] > div:last-child");
  assert.ok(!has(card ?? null, "overflow-y-auto"));
  assert.ok(has(card ?? null, "rounded-[24px]") && has(card ?? null, "max-w-md"));
  assert.ok(has(card?.querySelector('button[aria-label="Yopish"]') ?? null, "size-10"));
  assert.ok(has(screen.getByText("Telegram orqali kirish"), "h-12"));
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

test("phone back closes the «+» sheet first (phone layout, ≥ 44 px tiles inside)", async () => {
  fresh("/uz");
  phoneMedia(true);
  render(inRouter(h(AppShell, null, h("div", null, "sahifa"))));
  fireEvent.click(document.querySelector("[data-create-button]")!);
  await settle();
  const sheet = document.querySelector("[data-create-sheet]");
  assert.ok(sheet);
  assert.ok(has(sheet.querySelector(`[data-create-tool="${TOOLS[0].id}"]`), "min-h-[5.5rem]"));
  assert.ok(sx()?.o, "the sheet owns a history entry");
  await act(async () => {
    window.history.back();
  });
  await settle();
  assert.ok(!document.querySelector("[data-create-sheet]"));
  assert.equal(window.location.pathname, "/uz", "page unchanged");
});
