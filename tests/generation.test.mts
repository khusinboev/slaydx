import test from "node:test";
import assert from "node:assert/strict";
import { TOOL_BY_ID } from "../lib/tools.ts";
import type { FormValues } from "../lib/types.ts";
import { extractMeta } from "../lib/generation/meta.ts";
import {
  SLIDE_TEMPLATES,
  SLIDE_TEMPLATE_BY_ID,
  audienceRules,
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

// -------------------------------------------------------- auditoriya

test("auditoriya tipografika va band chegarasini o'zgartiradi", () => {
  const school = audienceRules("school", "lecture");
  const defense = audienceRules("defense", "lecture");
  assert.ok(school.bodyPt > defense.bodyPt, "maktabda shrift kattaroq");
  assert.ok(school.minPt >= 20, "maktabda pol 20 pt dan past bo'lmasin");
  assert.ok(school.maxBullets < defense.maxBullets, "maktabda band kamroq");
});

test("«auto» auditoriyani shablondan aniqlaydi", () => {
  assert.deepEqual(audienceRules("auto", "defense"), audienceRules("defense", "lecture"));
  assert.deepEqual(audienceRules("auto", "lesson"), audienceRules("school", "lecture"));
  assert.deepEqual(audienceRules("auto", "pitch"), audienceRules("pitch", "lecture"));
  // Noma'lum shablon — ma'ruza chegarasi.
  assert.deepEqual(audienceRules("auto", "faq"), audienceRules("lecture", "lecture"));
});

test("auditoriya forma qiymatidan DocMeta ga o'tadi", () => {
  assert.equal(slideMeta({ topic: "X" }).slideAudience, "auto");
  assert.equal(slideMeta({ topic: "X", slideAudience: "school" }).slideAudience, "school");
  // Noto'g'ri qiymat — «auto» ga qaytadi.
  assert.equal(slideMeta({ topic: "X", slideAudience: "hacker" }).slideAudience, "auto");
});

// ------------------------------------------------------- rasm xavfsizligi

test("rasm turi baytlardan aniqlanadi, sarlavhadan emas", async () => {
  const { sniffImageType } = await import("../lib/generation/slide-images.ts");
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
  assert.equal(sniffImageType(png), "png");
  assert.equal(sniffImageType(jpg), "jpg");
});

test("boshqa formatlar rad etiladi", async () => {
  const { sniffImageType } = await import("../lib/generation/slide-images.ts");
  // ICNS, HEIF va GIF — `image-size` da DoS advisory'si bor parserlar.
  const cases: [string, Buffer][] = [
    ["icns", Buffer.from([0x69, 0x63, 0x6e, 0x73, 0, 0, 0, 32])],
    ["heif", Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63])],
    ["gif", Buffer.from("GIF89a", "ascii")],
    ["html", Buffer.from("<!doctype html>", "utf8")],
    ["bo'sh", Buffer.alloc(0)],
  ];
  for (const [name, buf] of cases) {
    assert.equal(sniffImageType(buf), null, `${name} qabul qilinmasligi kerak`);
  }
});

/**
 * Reja o'lchami betga ergashishi.
 *
 * Nuqson: kurs ishida doim 3 bob × ≤3 ostmavzu edi, ya'ni dvigatelning
 * tuzilmaviy imkoniyati ~9 ostmavzu bilan cheklanardi. 25–30 va 40–45
 * betlik kurs ishlari (18 000 va 24 000 tanga) hajm darvozasidan
 * MUNTAZAM yiqilardi — jonli o'lchov ikkalasi ham ~5 000 so'zda
 * to'xtaganini ko'rsatdi.
 */
test("reja o'lchami bet soniga ergashadi", async () => {
  const { outlineShape } = await import("../lib/generation/write-llm.ts");

  // Qisqa ish — ikki bob yetadi.
  assert.deepEqual(outlineShape(8, "referat"), { chapters: 2, subs: 3 });

  // Kurs ishi hajmidan qat'i nazar kamida uch bob (tuzilma talabi).
  assert.deepEqual(outlineShape(8, "coursework"), { chapters: 3, subs: 3 });
  assert.deepEqual(outlineShape(18, "referat"), { chapters: 3, subs: 3 });

  // Uzun ishlarda hajm ostmavzular SONI orqali olinadi.
  assert.deepEqual(outlineShape(28, "coursework"), { chapters: 4, subs: 4 });
  assert.deepEqual(outlineShape(43, "coursework"), { chapters: 5, subs: 4 });

  // Tuzilma monoton o'sadi — uzunroq ish hech qachon kichikroq reja olmaydi.
  let prev = 0;
  for (const p of [4, 8, 12, 18, 23, 28, 33, 38, 43]) {
    const { chapters, subs } = outlineShape(p, "coursework");
    assert.ok(chapters * subs >= prev, `${p} bet uchun reja kichrayib ketdi`);
    prev = chapters * subs;
  }
});

/**
 * Tuzilmaviy imkoniyat va'dani qoplashi.
 *
 * Bu testning maqsadi — narx darajasi qo'shilganda uni jim buzib
 * qo'ymaslik. Har tarif uchun reja nazariy jihatdan kerakli hajmni
 * ko'tara olishi kerak, aks holda darvoza uni doim yiqitadi.
 */
test("har tarif uchun reja va'da qilingan hajmni ko'tara oladi", async () => {
  const { outlineShape } = await import("../lib/generation/write-llm.ts");
  const { targetWords } = await import("../lib/generation/quality.ts");

  // Paragraf ~105 so'z; ostmavzuga eng ko'pi 6 paragraf so'raladi;
  // kirish va xulosa hajmning ~25% ini beradi.
  const PARA = 105;
  const MAX_PER_SUB = 6;

  for (const pages of [12, 18, 23, 28, 33, 38, 43]) {
    const { chapters, subs } = outlineShape(pages, "coursework");
    const body = chapters * subs * MAX_PER_SUB * PARA;
    const capacity = body / 0.75; // kirish + xulosa ulushi bilan
    const gate = targetWords(pages) * 0.8;
    assert.ok(
      capacity >= gate,
      `${pages} bet: reja ${Math.round(capacity)} so'z ko'taradi, darvoza ${Math.round(gate)} so'z talab qiladi`,
    );
  }
});

/**
 * Dars daqiqalari yig'indisi darsning davomiyligiga teng bo'lishi.
 *
 * Promptda «yig'indi 45 ga teng bo'lsin» deyilgan, lekin hech qachon
 * tekshirilmasdi: 45 daqiqalik darsda yig'indi 60 yoki 35 chiqardi.
 */
