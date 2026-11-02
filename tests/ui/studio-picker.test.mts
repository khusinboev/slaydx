import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h, useState } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { ClientEntry } from "../../lib/studio-core/index.ts";
import { GPT, NANO, PRICING, catalogBody, expectedPrice, installApi, json } from "./studio-fixtures.ts";

const nav = await import("../../lib/nav/history.ts");
const { MediaModelPicker, rowModels, ROW_CARDS } = await import("../../components/studio/MediaModelPicker.tsx");
const { dropMediaCatalog } = await import("../../components/studio/studio-api.ts");
const { groupDigits } = await import("../../lib/format.ts");

/**
 * MediaModelPicker (`purpose="studio.image"`): the model row, the «Barcha modellar» sheet, the filter chips.
 *
 * Locked here:
 *   - the row: cards in a group, the chosen one `aria-pressed`, the price of ONE picture on every card (= the
 *     formula, whatever the picture count is); at most 3 cards, the chosen model always among them;
 *   - the sheet lists ALL models; chips «Hammasi / Tez / Sifatli / Arzon / Matnli dizayn» are drawn ONLY for a badge some
 *     model carries; a chip narrows the list; «Tanlash» applies the highlighted model, closing any other way keeps the
 *     previous choice;
 *   - the sheet is an overlay with its own history entry: the phone's back button (and the Telegram BackButton, which
 *     triggers the same history back) closes it and leaves the page where it is;
 *   - embeddable: without a `catalog` prop it loads its own purpose (skeleton → cards; error → «Qayta urinish»); the
 *     host can control `open` (the «Boshqa modelda» button opens it).
 *
 * Mutations (each turned the named tests red, then restored):
 *   chips drawn for every FILTER_BADGES entry (no `models.some` check)    -> «the sheet lists ALL models; chips only…», «the real catalog's two models…»;
 *   chip filter ignored (`shown = models`)                                -> «the sheet lists ALL models; … a chip narrows»;
 *   «Tanlash» does not call `onPick`                                      -> «Tanlash applies…»;
 *   Escape / back (the `useDialog` close) also applies the draft          -> «Tanlash applies… closing any other way…» (the Escape branch);
 *   `useDialog(true, onClose, { history: false })`                        -> «back closes the sheet»;
 *   `rowModels` drops the chosen model when it is beyond the 3rd          -> «the row shows at most 3…», «Tanlash applies…»;
 *   cards show the price of the whole `values` (count included)           -> «the row: … price of ONE picture»;
 *   `useMediaCatalog(purpose, true)` ignoring `catalog`                   -> «a host that already holds the catalog does not make a second request».
 */

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
const realFetch = globalThis.fetch;

function fresh(path = "/uz/studio") {
  nav.__resetNavForTests();
  window.history.pushState(null, "", path);
  window.sessionStorage.clear();
  nav.installNav();
  nav.setNavRouter(router);
}
afterEach(async () => {
  cleanup();
  await settle();
  nav.__resetNavForTests();
  globalThis.fetch = realFetch;
  dropMediaCatalog();
});

const q = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel);
const qa = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];
async function settle() {
  await act(async () => {
    for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 2));
  });
}
const click = async (el: Element | null | undefined) => {
  assert.ok(el, "element to click");
  await act(async () => void fireEvent.click(el));
};

/** A model with chosen badges (the catalog's own badge set differs per model). */
const model = (id: string, label: string, badges: ClientEntry["badges"], base: ClientEntry = NANO): ClientEntry => ({ ...base, id, label, badges, maker: "Maker" });
const FIVE = [
  model("a/one", "Bir", ["tez"]),
  model("a/two", "Ikki", ["sifatli"]),
  model("a/three", "Uch", ["arzon"]),
  model("a/four", "To'rt", ["matn"]),
  model("a/five", "Besh", ["tez", "arzon"]),
];

