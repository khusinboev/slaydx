import test from "node:test";
import assert from "node:assert/strict";
import { TOOL_BY_ID, missingRequired, preflightError, priceFor } from "../lib/tools.ts";
import type { FormValues } from "../lib/types.ts";
import { extractMeta } from "../lib/generation/meta.ts";
import { ARTICLE_FORM_FIELDS, ARTICLE_JSON_FIELDS, ARTICLE_PARAMS, type ArticleParamImpact } from "../lib/generation/article-params.ts";
import { articleInputFromValues } from "../lib/generation/article/input.ts";
import { ARTICLE_TYPES } from "../lib/generation/article/types-registry.ts";
import { PUBLICATION_PROFILES } from "../lib/generation/article/profiles.ts";
import { articleLabels } from "../lib/generation/article/labels.ts";
import { abstractPrompt, articleSystemPrompt, outlinePrompt, queriesPrompt, sectionPrompt, type ArticleContext } from "../lib/generation/article/prompts.ts";
import { articleWordPlan, buildArticleDoc, fallbackOutline, figureSpecFromLlm, planVisuals } from "../lib/generation/article/engine.ts";
import { factNumbers } from "../lib/generation/article/guard.ts";
import { collectReferences } from "../lib/generation/research/pipeline.ts";
import { setSourceCacheStore } from "../lib/generation/research/cache.ts";
import type { LlmRole } from "../lib/generation/llm-roles.ts";
import { OPENALEX_WORKS, stubFetch } from "./helpers/research-fixtures.ts";

/**
 * MAQOLA PARAMETR SHARTNOMASI — «bezak maydon yo'q» kafolati (Maqola 2).
 *
 * `tests/resume-params.test.mts` naqshi: reyestrdagi har parametr uchun
 * `probeA`/`probeB` bilan differensial zond va e'lon qilingan HAR ta'sirda
 * A ≠ B. `layout` — `planArticle` (WP2) hali yo'q, shuning uchun
 * `doc.article`/`doc.meta` farqi o'lchanadi (lead ko'rsatmasi).
 */

test.beforeEach(() => setSourceCacheStore(null));
test.after(() => setSourceCacheStore(undefined));

const article = TOOL_BY_ID.article;

const BASE: FormValues = {
  topic: "Sun'iy intellekt ta'limda",
  articleType: "imrad_oak",
  pubProfile: "oak",
  language: "uz",
  pages: "3-5",
  authors: '[{"name":"Aliyev Ali"}]',
  udk: "",
  keywords: "[]",
  userFacts: "",
  userRefs: "[]",
  userData: "",
  figureCount: 1,
  research: true,
  extra: "",
};

function ctxOf(values: FormValues): ArticleContext {
  const input = articleInputFromValues(values);
  const meta = { ...extractMeta(article, values), language: input.language };
  const type = ARTICLE_TYPES[input.articleType];
  const profile = PUBLICATION_PROFILES[input.pubProfile];
  const plan = articleWordPlan(meta, type, profile);
  return { input, meta, type, profile, labels: articleLabels(input.language), wordTarget: plan.body, plan, refs: [] };
}

/**
 * Deterministik LLM stub: `fast` — javobsiz (deterministik so'rovlar),
 * annotatsiya — muallif kalit so'zlarini aks ettiradi, bo'lim — `[u1]`
 * iqtibosi bilan (foydalanuvchi manbasi bo'lsa ro'yxatga tushadi).
 */
const stubComplete = (async (role: LlmRole, _system: string, user: string) => {
  if (role === "fast") return null;
  if (role === "researcher") return { text: '{"ids":["W4385000001"]}' };
  if (user.startsWith("Plan")) return { text: "{}" };
  if (user.startsWith("Write the section")) {
    const p = "Adaptiv tizim talabaning o‘zlashtirish sur’atiga moslashadi va natijani oshiradi. ".repeat(10);
    return { text: JSON.stringify({ blocks: [{ kind: "p", text: `${p} [u1] [W4385000001].` }, { kind: "p", text: p }] }) };
  }
  if (user.startsWith("Write the abstract")) {
    const kw = user.match(/Author-suggested keywords[^:]*: (.+)/)?.[1]?.split(", ") ?? ["a", "b", "c", "d", "e"];
    const lang = user.match(/abstract in (\w+)/)?.[1] ?? "x";
    return { text: JSON.stringify({ text: Array.from({ length: 160 }, (_, i) => `${lang}${i}`).join(" "), background: "b ".repeat(40), methods: "m ".repeat(40), results: "r ".repeat(40), conclusions: "c ".repeat(40), keywords: kw }) };
  }
  return { text: "{}" };
}) as never;

