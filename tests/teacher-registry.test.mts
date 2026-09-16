import test from "node:test";
import assert from "node:assert/strict";
import {
  DIFFICULTY_MIX,
  TEACHER_RULE_IDS,
  TEACHER_TYPES,
  normalizeTeacherType,
  teacherDefaultTypeId,
  teacherKindOf,
  teacherTypeOf,
  teacherTypesOf,
} from "../lib/generation/teacher/registry.ts";
import {
  TEACHER_KINDS,
  TEACHER_LIMITS,
  TEACHER_TOOL_BY_KIND,
  TEACHER_TOOL_IDS,
  TEACHER_TOOL_LIST,
  TEST_VARIANT_CHOICES,
  TEST_VARIANT_DEFAULT,
  normalizeVariantCount,
  optionCountForGrade,
} from "../lib/generation/teacher/types.ts";
import { TOOL_BY_ID, TOOLS } from "../lib/tools.ts";
import { FIGURE_KINDS, SELECTABLE_FIGURE_KINDS } from "../lib/generation/types.ts";
import { buildFigure } from "../lib/generation/figures/index.ts";
import { teacherBudgetMs } from "../lib/generation/budget.ts";
import type { Figure } from "../lib/generation/types.ts";

/**
 * KIND × TUR REYESTRI (AUDIT-20 R0). Reyestr — dvigatelning
 * SPETSIFIKATSIYASI: prompt, skelet, hisobot va forma undan o'qiydi,
 * shuning uchun hisobotlardan (`docs/research/*.md` §3/§4) olingan
 * standart raqamlar shu yerda qulflanadi.
 *
 * Mutatsiyalar (har biri qizardi):
 *   1. `variantsDefault` 2 → 1  — «variant standarti 2» testi;
 *   2. `optionCountForGrade` dan 1–4-sinf shoxi olib tashlandi —
 *      «1–4-sinf 3 javob varianti» testi;
 *   3. `FigureSpec kind:"omr"` `SELECTABLE_FIGURE_KINDS` ga qo'shildi —
 *      «omr tanlanmaydigan tur» testi;
 *   4. `buildFigure` dagi `omr` shoxi o'chirildi (fallback yo'liga
 *      tushdi) — «OMR fallback ham, xato ham emas» testi.
 */

test("5 kind, har biri o'z vositasiga bog'langan; xarita ikki tomonlama", () => {
  assert.deepEqual([...TEACHER_KINDS], ["lesson", "map", "glossary", "keys", "test"]);
  assert.deepEqual(TEACHER_TOOL_LIST, ["lesson-plan", "texnologik-xarita", "glossary", "keys", "test"]);
  for (const toolId of TEACHER_TOOL_LIST) {
    const kind = TEACHER_TOOL_IDS[toolId];
    assert.equal(teacherKindOf(toolId), kind, `${toolId}: kind topilmadi`);
    // Teskari yo'nalish AYNI vositaga qaytsin (ikki jadval ajralib ketmasin).
    assert.equal(TEACHER_TOOL_BY_KIND[kind], toolId, `${kind}: teskari xarita boshqa vositaga ketdi`);
    assert.ok(TOOL_BY_ID[toolId], `${toolId}: vosita ro'yxatda yo'q`);
    assert.equal(TOOL_BY_ID[toolId].custom, "teacher", `${toolId}: custom teacher emas`);
  }
  // O'qituvchi vositasi bo'lmagan id — `null` (dispatch adashmasin).
  assert.equal(teacherKindOf("coursework"), null);
  assert.equal(teacherKindOf("article"), null);
  assert.equal(teacherKindOf(""), null);
  /*
   * `teacher/` DVIGATELIDAGI har vosita reyestrda bo'lsin (yangi vosita
   * unutilmasin). Mezon — `custom: "teacher"`, guruh EMAS: AUDIT-21 dan
   * boshlab «O'qituvchi vositalari» bo'limida boshqa dvigateldagi vosita
   * ham bor (infografika — `infographic/engine.ts`, PNG plakat).
   */
  for (const t of TOOLS) if (t.custom === "teacher") assert.ok(teacherKindOf(t.id), `${t.id}: o'qituvchi vositasi reyestrda yo'q`);
  // Infografika o'qituvchi bo'limida, lekin `teacher` oilasida EMAS.
  assert.equal(teacherKindOf("infographic"), null, "infografika teacher dvigateliga tushib ketdi");
});