test("dars bosqichlari yig'indisi davomiylikka teng bo'ladi", async () => {
  const { normalizeMinutes } = await import("../lib/generation/write-specials.ts");

  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

  // Yig'indi katta — nisbat saqlanib kichrayadi.
  const big = normalizeMinutes([10, 20, 20, 10], 45);
  assert.equal(sum(big), 45);
  assert.ok(big[1] >= big[0], "nisbat saqlanishi kerak");

  // Yig'indi kichik — kattalashadi.
  assert.equal(sum(normalizeMinutes([2, 3, 5], 45)), 45);

  // Allaqachon to'g'ri bo'lsa tegilmaydi.
  assert.deepEqual(normalizeMinutes([5, 10, 10, 8, 7, 5], 45), [5, 10, 10, 8, 7, 5]);

  // Har bosqich kamida 1 daqiqa — bosqich davomiylikdan ko'p bo'lsa ham yiqilmaydi.
  const tight = normalizeMinutes([1, 1, 1, 1, 1, 1, 1, 1], 5);
  assert.ok(tight.every((m) => m >= 1));
  assert.equal(tight.length, 8);

  // Buzuq kirish.
  assert.deepEqual(normalizeMinutes([], 45), []);
  assert.equal(sum(normalizeMinutes([null, "abc", -3], 30)), 30);

  for (const d of [30, 40, 45, 60, 80, 90]) {
    assert.equal(sum(normalizeMinutes([7, 3, 12, 9, 4], d)), d, `${d} daqiqa uchun yig'indi mos emas`);
  }
});

/**
 * Keys rubrikasi balllari yig'indisi 10 ga tenglashishi (N-8).
 *
 * Prompt «ballar yig'indisi 10» deydi, lekin bu tavsiya edi — kod hech
 * qachon tekshirmasdi. Model 7, 12 yoki 15 qaytarishi mumkin edi va
 * o'qituvchi baholay olmaydigan rubrika chiqardi.
 */
test("keys rubrikasi balllari 10 ga normalizatsiya qilinadi", async () => {
  const { rubricBlocks } = await import("../lib/generation/write-specials.ts");
  const { sectionLabels } = await import("../lib/generation/i18n.ts");
  const L = sectionLabels("uz");

  const totalOf = (blocks: ReturnType<typeof rubricBlocks>) => {
    const last = blocks[blocks.length - 1];
    return last?.kind === "p" ? Number(last.text.match(/(\d+)/)?.[1]) : NaN;
  };

  // Model 7 ga teng yig'indi bergan — 10 ga ko'tariladi.
  assert.equal(
    totalOf(rubricBlocks([{ criterion: "To'liqlik", points: 3 }, { criterion: "Aniqlik", points: 4 }], L)),
    10,
  );
  // Model 15 ga teng yig'indi bergan — 10 ga tushiriladi.
  assert.equal(
    totalOf(
      rubricBlocks(
        [
          { criterion: "To'liqlik", points: 5 },
          { criterion: "Aniqlik", points: 5 },
          { criterion: "Asoslash", points: 5 },
        ],
        L,
      ),
    ),
    10,
  );
  // Allaqachon 10 — o'zgarishsiz qoladi.
  const already = rubricBlocks([{ criterion: "To'liqlik", points: 6 }, { criterion: "Aniqlik", points: 4 }], L);
  assert.equal(totalOf(already), 10);
  assert.match(already[1].kind === "li" ? already[1].text : "", /6 ball/);

  // Ball raqami bo'lmasa yoki mezon kam bo'lsa — bo'lim chiqmaydi.
  assert.deepEqual(rubricBlocks([{ criterion: "Yagona mezon", points: 5 }], L), []);
  assert.deepEqual(rubricBlocks(undefined, L), []);
});

/**
 * Rezyume fakt qo'riqchisi (P1-19).
 *
 * Rezyume hujjat emas, DA'VO: yo'q ish joyi yozilgan CV bilan suhbatga
 * borish jiddiy zarar. Ikki xil qaror bor va ikkalasi ham noto'g'ri
 * bo'lishi mumkin — shuning uchun ikkalasi ham alohida sinaladi.
 */
test("rezyumeda uydirma tashkilot tashlanadi, uydirma yil o'chiriladi", async () => {
  const { resumeFactGuard } = await import("../lib/generation/write-specials.ts");

  const input = "2019-yildan 15-maktabda biologiya o'qituvchisi. 2015-yilda TDPU bitirgan.";
  const { orgIsKnown, stripUnknownYears } = resumeFactGuard(input);

  // Haqiqiy qayta ifodalash SAQLANADI.
  assert.ok(orgIsKnown("2019 — o'qituvchi — 15-sonli umumiy o'rta ta'lim maktabi"));
  assert.ok(orgIsKnown("2015 — bitiruvchi — TDPU"));

  // Umuman boshqa tashkilot — uydirma.
  assert.ok(!orgIsKnown("2020 — metodist — Respublika ta'lim markazi"));

  // Kiritilgan yil qoladi.
  assert.ok(stripUnknownYears("2019 — o'qituvchi").includes("2019"));

  // Uydirma yil o'chadi, matn qoladi.
  const cleaned = stripUnknownYears("2017 — laborant");
  assert.ok(!cleaned.includes("2017"), `uydirma yil qolib ketdi: ${cleaned}`);
  assert.ok(cleaned.includes("laborant"), "matn saqlanishi kerak");

  // Yarim oraliq ma'nosiz — butun oraliq o'chadi.
  const range = stripUnknownYears("2017–2021 — bakalavr");
  assert.ok(!/\d{4}/.test(range), `oraliq qolib ketdi: ${range}`);

  // Foydalanuvchi umuman fakt bermasa filtr o'chadi — xom matnni yo'q qilmaydi.
  const open = resumeFactGuard("");
  assert.ok(open.orgIsKnown("Istalgan tashkilot"));
  assert.equal(open.stripUnknownYears("2017–2021 — bakalavr"), "2017–2021 — bakalavr");
});

/**
 * Uydirma adabiyot filtri (P0-4).
 *
 * Nashriyot nomining o'zi belgi emas — model ba'zan to'g'ri yozadi.
 * Xavfli narsa tekshirib bo'lmaydigan aniqlik: DOI, ISSN, jurnal tomi,
 * havola. Aynan shular o'qituvchi tekshirganda fosh bo'ladi.
 */
