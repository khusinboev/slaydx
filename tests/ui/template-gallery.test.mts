import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { render, fireEvent, screen, cleanup, within } from "@testing-library/react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { SlideForm } from "../../components/forms/SlideForm.tsx";
import { SLIDE_TEMPLATES, SLIDE_TEMPLATE_BY_ID } from "../../lib/generation/slide-templates.ts";
import { getSlideTheme } from "../../lib/generation/slide-themes.ts";
import { TOOL_BY_ID } from "../../lib/tools.ts";
import type { UserProfile } from "../../lib/types.ts";

/**
 * Shablon galereyasi (Shablonlar 2): har karta HAQIQIY slayd renderi
 * (`data-src` li matnlar bor), shablon tanlanganda uning standart
 * palitrasi rangga tushadi, swatch o'zgarsa preview'lar shu rangda.
 */
afterEach(() => cleanup());

const router: AppRouterInstance = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };
const profile: UserProfile = {
  name: "A", language: "uz", points: 0, quota: 0, balance: 0, premium: false, plan: "free",
  university: "", faculty: "", department: "", group: "", course: "", author: "A", subject: "", teacher: "", city: "Toshkent", position: "", organization: "",
};
function mount() {
  render(h(AppRouterContext.Provider, { value: router }, h(SlideForm, { tool: TOOL_BY_ID.slide, profile })));
}
const gallery = () => screen.getByRole("radiogroup", { name: "Shablon" });
const card = (name: string) => within(gallery()).getByRole("radio", { name });
const themeGroup = () => screen.getByRole("radiogroup", { name: "Rang" });
const mainBg = (el: HTMLElement) => (el.querySelector('[data-thumb="main"] > span > div') as HTMLElement).style.background;
// jsdom `style.background` ni `rgb(r, g, b)` shaklida beradi — hex bilan solishtirish uchun.
const rgb = (hex: string) => {
  const n = hex.replace("#", "");
  return `rgb(${parseInt(n.slice(0, 2), 16)}, ${parseInt(n.slice(2, 4), 16)}, ${parseInt(n.slice(4, 6), 16)})`;
};

test("galereya: 11 karta (auto + 10), har biri haqiqiy slayd — titul matni `data-src` bilan, 3 eskiz", () => {
  mount();
  const cards = within(gallery()).getAllByRole("radio");
  assert.equal(cards.length, SLIDE_TEMPLATES.length);
  for (const c of cards) {
    assert.ok(c.querySelector('[data-thumb="main"] [data-src=\'{"f":"title"}\']'), `${c.getAttribute("aria-label")}: titul haqiqiy render emas`);
    assert.equal(c.querySelectorAll('[data-thumb="small"]').length, 3, "uchta eskiz");
  }
  assert.equal(card("Avtomatik").getAttribute("aria-checked"), "true", "standart — Avtomatik");
});

test("shablon tanlash → slideTemplate va uning standart palitrasi; swatch → hamma preview shu rangda", () => {
  mount();
  fireEvent.click(card("Dars / trening"));
  assert.equal(card("Dars / trening").getAttribute("aria-checked"), "true");
  const lumen = getSlideTheme(SLIDE_TEMPLATE_BY_ID.lesson.defaultTheme);
  // MUTATSIYA: `onTheme(tpl.defaultTheme)` olib tashlansa — rang «atlas» da qoladi.
  assert.equal(within(themeGroup()).getByRole("radio", { name: lumen.nameUz }).getAttribute("aria-checked"), "true", "shablonning palitrasi tanlandi");
  const before = mainBg(card("Ma’ruza"));
  const chalk = getSlideTheme("chalk");
  fireEvent.click(within(themeGroup()).getByRole("radio", { name: chalk.nameUz }));
  const after = mainBg(card("Ma’ruza"));
  assert.notEqual(after, before, "rang o'zgarsa preview qayta chiziladi");
  assert.ok(after === rgb(chalk.titleBg) || after === rgb(chalk.bg), `preview chalk rangida: ${after} (kutilgan ${rgb(chalk.bg)} yoki ${rgb(chalk.titleBg)})`);
});
