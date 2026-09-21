import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { MediaComposer } from "../../components/forms/MediaComposer.tsx";
import { audioParamsOf } from "../../lib/generation/audio-params.ts";
import { TOOL_BY_ID } from "../../lib/tools.ts";

/**
 * Media formasi (Formalar 3 / AUDIT-24, WP-D2a) — forma QAMROVI (SSR
 * holati bo'yicha) va vosita DISPATCH predikati. `tests/viewer/work-form.test.mts`
 * naqshi (`renderToStaticMarkup`, `ToolWorkspace` emas — zustand v5
 * server snapshot cheklovi shu yerda ham amal qiladi).
 *
 * SSR holatida podkast `mode` standart «topic», shuning uchun `sourceText`
 * DOM'da yo'q — bu QAMROV testida hisobga olingan (jsdom testi uch
 * rejimni ham sinaydi, `tests/ui/media-composer.test.mts`).
 */

const mockRouter: AppRouterInstance = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };

function renderMedia(id: "podcast" | "greeting") {
  return renderToStaticMarkup(h(AppRouterContext.Provider, { value: mockRouter }, h(MediaComposer, { tool: TOOL_BY_ID[id] })));
}

const podcastHtml = renderMedia("podcast");
const greetingHtml = renderMedia("greeting");

function detailsTag(html: string): string {
  const m = /<details[^>]*data-settings="settings"[^>]*>/.exec(html);
  assert.ok(m, "<details data-settings> topilmadi");
  return m![0];
}

test("Sozlamalar YOPIQ holatda render qilinadi (SSR)", () => {
  assert.doesNotMatch(detailsTag(podcastHtml), /\bopen\b/, "podkast: <details> open atributisiz");
  assert.doesNotMatch(detailsTag(greetingHtml), /\bopen\b/, "tabriknoma: <details> open atributisiz");
});

test("podkast (standart mode=topic): reyestrdagi ko'rinadigan maydonlar `data-field` bilan", () => {
  const visible = audioParamsOf("podcast").filter((p) => p.id !== "sourceText");
  const missing = visible.map((p) => p.id).filter((id) => !podcastHtml.includes(`data-field="${id}"`));
  assert.deepEqual(missing, [], `formada yo'q parametrlar: ${missing.join(", ")}`);
  assert.ok(!podcastHtml.includes('data-field="sourceText"'), "topic rejimida manba matni chizilmaydi");
});

test("tabriknoma: reyestrdagi HAR maydon `data-field` bilan, teskari yo'nalish ham toza", () => {
  const known = new Set(audioParamsOf("greeting").map((p) => p.id));
  const missing = [...known].filter((id) => !greetingHtml.includes(`data-field="${id}"`));
  assert.deepEqual(missing, []);
  const found = [...greetingHtml.matchAll(/data-field="([a-zA-Z0-9_]+)"/g)].map((m) => m[1]);
  const stray = [...new Set(found)].filter((id) => !known.has(id));
  assert.deepEqual(stray, [], `reyestrda yo'q maydonlar: ${stray.join(", ")}`);
});

test("narx 4 000 — ikkala vosita ham (`data-price-total`)", () => {
  assert.match(podcastHtml, /data-price-total[^>]*>[^<]*4[\s ]?000/);
  assert.match(greetingHtml, /data-price-total[^>]*>[^<]*4[\s ]?000/);
});

test("`ToolWorkspace` dispatch predikati: podkast/tabriknoma `custom: media`, boshqa vositalar emas", () => {
  assert.equal(TOOL_BY_ID.podcast.custom, "media");
  assert.equal(TOOL_BY_ID.greeting.custom, "media");
  assert.notEqual(TOOL_BY_ID.infographic.custom, "media");
  assert.notEqual(TOOL_BY_ID.essay.custom, "media");
});
