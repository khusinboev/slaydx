import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { WorkComposer } from "../../components/forms/WorkComposer.tsx";
import { ArticleComposer } from "../../components/forms/ArticleComposer.tsx";
import { WORK_PARAMS } from "../../lib/generation/work-params.ts";
import { TOOL_BY_ID, priceFor, formatTanga } from "../../lib/tools.ts";
import { COURSEWORK_PAGES } from "../../lib/generation/work/registry.ts";
import type { UserProfile } from "../../lib/types.ts";

/**
 * Talaba ishlari 2 (AUDIT-19 WP-E2) — forma QAMROVI va vosita DISPATCH
 * predikati. `tests/viewer/article-form.test.mts` naqshi: SSR
 * (`renderToStaticMarkup`), `data-field` qamrovi ikki yo'nalishda.
 *
 * MUHIM (topilma): `ToolWorkspace`ni bevosita SSR bilan sinash mumkin
 * emas — zustand v5 `useSyncExternalStore`ning server snapshot'i
 * `api.getInitialState()` dan o'qiydi (`node_modules/zustand/esm/react.mjs`),
 * ya'ni `useAppStore.setState({sessionChecked:true, ...})` render OLDIDAN
 * chaqirilsa ham, `renderToStaticMarkup` doim BOSHLANG'ICH holatni
 * ko'radi va `ToolWorkspace` «Yuklanmoqda...» qaytaradi. Shu sababli
 * `ToolWorkspace` dispatch qatorining HAQIQIY ishlashi (`custom === "work"`)
 * jsdom orqali `tests/ui/work-composer.test.mts` da (Article bilan bir xil
 * joyda — `article-composer.test.mts` dagi «vosita sahifasi ... dispatch»)
 * tekshiriladi; bu yerda dispatch PREDIKATI (`tool.custom`) va
 * `WorkComposer`/`ArticleComposer` ning o'zi (SSR'da holat kerak emas)
 * tekshiriladi.
 */

const mockRouter: AppRouterInstance = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };

const profile: UserProfile = {
  name: "Aliyev Ali",
  language: "uz",
  points: 0,
  quota: 0,
  balance: 100000,
  premium: false,
  plan: "free",
  university: "Toshkent davlat pedagogika universiteti",
  faculty: "Pedagogika fakulteti",
  department: "Boshlang'ich ta'lim kafedrasi",
  group: "301",
  course: "3",
  author: "Aliyev Ali",
  subject: "Pedagogika",
  teacher: "Rahimov B.",
  city: "Toshkent",
  position: "",
  organization: "",
};

function renderWork(id: "coursework" | "referat" | "mustaqil-ish") {
  return renderToStaticMarkup(h(AppRouterContext.Provider, { value: mockRouter }, h(WorkComposer, { tool: TOOL_BY_ID[id], profile, user: null })));
}

const courseworkHtml = renderWork("coursework");

test("reyestrdagi (WORK_PARAMS) har parametr formada `data-field` bilan chizilgan", () => {
  const missing = WORK_PARAMS.map((p) => p.id).filter((id) => !courseworkHtml.includes(`data-field="${id}"`));
  assert.deepEqual(missing, [], `formada yo'q parametrlar: ${missing.join(", ")}`);
});

test("formada reyestrda YO'Q `data-field` bo'lmaydi (teskari yo'nalish)", () => {
  const known = new Set(WORK_PARAMS.map((p) => p.id));
  const found = [...courseworkHtml.matchAll(/data-field="([a-zA-Z0-9_]+)"/g)].map((m) => m[1]);
  const stray = [...new Set(found)].filter((id) => !known.has(id));
  assert.deepEqual(stray, [], `reyestrda yo'q maydonlar: ${stray.join(", ")}`);
});

test("uchta vosita HAR XIL janr standartini ko'rsatadi (tur/reja/narx)", () => {
  const referatHtml = renderWork("referat");
  const independentHtml = renderWork("mustaqil-ish");
  assert.ok(courseworkHtml.includes("Nazariy kurs ishi"), "kurs ishi — standart tur nazariy");
  assert.ok(referatHtml.includes("Informativ referat"), "referat — standart tur informativ");
  assert.ok(independentHtml.includes("Yozma mustaqil ish"), "mustaqil ish — yagona tur");
  // Narx (kurs ishi 20-25 bet standart → 16 000; referat/mustaqil 10-15 → 3 000).
  assert.match(courseworkHtml, /data-price-total[^>]*>[^<]*16[\s ]?000/);
  assert.match(referatHtml, /data-price-total[^>]*>[^<]*3[\s ]?000/);
  // Hajm — SLAYDER (kurs ishida 7 pog'ona), eski 7 chip emas.
  assert.match(courseworkHtml, new RegExp(`type="range"[^>]*max="${COURSEWORK_PAGES.length - 1}"`), "kurs ishi slayderi 7 pog'ona");
  assert.match(independentHtml, /type="range"[^>]*max="3"/, "mustaqil ish slayderi 4 pog'ona");
});

