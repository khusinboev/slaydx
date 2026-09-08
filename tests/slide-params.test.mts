import test from "node:test";
import assert from "node:assert/strict";
import { TOOL_BY_ID, priceFor } from "../lib/tools.ts";
import type { FormValues } from "../lib/types.ts";
import { extractMeta } from "../lib/generation/meta.ts";
import { budgetFor } from "../lib/generation/budget.ts";
import {
  PRO_SLIDE_MAX,
  PRO_SLIDE_MIN,
  PRO_SLIDE_PER_SLIDE,
  SLIDE_PARAMS,
  slideParamsFor,
  splitCsv,
} from "../lib/generation/slide-params.ts";
import { AUDIENCE_RULES, audienceRules, bodyRules } from "../lib/generation/slide-audience.ts";
import { purposeDefaults } from "../lib/generation/slide-purpose.ts";
import { slideSystem } from "../lib/generation/slide-prompt/index.ts";
import { SLIDE_TEMPLATE_BY_ID, expandBeats } from "../lib/generation/slide-templates.ts";
import { slideStageBudget, wantSlides } from "../lib/generation/slide-write.ts";

/**
 * PARAMETR SHARTNOMASI — «bezak maydon yo'q» kafolati (AUDIT-9).
 *
 * WP-0a: reyestr tuzilishi, `extractMeta` klamplari va 0a allaqachon
 * ulagan parametrlarning PROMPTGA ta'siri. Maket (`planSlide` opts),
 * rasm prompti va tadqiqot zondlari WP-0b/E/D da qo'shiladi.
 */

const slide = TOOL_BY_ID.slide;
const pro = TOOL_BY_ID["pro-slide"];
const lecture = SLIDE_TEMPLATE_BY_ID.lecture;
const meta = (v: FormValues, tool = pro) => extractMeta(tool, { topic: "Suv aylanishi", ...v });
const prompt = (v: FormValues) => slideSystem(meta(v), lecture);

// ───────────────────────────────────────────── reyestr tuzilishi

test("reyestr: id lar noyob, har parametrda ta'sir va ikki xil zond bor", () => {
  const ids = new Set<string>();
  for (const p of SLIDE_PARAMS) {
    assert.ok(!ids.has(p.id), `${p.id}: takror`);
    ids.add(p.id);
    assert.ok(p.impacts.length > 0, `${p.id}: ta'sir e'lon qilinmagan — bezak maydon`);
    assert.notEqual(p.probeA, p.probeB, `${p.id}: zond qiymatlari bir xil`);
    assert.ok(p.tools.length > 0, `${p.id}: vositasiz`);
  }
  assert.ok(slideParamsFor("pro-slide").length > slideParamsFor("slide").length, "pro brifi oddiydan boy");
  assert.ok(slideParamsFor("slide").some((p) => p.id === "quality"), "oddiyda paket qoladi");
  assert.ok(!slideParamsFor("pro-slide").some((p) => p.id === "quality"), "pro da paket yo'q — slayder");
});

// ───────────────────────────────────────────── extractMeta klamplari

test("pro-slide: slaydlar soni slayderdan, 4–30 ga qisiladi, narx har slaydga", () => {
  assert.equal(meta({ slideCount: 17 }).targetPages, 17);
  assert.equal(meta({ slideCount: 1 }).targetPages, PRO_SLIDE_MIN);
  assert.equal(meta({ slideCount: 99 }).targetPages, PRO_SLIDE_MAX);
  assert.equal(meta({ slideCount: "abc" }).targetPages, 12, "buzuq qiymat — standart");
  // `quality` pro'da e'tiborsiz — paket emas, slayder.
  assert.equal(meta({ slideCount: 8, quality: "premium_long" }).targetPages, 8);
  assert.equal(priceFor(pro, { slideCount: 17 }), 17 * PRO_SLIDE_PER_SLIDE);
  assert.equal(priceFor(pro, { slideCount: 4 }), 8000);
  assert.equal(priceFor(pro, { slideCount: 30 }), 60000);
  assert.equal(priceFor(pro, { slideCount: 99 }), 60000, "narx ham qisiladi — deka bilan ajralmasin");
  // Oddiy vosita o'zgarmagan.
  assert.equal(priceFor(slide, { quality: "premium_long" }), 8000);
  assert.equal(meta({ quality: "long" }, slide).targetPages, 14);
});

