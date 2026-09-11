import test from "node:test";
import assert from "node:assert/strict";
import { buildArticleDoc, articleWordPlan, articleWordsPerPage, figureSpecFromLlm, tableFromLlm, blocksFromLlm, outlineFromLlm, fallbackOutline, planVisuals, prismaSpec } from "../lib/generation/article/engine.ts";
import type { ArticleContext } from "../lib/generation/article/prompts.ts";
import { collectReferences, dedupeReferences, parseSelection } from "../lib/generation/research/pipeline.ts";
import { setSourceCacheStore } from "../lib/generation/research/cache.ts";
import { ARTICLE_TYPES } from "../lib/generation/article/types-registry.ts";
import { PUBLICATION_PROFILES } from "../lib/generation/article/profiles.ts";
import { articleLabels } from "../lib/generation/article/labels.ts";
import { articleInputFromValues } from "../lib/generation/article/input.ts";
import { extractMeta } from "../lib/generation/meta.ts";
import { hardMissing, missingStructure, structureNeeds } from "../lib/generation/structure.ts";
import { budgetFor } from "../lib/generation/budget.ts";
import { TOOL_BY_ID } from "../lib/tools.ts";
import type { FormValues } from "../lib/types.ts";
import type { LlmRole } from "../lib/generation/llm-roles.ts";
import { CROSSREF_WORK, OPENALEX_WORKS, stubFetch } from "./helpers/research-fixtures.ts";

/**
 * Maqola dvigateli (WP1) — `complete` va `fetch` stub bilan. Model
 * javoblari ATAYLAB «ifloslangan»: uydirma id, sof raqamli iqtibos,
 * manbasiz foiz — dvigatel ularni qanday tozalashini tekshiradi.
 */

test.beforeEach(() => setSourceCacheStore(null));
test.after(() => setSourceCacheStore(undefined));

const tool = TOOL_BY_ID.article;
const para = (i: number, extra = "") =>
  `Bu ${i}-paragraf: adaptiv o‘qitish tizimlari talabaning o‘zlashtirish sur’atiga moslashadi va natijani oshiradi${extra}. `.repeat(6).trim();

type Call = { role: LlmRole; system: string; user: string };

