import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { SlideForm, SLIDE_FIELD_ORDER, SLIDE_INLINE_FIELD_IDS } from "../../components/forms/SlideForm.tsx";
import {
  ProSlideForm,
  PRO_EXTRA_FIELD_ORDER,
  PRO_INLINE_FIELD_IDS,
  PRO_MAIN_FIELD_ORDER_1,
  PRO_MAIN_FIELD_ORDER_2,
} from "../../components/forms/ProSlideForm.tsx";
import { SLIDE_PARAMS, PRO_SLIDE_DEFAULT, PRO_SLIDE_MIN, PRO_SLIDE_MAX, SLIDE_DEFAULT, SLIDE_MIN, SLIDE_MAX } from "../../lib/generation/slide-params.ts";
import { AUDIENCE_RULES } from "../../lib/generation/slide-audience.ts";
import { SLIDE_BLOCKS } from "../../lib/generation/slide-blocks.ts";
import { TOOL_BY_ID, priceFor, formatTanga } from "../../lib/tools.ts";
import type { UserProfile } from "../../lib/types.ts";

/**
 * WP-G — `ProSlideForm`/`SlideForm` SSR paritetlari.
 *
 * `next/navigation`ning `useRouter()` `AppRouterContext`dan o'qiydi
 * (`node_modules/next/dist/client/components/navigation.js`), kontekst
 * bo'lmasa "invariant expected app router to be mounted" bilan qulaydi.
 * Shu sabab ikkala forma ham `AppRouterContext.Provider` bilan
 * o'raladi — `tests/viewer/parity.test.mts` naqshi (`renderToStaticMarkup`,
 * `tsconfig.viewer.json` — `npm run test:viewer`, react-server SHARTISIZ,
 * shuning uchun JSX/`useRouter` bu yerda ishlaydi).
 */

const mockRouter: AppRouterInstance = {
  back() {},
  forward() {},
  refresh() {},
  push() {},
  replace() {},
  prefetch() {},
};

const profile: UserProfile = {
  name: "Aliyev Ali",
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
  author: "Aliyev Ali",
  subject: "",
  teacher: "",
  city: "Toshkent",
  position: "",
  organization: "",
};

function renderWithRouter(el: React.ReactElement): string {
  return renderToStaticMarkup(h(AppRouterContext.Provider, { value: mockRouter }, el));
}

const slideTool = TOOL_BY_ID.slide;
const proTool = TOOL_BY_ID["pro-slide"];

// ───────────────────── reyestr ↔ eksport qilingan massivlar ────────────────

/**
 * `SlideForm.tsx`/`ProSlideForm.tsx` maydon ro'yxatini EKSPORT QILINGAN
 * massivlar orqali chizadi va JSX ularni to'g'ridan-to'g'ri `.map()`
 * bilan aylanadi (`components/forms/ProSlideForm.tsx` boshidagi izoh) —
 * shuning uchun bu massivlarni reyestr bilan solishtirish AYNAN forma
 * nimani render qilishini tekshiradi.
 */
function idsOf(tool: "slide" | "pro-slide"): Set<string> {
  return new Set(SLIDE_PARAMS.filter((p) => p.tools.includes(tool)).map((p) => p.id));
}

test("SlideForm: inline + SLIDE_FIELD_ORDER reyestr bilan AYNAN mos (ikkala yo'nalishda)", () => {
  const registry = idsOf("slide");
  // "extra" registrda bor va `SLIDE_INLINE_FIELD_IDS` da (mavjud
  // textarea naqshi — `renderSlideParam("extra", ...)`) turadi.
  const rendered = new Set([...SLIDE_INLINE_FIELD_IDS, ...SLIDE_FIELD_ORDER]);
  for (const id of registry) assert.ok(rendered.has(id), `reyestrda bor, SlideForm chizmaydi: «${id}»`);
  for (const id of rendered) assert.ok(registry.has(id), `SlideForm chizadi, reyestrda yo'q: «${id}»`);
  assert.equal(rendered.size, registry.size);
});

test("ProSlideForm: inline + 3 ro'yxat reyestr bilan AYNAN mos (ikkala yo'nalishda)", () => {
  const registry = idsOf("pro-slide");
  const rendered = new Set([
    ...PRO_INLINE_FIELD_IDS,
    ...PRO_MAIN_FIELD_ORDER_1,
    ...PRO_MAIN_FIELD_ORDER_2,
    ...PRO_EXTRA_FIELD_ORDER,
  ]);
  for (const id of registry) assert.ok(rendered.has(id), `reyestrda bor, ProSlideForm chizmaydi: «${id}»`);
  for (const id of rendered) assert.ok(registry.has(id), `ProSlideForm chizadi, reyestrda yo'q: «${id}»`);
  assert.equal(rendered.size, registry.size);
});

// ──────────────────────────────── ProSlideForm SSR ──────────────────────────

test("ProSlideForm: 14 auditoriya + «Avtomatik» chip'i ko'rinadi", () => {
  const html = renderWithRouter(h(ProSlideForm, { tool: proTool, profile }));
  const audienceIds = Object.keys(AUDIENCE_RULES);
  assert.equal(audienceIds.length, 14, "AUDIENCE_RULES 14 ta emas — testni yangilang");
  assert.ok(html.includes(">Avtomatik<"), "«Avtomatik» chip'i yo'q");
  for (const id of audienceIds) {
    const label = AUDIENCE_RULES[id as keyof typeof AUDIENCE_RULES].label;
    assert.ok(html.includes(`>${label}<`), `«${label}» auditoriya chip'i yo'q`);
  }
});

