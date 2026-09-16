import test from "node:test";
import assert from "node:assert/strict";
import { buildWorkDoc, fallbackWorkOutline, introPartsFromLlm, planWorkVisuals, tableFromLlm, taskList, workOutlineFromLlm, EMPTY_RESEARCH_STATS } from "../lib/generation/work/engine.ts";
import { workKindOf } from "../lib/generation/work/registry.ts";
import { SUBJECT_PROFILES } from "../lib/generation/work/subjects.ts";
import { workLabels } from "../lib/generation/work/labels.ts";
import { workInputFromValues } from "../lib/generation/work/input.ts";
import { workWordPlan } from "../lib/generation/work/plan.ts";
import type { WorkContext } from "../lib/generation/work/prompts.ts";
import { intakeCheck } from "../lib/generation/work/guard.ts";
import { extractMeta } from "../lib/generation/meta.ts";
import { TOOL_BY_ID } from "../lib/tools.ts";
import type { FormValues } from "../lib/types.ts";
import type { Figure, Reference } from "../lib/generation/article/types.ts";
import type { LlmRole } from "../lib/generation/llm-roles.ts";
import type { AcademicDoc } from "../lib/generation/types.ts";

/**
 * TALABA ISHI DVIGATELI (AUDIT-19 WP-A) — `complete` va `research`
 * STUB bilan (tarmoq yo'q). Model javoblari ATAYLAB «ifloslangan»:
 * uydirma iqtibos id, sof raqamli iqtibos, manbasiz foiz — dvigatel
 * ularni qanday tozalashini tekshiradi.
 */

const tool = TOOL_BY_ID.coursework;

const BASE: FormValues = {
  topic: "Boshlang'ich sinfda o'qish ko'nikmalarini rivojlantirish",
  workKind: "theory",
  subjectProfile: "humanities",
  language: "uz",
  pages: "25-30",
  author: "Aliyev Ali — 3-kurs, 301-guruh",
  university: "Toshkent davlat universiteti",
  faculty: "Pedagogika fakulteti",
  department: "Boshlang'ich ta'lim kafedrasi",
  subjectName: "Pedagogika",
  teacher: "Rahimov B.",
  city: "Toshkent",
  refsMin: 2,
  figureCount: 1,
  tableCount: 1,
  userFacts: "Tajribada 120 o'quvchi qatnashdi, o'rtacha ball 4,1 dan 4,6 ga oshdi.",
};

const REFS: Reference[] = [
  { id: "W1000000001", title: "Reading skills development", authors: ["Smith J."], year: 2021, verified: "openalex", cited: false },
  { id: "u1", title: "Karimov A. Pedagogika", authors: ["Karimov A."], year: 2022, verified: "user", cited: false, raw: "Karimov A. Pedagogika. — Toshkent: Fan, 2022." },
];

const stubResearch = async () => ({ refs: REFS.map((r) => ({ ...r })), stats: { ...EMPTY_RESEARCH_STATS, user: 1, found: 4, candidates: 3, selected: 1, queries: ["reading skills"] } });

/** Sxema chizmaydi (sharp shart emas) — spec saqlanadi, PNG yo'q. */
const stubFigures = async (figs: Figure[]) => figs.map((f) => ({ ...f, url: `data:image/png;base64,stub-${f.id}` }));

const para = (i: number) => `Bu ${i}-paragraf: o‘qish ko‘nikmasi bolaning matnni tushunish tezligi bilan bog‘liq va u bosqichma-bosqich shakllanadi. `.repeat(6).trim();

type Opts = {
  /** Kirish JSON ida shu elementlar BERILMAYDI (majburiy elementni yo'qotish). */
  dropIntroParts?: string[];
  /** Kirish qayta so'rovida ham bermaydi. */
  neverGive?: boolean;
  judge?: (n: number) => string;
  emptyParagraph?: string;
  badOutline?: boolean;
  /** «Kengaytir» so'roviga qo'shimcha bloklar beradi (aks holda `{}`). */
  expand?: boolean;
};

type Call = { role: LlmRole; system: string; user: string };