function Host({ models, start, values = {}, open, onOpenChange, onChange }: { models: ClientEntry[]; start: string; values?: Record<string, unknown>; open?: boolean; onOpenChange?: (o: boolean) => void; onChange?: (id: string) => void }) {
  const [value, setValue] = useState(start);
  return h(MediaModelPicker, {
    purpose: "studio.image",
    catalog: catalogBody(models, PRICING, models[0]!.id),
    value,
    values,
    open,
    onOpenChange,
    onChange: (id: string) => {
      setValue(id);
      onChange?.(id);
    },
  });
}
const mount = (props: Parameters<typeof Host>[0]) => render(h(AppRouterContext.Provider, { value: router }, h(Host, props)));
const cards = () => qa("[data-model-card]").map((e) => e.getAttribute("data-model-card"));
const chips = () => qa("[data-model-chip]").map((e) => e.getAttribute("data-model-chip"));
const options = () => qa("[data-model-option]").map((e) => e.getAttribute("data-model-option"));
const chosen = () => qa("[data-model-card]").find((e) => e.getAttribute("aria-pressed") === "true")?.getAttribute("data-model-card");
const open = () => click(q("[data-model-all]"));

test("the row: toggle cards in a group, the chosen one pressed, a click chooses; price of ONE picture on every card (the formula)", async () => {
  fresh();
  mount({ models: [NANO, GPT], start: NANO.id, values: { imageCount: 4, imageRatio: "16:9" } });
  const group = q('[data-model-row][role="group"]');
  assert.ok(group);
  assert.deepEqual(cards(), [NANO.id, GPT.id]);
  assert.equal(chosen(), NANO.id);
  for (const m of [NANO, GPT]) {
    const price = q(`[data-model-card="${m.id}"] [data-model-price]`)!.textContent;
    assert.equal(price, `~${groupDigits(expectedPrice(m, 1))} so'm / rasm`, `${m.id}: MUTATSIYA: butun values (soni 4) narxi chiqsa qizaradi`);
  }
  assert.match(q(`[data-model-card="${NANO.id}"]`)!.textContent ?? "", /Tez, Arzon/, "the badges as words");
  await click(q(`[data-model-card="${GPT.id}"]`));
  assert.equal(chosen(), GPT.id);
  assert.ok(!q("[data-model-sheet]"), "the sheet is closed");
});

test("the row shows at most 3 cards and the chosen model is always among them", () => {
  assert.equal(ROW_CARDS, 3);
  assert.deepEqual(rowModels(FIVE, "a/two").map((m) => m.id), ["a/one", "a/two", "a/three"]);
  assert.deepEqual(rowModels(FIVE, "a/five").map((m) => m.id), ["a/one", "a/two", "a/five"], "MUTATSIYA: tanlangan model 3-dan keyin tushib qolsa qizaradi");
  assert.deepEqual(rowModels([NANO], NANO.id).map((m) => m.id), [NANO.id]);
  assert.deepEqual(rowModels(FIVE, "gone").map((m) => m.id), ["a/one", "a/two", "a/three"], "an unknown choice adds nothing");
});

test("the sheet lists ALL models; chips only for a badge some model carries; a chip narrows the list", async () => {
  fresh();
  mount({ models: FIVE, start: "a/one" });
  assert.equal(cards().length, 3);
  await open();
  assert.ok(q("[data-model-sheet]"));
  assert.deepEqual(options(), FIVE.map((m) => m.id), "all five");
  assert.deepEqual(chips(), ["all", "tez", "sifatli", "arzon", "matn"]);
  await click(q('[data-model-chip="arzon"]'));
  assert.deepEqual(options(), ["a/three", "a/five"], "MUTATSIYA: filtr e'tiborsiz bo'lsa qizaradi");
  assert.equal(q('[data-model-chip="arzon"]')!.getAttribute("aria-pressed"), "true");
  await click(q('[data-model-chip="all"]'));
  assert.equal(options().length, 5);
  cleanup();
  fresh();
  // Two models without «arzon» / «matn»: those chips would lead to an empty list and are not drawn.
  mount({ models: [model("b/one", "Bir", ["tez"]), model("b/two", "Ikki", ["sifatli"])], start: "b/one" });
  await open();
  assert.deepEqual(chips(), ["all", "tez", "sifatli"], "MUTATSIYA: har bir chip chizilsa qizaradi");
});

test("the real catalog's two models give all four chips (Nano: tez, arzon · GPT: sifatli, matn)", async () => {
  fresh();
  mount({ models: [NANO, GPT], start: NANO.id });
  await open();
  assert.deepEqual(chips(), ["all", "tez", "sifatli", "arzon", "matn"]);
  assert.deepEqual(qa("[data-model-chip]").map((e) => e.textContent), ["Hammasi", "Tez", "Sifatli", "Arzon", "Matnli dizayn"]);
  await click(q('[data-model-chip="matn"]'));
  assert.deepEqual(options(), [GPT.id]);
});

