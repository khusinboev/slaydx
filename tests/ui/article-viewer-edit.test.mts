import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h, act, useCallback, useRef, useState } from "react";
import { render, fireEvent, screen, cleanup } from "@testing-library/react";
import { WordViewer } from "../../components/viewers/WordViewer.tsx";
import { ArticleReviewPanel } from "../../components/viewers/ArticleReviewPanel.tsx";
import { EditActions, type EditActionsState } from "../../components/files/EditActions.tsx";
import { editErrorCode, rewriteArticle } from "../../lib/api-edit.ts";
import { applyArticleOps, type ArticleOp } from "../../lib/generation/article/edit.ts";
import { sampleArticleDoc } from "../../lib/generation/article/samples.ts";
import type { ArticleReview, ReviewCheck } from "../../lib/generation/article/types.ts";
import type { AcademicDoc, DocMeta } from "../../lib/generation/types.ts";

/**
 * Maqola ko'ruvchisidagi TAHRIR (Maqola 2, AUDIT-17 WP7) — jsdom + `fetch`
 * stubi, `resume-viewer-edit` bilan bir xil yondashuv: TARMOQ va HOLAT
 * xatti-harakati sinaladi — server FAQAT «Saqlash» da chaqiriladimi,
 * navbat bitta `PATCH` ga tushadimi, keyin DOCX qayta yasaladimi, 409 dan
 * keyin klient serverga bo'ysunadimi, «Tuzatish» `POST …/rewrite` ga
 * boradimi va yangi hujjat/ball ekranga tushadimi.
 *
 * `fetch` stubi serverni TAQLID qiladi: `PATCH` kelgan op larni AYNAN
 * `applyArticleOps` bilan qo'llaydi (server ham shuni chaqiradi).
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

const GEN_ID = "gen-a1";
const META = { topic: "Sun’iy intellektning oliy ta’limdagi o‘rni", author: "K", workLabel: "Maqola", language: "uz", toolId: "article" } as unknown as DocMeta;

function review(score: number): ArticleReview {
  return {
    score,
    checks: [
      { id: "structure", level: "green", label: "Tuzilma" },
      { id: "filler", level: "yellow", label: "«Suv» iboralar", detail: "2 ta", fix: { op: "rewrite", target: "intro", instruction: "Remove filler phrases." } },
    ],
    judgeNotes: [],
    verifiedShare: 1,
    recentShare: 1,
    builtAt: "2026-09-12T00:00:00.000Z",
  };
}

function makeDoc(): AcademicDoc {
  const d = JSON.parse(JSON.stringify(sampleArticleDoc(META))) as AcademicDoc;
  d.article!.review = review(71);
  return d;
}

type Call = { url: string; method: string; body: Record<string, unknown> | null };
type Server = { calls: Call[]; patches: Call[]; rewrites: Call[]; doc: AcademicDoc; version: number; failNext: string | null };

function stubServer(init: AcademicDoc = makeDoc()): Server {
  const s: Server = { calls: [], patches: [], rewrites: [], doc: init, version: 1, failNext: null };
  const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

  (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown, opts?: RequestInit) => {
    const url = String(input);
    const method = opts?.method ?? "GET";
    const body = typeof opts?.body === "string" ? (JSON.parse(opts.body) as Record<string, unknown>) : null;
    const call = { url, method, body };
    s.calls.push(call);

    if (method === "PATCH" && url.endsWith("/doc")) {
      s.patches.push(call);
      if (s.failNext) {
        const code = s.failNext;
        s.failNext = null;
        return json(409, { code, error: "Konflikt" });
      }
      if (body?.baseVersion !== s.version) return json(409, { code: "version", docVersion: s.version });
      const res = applyArticleOps(s.doc, (body?.ops ?? []) as ArticleOp[], { genId: GEN_ID });
      if (!res.ok) return json(422, { error: res.error, at: res.at });
      s.doc = res.doc;
      s.version += 1;
      return json(200, { generation: generation(s) });
    }
    if (method === "POST" && url.endsWith("/rewrite")) {
      s.rewrites.push(call);
      if (s.failNext) {
        const code = s.failNext;
        s.failNext = null;
        return json(409, { code, error: "Konflikt" });
      }
      if (body?.baseVersion !== s.version) return json(409, { code: "version", docVersion: s.version });
      const fix = body?.fix as { target: string };
      // Server taqlidi: bo'lim qayta yozildi + hisobot qayta hisoblandi (ball o'sdi).
      const ops: ArticleOp[] = [
        { op: "setSection", sectionId: fix.target, blocks: [{ kind: "p", text: "Qayta yozilgan kirish: aniq da’vo va manba [W4385]." }] },
        { op: "review", review: review(84) },
      ];
      const res = applyArticleOps(s.doc, ops, { genId: GEN_ID });
      if (!res.ok) return json(422, { error: res.error });
      s.doc = res.doc;
      s.version += 1;
      return json(200, { generation: generation(s), ops });
    }
    if (method === "POST" && url.endsWith("/rebuild")) return json(200, { fileVersion: s.version, docVersion: s.version, rebuilt: true });
    if (method === "GET") return json(200, { generation: generation(s) });
    return json(404, { error: "yo'q" });
  };
  return s;
}

function generation(s: Server) {
  return { id: GEN_ID, type: "article", status: "COMPLETED", doc: s.doc, docVersion: s.version, fileVersion: 1, imageRedraws: 0, hasFile: true, hasPrev: false };
}

afterEach(() => cleanup());

function pause(ms: number) {
  return act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

function ops(call: Call | undefined): ArticleOp[] {
  return (call?.body?.ops ?? []) as ArticleOp[];
}

type Gen = ReturnType<typeof generation>;

/** Sahifa taqlidi — `ResultView` kabi: panel (`onFix` → rewrite) + `EditActions` + ko'ruvchi. */
function Page({ initial }: { initial: Gen }) {
  const [gen, setGen] = useState<Gen>(initial);
  const [st, setSt] = useState<EditActionsState | null>(null);
  const [fixing, setFixing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const genRef = useRef(gen);
  genRef.current = gen;
  const adopt = useCallback((g: unknown) => {
    const merged = { ...genRef.current, ...(g as Gen) };
    genRef.current = merged;
    setGen(merged);
  }, []);
  const onFix = useCallback(
    async (fix: NonNullable<ReviewCheck["fix"]>) => {
      setFixing(fix.target);
      try {
        if (st?.pending) await st.save();
        const r = await rewriteArticle(genRef.current.id, genRef.current.docVersion, fix);
        adopt(r.generation);
      } catch (e) {
        setError(e instanceof Error ? e.message : "xato");
        if (editErrorCode(e)) {
          const res = await fetch(`/api/generations/${GEN_ID}`);
          adopt(((await res.json()) as { generation: Gen }).generation);
        }
      } finally {
        setFixing(null);
      }
    },
    [st, adopt],
  );
  return h(
    "div",
    null,
    h(EditActions, { state: st }),
    error ? h("div", { "data-page-error": "1" }, error) : null,
    gen.doc.article?.review ? h(ArticleReviewPanel, { review: gen.doc.article.review, onFix: (f) => void onFix(f), fixing }) : null,
    h(WordViewer, { doc: gen.doc, gen, onGen: adopt, onEditState: setSt }),
  );
}

async function openEditor(s: Server) {
  render(h(Page, { initial: generation(s) }));
  await pause(30);
  const btn = screen.getByText("Tahrirlash");
  await act(async () => {
    fireEvent.click(btn);
  });
  await pause(30);
  return btn;
}

/** Varaqdagi `data-path` elementi (o'lchov daraxti emas). */
function byPath(path: string): HTMLElement {
  const el = document.querySelector(`[data-page] [data-path="${path}"]`);
  assert.ok(el, `«${path}» tahrir nishoni topilmadi`);
  return el as HTMLElement;
}

/** Elementga ikki bosib, matn yozib, Enter bilan saqlaydi. */
function typeInto(el: HTMLElement, text: string) {
  fireEvent.dblClick(el);
  assert.equal(el.getAttribute("contenteditable"), "true", "maydon tahrirga ochilmadi");
  el.textContent = text;
  fireEvent.keyDown(el, { key: "Enter" });
}

const saveBtn = () => screen.queryByText(/^Saqlash · /);

/** Varaq matni (o'lchov daraxti matnni ikkinchi marta takrorlaydi — `screen` bilan qidirilmaydi). */
function pageHas(re: RegExp): boolean {
  return [...document.querySelectorAll("[data-page]")].some((p) => re.test(p.textContent ?? ""));
}
const P0 = "sections.0.blocks.0";

/* ══════════════════════════════ tahrir oqimi ══════════════════════════════ */

test("tahrir rejimi: varaqda nishonlar (paragraf, sarlavha, rasm/jadval sarlavhasi, katak, annotatsiya); o'lchov daraxtida yo'q", async () => {
  const s = stubServer();
  await openEditor(s);
  assert.ok(document.querySelector("[data-article-editor]"), "tahrir qatlami yo'q");
  byPath(P0);
  byPath("heading:intro");
  byPath("caption:figure:f1");
  byPath("caption:table:t1");
  byPath("cell:t1:0:1");
  byPath("cell:t1:-1:0");
  byPath("abstract:uz");
  assert.ok(!document.querySelector("[aria-hidden] [data-path]"), "o'lchov daraxtiga nishon tushdi");
  // Bo'lim sarlavhasi raqamsiz ochiladi — `heading` op ga raqam kirmaydi.
  assert.equal(s.calls.length, 0);
});

test("dblclick → Enter: bitta saqlanmagan o'zgarish, ekranda yangi matn, tarmoqqa chiqilmaydi", async () => {
  const s = stubServer();
  await openEditor(s);
  typeInto(byPath(P0), "Yangi kirish jumlasi.");
  await pause(20);
  assert.equal(s.calls.length, 0, "«Saqlash» bosilmasdan server chaqirildi");
  const btn = saveBtn();
  assert.ok(btn, "«Saqlash» tugmasi chiqmadi");
  assert.match(btn!.textContent ?? "", /1/);
  assert.ok(pageHas(/Yangi kirish jumlasi\./), "ekranda yangi matn yo'q");
});

test("iqtibosli paragraf: ochilganda `[1]` ko'rinadi, saqlanganda `[W…]` id saqlanadi", async () => {
  const s = stubServer();
  await openEditor(s);
  const el = byPath(P0);
  fireEvent.dblClick(el);
  const cite = el.querySelector("[data-cite-raw]");
  assert.ok(cite, "iqtibos spani yo'q");
  assert.equal(cite!.getAttribute("data-cite-raw"), "[W2741809807]");
  assert.equal(cite!.textContent, "[1]", "ekranda raqamli ko'rinish bo'lishi kerak");
  assert.equal(cite!.getAttribute("contenteditable"), "false");
  // Matn tugunini o'zgartiramiz, spanni saqlab qolamiz.
  el.firstChild!.textContent = "Tahrirlangan boshlanish ";
  fireEvent.keyDown(el, { key: "Enter" });
  await pause(10);
  fireEvent.click(saveBtn()!);
  await pause(30);
  const op = ops(s.patches[0])[0];
  assert.equal(op.op, "text");
  assert.match(op.op === "text" ? op.value : "", /^Tahrirlangan boshlanish \[W2741809807\]/, "xom iqtibos id yo'qoldi");
  assert.match(s.doc.sections[0].blocks[0].text, /\[W2741809807\]/);
});

test("Esc tahrirni bekor qiladi — React tugunlari qaytadi, navbat bo'sh", async () => {
  const s = stubServer();
  await openEditor(s);
  const el = byPath(P0);
  const before = el.innerHTML;
  fireEvent.dblClick(el);
  el.textContent = "Boshqa";
  fireEvent.keyDown(el, { key: "Escape" });
  await pause(10);
  assert.equal(el.innerHTML, before, "Esc dan keyin DOM qaytmadi");
  assert.ok(!el.hasAttribute("contenteditable"));
  assert.ok(!saveBtn(), "Esc navbatga operatsiya qo'shdi");
});

test("bo'lim sarlavhasi → `heading` op; bo'sh qoldirib Enter — `blockRemove`", async () => {
  const s = stubServer();
  await openEditor(s);
  typeInto(byPath("heading:intro"), "KIRISH QISMI");
  await pause(10);
  typeInto(byPath("sections.0.blocks.1"), "");
  await pause(10);
  fireEvent.click(saveBtn()!);
  await pause(30);
  const sent = ops(s.patches[0]);
  assert.deepEqual(sent[0], { op: "heading", sectionId: "intro", title: "KIRISH QISMI" });
  assert.deepEqual(sent[1], { op: "blockRemove", path: "sections.0.blocks.1" });
  assert.equal(s.doc.sections[0].title, "KIRISH QISMI");
  assert.equal(s.doc.sections[0].blocks.length, 1);
});

test("rasm sarlavhasi raqamsiz ochiladi va `caption` op beradi; jadval katagi `cell` op", async () => {
  const s = stubServer();
  await openEditor(s);
  const cap = byPath("caption:figure:f1");
  fireEvent.dblClick(cap);
  assert.equal(cap.textContent, "Adaptiv o‘qitish tizimining umumiy tuzilmasi", "raqam («1-rasm.») tahrir maydoniga kirdi");
  cap.textContent = "Yangi sxema";
  fireEvent.keyDown(cap, { key: "Enter" });
  await pause(10);
  typeInto(byPath("cell:t1:1:2"), "4,5");
  await pause(10);
  fireEvent.click(saveBtn()!);
  await pause(30);
  const sent = ops(s.patches[0]);
  assert.deepEqual(sent[0], { op: "caption", target: "figure", id: "f1", value: "Yangi sxema" });
  assert.deepEqual(sent[1], { op: "cell", tableId: "t1", r: 1, c: 2, value: "4,5" });
  assert.equal(s.doc.article!.figures[0].caption, "Yangi sxema");
  assert.equal(s.doc.tables![0].rows[1][2], "4,5");
});

test("Ctrl+Z tahrirni qaytaradi va navbat o'sadi (teskari op ham navbatda)", async () => {
  const s = stubServer();
  await openEditor(s);
  typeInto(byPath(P0), "Birinchi.");
  await pause(10);
  assert.match(saveBtn()!.textContent ?? "", /1/);
  await act(async () => {
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
  });
  await pause(10);
  assert.ok(pageHas(/Oliy ta’limda raqamli transformatsiya/), "Ctrl+Z asl matnni qaytarmadi");
  assert.match(saveBtn()!.textContent ?? "", /2/, "teskari op navbatga tushmadi");
});

test("«Saqlash» — yig'ilgan oplar BITTA PATCH da, keyin rebuild", async () => {
  const s = stubServer();
  await openEditor(s);
  typeInto(byPath(P0), "Bir.");
  await pause(10);
  typeInto(byPath("heading:results"), "NATIJALAR VA TAHLIL");
  await pause(10);
  assert.equal(s.calls.length, 0);
  fireEvent.click(saveBtn()!);
  await pause(40);
  assert.equal(s.patches.length, 1, "har op uchun alohida PATCH ketdi");
  assert.equal(ops(s.patches[0]).length, 2);
  assert.equal(s.patches[0].body?.baseVersion, 1);
  assert.equal(s.doc.sections[2].title, "NATIJALAR VA TAHLIL");
  assert.ok(s.calls.some((c) => c.method === "POST" && c.url.endsWith("/rebuild")), "saqlashdan keyin DOCX qayta yasalmadi");
  assert.ok(!saveBtn(), "saqlashdan keyin navbat tozalanmadi");
});

test("409 — navbat tashlanadi va hujjat serverdan qayta yuklanadi", async () => {
  const s = stubServer();
  await openEditor(s);
  typeInto(byPath(P0), "Ikki.");
  await pause(10);
  s.failNext = "version";
  fireEvent.click(saveBtn()!);
  await pause(40);
  assert.equal(s.patches.length, 1);
  assert.ok(s.calls.some((c) => c.method === "GET"), "409 dan keyin hujjat qayta yuklanmadi");
  assert.ok(!saveBtn(), "409 dan keyin navbat tozalanmadi");
  assert.ok(pageHas(/Oliy ta’limda raqamli transformatsiya/), "ekran serverdagi holatga qaytmadi");
});

test("iqtibos ustida ikki bosish → `refRemove` (birinchisi qurollantiradi)", async () => {
  const s = stubServer();
  await openEditor(s);
  const span = document.querySelector('[data-page] .word-cite[data-ref-ids="W4385"]') as HTMLElement | null;
  assert.ok(span, "iqtibos spani yo'q");
  fireEvent.click(span!);
  assert.equal(span!.getAttribute("data-cite-armed"), "1", "birinchi bosish qurollantirmadi");
  assert.ok(!saveBtn(), "bitta bosishda op ketdi");
  await act(async () => {
    fireEvent.click(span!);
  });
  await pause(10);
  assert.ok(saveBtn(), "ikkinchi bosish op bermadi");
  fireEvent.click(saveBtn()!);
  await pause(30);
  assert.deepEqual(ops(s.patches[0])[0], { op: "refRemove", refId: "W4385" });
  assert.ok(!s.doc.article!.references.some((r) => r.id === "W4385"));
  assert.ok(!document.querySelector('[data-page] .word-cite[data-ref-ids="W4385"]'), "iqtibos ekranda qoldi");
});

test("tahrir rejimi o'chirilganda nishonlar va qatlam yo'qoladi", async () => {
  const s = stubServer();
  const btn = await openEditor(s);
  assert.ok(document.querySelector("[data-page] [data-path]"));
  await act(async () => {
    fireEvent.click(btn);
  });
  await pause(10);
  assert.ok(!document.querySelector("[data-article-editor]"), "tahrir qatlami qoldi");
  assert.ok(!document.querySelector("[data-path]"), "tahrir nishonlari qoldi");
});

/* ══════════════════════════════ «Tuzatish» ══════════════════════════════ */

test("«Tuzatish» → POST …/rewrite (baseVersion + fix) → hujjat va ball yangilanadi, steklar tozalanadi", async () => {
  const s = stubServer();
  await openEditor(s);
  assert.equal(document.querySelector("[data-review-score]")?.getAttribute("data-review-score"), "71");
  const fixBtn = document.querySelector('[data-review-fix="intro"]') as HTMLButtonElement | null;
  assert.ok(fixBtn && !fixBtn.disabled, "«Tuzatish» tugmasi faol emas");
  await act(async () => {
    fireEvent.click(fixBtn!);
  });
  await pause(40);
  assert.equal(s.rewrites.length, 1, "rewrite chaqirilmadi");
  assert.equal(s.rewrites[0].body?.baseVersion, 1);
  assert.deepEqual(s.rewrites[0].body?.fix, { op: "rewrite", target: "intro", instruction: "Remove filler phrases." });
  assert.equal(document.querySelector("[data-review-score]")?.getAttribute("data-review-score"), "84", "ball yangilanmadi");
  assert.ok(pageHas(/Qayta yozilgan kirish/), "yangi bo'lim matni ekranda yo'q");
  assert.equal(s.patches.length, 0, "tuzatish PATCH orqali ketmasligi kerak");
  // Steklar tozalangan — Ctrl+Z eski matnni qaytarmaydi, navbat bo'sh.
  await act(async () => {
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
  });
  await pause(10);
  assert.ok(!saveBtn(), "tuzatishdan keyin navbat/stek qoldi");
  assert.ok(pageHas(/Qayta yozilgan kirish/));
});

test("«Tuzatish» avval saqlanmagan navbatni yuboradi (PATCH), keyin rewrite yangi versiya bilan", async () => {
  const s = stubServer();
  await openEditor(s);
  typeInto(byPath("heading:results"), "NATIJALAR");
  await pause(10);
  await act(async () => {
    fireEvent.click(document.querySelector('[data-review-fix="intro"]') as HTMLElement);
  });
  await pause(60);
  assert.equal(s.patches.length, 1, "navbat saqlanmadi");
  assert.equal(s.rewrites.length, 1);
  assert.equal(s.rewrites[0].body?.baseVersion, 2, "rewrite eski versiya bilan ketdi");
  assert.equal(s.doc.sections[2].title, "NATIJALAR");
  assert.match(s.doc.sections[0].blocks[0].text, /^Qayta yozilgan/);
});

test("«Tuzatish» 409 — xato ko'rsatiladi va hujjat serverdan qayta yuklanadi", async () => {
  const s = stubServer();
  await openEditor(s);
  s.failNext = "version";
  await act(async () => {
    fireEvent.click(document.querySelector('[data-review-fix="intro"]') as HTMLElement);
  });
  await pause(40);
  assert.equal(s.rewrites.length, 1);
  assert.ok(document.querySelector("[data-page-error]"), "xato ko'rsatilmadi");
  assert.ok(s.calls.some((c) => c.method === "GET"), "409 dan keyin qayta yuklanmadi");
  assert.equal(document.querySelector("[data-review-score]")?.getAttribute("data-review-score"), "71", "ball o'zgarmasligi kerak");
});