const INTRO_TEXT: Record<string, string> = {
  relevance: "Mavzuning dolzarbligi shundaki, boshlang‘ich sinfda o‘qish ko‘nikmasi keyingi ta'lim bosqichlarining asosi hisoblanadi [W1000000001].",
  aim: "Ishning maqsadi — boshlang‘ich sinf o‘quvchilarida o‘qish ko‘nikmasini rivojlantirish yo‘llarini aniqlash.",
  tasks: "Ish vazifalari: 1) tushunchani aniqlash; 2) yondashuvlarni qiyoslash; 3) amaliy tavsiyalar ishlab chiqish.",
  object: "Tadqiqot obyekti — boshlang‘ich ta'lim jarayoni.",
  subject: "Tadqiqot predmeti — o‘qish ko‘nikmasini shakllantirish usullari.",
  methods: "Tadqiqot metodlari: manbalar tahlili, qiyoslash va umumlashtirish.",
  structure: "Ish tuzilmasi: kirish, ikki bob, xulosa va adabiyotlar ro‘yxatidan iborat.",
  novelty: "Ilmiy yangilik — yondashuvlarning qiyosiy tasnifi taklif etilgan.",
  significance: "Amaliy ahamiyat — tavsiyalar boshlang‘ich sinf o‘qituvchilari uchun mo‘ljallangan.",
};

function makeComplete(calls: Call[], o: Opts = {}) {
  let judgeCalls = 0;
  let introCalls = 0;
  return async (role: LlmRole, system: string, user: string) => {
    calls.push({ role, system, user });
    const usage = { provider: "stub", model: "stub-1", inputTokens: 100, outputTokens: 50 };
    const reply = (text: string) => ({ text, usage });
    if (role === "judge") return reply(o.judge ? o.judge(++judgeCalls) : "{}");
    if (user.startsWith("Plan the body")) {
      if (o.badOutline) return reply("{not json");
      const drop = new Set(o.dropIntroParts ?? []);
      const intro = Object.fromEntries(Object.entries(INTRO_TEXT).filter(([k]) => !drop.has(k)));
      return reply(
        JSON.stringify({
          chapters: [
            { title: "Nazariy asoslar", paragraphs: [{ title: "Tushuncha", brief: "Ta'rif" }, { title: "Yondashuvlar", brief: "Qiyos" }] },
            { title: "Amaliy tahlil", paragraphs: [{ title: "Tashxis", brief: "Natija" }, { title: "Tavsiyalar", brief: "Yechim" }] },
            { title: "Ortiqcha bob", paragraphs: [{ title: "Ortiqcha", brief: "…" }] },
          ],
          intro,
        }),
      );
    }
    if (user.startsWith("The previous introduction was missing") || user.startsWith("Write the INTRODUCTION")) {
      introCalls++;
      const drop = new Set(o.neverGive ? (o.dropIntroParts ?? []) : introCalls > 1 ? [] : (o.dropIntroParts ?? []));
      const parts = Object.fromEntries(Object.entries(INTRO_TEXT).filter(([k]) => !drop.has(k)));
      return reply(JSON.stringify({ parts }));
    }
    if (user.startsWith("Write the paragraph")) {
      const id = user.match(/\(id ([\w.]+)\)/)?.[1] ?? "";
      if (o.emptyParagraph === id) return reply("");
      const wantTable = user.includes('"table":');
      const wantFigure = user.includes('"figure":');
      const body: Record<string, unknown> = {
        blocks: [
          { kind: "p", text: `${para(1)} [W1000000001; u1].` },
          { kind: "p", text: `${para(2)} Uydirma manba [W9999999999] va raqam [3]. Tajribada 120 o‘quvchi qatnashdi, ball 4,1 dan 4,6 ga oshdi.` },
          // Iqtibossiz blok + manbasiz foiz — qo'riqchi aynan shuni sanaydi.
          { kind: "li", text: `${para(3)} So‘rovnomada 45% rozi bo‘ldi.` },
        ],
      };
      if (wantTable) body.table = { caption: "Yondashuvlar qiyosi", headers: ["Yondashuv", "Natija"], rows: [["An'anaviy", "o‘rta"], ["Interaktiv", "yuqori"]], anchorAfterBlock: 1 };
      if (wantFigure)
        body.figure = {
          caption: "O‘qish ko‘nikmasi bosqichlari",
          anchorAfterBlock: 0,
          spec: { kind: "process", steps: ["Tanish", "Mashq", "Mustahkamlash"] },
        };
      return reply(JSON.stringify(body));
    }
    if (user.startsWith("The paragraph «")) {
      return reply(o.expand ? JSON.stringify({ blocks: [{ kind: "p", text: `Kengaytirilgan matn: ${para(5)} [W1000000001].` }] }) : "{}");
    }
    if (user.startsWith("Write the CONCLUSION")) {
      return reply(
        JSON.stringify({
          blocks: [
            { kind: "li", text: "Birinchi vazifa bo‘yicha: o‘qish ko‘nikmasi tushunchasi aniqlandi [u1]." },
            { kind: "li", text: "Ikkinchi vazifa bo‘yicha: yondashuvlar qiyoslandi [W1000000001]." },
            { kind: "p", text: `${para(4)}` },
          ],
        }),
      );
    }
    return reply("{}");
  };
}

