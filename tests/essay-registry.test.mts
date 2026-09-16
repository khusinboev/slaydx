import test from "node:test";
import assert from "node:assert/strict";
import {
  ESSAY_CONTEXTS,
  IELTS_LINKERS,
  essayBodyParagraphs,
  essayCitationPolicy,
  essayEpigraphPolicy,
  essayKindSpec,
  essayLanguage,
  essayWords,
} from "../lib/generation/essay/registry.ts";
import { ESSAY_CONTEXT_IDS, ESSAY_KIND_IDS, essayKindsOf, isEssayKindId } from "../lib/generation/essay/types.ts";

/**
 * INSHO REYESTRI (AUDIT-19 WP-D) — kontekst × tur shartnomasi.
 *
 * Mutatsiya: `ESSAY_KIND_IDS.school_dtm` dan `literary` olib tashlansa,
 * `academic.wordRange` 500–1 000 dan chiqsa, IELTS ga `uz` tili
 * qo'shilsa yoki `literary` dagi `citations: "work_only"` olib
 * tashlansa — quyidagi testlar qizaradi.
 */

test("uch kontekst, har birida beshta tur — ro'yxatlar to'liq", () => {
  assert.deepEqual([...ESSAY_CONTEXT_IDS], ["school_dtm", "academic", "ielts_task2"]);
  for (const id of ESSAY_CONTEXT_IDS) {
    const kinds = essayKindsOf(id);
    assert.equal(kinds.length, 5, `${id}: 5 tur kutiladi`);
    assert.equal(new Set(kinds).size, 5, `${id}: turlar takrorlanmasin`);
    for (const k of kinds) {
      assert.ok(isEssayKindId(id, k));
      assert.ok(ESSAY_CONTEXTS[id].kinds[k], `${id}/${k}: spetsifikatsiya bo'lishi kerak`);
    }
  }
  // «Esse» ≠ «insho»: maktabda adabiy insho, IELTS da opinion — turlar ajralgan.
  assert.ok(ESSAY_KIND_IDS.school_dtm.includes("literary"));
  assert.ok(ESSAY_KIND_IDS.ielts_task2.includes("opinion"));
  assert.ok(!(ESSAY_KIND_IDS.ielts_task2 as readonly string[]).includes("literary"));
});

test("har turda 3–5 qatorli inglizcha guidance", () => {
  for (const id of ESSAY_CONTEXT_IDS) {
    for (const k of essayKindsOf(id)) {
      const spec = essayKindSpec(id, k);
      assert.ok(spec.guidance.length >= 3 && spec.guidance.length <= 5, `${id}/${k}: ${spec.guidance.length} qator`);
      for (const g of spec.guidance) {
        assert.ok(g.length > 60, `${id}/${k}: qator juda qisqa`);
        // Ko'rsatmalar inglizcha — kirill/o'zbek diakritikasi bo'lmasin.
        assert.ok(!/[Ѐ-ӿ]/.test(g), `${id}/${k}: guidance inglizcha bo'lishi kerak`);
      }
      assert.ok(spec.label.uz && spec.label.ru && spec.label.en);
      assert.ok(spec.hint.length > 10);
    }
  }
});

test("baholovchi spetsifikatsiyasi — kontekst mezonlari va rollari", () => {
  const dtm = ESSAY_CONTEXTS.school_dtm.judge;
  assert.deepEqual([...dtm.criteria], ["content", "structure", "language", "literacy", "creativity"]);
  assert.match(dtm.roleLine ?? "", /DTM/);
  const academic = ESSAY_CONTEXTS.academic.judge;
  assert.deepEqual([...academic.criteria], ["thesis", "evidence", "structure", "language", "format"]);
  assert.match(academic.roleLine ?? "", /university writing instructor/);
  const ielts = ESSAY_CONTEXTS.ielts_task2.judge;
  assert.deepEqual([...ielts.criteria], ["tr", "cc", "lr", "gra"]);
  assert.match(ielts.roleLine ?? "", /IELTS examiner/);
  for (const spec of [dtm, academic, ielts]) {
    assert.equal(spec.typeNoun, "essay type");
    for (const c of spec.criteria) {
      assert.ok(spec.describe[c] && spec.describe[c].length > 30, `«${c}» ta'rifi yo'q`);
      assert.ok(spec.labels[c], `«${c}» yorlig'i yo'q`);
    }
  }
});

