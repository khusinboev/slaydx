import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext, SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";

/**
 * N1 — consumer shell and pages on the back-navigation engine
 * (docs/nav/PLAN.md «Contract for N1–N4»).
 *
 * Mutations, each caught here:
 *   - CreateSheet (successor of the drawer, redesign F0): `useDialog(…, { history: false })`
 *                                                              → "«+» sheet closes on back" fails;
 *   - HomeFiles: drop `useOverlayHistory(overlay === "sort"…)` → "sort popover closes on back" fails;
 *   - HomeFiles: `changeView` stops calling `replaceSearch`    → "filter lands in the URL" fails;
 *   - `writeFileView` writes defaults                          → "defaults stay out of the URL" fails;
 *   - PayDialog: `window.location.href = checkoutUrl` again    → "pay dialog entry is popped" fails;
 *   - ToolChrome: back to a fixed `<Link href="/uz/create">`   → "ToolChrome ←" fails (deep link pushes);
 *   - PurchasePage: no strip of `?order=`                      → "?order= is stripped" fails.
 */

const nav = await import("../../lib/nav/history.ts");
const { AppShell } = await import("../../components/shell/AppShell.tsx");
const { HomeFiles } = await import("../../components/home/HomeFiles.tsx");
const { PayDialog } = await import("../../components/overlays/PayDialog.tsx");
const { ToolChrome } = await import("../../components/forms/ToolChrome.tsx");
const { PurchasePage } = await import("../../components/purchase/PurchasePage.tsx");
const { PageBack } = await import("../../components/shell/PageBack.tsx");
const { NavProvider: NavProviderEl } = await import("../../components/nav/NavProvider.tsx");
const { useUi, readFileView, writeFileView, DEFAULT_FILE_VIEW } = await import("../../lib/ui.ts");
const { useAppStore } = await import("../../lib/store.ts");

const calls: string[] = [];
const tree = (href: string) => ["", { children: [href] }];
const router = {
  push(href: string) {
    calls.push(`push ${href}`);
    window.history.pushState({ __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: tree(href) }, "", href);
  },
  replace(href: string) {
    calls.push(`replace ${href}`);
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
const here = () => window.location.pathname + window.location.search;
const realFetch = globalThis.fetch;

async function settle() {
  await act(async () => {
    for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 2));
  });
}

/** A fresh tab at `path`: engine reset, one unstamped entry. */
function fresh(path = "/uz") {
  nav.__resetNavForTests();
  window.history.pushState(null, "", path);
  window.sessionStorage.clear();
  nav.installNav();
  nav.setNavRouter(router);
  calls.length = 0;
}

afterEach(async () => {
  cleanup();
  await settle();
  nav.__resetNavForTests();
  useUi.setState({ overlay: null, returnTo: null });
  globalThis.fetch = realFetch;
});

const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

function inRouter(node: React.ReactElement, search = window.location.search, pathname = window.location.pathname) {
  return h(
    AppRouterContext.Provider,
    { value: router },
    h(
      PathnameContext.Provider,
      { value: pathname },
      h(SearchParamsContext.Provider, { value: new URLSearchParams(search) }, node),
    ),
  );
}

// ------------------------------------------------------------------ pure view helpers

test("fayl ko'rinishi: standart qiymatlar URLga chiqmaydi, buzuq qiymat standartga tushadi, boshqa parametrlar saqlanadi", () => {
  const base = new URLSearchParams("returnTo=%2Fuz%2Fcreate");
  assert.equal(writeFileView(base, DEFAULT_FILE_VIEW).toString(), "returnTo=%2Fuz%2Fcreate");
  const q = writeFileView(new URLSearchParams("filter=slide&sort=name&desc=0"), { filter: "docs", sort: "modified", desc: true });
  assert.equal(q.toString(), "filter=docs");
  assert.equal(writeFileView(base, { filter: "tests", sort: "created", desc: false }).get("desc"), "0");
  assert.deepEqual(readFileView(new URLSearchParams("filter=zzz&sort=!!&desc=x")), DEFAULT_FILE_VIEW);
  assert.deepEqual(readFileView(new URLSearchParams("filter=games&sort=name&desc=0")), {
    filter: "games",
    sort: "name",
    desc: false,
  });
  assert.deepEqual(readFileView(null), DEFAULT_FILE_VIEW);
});