async function build(values: FormValues = {}, o: Opts = {}, extra: Record<string, unknown> = {}) {
  const calls: Call[] = [];
  const v = { ...BASE, ...values };
  const meta = extractMeta(tool, v);
  const built = await buildWorkDoc(meta, v, {
    deadline: Date.now() + 120_000,
    complete: makeComplete(calls, o) as never,
    research: stubResearch,
    buildFigures: stubFigures,
    polish: false,
    now: new Date("2026-09-16T10:00:00Z"),
    ...extra,
  });
  assert.ok(built, "hujjat qurilishi kerak");
  return { ...built, calls };
}

function ctxOf(values: FormValues = {}): WorkContext {
  const v = { ...BASE, ...values };
  const input = workInputFromValues(v, "coursework");
  const meta = { ...extractMeta(tool, v), language: input.language };
  const kind = workKindOf("coursework", input.kind);
  const subject = SUBJECT_PROFILES[input.subject];
  return { input, meta, kind, subject, labels: workLabels(input.language), plan: workWordPlan(meta, kind, subject, { refs: input.refsMin, figures: input.figureCount, tables: input.tableCount }), refs: [] };
}

/* ───────────────────────────── bosqichlar ───────────────────────────── */

test("bosqichlar: 0 dan 90 gacha o'sib boradi, har bosqich o'z matni bilan", async () => {
  const stages: { progress: number; step: string }[] = [];
  const calls: Call[] = [];
  const meta = extractMeta(tool, BASE);
  const built = await buildWorkDoc(meta, BASE, {
    deadline: Date.now() + 120_000,
    complete: makeComplete(calls) as never,
    research: stubResearch,
    buildFigures: stubFigures,
    polish: false,
    onStage: (ev) => stages.push(ev),
  });
  assert.ok(built);
  const progress = stages.map((s) => s.progress);
  assert.ok(progress[0] === 0 && Math.max(...progress) >= 80, `bosqichlar: ${progress.join(",")}`);
  assert.ok(progress.every((p, i) => i === 0 || p >= progress[i - 1]), "progress kamaymaydi");
  const text = stages.map((s) => s.step).join(" | ");
  for (const word of ["Manbalar", "Reja", "Kirish", "Paragraf", "Xulosa", "Adabiyotlar", "hisobot"]) assert.match(text, new RegExp(word, "i"), `«${word}» bosqichi yo'q`);
});