test("yangi maydonlar oddiy formada ham standart qiymat bilan keladi", () => {
  const m = meta({}, slide);
  assert.equal(m.slidePurpose, "general");
  assert.deepEqual(m.blocks, ["reja"]);
  assert.equal(m.planItems, 5);
  assert.equal(m.agendaSlide, true);
  assert.equal(m.textVolume, "standart");
  assert.equal(m.quizCount, 0);
  assert.equal(m.internetSearch, false);
  assert.equal(m.speakerNotes, true);
  assert.equal(m.slideImageStyle, "photo");
  assert.equal(m.localExamples, false);
  assert.deepEqual(m.keyIdeas, []);
  assert.equal(m.logoAssetId, "");
  assert.equal(m.position, "");
});

test("keyIdeas: csv, 3 tagacha, 4-si tushib qoladi, uzuni kesiladi", () => {
  const m = meta({ keyIdeas: "birinchi, ikkinchi\nuchinchi, to‘rtinchi" });
  assert.deepEqual(m.keyIdeas, ["birinchi", "ikkinchi", "uchinchi"]);
  assert.equal(meta({ keyIdeas: "x".repeat(300) }).keyIdeas[0].length, 120);
  assert.deepEqual(splitCsv(" a ,, b ", 5, 10), ["a", "b"]);
});

test("blocks: yuborilmasa taqdimot turi standarti, yuborilsa oq ro'yxat, bo'sh satr — hech narsa", () => {
  assert.deepEqual(meta({ slidePurpose: "open_lesson" }).blocks, purposeDefaults("open_lesson").blocks);
  assert.deepEqual(meta({ slidePurpose: "lesson", blocks: "reja,test,xato_blok,adabiyotlar" }).blocks, ["reja", "test", "adabiyotlar"]);
  assert.deepEqual(meta({ slidePurpose: "lesson", blocks: "" }).blocks, [], "ataylab hammasi o'chirilgan");
  assert.equal(meta({ slidePurpose: "hech-qachon" }).slidePurpose, "general");
});

test("quizCount faqat ruxsat etilgan sonlarga tushadi; logo id regex bilan", () => {
  assert.equal(meta({ quizCount: 7 }).quizCount, 5);
  assert.equal(meta({ quizCount: 11 }).quizCount, 10);
  assert.equal(meta({ quizCount: 2 }).quizCount, 0);
  assert.equal(meta({ quizCount: 3 }).quizCount, 3);
  assert.equal(meta({ logoAssetId: "0123456789ABCDEF01234567" }).logoAssetId, "0123456789abcdef01234567");
  assert.equal(meta({ logoAssetId: "../etc/passwd" }).logoAssetId, "");
  assert.equal(meta({ planItems: 9 }).planItems, 6);
  assert.equal(meta({ planItems: 1 }).planItems, 3);
  assert.equal(meta({ textVolume: "juda-kop" }).textVolume, "standart");
  assert.equal(meta({ slideImageStyle: "oil" }).slideImageStyle, "photo");
});

// ───────────────────────────────────────────── auditoriya 14

test("14 auditoriya: eski id lar aliasga, auto shablondan, Slide Law poli saqlanadi", () => {
  assert.equal(Object.keys(AUDIENCE_RULES).length, 14);
  assert.equal(audienceRules("school", "lecture"), AUDIENCE_RULES.school_5_7);
  assert.equal(audienceRules("defense", "lecture"), AUDIENCE_RULES.students_master);
  assert.equal(audienceRules("auto", "lesson"), AUDIENCE_RULES.school_5_7);
  assert.equal(audienceRules("auto", "pitch"), AUDIENCE_RULES.management);
  assert.equal(audienceRules(undefined, "lecture"), AUDIENCE_RULES.students_bachelor);
  for (const [id, r] of Object.entries(AUDIENCE_RULES)) {
    assert.ok(r.minPt >= 15, `${id}: pol 15 pt dan past`);
    if (id.startsWith("school_")) assert.ok(r.minPt >= 18, `${id}: maktabda pol 18+`);
    assert.ok(r.note.length > 20 && r.label.length > 2, `${id}: prompt qatori/yorliq bo'sh`);
  }
});