test("adabiyot filtri tekshirib bo'lmaydigan aniqlikni rad etadi", async () => {
  const { isReferenceLine } = await import("../lib/generation/write-llm.ts");

  // Ishonchli uslubiy manba — o'tadi.
  assert.ok(isReferenceLine("Karimov A. Pedagogika asoslari. – Toshkent: O‘qituvchi, 2018."));
  assert.ok(isReferenceLine("Smith J. Foundations of Reading. – London: Routledge, 2015."));

  // Tekshirib bo'lmaydigan aniqlik — rad etiladi.
  assert.ok(!isReferenceLine("Karimov A. Maqola nomi. doi:10.1234/abcd. 2019."));
  assert.ok(!isReferenceLine("Karimov A. Maqola. ISSN 1234-5678. – Toshkent, 2019."));
  assert.ok(!isReferenceLine("Karimov A. Maqola. https://example.uz/article. 2019."));
  assert.ok(!isReferenceLine("Karimov A. Maqola // Jurnal. vol. 12, 2019."));

  // Kirish gapi manba emas.
  assert.ok(!isReferenceLine("Ushbu ro‘yxat quyidagi manbalar asosida tuzilgan, 2019."));

  // Juda qisqa yoki juda uzun qator manba emas.
  assert.ok(!isReferenceLine("Karimov, 2019."));
  assert.ok(!isReferenceLine("K".repeat(300)));
});

/**
 * Matn ichi iqtibos [n] — faqat mavjud ro'yxat oralig'ida.
 *
 * Sprint 6: model manba ro'yxatidan tashqari raqam uydirishi yoki
 * `refPlan` ishga tushib chop etiladigan ro'yxat butunlay boshqasiga
 * (qidiruv so'rovlariga) almashtirilishi mumkin — ikkalasida ham
 * osilib qolgan [n] iqtibossiz gapdan yomonroq.
 */
test("sanitizeCitations faqat oraliqdagi [n] ni saqlaydi", async () => {
  const { sanitizeCitations } = await import("../lib/generation/quality.ts");

  assert.equal(
    sanitizeCitations("Bu jarayon energiya almashinuvini ta'minlaydi [2].", 5),
    "Bu jarayon energiya almashinuvini ta'minlaydi [2].",
  );
  // Ro'yxatdan tashqari raqam — olib tashlanadi, gap qoladi.
  assert.equal(
    sanitizeCitations("Bu jarayon energiya almashinuvini ta'minlaydi [9].", 5),
    "Bu jarayon energiya almashinuvini ta'minlaydi.",
  );
  // Ro'yxat butunlay yo'q (refPlan) — barcha [n] olib tashlanadi.
  assert.equal(sanitizeCitations("Natija shuni ko'rsatadi [1].", 0), "Natija shuni ko'rsatadi.");
  // Bir nechta iqtibos — faqat noto'g'risi olib tashlanadi.
  assert.equal(
    sanitizeCitations("Birinchi da'vo [1], ikkinchisi esa [12] edi.", 3),
    "Birinchi da'vo [1], ikkinchisi esa edi.",
  );
  // Iqtibossiz matn o'zgarishsiz qoladi.
  assert.equal(sanitizeCitations("Oddiy gap, raqamsiz.", 5), "Oddiy gap, raqamsiz.");
});

// ------------------------------------------------ janr differensiatsiyasi

/**
 * Referat, kurs ishi, mustaqil ish, maqola va tezis — beshtasi bir xil
 * `WRITER` to'plamidan o'tadi (`write-llm.ts`), lekin ilgari deyarli bir
 * xil promptga ega edi: farq faqat kurs ishi uchun qo'shilgan bitta blok
 * bilan cheklangandi. Natijada referat va mustaqil ish MATNDA
 * ajralmasdi, garchi narxda ajralsa ham. Bu testlar har janr o'ziga xos
 * talab olishini qulflaydi.
 */

function writerMeta(toolId: "coursework" | "referat" | "mustaqil-ish" | "article" | "thesis", values: FormValues) {
  return extractMeta(TOOL_BY_ID[toolId], { topic: "Sun'iy intellekt", ...values });
}

test("kurs ishi va referat endi bir xil promptga ega emas", async () => {
  const { writerSystemPrompt } = await import("../lib/generation/prompts.ts");
  const coursework = writerSystemPrompt(writerMeta("coursework", {}));
  const referat = writerSystemPrompt(writerMeta("referat", {}));

  // Kurs ishi — tadqiqot savoli, obyekt/predmet MAJBURIY.
  assert.match(coursework, /tadqiqot savoli/i);
  assert.match(coursework, /obyekt va predmet/i);

  // Referat — aynan shu talab YO'Q, aksincha ochiq ravishda shart emasligi aytiladi.
  assert.doesNotMatch(referat, /obyekt va predmet ALOHIDA/i);
  assert.match(referat, /obyekt\/predmet ajratish SHART emas/i);
  assert.match(referat, /adabiyot sharhi/i);
});

test("mustaqil ish promptida o'z bajargan amaliy vazifa talabi bor, referatda yo'q", async () => {
  const { writerSystemPrompt } = await import("../lib/generation/prompts.ts");
  const mustaqil = writerSystemPrompt(writerMeta("mustaqil-ish", {}));
  const referat = writerSystemPrompt(writerMeta("referat", {}));

  assert.match(mustaqil, /O‘Z BAJARGAN amaliy vazifasi/);
  assert.doesNotMatch(referat, /O‘Z BAJARGAN amaliy vazifasi/);
});

test("standart maqola va tezis prompti BOB raqamlashni taqiqlaydi", async () => {
  const { writerSystemPrompt } = await import("../lib/generation/prompts.ts");
  const article = writerSystemPrompt(writerMeta("article", {}));
  const thesis = writerSystemPrompt(writerMeta("thesis", {}));
  const coursework = writerSystemPrompt(writerMeta("coursework", {}));

  assert.match(article, /ISHLATMANG/);
  assert.match(article, /I BOB/); // taqiq matnida tilga olinadi
  assert.match(thesis, /ISHLATMANG/);
  /*
   * Kurs ishida esa aksincha — boblar TALAB qilinadi. Son endi qattiq
   * yozilmaydi, u `outlineShape` dan keladi (P1-10), shuning uchun
   * tekshiruv shaklga qaraydi, aniq songa emas.
   */
  assert.match(coursework, /\d+ ta bob: nazariy asos/);
  assert.ok(!/ISHLATMANG/.test(coursework), "kurs ishida bob taqiqlanmaydi");
});

test("kirish ko'rsatmasi janrga qarab farqlanadi", async () => {
  const { writerSystemPrompt } = await import("../lib/generation/prompts.ts");
  const prompts = {
    coursework: writerSystemPrompt(writerMeta("coursework", {})),
    referat: writerSystemPrompt(writerMeta("referat", {})),
    "mustaqil-ish": writerSystemPrompt(writerMeta("mustaqil-ish", {})),
    article: writerSystemPrompt(writerMeta("article", {})),
    thesis: writerSystemPrompt(writerMeta("thesis", {})),
  };
  // Har biri boshqalaridan farq qilishi kerak — beshtasi ham noyob.
  const unique = new Set(Object.values(prompts));
  assert.equal(unique.size, 5, "har janr o'ziga xos promptga ega bo'lishi kerak");
});