/** Ssenariyli LLM stub: so'rov turini prompt matnidan aniqlaydi. */
function makeComplete(calls: Call[], opts: { emptySection?: string; noAbstract?: string; badOutline?: boolean } = {}) {
  return async (role: LlmRole, system: string, user: string) => {
    calls.push({ role, system, user });
    const usage = { provider: "stub", model: "stub-1", inputTokens: 100, outputTokens: 50 };
    const reply = (text: string) => ({ text, usage });
    if (role === "fast") return reply(JSON.stringify({ queries: ["adaptive learning AI", "intelligent tutoring systems", "sun'iy intellekt ta'lim"] }));
    if (role === "researcher") return reply(JSON.stringify({ ids: ["W2741809807", "W4385000001", "W0000000000"] }));
    if (user.startsWith("Plan the sections") || user.startsWith("Plan a single-block")) {
      if (opts.badOutline) return reply("{not json");
      return reply(JSON.stringify({ sections: [{ id: "intro", title: "Kirish", brief: "Muammo", words: 200 }, { id: "results", title: "X", brief: "Natijalar", words: 400 }, { id: "conclusion", title: "Xulosa", brief: "Xulosa", words: 100 }, { id: "zzz", title: "Begona", brief: "", words: 50 }] }));
    }
    if (user.startsWith("Write the section")) {
      const id = user.match(/\(id ([\w-]+)\)/)?.[1] ?? "";
      if (opts.emptySection === id) return reply("");
      if (user.includes("This is the WHOLE")) return reply(JSON.stringify({ blocks: [{ kind: "p", text: `${para(1)} [u1].` }] }));
      const wantTable = user.includes('"table":');
      const wantFigure = user.includes('"figure":');
      const body: Record<string, unknown> = {
        blocks: [
          { kind: "p", text: `${para(1)} [W4385000001].` },
          { kind: "p", text: `${para(2)} Uydirma manba [W9999999999] va raqam [3]. Foydalanuvchi natijasi: 120 talaba, ball 4,1 dan 4,6 ga oshdi.` },
          { kind: "li", text: `${para(3)} So‘rovnomada 45% rozi bo‘ldi [u1].` },
        ],
      };
      if (wantTable) body.table = { caption: "Guruhlar bo‘yicha ko‘rsatkichlar [W4385000001]", headers: ["Guruh", "Ball"], rows: [["Tajriba", "4,6"], ["Nazorat", "4,2"]], anchorAfterBlock: 1 };
      if (wantFigure) {
        body.figure = user.includes('"kind":"chart"') && user.includes("USER DATA (categories")
          ? { caption: "Talabalar soni", anchorAfterBlock: 0, spec: { kind: "chart", chart: "bar", dataSource: "user", categories: ["x"], series: [{ name: "fake", values: [999] }] } }
          : { caption: "Tizim tuzilmasi", anchorAfterBlock: 2, spec: { kind: "flow", direction: "TB", nodes: [{ id: "n1", label: "Kirish", kind: "start" }, { id: "n2", label: "Tahlil" }, { id: "n3", label: "Chiqish", kind: "end" }], edges: [{ from: "n1", to: "n2" }, { from: "n2", to: "n3" }, { from: "n2", to: "n9" }] } };
      }
      return reply(JSON.stringify(body));
    }
    if (user.startsWith("The section")) return reply(JSON.stringify({ blocks: [{ kind: "p", text: para(9, " (qo‘shimcha)") }] }));
    if (user.startsWith("The previous text was")) return reply(JSON.stringify({ blocks: [{ kind: "p", text: Array.from({ length: 250 }, (_, i) => `so‘z${i}`).join(" ") }] }));
    if (user.startsWith("Write the abstract")) {
      const lang = user.match(/abstract in (\w+)/)?.[1] ?? "";
      if (opts.noAbstract && (opts.noAbstract === "*" || lang.startsWith(opts.noAbstract))) return null;
      const words = user.includes("STRUCTURED") ? 40 : 160;
      const text = Array.from({ length: words }, (_, i) => `${lang.toLowerCase()}w${i}`).join(" ");
      const kw = ["a", "b", "c", "d", "e", "f"].map((k) => `${lang.slice(0, 2).toLowerCase()}-${k}`);
      return reply(user.includes("STRUCTURED") ? JSON.stringify({ background: text, methods: text, results: text, conclusions: text, keywords: kw }) : JSON.stringify({ text: `${text} [W2741809807]`, keywords: kw }));
    }
    if (user.startsWith("Write ")) return reply(JSON.stringify({ highlights: ["Birinchi natija qisqa", "Ikkinchi natija", "Uchinchi natija", "x".repeat(200)] }));
    return reply("{}");
  };
}

const BASE: FormValues = {
  topic: "Sun'iy intellekt asosidagi adaptiv o‘qitish",
  articleType: "imrad_oak",
  pubProfile: "oak",
  language: "uz",
  pages: "3-5",
  authors: JSON.stringify([{ name: "Karimova Dilnoza", org: "TDIU" }]),
  udk: "004.8",
  keywords: JSON.stringify(["ai", "ta'lim"]),
  userFacts: "Tajribada 120 talaba ishtirok etdi, o‘rtacha ball 4,1 dan 4,6 ga oshdi.",
  userRefs: JSON.stringify([{ doi: "10.1186/s40561-023-00260-y" }, { raw: "Karimov A. Ta’limda raqamli texnologiyalar. — Toshkent: Fan, 2022." }]),
  figureCount: 1,
  research: true,
};

const FETCH_PLAN = {
  "api.openalex.org/works?": OPENALEX_WORKS,
  "api.crossref.org/works/10.1186%2Fs40561-023-00260-y": CROSSREF_WORK,
  "query.bibliographic=": { message: { items: [] } },
};

