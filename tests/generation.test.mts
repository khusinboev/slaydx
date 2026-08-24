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
  // Kurs ishida esa aksincha — uch bob talab qilinadi.
  assert.match(coursework, /uch bob/i);
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
