import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
import { AudioViewer, formatDuration } from "../../components/viewers/AudioViewer.tsx";
import { extractMeta } from "../../lib/generation/meta.ts";
import { TOOLS } from "../../lib/tools.ts";
import type { AcademicDoc } from "../../lib/generation/types.ts";
import type { AudioModel } from "../../lib/generation/audio/types.ts";

/**
 * AUDIO KO'RUVCHISI (AUDIT-22 WP-A2 — «tayyorlik hisoboti/Tuzatish yo'li»
 * bandi 3): AUDIT-22 R0/WP-A da bu ko'ruvchi uchun test yo'q edi.
 *
 * «Ko'rdim = oldim» ning audio varianti: pleer (`<audio>`) hujjat id
 * sidan quriladigan `inline=1` manbani o'ynatadi, transkript esa
 * AYNAN `doc.audio.script` dan chiziladi — ikkinchi «aytish matni» yo'q.
 *
 * Mutatsiyalar (har biri qizardi):
 *   1. `src` dagi `/file?inline=1` yo'lini `?inline=0` ga almashtirish —
 *      «pleer manbasi» testi (Chrome `attachment` bilan o'ynatmasdan
 *      yuklab olishga o'tardi);
 *   2. transkriptni `doc.audio.script` o'rniga bo'sh massivdan chizish —
 *      «transkript ssenariydan» testi.
 */

function docOf(model: AudioModel, topic: string): AcademicDoc {
  const tool = TOOLS.find((t) => t.id === (model.kind === "podcast" ? "podcast" : "greeting"))!;
  const meta = extractMeta(tool, { topic, language: model.language });
  return { meta: { ...meta, topic }, titlePage: false, toc: false, sections: [], audio: model };
}

test("AudioViewer: <audio> pleer ANIQ id dan quriladi va transkript ssenariydan chiziladi (ikki ovoz rangi bilan)", () => {
  const model: AudioModel = {
    v: 1,
    kind: "podcast",
    type: "intervyu",
    language: "uz",
    seconds: 125,
    script: [
      { speaker: "A", text: "Nega bu mavzu bugun muhim?" },
      { speaker: "B", text: "Chunki kopchilik bu haqda notogri tasavvurga ega." },
    ],
  };
  const html = renderToStaticMarkup(h(AudioViewer, { doc: docOf(model, "Sun'iy intellekt"), gen: { id: "gen-1", fileName: "podkast.mp3" } }));

  // Pleer — AYNAN generatsiya id sidan, `inline=1` bilan (yuklab olishga o'tmasin).
  assert.ok(html.includes("<audio"), "pleer chizilmadi");
  assert.match(html, /src="\/api\/generations\/gen-1\/file\?inline=1"/, "pleer manbasi noto'g'ri");
  // V4: yuklab olish BITTA — natija sarlavhasida (`ResultView`). Ko'ruvchi ichida ikkinchi havola yo'q.
  assert.ok(!html.includes('href="/api/generations/gen-1/file"'), "ko'ruvchida takroriy «MP3 yuklab olish» havolasi bo'lmasligi kerak");
  assert.ok(!html.includes("MP3 yuklab olish"), "takroriy yuklash yozuvi");

  // Transkript — ikkala replika matni ekranda, rol belgisi bilan.
  assert.ok(html.includes("Nega bu mavzu bugun muhim?"), "birinchi replika chizilmadi");
  assert.ok(html.includes("Chunki kopchilik bu haqda notogri tasavvurga ega."), "ikkinchi replika chizilmadi");
  assert.ok(html.includes(">A<") && html.includes(">B<"), "rol belgilari chizilmadi");

  // Davomiylik daqiqada (soniyada emas) — `formatDuration`.
  assert.equal(formatDuration(125), "2:05");
  assert.ok(html.includes("2:05"), "davomiylik chizilmadi");

  // MUTATSIYA 1 tekshiruvi: manba yo'li ANIQ shu shaklda, boshqa emas.
  assert.ok(!html.includes('src="/api/generations/gen-1/file"'), "pleer `inline=1` siz — yuklab olishga tushardi");
});

test("AudioViewer: `doc.audio` yo'q bo'lsa pleer YO'Q va foydalanuvchiga tushunarli xabar chiqadi", () => {
  const withoutAudio: AcademicDoc = { ...docOf({ v: 1, kind: "greeting", type: "umumiy", language: "uz", script: [] }, "Tabriknoma"), audio: undefined };
  const html = renderToStaticMarkup(h(AudioViewer, { doc: withoutAudio, gen: { id: "gen-2" } }));
  // MUTATSIYA 2 tekshiruvi: dvigatel ssenariy bermagan holatda pleer chizilmasin (o'ynatib bo'lmaydigan fayl ko'rsatilmasin).
  assert.ok(!html.includes("<audio"), "audiosiz hujjatda ham pleer chizildi");
  assert.ok(html.includes("Ssenariy yaratilmadi"), "xabar chiqmadi");
});

test("AudioViewer (V4, flow): ichki scroll qutisi yo'q, transkript sahifa oqimida, pleer bloki md+ da sticky (--result-header-h)", () => {
  const model: AudioModel = { v: 1, kind: "podcast", type: "intervyu", language: "uz", seconds: 60, script: [{ speaker: "A", text: "Salom" }] };
  const html = renderToStaticMarkup(h(AudioViewer, { doc: docOf(model, "Mavzu"), gen: { id: "gen-3" } }));
  // MUTATSIYA 3: transkript qutisiga `overflow-auto` qaytarilsa yoki `min-h-[70vh]`/`h-full` qo'shilsa — qizaradi.
  assert.doesNotMatch(html, /overflow-(y-)?(auto|scroll)/, "ichki vertikal scroller bo'lmasligi kerak");
  assert.doesNotMatch(html, /\bh-full\b|min-h-\[70vh\]/, "ko'ruvchi qat'iy balandlikka bog'lanmasin");
  assert.match(html, /class="[^"]*md:sticky md:top-\[var\(--result-header-h,0px\)\][^"]*"[^>]*data-audio-player/, "pleer bloki sarlavha ostida sticky");
  assert.ok(html.indexOf("data-audio-player") < html.indexOf("data-audio-transcript"), "pleer transkriptdan oldin");
});
