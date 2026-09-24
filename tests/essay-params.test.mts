import test from "node:test";
import assert from "node:assert/strict";
import { TOOL_BY_ID, priceFor } from "../lib/tools.ts";
import type { FormValues } from "../lib/types.ts";
import { extractMeta } from "../lib/generation/meta.ts";
import type { LlmRole } from "../lib/generation/llm-roles.ts";
import { ESSAY_FORM_FIELDS, ESSAY_PARAMS, type EssayParamImpact } from "../lib/generation/essay-params.ts";
import { essayInputFromValues } from "../lib/generation/essay/input.ts";
import { essayCtx, essayPrompt, essaySystemPrompt, outlinePrompt } from "../lib/generation/essay/prompts.ts";
import { buildEssayDoc, fallbackOutline } from "../lib/generation/essay/engine.ts";

/**
 * INSHO PARAMETR SHARTNOMASI — «bezak maydon yo'q» kafolati (AUDIT-19,
 * mahsulot egasi qarori 5). `tests/article-params.test.mts` naqshi:
 * reyestrdagi har parametr uchun `probeA`/`probeB` bilan differensial
 * zond va e'lon qilingan HAR ta'sirda A ≠ B.
 *
 * Mutatsiya: reyestrga hech narsaga ta'sir qilmaydigan maydon
 * qo'shilsa yoki mavjud maydon promptdan olib tashlansa — zond qizaradi.
 */

const essay = TOOL_BY_ID.essay;

const BASE: FormValues = { topic: "Ona tilim — g‘ururim", pages: "2", essayContext: "school_dtm", essayKind: "reflective", language: "uz", design: "iris" };

/* ────────────────────────── stub ────────────────────────── */

const filler = (n: number, tag: string) => Array.from({ length: n }, (_, i) => `${tag}${i}`).join(" ");
const para = (tag: string, n: number) => `Bu ${tag} bandi asosiy fikrni aniq bayon qiladi va misol bilan asoslaydi. ${filler(n, tag)}.`;

/*
 * Matn ATAYLAB «78 %» bilan: `userFacts` zondi hisobotga ta'sirini
 * aynan shu bandda ko'rsatadi (fakt bo'lsa yashil, bo'lmasa qizil).
 * Reja javobida `title` YO'Q — sarlavha mavzudan olinadi (mavzu zondi).
 */
const ESSAY_JSON = JSON.stringify({
  blocks: [
    { kind: "p", text: para("kirish", 50) },
    { kind: "p", text: `Bu birinchi bandda yoshlarning 78 % i haqidagi kuzatuv keltiriladi va izohlanadi. ${filler(80, "a")}.` },
    { kind: "p", text: para("ikkinchi", 90) },
    { kind: "p", text: para("uchinchi", 90) },
    { kind: "p", text: para("xulosa", 50) },
  ],
});

const OUTLINE_JSON = JSON.stringify({
  thesisStatement: "Muntazam kitob o‘qish o‘quvchining fikrlash va yozma nutq malakasini izchil rivojlantiradi.",
  paragraphs: Array.from({ length: 5 }, (_, i) => ({
    id: `p${i + 1}`,
    role: i === 0 ? "intro" : i === 4 ? "conclusion" : "body",
    topicSentence: i > 0 && i < 4 ? `Bu band ${i} - da'voni aniq bayon qiladi va misol bilan asoslaydi.` : undefined,
    brief: `Band ${i + 1} rejasi`,
    words: i === 0 || i === 4 ? 60 : 110,
  })),
});

const stubComplete = (async (role: LlmRole, _system: string, user: string) => {
  if (role === "judge") return null;
  if (user.startsWith("Plan the essay")) return { text: OUTLINE_JSON };
  return { text: ESSAY_JSON };
}) as never;

/* ────────────────────────── zond ────────────────────────── */

type Probe = Record<EssayParamImpact, string>;

async function probe(values: FormValues): Promise<Probe> {
  const v = { ...BASE, ...values };
  const input = essayInputFromValues(v);
  const meta = extractMeta(essay, v);
  const ctx = essayCtx({ ...meta, language: input.language, design: input.design }, input);
  const plans = fallbackOutline(ctx);
  const built = await buildEssayDoc(meta, v, { deadline: Date.now() + 120_000, complete: stubComplete, judge: false, polish: false });
  assert.ok(built, "zond: hujjat qurilishi kerak");
  const d = built.doc;
  const model = d.essay!;
  const review = model.review;
  return {
    prompt: [essaySystemPrompt(ctx), outlinePrompt(ctx), essayPrompt(ctx, plans, { thesisStatement: "T", title: "X" })].join("\n"),
    structure: `${ctx.context.id}/${ctx.kind.id}:${plans.map((p) => `${p.role}=${p.words}`).join(",")}`,
    review: JSON.stringify((review?.checks ?? []).filter((c) => !c.id.startsWith("judge:")).map((c) => [c.id, c.level, c.detail])),
    language: `${input.language}/${d.meta.language}/${model.language}`,
    layout: JSON.stringify({
      titlePage: d.titlePage,
      title: d.sections[0]?.title,
      design: d.meta.design,
      model: { ...model, review: undefined },
      firstBlock: d.sections[0]?.blocks[0]?.kind,
    }),
    price: String(priceFor(essay, v)),
  };
}

