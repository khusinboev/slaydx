import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
import { SlideCanvas } from "../../components/viewers/SlideCanvas.tsx";
import { getSlideTheme } from "../../lib/generation/slide-themes.ts";
import type { SlideModel } from "../../lib/generation/slide-types.ts";

/**
 * Viewer side of the slide image screen copies (ops D5, O4 WP-F).
 *
 * The slide model keeps the ORIGINAL asset url (PPTX rebuild reads it);
 * only the `<img src>` the viewer draws asks for the light copy, and every
 * slide image is lazy with async decode (the rail and the home cards draw
 * every slide of a deck in full).
 */

const GID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const URL_ = `/api/generations/${GID}/assets/0123456789abcdef01234567`;
const theme = getSlideTheme("atlas");

const slide = (url: string): SlideModel => ({
  id: "s",
  layout: "title",
  title: "Suv aylanishi",
  image: { url },
});

const imgTags = (html: string) => html.match(/<img [^>]*>/g) ?? [];

test("slide image: own asset → `?view=1`, lazy, async decode; model url unchanged", () => {
  const model = slide(URL_);
  const html = renderToStaticMarkup(h(SlideCanvas, { slide: model, theme, visual: "classic", index: 0, total: 10 }));
  const tags = imgTags(html);
  assert.ok(tags.length >= 1, "title slide draws its photo");
  const photo = tags.find((t) => t.includes(URL_));
  assert.ok(photo, "photo tag");
  // MUTATION: `src={layer.url}` → no `?view=1`.
  assert.ok(photo!.includes(`src="${URL_}?view=1"`), photo);
  // MUTATION: drop `loading="lazy"` / `decoding="async"`.
  assert.ok(photo!.includes('loading="lazy"'), photo);
  assert.ok(photo!.includes('decoding="async"'), photo);
  assert.equal(model.image!.url, URL_, "the model is not rewritten");
});

test("slide image: `data:` (live build) and template sample paths are drawn as is", () => {
  const data = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
  for (const url of [data, "/samples/tpl-atlas.jpg"]) {
    const html = renderToStaticMarkup(h(SlideCanvas, { slide: slide(url), theme, visual: "classic", index: 0, total: 10 }));
    assert.ok(imgTags(html).some((t) => t.includes(`src="${url}"`)), url);
  }
});