test("turlar ro'yxati hisobotlardan; standart — birinchi element", () => {
  assert.deepEqual(teacherTypesOf("lesson").map((t) => t.id), ["yangi-mavzu", "mustahkamlash", "amaliy", "nazorat", "aralash"]);
  assert.deepEqual(teacherTypesOf("map").map((t) => t.id), ["yillik", "choraklik"]);
  assert.deepEqual(teacherTypesOf("glossary").map((t) => t.id), ["fan-lugati", "mavzu-lugati", "uch-tilli", "imtihon-atamalari"]);
  assert.deepEqual(teacherTypesOf("keys").map((t) => t.id), ["muammoli", "tahliliy", "qaror-qabul-qilish", "rolli"]);
  assert.deepEqual(teacherTypesOf("test").map((t) => t.id), ["nazorat", "bsb", "chsb", "dtm", "olimpiada", "diagnostika"]);
  // Hisobot standartlari: dars — yangi mavzu, xarita — yillik, keys — muammoli, test — nazorat.
  assert.equal(teacherDefaultTypeId("lesson"), "yangi-mavzu");
  assert.equal(teacherDefaultTypeId("map"), "yillik");
  assert.equal(teacherDefaultTypeId("glossary"), "fan-lugati");
  assert.equal(teacherDefaultTypeId("keys"), "muammoli");
  assert.equal(teacherDefaultTypeId("test"), "nazorat");
  // Noma'lum / boshqa kindning turi → standart (narx va dvigatel bir qoidadan).
  assert.equal(normalizeTeacherType("lesson", "yo'q-bunday"), "yangi-mavzu");
  assert.equal(normalizeTeacherType("lesson", "bsb"), "yangi-mavzu", "test turi dars rejasiga o'tib ketdi");
  assert.equal(normalizeTeacherType("test", null), "nazorat");
  assert.equal(teacherTypeOf("map", "choraklik").id, "choraklik");
});

test("har turda id/yorliq/hint/skelet/guidance bo'sh emas; kind maydoni mos", () => {
  for (const kind of TEACHER_KINDS)
    for (const t of teacherTypesOf(kind)) {
      assert.equal(t.kind, kind, `${t.id}: kind maydoni ro'yxatdan farq qiladi`);
      assert.ok(/^[a-z0-9-]+$/.test(t.id), `${t.id}: id shakli`);
      for (const lang of ["uz", "ru", "en"] as const) assert.ok(t.label[lang].length >= 3, `${t.id}: ${lang} yorlig'i yo'q`);
      assert.ok(t.hint.length >= 10, `${t.id}: hint juda qisqa`);
      assert.ok(t.skeleton.length >= 3, `${t.id}: skelet ${t.skeleton.length} bo'lim`);
      // «Bezak guidance yo'q»: 3–5 qator, har biri jumla uzunligida va inglizcha.
      assert.ok(t.guidance.length >= 3 && t.guidance.length <= 5, `${t.id}: guidance ${t.guidance.length} qator`);
      for (const g of t.guidance) assert.ok(g.length >= 60, `${t.id}: guidance qatori juda qisqa — «${g}»`);
    }
  // Id lar kind ichida unikal.
  for (const kind of TEACHER_KINDS) {
    const ids = teacherTypesOf(kind).map((t) => t.id);
    assert.equal(new Set(ids).size, ids.length, `${kind}: takroriy tur id`);
  }
});

