import test from "node:test";
import assert from "node:assert/strict";
import {
  COURSEWORK_INTRO_PARTS,
  INDEPENDENT_INTRO_PARTS,
  REFERAT_INTRO_PARTS,
  WORK_GENRES,
  WORK_JUDGE_CRITERIA,
  normalizeWorkKind,
  normalizeWorkPages,
  pagesMid,
  pagesRange,
  workKindOf,
  workKindsOf,
} from "../lib/generation/work/registry.ts";
import { SUBJECT_PROFILES, SUBJECT_PROFILE_LIST, normalizeSubjectProfile } from "../lib/generation/work/subjects.ts";
import { WORK_GENRE_IDS, WORK_INTRO_PART_IDS, workGenreOfTool } from "../lib/generation/work/types.ts";
import { TOOL_BY_ID, priceFor } from "../lib/tools.ts";

/**
 * JANR × TUR REYESTRI (AUDIT-19 WP-A). Reyestr — dvigatelning
 * SPETSIFIKATSIYASI: prompt, skelet, hisobot va forma undan o'qiydi,
 * shuning uchun standart raqamlari (kirish 7 element, refsMin 15/5/8,
 * kirish 10–15 %, xulosa 2–4 bet) shu yerda qulflanadi.
 */

test("3 janr, har biri o'z turlari bilan; janr vosita id siga bog'langan", () => {
  assert.deepEqual([...WORK_GENRE_IDS], ["coursework", "referat", "independent"]);
  assert.deepEqual(workKindsOf("coursework").map((k) => k.id), ["theory", "applied", "project"]);
  assert.deepEqual(workKindsOf("referat").map((k) => k.id), ["informative", "analytic", "evaluative", "report"]);
  assert.deepEqual(workKindsOf("independent").map((k) => k.id), ["written"]);
  assert.equal(workGenreOfTool("coursework"), "coursework");
  assert.equal(workGenreOfTool("referat"), "referat");
  assert.equal(workGenreOfTool("mustaqil-ish"), "independent");
  assert.equal(workGenreOfTool("article"), null);
  for (const g of WORK_GENRE_IDS) assert.ok(TOOL_BY_ID[WORK_GENRES[g].toolId as "coursework"], `${g}: vosita topilmadi`);
});

test("kirish elementlari: kurs ishi 7, referat 3, mustaqil 4 — hammasi ma'lum id", () => {
  assert.equal(COURSEWORK_INTRO_PARTS.length, 7);
  assert.deepEqual(COURSEWORK_INTRO_PARTS, ["relevance", "aim", "tasks", "object", "subject", "methods", "structure"]);
  assert.equal(REFERAT_INTRO_PARTS.length, 3);
  assert.equal(INDEPENDENT_INTRO_PARTS.length, 4);
  for (const g of WORK_GENRE_IDS)
    for (const k of workKindsOf(g)) {
      assert.ok(k.introParts.length >= 3, `${k.id}: kirish elementlari kam`);
      for (const p of k.introParts) assert.ok(WORK_INTRO_PART_IDS.includes(p), `${k.id}: noma'lum element ${p}`);
    }
  // Kurs ishi referatdan KO'P element talab qiladi — janrlar ajralib turadi.
  assert.ok(workKindOf("coursework", "theory").introParts.length > workKindOf("referat", "informative").introParts.length);
});

test("hajm/ulush standartlari: kirish 10–15 %, xulosa kurs 2–4 bet / referat ≈1, refsMin 15/5+/8", () => {
  for (const g of WORK_GENRE_IDS)
    for (const k of workKindsOf(g)) {
      assert.deepEqual(k.introShare, [0.1, 0.15], `${k.id}: kirish ulushi standartdan chetda`);
      assert.ok(k.conclusionPages[0] > 0 && k.conclusionPages[1] >= k.conclusionPages[0], `${k.id}: xulosa beti`);
    }
  assert.deepEqual(workKindOf("coursework", "theory").conclusionPages, [2, 4]);
  assert.ok(workKindOf("referat", "informative").conclusionPages[1] <= 1.5, "referat xulosasi ≈1 bet");
  assert.equal(workKindOf("coursework", "theory").refsMin, 15);
  assert.ok(workKindOf("referat", "informative").refsMin >= 5);
  assert.equal(workKindOf("independent", "written").refsMin, 8);
});

