import test from "node:test";
import assert from "node:assert/strict";
import { AUDIO_RULE_IDS } from "../lib/generation/audio/registry.ts";
import { AUDIO_LIMITS, type AudioLine, type AudioModel } from "../lib/generation/audio/types.ts";
import { audioChecks, audioUserNeeds, numbersIn, recipientOf, reviewAudio, WRITTEN_ONLY } from "../lib/generation/audio/review.ts";
import { audioInputFromValues, normalizeScript, normalizeSpeaker, splitLine } from "../lib/generation/audio/input.ts";
import { speakerShares, speechParts, wordRange, AUDIO_PAUSES } from "../lib/generation/audio/script.ts";
import { extractMeta } from "../lib/generation/meta.ts";
import { TOOLS } from "../lib/tools.ts";
import type { AcademicDoc } from "../lib/generation/types.ts";

/**
 * AUDIO HISOBOTI, KIRISHI VA SSENARIY QATLAMI (AUDIT-22 WP-A).
 *
 * Hisobot bandlarining id lari REYESTRDA qulflangan (`AUDIO_RULE_IDS`)
 * — birinchi test aynan shu mosligni tekshiradi, chunki panel va
 * avto-sayqal shu id larni biladi va bitta qoidani unutib qo'yish
 * jimgina o'tib ketardi.
 *
 * Mutatsiyalar (har biri qizardi):
 *   1. `durationWords` tolerantligi ±15 % dan ±50 % ga ko'tarildi —
 *      «3 daqiqalik byudjetda 120 so'z qizil» testi;
 *   2. `speakerBalance` replikalarni sanadi (so'zlar o'rniga) —
 *      «bir so'zli javoblar muvozanat bermaydi» testi;
 *   3. `noFakeStats` yillarni ham «uydirma» deb belgiladi — «bayram
 *      yili qizil band bermaydi» testi;
 *   4. `noFakeStats` faqat manba matnini ko'rdi (mavzuni emas) —
 *      «mavzudagi raqam halol» testi;
 *   5. `hookPresent` shablon ochilishni o'tkazib yubordi — «bugun biz
 *      … gaplashamiz» testi;
 *   6. `closingPresent` tugallanmagan gapni qabul qildi — «yakun
 *      o'rtada uzilgan» testi;
 *   7. `addresseeNamed` to'liq satrni izladi («Dilnoza opa») —
 *      «ism o'zagi bo'yicha topiladi» testi;
 *   8. `respectForm` boshqa tillarda ham «sen» izladi — «ruscha matnda
 *      qizil band yo'q» testi;
 *   9. `normalizeScript` uchinchi rolni qabul qildi — «faqat A/B»
 *      testi (uchinchi rol ovozsiz qolardi);
 *  10. `normalizeScript` uzun replikani KESDI (bo'lish o'rniga) —
 *      «matn yo'qolmaydi» testi;
 *  11. `speechParts` rol almashganda ham qisqa pauza qo'ydi — «rol
 *      almashinuvida uzunroq pauza» testi;
 *  12. `audioUserNeeds` tasdiqlanmagan tilni ko'rsatmadi — «qirg'iz
 *      tilida ogohlantirish» testi.
 */

/* ── yordamchilar ── */

const line = (speaker: string, text: string): AudioLine => ({ speaker, text });

/**
 * `n` so'zli replika — byudjet bandlarini aniq boshqarish uchun.
 *
 * So'zlarda RAQAM YO'Q (ataylab): `so'z1 so'z2 …` bo'lsa `noFakeStats`
 * bandi to'ldiruvchi matndagi indekslarni «uydirma statistika» deb
 * o'qib, boshqa testlarni yolg'on qizartirardi.
 */
const words = (speaker: string, n: number, tail = "."): AudioLine => line(speaker, `${Array.from({ length: n }, () => "so'z").join(" ")}${tail}`);

function podcastModel(script: AudioLine[], type = "tushuntirish"): AudioModel {
  return { v: 1, kind: "podcast", type, language: "uz", script };
}
function greetingModel(script: AudioLine[], type = "ustoz-kuni", language = "uz"): AudioModel {
  return { v: 1, kind: "greeting", type, language, script };
}

