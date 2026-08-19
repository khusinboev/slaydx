import test from "node:test";
import assert from "node:assert/strict";
import { TOOL_BY_ID } from "../lib/tools.ts";
import type { FormValues } from "../lib/types.ts";
import { extractMeta } from "../lib/generation/meta.ts";
import {
  SLIDE_TEMPLATES,
  SLIDE_TEMPLATE_BY_ID,
  expandBeats,
} from "../lib/generation/slide-templates.ts";
import { fallbackSlides, wantSlides } from "../lib/generation/slide-write.ts";
import { slideNotes } from "../lib/generation/slide-layout.ts";
import {
  referenceSearchPlan,
  targetWords,
  unverifiedReferenceNote,
  WORDS_PER_PAGE,
} from "../lib/generation/quality.ts";
import { sectionLabels } from "../lib/generation/i18n.ts";
import { SOURCE_LANGUAGES, TARGET_LANGUAGES, isTargetLanguage } from "../lib/languages.ts";

/**
 * Generatsiya dvigatelining va'dalari.
 *
 * Bu fayl paydo bo'lgunga qadar `lib/generation/` butunlay testsiz edi —
 * ya'ni mahsulotning foydalanuvchi pul to'laydigan qismi hech qanday
 * regressiya himoyasiga ega emasdi. Quyidagilar aynan Sprint 0 da
 * tuzatilgan nuqsonlarni qulflaydi.
 */

const slide = TOOL_BY_ID.slide;

function slideMeta(values: FormValues) {
  return extractMeta(slide, values);
}

// ---------------------------------------------------------------- hajm

test("WORDS_PER_PAGE real A4 betiga mos (230), shishirilgan emas", () => {
  assert.equal(WORDS_PER_PAGE, 230);
  assert.equal(targetWords(20), 4600);
});

test("targetWords kamida bitta bet hisoblaydi", () => {
  assert.equal(targetWords(1), 230);
  assert.equal(targetWords(0), 230);
  assert.equal(targetWords(-5), 230);
});

// ------------------------------------------------------- sifat paketi

test("sifat paketi haqiqiy slaydlar soniga aylanadi", () => {
  const packs: [string, number][] = [
    ["standard", 10],
    ["premium", 12],
    ["long", 14],
    ["premium_long", 16],
  ];
  for (const [quality, expected] of packs) {
    const meta = slideMeta({ topic: "Fotosintez", quality, slideTemplate: "lecture" });
    const tpl = SLIDE_TEMPLATE_BY_ID.lecture;
    assert.equal(wantSlides(meta, tpl), expected, quality);
    assert.equal(expandBeats(tpl, wantSlides(meta, tpl)).length, expected, quality);
  }
});

test("premium uzun standartdan ko'proq slayd beradi (har bir shablonda)", () => {
  for (const tpl of SLIDE_TEMPLATES) {
    if (tpl.id === "auto") continue;
    const std = slideMeta({ topic: "Mavzu", quality: "standard", slideTemplate: tpl.id });
    const max = slideMeta({ topic: "Mavzu", quality: "premium_long", slideTemplate: tpl.id });
    const a = expandBeats(tpl, wantSlides(std, tpl)).length;
    const b = expandBeats(tpl, wantSlides(max, tpl)).length;
    assert.ok(b > a, `${tpl.id}: ${a} → ${b}`);
    assert.equal(b, 16, tpl.id);
  }
});

test("kengaytirilgan beats: closing oxirida, yonma-yon takror yo'q", () => {
  for (const tpl of SLIDE_TEMPLATES) {
    if (tpl.id === "auto") continue;
    const beats = expandBeats(tpl, 16);
    const last = tpl.beats[tpl.beats.length - 1];
    if (last?.layout === "closing") {
      assert.equal(beats[beats.length - 1].layout, "closing", tpl.id);
      assert.equal(beats.filter((b) => b.layout === "closing").length, 1, tpl.id);
    }
    for (let i = 1; i < beats.length; i++) {
      assert.notEqual(beats[i].layout, beats[i - 1].layout, `${tpl.id} @${i}`);
    }
  }
});

test("expandBeats kerakli sondan kam so'ralganda shablonni qisqartirmaydi", () => {
  const tpl = SLIDE_TEMPLATE_BY_ID.lecture;
  assert.equal(expandBeats(tpl, 4).length, tpl.beats.length);
});

// --------------------------------------------------------- titleSlide

test("titleSlide forma qiymatidan DocMeta ga o'tadi", () => {
  assert.equal(slideMeta({ topic: "X" }).titleSlide, true);
  assert.equal(slideMeta({ topic: "X", titleSlide: false }).titleSlide, false);
  assert.equal(slideMeta({ topic: "X", titleSlide: true }).titleSlide, true);
});

test("titleSlide=false bo'lsa deck'da titul slayd bo'lmaydi", () => {
  const tpl = SLIDE_TEMPLATE_BY_ID.lecture;
  const off = fallbackSlides(slideMeta({ topic: "X", titleSlide: false }), tpl);
  assert.equal(off.filter((s) => s.layout === "title").length, 0);

  const on = fallbackSlides(slideMeta({ topic: "X" }), tpl);
  assert.equal(on.filter((s) => s.layout === "title").length, 1);
});

