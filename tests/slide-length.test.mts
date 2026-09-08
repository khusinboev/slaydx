import test from "node:test";
import assert from "node:assert/strict";
import { TOOL_BY_ID } from "../lib/tools.ts";
import type { FormValues } from "../lib/types.ts";
import { extractMeta } from "../lib/generation/meta.ts";
import { blocksToBeats } from "../lib/generation/slide-blocks.ts";
import { finalizeQuiz } from "../lib/generation/slide-quiz.ts";
import { PRO_SLIDE_MAX, PRO_SLIDE_MIN, QUIZ_COUNTS } from "../lib/generation/slide-params.ts";
import { expandBeats } from "../lib/generation/slide-templates.ts";
import { fallbackSlides, resolveDeckTemplate, wantSlides } from "../lib/generation/slide-write.ts";
import type { SlideModel } from "../lib/generation/slide-types.ts";

/**
 * UZUNLIK SHARTNOMASI (X-3).
 *
 * `pro-slide` da narx = `slideCount × 2 000 tanga`. Ya'ni slaydlar
 * soni — bezak emas, HISOB-KITOB: unga rasm byudjeti (`budget.ts`),
 * matn bo'laklari (`writeSlidesWithLlm` CHUNK) va `delivered`
 * mexanizmi bog'langan. Shuning uchun bu fayl BITTA narsani qulflaydi:
 *
 *     yakuniy deka uzunligi === wantSlides(meta, tpl)
 *
 * Jonli sinovda 10 slayd so'ralgan deka 13 (quiz=3), 15 (quiz=5) va
 * 20 (quiz=10) bo'lib chiqqan edi — `finalizeQuiz` har savolni alohida
 * slaydga ajratar va yana `answers` qo'shardi, ya'ni uzunlik REJADAN
 * KEYIN o'sardi. «Ko'proq berish» yaxshilik emas: foydalanuvchi
 * ko'rgan raqam va to'lagan pul boshqa narsani va'da qiladi.
 *
 * Sinov REJADAN SLAYDGACHA bo'lgan to'liq yo'ldan o'tadi
 * (`wantSlides` → `expandBeats` → `blocksToBeats` → `fallbackSlides`
 * → `finalizeQuiz`), ya'ni bosqichlarning BIRIKMASI qulflanadi:
 * shartnoma aynan shu birikmada buzilgan edi.
 *
 * ESLATMA — `titleSlide: false`. Bu bayroq `wantSlides` da HISOBGA
 * OLINMAYDI: titul beat rejada qoladi va `fallbackSlides` /
 * `writeSlidesWithLlm` uni oxirida filtrlaydi, ya'ni deka `want − 1`
 * bo'ladi. Bu X-3 dan ALOHIDA nuqson (`wantSlides` — `slide-write.ts`
 * da, bu ish oqimining egaligidan tashqarida), shuning uchun supurish
 * uni standart (`true`) holatda qoldiradi va pastda alohida
 * hujjatlashtiriladi.
 */

const pro = TOOL_BY_ID["pro-slide"];

/** Supurish shablonlari — beats uzunligi va tarkibi bo'yicha har xil beshtasi. */
const TEMPLATES = ["lecture", "lesson", "report", "pitch", "defense"] as const;

function questions(n: number): NonNullable<SlideModel["quiz"]> {
  return Array.from({ length: n }, (_, i) => ({
    q: `Savol ${i + 1}?`,
    options: ["Birinchi", "Ikkinchi", "Uchinchi", "To‘rtinchi"],
    answer: i % 4,
  }));
}

type Built = { want: number; slides: SlideModel[]; layouts: string[] };

/**
 * Koordinatordagi (`buildSlideAcademicDoc`) chaqiruvlar ketma-ketligi.
 *
 * `perQuiz` — modelning har `quiz` slaydiga nechta savol yozgani.
 * Reja bittasini so'raydi, lekin model ko'p yozishi mumkin: aynan shu
 * holat ilgari dekani uzaytirardi, shuning uchun u supurishning
 * ikkinchi o'lchovi.
 */
function build(v: FormValues, perQuiz: number): Built {
  const meta = extractMeta(pro, { topic: "Suv aylanishi", ...v });
  const tpl = resolveDeckTemplate(meta);
  const want = wantSlides(meta, tpl);
  const beats = blocksToBeats(meta, tpl, expandBeats(tpl, want), want);
  const slides = fallbackSlides(meta, tpl, beats);
  for (const s of slides) if (s.layout === "quiz") s.quiz = questions(perQuiz);
  finalizeQuiz(slides, meta);
  return { want, slides, layouts: slides.map((s) => s.layout) };
}