/**
 * Bob-kitob raqamlash («I BOB.») faqat referat/kurs ishi/mustaqil ishda —
 * maqola va tezis jurnal/konferensiya uslubida (oddiy «1.», «2.»).
 */
test("bob uslubi faqat akademik-kitob janrlarida", async () => {
  const { isBobStyle } = await import("../lib/generation/write-llm.ts");
  assert.equal(isBobStyle("coursework"), true);
  assert.equal(isBobStyle("referat"), true);
  assert.equal(isBobStyle("mustaqil-ish"), true);
  assert.equal(isBobStyle("article"), false);
  assert.equal(isBobStyle("thesis"), false);
});

// -------------------------------------------------- yetkazib berish (Sprint 10)

/**
 * Rasm — 14 xizmatdan YAGONA sifat darvozasi yo'qi edi.
 *
 * Narx faqat SONGA bog'langan (4 ta = 6 000 tanga), yagona tekshiruv esa
 * `images.length === 0` edi: 4 tadan 1 tasi kelsa ham ish `COMPLETED`
 * bo'lib, pul to'liq yechilgan holida qolardi.
 */
test("bir nechta rasm arxivga yig'iladi, bittasi xom fayl bo'lib qoladi", async () => {
  const { packImages } = await import("../lib/generation/image-studio.ts");
  const JSZip = (await import("jszip")).default;

  const file = (name: string, mime: string) => ({
    name,
    mime,
    bytes: new Uint8Array(Array.from({ length: 300 }, (_, i) => i % 256)),
  });

  // Bitta rasm — arxiv emas, kengaytma haqiqiy MIME dan.
  const one = await packImages([file("rasm-1.png", "image/png")], "manzara", 1);
  assert.equal(one.mime, "image/png");
  assert.equal(one.fileName, "manzara.png");
  assert.equal(one.delivered, undefined, "to'liq yetkazilganda `delivered` bo'lmaydi");

  // Uch rasm — ZIP, ichida uchalasi ham bor.
  const many = await packImages(
    [file("rasm-1.png", "image/png"), file("rasm-2.jpg", "image/jpeg"), file("rasm-3.png", "image/png")],
    "manzara",
    3,
  );
  assert.equal(many.mime, "application/zip");
  assert.equal(many.fileName, "manzara-3ta.zip");
  const zip = await JSZip.loadAsync(many.bytes);
  assert.deepEqual(Object.keys(zip.files).sort(), ["rasm-1.png", "rasm-2.jpg", "rasm-3.png"]);
});

test("kam yetkazilgan rasm `delivered` bilan belgilanadi", async () => {
  const { packImages } = await import("../lib/generation/image-studio.ts");
  const bytes = new Uint8Array(300);

  // 4 ta so'raldi, 2 tasi keldi — worker yarmini qaytaradi.
  const short = await packImages(
    [
      { name: "rasm-1.png", mime: "image/png", bytes },
      { name: "rasm-2.png", mime: "image/png", bytes },
    ],
    "rasm",
    4,
  );
  assert.deepEqual(short.delivered, { got: 2, want: 4 });

  // 4 ta so'raldi, 1 tasi keldi — ZIP emas, xom fayl, lekin baribir belgilanadi.
  const one = await packImages([{ name: "rasm-1.jpg", mime: "image/jpeg", bytes }], "rasm", 4);
  assert.deepEqual(one.delivered, { got: 1, want: 4 });
  assert.equal(one.mime, "image/jpeg");
});

test("qaytariladigan ulush hamyonlar bo'yicha aniq taqsimlanadi", async () => {
  const { splitRatio } = await import("../lib/server/credits.ts");

  // Yig'indi HAR DOIM nishonga teng — har komponentni alohida pastga
  // yaxlitlash foydalanuvchi zarariga 2 tangagacha kam qaytarardi.
  for (const parts of [[1000, 500, 2000], [3, 3, 3], [7, 0, 0], [0, 0, 6000]]) {
    for (const ratio of [0.25, 1 / 3, 0.5, 0.75, 1]) {
      const out = splitRatio(parts, ratio);
      const total = parts.reduce((a, b) => a + b, 0);
      assert.equal(
        out.reduce((a, b) => a + b, 0),
        Math.round(total * ratio),
        `${parts} × ${ratio}`,
      );
      // Qaytarish hech qachon yechilgandan oshmaydi.
      out.forEach((v, i) => assert.ok(v <= parts[i] && v >= 0, `${parts} × ${ratio} -> ${out}`));
    }
  }
});

test("fayl formati yorlig'i haqiqiy faylga ergashadi", async () => {
  const { formatOf } = await import("../lib/server/jobs.ts");

  // Navbatga qo'yishda yorliq `tool.output` dan olinadi (rasm uchun `png`),
  // lekin bir nechta rasm ZIP bo'lib chiqadi — yorliq yakunlashda tuzatiladi.
  assert.equal(formatOf("manzara-3ta.zip"), "zip");
  assert.equal(formatOf("manzara.png"), "png");
  assert.equal(formatOf("kurs-ishi.docx"), "docx");
  assert.equal(formatOf("nomsiz"), null, "kengaytmasiz nom yorliqni o'zgartirmasin");
});

// -------------------------------------------------- tuzilma darvozasi (Sprint 11)

/**
 * Janr talablari ilgari FAQAT promptda turardi.
 *
 * `writeAbstracts` ikki marta urinib ham javob olmasa, maqola
 * annotatsiyasiz `COMPLETED` bo'lardi — jurnalga yubora olmaydigan
 * «maqola» uchun 8 000 tanga olinardi.
 */