const FETCH = () => stubFetch({ "api.openalex.org/works?": OPENALEX_WORKS, "api.crossref.org": { message: { items: [] } } });

type Probe = Record<ArticleParamImpact, string>;

async function probe(values: FormValues): Promise<Probe> {
  const v = { ...BASE, ...values };
  const ctx = ctxOf(v);
  const plans = fallbackOutline(ctx);
  const visuals = planVisuals(ctx, plans);
  const mid = plans.find((p) => p.skeletonId === "results" || p.skeletonId === "body") ?? plans[0];
  const ask = { plan: mid, ...(visuals.get(mid.id) ?? { table: false, figure: false, chart: false }) };
  const wantTable = ask.table;
  const meta = extractMeta(article, v);
  const research = await collectReferences(ctx.input, meta, { deadline: Date.now() + 20_000, complete: stubComplete, fetchImpl: FETCH(), retryBaseMs: 0, year: 2026 });
  const built = await buildArticleDoc(meta, v, { deadline: Date.now() + 60_000, complete: stubComplete, fetchImpl: FETCH(), retryBaseMs: 0 });
  assert.ok(built, "zond: hujjat qurilishi kerak");
  const d = built.doc;
  return {
    prompt: [articleSystemPrompt(ctx), outlinePrompt(ctx), sectionPrompt(ctx, { plan: mid, wantTable, wantFigure: ask.figure, wantChart: ask.chart }), abstractPrompt(ctx, "en", "…"), queriesPrompt(ctx.input)].join("\n"),
    structure: `${ctx.type.id}:${plans.map((p) => p.id).join(",")}`,
    profile: JSON.stringify(ctx.profile),
    layout: JSON.stringify({
      article: d.article,
      meta: { topic: d.meta.topic, language: d.meta.language, articleType: d.meta.articleType, pubProfile: d.meta.pubProfile, citeStyle: d.meta.citeStyle, udk: d.meta.udk },
      sections: d.sections.map((s) => [s.id, s.title]),
      abstracts: d.abstracts?.map((a) => a.lang),
    }),
    research: JSON.stringify({ queries: research.stats.queries, refs: research.refs.map((r) => [r.id, r.verified]) }),
    figures: JSON.stringify({ plan: [...visuals.entries()], chart: figureSpecFromLlm({ kind: "chart", chart: "bar", categories: ["x"], series: [{ name: "s", values: [1] }] }, ctx.input) }),
    review: JSON.stringify({ refsMin: ctx.profile.refsMin, refsMax: ctx.profile.refsMax, recent: [ctx.profile.recentYearsMin, ctx.profile.recentShare], abstractWords: ctx.profile.abstractWords, keywords: ctx.profile.keywords, facts: factNumbers(ctx.input.userFacts) }),
    price: String(priceFor(article, v)),
    language: `${ctx.input.language}/${d.meta.language}`,
  };
}

// ───────────────────────────────────────────── reyestr tuzilishi

test("reyestr: 15 parametr, JSON maydonlar reyestr bilan mos, forma qamrovi ro'yxati", () => {
  assert.equal(ARTICLE_PARAMS.length, 15);
  assert.deepEqual(ARTICLE_FORM_FIELDS, ARTICLE_PARAMS.map((p) => p.id));
  assert.deepEqual(
    ARTICLE_PARAMS.filter((p) => p.encode === "json").map((p) => p.id).sort(),
    [...ARTICLE_JSON_FIELDS].sort(),
  );
});

test("differensial zond: reyestrdagi HAR parametr e'lon qilingan ta'sirini beradi", async () => {
  const failures: string[] = [];
  for (const p of ARTICLE_PARAMS) {
    const base = p.probeWith ?? {};
    const a = await probe({ ...base, [p.id]: p.probeA });
    const b = await probe({ ...base, [p.id]: p.probeB });
    for (const impact of p.impacts) {
      if (a[impact] === b[impact]) failures.push(`${p.id} → ${impact}`);
    }
  }
  assert.deepEqual(failures, [], `bezak parametrlar (A va B bir xil chiqdi):\n  ${failures.join("\n  ")}`);
});

