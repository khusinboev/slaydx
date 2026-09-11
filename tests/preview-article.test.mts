import test from "node:test";
import assert from "node:assert/strict";
import type { AcademicDoc } from "../lib/generation/types.ts";

/**
 * `buildPreview` — maqola kartochkasi (Maqola 2 / AUDIT-17, WP4).
 *
 * Generik ajratgich (`sections` dagi `p`/`h2`/`li`) maqola uchun mos
 * emas: bloklar orasida `figure`/`tableRef`/`formula` (matn — sarlavha,
 * mazmun emas) va `[W…]` iqtibos markerlari bor. Shuning uchun maqola
 * uchun ALOHIDA yo'l: sarlavha (`meta.topic`) + birinchi annotatsiyaning
 * 160 belgisi, rasm — birinchi topilgan sxema (`figures[].url`).
 */

const { buildPreview } = await import("../lib/server/preview.ts");
const { sampleArticleDoc } = await import("../lib/generation/article/samples.ts");
const { extractMeta } = await import("../lib/generation/meta.ts");
const { TOOL_BY_ID } = await import("../lib/tools.ts");

function meta(topic = "Sun'iy intellekt ta'limda") {
  return extractMeta(TOOL_BY_ID.article, { topic, language: "uz" });
}

test("buildPreview: maqola — sarlavha + annotatsiya (≤160 belgi), rasm yo'q bo'lsa url yo'q", () => {
  const doc = sampleArticleDoc(meta());
  const preview = buildPreview(doc);
  assert.ok(preview);
  assert.equal(preview?.url, undefined, "namunada figure.url yo'q (WP3 to'ldiradi) — rasm bo'lmasligi kerak");
  assert.equal(preview?.lines?.[0], doc.meta.topic);
  const abstractUz = doc.abstracts?.find((a) => a.lang === "uz");
  assert.ok(abstractUz && abstractUz.text.length > 160, "sinov matni 160 belgidan uzun bo'lishi kerak (kesish sinalsin)");
  assert.equal(preview?.lines?.[1], abstractUz!.text.slice(0, 160));
  assert.ok((preview?.lines?.[1]?.length ?? 0) <= 160);
});

test("buildPreview: birinchi figure.url bo'lsa — preview.url shu rasm", () => {
  const doc = sampleArticleDoc(meta());
  const withUrl: AcademicDoc = {
    ...doc,
    article: {
      ...doc.article!,
      figures: doc.article!.figures.map((f, i) => (i === 0 ? { ...f, url: "/api/generations/g1/assets/aaa111" } : f)),
    },
  };
  const preview = buildPreview(withUrl);
  assert.equal(preview?.url, "/api/generations/g1/assets/aaa111");
});

test("buildPreview: maqola tili bo'yicha mos annotatsiya tanlanadi", () => {
  const doc = sampleArticleDoc(meta());
  const ruDoc: AcademicDoc = { ...doc, article: { ...doc.article!, language: "ru" } };
  const preview = buildPreview(ruDoc);
  const abstractRu = doc.abstracts?.find((a) => a.lang === "ru");
  assert.equal(preview?.lines?.[1], abstractRu?.text.slice(0, 160));
});

test("buildPreview: mos tilda annotatsiya topilmasa — birinchisi (uz) ishlatiladi", () => {
  const doc = sampleArticleDoc(meta());
  const deDoc: AcademicDoc = { ...doc, article: { ...doc.article!, language: "de" } };
  const preview = buildPreview(deDoc);
  const abstractFirst = doc.abstracts?.[0];
  assert.equal(preview?.lines?.[1], abstractFirst?.text.slice(0, 160));
});

test("buildPreview: annotatsiya yo'q — faqat sarlavha qatori", () => {
  const doc = sampleArticleDoc(meta());
  const noAbstract: AcademicDoc = { ...doc, abstracts: [] };
  const preview = buildPreview(noAbstract);
  assert.deepEqual(preview?.lines, [doc.meta.topic]);
});

test("buildPreview: article YO'Q hujjatda eski (generik) yo'l ishlaydi — regressiya", () => {
  const doc = {
    meta: meta("Referat"),
    sections: [
      { id: "s1", title: "Kirish", blocks: [{ kind: "p", text: "Bu yetarlicha uzun paragraf matni bo'lishi kerak o'n ikki belgidan ko'proq." }] },
    ],
  } as unknown as AcademicDoc;
  const preview = buildPreview(doc);
  assert.ok(preview?.lines?.length, "generik ajratgich article filialidan TA'SIRLANMASLIGI kerak");
});