test("janr o'z tuzilma talabiga ega", async () => {
  const { structureNeeds } = await import("../lib/generation/structure.ts");
  const { extractMeta } = await import("../lib/generation/meta.ts");
  const { TOOL_BY_ID } = await import("../lib/tools.ts");
  const m = (id: keyof typeof TOOL_BY_ID, v: Record<string, unknown> = {}) =>
    extractMeta(TOOL_BY_ID[id], { topic: "Mavzu", ...v } as FormValues);

  assert.deepEqual(structureNeeds(m("article")), ["abstract"]);
  assert.deepEqual(structureNeeds(m("thesis")), ["abstract"]);
  assert.deepEqual(structureNeeds(m("mustaqil-ish")), ["ownTask"]);

  // Referat — sof adabiyot sharhi, qo'shimcha talab yo'q.
  assert.deepEqual(structureNeeds(m("referat")), []);

  // Jadval faqat foydalanuvchi vizual so'raganda kutiladi: «yo'q»
  // deganini darvozaga aylantirish tanlovni jimgina bekor qilish bo'lardi.
  // Forma maydoni `images` ("yes"/"no"), `DocMeta.includeVisuals` esa
  // shundan hosil bo'ladi — test ham foydalanuvchi yuboradigan shaklni
  // ishlatadi, ichki nomni emas.
  assert.deepEqual(structureNeeds(m("coursework", { images: "yes" })), ["table"]);
  assert.deepEqual(structureNeeds(m("coursework", { images: "no" })), []);
});

test("annotatsiyasiz maqola qat'iy darvozadan o'tmaydi", async () => {
  const { missingStructure, hardMissing } = await import("../lib/generation/structure.ts");
  const { extractMeta } = await import("../lib/generation/meta.ts");
  const { TOOL_BY_ID } = await import("../lib/tools.ts");

  const meta = extractMeta(TOOL_BY_ID.article, { topic: "Mavzu" } as FormValues);
  const base = {
    meta,
    titlePage: true,
    toc: true,
    sections: [{ id: "kirish", title: "Kirish", blocks: [{ kind: "p" as const, text: "Matn." }] }],
  };

  assert.deepEqual(hardMissing(meta, base), ["abstract"]);
  assert.deepEqual(missingStructure(meta, base), ["abstract"]);

  const withAbstract = { ...base, abstracts: [{ lang: "uz", label: "Annotatsiya", text: "T", keywords: "k" }] };
  assert.deepEqual(hardMissing(meta, withAbstract), []);
});

test("jadval talabi qat'iy emas — faqat kuzatiladi", async () => {
  const { missingStructure, hardMissing } = await import("../lib/generation/structure.ts");
  const { extractMeta } = await import("../lib/generation/meta.ts");
  const { TOOL_BY_ID } = await import("../lib/tools.ts");

  const meta = extractMeta(TOOL_BY_ID.coursework, { topic: "Mavzu", images: "yes" } as FormValues);
  const doc = {
    meta,
    titlePage: true,
    toc: true,
    sections: [{ id: "bob1", title: "Bob", blocks: [{ kind: "p" as const, text: "Matn." }] }],
  };
  // Kuzatiladi, lekin to'liq yozilgan 24 000 tangalik ishni yiqitmaydi.
  assert.deepEqual(missingStructure(meta, doc), ["table"]);
  assert.deepEqual(hardMissing(meta, doc), []);
});

test("mustaqil ishning oxirgi bobi sof nazariya bo'lsa belgilanadi", async () => {
  const { missingStructure, hardMissing } = await import("../lib/generation/structure.ts");
  const { extractMeta } = await import("../lib/generation/meta.ts");
  const { TOOL_BY_ID } = await import("../lib/tools.ts");

  const meta = extractMeta(TOOL_BY_ID["mustaqil-ish"], { topic: "Mavzu" } as FormValues);
  const doc = (lastText: string) => ({
    meta,
    titlePage: true,
    toc: true,
    sections: [
      { id: "kirish", title: "Kirish", blocks: [{ kind: "p" as const, text: "Kirish." }] },
      { id: "bob1", title: "Nazariya", blocks: [{ kind: "p" as const, text: "Nazariy qism." }] },
      { id: "bob2", title: "Amaliy qism", blocks: [{ kind: "p" as const, text: lastText }] },
      { id: "xulosa", title: "Xulosa", blocks: [{ kind: "p" as const, text: "Xulosa." }] },
    ],
  });

  // Oxirgi bob raqamsiz — nazariya qayta bayoni, mustaqil vazifa emas.
  assert.deepEqual(missingStructure(meta, doc("Tushuncha tizimli o‘rganishni talab qiladi.")), ["ownTask"]);

  // Raqamli natija bor — talab bajarilgan.
  assert.deepEqual(missingStructure(meta, doc("Hisob natijasi: 12 ta namunadan 9 tasi mos keldi.")), []);

  // Hozircha KUZATUVDA: evristik aniqlash uchun darvoza qat'iy emas.
  assert.deepEqual(hardMissing(meta, doc("Nazariy bayon.")), []);
});

test("to'ldiruvchi bob mustaqil ishning amaliy bobidan keyin qo'yilmaydi", async () => {
  const { fillerInsertIndex } = await import("../lib/generation/write-llm.ts");

  // [kirish, bob1, bob2, xulosa] — to'ldiruvchi xulosadan oldin.
  assert.equal(fillerInsertIndex(4, "referat"), 3);
  assert.equal(fillerInsertIndex(4, "coursework"), 3);

  /*
   * Mustaqil ishda oxirgi bob — talabaning o'z bajargan vazifasi, ya'ni
   * to'ldiruvchi undan ham oldin turishi kerak. Jonli sinovda aks holda
   * ikkala janr ham «QO'SHIMCHA TAHLIL VA ISTIQBOL» bilan tugardi.
   */
  assert.equal(fillerInsertIndex(4, "mustaqil-ish"), 2);

  // Juda qisqa hujjatda ham kirishdan oldin tushmaydi.
  assert.equal(fillerInsertIndex(2, "mustaqil-ish"), 1);
  assert.equal(fillerInsertIndex(1, "mustaqil-ish"), 1);
});

test("mustaqil vazifa tekshiruvi to'ldiruvchi bobga aldanmaydi", async () => {
  const { missingStructure } = await import("../lib/generation/structure.ts");
  const { extractMeta } = await import("../lib/generation/meta.ts");
  const { TOOL_BY_ID } = await import("../lib/tools.ts");

  const meta = extractMeta(TOOL_BY_ID["mustaqil-ish"], { topic: "Mavzu" } as FormValues);
  /*
   * `qoshimcha` — hajm uchun qo'shiladigan umumiy bob. Ilgari tekshiruv
   * «oxirgi bo'lim» ni olardi va aynan shu bobga tushib, raqamli
   * natijali amaliy bobni umuman ko'rmasdi.
   */
  const doc = {
    meta,
    titlePage: true,
    toc: true,
    sections: [
      { id: "kirish", title: "Kirish", blocks: [{ kind: "p" as const, text: "Kirish." }] },
      { id: "bob2", title: "Amaliy qism", blocks: [{ kind: "p" as const, text: "12 ta tenglamadan 9 tasi yechildi." }] },
      { id: "qoshimcha", title: "Qo‘shimcha tahlil", blocks: [{ kind: "p" as const, text: "Umumiy mulohaza." }] },
      { id: "xulosa", title: "Xulosa", blocks: [{ kind: "p" as const, text: "Xulosa." }] },
    ],
  };
  assert.deepEqual(missingStructure(meta, doc), [], "amaliy bob topilishi kerak");
});