test("tuzilma: intro → bob (matnsiz sarlavha) → paragraflar → conclusion; model modeli mos", async () => {
  const { doc } = await build();
  const ids = doc.sections.map((s) => s.id);
  // Model 3 bob berdi (tur chegarasi max 3), uchinchisida 1 paragraf — MINIMUMGA (2) to'ldirildi.
  assert.deepEqual(ids, ["intro", "ch1", "ch1.1", "ch1.2", "ch2", "ch2.1", "ch2.2", "ch3", "ch3.1", "ch3.2", "conclusion"]);
  // Bob sarlavhasi bo'limi MATNSIZ — raqamni (`1-BOB.`) WP-C maketi qo'yadi.
  assert.equal(doc.sections.find((s) => s.id === "ch1")!.blocks.length, 0);
  assert.ok(doc.sections.find((s) => s.id === "ch1.1")!.blocks.length > 0);
  assert.equal(doc.titlePage, true);
  assert.equal(doc.toc, true);
  const model = doc.work!;
  assert.equal(model.genre, "coursework");
  assert.equal(model.kind, "theory");
  assert.equal(model.chapters.length, 3);
  assert.deepEqual(model.chapters[0].paragraphs.map((p) => p.id), ["ch1.1", "ch1.2"]);
  assert.equal(model.university, "Toshkent davlat universiteti");
  assert.equal(model.author, "Aliyev Ali");
  assert.equal(model.refsMin, 2);
});

test("bob/paragraf soni turning chegarasida (model ortiqcha bersa ham)", async () => {
  const kind = workKindOf("coursework", "theory");
  const { doc } = await build();
  const model = doc.work!;
  assert.ok(model.chapters.length >= kind.chapters.min && model.chapters.length <= kind.chapters.max);
  for (const c of model.chapters)
    assert.ok(c.paragraphs.length >= kind.paragraphsPerChapter.min && c.paragraphs.length <= kind.paragraphsPerChapter.max, `${c.id}: ${c.paragraphs.length} paragraf`);
});

test("`tocText` rejasi MODEL rejasidan USTUN: sarlavhalar foydalanuvchiniki", async () => {
  const toc = "1-BOB. MUALLIF BOBI\n1.1. Muallif paragrafi\n1.2. Ikkinchi paragraf\n2-BOB. IKKINCHI BOB\n2.1. Uchinchi paragraf\n2.2. To'rtinchi paragraf";
  const { doc } = await build({ tocText: toc });
  const model = doc.work!;
  assert.deepEqual(model.chapters.map((c) => c.title), ["MUALLIF BOBI", "IKKINCHI BOB"]);
  assert.deepEqual(model.chapters[0].paragraphs.map((p) => p.title), ["Muallif paragrafi", "Ikkinchi paragraf"]);
  assert.equal(doc.sections.find((s) => s.id === "ch1")!.title, "MUALLIF BOBI");
  // Model bergan «Nazariy asoslar» sarlavhasi ISHLATILMAYDI.
  assert.ok(!doc.sections.some((s) => s.title === "Nazariy asoslar"));
});

/* ───────────────────────────── kirish ───────────────────────────── */

test("kirish: 7 majburiy element matnga tushadi va modelda belgilanadi", async () => {
  const { doc, guard } = await build();
  const intro = doc.sections.find((s) => s.id === "intro")!;
  assert.ok(intro.blocks.length >= 7, `kirishda ${intro.blocks.length} blok`);
  const kind = workKindOf("coursework", "theory");
  const check = intakeCheck(kind.introParts, intro.blocks, null);
  assert.deepEqual(check.missing, []);
  for (const p of kind.introParts) assert.equal(doc.work!.intro.parts[p], true, `${p}: modelda belgilanmagan`);
  assert.deepEqual(guard.missingIntroParts, []);
  assert.equal(guard.introRetried, false);
});

test("kirishda element yo'q → BIR MARTA qayta so'raladi va to'ldiriladi", async () => {
  const { doc, guard, calls } = await build({}, { dropIntroParts: ["object", "methods"] });
  const retry = calls.filter((c) => c.user.startsWith("The previous introduction was missing"));
  assert.equal(retry.length, 1, "aynan bitta qayta so'rov");
  assert.match(retry[0].user, /object/);
  assert.match(retry[0].user, /methods/);
  assert.equal(guard.introRetried, true);
  assert.deepEqual(guard.missingIntroParts, [], "qayta so'rovdan keyin to'ldirildi");
  assert.equal(doc.work!.intro.parts.object, true);
});

