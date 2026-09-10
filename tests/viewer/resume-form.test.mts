import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { ResumeComposer } from "../../components/forms/ResumeComposer.tsx";
import { RESUME_PARAMS } from "../../lib/generation/resume-params.ts";
import { TOOL_BY_ID, formatTanga } from "../../lib/tools.ts";
import { SOURCE_LANGUAGES } from "../../lib/languages.ts";
import type { UserProfile } from "../../lib/types.ts";

/**
 * Rezyume formasi QAMROVI (Rezyume 2) — «bezak maydon yo'q» qoidasining
 * forma tomoni.
 *
 * Reyestrda (`resume-params.ts`) e'lon qilingan HAR parametr formada
 * `data-field` bilan chizilgan bo'lishi shart. Aks holda parametr
 * dvigatelda ishlaydi, lekin foydalanuvchi unga tegolmaydi — yoki
 * teskarisi: forma yuboradi, reyestr bilmaydi va differensial zond uni
 * sinamaydi.
 */

const mockRouter: AppRouterInstance = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };

const profile: UserProfile = {
  name: "Karimova Dilnoza",
  language: "uz",
  points: 0,
  quota: 0,
  balance: 100000,
  premium: false,
  plan: "free",
  university: "",
  faculty: "",
  department: "",
  group: "",
  course: "",
  author: "Karimova Dilnoza",
  subject: "",
  teacher: "",
  city: "Toshkent",
  position: "",
  organization: "",
};

const tool = TOOL_BY_ID.resume;
const html = renderToStaticMarkup(
  h(AppRouterContext.Provider, { value: mockRouter }, h(ResumeComposer, { tool, profile })),
);

test("reyestrdagi har parametr formada `data-field` bilan chizilgan", () => {
  const missing = RESUME_PARAMS.map((p) => p.id).filter((id) => !html.includes(`data-field="${id}"`));
  assert.deepEqual(missing, [], `formada yo'q parametrlar: ${missing.join(", ")}`);
});

test("formada reyestrda YO'Q `data-field` bo'lmaydi (teskari yo'nalish)", () => {
  const known = new Set(RESUME_PARAMS.map((p) => p.id));
  const found = [...html.matchAll(/data-field="([a-zA-Z0-9_]+)"/g)].map((m) => m[1]);
  const stray = [...new Set(found)].filter((id) => !known.has(id));
  assert.deepEqual(stray, [], `reyestrda yo'q maydonlar: ${stray.join(", ")}`);
});

/** `toLocaleString("ru-RU")` uzilmas bo'shliq qo'yadi — solishtirishdan oldin oddiy bo'shliqqa. */
const plain = (s: string) => s.replace(/[\u00a0\u202f]/g, " ");

test("narx qat'iy 3 000 tanga — hammasi ichida", () => {
  const chip = plain(/data-price-total[^>]*>([^<]*)</.exec(html)?.[1] ?? "");
  assert.match(chip, /3 000/, `submit chipi: «${chip}»`);
  assert.ok(html.includes("hammasi kiritilgan"), "narx izohi ko'rinadi");
  assert.equal(tool.basePrice, 3000);
  assert.ok(plain(html).includes(plain(formatTanga(3000))), "chipda to'liq yozuv");
});

test("profil qiymatlari oldindan to'ldiriladi (ism, shahar)", () => {
  assert.ok(html.includes('value="Karimova Dilnoza"'), "muallif ismi profildan");
  assert.ok(html.includes('value="Toshkent"'), "shahar profildan");
});

test("chiqish tili ro'yxati — tarjimondagi 18 til", () => {
  const options = [...html.matchAll(/<option value="([a-z]{2,3})"/g)].map((m) => m[1]);
  for (const l of SOURCE_LANGUAGES) {
    assert.ok(options.includes(l.value), `til yo'q: ${l.value}`);
  }
  // Standart holat — o'zbekcha.
  assert.match(html, /<select[^>]*aria-label="Chiqish tili"[^>]*>/);
});

test("tuzilmali bloklar: tajriba ro'yxati bor, sertifikat/til standart holatda yopiq", () => {
  assert.ok(html.includes('data-rowlist="experience"'), "tajriba ro'yxati");
  assert.ok(html.includes('data-rowlist="education"'), "ta'lim standart holatda ochiq");
  assert.ok(!html.includes('data-rowlist="certificates"'), "sertifikat yopiq — tumbler bilan ochiladi");
  assert.ok(!html.includes('data-rowlist="languages"'), "tillar yopiq");
  for (const f of ["education", "certificates", "languages"]) {
    assert.ok(html.includes(`data-toggle="${f}"`), `tumbler yo'q: ${f}`);
  }
});