test("JudgeSpec: har turda 5 mezon, ta'rif va o'zbekcha yorliq bilan", () => {
  for (const kind of TEACHER_KINDS)
    for (const t of teacherTypesOf(kind)) {
      const j = t.judge;
      // Mezon nomlari kind bo'yicha turlicha (`JudgeSpec<C>` uniyasi) —
      // testda ularni satr kalit sifatida o'qiymiz.
      const describe = j.describe as Record<string, string>;
      const labels = j.labels as Record<string, string>;
      assert.equal(j.criteria.length, 5, `${t.id}: ${j.criteria.length} mezon (hisobot §4 — 5 ta)`);
      assert.equal(new Set(j.criteria).size, 5, `${t.id}: takroriy mezon`);
      for (const c of j.criteria as readonly string[]) {
        assert.ok(describe[c] && describe[c].length >= 40, `${t.id}/${c}: ta'rif yo'q yoki juda qisqa`);
        assert.ok(labels[c] && labels[c].length >= 5, `${t.id}/${c}: o'zbekcha yorliq yo'q`);
      }
      assert.ok(j.roleLine && j.roleLine.length > 20, `${t.id}: baholovchi roli yo'q`);
      assert.equal(j.typeLabel, j.typeLabel?.trim());
      assert.ok(j.typeLabel && j.typeLabel.length > 3, `${t.id}: typeLabel yo'q`);
    }
  // Testning mezonlari AYNAN R3 §4.2 dagilar (`answerCorrectness` — eng muhimi).
  assert.deepEqual([...teacherTypeOf("test", "nazorat").judge.criteria], ["answerCorrectness", "clarity", "distractors", "coverage", "levelFit"]);
  // `imtihon-atamalari` misolsiz → `exampleQuality` baholanmaydi.
  assert.deepEqual([...(teacherTypeOf("glossary", "imtihon-atamalari").judge.skip ?? [])], ["exampleQuality"]);
  assert.ok(!teacherTypeOf("glossary", "fan-lugati").judge.skip, "fan lug'atida misol baholanishi kerak");
});