// ------------------------------------------------------------------ AppShell «+» sheet (was: drawer)

const sheetOpen = () => Boolean(document.querySelector("[data-create-sheet]"));
const plus = () => document.querySelector<HTMLButtonElement>("[data-create-button]")!;

test("AppShell: «+» oynasi — telefon «orqaga»si uni yopadi, URL o'zgarmaydi", async () => {
  fresh("/uz");
  render(inRouter(h(AppShell, null, h("div", null, "sahifa"))));
  assert.ok(!sheetOpen(), "boshida yopiq");
  fireEvent.click(plus());
  await settle();
  assert.ok(sheetOpen(), "ochildi");
  assert.ok(sx()?.o, "oyna tarix yozuviga ega");
  assert.equal(here(), "/uz");
  await act(async () => {
    window.history.back();
  });
  await settle();
  assert.ok(!sheetOpen(), "orqaga oynani yopdi");
  assert.equal(here(), "/uz");
  assert.equal(sx()?.i, 0);
  assert.ok(!sx()?.o);
});

test("AppShell: yo'l o'zgarsa ochiq «+» oynasi yopiladi (yangi sahifa ustida qolmaydi)", async () => {
  fresh("/uz");
  // NavProvider (mounted in Providers in the app) closes an overlay left open from the previous page.
  const page = () => h("div", null, h(NavProviderEl), h(AppShell, null, h("div", null, "sahifa")));
  const view = render(inRouter(page(), "", "/uz"));
  fireEvent.click(plus());
  await settle();
  assert.ok(sheetOpen());
  window.dispatchEvent(new window.Event("pointerdown"));
  await act(async () => {
    router.push("/uz/create");
  });
  view.rerender(inRouter(page(), "", "/uz/create"));
  await settle();
  assert.ok(!sheetOpen(), "yo'l o'zgardi — oyna yopildi");
});

test("AppShell: fon bosilganda «+» oynasi yopiladi va yozuvi bir marta olib tashlanadi", async () => {
  fresh("/uz");
  render(inRouter(h(AppShell, null, h("div", null, "sahifa"))));
  fireEvent.click(plus());
  await settle();
  const i = sx()?.i;
  fireEvent.click(document.querySelector("[data-create-scrim]")!);
  await settle();
  assert.ok(!sheetOpen());
  assert.equal(sx()?.i, (i ?? 1) - 1, "bitta yozuv qaytdi");
});

// ------------------------------------------------------------------ HomeFiles

function mountHome(search = "") {
  window.history.replaceState(window.history.state, "", `/uz${search}`);
  useAppStore.setState({ sessionChecked: true, loggedIn: true, generations: [], generationsLoaded: true, generationsCursor: null });
  return render(inRouter(h(HomeFiles), search));
}

test("HomeFiles: filtr/tartib URLga yoziladi (replace — tarixda yangi yozuv yo'q), standartga qaytsa URL toza", async () => {
  fresh("/uz");
  mountHome();
  const len = window.history.length;
  const i = sx()?.i;
  fireEvent.click(screen.getByRole("button", { name: "Hujjatlar" }));
  assert.equal(here(), "/uz?filter=docs");
  fireEvent.click(screen.getByRole("button", { name: /^Hammasi/ }));
  assert.equal(here(), "/uz", "standart qiymatlar URLda qolmaydi");
  assert.equal(window.history.length, len, "chiplar tarixga yozuv qo'shmaydi");
  assert.equal(sx()?.i, i);
  // Redesign W2: the direction lives in the header sort menu («Yangisi / Eskisi birinchi»).
  fireEvent.click(screen.getByRole("button", { name: "Hujjatlar" }));
  const pickInMenu = async (name: string) => {
    fireEvent.click(document.querySelector("[data-sort-button]") as HTMLElement);
    await settle();
    fireEvent.click(screen.getByRole("menuitemradio", { name }));
    await settle();
  };
  await pickInMenu("Eskisi birinchi");
  assert.equal(here(), "/uz?filter=docs&desc=0");
  fireEvent.click(screen.getByRole("button", { name: /^Hammasi/ }));
  await pickInMenu("Yangisi birinchi");
  assert.equal(here(), "/uz", "standart qiymatlar URLda qolmaydi");
  assert.equal(sx()?.i, i, "menyu yozuvi yopilgach indeks joyida — filtr/tartib yozuv qo'shmadi");
  assert.ok(!sx()?.o);
});