test("qayta so'rovdan keyin ham yo'q bo'lsa — modelda `false`, hisobot uchun qayd etiladi", async () => {
  const { doc, guard } = await build({}, { dropIntroParts: ["object", "subject"], neverGive: true });
  assert.deepEqual(guard.missingIntroParts.sort(), ["object", "subject"]);
  assert.equal(doc.work!.intro.parts.object, false);
  assert.equal(doc.work!.intro.parts.subject, false);
  assert.equal(doc.work!.intro.parts.aim, true);
});

/* ───────────────────────────── qo'riqchi ───────────────────────────── */

test("`guardSection`: reyestrda yo'q iqtibos o'chadi, haqiqiysi qoladi, manbasiz foiz qayd etiladi", async () => {
  const { doc, guard } = await build();
  const all = doc.sections.flatMap((s) => s.blocks.map((b) => b.text)).join("\n");
  assert.ok(!all.includes("W9999999999"), "uydirma id o'chishi kerak");
  assert.ok(!/\[3\]/.test(all), "sof raqamli iqtibos o'chishi kerak");
  assert.ok(all.includes("[W1000000001]"), "haqiqiy iqtibos qolishi kerak");
  assert.ok(guard.removedCitations >= 2, `o'chirilgan: ${guard.removedCitations}`);
  /*
   * `unresolved` bo'sh: noma'lum id lar PARAGRAF bosqichida
   * (`guardSection`) tozalanadi, 7-bosqichdagi `verifyCitations` esa
   * toza matnni ko'radi. Hisobot `refsCited` bandi shuning uchun
   * dvigateldan kelgan `guard` ga tayanmaydi — o'zi qayta sanaydi.
   */
  assert.deepEqual(guard.unresolved, []);
  assert.ok(guard.unsourcedNumbers.includes("45%"), `manbasiz foizlar: ${guard.unsourcedNumbers.join(",")}`);
  // Foydalanuvchi raqamlari matnda — «yo'qolgan» ro'yxati bo'sh.
  assert.deepEqual(guard.missingFactNumbers, []);
});

test("adabiyotlar: faqat MATNDA iqtibos qilinganlar ro'yxatga kiradi", async () => {
  const { doc } = await build();
  const refs = doc.work!.references;
  assert.ok(refs.length >= 1);
  assert.ok(refs.every((r) => r.cited), "citedOnly");
  assert.ok(refs.some((r) => r.id === "W1000000001"));
  assert.ok(doc.references?.length, "eski matn ro'yxati ham to'ldiriladi");
});

/* ───────────────────────────── vizuallar ───────────────────────────── */

test("sxema va jadval bloklari matn ichiga joylashadi, chizilgan PNG modelga tushadi", async () => {
  const { doc } = await build();
  const figureBlocks = doc.sections.flatMap((s) => s.blocks).filter((b) => b.kind === "figure");
  const tableBlocks = doc.sections.flatMap((s) => s.blocks).filter((b) => b.kind === "tableRef");
  assert.equal(figureBlocks.length, 1);
  assert.equal(tableBlocks.length, 1);
  assert.equal(doc.work!.figures.length, 1);
  assert.match(doc.work!.figures[0].url ?? "", /^data:image\/png/);
  assert.equal(doc.work!.figures[0].spec.kind, "process");
  assert.equal(doc.tables?.length, 1);
  assert.equal(doc.tables![0].id, "t1");
  assert.equal(doc.tables![0].anchor?.startsWith("ch"), true, "jadval paragrafga langarlanadi");
  // Sarlavhada raqam YO'Q — «1.1-jadval» ni WP-C maketi qo'yadi.
  assert.ok(!/\d+\.\d+-jadval/.test(doc.tables![0].caption ?? ""));
});