test("textVolume band soni va uzunligini o'zgartiradi, shrift POLINI emas", () => {
  const q = bodyRules(meta({ textVolume: "qisqa" }), "lecture");
  const s = bodyRules(meta({ textVolume: "standart" }), "lecture");
  const k = bodyRules(meta({ textVolume: "kop" }), "lecture");
  assert.ok(q.bulletChars < s.bulletChars && s.bulletChars < k.bulletChars);
  assert.ok(q.maxBullets <= s.maxBullets && s.maxBullets <= k.maxBullets);
  // Slide Law: matn hajmi shriftga TEGMAYDI — `fitLines` o'zi oraliqda siqadi.
  assert.equal(q.minPt, s.minPt);
  assert.equal(k.minPt, s.minPt);
  assert.equal(k.bodyPt, s.bodyPt);
});

// ───────────────────────────────────────────── prompt differensiali (0a ulagan parametrlar)

test("speakerNotes=false promptdan notes talabini olib tashlaydi", () => {
  const on = prompt({ speakerNotes: true });
  const off = prompt({ speakerNotes: false });
  assert.match(on, /Har slaydda notes/);
  assert.match(off, /notes YOZMANG/);
  assert.doesNotMatch(off, /Har slaydda notes/);
});

test("textVolume, slideAudience, planItems, extra promptdagi sonlar/qatorlarni o'zgartiradi", () => {
  assert.notEqual(prompt({ textVolume: "qisqa" }), prompt({ textVolume: "kop" }), "textVolume promptni o'zgartirmadi");
  const a = prompt({ slideAudience: "school_1_4" });
  const b = prompt({ slideAudience: "students_master" });
  assert.notEqual(a, b);
  assert.match(a, /boshlang‘ich sinf/);
  assert.match(b, /magistrant/);
  assert.match(prompt({ planItems: 3 }), /agenda'da 3–3|agenda'da 2–3/);
  assert.match(prompt({ planItems: 6 }), /agenda'da 5–6/);
  assert.match(prompt({ extra: "ko‘proq diagramma" }), /Qo‘shimcha talab: ko‘proq diagramma/);
  // Ikki nuqta bilan: `base.ts` da «Qo‘shimcha talabni kicker qilmang» qatori ham bor.
  assert.doesNotMatch(prompt({ extra: "" }), /Qo‘shimcha talab: /);
});

// ───────────────────────────────────────────── slayd soni, byudjet

test("30 slayd dvigatelga to'liq yetadi — 20 chegarasi yo'q", () => {
  const m = meta({ slideCount: 30 });
  assert.equal(wantSlides(m, lecture), 30);
  assert.equal(expandBeats(lecture, wantSlides(m, lecture)).length, 30);
  assert.equal(expandBeats(lecture, wantSlides(meta({ slideCount: 4 }), lecture)).length, Math.max(4, lecture.beats.length) >= 10 ? 10 : 4);
});

test("byudjet: pro 30 slaydga yetadi, tadqiqot ulushi faqat so'ralganda", () => {
  assert.ok(budgetFor(pro, { slideCount: 30 }, 10_000_000) >= 540_000);
  assert.ok(budgetFor(pro, { slideCount: 30 }, 10_000_000) > budgetFor(pro, { slideCount: 4 }, 10_000_000));
  const now = 1_000_000;
  const plain = slideStageBudget(now + 300_000, now);
  const withResearch = slideStageBudget(now + 300_000, now, { research: true });
  assert.equal(plain.researchMs, 0);
  assert.ok(withResearch.researchMs > 0 && withResearch.researchMs <= 30_000);
  assert.ok(withResearch.textMs < plain.textMs, "tadqiqot matndan ulush oladi");
  assert.ok(withResearch.imageMs > 0, "rasm nolga tushmaydi");
});
