import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { cleanup, render } from "@testing-library/react";
import { ToolChrome } from "../../components/forms/ToolChrome.tsx";
import { BalanceChip } from "../../components/shell/BalanceChip.tsx";
import { useAppStore } from "../../lib/store.ts";
import type * as api from "../../lib/api-client.ts";

/**
 * UX-03 — «Balans yetarli emas» o'lik matn emas: yonida to'ldirish havolasi;
 * balans narxdan kam bo'lsa yuborishdan oldin ham aytiladi; balans ilova
 * sarlavhasida ko'rinadi. Redesign F0: TopBar olib tashlandi — balans chipi
 * (`BalanceChip`, Bosh sarlavhasi) Hamyonga olib boradi, Hamyon esa pastki
 * panelda har sahifada (`tests/ui/tab-bar.test.mts`).
 */

afterEach(() => cleanup());

const user = (balance: number) =>
  ({
    id: "u1", telegramId: null, username: null, name: "Ali", photoUrl: null, language: "uz", points: 200, quota: 0,
    balance, university: "", faculty: "", department: "", group: "",
    course: "", author: "", subject: "", teacher: "", city: "", position: "", organization: "", phone: null, isAdmin: false,
  }) as unknown as api.ServerUser;

function chrome(props: { price?: number; error?: string | null }) {
  render(h(ToolChrome, { title: "Slayd", submitLabel: "Yaratish", onSubmit: () => {}, children: h("div"), ...props }));
}

const topUp = () => document.querySelector<HTMLAnchorElement>("[data-topup]");

// Redesign W5: the link goes to the Hamyon tab itself (was `/uz/purchase`, now only a redirect alias).
test("UX-03: 402 xatosi yonida «Balansni to'ldirish» → /uz/wallet", () => {
  useAppStore.setState({ loggedIn: true, user: user(10_000) }); // store balansi eskirgan (hali ko'p) — server matni baribir tanilsin
  chrome({ price: 4000, error: "Balans yetarli emas. Kerak: 4 000 tanga, mavjud: 1 200." });
  const a = topUp();
  assert.ok(a, "to'ldirish havolasi bor");
  assert.equal(a.getAttribute("href"), "/uz/wallet");
  assert.ok(a.closest("[role=alert]"), "havola xato matni yonida");
});

test("UX-03: balans narxdan kam — yuborishdan OLDIN aytiladi (balans + havola)", () => {
  useAppStore.setState({ loggedIn: true, user: user(1000) });
  chrome({ price: 3000 });
  const note = document.querySelector("[data-balance-short]");
  assert.ok(note);
  assert.match(note.textContent ?? "", /1[\s .,]?200 tanga/);
  assert.ok(topUp());
});

test("UX-03: balans yetarli va boshqa xato — havola yo'q (bezak emas)", () => {
  useAppStore.setState({ loggedIn: true, user: user(10_000) });
  chrome({ price: 3000, error: "Mavzu juda qisqa" });
  assert.ok(!topUp());
  assert.ok(!document.querySelector("[data-balance-short]"));
});

test("UX-03: BalanceChip — kirgan foydalanuvchi balansi sarlavhada, bosilsa Hamyon (to'ldirish)", () => {
  useAppStore.setState({ loggedIn: true, user: user(4800) });
  render(h(BalanceChip));
  const chip = document.querySelector<HTMLAnchorElement>("[data-balance]");
  assert.ok(chip);
  assert.equal(chip.getAttribute("href"), "/uz/wallet");
  assert.match(chip.textContent ?? "", /5[\s .,]?000/, "points + quota + balance");
  assert.match(chip.getAttribute("aria-label") ?? "", /^Balans: 5\D?000 tanga\. Hamyon$/);
  cleanup();
  useAppStore.setState({ loggedIn: false, user: null });
  render(h(BalanceChip));
  assert.ok(!document.querySelector("[data-balance]"), "kirmagan — balans yo'q");
});