// -------------------------------------------------- ish byudjeti (Sprint 12)

/**
 * Ilgari 14 xizmatning hammasiga bitta 300 s berilardi.
 *
 * 1 varaqlik insho 285 s lik slotni band qilar (`WORKER_CONCURRENCY=2`
 * da o'tkazuvchanlikning yarmi), 45 betlik kurs ishi esa unga sig'masdi
 * va hajm darvozasidan yiqilardi — ya'ni eng qimmat xizmatda (24 000
 * tanga) muvaffaqiyatsizlik ehtimoli eng yuqori edi.
 */
test("byudjet ish hajmiga ergashadi", async () => {
  const { budgetFor, MIN_BUDGET_MS } = await import("../lib/generation/budget.ts");
  const { TOOL_BY_ID } = await import("../lib/tools.ts");
  const CAP = 900_000;

  const essay = budgetFor(TOOL_BY_ID.essay, { pages: "1" } as FormValues, CAP);
  const big = budgetFor(TOOL_BY_ID.coursework, { pages: "40-45" } as FormValues, CAP);
  const small = budgetFor(TOOL_BY_ID.coursework, { pages: "10-15" } as FormValues, CAP);

  assert.ok(essay <= 120_000, `1 varaqlik insho tez tugashi kerak: ${essay}`);
  /*
   * 40–45 betlik kurs ishi 5 bob × 4 ostmavzu = 20 chaqiruv, qisman
   * parallel — jonli o'lchovda ~420 s. Eski global 300 s bunga yetmasdi
   * va ish hajm darvozasidan yiqilardi.
   */
  assert.ok(big >= 420_000, `45 betlik kurs ishiga yetarli vaqt kerak: ${big}`);
  assert.ok(big > 300_000, "eski global byudjetdan (300 s) katta bo'lishi kerak");
  assert.ok(big > small, "katta ish ko'proq vaqt olishi kerak");
  assert.ok(small >= MIN_BUDGET_MS);
});

test("byudjet yuqori chegaradan oshmaydi", async () => {
  const { budgetFor, MIN_BUDGET_MS } = await import("../lib/generation/budget.ts");
  const { TOOL_BY_ID } = await import("../lib/tools.ts");

  // `WORKER_JOB_TIMEOUT_MS` — operatorning yagona tutqichi; hech qanday
  // hisob undan oshib keta olmasligi kerak.
  const capped = budgetFor(TOOL_BY_ID.coursework, { pages: "40-45" } as FormValues, 200_000);
  assert.equal(capped, 200_000);

  // Chegara aqlsiz kichik bo'lsa ham eng kam byudjet saqlanadi —
  // aks holda hech bir ish umuman tugay olmasdi.
  assert.equal(budgetFor(TOOL_BY_ID.coursework, { pages: "40-45" } as FormValues, 1_000), MIN_BUDGET_MS);
});

test("bet soniga bog'liq bo'lmagan xizmatlar qat'iy byudjet oladi", async () => {
  const { budgetFor } = await import("../lib/generation/budget.ts");
  const { TOOL_BY_ID } = await import("../lib/tools.ts");
  const CAP = 900_000;

  // Rasm — eng tez, tarjima — eng sekin (bo'laklar to'lqinlarda ketadi).
  const image = budgetFor(TOOL_BY_ID.image, {} as FormValues, CAP);
  const translation = budgetFor(TOOL_BY_ID.translation, {} as FormValues, CAP);
  const glossary = budgetFor(TOOL_BY_ID.glossary, {} as FormValues, CAP);

  assert.ok(image < glossary && glossary < translation, `${image} < ${glossary} < ${translation}`);

  /*
   * Qat'iy byudjetli xizmat forma qiymatlariga umuman qaramaydi — mana shu
   * ularni slayd va yozuvchi vositalardan ajratib turadi.
   */
  assert.equal(budgetFor(TOOL_BY_ID.image, { imageCount: 4 } as FormValues, CAP), image);
  assert.equal(budgetFor(TOOL_BY_ID.glossary, { termCount: "40" } as FormValues, CAP), glossary);

  /*
   * Slayd ENDI bu ro'yxatda EMAS (N-2): u qat'iy 180 000 edi, ya'ni
   * 10 slaydli standart paket ham, 16 slaydli `premium_long` ham (3 000 va
   * 8 000 tanga) bir xil vaqt olardi. O'sish `slide-layout.test.mts` da
   * batafsil sinaladi; bu yerda faqat qat'iy EMASLIGI qayd etiladi.
   */
  const slideSmall = budgetFor(TOOL_BY_ID.slide, { quality: "standard" } as FormValues, CAP);
  const slideBig = budgetFor(TOOL_BY_ID.slide, { quality: "premium_long" } as FormValues, CAP);
  assert.notEqual(slideSmall, slideBig, "slayd byudjeti paketga bog'liq bo'lishi kerak");
});

test("mapPool yagona manba — buzuq limit bilan ham natija yo'qotmaydi", async () => {
  const { mapPool } = await import("../lib/generation/quality.ts");

  const items = [1, 2, 3, 4, 5];
  const double = async (n: number) => n * 2;

  assert.deepEqual(await mapPool(items, 2, double), [2, 4, 6, 8, 10]);
  assert.deepEqual(await mapPool(items, 99, double), [2, 4, 6, 8, 10], "limit elementdan ko'p");
  assert.deepEqual(await mapPool([], 3, double), []);

  /*
   * `limit <= 0` — nusxa ko'chirilgan variantlarda (`image-studio`,
   * `slide-images`) himoya yo'q edi: `Array.from({length: 0})` bo'sh
   * bo'lib, `Promise.all([])` darhol yakunlanar va natija massivi
   * BO'SH KATAKLAR bilan qaytardi — jim ma'lumot yo'qolishi.
   */
  assert.deepEqual(await mapPool(items, 0, double), [2, 4, 6, 8, 10]);
  assert.deepEqual(await mapPool(items, -3, double), [2, 4, 6, 8, 10]);

  // Tartib saqlanadi, garchi bajarilish tartibi boshqacha bo'lsa ham.
  const out = await mapPool([30, 10, 20], 3, async (ms) => {
    await new Promise((r) => setTimeout(r, ms));
    return ms;
  });
  assert.deepEqual(out, [30, 10, 20]);
});

