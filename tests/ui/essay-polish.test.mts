import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h, act, useCallback, useRef, useState } from "react";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { ArticleReviewPanel, ESSAY_HIDDEN_GROUPS } from "../../components/viewers/ArticleReviewPanel.tsx";
import { WordViewer } from "../../components/viewers/WordViewer.tsx";
import { polishArticle } from "../../lib/api-edit.ts";
import { applyArticleOps, type ArticleOp } from "../../lib/generation/article/edit.ts";
import type { ArticleReview, PolishLog } from "../../lib/generation/article/types.ts";
import type { AcademicDoc, DocMeta } from "../../lib/generation/types.ts";

/**
 * INSHO HISOBOTI natija sahifasida (AUDIT-19 WP-E1).
 *
 * Panel maqolaniki bilan AYNAN bitta komponent — u neytral `DocReview`
 * ni o'qiydi, shuning uchun bu yerda sinaladigan narsa ULANISH:
 * hisobot `doc.essay.review` dan olinadi, «Manbalar»/«Vizuallar»
 * guruhlari yashiriladi (insho manbasiz janr), «Sizdan kutiladi»
 * bandlari `/uz/essay#…` ga boradi va «Hammasini tuzatish» `POST
 * …/polish` ga ketib, yangi ball bilan qaytadi.
 *
 * Mutatsiyalar: `hideGroups` olib tashlansa — «Manbalar» bloki bo'sh
 * «Tekshiruv yo'q» bilan chiqadi; `NEED_HREF` dagi insho bandlari olib
 * tashlansa — havola yo'qoladi.
 */

if (!("IntersectionObserver" in globalThis)) {
  (globalThis as unknown as Record<string, unknown>).IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  };
}

const GEN_ID = "gen-e1";
const META = { topic: "Kitob o‘qishning foydasi", author: "N. Valiyeva", workLabel: "Insho", language: "uz", toolId: "essay", targetPages: 2, design: "iris" } as unknown as DocMeta;

/** Insho hisoboti — insho QOIDALARI bilan (manbalar/vizual bandi YO'Q). */
function essayReview(score: number, extra: Partial<ArticleReview> = {}): ArticleReview {
  return {
    score,
    checks: [
      { id: "words", level: "yellow", label: "Hajm", detail: "368 so‘z kerak, 300 yozildi", fix: { op: "rewrite", target: "essay", instruction: "Uzaytiring." } },
      { id: "paragraphs", level: "green", label: "Bandlar" },
      { id: "filler", level: "yellow", label: "Klişe iboralar", detail: "«bugungi kunda»" },
      { id: "epigraph", level: "yellow", label: "Epigraf", detail: "Berilmagan" },
      { id: "judge:content", level: "yellow", label: "Mazmun", detail: "2/3" },
    ],
    judgeNotes: ["DTM mezoni taqsimoti taxminiy."],
    verifiedShare: 1,
    recentShare: 0,
    builtAt: "2026-09-16T00:00:00.000Z",
    userNeeds: [
      { id: "epigraph", label: "Epigraf", hint: "Iqtibosni o‘zingiz tanlang" },
      { id: "facts", label: "O‘z dalillaringiz", hint: "Hayotiy misolingizni yozing" },
    ],
    ...extra,
  };
}

function essayDoc(): AcademicDoc {
  return {
    meta: META,
    titlePage: false,
    toc: false,
    sections: [{ id: "essay", title: "Kitob o‘qishning foydasi", blocks: [{ kind: "p", text: "Bugungi kunda kitob o‘qish kamayib bormoqda. ".repeat(6) }] }],
    essay: {
      v: 1,
      context: "school_dtm",
      kind: "reflective",
      language: "uz",
      words: { min: 368, max: 575, aim: 460 },
      paragraphs: [],
      rubric: "dtm24",
      design: "iris",
      review: essayReview(64),
    },
  };
}

type Call = { url: string; method: string; body: Record<string, unknown> | null };
type Server = { calls: Call[]; polishes: Call[]; doc: AcademicDoc; version: number };