const count = (b: Built, layout: string) => b.layouts.filter((l) => l === layout).length;

// ═══════════════════════════════════════════════════════ 1. SUPURISH

test("supurish: yakuniy deka uzunligi HAR DOIM wantSlides ga teng", () => {
  const fails: string[] = [];
  let cases = 0;
  for (let slideCount = PRO_SLIDE_MIN; slideCount <= PRO_SLIDE_MAX; slideCount += 1) {
    for (const quizCount of QUIZ_COUNTS) {
      for (const speakerNotes of [true, false]) {
        for (const agendaSlide of [true, false]) {
          for (const slideTemplate of TEMPLATES) {
            const v = { slideCount, quizCount, speakerNotes, agendaSlide, slideTemplate };
            /*
             * `perQuiz` ikki qiymatda: 1 — model rejaga rioya qilgan
             * holat; `quizCount` — model HAR slaydga so'ralgan sonni
             * yozib yuborgan holat (ilgari aynan shu deka uzunligini
             * savollar soniga ko'paytirardi).
             */
            for (const perQuiz of [1, Math.max(1, quizCount)]) {
              cases += 1;
              const b = build(v, perQuiz);
              if (b.slides.length !== b.want) {
                fails.push(`${slideTemplate}/n=${slideCount}/quiz=${quizCount}/izoh=${speakerNotes}/reja=${agendaSlide}/perQuiz=${perQuiz} → ${b.slides.length} (kutilgan ${b.want})`);
              }
            }
          }
        }
      }
    }
  }
  assert.ok(cases >= 2000, `supurish juda kichik: ${cases} holat`);
  assert.deepEqual(fails.slice(0, 12), [], `${fails.length}/${cases} holatda uzunlik buzildi:\n  ${fails.slice(0, 12).join("\n  ")}`);
});

test("supurish: quiz/answers slaydlari SO'RALGANDAN ko'p bo'lmaydi", () => {
  const fails: string[] = [];
  for (let slideCount = PRO_SLIDE_MIN; slideCount <= PRO_SLIDE_MAX; slideCount += 1) {
    for (const quizCount of QUIZ_COUNTS) {
      for (const speakerNotes of [true, false]) {
        for (const slideTemplate of TEMPLATES) {
          const b = build({ slideCount, quizCount, speakerNotes, slideTemplate }, Math.max(1, quizCount));
          const tag = `${slideTemplate}/n=${slideCount}/quiz=${quizCount}/izoh=${speakerNotes}`;
          const q = count(b, "quiz");
          const a = count(b, "answers");
          if (q > quizCount) fails.push(`${tag}: ${q} ta quiz slaydi (so'ralgan ${quizCount})`);
          if (quizCount > 0 && q < 1) fails.push(`${tag}: test so'ralgan, quiz slaydi yo'q`);
          if (a > 1) fails.push(`${tag}: ${a} ta answers slaydi`);
          if (speakerNotes !== false && a > 0) fails.push(`${tag}: izoh yoqiq, answers qo'yildi`);
          // Har quiz slaydida AYNAN bitta savol — maket qoidasi (WP-C).
          for (const s of b.slides) {
            if (s.layout === "quiz" && (s.quiz?.length ?? 0) !== 1) fails.push(`${tag}: quiz slaydida ${s.quiz?.length} savol`);
          }
        }
      }
    }
  }
  assert.deepEqual(fails.slice(0, 12), [], `${fails.length} buzilish:\n  ${fails.slice(0, 12).join("\n  ")}`);
});

// ═══════════════════════════════════════════ 2. quizCount va speakerNotes

test("quizCount: 0 — dekada quiz ham, answers ham yo'q", () => {
  for (const speakerNotes of [true, false]) {
    for (const slideTemplate of TEMPLATES) {
      for (const slideCount of [4, 10, 20, 30]) {
        const b = build({ slideCount, quizCount: 0, speakerNotes, slideTemplate }, 3);
        const tag = `${slideTemplate}/n=${slideCount}/izoh=${speakerNotes}`;
        assert.equal(count(b, "quiz"), 0, `${tag}: so'ralmagan quiz paydo bo'ldi`);
        assert.equal(count(b, "answers"), 0, `${tag}: so'ralmagan answers paydo bo'ldi`);
        assert.equal(b.slides.length, b.want, tag);
      }
    }
  }
});

