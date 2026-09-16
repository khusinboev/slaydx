import test from "node:test";
import assert from "node:assert/strict";
import type { AcademicDoc } from "../lib/generation/types.ts";
import type { DocReview } from "../lib/generation/report/types.ts";
import {
  groundedIn,
  infographicChecks,
  judgeText,
  numbersIn,
  reviewInfographic,
  specWords,
  targetsOf,
  SPEC_TARGET,
} from "../lib/generation/infographic/review.ts";
import { INFOGRAPHIC_RULE_IDS, infographicTypeOf } from "../lib/generation/infographic/registry.ts";
import { INFOGRAPHIC_LIMITS, type InfographicBlock, type InfographicSpec, type InfographicTypeId } from "../lib/generation/infographic/types.ts";
import { planInfographicPolish } from "../lib/generation/infographic/polish.ts";

/**
 * INFOGRAFIKA HISOBOTI (AUDIT-21 WP-C) — `reviewInfographic`.
 *
 * Hisobot §4 dagi o'nta deterministik band shu yerda qulflanadi.
 * HALOLLIK bandi (`sourceGrounded`) — eng muhimi: u RAQAMNI
 * foydalanuvchi bergan matn bilan solishtiradi, ya'ni «to'g'ri, lekin
 * berilmagan» foiz ham rad etiladi (hisobot §5 dagi «71% Yer yuzasi
 * suv» misoli).
 *
 * Mutatsiyalar (har biri qizardi):
 *   1. `groundedIn` doim `true` qaytardi — «o'ylab topilgan raqam qizil»;
 *   2. `noOverflow` bandi maketni qayta hisoblamay, doim yashil edi;
 *   3. `typeFields` dan `compare` ustun muvozanati olib tashlandi;
 *   4. `statPresent` `stat` turini tekshirmay qo'ydi;
 *   5. `infographicUserNeeds` dagi `source` shoxi olib tashlandi.
 */

/* ────────────────────────── namunalar ────────────────────────── */

const block = (id: string, extra: Partial<InfographicBlock> = {}): InfographicBlock => ({
  id,
  icon: "bulb",
  heading: `Sarlavha ${id}`,
  text: `${id} bloki aniq bir faktni bayon qiladi.`,
  ...extra,
});

function spec(type: InfographicTypeId = "list", over: Partial<InfographicSpec> = {}): InfographicSpec {
  const base: Record<InfographicTypeId, InfographicBlock[]> = {
    list: [block("b1"), block("b2"), block("b3"), block("b4")],
    process: [1, 2, 3, 4].map((n) => block(`b${n}`, { order: n })),
    compare: [block("b1", { side: "left" }), block("b2", { side: "right" }), block("b3", { side: "left" }), block("b4", { side: "right" })],
    stat: [1, 2, 3, 4].map((n) => block(`b${n}`, { stat: { value: `${n}0%`, label: "ulush" } })),
    timeline: [1, 2, 3, 4].map((n) => block(`b${n}`, { when: String(1990 + n) })),
    "cause-effect": [block("b1", { role: "cause" }), block("b2", { role: "cause" }), block("b3", { role: "effect" }), block("b4", { role: "effect" })],
    "map-structure": [block("b1"), block("b2"), block("b3"), block("b4")],
  };
  return { title: "Suv aylanishi", subtitle: "Chap — O'ng", type, blocks: base[type], palette: "indigo", size: "A4", language: "uz", ...over };
}

const docOf = (s: InfographicSpec, extra = ""): AcademicDoc =>
  ({
    meta: { toolId: "infographic", topic: s.title, language: s.language, extra } as AcademicDoc["meta"],
    titlePage: false,
    toc: false,
    sections: [],
    infographic: { v: 1, spec: s },
  }) as AcademicDoc;

const byId = <T extends { id: string }>(checks: T[], id: string): T | undefined => checks.find((c) => c.id === id);
const levelOf = (s: InfographicSpec, id: string, facts = "", want?: number) => byId(infographicChecks(s, facts, want), id)?.level;

/* ══════════════════════════ 1. qoidalar to'plami ══════════════════════════ */

