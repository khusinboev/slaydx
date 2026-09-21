import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { InfographicComposer } from "../../components/forms/InfographicComposer.tsx";
import { INFOGRAPHIC_PARAMS } from "../../lib/generation/infographic-params.ts";
import { TOOL_BY_ID } from "../../lib/tools.ts";

/**
 * Infografika formasi (Formalar 3 / AUDIT-24, WP-D2b) — forma QAMROVI
 * (SSR) va vosita DISPATCH predikati. `tests/viewer/media-form.test.mts`
 * naqshi.
 */

const mockRouter: AppRouterInstance = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };

const html = renderToStaticMarkup(h(AppRouterContext.Provider, { value: mockRouter }, h(InfographicComposer, { tool: TOOL_BY_ID.infographic })));

test("Sozlamalar YOPIQ holatda render qilinadi (SSR, `<details>` open atributisiz)", () => {
  const m = /<details[^>]*data-settings="settings"[^>]*>/.exec(html);
  assert.ok(m, "<details data-settings> topilmadi");
  assert.doesNotMatch(m![0], /\bopen\b/);
});

test("reyestrdagi (INFOGRAPHIC_PARAMS) har parametr formada `data-field` bilan chizilgan (ikki yo'nalish)", () => {
  const known = new Set(INFOGRAPHIC_PARAMS.map((p) => p.id));
  const missing = [...known].filter((id) => !html.includes(`data-field="${id}"`));
  assert.deepEqual(missing, [], `formada yo'q parametrlar: ${missing.join(", ")}`);
  const found = [...html.matchAll(/data-field="([a-zA-Z0-9_]+)"/g)].map((m) => m[1]);
  const stray = [...new Set(found)].filter((id) => !known.has(id));
  assert.deepEqual(stray, [], `reyestrda yo'q maydonlar: ${stray.join(", ")}`);
});

test("standart tur «Ro'yxat» (`list`) va narx 2 000 SSR'da ko'rinadi", () => {
  assert.ok(html.includes('value="list"'), "standart tur select'da tanlangan");
  assert.match(html, /data-price-total[^>]*>[^<]*2[\s ]?000/);
});

test("`ToolWorkspace` dispatch predikati: infografika `custom: infographic`, boshqa vositalar emas", () => {
  assert.equal(TOOL_BY_ID.infographic.custom, "infographic");
  assert.notEqual(TOOL_BY_ID.podcast.custom, "infographic");
  assert.notEqual(TOOL_BY_ID["lesson-plan"].custom, "infographic");
});
