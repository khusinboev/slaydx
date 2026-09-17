import test from "node:test";
import assert from "node:assert/strict";
import {
  AUDIO_RULE_IDS,
  AUDIO_TYPES,
  GREETING_JUDGE_CRITERIA,
  PODCAST_JUDGE_CRITERIA,
  audioDefaultTypeId,
  audioKindOf,
  audioTypeOf,
  audioTypesOf,
  normalizeAudioType,
} from "../lib/generation/audio/registry.ts";
import {
  AUDIO_KINDS,
  AUDIO_LIMITS,
  AUDIO_TOOL_BY_KIND,
  AUDIO_TOOL_IDS,
  AUDIO_TOOL_LIST,
  audioMinuteOptions,
  audioWordBudget,
  isAudioKind,
  isAudioToolId,
  normalizeAudioMinutes,
  normalizeSpeakerCount,
  scriptSeconds,
  scriptWords,
} from "../lib/generation/audio/types.ts";

/**
 * AUDIO REYESTRI (AUDIT-22 R0) — podkast + tabriknoma.
 *
 * Reyestr dvigatelning SPETSIFIKATSIYASI: prompt («TYPE RULES» =
 * `guidance`), skelet, hisobot qoidalari va forma undan o'qiydi, shuning
 * uchun `docs/research/{podcast,greeting}.md` §3/§4 raqamlari shu yerda
 * QULFLANADI.
 *
 * Mutatsiyalar (har biri qizardi):
 *   1. `AUDIO_LIMITS.wordsPerMinute` 150 → 120 — «so'z byudjeti» testi;
 *   2. tabriknoma daqiqa ro'yxatiga 5 qo'shildi (podkast bilan bir xil)
 *      — «tabriknoma 1–4, podkast 1–5» testi;
 *   3. `AUDIO_LIMITS.lineCharsMax` 900 → 1 200 (TTS bo'lagidan katta) —
 *      «replika TTS bo'lagiga sig'adi» testi;
 *   4. `AUDIO_RULE_IDS.greeting` dan `addresseeNamed` o'chirildi —
 *      «qoidalar ro'yxati to'liq» testi;
 *   5. `audioTypeOf` noma'lum tur uchun `undefined` qaytardi —
 *      «noma'lum tur standartga tushadi» testi;
 *   6. `GREETING_TYPES` boshiga `ustoz-kuni` qo'yildi — «standart janr
 *      umumiy» testi.
 */

test("2 kind, har biri o'z vositasiga bog'langan; xarita ikki tomonlama", () => {
  assert.deepEqual([...AUDIO_KINDS], ["podcast", "greeting"]);
  assert.deepEqual(AUDIO_TOOL_LIST, ["podcast", "greeting"]);
  for (const kind of AUDIO_KINDS) {
    const tool = AUDIO_TOOL_BY_KIND[kind];
    assert.equal(AUDIO_TOOL_IDS[tool], kind, `${kind}: xarita ikki tomonlama emas`);
    assert.ok(isAudioToolId(tool));
    assert.ok(isAudioKind(kind));
    assert.equal(audioKindOf(tool), kind);
  }
  // Boshqa oilaning vositasi bu dvigatelga tushmasin.
  assert.equal(audioKindOf("crossword"), null);
  assert.equal(audioKindOf("lesson-plan"), null);
  assert.ok(!isAudioToolId("podcast2"));
});

test("podkast 3 tur, tabriknoma 6 janr; har birida skelet va qoidalar bor", () => {
  assert.deepEqual(
    audioTypesOf("podcast").map((t) => t.id),
    ["tushuntirish", "intervyu", "savol-javob"],
  );
  assert.deepEqual(
    audioTypesOf("greeting").map((t) => t.id),
    ["umumiy", "ustoz-kuni", "tugilgan-kun", "bitiruv", "8-mart", "navroz"],
  );
  for (const kind of AUDIO_KINDS) {
    const seen = new Set<string>();
    for (const t of AUDIO_TYPES[kind]) {
      assert.equal(t.kind, kind, `${t.id}: kind mos emas`);
      assert.ok(!seen.has(t.id), `${t.id}: tur id takrorlandi`);
      seen.add(t.id);
      assert.ok(t.label.uz && t.label.ru && t.label.en, `${t.id}: uch tilli yorliq to'liq emas`);
      assert.ok(t.hint.length > 10, `${t.id}: forma izohi yo'q`);
      assert.ok(t.skeleton.length >= 4, `${t.id}: skelet juda qisqa`);
      // «TYPE RULES» — 3–5 qator, ingliz tilida (tizim prompti tilida).
      assert.ok(t.guidance.length >= 3 && t.guidance.length <= 5, `${t.id}: guidance ${t.guidance.length} qator`);
      // Tizim prompti ingliz tilida: kirill yoki o'zbek lotin harflari qolib ketmasin.
      for (const g of t.guidance) assert.ok(!/[\u0400-\u04FF]|o‘|g‘/.test(g), `${t.id}: guidance ingliz tilida emas — «${g.slice(0, 40)}»`);
    }
  }
});