/** 8 replikali, byudjetga tushadigan podkast (2 daq = 300 so'z ±15 %). */
function goodPodcast(): AudioLine[] {
  const out: AudioLine[] = [line("A", "Nega imtihondan oldin tunni uyqusiz o'tkazish yordam bermaydi?")];
  for (let i = 0; i < 7; i++) out.push(words(i % 2 === 0 ? "B" : "A", 40));
  out.push(line("A", "Xulosa shu: uyqu xotirani mustahkamlaydi. Siz bugun nechada yotasiz?"));
  return out;
}

function docOf(model: AudioModel, o: { topic?: string; extra?: string } = {}): AcademicDoc {
  const tool = TOOLS.find((t) => t.id === (model.kind === "podcast" ? "podcast" : "greeting"))!;
  const meta = extractMeta(tool, { topic: o.topic ?? "Uyqu va xotira", extra: o.extra ?? "", language: model.language });
  return { meta: { ...meta, topic: o.topic ?? meta.topic, extra: o.extra ?? "" }, titlePage: false, toc: false, sections: [], audio: model };
}

const idsOf = (model: AudioModel, opts?: Parameters<typeof audioChecks>[1]) => audioChecks(model, opts).map((c) => c.id);
const levelOf = (model: AudioModel, id: string, opts?: Parameters<typeof audioChecks>[1]) => audioChecks(model, opts).find((c) => c.id === id)?.level;

/* ══════════════════════════ reyestr mosligi ══════════════════════════ */

test("hisobot bandlari REYESTR ro'yxati bilan aynan mos (podkast 8, tabriknoma 7)", () => {
  const p = idsOf(podcastModel(goodPodcast()), { minutes: 2 });
  assert.deepEqual([...p].sort(), [...AUDIO_RULE_IDS.podcast].sort(), "podkast bandlari reyestrdan farq qiladi");
  const g = idsOf(greetingModel([line("A", "Hurmatli Dilnoza opa, Sizni Ustozlar kuni bilan tabriklayman.")]), { minutes: 1, recipient: "Dilnoza opa" });
  assert.deepEqual([...g].sort(), [...AUDIO_RULE_IDS.greeting].sort(), "tabriknoma bandlari reyestrdan farq qiladi");
  // Takrorlanuvchi band bo'lmasin — panel ikkita bir xil qator chizardi.
  assert.equal(new Set(p).size, p.length);
});

/* ══════════════════════════ davomiylik ══════════════════════════ */

test("durationWords: ±15 % oraliq, undan tashqarida sariq/qizil", () => {
  assert.deepEqual(wordRange(300), { min: 255, max: 345 });
  const ok = podcastModel([words("A", 150), words("B", 150)]);
  assert.equal(levelOf(ok, "durationWords", { minutes: 2 }), "green");
  // 2 daq = 300 so'z: 260 so'z ±15 % ichida (255–345) — yashil.
  assert.equal(levelOf(podcastModel([words("A", 130), words("B", 130)]), "durationWords", { minutes: 2 }), "green");
  // MUTATSIYA 1: kengroq tolerantlik bilan 120 so'z ham o'tib ketardi.
  assert.equal(levelOf(podcastModel([words("A", 60), words("B", 60)]), "durationWords", { minutes: 2 }), "red");
  assert.equal(levelOf(podcastModel([words("A", 120), words("B", 120)]), "durationWords", { minutes: 2 }), "yellow");
  // Daqiqa BERILMASA turning standarti (podkast 2) olinadi.
  assert.equal(levelOf(ok, "durationWords"), "green");
});

/* ══════════════════════════ ovozlar muvozanati ══════════════════════════ */

