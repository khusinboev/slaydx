import test from "node:test";
import assert from "node:assert/strict";
import type { FormValues } from "../lib/types.ts";
import { TOOL_BY_ID } from "../lib/tools.ts";
import { extractMeta } from "../lib/generation/meta.ts";
import { articleInputFromValues } from "../lib/generation/article/input.ts";
import { ARTICLE_TYPES } from "../lib/generation/article/types-registry.ts";
import { PUBLICATION_PROFILES } from "../lib/generation/article/profiles.ts";
import { ARTICLE_TYPE_IDS, PUBLICATION_PROFILE_IDS, type ArticleTypeId, type PublicationProfileId } from "../lib/generation/article/types.ts";
import { articleLabels } from "../lib/generation/article/labels.ts";
import { articleWordPlan } from "../lib/generation/article/plan.ts";
import { articleSystemPrompt, outlinePrompt, type ArticleContext } from "../lib/generation/article/prompts.ts";
import { judgeSystemPrompt, ruleChecks } from "../lib/generation/article/review.ts";
import { articleProfile } from "../lib/generation/docx-profile.ts";
import { planArticle } from "../lib/generation/article/layout.ts";
import { sampleArticleDoc } from "../lib/generation/article/samples.ts";
import type { DocMeta } from "../lib/generation/types.ts";

/**
 * 12 tur × 5 profil MATRITSASI (AUDIT-18 Q-9). Reyestr zondi
 * (`article-params`) har parametr uchun faqat BITTA A/B juftlikni tekshiradi
 * — ichida ayrim tur/profillar bir-birining nusxasi bo'lib qolishi mumkin
 * («bezak»). Bu test har turni HAR BIR qo'shnisidan (skelet + yozish
 * qoidalari + reja prompti) va har profilni har qo'shnisidan (render +
 * hisobot chegaralari) ajratadi; turga bog'liq baholovchi ham qulflanadi.
 */

const tool = TOOL_BY_ID.article;
const META = { topic: "Sun’iy intellektning oliy ta’limdagi o‘rni", author: "K", workLabel: "Maqola", language: "uz", toolId: "article" } as unknown as DocMeta;

function ctxOf(values: FormValues): ArticleContext {
  const input = articleInputFromValues(values);
  const meta = { ...extractMeta(tool, values), language: input.language };
  const type = ARTICLE_TYPES[input.articleType];
  const profile = PUBLICATION_PROFILES[input.pubProfile];
  const plan = articleWordPlan(meta, type, profile);
  return { input, meta, type, profile, labels: articleLabels(input.language), wordTarget: plan.body, plan, refs: [] };
}

test("12 tur: har birida ≥2 yozish qoidasi; skelet va qoidalar juft-juft farq qiladi; tizim/reja prompti har tur uchun turlicha", () => {
  const ids = [...ARTICLE_TYPE_IDS] as ArticleTypeId[];
  assert.equal(ids.length, 12);
  const sys = new Map<ArticleTypeId, string>();
  const outline = new Map<ArticleTypeId, string>();
  for (const id of ids) {
    const t = ARTICLE_TYPES[id];
    assert.ok(t.guidance.length >= 2, `${id}: yozish qoidalari ${t.guidance.length} ta`);
    for (const g of t.guidance) assert.ok(g.length >= 60, `${id}: qoida juda qisqa — «${g}»`);
    const c = ctxOf({ topic: "Mavzu", articleType: id, pubProfile: t.defaultProfile, pages: t.pages[0] });
    const s = articleSystemPrompt(c);
    assert.ok(s.includes(`TYPE RULES (${t.label.en}):`), `${id}: TYPE RULES yo'q`);
    for (const g of t.guidance) assert.ok(s.includes(g), `${id}: qoida promptga tushmagan`);
    sys.set(id, s.slice(s.indexOf("TYPE RULES")));
    outline.set(id, outlinePrompt(c));
  }
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = ARTICLE_TYPES[ids[i]];
      const b = ARTICLE_TYPES[ids[j]];
      assert.notDeepEqual(a.skeleton.map((s) => s.id), b.skeleton.map((s) => s.id), `${ids[i]} va ${ids[j]}: bir xil skelet`);
      assert.notDeepEqual(a.guidance, b.guidance, `${ids[i]} va ${ids[j]}: bir xil yozish qoidalari`);
      assert.notEqual(sys.get(ids[i]), sys.get(ids[j]), `${ids[i]} va ${ids[j]}: bir xil TYPE RULES`);
      assert.notEqual(outline.get(ids[i]), outline.get(ids[j]), `${ids[i]} va ${ids[j]}: bir xil reja prompti`);
    }
  }
});