test("zond maydonlari haqiqatan turlicha: har ta'sir kamida bitta parametrda e'lon qilingan", () => {
  const declared = new Set(ARTICLE_PARAMS.flatMap((p) => p.impacts));
  for (const impact of ["prompt", "structure", "profile", "layout", "research", "figures", "review", "price", "language"] as ArticleParamImpact[]) {
    assert.ok(declared.has(impact), `${impact}: hech bir parametr bu ta'sirni e'lon qilmagan — zond o'lik`);
  }
});

// ───────────────────────────────────────────── narx va majburiy maydonlar

test("narx faqat hajmdan (tur hajmni cheklaydi): boshqa parametrlar narxni qimirlatmaydi", () => {
  for (const p of ARTICLE_PARAMS) {
    if (p.impacts.includes("price")) continue;
    const base = p.probeWith ?? {};
    const a = priceFor(article, { ...BASE, ...base, [p.id]: p.probeA });
    const b = priceFor(article, { ...BASE, ...base, [p.id]: p.probeB });
    assert.equal(a, b, `${p.id}: narxni o'zgartirdi (${a} vs ${b})`);
  }
  assert.equal(priceFor(article, { ...BASE, pages: "3-5" }), 6000);
  assert.equal(priceFor(article, { ...BASE, pages: "10-15" }), 12000);
  // Tur hajmni cheklaydi: tezis «10-15» so'rasa ham 1-2 narxi va hajmi.
  assert.equal(priceFor(article, { ...BASE, articleType: "conference_thesis", pages: "10-15" }), 4000);
  assert.equal(articleInputFromValues({ ...BASE, articleType: "conference_thesis", pages: "10-15" }).pages, "1-2");
});

test("missingRequired: mavzu + tur; preflightError: noma'lum tur/profil rad, eski `kind` o'tadi", () => {
  assert.deepEqual(missingRequired(article, {}), [article.topicLegend, "Maqola turi"]);
  assert.deepEqual(missingRequired(article, { topic: "Mavzu", articleType: "imrad_oak" }), []);
  assert.equal(preflightError(article, { topic: "Mavzu", articleType: "zzz" }), "Noma'lum maqola turi");
  assert.equal(preflightError(article, { topic: "Mavzu", articleType: "imrad_oak", pubProfile: "harvard" }), "Noma'lum nashr profili");
  assert.equal(preflightError(article, { topic: "AI", articleType: "imrad_oak" }), "Mavzu juda qisqa.");
  assert.equal(preflightError(article, { topic: "Mavzu", articleType: "imrad_oak", pubProfile: "apa" }), null);
  assert.equal(article.custom, "article");
  assert.equal(article.fields.length, 1, "faqat majburiy `articleType` (CUSTOM_REQUIRED); forma WP6 da");
});

test("extractMeta: maqola maydonlari klamplanadi", () => {
  const m = extractMeta(article, { ...BASE, articleType: "review_systematic", pubProfile: "apa", citeStyle: "ieee", udk: "0".repeat(60), figureCount: 9, research: false, pages: "10-15" });
  assert.equal(m.articleType, "review_systematic");
  assert.equal(m.pubProfile, "apa");
  assert.equal(m.citeStyle, "ieee");
  assert.equal(m.udk.length, 40);
  assert.equal(m.figureCount, 4);
  // Sxema soni PAKETGA bog'liq — `parseArticleInput` bilan bir xil chegara (`FIGURES_BY_PAGES`).
  assert.equal(extractMeta(article, { ...BASE, figureCount: 9, pages: "3-5" }).figureCount, 1);
  assert.equal(extractMeta(article, { ...BASE, figureCount: 2, pages: "1-2" }).figureCount, 0);
  assert.equal(extractMeta(article, { ...BASE, figureCount: 4, pages: "5-10" }).figureCount, 3);
  assert.equal(m.research, false);
  const bad = extractMeta(article, { ...BASE, articleType: "zzz", pubProfile: "zzz", citeStyle: "zzz" });
  assert.equal(bad.articleType, undefined);
  assert.equal(bad.pubProfile, undefined);
  assert.equal(bad.citeStyle, undefined);
  assert.equal(bad.research, true);
});