test("speakerBalance SO'Z ulushini o'lchaydi (replika sonini emas)", () => {
  // A 10 marta bitta so'z, B bitta uzun replika: replika bo'yicha
  // «muvozanat» a'lo, so'z bo'yicha — A deyarli gapirmaydi.
  const script: AudioLine[] = [];
  for (let i = 0; i < 10; i++) {
    script.push(line("A", "Ha, tushunarli."), words("B", 30));
  }
  const shares = speakerShares(script);
  assert.ok(shares.A < 0.3, `A ulushi ${shares.A}`);
  // MUTATSIYA 2: replika sanalganda ulush 50/50 bo'lib, band yashil chiqardi.
  assert.equal(levelOf(podcastModel(script), "speakerBalance", { minutes: 5 }), "yellow");

  assert.equal(levelOf(podcastModel(goodPodcast()), "speakerBalance", { minutes: 2 }), "green");
  // Ikkinchi ovoz umuman yo'q — qizil.
  assert.equal(levelOf(podcastModel([words("A", 150), words("A", 150)]), "speakerBalance", { minutes: 2 }), "red");
});

/* ══════════════════════════ halollik ══════════════════════════ */

test("noFakeStats: manbada yo'q raqam qizil, YIL esa jazolanmaydi", () => {
  assert.deepEqual(numbersIn("73% va 1 200 kishi, 2026-yil"), ["73", "1200", "2026"]);

  const fake = podcastModel([line("A", "Tadqiqotlar 73 foizni ko'rsatadi."), words("B", 280)]);
  assert.equal(levelOf(fake, "noFakeStats", { minutes: 2, facts: "Uyqu va xotira" }), "red");

  // MUTATSIYA 3: yillar «uydirma» deb sanalsa, har tabrik/podkast
  // sanani aytgani uchun qizil bo'lardi.
  const year = podcastModel([line("A", "2026-yilda bu masala yana dolzarb."), words("B", 280)]);
  assert.equal(levelOf(year, "noFakeStats", { minutes: 2, facts: "Uyqu va xotira" }), "green");

  // MUTATSIYA 4: mavzu `facts` ga kirmasa, foydalanuvchining O'Z raqami
  // uydirma deb belgilanardi.
  const fromTopic = podcastModel([line("A", "Yer yuzasining 71 foizi suv."), words("B", 280)]);
  assert.equal(levelOf(fromTopic, "noFakeStats", { minutes: 2, facts: "Yer yuzasining 71 foizi suv bilan qoplangan" }), "green");
});

/* ══════════════════════════ kirish va yakun ══════════════════════════ */

test("hookPresent: shablon ochilish sariq, savol bilan boshlanish yashil", () => {
  // MUTATSIYA 5: tekshiruvsiz `podcast.md` §5 dagi «yomon misol» o'tib ketardi.
  const weak = podcastModel([line("A", "Assalomu alaykum, bugun biz muhim mavzu haqida gaplashamiz."), words("B", 280)]);
  assert.equal(levelOf(weak, "hookPresent", { minutes: 2 }), "yellow");
  assert.equal(levelOf(podcastModel(goodPodcast()), "hookPresent", { minutes: 2 }), "green");
  assert.equal(levelOf(podcastModel([]), "hookPresent", { minutes: 2 }), "red");
});

test("closingPresent: tugallanmagan oxirgi replika qizil", () => {
  // MUTATSIYA 6: model byudjetga urilib gap o'rtasida to'xtaganda
  // (jonli sinovlarda eng ko'p uchraydigan nuqson) band yashil qolardi.
  const cut = podcastModel([...goodPodcast().slice(0, -1), line("A", "Demak, uyqu xotirani mustahkamlaydi va shu sababli")]);
  assert.equal(levelOf(cut, "closingPresent", { minutes: 2 }), "red");
  assert.equal(levelOf(podcastModel(goodPodcast()), "closingPresent", { minutes: 2 }), "green");
});

/* ══════════════════════════ ovozga yaroqlilik ══════════════════════════ */

