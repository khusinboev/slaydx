import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { render, fireEvent, screen, cleanup, act, within } from "@testing-library/react";
import { ArticleTypeTile } from "../../components/forms/ArticleTypeGallery.tsx";
import { PublicationProfileTile } from "../../components/forms/PublicationProfileDialog.tsx";
import { ARTICLE_TYPE_IDS, PUBLICATION_PROFILE_IDS } from "../../lib/generation/article/types.ts";
import { ARTICLE_TYPES } from "../../lib/generation/article/types-registry.ts";
import { PUBLICATION_PROFILES } from "../../lib/generation/article/profiles.ts";

/**
 * Maqola turi va nashr profili galereyalari (Maqola 2, WP6) — interaktiv
 * xatti-harakat: `ResumeTemplateDialog` testi naqshi.
 */
afterEach(() => cleanup());

test("maqola turi: 12 karta, imrad_oak birinchi va «⭐ tavsiya» belgisi bilan", async () => {
  render(h(ArticleTypeTile, { value: "imrad_oak", language: "uz", onChange: () => {} }));
  await act(async () => {
    fireEvent.click(screen.getByText("OAK jurnali (IMRAD + Xulosa)"));
  });
  const dialog = screen.getByRole("dialog", { name: "Maqola turi" });
  const cards = within(dialog).getAllByRole("button");
  assert.equal(cards.length, ARTICLE_TYPE_IDS.length);
  assert.equal(ARTICLE_TYPE_IDS[0], "imrad_oak");
  assert.equal(cards[0].getAttribute("data-type-card"), "imrad_oak");
  assert.match(cards[0].textContent ?? "", /⭐ tavsiya/, "birinchi karta tavsiya belgisi bilan");
  for (const id of ARTICLE_TYPE_IDS.slice(1)) {
    assert.ok(dialog.querySelector(`[data-type-card="${id}"]`), `karta yo'q: ${id}`);
  }
});

test("maqola turi kartasida skelet bo'limlari ko'rinadi (tanlangan tilda)", async () => {
  render(h(ArticleTypeTile, { value: "imrad_oak", language: "uz", onChange: () => {} }));
  await act(async () => {
    fireEvent.click(screen.getByText("OAK jurnali (IMRAD + Xulosa)"));
  });
  const dialog = screen.getByRole("dialog", { name: "Maqola turi" });
  const card = dialog.querySelector('[data-type-card="imrad_oak"]') as HTMLElement;
  // `imrad_oak` skeleti: Kirish, Adabiyotlar tahlili va metodlar, Natijalar, Muhokama, Xulosa.
  for (const label of ["Kirish", "Adabiyotlar tahlili va metodlar", "Natijalar", "Muhokama", "Xulosa"]) {
    assert.ok(card.textContent?.includes(label), `bo'lim yo'q: ${label}`);
  }
});

test("maqola turi: karta bosilganda onPick chaqiriladi va dialog yopiladi", async () => {
  let picked: string | null = null;
  render(h(ArticleTypeTile, { value: "imrad_oak", language: "uz", onChange: (id: string) => (picked = id) }));
  await act(async () => {
    fireEvent.click(screen.getByText("OAK jurnali (IMRAD + Xulosa)"));
  });
  const dialog = screen.getByRole("dialog", { name: "Maqola turi" });
  const card = dialog.querySelector('[data-type-card="review_systematic"]') as HTMLElement;
  await act(async () => {
    fireEvent.click(card);
  });
  assert.equal(picked, "review_systematic");
  assert.ok(!screen.queryByRole("dialog", { name: "Maqola turi" }), "dialog tanlovdan keyin yopiladi");
});

test("nashr profili: 5 karta, har birida iqtibos namunasi ko'rinadi", async () => {
  render(h(PublicationProfileTile, { value: "oak", onChange: () => {} }));
  await act(async () => {
    fireEvent.click(screen.getByText("O‘zgartirish"));
  });
  const dialog = screen.getByRole("dialog", { name: "Nashr profili" });
  assert.equal(PUBLICATION_PROFILE_IDS.length, 5);
  for (const id of PUBLICATION_PROFILE_IDS) {
    const card = dialog.querySelector(`[data-profile-card="${id}"]`);
    assert.ok(card, `profil kartasi yo'q: ${id}`);
  }
  // GOST → «[1; 25-b.]», APA 7 → «(Karimov, 2023)», IEEE/raqamli → «[1]».
  assert.ok(dialog.querySelector('[data-profile-card="oak"]')?.textContent?.includes("[1; 25-b.]"));
  assert.ok(dialog.querySelector('[data-profile-card="apa"]')?.textContent?.includes("(Karimov, 2023)"));
  assert.ok(dialog.querySelector('[data-profile-card="ieee"]')?.textContent?.includes("[1]"));
});

test("nashr profili: karta bosilganda onPick chaqiriladi va dialog yopiladi", async () => {
  let picked: string | null = null;
  render(h(PublicationProfileTile, { value: "oak", onChange: (id: string) => (picked = id) }));
  await act(async () => {
    fireEvent.click(screen.getByText("O‘zgartirish"));
  });
  const dialog = screen.getByRole("dialog", { name: "Nashr profili" });
  const card = dialog.querySelector('[data-profile-card="apa"]') as HTMLElement;
  await act(async () => {
    fireEvent.click(card);
  });
  assert.equal(picked, "apa");
  assert.ok(!screen.queryByRole("dialog", { name: "Nashr profili" }), "dialog tanlovdan keyin yopiladi");
});

test("reyestr bilan mos: 12 tur va 5 profil aynan shu tartibda", () => {
  assert.equal(Object.keys(ARTICLE_TYPES).length, 12);
  assert.equal(Object.keys(PUBLICATION_PROFILES).length, 5);
  assert.deepEqual(ARTICLE_TYPE_IDS.slice().sort(), Object.keys(ARTICLE_TYPES).sort());
});
