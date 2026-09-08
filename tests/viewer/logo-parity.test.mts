import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
import { SlideCanvas } from "../../components/viewers/SlideCanvas.tsx";
import { planSlide } from "../../lib/generation/slide-layout.ts";
import { getSlideTheme } from "../../lib/generation/slide-themes.ts";
import { SLIDE_LAYOUTS, type SlideModel } from "../../lib/generation/slide-types.ts";

/**
 * Logotip — «ko'rdim = oldim» ning yangi bandi.
 *
 * Maket bitta (`planSlide` ikkala rendererga xizmat qiladi), lekin
 * `fit` maydonini ular BOSHQA nom bilan talqin qiladi: PPTX da
 * `sizing.type`, ko'ruvchida CSS `object-fit`. Ular ajralib ketsa
 * logotip faylda «contain», ekranda esa cho'zilgan «cover» bo'lib
 * ko'rinadi — aynan shu nuqta uchun test.
 */

const theme = getSlideTheme("atlas");
const LOGO = "data:image/png;base64,iVBORw0KGgo=";

const slide: SlideModel = {
  id: "s",
  layout: "bullets",
  title: "Suv aylanishining bosqichlari",
  bullets: ["Bug‘lanish quyosh energiyasi bilan.", "Kondensatsiya yuqori qatlamda."],
};

test("ko'ruvchi logotipni contain bilan chizadi (PPTX sizing bilan bir xil)", () => {
  const plan = planSlide(slide, theme, "classic", 1, 10, "auto", "lecture", { logo: LOGO });
  const layer = plan.layers.find((l) => l.t === "image" && l.url === LOGO);
  assert.ok(layer && layer.t === "image", "maketda logotip qatlami yo'q");
  assert.equal(layer.fit, "contain", "logotip cho'zilmasligi kerak");

  const html = renderToStaticMarkup(
    h(SlideCanvas, { slide, theme, visual: "classic", index: 1, total: 10, logo: LOGO }),
  );
  assert.ok(html.includes(LOGO), "ko'ruvchi logotipni umuman chizmadi");
  /*
   * `object-fit:contain` AYNAN logotip elementida bo'lsin. Rasmli
   * slaydlarda `cover` ham uchraydi, shuning uchun logotip `src` idan
   * keyingi bo'lakni kesib olamiz.
   */
  const tail = html.slice(html.indexOf(LOGO), html.indexOf(LOGO) + 400);
  assert.match(tail, /object-fit:\s*contain/, `logotip elementida contain yo'q: ${tail.slice(0, 160)}`);
});

test("logotipsiz ko'ruvchi hech narsa qo'shmaydi (ikkala rendererda ham)", () => {
  const plan = planSlide(slide, theme, "classic", 1, 10, "auto", "lecture", {});
  assert.equal(plan.layers.some((l) => l.t === "image" && l.url === LOGO), false);
  const html = renderToStaticMarkup(
    h(SlideCanvas, { slide, theme, visual: "classic", index: 1, total: 10 }),
  );
  assert.equal(html.includes(LOGO), false);
});

test("har layoutda ko'ruvchi ham logotipni chizadi — PPTX bilan qatlam soni teng", () => {
  for (const layout of SLIDE_LAYOUTS) {
    const s: SlideModel = { ...slide, layout, stats: [{ value: "97%", label: "Okean" }], quote: "Suv — hayot." };
    const plan = planSlide(s, theme, "classic", 1, 10, "auto", "lecture", { logo: LOGO });
    const inPlan = plan.layers.filter((l) => l.t === "image" && l.url === LOGO).length;
    assert.equal(inPlan, 1, `${layout}: maketda logotip ${inPlan} marta`);
    const html = renderToStaticMarkup(
      h(SlideCanvas, { slide: s, theme, visual: "classic", index: 1, total: 10, logo: LOGO }),
    );
    assert.equal(html.split(LOGO).length - 1 >= 1, true, `${layout}: ko'ruvchida logotip yo'q`);
  }
});