test("qo'lda yozilgan reja bayroqqa qaramay ishlatiladi", async () => {
  const { manualOutlineOf } = await import("../lib/generation/write-llm.ts");

  const plan = "1. Nazariy asoslar\n  1.1 Tushuncha\n  1.2 Tasnif\n2. Amaliy tahlil\n  2.1 Holat";

  /*
   * AYNAN N-4 (Sprint 14). Formada `tocMethod` ning standarti «ai» edi va
   * u FAQAT «AI reja tuzsin» tugmasida «manual» ga o'tardi. Foydalanuvchi
   * rejasini to'g'ridan-to'g'ri yozsa, dvigatel uni umuman o'qimasdi —
   * 16 000–24 000 tangalik hujjat butunlay boshqa tuzilmada chiqardi.
   */
  const asAi = manualOutlineOf({ tocMethod: "ai", tocText: plan, extra: "" });
  assert.equal(asAi.length, 2, "reja matni bor ekan, bayrog'idan qat'i nazar o'qilishi kerak");
  assert.equal(asAi[0].title, "Nazariy asoslar");
  assert.deepEqual(asAi[0].subs, ["Tushuncha", "Tasnif"]);
  assert.equal(asAi[1].title, "Amaliy tahlil");

  // `manual` bayrog'i bilan natija AYNAN bir xil — bayroq endi hech
  // narsani hal qilmaydi, matn hal qiladi.
  assert.deepEqual(manualOutlineOf({ tocMethod: "manual", tocText: plan, extra: "" }), asAi);

  // Reja yozilmagan bo'lsa AI o'zi tuzadi (bo'sh ro'yxat).
  assert.deepEqual(manualOutlineOf({ tocMethod: "ai", tocText: "", extra: "" }), []);
  assert.deepEqual(manualOutlineOf({ tocMethod: "ai", tocText: "   \n  ", extra: "" }), []);

  /*
   * «Qo'shimcha talablar» reja EMAS. `extra` ga qaytish faqat aniq
   * `manual` rejimida qoladi (eski xatti-harakat): aks holda har qanday
   * qo'shimcha talab hujjat tuzilmasiga aylanib ketardi.
   */
  const extraOnly = "Iqtisodiy tahlilga urg'u bering\nGrafik qo'shing";
  assert.deepEqual(
    manualOutlineOf({ tocMethod: "ai", tocText: "", extra: extraOnly }),
    [],
    "«ai» rejimida qo'shimcha talab reja sifatida o'qilmasligi kerak",
  );
  assert.ok(
    manualOutlineOf({ tocMethod: "manual", tocText: "", extra: extraOnly }).length > 0,
    "«manual» rejimidagi eski zaxira yo'l saqlanishi kerak",
  );
});

test("standart shift ostida har bir narx tarifi alohida byudjet oladi", async () => {
  const { budgetFor } = await import("../lib/generation/budget.ts");
  const { DEFAULT_JOB_TIMEOUT_MS } = await import("../lib/server/env.ts");
  const { TOOL_BY_ID, priceFor } = await import("../lib/tools.ts");

  /*
   * AYNAN N-3 (Sprint 14). `WORKER_JOB_TIMEOUT_MS` standarti 300 000 edi
   * va `budgetFor` ning bet formulasini 23 betdan yuqorida O'LIK qilib
   * qo'yardi: to'rtta eng qimmat kurs ishi tarifi (18 000–24 000 tanga)
   * bir xil 300 s olardi. Ya'ni formula va shift bir-birini yolg'onga
   * chiqarar, hajm darvozasidan yiqilish ehtimoli esa aynan eng yuqori
   * narxda eng katta edi.
   *
   * Qoida: narx oshsa, vaqt ham oshishi kerak. Tekshiruv AYNAN standart
   * shift bilan bajariladi — muammo formulada emas, shiftda edi.
   */
  const tiers = ["10-15", "15-20", "20-25", "25-30", "30-35", "35-40", "40-45"];
  const seen: { pages: string; price: number; budget: number }[] = tiers.map((pages) => ({
    pages,
    price: priceFor(TOOL_BY_ID.coursework, { pages } as FormValues),
    budget: budgetFor(TOOL_BY_ID.coursework, { pages } as FormValues, DEFAULT_JOB_TIMEOUT_MS),
  }));

  for (let i = 1; i < seen.length; i++) {
    const prev = seen[i - 1];
    const cur = seen[i];
    assert.ok(cur.price > prev.price, `${cur.pages} narxi ${prev.pages} dan yuqori bo'lishi kerak`);
    assert.ok(
      cur.budget > prev.budget,
      `${cur.pages} (${cur.price} tanga) byudjeti ${prev.pages} (${prev.price} tanga) dan katta ` +
        `bo'lishi kerak, lekin ${cur.budget} <= ${prev.budget} — shift formulani o'ldirgan`,
    );
  }

  // Eng katta ish shiftga tegib turmasligi kerak: zaxira qolsin.
  const biggest = seen[seen.length - 1].budget;
  assert.ok(
    biggest < DEFAULT_JOB_TIMEOUT_MS,
    `40–45 bet (24 000 tanga) byudjeti ${biggest}ms, shift ${DEFAULT_JOB_TIMEOUT_MS}ms — ` +
      `shiftga tegib tursa formula yana o'ladi`,
  );

  // Eng uzun slayd paketi ham shiftga sig'ishi kerak (N-2 bilan bir tugun).
  const slide = budgetFor(TOOL_BY_ID.slide, { quality: "premium_long" } as FormValues, DEFAULT_JOB_TIMEOUT_MS);
  assert.ok(slide < DEFAULT_JOB_TIMEOUT_MS, `premium_long deka byudjeti: ${slide}ms`);
});