test("HomeFiles: URLdagi filtr bilan ochilganda tanlangan (orqaga qaytish — qayta o'rnatish)", async () => {
  fresh("/uz");
  mountHome("?filter=image&sort=name");
  assert.equal(screen.getByRole("button", { name: "Rasmlar" }).getAttribute("aria-pressed"), "true");
  assert.equal(screen.getByRole("button", { name: /^Hammasi/ }).getAttribute("aria-pressed"), "false");
  assert.ok(screen.getByRole("button", { name: "Saralash: Nomi" }), "tartib yorlig'i URLdan");
});

test("HomeFiles: saralash oynasi telefon «orqaga»si bilan yopiladi; tanlov filtrni saqlaydi", async () => {
  fresh("/uz");
  mountHome();
  const sortBtn = () => document.querySelector("[data-sort-button]") as HTMLElement;
  fireEvent.click(sortBtn());
  await settle();
  assert.equal(useUi.getState().overlay, "sort");
  assert.ok(sx()?.o, "oyna tarix yozuviga ega");
  await act(async () => {
    window.history.back();
  });
  await settle();
  assert.equal(useUi.getState().overlay, null, "orqaga oynani yopdi");
  assert.equal(here(), "/uz");

  // Oynada tanlash: URL yangilanadi, oyna yopiladi, yozuv bir marta olib tashlanadi.
  fireEvent.click(sortBtn());
  await settle();
  fireEvent.click(screen.getByRole("menuitemradio", { name: "Nomi" }));
  await settle();
  assert.equal(useUi.getState().overlay, null);
  assert.equal(here(), "/uz?sort=name", "tanlov oyna yozuvi yopilgach ham URLda");
  assert.ok(!sx()?.o);
});

test("HomeFiles: ?returnTo= kirish oynasini ochadi va URLdan olib tashlanadi (yangilash qayta ochmaydi)", async () => {
  fresh("/uz");
  useAppStore.setState({ sessionChecked: true, loggedIn: false, generations: [], generationsLoaded: true, generationsCursor: null });
  window.history.replaceState(window.history.state, "", "/uz?returnTo=%2Fuz%2Fcreate&filter=docs");
  render(inRouter(h(HomeFiles), window.location.search));
  await settle();
  assert.equal(useUi.getState().overlay, "login");
  assert.equal(useUi.getState().returnTo, "/uz/create");
  assert.equal(here(), "/uz?filter=docs", "returnTo ketdi, filtr qoldi");
});

test("HomeFiles: allaqachon kirgan foydalanuvchida eskirgan ?returnTo= jimgina olib tashlanadi", async () => {
  fresh("/uz");
  window.history.replaceState(window.history.state, "", "/uz?returnTo=%2Fuz%2Fcreate");
  useAppStore.setState({ sessionChecked: true, loggedIn: true, generations: [], generationsLoaded: true, generationsCursor: null });
  render(inRouter(h(HomeFiles), window.location.search));
  await settle();
  assert.equal(useUi.getState().overlay, null);
  assert.equal(here(), "/uz");
});

// ------------------------------------------------------------------ PayDialog