test("ProSlideForm: barcha 9 tuzilma bloki chip'i ko'rinadi", () => {
  const html = renderWithRouter(h(ProSlideForm, { tool: proTool, profile }));
  assert.equal(SLIDE_BLOCKS.length, 9, "SLIDE_BLOCKS 9 ta emas — testni yangilang");
  for (const b of SLIDE_BLOCKS) {
    assert.ok(html.includes(`>${b.label}<`), `«${b.label}» blok chip'i yo'q`);
  }
});

test("ProSlideForm: slaydlar soni slayderi (4-30) bor", () => {
  const html = renderWithRouter(h(ProSlideForm, { tool: proTool, profile }));
  assert.ok(html.includes('type="range"'), "slayder (type=range) topilmadi");
  assert.ok(html.includes(`min="${PRO_SLIDE_MIN}"`), "slayder min chegarasi noto'g'ri");
  assert.ok(html.includes(`max="${PRO_SLIDE_MAX}"`), "slayder max chegarasi noto'g'ri");
});

test("ProSlideForm: narx standart slaydlar soniga mos (priceFor bilan bir xil)", () => {
  const html = renderWithRouter(h(ProSlideForm, { tool: proTool, profile }));
  const expected = formatTanga(priceFor(proTool, { slideCount: PRO_SLIDE_DEFAULT }));
  assert.ok(html.includes(expected), `kutilgan narx «${expected}» ko'rinmayapti`);
});

// ────────────────────────────────── SlideForm SSR ───────────────────────────

test("SlideForm: slaydlar soni slayderi (4–30) BOR, paketlar YO'Q, narx qoidasi yozilgan", () => {
  const html = renderWithRouter(h(SlideForm, { tool: slideTool, profile }));
  assert.ok(html.includes('type="range"'), "oddiy slaydda ham slayder (Formalar 2)");
  assert.ok(html.includes(`min="${SLIDE_MIN}"`) && html.includes(`max="${SLIDE_MAX}"`), "slayder chegarasi 4–30");
  assert.ok(html.includes(`value="${SLIDE_DEFAULT}"`), "standart 10 slayd");
  assert.ok(!html.includes("Sifat / hajm") && !html.includes("Premium"), "paketlar olib tashlangan");
  assert.ok(html.includes(`20 tagacha ${formatTanga(3000)}`) && html.includes("+500"), "narx qoidasi ko'rinadi");
  const expected = formatTanga(priceFor(slideTool, { slideCount: SLIDE_DEFAULT }));
  assert.ok(html.includes(expected), `standart narx «${expected}» ko'rinmayapti`);
  assert.ok(!html.includes("Rasm uslubi"), "oddiy slaydda rasm uslubi yo'q — bepul stock faqat foto");
});

test("ikkala forma: Sozlamalar yig'iq (details), muallif kartasi profildan, izohlar tooltip'da", () => {
  for (const [Form, tool] of [[SlideForm, slideTool], [ProSlideForm, proTool]] as const) {
    const html = renderWithRouter(h(Form, { tool, profile }));
    assert.ok(html.includes("<details") && !html.includes("<details open"), `${tool.id}: Sozlamalar yopiq holda`);
    assert.ok(html.includes("data-summary-chips"), `${tool.id}: yopiq sarlavhada joriy tanlovlar`);
    assert.ok(html.includes('value="Aliyev Ali"'), `${tool.id}: muallif profildan to'ldiriladi`);
    assert.ok(html.includes("profilga saqlanadi"), `${tool.id}: saqlanish belgisi`);
    assert.ok(!html.includes("Qoʼshimcha (ixtiyoriy)"), `${tool.id}: eski «Qo'shimcha» tugmasi yo'q`);
  }
  const pro = renderWithRouter(h(ProSlideForm, { tool: proTool, profile }));
  assert.ok(pro.includes("Lavozim"), "pro'da lavozim maydoni");
  const slide = renderWithRouter(h(SlideForm, { tool: slideTool, profile }));
  assert.ok(!slide.includes("Lavozim"), "oddiyda lavozim yo'q (reyestr)");
});

test("SlideForm: 14 auditoriya + «Avtomatik» ham ko'rinadi (SlideForm bilan bitta manba)", () => {
  const html = renderWithRouter(h(SlideForm, { tool: slideTool, profile }));
  assert.ok(html.includes(">Avtomatik<"));
  for (const id of Object.keys(AUDIENCE_RULES)) {
    const label = AUDIENCE_RULES[id as keyof typeof AUDIENCE_RULES].label;
    assert.ok(html.includes(`>${label}<`), `«${label}» auditoriya chip'i SlideForm da yo'q`);
  }
});

test("SlideForm: tuzilma bloklari (blocks) chip'i YO'Q — faqat pro slaydda", () => {
  const html = renderWithRouter(h(SlideForm, { tool: slideTool, profile }));
  // "Tuzilma bloklari" — BlocksField Legend matni.
  assert.ok(!html.includes("Tuzilma bloklari"), "SlideForm da bloklar bo'limi chiqmasligi kerak edi");
});

// ─────────────────────── narx `slideCount` bilan o'zgaradi ──────────────────

test("pro-slide narxi slideCount bilan chiziqli o'zgaradi (priceFor)", () => {
  const min = priceFor(proTool, { slideCount: PRO_SLIDE_MIN });
  const max = priceFor(proTool, { slideCount: PRO_SLIDE_MAX });
  assert.equal(min, PRO_SLIDE_MIN * 2000);
  assert.equal(max, PRO_SLIDE_MAX * 2000);
  assert.notEqual(min, max);
});