test("standart tur — ro'yxatning birinchisi; tabriknomada u «umumiy»", () => {
  assert.equal(audioDefaultTypeId("podcast"), "tushuntirish");
  /*
   * MUTATSIYA: janr ro'yxati boshiga bayram turi qo'yilsa shu yer
   * qizaradi. «Umumiy» standart bo'lishi SHART: forma «sabab» chipi
   * bo'sh kelganda tabriknoma foydalanuvchi so'zidan yozilishi kerak,
   * aks holda hech kim so'ramagan «Ustozlar kuni» tabrigi chiqardi.
   */
  assert.equal(audioDefaultTypeId("greeting"), "umumiy");
  assert.equal(audioTypeOf("greeting", "umumiy").occasion, "", "umumiy janrda tayyor sabab bo'lmasligi kerak");
  assert.equal(audioTypeOf("greeting", "navroz").occasion, "Navro'z bayrami");
  // Noma'lum/bo'sh tur — standartga tushadi (xato bermaydi).
  for (const bad of ["", null, undefined, "yoq-tur", 42]) {
    assert.equal(normalizeAudioType("podcast", bad), "tushuntirish", `«${String(bad)}» standartga tushmadi`);
    assert.equal(audioTypeOf("greeting", bad).id, "umumiy");
  }
});

test("davomiylik: podkast 1–5, tabriknoma 1–4; noma'lum qiymat standartga tushadi", () => {
  assert.deepEqual([...AUDIO_LIMITS.podcastMinutes], [1, 2, 3, 4, 5]);
  assert.deepEqual([...AUDIO_LIMITS.greetingMinutes], [1, 2, 3, 4]);
  assert.deepEqual([...audioMinuteOptions("greeting")], [1, 2, 3, 4]);
  // MUTATSIYA: tabriknomaga 5 daqiqa qo'shilsa shu yer qizaradi.
  assert.ok(!AUDIO_LIMITS.greetingMinutes.includes(5), "tabriknoma 4 daqiqadan uzun bo'lmasin");
  assert.equal(normalizeAudioMinutes("podcast", 5), 5);
  assert.equal(normalizeAudioMinutes("greeting", 5), AUDIO_LIMITS.greetingMinutesDefault, "5 daqiqalik tabriknoma qabul qilindi");
  assert.equal(normalizeAudioMinutes("podcast", "3"), 3, "forma qiymati satr bo'lib keladi");
  for (const bad of [0, -1, 99, "uzun", null]) {
    assert.equal(normalizeAudioMinutes("podcast", bad), AUDIO_LIMITS.podcastMinutesDefault, `«${String(bad)}»`);
  }
  // Har turning chiplari kindning ro'yxatidan chiqmasin.
  for (const t of audioTypesOf("greeting")) assert.deepEqual([...t.limits.minutes], [1, 2, 3, 4], `${t.id}: chiplar boshqa`);
});