test("`includeVisuals: false` — vizual umuman so'ralmaydi", async () => {
  const { doc, calls } = await build({ includeVisuals: false });
  assert.equal(doc.work!.figures.length, 0);
  assert.deepEqual(doc.tables ?? [], []);
  assert.ok(!calls.some((c) => c.user.includes('"figure":')), "sxema so'ralmadi");
  assert.ok(!calls.some((c) => c.user.includes('"table":')), "jadval so'ralmadi");
});

/* ───────────────────────────── xulosa ───────────────────────────── */

test("xulosa: kirish VAZIFALARI promptga tushadi, matn hujjat oxirida", async () => {
  const { doc, calls } = await build();
  const conclusionCall = calls.find((c) => c.user.startsWith("Write the CONCLUSION"))!;
  assert.ok(conclusionCall, "xulosa chaqiruvi yo'q");
  assert.match(conclusionCall.user, /tushunchani aniqlash|yondashuvlarni qiyoslash/i, "vazifalar promptda");
  const last = doc.sections[doc.sections.length - 1];
  assert.equal(last.id, "conclusion");
  assert.ok(last.blocks.length >= 2);
});

/* ───────────────────────────── sarf va sayqal ───────────────────────────── */

test("cost: har chaqiruv hisoblanadi, `onUsage` ham chaqiriladi", async () => {
  const usages: unknown[] = [];
  const { cost, calls } = await build({}, {}, { onUsage: (u: unknown) => usages.push(u) });
  assert.ok(cost.calls >= 6, `chaqiruvlar: ${cost.calls}`);
  assert.equal(cost.calls, calls.length, "har chaqiruv sanaladi");
  assert.equal(usages.length, cost.calls);
  assert.equal(cost.provider, "stub");
  assert.ok(cost.inputTokens > 0 && cost.outputTokens > 0);
});

test("sayqal: ball < 90 va byudjet yetarli bo'lsa ishga tushadi, ≥ 90 da tushmaydi", async () => {
  // Baholovchi past ball → sayqal; keyin yana past → qabul qilinmaydi (Q-3 +2).
  const low = await build({}, { judge: () => JSON.stringify({ logic: 1, depth: 1, style: 1, aimMatch: 1, originality: 1, notes: [], fixes: [] }) }, { polish: true });
  const polish = low.doc.work!.review?.polish;
  assert.ok(polish, "sayqal jurnali yo'q");
  assert.ok(polish!.before < 90);
  assert.equal(polish!.accepted, false, "ball oshmadi — eski hujjat qoladi");

  // Yuqori ball → sayqal umuman boshlanmaydi.
  const high = await build({}, { judge: () => JSON.stringify({ logic: 3, depth: 3, style: 3, aimMatch: 3, originality: 3, notes: [], fixes: [] }) }, { polish: true });
  assert.ok((high.doc.work!.review?.score ?? 0) > 0);
  if ((high.doc.work!.review?.score ?? 0) >= 90) assert.equal(high.doc.work!.review?.polish, undefined, "≥ 90 da sayqal yo'q");
});

test("sayqal: byudjet kam bo'lsa `skipped: budget`, hujjat o'zgarmaydi", async () => {
  const calls: Call[] = [];
  const meta = extractMeta(tool, BASE);
  const built = await buildWorkDoc(meta, BASE, {
    // Hisobot bosqichi tugaydi, sayqalga 90 s qolmaydi.
    deadline: Date.now() + 40_000,
    complete: makeComplete(calls, { judge: () => JSON.stringify({ logic: 1, depth: 1, style: 1, aimMatch: 1, originality: 1, notes: [], fixes: [] }) }) as never,
    research: stubResearch,
    buildFigures: stubFigures,
    polish: true,
  });
  assert.ok(built);
  const polish = built.doc.work!.review?.polish;
  assert.ok(polish, "byudjet izohi yo'q");
  assert.deepEqual(polish!.skipped, [{ id: "budget", reason: "budget" }]);
  assert.equal(polish!.applied.length, 0);
});

