import test from "node:test";
import assert from "node:assert/strict";
import { ARTICLE_TYPES, hardSections, isArticleTypeId, normalizeArticleType } from "../lib/generation/article/types-registry.ts";
import { PUBLICATION_PROFILES, normalizePublicationProfile } from "../lib/generation/article/profiles.ts";
import { ARTICLE_TYPE_IDS, PUBLICATION_PROFILE_IDS, CITE_STYLES } from "../lib/generation/article/types.ts";
import { articleLabels } from "../lib/generation/article/labels.ts";
import { ARTICLE_PARAMS } from "../lib/generation/article-params.ts";

/**
 * Maqola 2 reyestrlari (WP0): 12 tur, 5 profil, yorliqlar, parametrlar.
 * Tuzilma testi — dvigatel/forma keyingi WP larda shu shartnomaga tayanadi.
 */

test("12 maqola turi: har birida skelet, ulushlar ≈ 100, kamida bitta hard bo'lim, standart profil mavjud", () => {
  assert.equal(ARTICLE_TYPE_IDS.length, 12);
  for (const id of ARTICLE_TYPE_IDS) {
    const t = ARTICLE_TYPES[id];
    assert.equal(t.id, id);
    assert.ok(t.skeleton.length >= 1, `${id}: skelet bo'sh`);
    const sum = t.skeleton.reduce((a, s) => a + s.sharePct, 0);
    assert.ok(Math.abs(sum - 100) <= 2, `${id}: ulushlar yig'indisi ${sum}`);
    assert.ok(hardSections(id).length >= 1, `${id}: hard bo'lim yo'q — darvoza ishlamaydi`);
    assert.ok(PUBLICATION_PROFILE_IDS.includes(t.defaultProfile), `${id}: profil`);
    assert.ok(t.pages.length >= 1, `${id}: hajm paketi yo'q`);
    const ids = t.skeleton.map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length, `${id}: bo'lim id takrorlanadi`);
    assert.ok(t.label.uz && t.label.ru && t.label.en && t.hint);
  }
  // Maxsus talablar
  assert.equal(ARTICLE_TYPES.review_systematic.requiresPrisma, true);
  assert.equal(ARTICLE_TYPES.case_study_care.requiresTimeline, true);
  assert.deepEqual(ARTICLE_TYPES.conference_thesis.wordRange, [200, 300]);
  assert.equal(ARTICLE_TYPES.elsevier_ieee_style.numberedHeadings, true);
  assert.deepEqual(ARTICLE_TYPES.imrad_oak.skeleton.map((s) => s.id), ["intro", "litreview_methods", "results", "discussion", "conclusion"]);
});

test("tur normalizatsiyasi: eski `kind` ko'chadi, noma'lum → imrad_oak", () => {
  assert.equal(normalizeArticleType("review_narrative"), "review_narrative");
  assert.equal(normalizeArticleType(undefined, "imrad"), "imrad_classic");
  assert.equal(normalizeArticleType("", "standard"), "three_part_uz");
  assert.equal(normalizeArticleType("nope"), "imrad_oak");
  assert.equal(isArticleTypeId("constructor"), false, "prototype kaliti tur emas");
});

test("5 nashr profili: shrift/interval/chegara/iqtibos/manba chegaralari ma'noli", () => {
  assert.equal(PUBLICATION_PROFILE_IDS.length, 5);
  for (const id of PUBLICATION_PROFILE_IDS) {
    const p = PUBLICATION_PROFILES[id];
    assert.ok(p.sizePt >= 10 && p.sizePt <= 14, `${id}: shrift`);
    assert.ok(p.line === 1 || p.line === 1.5, `${id}: interval`);
    assert.ok((CITE_STYLES as readonly string[]).includes(p.cite), `${id}: iqtibos uslubi`);
    assert.ok(p.refsMin <= p.refsMax, `${id}: manba chegarasi`);
    assert.ok(p.recentShare >= 0 && p.recentShare <= 1);
    assert.ok(p.abstractWords[0] < p.abstractWords[1] && p.keywords[0] < p.keywords[1]);
  }
  // OAK: TNR 14, 1.5, 2/2/3/1.5 sm, GOST + ikkinchi REFERENCES, UDK.
  const oak = PUBLICATION_PROFILES.oak;
  assert.equal(oak.sizePt, 14);
  assert.equal(oak.line, 1.5);
  assert.deepEqual(oak.marginsCm, { top: 2, bottom: 2, left: 3, right: 1.5 });
  assert.equal(oak.cite, "gost");
  assert.equal(oak.secondEnglishList, true);
  assert.equal(oak.udk, true);
  // APA: >50% oxirgi 5 yil, ≥15 manba; IEEE: raqamlangan bo'limlar.
  assert.equal(PUBLICATION_PROFILES.apa.recentShare, 0.5);
  assert.equal(PUBLICATION_PROFILES.apa.refsMin, 15);
  assert.equal(PUBLICATION_PROFILES.ieee.numberedSections, true);
  assert.equal(normalizePublicationProfile("zzz"), "oak");
  assert.equal(normalizePublicationProfile("zzz", "apa"), "apa");
});

test("yorliqlar uz/ru/en — har skelet kaliti uchun bo'sh emas; rasm/jadval formati", () => {
  const keys = new Set<string>();
  for (const id of ARTICLE_TYPE_IDS) for (const s of ARTICLE_TYPES[id].skeleton) keys.add(s.titleKey);
  for (const lang of ["uz", "ru", "en"]) {
    const L = articleLabels(lang);
    for (const k of keys) assert.ok(L.section[k as keyof typeof L.section], `${lang}: «${k}» yorlig'i yo'q`);
    assert.ok(L.abstract && L.keywords && L.references);
  }
  assert.equal(articleLabels("uz").figure("1"), "1-rasm.");
  assert.equal(articleLabels("uz").table("2"), "2-jadval.");
  assert.equal(articleLabels("en").figure("1"), "Figure 1.");
  assert.equal(articleLabels("ru").table("3"), "Таблица 3.");
});

test("parametr reyestri: unikal id, har birida impact, narx impact'i faqat pages/articleType", () => {
  const ids = ARTICLE_PARAMS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const p of ARTICLE_PARAMS) {
    assert.ok(p.impacts.length >= 1, `${p.id}: ta'siri e'lon qilinmagan`);
    assert.notDeepEqual(p.probeA, p.probeB, `${p.id}: zond qiymatlari bir xil`);
    if (p.impacts.includes("price")) assert.ok(["pages", "articleType"].includes(p.id), `${p.id}: narx ta'siri ruxsat etilmagan`);
  }
  for (const must of ["articleType", "pubProfile", "authors", "userRefs", "userFacts", "figureCount", "pages", "language"]) {
    assert.ok(ids.includes(must), `${must} reyestrda yo'q`);
  }
});