/*
 * AUDIT-19 WP-E2: eski chip maydonlari `lib/tools.ts` dan `WorkComposer`
 * ga ko'chdi (`tool.fields === []`, forma `kind.pages` ni to'g'ridan-to'g'ri
 * reyestrdan o'qiydi — `components/forms/WorkComposer.tsx`). Shu sabab
 * bu test endi `tool.fields` bilan emas, `priceFor` (narx jadvali,
 * dvigatel bilan bir manba bo'lib QOLGAN yagona joy) bilan taqqoslaydi:
 * reyestrdagi HAR bir hajm paketi narx jadvalida BOR va qiymatlar
 * ketma-ket farqli (aks holda noma'lum paket asosiy narxga JIM tushib
 * qolardi — `priceFor` dagi `?? tool.basePrice`).
 */
test("hajm paketlari `lib/tools.ts priceFor` narx jadvali bilan AYNAN bir xil (narx va dvigatel bir manbadan)", () => {
  const pricesOf = (toolId: "coursework" | "referat" | "mustaqil-ish", pages: readonly string[]) =>
    pages.map((p) => priceFor(TOOL_BY_ID[toolId], { pages: p }));
  assert.deepEqual(pricesOf("coursework", workKindOf("coursework", "theory").pages), [12000, 14000, 16000, 18000, 20000, 22000, 24000]);
  assert.deepEqual(pricesOf("referat", workKindOf("referat", "informative").pages), [3000, 4000, 5000, 6000]);
  assert.deepEqual(pricesOf("mustaqil-ish", workKindOf("independent", "written").pages), [3000, 4000, 5000, 6000]);
});

test("bob shakli janrga mos: referat BO'LIMLAR (bob emas), kurs ishi 2 bob × 2 paragraf, mustaqil uch qismli", () => {
  for (const k of workKindsOf("referat")) assert.equal(k.shape, "sections", `${k.id}: referat bo'limlar bilan yoziladi`);
  assert.equal(workKindOf("coursework", "theory").shape, "theory-2x2");
  assert.equal(workKindOf("coursework", "theory").chapters.min, 2);
  assert.equal(workKindOf("coursework", "theory").paragraphsPerChapter.min, 2);
  assert.equal(workKindOf("coursework", "applied").shape, "review-experiment-results");
  assert.equal(workKindOf("independent", "written").shape, "theory-analysis-practice");
  // Doklad — aynan 3 qism.
  assert.deepEqual(workKindOf("referat", "report").chapters, { min: 3, max: 3 });
});

test("guidance: har turda ≥3 qator, INGLIZCHA, qo'shni turdan FARQ qiladi (nusxa emas)", () => {
  const seen = new Map<string, string>();
  for (const g of WORK_GENRE_IDS)
    for (const k of workKindsOf(g)) {
      assert.ok(k.guidance.length >= 3, `${k.id}: guidance ${k.guidance.length} qator (≥3 kerak)`);
      for (const line of k.guidance) assert.ok(line.length > 60 && /[a-z]/.test(line), `${k.id}: guidance qatori juda qisqa`);
      const key = k.guidance.join("|");
      const twin = seen.get(key);
      assert.ok(!twin, `${k.id} va ${twin}: guidance NUSXA — tur farqi yo'q`);
      seen.set(key, k.id);
    }
  // Referat «manba mazmuni» haqida, kurs ishi bob/paragraf haqida gapiradi.
  assert.match(workKindOf("referat", "informative").guidance.join(" "), /what new information|sources say/i);
  assert.match(workKindOf("coursework", "theory").guidance.join(" "), /numbered paragraphs|chapter/i);
});

