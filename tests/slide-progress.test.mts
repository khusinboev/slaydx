import test from "node:test";
import assert from "node:assert/strict";
import { extractMeta } from "../lib/generation/meta.ts";
import { TOOL_BY_ID } from "../lib/tools.ts";
import {
  applyLiveEvent,
  liveDocOf,
  liveProgress,
  liveStep,
  type SlideProgressEvent,
} from "../lib/generation/slide-progress.ts";
import type { SlideModel } from "../lib/generation/slide-types.ts";

/**
 * F1b — `slide-progress.ts` poydevori: sof reduktor (`applyLiveEvent`),
 * haqiqiy foiz/matn (`liveProgress`/`liveStep`) va `liveDocOf`.
 *
 * Bu bosqichda hech kim bu hodisalarni HALI chiqarmaydi (L2 paketi
 * chaqiradi) — shuning uchun testlar to'g'ridan-to'g'ri hodisalarni
 * qo'lda tuzib, reduktor QOIDALARINI tekshiradi.
 */

const meta = extractMeta(TOOL_BY_ID["slide"], { topic: "Fotosintez jarayoni" } as never);

function slide(i: number, patch: Partial<SlideModel> = {}): SlideModel {
  return { id: `s${i}`, layout: "bullets", title: `Slayd ${i}`, ...patch };
}

function skeleton(n: number): SlideModel[] {
  return Array.from({ length: n }, (_, i) => slide(i));
}

function planEvent(n: number): Extract<SlideProgressEvent, { type: "plan" }> {
  return {
    type: "plan",
    slides: skeleton(n),
    roles: Array.from({ length: n }, (_, i) => `rol-${i}`),
    meta,
    theme: "atlas",
    template: "lecture",
  };
}

test("plan hodisasi skelet beradi: written=[], final=false, slides nusxa", () => {
  const ev = planEvent(12);
  const s = applyLiveEvent(undefined, ev);
  assert.equal(s.stage, "plan");
  assert.equal(s.slides.length, 12);
  assert.deepEqual(s.written, []);
  assert.equal(s.final, false);
  assert.deepEqual(s.imageWait, []);
  // Nusxa — kiruvchi massiv obyektlari bilan bir xil EMAS (referens jihatidan).
  assert.notEqual(s.slides[0], ev.slides[0]);
  assert.deepEqual(s.slides[0], ev.slides[0]);
});

test("slide hodisasi faqat shu indeksni yangilaydi va written ga qo'shadi", () => {
  let s = applyLiveEvent(undefined, planEvent(3));
  s = applyLiveEvent(s, { type: "stage", stage: "text" });
  const written7 = slide(1, { title: "Yozildi" });
  s = applyLiveEvent(s, { type: "slide", index: 1, slide: written7 });
  assert.equal(s.slides[1].title, "Yozildi");
  assert.equal(s.slides[0].title, "Slayd 0");
  assert.deepEqual(s.written, [1]);
  // Qayta kelsa dublikat qo'shilmaydi.
  s = applyLiveEvent(s, { type: "slide", index: 1, slide: written7 });
  assert.deepEqual(s.written, [1]);
});

test("deck hodisasi slaydlarni almashtiradi, final=true, imageWait tozalanadi", () => {
  let s = applyLiveEvent(undefined, planEvent(3));
  s = applyLiveEvent(s, { type: "images", wait: [0, 1, 2] });
  assert.deepEqual(s.imageWait, [0, 1, 2]);
  const finalSlides = skeleton(3).map((sl, i) => ({ ...sl, title: `Yakuniy ${i}` }));
  s = applyLiveEvent(s, { type: "deck", slides: finalSlides });
  assert.equal(s.final, true);
  assert.deepEqual(s.imageWait, []);
  assert.equal(s.slides[0].title, "Yakuniy 0");
});

test("image hodisasi url qo'yadi va indeksni imageWait dan chiqaradi", () => {
  let s = applyLiveEvent(undefined, planEvent(3));
  s = applyLiveEvent(s, { type: "images", wait: [0, 1, 2] });
  s = applyLiveEvent(s, { type: "image", index: 1, url: "https://example.com/a.png" });
  assert.equal(s.slides[1].image?.url, "https://example.com/a.png");
  assert.deepEqual(s.imageWait, [0, 2]);
  assert.equal(s.images.got, 1);
});