test("chegaralar hisobot raqamlari bilan: bosqich, hafta, atama, keys, savol", () => {
  const L = TEACHER_LIMITS;
  for (const t of teacherTypesOf("lesson")) {
    const [lo, hi] = t.limits.stages;
    assert.ok(lo >= L.stagesMin && hi <= L.stagesMax && lo < hi, `${t.id}: bosqich ${lo}–${hi} umumiy ${L.stagesMin}–${L.stagesMax} dan chiqdi`);
    assert.ok(lo <= t.limits.stagesDefault && t.limits.stagesDefault <= hi, `${t.id}: standart bosqich soni chegaradan tashqarida`);
    assert.ok(t.limits.durations.includes(t.limits.durationDefault), `${t.id}: standart davomiylik ro'yxatda yo'q`);
    for (const d of t.limits.durations) assert.ok(d >= L.durationMin && d <= L.durationMax, `${t.id}: ${d} daqiqa`);
  }
  // Nazorat darsida «yangi mavzu tushuntirish» yo'q — bosqich soni kamroq.
  assert.ok(teacherTypeOf("lesson", "nazorat").limits.stages[1] < teacherTypeOf("lesson", "yangi-mavzu").limits.stages[1]);

  for (const t of teacherTypesOf("map")) {
    assert.deepEqual([...t.limits.weeks], [L.weeksMin, L.weeksMax], `${t.id}: hafta chegarasi`);
  }
  assert.equal(teacherTypeOf("map", "yillik").limits.tables, 1);
  assert.equal(teacherTypeOf("map", "choraklik").limits.tables, L.quarters, "choraklik — 4 jadval");

  for (const t of teacherTypesOf("glossary")) {
    assert.deepEqual([...t.limits.terms], [10, 20, 40], `${t.id}: atama chiplari narx jadvali bilan bir xil bo'lsin`);
    assert.ok(t.limits.terms.includes(t.limits.termsDefault), `${t.id}: standart atama soni chiplarda yo'q`);
    assert.ok(t.limits.termsMin >= L.termsMin, `${t.id}: minimal atama soni`);
    assert.ok(t.limits.defChars[0] >= L.defCharsMin && t.limits.defChars[1] <= L.defCharsMax, `${t.id}: ta'rif uzunligi`);
  }
  // Tor mavzuda 40 ta chinakam atama topilmasligi mumkin (R2) — minimum pastroq.
  assert.ok(teacherTypeOf("glossary", "mavzu-lugati").limits.termsMin < teacherTypeOf("glossary", "fan-lugati").limits.termsMin);
  // Uch tilli — qo'shimcha ustunlar; qolganlarda yo'q.
  assert.deepEqual([...teacherTypeOf("glossary", "uch-tilli").limits.translationLangs], ["ru", "en"]);
  assert.equal(teacherTypeOf("glossary", "fan-lugati").limits.translationLangs.length, 0);

  for (const t of teacherTypesOf("keys")) {
    assert.deepEqual([...t.limits.cases], [3, 5, 8], `${t.id}: keys soni`);
    assert.equal(t.limits.rubricTotal, L.rubricTotal, `${t.id}: rubrika yig'indisi 10 bo'lishi shart`);
    assert.deepEqual([...t.limits.questions], [L.caseQuestionsMin, L.caseQuestionsMax], `${t.id}: topshiriq soni`);
    assert.deepEqual([...t.limits.rubric], [L.rubricMin, L.rubricMax], `${t.id}: rubrika mezonlari`);
  }

  for (const t of teacherTypesOf("test")) {
    assert.ok(t.limits.count.length >= 3, `${t.id}: savol soni tanlovi kam`);
    assert.ok(t.limits.count.includes(t.limits.countDefault), `${t.id}: standart savol soni tanlovda yo'q`);
    for (const c of t.limits.count) assert.ok(c >= L.questionsMin && c <= L.questionsMax, `${t.id}: ${c} savol chegaradan chiqdi`);
    assert.ok(t.limits.kinds.length >= 1, `${t.id}: savol turlari yo'q`);
    assert.ok(t.limits.timeMin.includes(t.limits.timeMinDefault), `${t.id}: standart vaqt tanlovda yo'q`);
    // Ochiq savol ulushi bo'lsa, `open` turi ham ruxsat etilgan bo'lishi kerak.
    if (t.limits.openShare > 0) assert.ok(t.limits.kinds.includes("open"), `${t.id}: openShare>0, lekin «open» turi yo'q`);
    // Qiyinlik taqsimoti 100 % (± yaxlitlash yo'q — foizlar qat'iy).
    const mix = t.limits.difficultyMix;
    assert.equal(mix.oson + mix.orta + mix.qiyin, 100, `${t.id}: qiyinlik taqsimoti 100 % emas`);
  }
  // BSB/ChSB — e'lon qilingan jami ball va mezon jadvali (R3 §3.1/3.7).
  assert.equal(teacherTypeOf("test", "bsb").limits.totalPoints, 50);
  assert.equal(teacherTypeOf("test", "chsb").limits.totalPoints, 40);
  assert.equal(teacherTypeOf("test", "nazorat").limits.totalPoints, null, "joriy nazoratda jami ball savol sonidan hisoblanadi");
  for (const id of ["bsb", "chsb"]) {
    assert.equal(teacherTypeOf("test", id).limits.criteriaTable, true, `${id}: mezon jadvali yoqilgan bo'lsin`);
    assert.equal(teacherTypeOf("test", id).limits.approver, true, `${id}: «Tasdiqlayman» qatori`);
  }
  assert.equal(teacherTypeOf("test", "nazorat").limits.approver, false, "joriy nazorat ishida «Tasdiqlayman» yo'q (R3 §3.7)");
  // DTM — faqat bitta to'g'ri javobli savol, qat'iy 4 variant.
  assert.deepEqual([...teacherTypeOf("test", "dtm").limits.kinds], ["single"]);
  assert.equal(teacherTypeOf("test", "dtm").limits.optionCountFixed, 4);
  // Qiyinlik profillari R3 §3.5 jadvalidan.
  assert.deepEqual(teacherTypeOf("test", "nazorat").limits.difficultyMix, DIFFICULTY_MIX.aralash);
  assert.deepEqual(teacherTypeOf("test", "dtm").limits.difficultyMix, DIFFICULTY_MIX.dtm);
  assert.deepEqual(teacherTypeOf("test", "olimpiada").limits.difficultyMix, DIFFICULTY_MIX.qiyin);
  assert.deepEqual(teacherTypeOf("test", "diagnostika").limits.difficultyMix, DIFFICULTY_MIX.oson);
});