test("qoidalar: reyestrdagi HAR band hisobotda chiqadi", () => {
  for (const type of ["list", "process", "compare", "stat", "timeline", "cause-effect", "map-structure"] as InfographicTypeId[]) {
    const ids = new Set(infographicChecks(spec(type), "10% 20% 30% 40%").map((c) => c.id));
    for (const rule of INFOGRAPHIC_RULE_IDS) {
      assert.ok(ids.has(rule), `${type}: «${rule}» bandi yo'q`);
    }
  }
});

test("qoidalar: to'g'ri plakatda hammasi YASHIL", () => {
  const checks = infographicChecks(spec("list"), "", 4);
  const bad = checks.filter((c) => c.level !== "green").map((c) => `${c.id}:${c.detail}`);
  assert.deepEqual(bad, [], `to'g'ri plakatda qizil/sariq band qoldi:\n  ${bad.join("\n  ")}`);
});

/* ══════════════════════════ 2. miqdor bandlari ══════════════════════════ */

test("blockCount: tur chegarasidan chiqsa QIZIL, so'ralganidan farq qilsa SARIQ", () => {
  assert.equal(levelOf(spec("list"), "blockCount", "", 4), "green");
  assert.equal(levelOf(spec("list"), "blockCount", "", 5), "yellow", "so'ralgan 5, yozilgan 4 — sariq");
  const [, max] = infographicTypeOf("process").limits.blocks;
  const tooMany = spec("process", { blocks: Array.from({ length: max + 2 }, (_, i) => block(`b${i + 1}`, { order: i + 1 })) });
  assert.equal(levelOf(tooMany, "blockCount"), "red", `${max + 2} blok — jarayon turining chegarasidan tashqarida`);
  assert.ok(byId(infographicChecks(tooMany, ""), "blockCount")?.fix, "chegaradan chiqqan bandda «Tuzatish» bo'lishi kerak");
});

test("textLength: butun plakat va bitta blok chegarasi", () => {
  assert.equal(specWords(spec("list")), infographicChecks(spec("list"), "") && specWords(spec("list")));
  const s = spec("list");
  s.blocks[0].text = "so'z ".repeat(INFOGRAPHIC_LIMITS.blockTextWordsMax + 5).trim();
  const c = byId(infographicChecks(s, ""), "textLength")!;
  assert.notEqual(c.level, "green");
  assert.ok(c.detail?.includes("b1"), "uzun blok id si ko'rsatilishi kerak");

  const huge = spec("list", { blocks: [block("b1", { text: "so'z ".repeat(300) }), block("b2"), block("b3")] });
  assert.equal(levelOf(huge, "textLength"), "red", "chegaradan 25 % dan ko'p oshsa qizil");
});

test("titleLength / headingLength: uzun va bo'sh sarlavhalar", () => {
  assert.equal(levelOf(spec("list", { title: "" }), "titleLength"), "red");
  assert.equal(levelOf(spec("list", { title: "x".repeat(INFOGRAPHIC_LIMITS.titleCharsMax + 1) }), "titleLength"), "yellow");
  const s = spec("list");
  s.blocks[1].heading = "y".repeat(INFOGRAPHIC_LIMITS.headingCharsMax + 1);
  assert.equal(levelOf(s, "headingLength"), "yellow");
  const empty = spec("list");
  empty.blocks[0].heading = "";
  assert.equal(levelOf(empty, "headingLength"), "red");
});

/* ══════════════════════════ 3. maket bandi ══════════════════════════ */

test("noOverflow: maket QAYTA hisoblanadi — sig'magan blok qizil va «Tuzatish» beradi", () => {
  const s = spec("list");
  s.blocks[0].text = "so'z ".repeat(500).trim();
  const c = byId(infographicChecks(s, ""), "noOverflow")!;
  assert.equal(c.level, "red");
  assert.ok(c.detail?.includes("b1"));
  assert.equal(c.fix?.target, SPEC_TARGET, "plakatda yagona nishon — spetsifikatsiyaning O'ZI");
  assert.equal(levelOf(spec("list"), "noOverflow"), "green");
});

/* ══════════════════════════ 4. turga xos ══════════════════════════ */