test("speakerNotes: true — answers yo'q, javob NOTIQ IZOHIDA", () => {
  for (const quizCount of [3, 5, 10]) {
    const b = build({ slideCount: 20, quizCount, speakerNotes: true }, 1);
    assert.equal(count(b, "answers"), 0, `quiz=${quizCount}: izoh yoqiq, answers slaydi ortiqcha`);
    assert.equal(count(b, "quiz"), quizCount, `quiz=${quizCount}: savol soncha slayd bo'lishi kerak`);
    for (const s of b.slides.filter((x) => x.layout === "quiz")) {
      assert.match(s.notes ?? "", /^Javob: [ABCD] — /, `javob izohga yozilmadi: ${JSON.stringify(s.notes)}`);
    }
    assert.equal(b.slides.length, b.want);
  }
});

test("speakerNotes: false — AYNAN bitta answers, hamma quiz dan keyin va closing dan oldin", () => {
  for (const quizCount of [3, 5, 10]) {
    for (const slideTemplate of TEMPLATES) {
      // `perQuiz: 4` — javoblar A/B/C/D bo'yicha turlicha, ya'ni kalit
      // «hammasi A» bo'lib qolsa ham sezamiz.
      const b = build({ slideCount: 20, quizCount, speakerNotes: false, slideTemplate }, 4);
      const tag = `${slideTemplate}/quiz=${quizCount}`;
      assert.equal(count(b, "answers"), 1, `${tag}: aynan bitta answers bo'lishi kerak`);
      const at = b.layouts.indexOf("answers");
      assert.equal(at, b.slides.length - 2, `${tag}: answers closing dan darhol oldin turmadi`);
      assert.ok(at > b.layouts.lastIndexOf("quiz"), `${tag}: answers savollardan oldin tushdi`);
      assert.equal(b.layouts[b.slides.length - 1], "closing", tag);
      // Kalit SLAYDDAGI haqiqiy javoblardan yig'iladi, model yozgan matn emas.
      const onSlides = b.slides
        .filter((s) => s.layout === "quiz")
        .map((s, i) => `${i + 1} — ${"ABCD"[s.quiz![0].answer]}`);
      assert.deepEqual(b.slides[at].bullets, onSlides, `${tag}: kalit savollar javobiga mos emas`);
      assert.ok(new Set(onSlides.map((x) => x.slice(-1))).size > 1, `${tag}: kalitning hamma javobi bir xil — taqsimlash ishlamagan`);
      assert.equal(b.slides.length, b.want, tag);
    }
  }
});

// ═══════════════════════════════════════════════ 3. Chegara holatlari

test("kichik deka: 4 slayd + 10 savol — uzunlik baribir 4", () => {
  for (const speakerNotes of [true, false]) {
    for (const agendaSlide of [true, false]) {
      for (const slideTemplate of TEMPLATES) {
        const b = build({ slideCount: 4, quizCount: 10, speakerNotes, agendaSlide, slideTemplate }, 10);
        const tag = `${slideTemplate}/izoh=${speakerNotes}/reja=${agendaSlide}`;
        assert.equal(b.want, 4, tag);
        assert.equal(b.slides.length, 4, `${tag}: ${b.layouts.join(",")}`);
        // Test bloki butunlay yo'qolmaydi — kamida bitta savol qoladi.
        assert.ok(count(b, "quiz") >= 1, `${tag}: test so'ralgan, birorta savol slaydi qolmadi`);
        assert.equal(b.layouts[0], "title", tag);
        assert.equal(b.layouts[3], "closing", tag);
      }
    }
  }
});

/**
 * Sig'mas ekan — AVVAL javoblar kaliti tashlanadi.
 *
 * Tanlov sababi: javob HAR DOIM notiq izohiga yoziladi, ya'ni kalit
 * slaydi yo'qolsa ma'lumot yo'qolmaydi — u faqat SLAYDDA ko'rinmaydi.
 * Savol slaydini tashlash esa savolning o'zini yo'qotardi.
 */