test("so'z byudjeti 150 so'z/daqiqa — prompt, hisobot va baho bitta qoidadan", () => {
  assert.equal(AUDIO_LIMITS.wordsPerMinute, 150);
  assert.equal(audioWordBudget(1), 150);
  assert.equal(audioWordBudget(5), 750);
  // Noto'g'ri qiymat 1 daqiqaga tushadi (nol so'zli ssenariy bo'lmasin).
  assert.equal(audioWordBudget(Number.NaN), 150);

  const script = [
    { speaker: "A", text: "Bugun nega ba'zi o'simliklar tunda gullaydi?" },
    { speaker: "B", text: "Qiziq savol — buning uchta asosiy sababi bor." },
  ];
  // 14 «so'z»: tire ham alohida token — bu ATAYLAB, chunki TTS uni ham
  // o'qiydi (pauza) va so'z byudjeti aynan aytiladigan matnni o'lchaydi.
  assert.equal(scriptWords(script), 14, "so'z sanog'i");
  assert.equal(scriptSeconds(script), Math.round((14 / 150) * 60));
  assert.equal(scriptWords([{ speaker: "A", text: "   " }]), 0, "bo'sh replika so'z bermaydi");
});

test("replika TTS bo'lagiga sig'adi; ovoz soni 1 yoki 2", () => {
  /*
   * MUTATSIYA: `lineCharsMax` ni 900 dan oshirish — replika TTS
   * bo'lagiga (`TTS_LIMITS.chunkChars`, `tts.md` §3) sig'masdan ikkiga
   * bo'linardi va pauza jumla o'rtasida qolardi.
   */
  assert.equal(AUDIO_LIMITS.lineCharsMax, 900);
  assert.ok(AUDIO_LIMITS.lineCharsMin < AUDIO_LIMITS.lineCharsMax);
  assert.ok(AUDIO_LIMITS.linesMin >= 3 && AUDIO_LIMITS.linesMax >= AUDIO_LIMITS.linesMin);

  assert.deepEqual([...AUDIO_LIMITS.speakers], [1, 2]);
  assert.equal(normalizeSpeakerCount(1), 1);
  assert.equal(normalizeSpeakerCount("2"), 2);
  assert.equal(normalizeSpeakerCount(3), AUDIO_LIMITS.speakersDefault, "3 ovozli podkast qabul qilindi");
  // Tabriknoma DOIM monolog (`greeting.md` §3).
  for (const t of audioTypesOf("greeting")) assert.equal(t.speakers, 1, `${t.id}: tabriknoma dialogga aylandi`);
  for (const t of audioTypesOf("podcast")) assert.equal(t.speakers, 2, `${t.id}: podkast turi monolog`);
});

test("baholovchi mezonlari va hisobot qoidalari to'liq (bezak qolmasin)", () => {
  assert.equal(PODCAST_JUDGE_CRITERIA.length, 5);
  assert.equal(GREETING_JUDGE_CRITERIA.length, 5);
  for (const kind of AUDIO_KINDS) {
    for (const t of AUDIO_TYPES[kind]) {
      const spec = t.judge;
      assert.ok(spec.criteria.length >= 3, `${t.id}: mezon kam`);
      for (const c of spec.criteria) {
        assert.ok(spec.describe[c] && spec.describe[c].length > 40, `${t.id}/${c}: tavsif yo'q yoki juda qisqa`);
        assert.ok(spec.labels[c], `${t.id}/${c}: o'zbekcha yorliq yo'q`);
      }
      assert.ok(spec.roleLine && spec.typeLabel && spec.typeNoun, `${t.id}: baholovchi roli to'liq emas`);
    }
  }

  /*
   * MUTATSIYA: qoidani ro'yxatdan o'chirish — hisobot paneli uni
   * kutmay qo'yardi va WP-A da jimgina yozilmay ketardi.
   */
  assert.deepEqual([...AUDIO_RULE_IDS.podcast], [
    "durationWords",
    "blockCount",
    "speakerBalance",
    "lineLength",
    "hookPresent",
    "closingPresent",
    "noWrittenOnly",
    "noFakeStats",
  ]);
  assert.deepEqual([...AUDIO_RULE_IDS.greeting], [
    "durationWords",
    "addresseeNamed",
    "occasionMatch",
    "lineLength",
    "closingPresent",
    "noWrittenOnly",
    "respectForm",
  ]);
  for (const kind of AUDIO_KINDS) {
    const ids = AUDIO_RULE_IDS[kind];
    assert.equal(new Set(ids).size, ids.length, `${kind}: qoida id takrorlandi`);
    assert.ok(ids.includes("durationWords"), `${kind}: davomiylik qoidasi yo'q — pul daqiqaga to'lanadi`);
    assert.ok(ids.includes("lineLength"), `${kind}: replika uzunligi qoidasi yo'q`);
  }
});
