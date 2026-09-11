import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { ArticleComposer } from "../../components/forms/ArticleComposer.tsx";
import { ARTICLE_PARAMS } from "../../lib/generation/article-params.ts";
import { TOOL_BY_ID, formatTanga } from "../../lib/tools.ts";
import type { UserProfile } from "../../lib/types.ts";

/**
 * Maqola formasi QAMROVI (Maqola 2, WP6) — «bezak maydon yo'q» qoidasining
 * forma tomoni: `tests/viewer/resume-form.test.mts` naqshi.
 *
 * Reyestrda (`article-params.ts`) e'lon qilingan HAR parametr formada
 * `data-field` bilan chizilgan bo'lishi SHART, va formada reyestrda YO'Q
 * `data-field` bo'lmasligi kerak (ikki yo'nalishli qamrov).
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
  organization: "TDIU",
};

const tool = TOOL_BY_ID.article;
const html = renderToStaticMarkup(
  h(AppRouterContext.Provider, { value: mockRouter }, h(ArticleComposer, { tool, profile, user: null })),
);

test("reyestrdagi har parametr formada `data-field` bilan chizilgan", () => {
  const missing = ARTICLE_PARAMS.map((p) => p.id).filter((id) => !html.includes(`data-field="${id}"`));
  assert.deepEqual(missing, [], `formada yo'q parametrlar: ${missing.join(", ")}`);
});

test("formada reyestrda YO'Q `data-field` bo'lmaydi (teskari yo'nalish)", () => {
  const known = new Set(ARTICLE_PARAMS.map((p) => p.id));
  const found = [...html.matchAll(/data-field="([a-zA-Z0-9_]+)"/g)].map((m) => m[1]);
  const stray = [...new Set(found)].filter((id) => !known.has(id));
  assert.deepEqual(stray, [], `reyestrda yo'q maydonlar: ${stray.join(", ")}`);
});

test("standart holat: tur imrad_oak, profil oak, narx 6 000 (3-5 bet), til uz", () => {
  assert.ok(html.includes("OAK jurnali (IMRAD"), "standart tur — OAK jurnali");
  assert.ok(html.includes(">OAK jurnali<") || html.includes("OAK jurnali</span>"), "standart profil — OAK jurnali");
  assert.match(html, /data-price-total[^>]*>[^<]*6[\s  ]?000/, `narx 6 000 kutilgan edi: ${html.match(/data-price-total[^>]*>[^<]*/)?.[0]}`);
  assert.ok(html.includes(formatTanga(6000).replace(/ /g, "")) || /6[\s  ]000/.test(html));
});

test("mualliflar birinchi qatori profildan prefill (ism, tashkilot)", () => {
  assert.ok(html.includes('value="Karimova Dilnoza"'), "muallif ismi profildan");
  assert.ok(html.includes('value="TDIU"'), "tashkilot profildan");
});

// `renderToStaticMarkup` apostrofni HTML entity qilib chiqaradi (matn ichida ham).
const esc = (s: string) => s.replace(/'/g, "&#x27;");

test("mavzu misollari (topicExamples) chiplar sifatida ko'rinadi", () => {
  for (const ex of tool.topicExamples ?? []) {
    assert.ok(html.includes(esc(ex)), `mavzu misoli yo'q: ${ex}`);
  }
});

test("hajm chiplarida narx ko'rinadi (ARTICLE_PRICES)", () => {
  assert.ok(html.includes("3–5 bet"), "3-5 bet chipi");
  assert.ok(html.includes("5–10 bet"), "5-10 bet chipi");
  assert.ok(html.includes("10–15 bet"), "10-15 bet chipi");
});

test("annotatsiya izohi doim 3 tilda ko'rsatiladi", () => {
  assert.ok(html.includes("uz + ru + en"), "3 tilli annotatsiya izohi");
});