test("tillar — maktab uz, IELTS en, akademik uchchalasi", () => {
  assert.deepEqual([...ESSAY_CONTEXTS.school_dtm.languages], ["uz"]);
  assert.deepEqual([...ESSAY_CONTEXTS.ielts_task2.languages], ["en"]);
  assert.deepEqual([...ESSAY_CONTEXTS.academic.languages], ["uz", "ru", "en"]);
  // Ruxsat etilmagan til birinchi ruxsat etilganiga tushadi.
  assert.equal(essayLanguage("ielts_task2", "uz"), "en");
  assert.equal(essayLanguage("school_dtm", "en"), "uz");
  assert.equal(essayLanguage("academic", "ru"), "ru");
});

test("hajm: maktab varaqdan, akademik 500–1000, IELTS qat'iy 250–330", () => {
  const school = essayWords("school_dtm", { pages: 3 });
  assert.equal(school.aim, 690, "3 varaq × 230 so'z");
  assert.ok(school.min < school.aim && school.max > school.aim);

  // Varaq → so'z (1 varaq ≈ 250) va 500–1 000 chegarasi.
  assert.equal(essayWords("academic", { pages: 1 }).aim, 500, "250 so'z ham 500 ga ko'tariladi");
  assert.equal(essayWords("academic", { pages: 5 }).aim, 1000, "1 250 so'z 1 000 ga tushadi");
  assert.equal(essayWords("academic", { wordTarget: 800 }).aim, 800);
  const a = essayWords("academic", { wordTarget: 800 });
  assert.ok(a.min >= 500 && a.max <= 1000, `${a.min}–${a.max}`);

  // IELTS — foydalanuvchi hajmi ta'sir qilmaydi.
  assert.deepEqual(essayWords("ielts_task2", { pages: 5, wordTarget: 900 }), { min: 250, max: 330, aim: 280 });
});

test("adabiy insho — epigraf va faqat asar iqtibosi; qolganida iqtibos yo'q", () => {
  assert.equal(essayEpigraphPolicy("school_dtm", "literary"), "optional");
  assert.equal(essayEpigraphPolicy("school_dtm", "reflective"), "none");
  assert.equal(essayCitationPolicy("school_dtm", "literary"), "work_only");
  assert.equal(essayCitationPolicy("academic", "literary"), "work_only");
  assert.equal(essayCitationPolicy("academic", "argumentative"), "none");
  assert.equal(essayCitationPolicy("ielts_task2", "opinion"), "none");
  assert.ok(essayKindSpec("school_dtm", "literary").needsWork);
  assert.ok(!essayKindSpec("school_dtm", "reflective").needsWork);
});

test("tuzilma talablari va band rejasi kontekstga bog'liq", () => {
  assert.equal(ESSAY_CONTEXTS.school_dtm.thesisStatement, false);
  assert.equal(ESSAY_CONTEXTS.academic.thesisStatement, true);
  assert.equal(ESSAY_CONTEXTS.ielts_task2.thesisStatement, true);
  assert.equal(ESSAY_CONTEXTS.academic.topicSentences, true);
  // Titul varaq — faqat OTM akademik essesida (GOST).
  assert.equal(ESSAY_CONTEXTS.academic.titlePage, true);
  assert.equal(ESSAY_CONTEXTS.school_dtm.titlePage, false);
  assert.equal(ESSAY_CONTEXTS.ielts_task2.titlePage, false);
  // Kirish/xulosa ulushi 12–20 % — uchchala kontekstda.
  for (const id of ESSAY_CONTEXT_IDS) {
    assert.deepEqual(ESSAY_CONTEXTS[id].introShare, [0.12, 0.2]);
    assert.deepEqual(ESSAY_CONTEXTS[id].conclusionShare, [0.12, 0.2]);
  }
  // IELTS — 4–5 band (kirish + 2 tana + xulosa).
  const ielts = essayBodyParagraphs("ielts_task2", essayWords("ielts_task2", {}));
  assert.ok(ielts >= 2 && ielts <= 3, `IELTS tana bandi: ${ielts}`);
  const school = essayBodyParagraphs("school_dtm", essayWords("school_dtm", { pages: 5 }));
  assert.ok(school >= 4 && school <= ESSAY_CONTEXTS.school_dtm.paragraphs.max - 2, `5 varaq: ${school} tana bandi`);
  assert.ok(IELTS_LINKERS.length >= 10);
});