/* ────────────────────────── testlar ────────────────────────── */

test("reyestr: 12 parametr, forma qamrovi ro'yxati bilan mos", () => {
  assert.equal(ESSAY_PARAMS.length, 12);
  assert.deepEqual(ESSAY_FORM_FIELDS, ESSAY_PARAMS.map((p) => p.id));
  assert.equal(new Set(ESSAY_FORM_FIELDS).size, ESSAY_PARAMS.length, "id lar takrorlanmasin");
});

test("differensial zond: reyestrdagi HAR parametr e'lon qilingan ta'sirini beradi", async () => {
  const failures: string[] = [];
  for (const p of ESSAY_PARAMS) {
    const base = p.probeWith ?? {};
    const a = await probe({ ...base, [p.id]: p.probeA });
    const b = await probe({ ...base, [p.id]: p.probeB });
    for (const impact of p.impacts) {
      if (a[impact] === b[impact]) failures.push(`${p.id} → ${impact}`);
    }
  }
  assert.deepEqual(failures, [], `bezak parametrlar (A va B bir xil chiqdi):\n  ${failures.join("\n  ")}`);
});

test("zond maydonlari o'lik emas: har ta'sir kamida bitta parametrda e'lon qilingan", () => {
  const declared = new Set(ESSAY_PARAMS.flatMap((p) => p.impacts));
  for (const impact of ["prompt", "structure", "review", "language", "layout", "price"] as EssayParamImpact[]) {
    assert.ok(declared.has(impact), `${impact}: hech bir parametr bu ta'sirni e'lon qilmagan — zond o'lik`);
  }
});

/*
 * `wordTarget` — akademik esseda narx dvigatel YOZADIGAN so'z hajmidan
 * (W4-E, W3-J sharhidagi C12 sinfi): `pages` bilan zid qo'lda yasalgan
 * so'rov (zond aynan shunday — `pages: "2"`, 550 va 950 so'z) endi
 * yoziladigan hajm narxini to'laydi. Kanonik forma qiymatlarida
 * (`pages = pagesForWords(wordTarget)`) narx o'zgarmagan —
 * `tests/essay-price-words.test.mts`. Reyestrda (`essay-params.ts`,
 * W4-A egaligida) `wordTarget.impacts` ga `price` qo'shilishi kerak.
 */
const PRICED_BY_ENGINE_VOLUME = new Set(["wordTarget"]);

test("narx faqat varaqdan — boshqa parametrlar narxni qimirlatmaydi (narx o'zgarmadi)", () => {
  for (const p of ESSAY_PARAMS) {
    if (p.impacts.includes("price")) continue;
    if (PRICED_BY_ENGINE_VOLUME.has(p.id)) {
      const base = p.probeWith ?? {};
      assert.notEqual(
        priceFor(essay, { ...BASE, ...base, [p.id]: p.probeA }),
        priceFor(essay, { ...BASE, ...base, [p.id]: p.probeB }),
        `${p.id}: dvigatel hajmi narxga ta'sir qilishi kerak`,
      );
      continue;
    }
    const base = p.probeWith ?? {};
    const a = priceFor(essay, { ...BASE, ...base, [p.id]: p.probeA });
    const b = priceFor(essay, { ...BASE, ...base, [p.id]: p.probeB });
    assert.equal(a, b, `${p.id}: narxni o'zgartirdi (${a} vs ${b})`);
  }
  // AUDIT-19 da insho narxi O'ZGARMAYDI — eski jadval.
  assert.equal(priceFor(essay, { ...BASE, pages: "1" }), 2000);
  assert.equal(priceFor(essay, { ...BASE, pages: "2" }), 2500);
  assert.equal(priceFor(essay, { ...BASE, pages: "3" }), 3000);
  assert.equal(priceFor(essay, { ...BASE, pages: "4" }), 3500);
  assert.equal(priceFor(essay, { ...BASE, pages: "5" }), 4000);
  // Akademik esse: narx dvigatel yozadigan so'zdan (1 000 so'z = 4 varaq), zid `pages: "2"` dan emas (W4-E).
  assert.equal(priceFor(essay, { ...BASE, essayContext: "academic", wordTarget: 1000, pages: "2" }), 3500);
  // Forma yuboradigan juftlik (`pages = pagesForWords(1000)` = 4) — narx avvalgidek.
  assert.equal(priceFor(essay, { ...BASE, essayContext: "academic", wordTarget: 1000, pages: "4" }), 3500);
});