test("judge spec: 5 mezon, o'zbekcha yorliq, rol «o'qituvchi», tur ta'riflari farqlanadi", () => {
  assert.deepEqual([...WORK_JUDGE_CRITERIA], ["logic", "depth", "style", "aimMatch", "originality"]);
  const theory = workKindOf("coursework", "theory").judge;
  assert.deepEqual([...theory.criteria], [...WORK_JUDGE_CRITERIA]);
  assert.match(theory.roleLine ?? "", /lecturer/i);
  assert.equal(theory.typeNoun, "work type");
  for (const c of WORK_JUDGE_CRITERIA) {
    assert.ok(theory.describe[c].length > 40, `${c}: ta'rif yo'q`);
    assert.ok(/[а-яА-ЯёЁa-zA-Z‘’']/.test(theory.labels[c]), `${c}: yorliq yo'q`);
  }
  // Informativ referatda «chuqurlik» — manba mazmunini ANIQ bayon qilish.
  const informative = workKindOf("referat", "informative").judge;
  assert.notEqual(informative.describe.depth, theory.describe.depth);
  assert.match(informative.describe.depth, /accurately|sources/i);
  // Doklad uslubi — og'zaki taqdimot registri.
  assert.match(workKindOf("referat", "report").judge.describe.style, /spoken|short sentences/i);
});

test("5 fan profili: guidance, research kvotasi, o'ng chegara, standart vizuallar", () => {
  assert.equal(SUBJECT_PROFILE_LIST.length, 5);
  assert.deepEqual(SUBJECT_PROFILE_LIST.map((p) => p.id), ["technical", "natural", "economic", "humanities", "legal"]);
  for (const p of SUBJECT_PROFILE_LIST) {
    assert.ok(p.guidance.length >= 2, `${p.id}: guidance kam`);
    assert.ok(p.research.kinds.length >= 3, `${p.id}: manba turlari kam`);
    assert.ok(p.rightMarginCm > 0);
  }
  // Huquqiy — normativ hujjat kvotasi eng katta; gumanitar — o'ng chegara 1,0.
  assert.equal(SUBJECT_PROFILES.legal.research.quota?.law, 5);
  assert.equal(SUBJECT_PROFILES.economic.research.quota?.law, 2);
  assert.equal(SUBJECT_PROFILES.economic.research.quota?.book, 4);
  assert.equal(SUBJECT_PROFILES.technical.research.quota?.book, 4);
  assert.equal(SUBJECT_PROFILES.technical.research.quota?.article, 6);
  assert.equal(SUBJECT_PROFILES.humanities.rightMarginCm, 1.0);
  for (const id of ["technical", "natural", "economic", "legal"] as const) assert.equal(SUBJECT_PROFILES[id].rightMarginCm, 1.5);
  // Iqtisodiy — jadval ustun, texnik — sxema ustun.
  assert.ok(SUBJECT_PROFILES.economic.defaultVisuals.tables > SUBJECT_PROFILES.economic.defaultVisuals.figures);
  assert.ok(SUBJECT_PROFILES.technical.defaultVisuals.figures > SUBJECT_PROFILES.technical.defaultVisuals.tables);
});

test("normalizatsiya: noma'lum tur/profil/paket standartga tushadi, boshqa janr turi ham", () => {
  assert.equal(normalizeWorkKind("coursework", "zzz"), "theory");
  assert.equal(normalizeWorkKind("referat", "zzz"), "informative");
  // Referat turi kurs ishida qabul qilinmaydi (janrlar aralashmasin).
  assert.equal(normalizeWorkKind("coursework", "informative"), "theory");
  assert.equal(normalizeSubjectProfile("zzz"), "humanities");
  assert.equal(normalizeSubjectProfile("legal"), "legal");
  const kind = workKindOf("referat", "informative");
  assert.equal(normalizeWorkPages(kind, "40-45"), "20-25", "referatda 40–45 yo'q — standart paketga tushadi");
  assert.equal(normalizeWorkPages(kind, "10-15"), "10-15");
  assert.deepEqual(pagesRange("25-30"), [25, 30]);
  assert.equal(pagesMid("25-30"), 28);
  assert.equal(pagesMid("zzz"), 13);
});