// -------------------------------------------------------------- notes

test("slideNotes model yozgan matnni afzal ko'radi", () => {
  const written = "Bu yerda notiq fotosintezning ikki bosqichini misol bilan tushuntiradi.";
  assert.equal(
    slideNotes({ id: "s1", layout: "bullets", title: "Fotosintez", notes: written, bullets: ["A", "B"] }),
    written,
  );
});

test("notes bo'lmasa slayd mazmunidan zaxira eslatma tuziladi", () => {
  const notes = slideNotes({ id: "s1", layout: "bullets", title: "T", bullets: ["Birinchi", "Ikkinchi"] });
  assert.match(notes, /Birinchi/);
  assert.match(notes, /Ikkinchi/);
});

// --------------------------------------------------------- adabiyotlar

test("manba topilmaganda uydirma iqtibos yozilmaydi", () => {
  const { note, queries } = referenceSearchPlan("Fotosintez jarayoni", "Biologiya");
  assert.ok(note.length > 20);
  for (const q of queries) {
    // Uydirma manbaning belgilari: nashriyot + yil, DOI, ISSN.
    assert.doesNotMatch(q, /\b(19|20)\d{2}\b/, q);
    assert.doesNotMatch(q, /doi|issn/i, q);
    assert.doesNotMatch(q, /–\s*Toshkent:/i, q);
    assert.match(q, /Fotosintez/i);
  }
});

test("adabiyot izohi hujjat tiliga moslashadi", () => {
  assert.notEqual(referenceSearchPlan("X", "", "ru").note, referenceSearchPlan("X", "", "uz").note);
  assert.notEqual(referenceSearchPlan("X", "", "en").note, referenceSearchPlan("X", "", "uz").note);
  // Noma'lum til — o'zbekchaga qaytadi, xato bermaydi.
  assert.equal(referenceSearchPlan("X", "", "zz").note, referenceSearchPlan("X", "", "uz").note);
});

// ------------------------------------------------------ premium tier

test("premium paketlar vizual darajani yoqadi, oddiylari yo'q", () => {
  for (const q of ["premium", "premium_long"]) {
    assert.equal(slideMeta({ topic: "X", quality: q }).premiumVisuals, true, q);
  }
  for (const q of ["standard", "long", ""]) {
    assert.equal(slideMeta({ topic: "X", quality: q }).premiumVisuals, false, q || "(bo'sh)");
  }
});

test("paket ikki o'lchovni mustaqil boshqaradi: hajm va rasm sifati", () => {
  const long = slideMeta({ topic: "X", quality: "long" });
  const premium = slideMeta({ topic: "X", quality: "premium" });
  // «Uzun» — ko'proq slayd, oddiy rasm.
  assert.ok(long.targetPages > premium.targetPages);
  assert.equal(long.premiumVisuals, false);
  // «Premium» — kamroq slayd, sifatli rasm.
  assert.equal(premium.premiumVisuals, true);
});

// ------------------------------------------------------------ tillar

test("chiqish tillarining hammasi uchun hujjat skeleti tarjimasi bor", () => {
  const intros = new Set<string>();
  for (const l of TARGET_LANGUAGES) {
    const labels = sectionLabels(l.value);
    assert.ok(labels.intro.length > 1, l.value);
    intros.add(labels.intro);
  }
  assert.equal(intros.size, TARGET_LANGUAGES.length, "har til uchun alohida sarlavhalar");
});

test("skeleti yo'q tillar chiqish ro'yxatida yo'q, lekin manba sifatida qoladi", () => {
  for (const code of ["tg", "kk", "kaa", "ar", "zh"]) {
    assert.equal(isTargetLanguage(code), false, `${code} chiqish tili bo'lmasligi kerak`);
    assert.ok(
      SOURCE_LANGUAGES.some((l) => l.value === code),
      `${code} manba tili sifatida qolishi kerak (tarjima uchun)`,
    );
  }
});

// ------------------------------------------------- manbalar halolligi

test("model bergan manbalar uchun ogohlantirish matni bor va tilga moslashadi", () => {
  const uz = unverifiedReferenceNote("uz");
  assert.match(uz, /TEKSHIRILMAGAN/);
  assert.notEqual(unverifiedReferenceNote("ru"), uz);
  assert.notEqual(unverifiedReferenceNote("en"), uz);
  // Noma'lum til — o'zbekchaga qaytadi, xato bermaydi.
  assert.equal(unverifiedReferenceNote("zz"), uz);
});

test("ikki xil ogohlantirish aralashmaydi", () => {
  // Manba yo'q holat: qidiruv rejasi.
  // Manba bor holat: tekshirilmaganlik izohi. Ikkalasi turlicha matn.
  assert.notEqual(unverifiedReferenceNote("uz"), referenceSearchPlan("X", "", "uz").note);
});