test("40–45 bet paketida avto-sayqal O'TKAZIB YUBORILADI (X-3)", async () => {
  const { doc } = await build({ pages: "40-45" }, { judge: () => JSON.stringify({ logic: 1, depth: 1, style: 1, aimMatch: 1, originality: 1, notes: [], fixes: [] }) }, { polish: true });
  const polish = doc.work!.review?.polish;
  assert.ok(polish, "katta paketda izoh qolishi kerak");
  assert.deepEqual(polish!.skipped, [{ id: "budget", reason: "budget" }]);
});

/* ───────────────────────────── chidamlilik ───────────────────────────── */

test("model rejani buzsa — deterministik zaxira reja, hujjat baribir chiqadi", async () => {
  const { doc } = await build({}, { badOutline: true });
  const model = doc.work!;
  assert.equal(model.chapters.length, 2, "turning minimumi");
  assert.ok(doc.sections.some((s) => s.id === "ch1.1" && s.blocks.length));
});

test("paragraf javobsiz qolsa — bo'sh bo'lim qayd etiladi, ish yiqilmaydi", async () => {
  const { doc, guard } = await build({}, { emptyParagraph: "ch2.2" });
  assert.ok(guard.emptySections.includes("ch2.2"));
  assert.ok(doc.sections.some((s) => s.id === "ch2.2"), "bo'lim baribir joyida");
  assert.ok(doc.sections.filter((s) => s.blocks.length).length >= 5);
});

test("manba quvuri yo'q bo'lsa (WP-B hali yo'q) — manbasiz davom etadi, uydirma manba yo'q", async () => {
  const calls: Call[] = [];
  const meta = extractMeta(tool, BASE);
  const built = await buildWorkDoc(meta, BASE, {
    deadline: Date.now() + 60_000,
    complete: makeComplete(calls) as never,
    research: async () => ({ refs: [], stats: { ...EMPTY_RESEARCH_STATS } }),
    buildFigures: stubFigures,
    polish: false,
  });
  assert.ok(built);
  assert.deepEqual(built.doc.work!.references, []);
  const all = built.doc.sections.flatMap((s) => s.blocks.map((b) => b.text)).join("\n");
  assert.ok(!/\[W\d+\]/.test(all), "manbasiz ishda iqtibos qolmaydi");
  assert.ok(!built.doc.references, "ro'yxat bo'sh");
});

/* ───────────────────────────── sof funksiyalar ───────────────────────────── */

test("`workOutlineFromLlm` / `fallbackWorkOutline` / `introPartsFromLlm` / `tableFromLlm` / `taskList`", () => {
  const ctx = ctxOf();
  const fb = fallbackWorkOutline(ctx);
  assert.equal(fb.chapters.length, 2);
  assert.deepEqual(fb.chapters[0].paragraphs.map((p) => p.id), ["ch1.1", "ch1.2"]);
  assert.ok(fb.chapters[0].paragraphs[0].words >= 120);

  const raw = JSON.stringify({ chapters: [{ title: "A", paragraphs: [{ title: "A1", brief: "b" }] }], intro: { aim: "Maqsad — X", zzz: "" } });
  const parsed = workOutlineFromLlm(raw, ctx);
  assert.equal(parsed.chapters[0].title, "A");
  // Paragraf soni turning MINIMUMIGA to'ldiriladi.
  assert.equal(parsed.chapters[0].paragraphs.length, 2);
  assert.deepEqual(introPartsFromLlm(raw), { aim: "Maqsad — X" });
  assert.equal(workOutlineFromLlm("{not json", ctx).chapters.length, 2, "buzuq JSON → zaxira");

  assert.equal(tableFromLlm({ headers: ["a"], rows: [["1"]] }), null, "bitta ustun — jadval emas");
  assert.equal(tableFromLlm({ headers: ["a", "b"], rows: [] }), null);
  const t = tableFromLlm({ caption: "N", headers: ["a", "b"], rows: [["1", "2"]], anchorAfterBlock: 2 })!;
  assert.equal(t.after, 2);
  assert.deepEqual(t.table.headers, ["a", "b"]);

  assert.deepEqual(taskList("1) birinchi vazifani bajarish; 2) ikkinchi vazifani bajarish", []), ["birinchi vazifani bajarish", "ikkinchi vazifani bajarish"]);
});