test("noWrittenOnly: havola, qavs, markdown va sahna ko'rsatmasi ushlanadi", () => {
  assert.ok(WRITTEN_ONLY.length >= 5);
  const cases = ["Batafsil https://example.uz saytida.", "Uyqu (ya'ni tunggi dam olish) muhim.", "**Muhim**: uyqu.", "[pauza] Keyin davom etamiz."];
  for (const text of cases) {
    const m = podcastModel([line("A", text), words("B", 290)]);
    assert.equal(levelOf(m, "noWrittenOnly", { minutes: 2 }), "yellow", text);
  }
  assert.equal(levelOf(podcastModel(goodPodcast()), "noWrittenOnly", { minutes: 2 }), "green");
});

/* ══════════════════════════ tabriknoma ══════════════════════════ */

test("addresseeNamed: ism O'ZAGI bo'yicha va BIRINCHI jumlada", () => {
  const good = greetingModel([line("A", "Hurmatli Dilnozaxon, Sizni Ustozlar kuni bilan chin qalbdan tabriklayman.")]);
  // MUTATSIYA 7: to'liq «Dilnoza opa» izlanganda bu yaxshi tabrik ham
  // qizil band olardi.
  assert.equal(levelOf(good, "addresseeNamed", { minutes: 1, recipient: "Dilnoza opa" }), "green");

  const late = greetingModel([line("A", "Sizni bayram bilan tabriklayman."), line("A", "Dilnoza opa, sog' bo'ling.")]);
  assert.equal(levelOf(late, "addresseeNamed", { minutes: 1, recipient: "Dilnoza opa" }), "yellow");

  const none = greetingModel([line("A", "Sizni bayram bilan tabriklayman.")]);
  assert.equal(levelOf(none, "addresseeNamed", { minutes: 1, recipient: "Dilnoza opa" }), "red");
  // «Kimga?» bo'sh — bu FOYDALANUVCHI ma'lumoti, qizil emas sariq.
  assert.equal(levelOf(none, "addresseeNamed", { minutes: 1, recipient: "" }), "yellow");
});

test("occasionMatch: janr o'zagi matnda bo'lsin; «umumiy» turda tekshirilmaydi", () => {
  const ok = greetingModel([line("A", "Dilnoza opa, Ustozlar va murabbiylar kuni muborak bo'lsin!")]);
  assert.equal(levelOf(ok, "occasionMatch", { minutes: 1, recipient: "Dilnoza opa" }), "green");
  const off = greetingModel([line("A", "Dilnoza opa, Sizni chin qalbdan tabriklayman va baxt tilayman!")]);
  assert.equal(levelOf(off, "occasionMatch", { minutes: 1, recipient: "Dilnoza opa" }), "yellow");
  // `umumiy` janrda sabab foydalanuvchi so'zlarida — band DOIM yashil.
  assert.equal(levelOf(greetingModel([line("A", "Tabriklayman!")], "umumiy"), "occasionMatch", { minutes: 1 }), "green");
});

test("respectForm faqat o'zbek tilida tekshiriladi", () => {
  const informal = greetingModel([line("A", "Dilnoza, seni bayram bilan tabriklayman!")]);
  assert.equal(levelOf(informal, "respectForm", { minutes: 1, recipient: "Dilnoza" }), "yellow");
  // Foydalanuvchi «sen» so'ragan bo'lsa — jazolanmaydi.
  assert.equal(levelOf(informal, "respectForm", { minutes: 1, recipient: "Dilnoza", facts: "do'stim, sen shaklida yoz" }), "green");
  // MUTATSIYA 8: ruscha matndagi «sen» bo'lagi (masalan «сентябрь»)
  // yolg'on sariq band berardi.
  const ru = greetingModel([line("A", "Дорогая Дилноза, поздравляю Вас с Днём учителя!")], "ustoz-kuni", "ru");
  assert.equal(levelOf(ru, "respectForm", { minutes: 1, recipient: "Дилноза" }), "green");
});

/* ══════════════════════════ kirish (input.ts) ══════════════════════════ */