test("profildan prefill: universitet, muallif, fan nomi", () => {
  assert.ok(courseworkHtml.includes('value="Toshkent davlat pedagogika universiteti"'), "universitet profildan");
  assert.ok(courseworkHtml.includes('value="Aliyev Ali"'), "muallif profildan");
  assert.ok(courseworkHtml.includes('value="Pedagogika"'), "fan nomi profildan (subjectName ← profile.subject)");
});

test("insho/maqola WorkComposer dispatch qilinmaydi (`tool.custom` predikati)", () => {
  assert.notEqual(TOOL_BY_ID.essay.custom, "work", "insho eski standart formada qolishi kerak");
  assert.notEqual(TOOL_BY_ID.article.custom, "work", "maqola ArticleComposer da qolishi kerak");
  assert.equal(TOOL_BY_ID.article.custom, "article");
  for (const id of ["coursework", "referat", "mustaqil-ish"] as const) {
    assert.equal(TOOL_BY_ID[id].custom, "work", `${id} WorkComposer ga dispatch qilinishi kerak`);
  }
  const articleHtml = renderToStaticMarkup(
    h(AppRouterContext.Provider, { value: mockRouter }, h(ArticleComposer, { tool: TOOL_BY_ID.article, profile, user: null })),
  );
  assert.ok(!articleHtml.includes('data-field="workKind"'), "ArticleComposer WorkComposer maydonini chizmaydi");
});


/* ───────────── FORMALAR 3 (AUDIT-24 WP-A) — SSR tuzilmasi ───────────── */

test("SSR da ▸ Sozlamalar YOPIQ keladi va titulning qolgan maydonlari faqat uning ichida", () => {
  // `<details ... open>` bo'lmasligi (mutatsiya: `open` qo'shilsa qizaradi).
  assert.ok(!/<details[^>]*data-settings[^>]*\sopen/.test(courseworkHtml), "Sozlamalar yopiq chiqadi");
  const cut = courseworkHtml.indexOf("<details");
  assert.ok(cut > 0, "yig'iq blok bor");
  const main = courseworkHtml.slice(0, cut);
  const settings = courseworkHtml.slice(cut);
  for (const id of ["topic", "workKind", "subjectProfile", "subjectName", "pages", "language", "university", "author"]) {
    assert.ok(main.includes(`data-field="${id}"`), `${id} asosiy oqimda`);
  }
  for (const id of ["faculty", "department", "group", "course", "teacher", "teacherDegree", "city", "ministry", "ministryCustom", "tocMethod", "tocText", "userFacts", "userRefs", "refsMin", "extra", "sourceText"]) {
    assert.ok(!main.includes(`data-field="${id}"`), `${id} asosiy oqimda turmaydi`);
    assert.ok(settings.includes(`data-field="${id}"`), `${id} ▸ Sozlamalar ichida`);
  }
});

test("hajm slayderi yonidagi narx `priceFor` dan (uch vosita) — formada hisob yo'q", () => {
  for (const id of ["coursework", "referat", "mustaqil-ish"] as const) {
    const html = renderWork(id);
    const want = formatTanga(priceFor(TOOL_BY_ID[id], { pages: id === "coursework" ? "20-25" : "10-15" }));
    const shown = /data-price="true"[^>]*>([^<]*)</.exec(html)?.[1]?.trim();
    assert.equal(shown, want, `${id}: slayder narxi priceFor natijasi`);
    assert.ok(html.split(want).length - 1 >= 2, `${id}: sticky narx ham AYNAN shu matn`);
  }
});

test("matn maydonlari limit bilan: `maxLength` va hisoblagich (server endi jim kesmaydi)", () => {
  assert.match(courseworkHtml, /maxlength="12000"/i, "natijalarim — WORK_LIMITS.userFactsChars");
  assert.match(courseworkHtml, /maxlength="1500"/i, "qo'shimcha — WORK_LIMITS.extraChars");
  assert.match(courseworkHtml, /maxlength="4000"/i, "reja matni — WORK_LIMITS.tocChars");
  assert.ok(courseworkHtml.includes("data-counter"), "belgi hisoblagichi chizilgan");
  assert.match(courseworkHtml, /type="number"[^>]*min="0"[^>]*max="40"/, "refsMin chegarasi HTML atributida");
});
