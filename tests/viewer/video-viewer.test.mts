import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
import { VideoViewer } from "../../components/viewers/VideoViewer.tsx";
import { extractMeta } from "../../lib/generation/meta.ts";
import { TOOL_BY_ID } from "../../lib/tools.ts";
import { viewerFrame } from "../../components/files/result-layout/frame.ts";
import { viewerKind } from "../../lib/viewers/kind.ts";
import type { AcademicDoc } from "../../lib/generation/types.ts";

/**
 * VIDEO VIEWER (program-17 item 5): the page plays EXACTLY the file the download gives, as a native
 * `<video controls playsinline>`; no second download link (the result header owns download / save / share).
 *
 * Mutations (each turned a test red, then restored): `?inline=1` dropped from the src -> «player source»;
 * `playsInline` removed -> «attributes»; the prompt not rendered -> «caption».
 */
function docOf(video: AcademicDoc["video"]): AcademicDoc {
  const meta = extractMeta(TOOL_BY_ID.video, { prompt: "Registon" });
  return { meta: { ...meta, topic: "Registon" }, titlePage: false, toc: false, sections: [], ...(video ? { video } : {}) };
}

test("VideoViewer: a <video controls playsinline> whose source is the downloadable file (inline), plus the prompt", () => {
  const html = renderToStaticMarkup(
    h(VideoViewer, { doc: docOf({ provider: "veo", prompt: "Tong chog‘ida Registon maydoni", aspect: "16:9", requestedSeconds: 5, seconds: 5, fromImage: false }), gen: { id: "gen-7" } }),
  );
  assert.ok(html.includes("<video"), "player not drawn");
  assert.match(html, /src="\/api\/generations\/gen-7\/file\?inline=1"/, "player source");
  assert.match(html, /controls=""/);
  assert.match(html, /playsInline=""|playsinline=""/i, "attributes");
  assert.match(html, /preload="metadata"/);
  assert.ok(html.includes("Tong chog‘ida Registon maydoni"), "caption");
  assert.ok(html.includes("5 soniya"));
  assert.ok(!html.includes('href="/api/generations/gen-7/file"'), "no second download link");
  assert.ok(!html.includes("max-w-sm"), "landscape is wide");
});

test("VideoViewer: a vertical clip is narrower; a missing model says so instead of an empty player", () => {
  const vertical = renderToStaticMarkup(h(VideoViewer, { doc: docOf({ provider: "kling", prompt: "x", aspect: "9:16", requestedSeconds: 10, seconds: 10, fromImage: true }), gen: { id: "g" } }));
  assert.ok(vertical.includes("max-w-sm"));
  const empty = renderToStaticMarkup(h(VideoViewer, { doc: docOf(undefined), gen: { id: "g" } }));
  assert.ok(!empty.includes("<video"));
  assert.ok(empty.includes("Video topilmadi"));
});

test("the result page treats `video` like the other media kinds (flow frame, kind from the tool id)", () => {
  assert.equal(viewerKind("video"), "video");
  assert.deepEqual(viewerFrame("video"), { mode: "flow", boxed: false });
});