test("normalizeScript: rollar faqat A/B, uzun replika BO'LINADI (kesilmaydi)", () => {
  const tool = TOOLS.find((t) => t.id === "podcast")!;
  const meta = extractMeta(tool, { topic: "Uyqu" });
  const input = audioInputFromValues("podcast", meta, { topic: "Uyqu", durationMin: 2, podcastType: "tushuntirish", language: "uz" });

  // MUTATSIYA 9: uchinchi rol saqlansa unga ovoz topilmasdi.
  const three = normalizeScript({ script: [{ speaker: "Host", text: "Birinchi savol nima?" }, { speaker: "Expert", text: "Mana javob, batafsil." }, { speaker: "Guest", text: "Men ham qo'shimcha qilaman." }] }, input);
  assert.ok(three);
  assert.deepEqual([...new Set(three.map((l) => l.speaker))], ["A", "B"]);
  assert.equal(three[2].speaker, "A", "uchinchi rol birinchi ovozga tushadi");

  // MUTATSIYA 10: kesilganda matnning oxiri butunlay yo'qolardi.
  const longText = `${"Bu juda uzun gap. ".repeat(60)}Oxirgi gap shu.`;
  const split = normalizeScript({ script: [{ speaker: "A", text: longText }] }, input);
  assert.ok(split);
  assert.ok(split.length > 1, "uzun replika bo'lakka ajratilishi kerak");
  assert.ok(split.every((l) => l.text.length <= AUDIO_LIMITS.lineCharsMax));
  assert.ok(split[split.length - 1].text.endsWith("Oxirgi gap shu."), "matn oxiri yo'qolmasin");
  assert.ok(split.every((l) => l.speaker === "A"), "bo'laklar bir xil rolda qoladi");

  assert.equal(normalizeScript({ script: [] }, input), null);
  assert.equal(normalizeScript(null, input), null);
  // Juda qisqa replika tashlanadi.
  assert.equal(normalizeScript({ script: [{ speaker: "A", text: "ha" }] }, input), null);
  assert.deepEqual(splitLine("qisqa", 900), ["qisqa"]);

  const seen = new Map<string, string>();
  assert.equal(normalizeSpeaker("Host", seen, 1), "A");
  assert.equal(normalizeSpeaker("Expert", seen, 1), "A", "monologda hamma rol A");
});

test("audioInputFromValues: rejim, janr va daqiqa server tomonida siqiladi", () => {
  const podcast = TOOLS.find((t) => t.id === "podcast")!;
  const meta = extractMeta(podcast, { topic: "Uyqu" });
  const i1 = audioInputFromValues("podcast", meta, { topic: "Uyqu", durationMin: 99, podcastType: "yo'q-tur", mode: "hack", sourceText: "matn", language: "uz" });
  assert.equal(i1.minutes, AUDIO_LIMITS.podcastMinutesDefault, "ruxsatsiz daqiqa standartga tushadi");
  assert.equal(i1.type, "tushuntirish", "noma'lum tur standartga tushadi");
  assert.equal(i1.mode, "topic", "noma'lum rejim `topic` ga tushadi");
  assert.equal(i1.sourceText, "", "`topic` rejimida manba matn O'QILMAYDI");
  assert.equal(i1.wordBudget, AUDIO_LIMITS.podcastMinutesDefault * AUDIO_LIMITS.wordsPerMinute);
  assert.equal(i1.speakers, 2);

  const i2 = audioInputFromValues("podcast", meta, { topic: "Uyqu", mode: "text", sourceText: "Tayyor matn", durationMin: 4, language: "ru" });
  assert.equal(i2.sourceText, "Tayyor matn");
  assert.equal(i2.minutes, 4);
  assert.equal(i2.language, "ru");

  const greeting = TOOLS.find((t) => t.id === "greeting")!;
  const gm = extractMeta(greeting, {});
  const g = audioInputFromValues("greeting", gm, { recipient: "Dilnoza opa", relation: "ustozim", occasion: "ustoz-kuni", durationMin: 5, language: "uz" });
  assert.equal(g.minutes, AUDIO_LIMITS.greetingMinutesDefault, "tabriknomada 5 daqiqa yo'q");
  assert.equal(g.occasion, "Ustozlar va murabbiylar kuni", "janr iborasi REYESTRDAN keladi");
  assert.equal(g.speakers, 1);
  assert.equal(g.mode, "topic");
});