test("PayDialog: provayderga ketishdan oldin dialog tarix yozuvi olib tashlanadi", async () => {
  fresh("/uz/purchase");
  useAppStore.setState({
    loggedIn: true,
    features: { llm: true, images: true, telegram: false, telegramBot: null, devLogin: false, pdf: true, payments: { click: true, payme: false } },
  });
  // Bir xil hujjat ichidagi hash o'tishi jsdomda amalga oshadi (tashqi sayt — yo'q).
  const checkout = `${window.location.origin}/uz/purchase#provayder`;
  (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown) =>
    String(input) === "/api/payments/orders" ? json(200, { checkoutUrl: checkout, orderId: "o1" }) : json(404, {});
  render(inRouter(h(PayDialog)));
  await act(async () => {
    useUi.getState().open("pay");
  });
  await settle();
  assert.ok(sx()?.o, "dialog yozuvi turibdi");
  fireEvent.click(screen.getByText("Click"));
  await settle();
  await settle();
  assert.equal(window.location.hash, "#provayder", "provayder sahifasiga o'tildi");
  // Dialog yozuvi pop qilingan: provayderdan qaytganda o'lik (dialogsiz) yozuv qolmaydi.
  window.history.back();
  await settle();
  assert.ok(!sx()?.o, `orqaga dialog yozuviga emas, sahifaga tushadi: ${JSON.stringify(sx())}`);
  assert.equal(window.location.hash, "");
});

// ------------------------------------------------------------------ BackLinks

test("ToolChrome ←: yangi yorliqdagi chuqur havola /uz/create ga ALMASHTIRADI (saytdan chiqmaydi, push yo'q)", async () => {
  fresh("/uz/slide");
  render(
    inRouter(
      h(ToolChrome, { title: "Slayd", submitLabel: "Yaratish", onSubmit() {}, children: h("div", null, "forma") }),
    ),
  );
  const back = screen.getByLabelText("Orqaga") as HTMLAnchorElement;
  assert.equal(back.getAttribute("href"), "/uz/create");
  fireEvent.click(back);
  await settle();
  assert.deepEqual(calls, ["replace /uz/create"]);
  assert.equal(here(), "/uz/create");
  assert.equal(sx()?.i, 0, "yangi yozuv qo'shilmadi (ping-pong yo'q)");
});

test("ToolChrome ←: ilova ichidan kelgan bo'lsa — haqiqiy orqaga (tarixda ortiqcha yozuv yo'q)", async () => {
  fresh("/uz/create");
  router.push("/uz/slide");
  calls.length = 0;
  render(
    inRouter(h(ToolChrome, { title: "Slayd", submitLabel: "Yaratish", onSubmit() {}, children: h("div", null, "forma") })),
  );
  fireEvent.click(screen.getByLabelText("Orqaga"));
  await settle();
  assert.equal(here(), "/uz/create");
  assert.ok(!calls.some((c) => c.startsWith("push")), calls.join(","));
  assert.equal(sx()?.i, 0);
});

test("PageBack (/uz/create, /uz/purchase, /uz/profile): yangi yorliqda /uz ga almashtiradi", async () => {
  for (const path of ["/uz/create", "/uz/purchase", "/uz/profile"]) {
    fresh(path);
    const { unmount } = render(inRouter(h(PageBack)));
    const a = document.querySelector("[data-page-back]") as HTMLAnchorElement;
    assert.equal(a.getAttribute("href"), "/uz", path);
    fireEvent.click(a);
    await settle();
    assert.equal(here(), "/uz", path);
    assert.deepEqual(calls, ["replace /uz"], path);
    unmount();
  }
});

// ------------------------------------------------------------------ PurchasePage ?order=

test("PurchasePage: hal bo'lgan buyurtmada ?order= URLdan olib tashlanadi, banner qoladi", async () => {
  fresh("/uz/purchase");
  window.history.replaceState(window.history.state, "", "/uz/purchase?order=o1");
  Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
  useAppStore.setState({ sessionChecked: true, loggedIn: true, refreshSession: async () => {} });
  (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown) =>
    String(input) === "/api/payments/orders"
      ? json(200, {
          orders: [{ id: "o1", provider: "click", purpose: "topup", amountSoum: 10_000, state: "paid", createdAt: "2026-09-24T08:00:00.000Z" }],
          providers: { click: true, payme: false },
        })
      : json(404, {});
  const len = window.history.length;
  render(inRouter(h(PurchasePage), "order=o1"));
  // Birinchi so'rov 3 s dan keyin (`PAY_POLL_START_MS`): haqiqiy taymer bilan kutamiz.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 3300));
  });
  await settle();
  assert.equal(here(), "/uz/purchase", "?order= ketdi");
  assert.equal(window.history.length, len, "yangi yozuv yo'q");
  assert.ok(screen.getByText(/To.lov qabul qilindi/), "banner yo'qolmadi");
});