function stubServer(): Server {
  const s: Server = { calls: [], polishes: [], doc: essayDoc(), version: 1 };
  const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
  (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown, opts?: RequestInit) => {
    const url = String(input);
    const method = opts?.method ?? "GET";
    const body = typeof opts?.body === "string" ? (JSON.parse(opts.body) as Record<string, unknown>) : null;
    const call = { url, method, body };
    s.calls.push(call);
    if (method === "POST" && url.endsWith("/polish")) {
      s.polishes.push(call);
      if (body?.baseVersion !== s.version) return json(409, { code: "version", docVersion: s.version });
      const log: PolishLog = { before: 64, after: 79, applied: [{ target: "essay", instruction: "Uzaytiring." }], skipped: [{ id: "epigraph", reason: "user" }], accepted: true, at: "2026-09-16T01:00:00.000Z" };
      /*
       * Server insho sayqalini `setSection` ga o'giradi (`doc-polish.ts`
       * `toOps`) — klient shu op larni AYNAN maqola tahriri kabi
       * qo'llaydi; alohida op tili yo'q.
       */
      const ops: ArticleOp[] = [
        { op: "setSection", sectionId: "essay", blocks: [{ kind: "p", text: "Sayqallangan insho matni: aniq da’vo va hayotiy misol bilan." }] },
        { op: "review", review: essayReview(79, { polish: log, userNeeds: [{ id: "facts", label: "O‘z dalillaringiz", hint: "Hayotiy misolingizni yozing" }] }) },
      ];
      const res = applyArticleOps(s.doc, ops, { genId: GEN_ID });
      if (!res.ok) return json(422, { error: res.error });
      s.doc = res.doc;
      s.version += 1;
      return json(200, { generation: generation(s), ops, polish: log });
    }
    if (method === "POST" && url.endsWith("/rebuild")) return json(200, { fileVersion: s.version, docVersion: s.version, rebuilt: true });
    if (method === "GET") return json(200, { generation: generation(s) });
    return json(404, { error: "yo'q" });
  };
  return s;
}

function generation(s: Server) {
  return { id: GEN_ID, type: "essay", status: "COMPLETED", doc: s.doc, docVersion: s.version, fileVersion: 1, imageRedraws: 0, hasFile: true, hasPrev: false };
}

afterEach(() => cleanup());

const pause = (ms: number) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));

type Gen = ReturnType<typeof generation>;

/**
 * Sahifa taqlidi — `ResultView` ning insho shoxi bilan AYNAN bir xil
 * naqsh: hisobot `doc.essay.review` dan, `onFix` BERILMAYDI (inshoda
 * bandma-band tuzatish yo'q), guruhlar `ESSAY_HIDDEN_GROUPS` bilan
 * yashiriladi.
 */
function Page({ initial }: { initial: Gen }) {
  const [gen, setGen] = useState<Gen>(initial);
  const [polishing, setPolishing] = useState(false);
  const genRef = useRef(gen);
  genRef.current = gen;
  const adopt = useCallback((g: unknown) => {
    const merged = { ...genRef.current, ...(g as Gen) };
    genRef.current = merged;
    setGen(merged);
  }, []);
  const onPolish = useCallback(async () => {
    setPolishing(true);
    try {
      const r = await polishArticle(genRef.current.id, genRef.current.docVersion);
      adopt(r.generation);
    } finally {
      setPolishing(false);
    }
  }, [adopt]);
  const review = gen.doc.article?.review ?? gen.doc.essay?.review;
  return h(
    "div",
    null,
    review ? h(ArticleReviewPanel, { review, onPolish: () => void onPolish(), polishing, hideGroups: ESSAY_HIDDEN_GROUPS }) : null,
    h(WordViewer, { doc: gen.doc, gen, onGen: adopt }),
  );
}

async function mount(s: Server) {
  render(h(Page, { initial: generation(s) }));
  await pause(30);
}

const polishBtn = () => document.querySelector("[data-polish-button]") as HTMLButtonElement | null;
const score = () => document.querySelector("[data-review-score]")?.getAttribute("data-review-score");
const group = (id: string) => document.querySelector(`[data-review-group="${id}"]`);

/* ══════════════════════════════ testlar ══════════════════════════════ */

