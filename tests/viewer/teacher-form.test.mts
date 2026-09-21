import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { TeacherComposer } from "../../components/forms/TeacherComposer.tsx";
import { WorkComposer } from "../../components/forms/WorkComposer.tsx";
import { teacherParamsOf } from "../../lib/generation/teacher-params.ts";
import { teacherKindOf } from "../../lib/generation/teacher/registry.ts";
import { TOOL_BY_ID } from "../../lib/tools.ts";
import type { UserProfile } from "../../lib/types.ts";

/**
 * O'qituvchi vositalari 2 (AUDIT-20 WP-E) — `TeacherComposer` forma
 * QAMROVI va vosita DISPATCH predikati (`tests/viewer/work-form.test.mts`
 * naqshi, SSR — `renderToStaticMarkup`).
 *
 * Haqiqiy interaktiv xatti-harakat (tur almashish, rejim tilalari,
 * CurriculumPicker, submit) `tests/ui/teacher-composer.test.mts` da
 * (jsdom) — bu yerda faqat: har kind mount qilinganda o'z reyestr
 * maydonlari (`teacherParamsOf(kind)`) `data-field` bilan chizilganmi,
 * va `ToolWorkspace` dispatch qatorining PREDIKATI (`tool.custom`)
 * to'g'rimi.
 */

const TEACHER_TOOL_IDS = ["lesson-plan", "texnologik-xarita", "glossary", "keys", "test"] as const;

const mockRouter: AppRouterInstance = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };

const profile: UserProfile = {
  name: "Karimova Dilnoza",
  language: "uz",
  points: 0,
  quota: 0,
  balance: 100000,
  premium: false,
  plan: "free",
  university: "15-son umumiy o'rta ta'lim maktabi",
  faculty: "",
  department: "",
  group: "",
  course: "",
  author: "Karimova Dilnoza",
  subject: "Biologiya",
  teacher: "",
  city: "Toshkent",
  position: "",
  organization: "",
};

function renderTeacher(id: (typeof TEACHER_TOOL_IDS)[number]) {
  return renderToStaticMarkup(h(AppRouterContext.Provider, { value: mockRouter }, h(TeacherComposer, { tool: TOOL_BY_ID[id], profile, user: null })));
}

test("har vosita mount qilinganda o'z reyestr (teacherParamsOf) maydonlari data-field bilan chizilgan", () => {
  for (const id of TEACHER_TOOL_IDS) {
    const kind = teacherKindOf(id);
    assert.ok(kind, `${id}: kind topilmadi`);
    const html = renderTeacher(id);
    const missing = teacherParamsOf(kind!)
      .map((p) => p.id)
      /*
       * `approver` TEST vositasida standart tur (`nazorat`) da ataylab
       * chizilmaydi — dvigatel (`teacher/test/input.ts`) uni faqat
       * `bsb`/`chsb` da saqlaydi (AUDIT-24 WP-B). Tur tanlash
       * interaktiv, shuning uchun u `tests/ui/teacher-composer.test.mts`
       * da (ikki yo'nalishda) tekshiriladi.
       */
      .filter((fid) => !(id === "test" && fid === "approver"))
      .filter((fid) => !html.includes(`data-field="${fid}"`));
    assert.deepEqual(missing, [], `${id}: formada yo'q parametrlar: ${missing.join(", ")}`);
  }
});

test("SSR: «Sozlamalar» YOPIQ keladi va ochiq <details> qolmagan (eski «Shapka» open edi)", () => {
  for (const id of TEACHER_TOOL_IDS) {
    const html = renderTeacher(id);
    assert.ok(html.includes('data-settings="settings"'), `${id}: yig'iq Sozlamalar bo'limi yo'q`);
    assert.ok(!/<details[^>]*\sopen/.test(html), `${id}: SSR da ochiq <details> bo'lmasligi kerak`);
    assert.ok(html.includes("Shapka"), `${id}: «Shapka» kartasi bo'lishi kerak`);
  }
});

test("SSR: `approver` faqat dars rejasi/xaritada, test standart turida yo'q", () => {
  assert.ok(renderTeacher("lesson-plan").includes('data-field="approver"'), "dars rejasi: «Tasdiqlayman» bor");
  assert.ok(renderTeacher("texnologik-xarita").includes('data-field="approver"'), "xarita: «Tasdiqlayman» bor");
  assert.ok(!renderTeacher("test").includes('data-field="approver"'), "test/nazorat: chizilmaydi");
  assert.ok(!renderTeacher("glossary").includes('data-field="approver"'), "glossariy: reyestrda yo'q");
});

test("SSR: sana brauzerning `type=date` maydoni emas (o'zbekcha kun/oy/yil)", () => {
  const html = renderTeacher("lesson-plan");
  assert.ok(!html.includes('type="date"'), "mm/dd/yyyy maydoni ishlatilmaydi");
  assert.ok(html.includes("Sana — oy"), "oy tanlagichi bor");
});

test("5 ta vosita render bo'ladi va standart turini ko'rsatadi", () => {
  assert.ok(renderTeacher("lesson-plan").includes("Yangi mavzu darsi"), "dars rejasi standart tur");
  assert.ok(renderTeacher("texnologik-xarita").includes("Yillik taqvim-mavzu reja"), "xarita standart tur");
  // React SSR `'` ni `&#x27;` deb chiqaradi.
  assert.ok(renderTeacher("glossary").includes("Fan lug"), "glossariy standart tur");
  assert.ok(renderTeacher("keys").includes("Muammoli keys"), "keys standart tur");
  assert.ok(renderTeacher("test").includes("Joriy nazorat ishi"), "test standart tur");
});

test("narx: glossariy termCount standart 10 -> 6 000, boshqa vositalar tekis narx", () => {
  assert.match(renderTeacher("glossary"), /data-price-total[^>]*>[^<]*6[\s ]?000/);
  assert.match(renderTeacher("lesson-plan"), /data-price-total[^>]*>[^<]*4[\s ]?000/);
  assert.match(renderTeacher("test"), /data-price-total[^>]*>[^<]*3[\s ]?000/);
});

test("profildan prefill: muassasa, tuzuvchi, fan nomi", () => {
  const html = renderTeacher("lesson-plan");
  assert.ok(html.includes("15-son umumiy"), "muassasa profildan");
  assert.ok(html.includes(profile.author), "tuzuvchi profildan");
  assert.ok(html.includes(profile.subject), "fan nomi profildan");
});

test("boshqa vositalar (masalan kurs ishi) TeacherComposer maydonini chizmaydi (`tool.custom` predikati)", () => {
  assert.equal(TOOL_BY_ID.coursework.custom, "work", "kurs ishi TeacherComposer ga dispatch qilinmasligi kerak");
  for (const id of TEACHER_TOOL_IDS) assert.equal(TOOL_BY_ID[id].custom, "teacher", `${id}: TeacherComposer ga dispatch qilinishi kerak`);
  const workHtml = renderToStaticMarkup(h(AppRouterContext.Provider, { value: mockRouter }, h(WorkComposer, { tool: TOOL_BY_ID.coursework, profile, user: null })));
  assert.ok(!workHtml.includes('data-field="lessonType"'), "WorkComposer TeacherComposer maydonini chizmaydi");
});