test("«Tanlash» applies the highlighted model; closing any other way keeps the previous choice", async () => {
  fresh();
  mount({ models: FIVE, start: "a/one" });
  await open();
  await click(q('[data-model-option="a/four"]'));
  assert.equal(q('[data-model-option="a/four"]')!.getAttribute("aria-pressed"), "true");
  assert.equal(chosen(), "a/one", "highlighting alone changes nothing");
  await click(q("[data-model-confirm]"));
  assert.ok(!q("[data-model-sheet]"), "closed");
  assert.equal(chosen(), "a/four", "MUTATSIYA: Tanlash onPick chaqirmasa qizaradi");

  for (const how of ["close", "scrim", "escape"] as const) {
    await open();
    await click(q('[data-model-option="a/two"]'));
    if (how === "close") await click(q('[data-overlay-header] button[aria-label="Yopish"]'));
    else if (how === "scrim") await click(q("[data-overlay-scrim]"));
    else await act(async () => void fireEvent.keyDown(window, { key: "Escape" }));
    await settle();
    assert.ok(!q("[data-model-sheet]"), `${how}: closed`);
    assert.equal(chosen(), "a/four", `${how}: MUTATSIYA: yopish qoralamani qo'llasa qizaradi`);
  }
});

test("back closes the sheet (its own history entry) and leaves the page where it is", async () => {
  fresh("/uz/studio");
  mount({ models: [NANO, GPT], start: NANO.id });
  const sx = () => (window.history.state as { sx?: { i: number; o?: string } } | null)?.sx;
  await open();
  assert.ok(q("[data-model-sheet]"));
  assert.ok(sx()?.o, "the sheet owns a history entry");
  await act(async () => {
    window.history.back();
  });
  await settle();
  assert.ok(!q("[data-model-sheet]"), "MUTATSIYA: history:false bo'lsa orqaga sheet'ni yopmaydi — qizaradi");
  assert.equal(window.location.pathname, "/uz/studio");
  assert.ok(!sx()?.o);
  // Closing by the button pops the entry exactly once.
  await open();
  await click(q('[data-overlay-header] button[aria-label="Yopish"]'));
  await settle();
  assert.ok(!sx()?.o, "the entry is popped");
  assert.equal(window.location.pathname, "/uz/studio");
});

test("controlled: the host opens the sheet (open) and hears the close (onOpenChange)", async () => {
  fresh();
  const seen: boolean[] = [];
  const { rerender } = mount({ models: [NANO, GPT], start: NANO.id, open: false, onOpenChange: (o) => void seen.push(o) });
  assert.ok(!q("[data-model-sheet]"));
  rerender(h(AppRouterContext.Provider, { value: router }, h(Host, { models: [NANO, GPT], start: NANO.id, open: true, onOpenChange: (o: boolean) => void seen.push(o) })));
  await settle();
  assert.ok(q("[data-model-sheet]"), "opened by the host");
  await click(q('[data-overlay-header] button[aria-label="Yopish"]'));
  assert.deepEqual(seen, [false], "the host is told");
});

test("embeddable: without a catalog prop it loads its purpose (skeleton → cards); an error offers «Qayta urinish»", async () => {
  fresh();
  let fail = true;
  const api = installApi({ catalog: () => (fail ? json(500, {}) : json(200, catalogBody([NANO, GPT]))) });
  render(
    h(
      AppRouterContext.Provider,
      { value: router },
      h(MediaModelPicker, { purpose: "studio.image", value: NANO.id, values: {}, onChange: () => {} }),
    ),
  );
  assert.ok(q("[data-model-loading]"), "skeleton first");
  await settle();
  assert.ok(q("[data-model-error]"), "error state");
  fail = false;
  await click(q("[data-model-error] button"));
  await settle();
  assert.deepEqual(cards(), [NANO.id, GPT.id]);
  assert.deepEqual(api.catalogCalls().map((c) => c.url), ["/api/media/catalog?purpose=studio.image", "/api/media/catalog?purpose=studio.image"]);
});

test("a host that already holds the catalog does not make a second request", async () => {
  fresh();
  const api = installApi();
  mount({ models: [NANO, GPT], start: NANO.id });
  await settle();
  assert.equal(api.catalogCalls().length, 0, "MUTATSIYA: enabled=false hisobga olinmasa qizaradi");
});