test("variant soni: tanlov 1/2/4, STANDART 2 — har test turida", () => {
  assert.deepEqual([...TEST_VARIANT_CHOICES], [1, 2, 4]);
  assert.equal(TEST_VARIANT_DEFAULT, 2, "MUTATSIYA: standart 1 ga tushsa A/B kaliti yo'qoladi");
  for (const t of teacherTypesOf("test")) {
    assert.deepEqual([...t.limits.variants], [1, 2, 4], `${t.id}: variant tanlovi`);
    assert.equal(t.limits.variantsDefault, 2, `${t.id}: standart variant soni 2 emas`);
  }
  // Noma'lum/soxta qiymat — standartga tushadi, 0 yoki 3 ga emas.
  assert.equal(normalizeVariantCount(3), 2);
  assert.equal(normalizeVariantCount(0), 2);
  assert.equal(normalizeVariantCount("4"), 4);
  assert.equal(normalizeVariantCount(undefined), 2);
  assert.equal(normalizeVariantCount(1), 1);
});

test("1–4-sinfda 3 javob varianti, 5–11-sinfda 4 ta (R3 §3.3)", () => {
  for (const g of [1, 2, 3, 4]) assert.equal(optionCountForGrade(g), 3, `${g}-sinf: 3 variant bo'lishi kerak`);
  for (const g of [5, 7, 9, 11]) assert.equal(optionCountForGrade(g), 4, `${g}-sinf: 4 variant`);
  // Sinf ko'rsatilmagan (OTM/keys auditoriyasi) → 4.
  assert.equal(optionCountForGrade(0), 4);
  assert.equal(optionCountForGrade(Number.NaN), 4);
  assert.equal(TEACHER_LIMITS.optionsMin, 3);
  assert.equal(TEACHER_LIMITS.optionsMax, 4);
});

test("hisobot qoidalari: har kindda ro'yxat bor, id lar unikal, test ≥19 qoida", () => {
  for (const kind of TEACHER_KINDS) {
    const ids = TEACHER_RULE_IDS[kind];
    assert.ok(ids.length >= 6, `${kind}: ${ids.length} qoida — hisobot §4 dan kam`);
    assert.equal(new Set(ids).size, ids.length, `${kind}: takroriy qoida id`);
    for (const id of ids) assert.ok(/^[a-zA-Z]+$/.test(id), `${kind}/${id}: qoida id shakli`);
  }
  // R3 §4.1 — testda eng ko'p qoida, shu jumladan halollik qoidalari.
  assert.ok(TEACHER_RULE_IDS.test.length >= 19, `test: ${TEACHER_RULE_IDS.test.length} qoida`);
  for (const id of ["sourceGrounded", "curriculumCoverage", "keyMatchesVariants", "variantParity", "omrFits", "noBlanketOption"])
    assert.ok(TEACHER_RULE_IDS.test.includes(id), `test: «${id}» qoidasi yo'q`);
  assert.ok(TEACHER_RULE_IDS.glossary.includes("noStubDefinition"), "glossariy: tavtologiya qoidasi (R2 tavsiyasi)");
  assert.ok(TEACHER_RULE_IDS.lesson.includes("minutesSum"), "dars: daqiqa yig'indisi qoidasi");
  assert.ok(TEACHER_RULE_IDS.map.includes("hoursSum"), "xarita: soat yig'indisi qoidasi");
  assert.ok(TEACHER_RULE_IDS.keys.includes("rubricSum"), "keys: rubrika yig'indisi qoidasi");
  // Reyestr har kindni qamraydi (yangi kind qo'shilsa qoidasiz qolmasin).
  assert.deepEqual(Object.keys(TEACHER_RULE_IDS).sort(), [...TEACHER_KINDS].sort());
  assert.deepEqual(Object.keys(TEACHER_TYPES).sort(), [...TEACHER_KINDS].sort());
});