test("typeFields: majburiy maydon va TUR MUVOZANATI", () => {
  const noOrder = spec("process");
  noOrder.blocks = noOrder.blocks.map((b) => ({ ...b, order: undefined }));
  assert.equal(levelOf(noOrder, "typeFields"), "red", "`order` yo'q — qizil");

  const lopsided = spec("compare", { blocks: [block("b1", { side: "left" }), block("b2", { side: "left" }), block("b3", { side: "left" }), block("b4", { side: "right" })] });
  assert.equal(levelOf(lopsided, "typeFields"), "red", "ustunlar teng emas — qizil");

  const oneCause = spec("cause-effect", { blocks: [block("b1", { role: "cause" }), block("b2", { role: "effect" }), block("b3", { role: "effect" }), block("b4", { role: "effect" })] });
  assert.equal(levelOf(oneCause, "typeFields"), "red", "bitta sabab — qizil (har guruhda ≥2)");

  assert.equal(levelOf(spec("list"), "typeFields"), "green", "ro'yxat turida qo'shimcha maydon talab qilinmaydi");
});

test("statPresent: statistika turida HAR blokda raqam", () => {
  const s = spec("stat");
  s.blocks[2].stat = undefined;
  const c = byId(infographicChecks(s, "10% 20% 40%"), "statPresent")!;
  assert.equal(c.level, "red");
  assert.ok(c.detail?.includes("b3"));
  assert.equal(levelOf(spec("list"), "statPresent"), "green", "boshqa turda raqam ixtiyoriy");
});

/* ══════════════════════════ 5. halollik ══════════════════════════ */

test("halollik: raqam AJRATILADI va foydalanuvchi ma'lumoti bilan solishtiriladi", () => {
  assert.deepEqual(numbersIn("Yer yuzasining 71% i, 1 200 km va 2,5 mln"), ["71", "1200", "2.5"]);
  assert.ok(groundedIn("71%", "Yer yuzasining 71 foizi suv"), "raqam bir xil — matn boshqacha bo'lsa ham halol");
  assert.ok(!groundedIn("73%", "Yer yuzasining 71 foizi suv"), "boshqa raqam — halol emas");
  assert.ok(groundedIn("ko'pchilik", ""), "raqamsiz qiymat tekshirilmaydi");
  assert.ok(groundedIn("1 200 km", "yo'l uzunligi 1200 km"), "bo'shliqli guruh bitta son");
});

test("sourceGrounded: o'ylab topilgan raqam QIZIL, berilgani yashil", () => {
  const invented = spec("stat");
  const c = byId(infographicChecks(invented, "faqat matn, raqamsiz"), "sourceGrounded")!;
  assert.equal(c.level, "red", "foydalanuvchi raqam bermagan — hammasi uydirma");
  assert.ok(c.fix?.instruction.includes("Do not replace"), "ko'rsatma yangi uydirmani taqiqlashi kerak");

  const honest = spec("stat", { blocks: [block("b1", { stat: { value: "71%", label: "suv" } }), block("b2", { stat: { value: "29%", label: "quruqlik" } }), block("b3", { stat: { value: "3%", label: "chuchuk" } })] });
  assert.equal(levelOf(honest, "sourceGrounded", "Darslik: 71% suv, 29% quruqlik, undan 3% chuchuk"), "green");
});

test("sourceGrounded: foydalanuvchi bermagan MANBA qatori sariq", () => {
  assert.equal(levelOf(spec("list", { source: "Jahon banki, 2024" }), "sourceGrounded", "mavzu haqida qisqa izoh"), "yellow");
  assert.equal(levelOf(spec("list", { source: "6-sinf darsligi" }), "sourceGrounded", "Ma'lumot 6-sinf darsligidan olingan"), "green");
});

/* ══════════════════════════ 6. kontrast ══════════════════════════ */

test("contrast: band DOIM ko'rinadi (palitralar oldindan qulflangan)", () => {
  const c = byId(infographicChecks(spec("list"), ""), "contrast")!;
  assert.equal(c.level, "green");
  assert.ok(/WCAG/.test(c.detail ?? ""), "foydalanuvchiga «kontrast tekshirildi» deyilishi kerak");
  assert.ok(!c.fix, "kontrast avtomatik «tuzatilmaydi» — palitra foydalanuvchi qarori");
});