test("progress hech qachon orqaga qaytmaydi (MONOTON)", () => {
  let s = applyLiveEvent(undefined, planEvent(10));
  const seen: number[] = [s.progress];
  s = applyLiveEvent(s, { type: "stage", stage: "research" });
  seen.push(s.progress);
  s = applyLiveEvent(s, { type: "stage", stage: "text" });
  seen.push(s.progress);
  for (let i = 0; i < 10; i++) {
    s = applyLiveEvent(s, { type: "slide", index: i, slide: slide(i, { title: `Yozildi ${i}` }) });
    seen.push(s.progress);
  }
  s = applyLiveEvent(s, { type: "stage", stage: "images" });
  seen.push(s.progress);
  s = applyLiveEvent(s, { type: "images", wait: [0, 1] });
  seen.push(s.progress);
  s = applyLiveEvent(s, { type: "image", index: 0, url: "u" });
  seen.push(s.progress);
  s = applyLiveEvent(s, { type: "stage", stage: "assembly" });
  seen.push(s.progress);
  s = applyLiveEvent(s, { type: "done" });
  seen.push(s.progress);
  for (let i = 1; i < seen.length; i++) {
    assert.ok(seen[i] >= seen[i - 1], `progress orqaga qaytdi: ${seen[i - 1]} -> ${seen[i]} (${i})`);
  }
  assert.ok(seen[seen.length - 1] < 100, "progress 100 ga yetmasligi kerak");
});

test("liveStep matni «N/M» ko'rsatadi va ≤200 belgi", () => {
  let s = applyLiveEvent(undefined, planEvent(12));
  s = applyLiveEvent(s, { type: "stage", stage: "text" });
  for (let i = 0; i < 7; i++) {
    s = applyLiveEvent(s, { type: "slide", index: i, slide: slide(i) });
  }
  const step = liveStep(s);
  assert.ok(step.includes("7/12"), `«7/12» ko'rinishi kerak, oldi: ${step}`);
  assert.ok(step.length <= 200);
});

test("liveStep har bosqichda 200 belgidan oshmaydi", () => {
  let s = applyLiveEvent(undefined, planEvent(3));
  for (const stage of ["plan", "research", "text", "images", "assembly", "done"] as const) {
    s = applyLiveEvent(s, { type: "stage", stage });
    assert.ok(liveStep(s).length <= 200, `${stage}: ${liveStep(s)}`);
  }
});

test("liveDocOf shakli — titlePage/toc o'chiq, sections bo'sh, slides bor", () => {
  const s = applyLiveEvent(undefined, planEvent(4));
  const doc = liveDocOf(s);
  assert.equal(doc.titlePage, false);
  assert.equal(doc.toc, false);
  assert.deepEqual(doc.sections, []);
  assert.equal(doc.slides?.length, 4);
  assert.equal(doc.slideTheme, "atlas");
  assert.equal(doc.slideTemplate, "lecture");
  assert.equal(doc.meta, s.meta);
});

test("kiruvchi obyektlar MUTATSIYA qilinmaydi", () => {
  const ev = planEvent(2);
  const evSlidesSnapshot = JSON.parse(JSON.stringify(ev.slides));
  const s0 = applyLiveEvent(undefined, ev);
  assert.deepEqual(ev.slides, evSlidesSnapshot, "plan hodisasi o'z slaydlarini o'zgartirmasligi kerak");

  const slideEv: SlideProgressEvent = { type: "slide", index: 0, slide: slide(0, { title: "Yangi" }) };
  const before = JSON.stringify(s0);
  const s1 = applyLiveEvent(s0, slideEv);
  assert.equal(JSON.stringify(s0), before, "eski state o'zgarmasligi kerak (yangi obyekt qaytishi kerak)");
  assert.notEqual(s1, s0);
  assert.notEqual(s1.slides, s0.slides);
});

test("mutatsiya: Math.max olib tashlansa progress orqaga qaytishi mumkin bo'lib qoladi (bu test buni ushlaydi)", () => {
  // Qo'lda simulyatsiya: `images` bosqichida 100% dan keyin `research`
  // bosqichiga ODATDA qaytmaydi, lekin qayta tartiblangan hodisa kelsa
  // (masalan tarmoq tartibsizligi) `Math.max` yo'q bo'lsa progress pasayadi.
  let s = applyLiveEvent(undefined, planEvent(2));
  s = applyLiveEvent(s, { type: "stage", stage: "images" });
  s = applyLiveEvent(s, { type: "images", wait: [0, 1] });
  s = applyLiveEvent(s, { type: "image", index: 0, url: "u" });
  s = applyLiveEvent(s, { type: "image", index: 1, url: "u2" });
  const highProgress = s.progress;
  // Orqaga qaytgan `research` hodisasi — `Math.max` bo'lsa progress kamaymaydi.
  s = applyLiveEvent(s, { type: "stage", stage: "research" });
  assert.ok(s.progress >= highProgress, "progress research bosqichiga qaytganda ham kamaymasligi kerak");
});

test("mutatsiya: imageWait filtri o'chirilsa image kelgan indeks ro'yxatda qolib ketadi", () => {
  let s = applyLiveEvent(undefined, planEvent(3));
  s = applyLiveEvent(s, { type: "images", wait: [0, 1, 2] });
  s = applyLiveEvent(s, { type: "image", index: 1, url: "u" });
  assert.ok(!s.imageWait.includes(1), "rasm kelgan indeks imageWait da QOLMASLIGI kerak");
});

test("liveProgress bosqichlar bo'yicha o'suvchi diapazonda", () => {
  const s = applyLiveEvent(undefined, planEvent(10));
  assert.ok(liveProgress(s) < 10);
});