test("standart hajm narx, dvigatel va formada bir xil", async () => {
  const { TOOLS, TOOL_BY_ID, defaultPages, priceFor } = await import("../lib/tools.ts");
  const { extractMeta } = await import("../lib/generation/meta.ts");

  /*
   * AYNAN P1-7 (AUDIT-5). Standart hajm UCH joyda mustaqil yozilgan edi:
   * `priceFor`, `extractMeta` va formadagi `defaultsFor`. Ular ajralib
   * ketgan edi — maqola va tezisda narx «3–5 bet» (4 000 tanga) tarifidan
   * hisoblanar, dvigatel esa «10–15» (13 bet) yozardi. Ya'ni `pages` siz
   * yuborilgan so'rov 4 000 tangaga 13 betlik ish so'rardi.
   */
  const withPages = TOOLS.filter((t) => t.fields.some((f) => f.name === "pages"));
  assert.ok(withPages.length >= 5, "bet tanlovi bo'lgan vositalar topilishi kerak");

  for (const tool of withPages) {
    const fallback = defaultPages(tool.id);
    const options = tool.fields.find((f) => f.name === "pages")!.options ?? [];

    // 1) Standart formadagi haqiqiy tanlovlardan biri bo'lishi kerak.
    assert.ok(
      options.some((o) => o.value === fallback),
      `${tool.id}: standart «${fallback}» forma tanlovlari orasida yo'q`,
    );

    // 2) `pages` siz narx AYNAN shu tarifning narxi bo'lishi kerak.
    assert.equal(
      priceFor(tool, {} as FormValues),
      priceFor(tool, { pages: fallback } as FormValues),
      `${tool.id}: standart narx tarif narxiga teng bo'lishi kerak`,
    );

    // 3) `pages` siz dvigatel AYNAN shu tarifning hajmini yozishi kerak.
    assert.equal(
      extractMeta(tool, { topic: "X" } as FormValues).targetPages,
      extractMeta(tool, { topic: "X", pages: fallback } as FormValues).targetPages,
      `${tool.id}: standart hajm tarif hajmiga teng bo'lishi kerak`,
    );
  }

  // Aniq holat: maqola «3–5» tarifida qoladi, «10–15» ga sirg'alib ketmaydi.
  assert.equal(extractMeta(TOOL_BY_ID.article, { topic: "X" } as FormValues).targetPages, 4);
  assert.equal(extractMeta(TOOL_BY_ID.thesis, { topic: "X" } as FormValues).targetPages, 4);
});

test("kurs ishi prompti dvigatel so'ragan bob soniga mos keladi", async () => {
  const { courseworkSystemPrompt } = await import("../lib/generation/prompts.ts");
  const { outlineShape } = await import("../lib/generation/structure.ts");
  const { extractMeta } = await import("../lib/generation/meta.ts");
  const { TOOL_BY_ID } = await import("../lib/tools.ts");

  /*
   * AYNAN P1-10 (AUDIT-5). Promptda «uch bob» qattiq yozilgan edi,
   * `outlineShape` esa 23 betdan yuqorida 4, 33 betdan yuqorida 5 bob
   * so'rardi. Model bir vaqtning o'zida ikki xil ko'rsatma olardi:
   * reja to'rt bobli, prompt esa uch bob deb turardi.
   */
  for (const pages of ["10-15", "20-25", "25-30", "30-35", "40-45"]) {
    const meta = extractMeta(TOOL_BY_ID.coursework, { topic: "X", pages } as FormValues);
    const want = outlineShape(meta.targetPages, meta.toolId).chapters;
    const prompt = courseworkSystemPrompt(meta);

    assert.ok(
      prompt.includes(`${want} ta bob`),
      `${pages}: promptda «${want} ta bob» bo'lishi kerak`,
    );
    // Qattiq yozilgan son qaytib kelmasin.
    assert.ok(!/uch bob/i.test(prompt), `${pages}: promptda qattiq «uch bob» qolmasligi kerak`);
  }
});

test("uzun insho ko'proq burchak oladi — `n` o'lik emas", async () => {
  const { writeEssayWithLlm } = await import("../lib/generation/write-llm.ts");
  const { extractMeta } = await import("../lib/generation/meta.ts");
  const { TOOL_BY_ID } = await import("../lib/tools.ts");

  /*
   * AYNAN P1-3 (AUDIT-5). `writeEssayInChunks` `n` ni parametr sifatida
   * qabul qilar, lekin tanada UMUMAN ishlatmasdi: 3, 4 va 5 varaqlik
   * insho bir xil uchta burchakni olardi. 5 varaq uchun 4 000 tanga
   * to'lagan foydalanuvchi 3 varaqlik (3 000 tanga) ish bilan bir xil
   * chuqurlik olardi.
   *
   * Chuqurlik BURCHAK soni bilan o'lchanadi, paragraf bilan emas:
   * modeldan ko'p paragraf so'ralganda u ulushini beradi, yangi burchak
   * esa unga yangi savol beradi.
   *
   * O'lchov — bo'lim so'rovlari SONI, ya'ni tarmoq chaqiruvlari.
   */
  const realFetch = globalThis.fetch;
  const savedGemini = process.env.GEMINI_API_KEY;
  const savedXai = process.env.XAI_API_KEY;
  process.env.GEMINI_API_KEY = "test-key";
  delete process.env.XAI_API_KEY;

  const body = Array.from({ length: 4 }, (_, i) => `Bu ${i + 1}-paragraf. `.repeat(16)).join("\n\n");

  /** Bir insho yozadi va bo'lim sarlavhalarini qaytaradi. */
  async function sectionsFor(pages: string): Promise<string[]> {
    const titles: string[] = [];
    globalThis.fetch = (async (_url: string, init?: { body?: string }) => {
      const req = String(init?.body ?? "");
      const m = req.match(/Bo‘lim sarlavhasi \(matnga qayta yozilmasin\): ([^\\n"]+)/);
      if (m) titles.push(m[1]);
      return {
        ok: true,
        status: 200,
        json: async () => ({ candidates: [{ content: { parts: [{ text: body }] } }] }),
      } as never;
    }) as typeof fetch;

    const meta = extractMeta(TOOL_BY_ID.essay, { topic: "Ona tilim", pages } as FormValues);
    const doc = await writeEssayWithLlm(meta, Date.now() + 120_000);
    assert.ok(doc, `${pages} varaq: insho yozilishi kerak`);
    return titles;
  }

  try {
    const three = await sectionsFor("3");
    const four = await sectionsFor("4");
    const five = await sectionsFor("5");

    // Kirish + burchaklar + xulosa.
    assert.equal(three.length, 5, `3 varaq: 3 burchak kutilgan, chiqdi ${three.join(",")}`);
    assert.equal(four.length, 6, `4 varaq: 4 burchak kutilgan, chiqdi ${four.join(",")}`);
    assert.equal(five.length, 7, `5 varaq: 5 burchak kutilgan, chiqdi ${five.join(",")}`);

    // Chuqurlik MONOTON o'sishi kerak — narx ham shunday o'sadi.
    assert.ok(three.length < four.length && four.length < five.length, "burchak soni o'sishi kerak");

    // Burchak sarlavhalari takrorlanmaydi (I, II, III, …).
    const roman = five.filter((t) => /^[IVX]+$/.test(t));
    assert.equal(new Set(roman).size, roman.length, "burchak sarlavhalari noyob bo'lishi kerak");
  } finally {
    globalThis.fetch = realFetch;
    if (savedGemini === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = savedGemini;
    if (savedXai !== undefined) process.env.XAI_API_KEY = savedXai;
  }
});