/* ══════════════════════════ ssenariy → bo'laklar ══════════════════════════ */

test("speechParts: rol → ovoz indeksi, rol almashinuvida uzunroq pauza, oxirida pauza yo'q", () => {
  const script = [line("A", "Savol."), line("A", "Yana savol."), line("B", "Javob."), line("A", "Rahmat.")];
  const parts = speechParts(script);
  assert.deepEqual(parts.map((p) => p.voice), [0, 0, 1, 0]);
  // MUTATSIYA 11: bir xil pauza bo'lsa dialog «ikki monolog» bo'lib eshitilardi.
  assert.deepEqual(parts.map((p) => p.pauseMs), [AUDIO_PAUSES.lineMs, AUDIO_PAUSES.turnMs, AUDIO_PAUSES.turnMs, AUDIO_PAUSES.endMs]);
  assert.ok(AUDIO_PAUSES.turnMs > AUDIO_PAUSES.lineMs);

  // Uzun replika bo'laklarga ajraladi; ICHKI bo'laklar orasida pauza yo'q.
  const long = [line("A", `${"Uzun gap bor. ".repeat(80)}`)];
  const many = speechParts(long, { max: 200 });
  assert.ok(many.length > 1);
  assert.ok(many.slice(0, -1).every((p) => p.pauseMs === AUDIO_PAUSES.innerMs));
  assert.ok(many.every((p) => p.text.length <= 200));
});

/* ══════════════════════════ «Sizdan kutiladi» ══════════════════════════ */

test("userNeeds: tasdiqlanmagan ovoz tili va shaxsiy tafsilot ogohlantirishi", async () => {
  const ky = docOf(greetingModel([line("A", "Dilnoza opa, Ustozlar kuni muborak!")], "ustoz-kuni", "ky"), { topic: "Dilnoza opa — Ustozlar va murabbiylar kuni" });
  const review = await reviewAudio(ky, { judge: false, minutes: 1 });
  const ids = (review.userNeeds ?? []).map((n) => n.id);
  // MUTATSIYA 12: ogohlantirishsiz foydalanuvchi qirg'izcha matnni
  // qozoqcha talaffuzda eshitib, sababini bilmasdi.
  assert.ok(ids.includes("voice"), ids.join(","));
  assert.ok(ids.includes("personal"));

  const uz = docOf(podcastModel(goodPodcast()), { topic: "Uyqu va xotira" });
  const r2 = await reviewAudio(uz, { judge: false, minutes: 2 });
  assert.ok(!(r2.userNeeds ?? []).some((n) => n.id === "voice"), "o'zbek ovozi tasdiqlangan");
  assert.equal(recipientOf(ky), "Dilnoza opa");
  assert.equal(recipientOf(uz), "");
  assert.ok(audioUserNeeds(r2, { ...uz, audio: undefined }).length === 0);
});

/* ══════════════════════════ yakuniy hisobot ══════════════════════════ */

test("reviewAudio: ball 0–100, baholovchisiz ham bandlar to'liq; ssenariysiz 0", async () => {
  const doc = docOf(podcastModel(goodPodcast()), { topic: "Uyqu va xotira" });
  const r = await reviewAudio(doc, { judge: false, minutes: 2 });
  assert.ok(r.score > 0 && r.score <= 100, `ball ${r.score}`);
  // Qoidalar + 5 baholovchi mezoni.
  assert.equal(r.checks.filter((c) => !c.id.startsWith("judge:")).length, AUDIO_RULE_IDS.podcast.length);
  assert.equal(r.checks.filter((c) => c.id.startsWith("judge:") && !c.id.startsWith("judge:fix:")).length, 5);
  assert.equal(r.verifiedShare, 0, "audioda adabiyotlar ro'yxati yo'q — soxta 1 yozilmaydi");

  const empty = await reviewAudio({ ...doc, audio: undefined }, { judge: false });
  assert.equal(empty.score, 0);
  assert.equal(empty.checks[0].id, "durationWords");
});