test("baholovchi turga bog'liq: sharh/metodik/tahliliy/CARE/tizimli sharh o'z mezon ta'rifi bilan; tezis 4 mezon; IMRAD standart", () => {
  const ids = ["body", "intro"];
  const base = judgeSystemPrompt(ids);
  const custom = (["review_narrative", "review_systematic", "methodical", "analytical", "case_study_care", "three_part_uz", "conference_thesis", "short_communication"] as ArticleTypeId[]).map((id) => [id, judgeSystemPrompt(ids, ARTICLE_TYPES[id].judge, ARTICLE_TYPES[id].label.en)] as const);
  for (const [id, p] of custom) assert.notEqual(p, base, `${id}: baholovchi prompti standart bilan bir xil`);
  const seen = new Set<string>();
  for (const [id, p] of custom) {
    const body = p.slice(p.indexOf("Score each"), p.indexOf("Then give"));
    assert.ok(!seen.has(body), `${id}: mezon bloki boshqa tur bilan bir xil`);
    seen.add(body);
  }
  for (const id of ["imrad_oak", "imrad_classic", "elsevier_ieee_style", "conference_extended"] as ArticleTypeId[]) {
    assert.equal(ARTICLE_TYPES[id].judge, undefined, `${id}: IMRAD turlari standart 6 mezon bilan`);
  }
  assert.deepEqual(ARTICLE_TYPES.conference_thesis.judge?.skip, ["comparison", "methods"]);
  assert.deepEqual(ARTICLE_TYPES.three_part_uz.judge?.skip, ["methods"]);
});

test("5 profil: har juftlik render (docx profil/reja) YOKI hisobot chegaralari bo'yicha farq qiladi; har profil ≥3 maydonda qo'shnisidan farqli", () => {
  const ids = [...PUBLICATION_PROFILE_IDS] as PublicationProfileId[];
  const KEYS = ["sizePt", "line", "marginsCm", "cite", "refsMin", "refsMax", "recentShare", "secondEnglishList", "udk", "numberedSections", "tableSizePt", "refsSizePt", "refsLine", "abstractLine", "abstractWords", "keywords", "maxPages"] as const;
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = PUBLICATION_PROFILES[ids[i]];
      const b = PUBLICATION_PROFILES[ids[j]];
      const diff = KEYS.filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
      assert.ok(diff.length >= 3, `${ids[i]} va ${ids[j]}: faqat ${diff.join(",")} farq qiladi`);
      // Render: DOCX profil (chegara/shrift/interval) yoki reja (iqtibos ko'rinishi, ikkinchi ro'yxat, raqamlash).
      const da = JSON.stringify(articleProfile(ids[i]));
      const db = JSON.stringify(articleProfile(ids[j]));
      const pa = planArticle(sampleArticleDoc(META, { profile: ids[i] }));
      const pb = planArticle(sampleArticleDoc(META, { profile: ids[j] }));
      const renderDiff = da !== db || JSON.stringify([pa.head, pa.refs, pa.refs2]) !== JSON.stringify([pb.head, pb.refs, pb.refs2]);
      assert.ok(renderDiff, `${ids[i]} va ${ids[j]}: DOCX ham, reja ham bir xil`);
    }
  }
  // Hisobot chegaralari profilga ergashadi: bir xil hujjat oak da 12 manba yetarli, apa da (≥15) kam.
  const doc = sampleArticleDoc(META, { profile: "oak" });
  const refs = Array.from({ length: 12 }, (_, i) => ({ id: `W${i}`, title: `P${i}`, authors: ["A"], year: 2024, verified: "openalex" as const, cited: true }));
  doc.article!.references = refs;
  doc.sections[0].blocks.push({ kind: "p", text: refs.map((r) => `[${r.id}]`).join(" ") });
  const lvl = (profile: PublicationProfileId) => {
    const d = structuredClone(doc);
    d.article!.profile = profile;
    return ruleChecks(d, { wordTarget: 300 }).checks.find((c) => c.id === "refsCount")?.level;
  };
  assert.equal(lvl("oak"), "green");
  assert.equal(lvl("apa"), "red", "apa ≥15 manba talab qiladi — profil hisobotga ta'sir qilmasa bezak");
});