test("panel `doc.essay.review` dan chiziladi: insho bandlari ko'rinadi, ball halqasi va baholovchi izohi bor", async () => {
  const s = stubServer();
  await mount(s);
  assert.equal(score(), "64");
  assert.ok(document.querySelector('[data-review-check="words"]'), "«Hajm» bandi");
  assert.ok(document.querySelector('[data-review-check="filler"]'), "«Klişe» bandi");
  assert.ok(document.querySelector('[data-review-check="judge:content"]'), "baholovchi mezoni");
  assert.ok(document.querySelector("[data-review-notes]")?.textContent?.includes("taxminiy"), "baholovchi izohi");
});

test("insho hisobotida «Manbalar» va «Vizuallar» guruhlari YASHIRINADI (bo'sh «Tekshiruv yo'q» chiqmaydi)", async () => {
  const s = stubServer();
  await mount(s);
  /*
   * MUTATSIYA: `hideGroups` olib tashlansa bu ikki blok bo'sh holda
   * chizilardi va foydalanuvchi «manbalar tekshirilmadi» deb o'qirdi —
   * holbuki inshoda manba umuman bo'lmaydi (`citations: "none"`).
   */
  assert.ok(!group("sources"), "«Manbalar» guruhi inshoda chizilmaydi");
  assert.ok(!group("visuals"), "«Vizuallar» guruhi inshoda chizilmaydi");
  assert.ok(group("structure"), "«Tuzilma» guruhi qoladi");
  assert.ok(group("ai"), "«AI izi» guruhi qoladi");
  assert.ok(group("science"), "baholovchi mezonlari guruhi qoladi");
});

test("«Sizdan kutiladi» insho bandlari `/uz/essay#…` ga boradi (epigraf, dalillar)", async () => {
  const s = stubServer();
  await mount(s);
  const needs = document.querySelector("[data-user-needs]");
  assert.ok(needs, "«Sizdan kutiladi» bloki yo'q");
  const href = (id: string) => (document.querySelector(`[data-user-need="${id}"] a`) as HTMLAnchorElement | null)?.getAttribute("href");
  /*
   * MUTATSIYA: `NEED_HREF` ga insho bandlari qo'shilmasa havola umuman
   * chizilmasdi (`UserNeed.id` endi `string`, ya'ni jadval to'liq
   * bo'lishi tip bilan kafolatlanmaydi).
   */
  assert.equal(href("epigraph"), "/uz/essay#epigraph");
  assert.equal(href("facts"), "/uz/essay#userFacts");
  assert.ok(!document.querySelector('[data-user-need="udk"]'), "maqolaga xos band inshoda yo'q");
});

test("«Hammasini tuzatish» → POST …/polish → yangi ball, sayqal jurnali va yangi matn ekranda; bandma-band «Tuzatish» tugmasi YO'Q", async () => {
  const s = stubServer();
  await mount(s);
  /*
   * Inshoda `onFix` berilmaydi (server ham 422 `essay` qaytaradi), lekin
   * hisobot bandida `fix` bor — tugma CHIZILADI-yu, o'chiq bo'ladi.
   * Foydalanuvchi uchun yagona yo'l — «Hammasini tuzatish».
   */
  const fix = document.querySelector('[data-review-fix="essay"]') as HTMLButtonElement | null;
  assert.ok(fix, "«Hajm» bandida fix nishoni bor");
  assert.ok(fix!.disabled, "inshoda bandma-band «Tuzatish» o'chiq bo'lishi kerak");

  const btn = polishBtn();
  assert.ok(btn && !btn.disabled, "«Hammasini tuzatish» faol bo'lishi kerak");
  await act(async () => {
    fireEvent.click(btn!);
  });
  await pause(40);

  assert.equal(s.polishes.length, 1, "bitta polish so'rovi");
  assert.equal(s.polishes[0].body?.baseVersion, 1, "tanada `baseVersion`");
  assert.equal(score(), "79", "yangi ball ekranga chiqdi");
  assert.ok(document.querySelector("[data-polish-log]")?.textContent?.includes("64 → 79"), "sayqal jurnali");
  assert.ok(document.body.textContent?.includes("Sayqallangan insho matni"), "yangi matn ko'ruvchida");
  // Sayqaldan keyin «Sizdan kutiladi» qayta hisoblangan (epigraf bandi ketdi).
  assert.ok(!document.querySelector('[data-user-need="epigraph"]'));
  assert.ok(document.querySelector('[data-user-need="facts"]'));
});