async function build(values: FormValues = {}, o: Parameters<typeof makeComplete>[1] = {}) {
  const meta = extractMeta(tool, { ...BASE, ...values });
  const calls: Call[] = [];
  const stages: { progress: number; step: string }[] = [];
  const res = await buildArticleDoc(meta, { ...BASE, ...values }, {
    deadline: Date.now() + 120_000,
    complete: makeComplete(calls, o) as never,
    fetchImpl: stubFetch(FETCH_PLAN),
    retryBaseMs: 0,
    onStage: (ev) => stages.push(ev),
  });
  return { res, calls, stages, meta };
}

test("buildArticleDoc: to'liq oqim — manbalar tekshirilgan, iqtiboslar reyestrda, uydirma id/raqam o'chgan, faktlar verbatim, annotatsiya ×3, cost", async () => {
  const { res, calls, stages, meta } = await build();
  assert.ok(res);
  const { doc, cost, research, guard } = res;

  // Hujjat shakli.
  assert.equal(doc.titlePage, false);
  assert.equal(doc.toc, false);
  assert.ok(doc.article);
  assert.equal(doc.article.type, "imrad_oak");
  assert.equal(doc.article.profile, "oak");
  assert.equal(doc.article.cite, "gost");
  assert.equal(doc.article.udk, "004.8");
  assert.deepEqual(doc.article.authors, [{ name: "Karimova Dilnoza", org: "TDIU" }]);
  assert.equal(doc.article.userFacts, BASE.userFacts);
  assert.equal(doc.meta.language, "uz");

  // Reja: begona `zzz` tashlandi, yo'qolgan hard/required bo'limlar qo'shildi, skelet tartibi.
  assert.deepEqual(doc.sections.map((s) => s.id), ["intro", "litreview_methods", "results", "discussion", "conclusion"]);
  assert.equal(doc.sections[0].title, "Kirish");
  assert.equal(doc.sections[2].title, "Natijalar", "sarlavha skeletdan (kod), modeldan («X») emas");

  // Manbalar: foydalanuvchi DOI → crossref, raw (topilmadi) → user; OpenAlex tanlovi faqat ro'yxatdan.
  assert.equal(research.user, 2);
  assert.equal(research.userVerified, 1);
  assert.equal(research.candidates, 2, "dedup: dublikat DOI va sarlavhasiz tushdi, u1 DOI si bilan ustma-ust tushgan W2741809807 ham");
  const ids = doc.article.references.map((r) => r.id).sort();
  assert.deepEqual(ids, ["W4385000001", "u1"], "faqat iqtibos qilinganlar: u2 (raw) va W3000000003 (tanlangan, lekin iqtibossiz) ro'yxatga kirmaydi");
  assert.ok(doc.article.references.every((r) => r.cited), "ro'yxatda faqat iqtibos qilinganlar");
  assert.ok(doc.article.references.every((r) => r.verified !== "unverified"));
  const u1 = doc.article.references.find((r) => r.id === "u1")!;
  assert.equal(u1.verified, "crossref");
  assert.equal(u1.doi, "10.1186/s40561-023-00260-y");
  assert.equal(doc.referencesNote, undefined, "tasdiqlangan ro'yxat — ogohlantirish yo'q");
  assert.ok(doc.references && doc.references.length === doc.article.references.length, "eski `references` matn ko'rinishi");

  // Iqtiboslar: uydirma [W9999999999] va [3] o'chgan, jumla qolgan.
  const text = doc.sections.flatMap((s) => s.blocks.map((b) => b.text)).join("\n");
  assert.ok(!/W9999999999/.test(text));
  assert.ok(!/\[3\]/.test(text));
  assert.match(text, /Uydirma manba va raqam\./);
  assert.ok(guard.removedCitations >= 2 * 5, `bo‘lim qo‘riqchisi har bo‘limda 2 ta uydirma id ni o‘chirdi: ${guard.removedCitations}`);
  assert.deepEqual(guard.unresolved, [], "yakuniy tekshiruvda hech narsa qolmagan — hammasi qo‘riqchida tozalangan");
  assert.match(text, /\[W4385000001\]/);
  assert.match(text, /\[u1\]/);
  // Foydalanuvchi fakti raqamlari matnda.
  assert.deepEqual(guard.missingFactNumbers, []);
  assert.ok(!guard.unsourcedNumbers.includes("45%"), "45% [u1] bilan manbali — hisobga olinmaydi");

  // Jadval: id, langar, tableRef bloki; sarlavhadagi iqtibos ham tekshirilgan.
  assert.equal(doc.tables?.length, 1);
  assert.equal(doc.tables![0].id, "t1");
  assert.equal(doc.tables![0].anchor, "results");
  const tref = doc.sections[2].blocks.find((b) => b.kind === "tableRef");
  assert.ok(tref && tref.kind === "tableRef" && tref.tableId === "t1");
  // Sxema: spec (flow), noma'lum tugunga qirra tushgan; PNG CHIZILGAN
  // (WP3 `buildFigures` dvigatelga ulangan — `url` data: PNG, o'lchami 1890 px).
  assert.equal(doc.article.figures.length, 1);
  const f = doc.article.figures[0];
  assert.equal(f.spec.kind, "flow");
  assert.match(f.url ?? "", /^data:image\/png;base64,/, "sxema PNG chizilishi kerak");
  assert.equal(f.w, 1890, "300 dpi da 160 mm = 1890 px");
  if (f.spec.kind === "flow") assert.equal(f.spec.edges.length, 2);
  assert.ok(doc.sections.some((s) => s.blocks.some((b) => b.kind === "figure" && b.figureId === "f1")));

  // Annotatsiya ×3, hujjat tili birinchi, iqtibos yo'q, kalit so'zlar chegarada.
  assert.deepEqual(doc.abstracts?.map((a) => a.lang), ["uz", "ru", "en"]);
  assert.ok(doc.abstracts!.every((a) => !/\[W/.test(a.text)));
  assert.equal(doc.abstracts![0].label, "Annotatsiya");
  assert.equal(doc.article.keywords.uz?.length, 6);
  assert.ok(doc.article.keywords.en!.length <= PUBLICATION_PROFILES.oak.keywords[1]);

  // Darvoza: hammasi bor.
  assert.deepEqual(hardMissing(meta, doc), []);
  // Sarf va bosqichlar.
  assert.ok(cost.calls >= 8, `calls=${cost.calls}`);
  assert.equal(cost.inputTokens, cost.calls * 100);
  assert.equal(stages[0].progress, 0);
  assert.equal(stages[stages.length - 1].progress, 86);
  assert.ok(stages.some((s) => /Bo‘limlar yozilmoqda/.test(s.step)));
  // Rollar: fast (so'rovlar), researcher (tanlash), writer (qolgani).
  assert.ok(calls.some((c) => c.role === "fast") && calls.some((c) => c.role === "researcher"));
  assert.ok(calls.filter((c) => c.role === "writer").length >= 5);
});

test("research o'chiq: OpenAlex chaqirilmaydi, faqat foydalanuvchi manbalari; sxema soni 0 → figure so'ralmaydi", async () => {
  const { res, calls } = await build({ research: false, figureCount: 0 });
  assert.ok(res);
  assert.equal(res.research.queries.length, 0);
  assert.ok(!calls.some((c) => c.role === "fast"));
  assert.ok(res.doc.article!.references.every((r) => r.id.startsWith("u")));
  assert.equal(res.doc.article!.figures.length, 0);
  assert.ok(!calls.some((c) => c.user.includes('"figure":')));
});

test("tezis: bitta blok, wordRange 200–300 — tashqarida bo'lsa bir marta qayta yoziladi; sahifa darvozasi so'z bilan", async () => {
  const { res, calls } = await build({ articleType: "conference_thesis", pubProfile: "conference", pages: "1-2" });
  assert.ok(res);
  assert.deepEqual(res.doc.sections.map((s) => s.id), ["body"]);
  const words = res.doc.sections[0].blocks.reduce((n, b) => n + b.text.split(/\s+/).length, 0);
  assert.ok(words >= 200 && words <= 300, `so'z ${words}`);
  assert.deepEqual(res.guard.rewrittenForRange, ["body"]);
  assert.ok(calls.some((c) => c.user.startsWith("The previous text was")));
  assert.equal(res.doc.tables, undefined, "tezisda jadval yo'q");
  assert.equal(articleWordPlan(res.doc.meta, ARTICLE_TYPES.conference_thesis, PUBLICATION_PROFILES.conference).body, 250);
});

test("sistematik sharh: PRISMA sxemasi qidiruv statistikasidan; structured annotatsiya 4 qism; darvoza prismaFigure", async () => {
  const { res, meta } = await build({ articleType: "review_systematic", pubProfile: "apa", pages: "5-10", language: "en", figureCount: 0 });
  assert.ok(res);
  const prisma = res.doc.article!.figures.find((f) => f.spec.kind === "prisma");
  assert.ok(prisma);
  if (prisma.spec.kind === "prisma") {
    assert.equal(prisma.spec.included, res.doc.article!.references.length);
    assert.ok(prisma.spec.identified >= prisma.spec.screened && prisma.spec.screened >= prisma.spec.eligible && prisma.spec.eligible >= prisma.spec.included);
  }
  assert.match(prisma.caption, /PRISMA/);
  assert.ok(res.doc.sections.find((s) => s.id === "results")!.blocks.some((b) => b.kind === "figure" && b.figureId === prisma.id));
  assert.deepEqual(structureNeeds(meta).slice(-1), ["prismaFigure"]);
  assert.deepEqual(hardMissing(meta, res.doc), []);
  assert.match(res.doc.abstracts![0].text, /^Background: /);
  assert.match(res.doc.abstracts![0].text, /\nConclusions: /);
  assert.equal(res.doc.abstracts![0].lang, "en");
});

test("elsevier: highlights 3–5 × ≤85 belgi (uzun qisqartiriladi, ortiqchasi kesiladi); raqamlangan sarlavha modeldan emas", async () => {
  const { res } = await build({ articleType: "elsevier_ieee_style", pubProfile: "ieee", pages: "5-10", language: "en" });
  assert.ok(res);
  const h = res.doc.article!.highlights!;
  assert.ok(h.length >= 3 && h.length <= 5, `${h.length}`);
  assert.ok(h.every((x) => x.length <= 85), h.map((x) => x.length).join(","));
});

test("bo'sh majburiy bo'lim: qayta so'rov; baribir bo'sh bo'lsa hujjat qaytadi va darvoza yiqitadi (kredit qaytadi)", async () => {
  const { res, meta, calls } = await build({}, { emptySection: "results" });
  assert.ok(res);
  assert.ok(res.guard.emptySections.includes("results"));
  assert.ok(calls.filter((c) => c.user.includes("(id results)")).length >= 2, "qayta so'rov");
  assert.deepEqual(hardMissing(meta, res.doc), ["section:results"]);
  assert.ok(missingStructure(meta, res.doc).includes("section:results"));
});

test("annotatsiya chiqmasa (bir til) — qolganlari qoladi; hammasi chiqmasa `abstract` darvozasi", async () => {
  const { res } = await build({}, { noAbstract: "Russian" });
  assert.ok(res);
  assert.deepEqual(res.doc.abstracts?.map((a) => a.lang), ["uz", "en"]);
  const none = await build({}, { noAbstract: "*" });
  assert.equal(none.res!.doc.abstracts, undefined);
  assert.ok(hardMissing(none.meta, none.res!.doc).includes("abstract"));
});

test("reja JSON buzuq — deterministik reja (skelet), hujjat baribir chiqadi", async () => {
  const { res } = await build({}, { badOutline: true });
  assert.ok(res);
  assert.deepEqual(res.doc.sections.map((s) => s.id), ["intro", "litreview_methods", "results", "discussion", "conclusion"]);
});

test("LLM yo'q (seam ham, kalit ham) → null", async () => {
  const saved = { g: process.env.GEMINI_API_KEY, x: process.env.XAI_API_KEY };
  delete process.env.GEMINI_API_KEY;
  delete process.env.XAI_API_KEY;
  try {
    assert.equal(await buildArticleDoc(extractMeta(tool, BASE), BASE, { deadline: Date.now() + 10_000 }), null);
  } finally {
    if (saved.g) process.env.GEMINI_API_KEY = saved.g;
    if (saved.x) process.env.XAI_API_KEY = saved.x;
  }
});

/* ────────────────────────── birliklar ────────────────────────── */

function ctx(values: FormValues = {}): ArticleContext {
  const input = articleInputFromValues({ ...BASE, ...values });
  const type = ARTICLE_TYPES[input.articleType];
  const profile = PUBLICATION_PROFILES[input.pubProfile];
  const meta = { ...extractMeta(tool, { ...BASE, ...values }), language: input.language };
  return { input, meta, type, profile, labels: articleLabels(input.language), wordTarget: articleWordPlan(meta, type, profile).body, refs: [] };
}

test("outlineFromLlm: erkin bo'limlar body-1..N (min..max), sarlavha modeldan; skelet bo'limlari sarlavhasi koddan; so'zlar ulushga qarab", () => {
  const c = ctx({ articleType: "three_part_uz", pubProfile: "university" });
  const plans = outlineFromLlm(JSON.stringify({ sections: [{ id: "intro", title: "Muqaddima", brief: "b" }, { id: "body-1", title: "Tarixiy ildizlar", brief: "b1" }, { id: "body", title: "Zamonaviy qarashlar", brief: "b2" }] }), c);
  assert.deepEqual(plans.map((p) => p.id), ["intro", "body-1", "body-2", "body-3", "conclusion"], "min 3 erkin bo'lim to'ldiriladi, xulosa qo'shiladi");
  assert.equal(plans[0].title, "Kirish", "skelet sarlavhasi koddan");
  assert.equal(plans[1].title, "Tarixiy ildizlar");
  assert.equal(plans[2].title, "Zamonaviy qarashlar");
  assert.equal(plans[1].skeletonId, "body");
  const total = plans.reduce((n, p) => n + p.words, 0);
  assert.ok(Math.abs(total - c.wordTarget) < c.wordTarget * 0.1, `${total} vs ${c.wordTarget}`);
  // 7 ta erkin bo'lim → max 5.
  const many = outlineFromLlm(JSON.stringify({ sections: Array.from({ length: 7 }, (_, i) => ({ id: `body-${i + 1}`, title: `B${i}`, brief: "" })) }), c);
  assert.equal(many.filter((p) => p.skeletonId === "body").length, 5);
  assert.deepEqual(fallbackOutline(ctx()).map((p) => p.id), ["intro", "litreview_methods", "results", "discussion", "conclusion"]);
});

test("planVisuals: figureCount ta sxema o'rta bo'limlarga, jadval natija bo'limiga; userData → chart; tezisda vizual yo'q; CARE → timeline jadvali", () => {
  const c = ctx({ figureCount: 2 });
  const v = planVisuals(c, fallbackOutline(c));
  assert.equal([...v.values()].filter((x) => x.figure).length, 2);
  assert.equal(v.get("results")!.table, true);
  assert.equal(v.get("intro")!.figure, false);
  const chart = planVisuals(ctx({ figureCount: 1, userData: '{"categories":["a","b"],"series":[{"name":"S","values":[1,2]}]}' }), fallbackOutline(c));
  assert.equal(chart.get("results")!.chart, true);
  assert.equal([...chart.values()].filter((x) => x.figure).length, 0, "bitta slot chartga ketdi");
  const thesis = ctx({ articleType: "conference_thesis", pubProfile: "conference", pages: "1-2", figureCount: 3 });
  assert.ok([...planVisuals(thesis, fallbackOutline(thesis)).values()].every((x) => !x.figure && !x.table && !x.chart));
  const care = ctx({ articleType: "case_study_care", pubProfile: "apa", pages: "3-5" });
  assert.equal(planVisuals(care, fallbackOutline(care)).get("timeline")!.table, true);
});

test("figureSpecFromLlm: chegaralar (14 tugun/24 qirra), noma'lum qirra tushadi, chart faqat userData bilan va ma'lumot foydalanuvchidan, prisma qabul qilinmaydi", () => {
  const nodes = Array.from({ length: 20 }, (_, i) => ({ id: `n${i}`, label: `L${i}` }));
  const edges = Array.from({ length: 30 }, (_, i) => ({ from: `n${i % 14}`, to: `n${(i + 1) % 14}` }));
  const flow = figureSpecFromLlm({ kind: "flow", direction: "LR", nodes, edges }, {});
  assert.ok(flow && flow.kind === "flow");
  if (flow.kind === "flow") {
    assert.equal(flow.nodes.length, 14);
    assert.equal(flow.edges.length, 24);
    assert.equal(flow.direction, "LR");
  }
  assert.equal(figureSpecFromLlm({ kind: "flow", nodes: [{ id: "a", label: "A" }], edges: [] }, {}), null, "1 tugun — sxema emas");
  assert.equal(figureSpecFromLlm({ kind: "chart", chart: "bar", series: [{ name: "x", values: [1] }], categories: ["a"] }, {}), null, "userData yo'q — chart yo'q");
  const userData = { categories: ["2022", "2023"], series: [{ name: "Talabalar", values: [80, 120] }] };
  const chart = figureSpecFromLlm({ kind: "chart", chart: "line", categories: ["fake"], series: [{ name: "fake", values: [9] }] }, { userData });
  assert.deepEqual(chart, { kind: "chart", chart: "line", dataSource: "user", categories: ["2022", "2023"], series: [{ name: "Talabalar", values: [80, 120] }] });
  assert.equal(figureSpecFromLlm({ kind: "prisma", identified: 100 }, {}), null);
  assert.deepEqual(figureSpecFromLlm({ kind: "process", steps: ["a", "b", "c"] }, {}), { kind: "process", steps: ["a", "b", "c"] });
  const tree = figureSpecFromLlm({ kind: "tree", root: "R", children: [{ label: "A", children: [{ label: "A1" }] }, { label: "B" }] }, {});
  assert.deepEqual(tree, { kind: "tree", root: "R", children: [{ label: "A", children: [{ label: "A1" }] }, { label: "B" }] });
});

test("tableFromLlm / blocksFromLlm chekkalari", () => {
  assert.equal(tableFromLlm({ headers: ["a"], rows: [["1"]] }), null, "bitta ustun — jadval emas");
  const t = tableFromLlm({ caption: "C", headers: ["a", "b", "c"], rows: [["1", "2"], [], ["x", "y", "z", "extra"]], anchorAfterBlock: "2" })!;
  assert.deepEqual(t.table.rows, [["1", "2", ""], ["x", "y", "z"]]);
  assert.equal(t.after, 2);
  assert.deepEqual(blocksFromLlm([{ kind: "h2", text: "Sarlavha bo'lib kelgan uzun matn" }, { kind: "li", text: "qisqa" }, "Oddiy satr sifatida kelgan paragraf matni"], ""), [
    { kind: "p", text: "Sarlavha bo'lib kelgan uzun matn" },
    { kind: "p", text: "Oddiy satr sifatida kelgan paragraf matni" },
  ]);
  assert.ok(blocksFromLlm(null, `Model JSON o'rniga oddiy matn yozdi. ${para(1)}`).length >= 1, "matn fallback");
  assert.deepEqual(blocksFromLlm(null, "{}"), []);
});

test("collectReferences: dedup (DOI/sarlavha), tanlov faqat ro'yxatdan, kam tanlansa reytingdan to'ldiriladi, OpenAlex tushsa foydalanuvchi manbalari qoladi", async () => {
  const input = articleInputFromValues({ ...BASE, userRefs: "[]" });
  const meta = extractMeta(tool, BASE);
  const complete = (async (role: LlmRole) => ({ text: role === "researcher" ? '{"ids":["W4385000001","W_FAKE"]}' : '{"queries":["q1","q2","q3","q4"]}' })) as never;
  const r = await collectReferences(input, meta, { deadline: Date.now() + 30_000, complete, fetchImpl: stubFetch(FETCH_PLAN), retryBaseMs: 0 });
  assert.equal(r.stats.found, 16, "4 so'rov × 4 yaroqli yozuv");
  assert.equal(r.stats.candidates, 3, "dedup: 3 noyob");
  assert.ok(r.refs.length >= 3, "refsMin=10 > nomzod — hammasi olinadi");
  assert.equal(r.refs[0].id, "W4385000001", "model tanlovi birinchi");
  assert.ok(r.refs.every((x) => x.verified === "openalex" && !x.cited));
  assert.ok(!("abstract" in r.refs[0]), "abstract hujjatga tushmaydi");
  const down = await collectReferences(articleInputFromValues(BASE), meta, { deadline: Date.now() + 30_000, complete, fetchImpl: stubFetch({ "api.crossref.org/works/": CROSSREF_WORK, "query.bibliographic=": { message: { items: [] } }, "api.openalex.org": { __status: 503 } }), retryBaseMs: 0 });
  assert.deepEqual(down.refs.map((x) => x.id), ["u1", "u2"]);
  assert.equal(down.stats.failedQueries, 4);
  assert.deepEqual(parseSelection('{"ids":["w4385000001","nope"]}', new Map([["W4385000001", r.refs[0]]])), ["W4385000001"]);
  const d = dedupeReferences([
    { id: "a", doi: "10.1/X", title: "T", authors: [], verified: "user", cited: false },
    { id: "b", doi: "10.1/x", title: "Other", authors: [], verified: "openalex", cited: false },
    { id: "c", title: "Adaptive learning platforms and outcomes", authors: [], verified: "openalex", cited: false },
    { id: "d", title: "Adaptive Learning Platforms and Outcomes!", authors: [], verified: "openalex", cited: false },
  ]);
  assert.deepEqual(d.map((x) => x.id), ["a", "c"]);
});

test("so'z rejasi profilga bog'liq; byudjet 150 000 + 16 000 × bet; prismaSpec monoton", () => {
  assert.equal(articleWordsPerPage(PUBLICATION_PROFILES.oak), 230);
  assert.equal(articleWordsPerPage(PUBLICATION_PROFILES.ieee), 403);
  const meta = extractMeta(tool, { ...BASE, pages: "10-15" });
  assert.equal(meta.targetPages, 13);
  const oak = articleWordPlan(meta, ARTICLE_TYPES.imrad_oak, PUBLICATION_PROFILES.oak);
  const ieee = articleWordPlan(meta, ARTICLE_TYPES.elsevier_ieee_style, PUBLICATION_PROFILES.ieee);
  assert.ok(ieee.body > oak.body * 1.5, `${ieee.body} vs ${oak.body}`);
  assert.equal(oak.total, 13 * 230);
  assert.equal(budgetFor(tool, { ...BASE, pages: "10-15" }, 660_000), 150_000 + 13 * 16_000);
  assert.equal(budgetFor(tool, { ...BASE, articleType: "conference_thesis", pages: "1-2" }, 660_000), 150_000 + 2 * 16_000);
  assert.equal(budgetFor(tool, { ...BASE, pages: "10-15" }, 300_000), 300_000, "cap");
  const p = prismaSpec({ user: 2, userVerified: 1, queries: ["a"], found: 40, candidates: 25, selected: 12, failedQueries: 0 }, 9);
  if (p.kind === "prisma") {
    assert.deepEqual([p.identified, p.screened, p.excludedScreen, p.eligible, p.excludedElig, p.included], [42, 27, 13, 14, 5, 9]);
  }
});