test("sig'im: joy yetmasa avval kalit, keyin ortiqcha savollar tashlanadi", () => {
  const tight = build({ slideCount: 4, quizCount: 10, speakerNotes: false, slideTemplate: "lecture" }, 10);
  assert.equal(tight.slides.length, 4);
  assert.equal(count(tight, "answers"), 0, "kalit birinchi bo'lib tashlanishi kerak edi");
  assert.equal(count(tight, "quiz"), 1, "qolgan joyga bitta savol slaydi sig'adi");
  // Javob YO'QOLMAYDI — u izohda qoladi.
  assert.match(tight.slides.find((s) => s.layout === "quiz")!.notes ?? "", /^Javob: /);

  // Bir slayd kengroq deka — kalit qaytadi.
  const roomy = build({ slideCount: 5, quizCount: 10, speakerNotes: false, slideTemplate: "lecture" }, 10);
  assert.equal(roomy.slides.length, 5);
  assert.equal(count(roomy, "answers"), 1, "joy paydo bo'lgach kalit qaytishi kerak");
});

test("uzunlik quizCount va speakerNotes dan MUSTAQIL — narx bilan bir xil qoladi", () => {
  for (const slideTemplate of TEMPLATES) {
    for (const slideCount of [6, 10, 14, 22, 30]) {
      const lens = new Set<number>();
      for (const quizCount of QUIZ_COUNTS) {
        for (const speakerNotes of [true, false]) {
          lens.add(build({ slideCount, quizCount, speakerNotes, slideTemplate }, Math.max(1, quizCount)).slides.length);
        }
      }
      assert.deepEqual([...lens], [slideCount], `${slideTemplate}/n=${slideCount}: uzunlik brif bilan o'zgardi — ${[...lens].join(",")}`);
    }
  }
});

/**
 * `adabiyotlar` bloki bilan birga: `end` ankori saqlanadi.
 *
 * Javoblar kaliti `late`, manbalar `end` — ya'ni tartib
 * `…quiz, answers, references, closing` bo'lishi kerak. Kalit
 * `references` dan keyin tushsa, dekaning oxirgi mazmunli slaydi
 * «Adabiyotlar» emas, javob varag'i bo'lib qolardi.
 */
test("adabiyotlar bloki bilan: quiz → answers → references → closing", () => {
  for (const slideCount of [10, 16, 24]) {
    const b = build(
      { slideCount, quizCount: 3, speakerNotes: false, blocks: "reja,test,adabiyotlar", slideTemplate: "lecture" },
      1,
    );
    const tag = `n=${slideCount}`;
    assert.equal(b.slides.length, b.want, tag);
    const iQ = b.layouts.lastIndexOf("quiz");
    const iA = b.layouts.indexOf("answers");
    const iR = b.layouts.indexOf("references");
    assert.ok(iQ >= 0 && iA >= 0 && iR >= 0, `${tag}: ${b.layouts.join(",")}`);
    assert.ok(iQ < iA && iA < iR, `${tag}: tartib buzildi — ${b.layouts.join(",")}`);
    assert.equal(b.layouts[b.slides.length - 2], "references", `${tag}: references closing dan oldin turmadi`);
  }
});

/**
 * `titleSlide: false` — X-3 dan ALOHIDA, hali ochiq nuqson.
 *
 * `wantSlides` titul bayrog'ini bilmaydi, `fallbackSlides` esa titul
 * beat'ini filtrlaydi: deka `want − 1` chiqadi. Bu test uni QULFLAB
 * qo'yadi (tasodifan o'zgarib ketmasin) va shu bilan birga hujjat
 * bo'lib xizmat qiladi: tuzatish `wantSlides` da, ya'ni boshqa ish
 * oqimida. Test soni bo'yicha o'lchov: farq AYNAN bitta slayd —
 * savollar soniga bog'liq emas.
 */
test("titleSlide: false — deka aynan bitta slaydga qisqaradi (X-3 dan tashqari nuqson)", () => {
  for (const quizCount of QUIZ_COUNTS) {
    for (const speakerNotes of [true, false]) {
      const b = build({ slideCount: 12, quizCount, speakerNotes, titleSlide: false }, Math.max(1, quizCount));
      const tag = `quiz=${quizCount}/izoh=${speakerNotes}`;
      assert.equal(b.slides.length, b.want - 1, tag);
      assert.notEqual(b.layouts[0], "title", `${tag}: titul so'ralmagan edi`);
    }
  }
});