test("`planWorkVisuals`: jadval/sxema soni rejadan, bitta paragrafda bittadan", () => {
  const ctx = ctxOf({ figureCount: 2, tableCount: 1, pages: "30-35" });
  const outline = fallbackWorkOutline(ctx);
  const plan = planWorkVisuals(ctx, outline);
  const figures = [...plan.values()].filter((v) => v.figure).length;
  const tables = [...plan.values()].filter((v) => v.table).length;
  assert.equal(figures, 2);
  assert.equal(tables, 1);
  assert.ok([...plan.values()].every((v) => !(v.figure && v.table)), "bitta paragrafda ikkalasi birga emas");
  // Vizual o'chirilgan bo'lsa reja bo'sh.
  const off = planWorkVisuals(ctxOf({ includeVisuals: false }), outline);
  assert.ok([...off.values()].every((v) => !v.figure && !v.table));
});

test("hujjat `AcademicDoc` shartnomasiga mos: `work` modeli va tekis `sections`", async () => {
  const { doc } = await build();
  const d: AcademicDoc = doc;
  assert.ok(d.work);
  assert.ok(d.sections.every((s) => typeof s.id === "string" && Array.isArray(s.blocks)));
  assert.ok(d.work!.chapters.every((c) => c.paragraphs.every((p) => d.sections.some((s) => s.id === p.sectionId))));
});

/*
 * Referat jonli sinovi: paragraflar rejadagi 305 so'z o'rniga ≈150–200
 * chiqib, hujjat 8 bet bo'ldi. Endi 70 % dan kalta paragraf bir marta
 * «kengaytir»iladi — mavjud matn promptga kiradi (takror bo'lmasin),
 * yangi bloklar OXIRIGA qo'shiladi. Mutatsiya: `WORK_EXPAND_BELOW = 0`
 * → kengaytirish so'rovi yo'q → test yiqiladi.
 */
test("kalta paragraf bir marta kengaytiriladi: mavjud matn promptda, yangi bloklar oxirida", async () => {
  const { doc, calls } = await build({ pages: "25-30" }, { expand: true });
  const expand = calls.filter((c) => c.user.startsWith("The paragraph «"));
  assert.ok(expand.length >= 1, "kengaytirish so'rovi bo'lishi kerak (mock paragraflari ≈240 so'z, reja undan katta)");
  const first = expand[0]!.user;
  assert.match(first, /currently has \d+ words; it needs about \d+ more/);
  assert.ok(first.includes("ALREADY WRITTEN") && first.includes("Bu 1-paragraf"), "mavjud matn promptga kiradi");
  assert.ok(first.includes("SOURCES") && first.includes("W1000000001"), "manbalar ro'yxati kengaytirishda ham beriladi");
  const p = doc.sections.find((s) => s.id === "ch1.1")!;
  const last = p.blocks.filter((b) => b.kind === "p").at(-1)!;
  assert.match(last.text, /^Kengaytirilgan matn/, "qo'shimcha bloklar oxiriga qo'shiladi");
  assert.ok(p.blocks[0]!.text.startsWith("Bu 1-paragraf"), "asl bloklar joyida");
  // Har paragraf uchun ko'pi bilan BIR kengaytirish.
  const perId = new Map<string, number>();
  for (const c of expand) {
    const id = c.user.match(/\(id ([\w.]+)\)/)?.[1] ?? "";
    perId.set(id, (perId.get(id) ?? 0) + 1);
  }
  assert.ok([...perId.values()].every((n) => n === 1), "paragraf boshiga bitta kengaytirish");
});

test("kengaytirish javobi bo'sh bo'lsa asl paragraf o'zgarmaydi", async () => {
  const { doc } = await build({ pages: "25-30" }, { expand: false });
  const p = doc.sections.find((s) => s.id === "ch1.1")!;
  assert.ok(!p.blocks.some((b) => b.text.startsWith("Kengaytirilgan")));
  assert.ok(p.blocks.some((b) => b.text.startsWith("Bu 1-paragraf")));
});