/* ══════════════════════════ 7. baholovchi va ball ══════════════════════════ */

test("hisobot: baholovchisiz ham ball va bandlar chiqadi", async () => {
  const review = await reviewInfographic(docOf(spec("list")), { judge: false, want: 4 });
  assert.ok(review.score > 0 && review.score <= 100, `ball ${review.score}`);
  assert.equal(review.verifiedShare, 0, "plakatda adabiyotlar yo'q — soxta 1 yozilmasin");
  assert.ok(review.checks.some((c) => c.id.startsWith("judge:")), "baholovchi bandlari (neytral) bo'lishi kerak");
  assert.ok(review.builtAt);
});

test("hisobot: yomon plakat yaxshisidan PAST ball oladi", async () => {
  const good = await reviewInfographic(docOf(spec("list"), "manba yo'q"), { judge: false, want: 4 });
  const badSpec = spec("list", { title: "" });
  badSpec.blocks[0].text = "so'z ".repeat(400).trim();
  badSpec.blocks[1].icon = "yo'q-ikon";
  const bad = await reviewInfographic(docOf(badSpec), { judge: false, want: 6 });
  assert.ok(bad.score < good.score - 10, `yomon ${bad.score} vs yaxshi ${good.score}`);
});

test("baholovchi: nishonlar plakat + blok id lari, matn o'qilarli", () => {
  const s = spec("timeline");
  assert.deepEqual(targetsOf(s), [SPEC_TARGET, "b1", "b2", "b3", "b4"]);
  const t = judgeText(s);
  assert.ok(t.includes("TITLE: Suv aylanishi"));
  assert.ok(t.includes("[1991]"), "xronologiya sanasi baholovchiga ko'rinishi kerak");
  assert.ok(t.includes("SOURCE: (none)"), "manba yo'qligi AYTILISHI kerak — baholovchi uni o'ylab topmasin");
});

/* ══════════════════════════ 8. «Sizdan kutiladi» va sayqal rejasi ══════════════════════════ */

test("«Sizdan kutiladi»: statistika turida raqam, hamma turda manba so'raladi", async () => {
  const statDoc = docOf(spec("stat"), "");
  const review = await reviewInfographic(statDoc, { judge: false });
  const ids = (review.userNeeds ?? []).map((n) => n.id);
  assert.ok(ids.includes("stat"), "raqamsiz statistika plakatida raqam so'ralishi kerak");
  assert.ok(ids.includes("source"), "manbasiz plakatda manba so'ralishi kerak");

  const withSource = docOf(spec("list", { source: "6-sinf darsligi" }), "Darslikdan");
  const r2 = await reviewInfographic(withSource, { judge: false });
  assert.ok(!(r2.userNeeds ?? []).some((n) => n.id === "source"), "manba berilgan bo'lsa so'ralmasin");
});

test("sayqal rejasi: hamma tavsiya BITTA nishonga birlashadi, tuzatib bo'lmaydigani o'tkaziladi", () => {
  const s = spec("stat");
  s.blocks[0].text = "so'z ".repeat(400).trim();
  s.blocks[1].icon = "yo'q-ikon";
  const doc = docOf(s, "");
  const review: DocReview = {
    score: 40,
    checks: infographicChecks(s, "", 6),
    judgeNotes: [],
    verifiedShare: 0,
    recentShare: 0,
    builtAt: new Date().toISOString(),
  };
  const plan = planInfographicPolish(review, doc);
  assert.equal(plan.fixes.length, 1, "plakat bo'linmaydi — bitta fix bo'lishi kerak");
  assert.equal(plan.fixes[0].target, SPEC_TARGET);
  assert.ok(plan.fixes[0].instruction.includes("(1)"), "ko'rsatmalar raqamlanib birlashtirilishi kerak");
  const skipped = plan.skipped.map((x) => x.id);
  assert.ok(skipped.includes("iconKnown"), "ikon allaqachon standartga tushgan — qayta yozilmaydi");
  assert.ok(skipped.includes("blockCount"), "miqdor bandi `delivered` bilan qaytariladi, qayta yozilmaydi");
});