test("OMR — TANLANMAYDIGAN sxema turi; `buildFigure` uni o'tkazib yuboradi", async () => {
  /*
   * OMR ni MODEL tuzmaydi (dvigatel savol sonidan quradi), shuning
   * uchun u na `FIGURE_KINDS` da, na formadagi `SELECTABLE_FIGURE_KINDS`
   * da bo'lishi kerak — aks holda maqola/kurs ishi formasida «javob
   * varag'i» sxemasi tanlovi paydo bo'lardi.
   */
  assert.ok(!(FIGURE_KINDS as readonly string[]).includes("omr"), "MUTATSIYA: omr FIGURE_KINDS ga qo'shildi");
  assert.ok(!(SELECTABLE_FIGURE_KINDS as readonly string[]).includes("omr"), "MUTATSIYA: omr formada tanlanadigan bo'lib qoldi");
  assert.equal(FIGURE_KINDS.length, SELECTABLE_FIGURE_KINDS.length + 2, "prisma/chart dan boshqa tanlanmaydigan tur paydo bo'ldi");

  const omr: Figure = {
    id: "omr-1",
    kind: "scheme",
    caption: "Javoblar varag'i",
    spec: { kind: "omr", count: 20, optionCount: 4, columns: 2, variantIds: ["A", "B"], idBoxes: 6, hasMulti: false },
    w: 0,
    h: 0,
  };
  const out = await buildFigure(omr, { lang: "uz" });
  // Chizuvchi WP-B da (`figures/omr.ts`): spec va sarlavha o'zgarmaydi, matn
  // fallback esa HECH QACHON yasalmaydi — bo'yaladigan doiralarni `li`
  // ro'yxat bilan ifodalab bo'lmaydi (PNG ning o'zi `teacher-omr` da).
  assert.deepEqual(out.spec, omr.spec);
  assert.equal(out.caption, omr.caption);
  assert.ok(!out.fallbackBlocks, "MUTATSIYA: omr shoxi olib tashlansa fallback matn ro'yxatiga aylanadi");
});

test("teacherBudgetMs: element soniga qarab (test 30 ≈ 200 s, xarita 34 hafta ≈ 240 s, sayqal +60 s)", () => {
  const test30 = teacherBudgetMs("test", 30, false);
  assert.ok(test30 >= 190_000 && test30 <= 210_000, `30 savol: ${test30} ms`);
  const map34 = teacherBudgetMs("map", 34, false);
  assert.ok(map34 >= 230_000 && map34 <= 250_000, `34 hafta: ${map34} ms`);
  // Sayqal AYNAN 60 s qo'shadi va standart bo'yicha YOQILGAN.
  assert.equal(teacherBudgetMs("test", 30) - test30, 60_000);
  assert.equal(teacherBudgetMs("test", 30), teacherBudgetMs("test", 30, true));
  // Ko'proq element — ko'proq vaqt (har kindda).
  for (const kind of TEACHER_KINDS) assert.ok(teacherBudgetMs(kind, 30) > teacherBudgetMs(kind, 5), `${kind}: hajm byudjetga ta'sir qilmadi`);
  // Buzuq kirish byudjetni nolga tushirmaydi.
  assert.ok(teacherBudgetMs("lesson", Number.NaN) > 0);
  assert.ok(teacherBudgetMs("glossary", -5) > 0);
});
