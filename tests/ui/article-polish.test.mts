import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h, act, useCallback, useRef, useState } from "react";
import { render, fireEvent, screen, cleanup } from "@testing-library/react";
import { WordViewer } from "../../components/viewers/WordViewer.tsx";
import { ArticleReviewPanel } from "../../components/viewers/ArticleReviewPanel.tsx";
import { EditActions, type EditActionsState } from "../../components/files/EditActions.tsx";
import { editErrorCode, editErrorText, polishArticle } from "../../lib/api-edit.ts";
import { applyArticleOps, type ArticleOp } from "../../lib/generation/article/edit.ts";
import { sampleArticleDoc } from "../../lib/generation/article/samples.ts";
import type { ArticleReview, PolishLog } from "../../lib/generation/article/types.ts";
import type { AcademicDoc, DocMeta } from "../../lib/generation/types.ts";

/**
 * «Hammasini tuzatish» (Maqola 3, AUDIT-18 WP-A) — jsdom + `fetch` stubi
 * (`article-viewer-edit` naqshi): tugma → `POST …/polish` `{baseVersion}`
 * → javobdagi generatsiya o'zlashtiriladi (yangi ball, jurnal, yangi
 * bo'lim matni ekranda); rad (server eski hujjat + jurnal) → matn eski,
 * jurnal «ballni oshirmadi»; 409 → hujjat serverdan qayta yuklanadi;
 * saqlanmagan navbat avval PATCH bilan ketadi; «Sizdan kutiladi» ro'yxati
 * `review.userNeeds` dan; tugma sayqal davomida «Tuzatilmoqda…».
 *
 * Mutatsiya: `ResultView.onPolish` — `editState.save()` olib tashlandi →
 * «avval navbat» testi (bu yerdagi `Page` ResultView bilan bir xil naqsh;
 * manba matni `tests/viewer/article-review-panel` da qulflangan).
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

const GEN_ID = "gen-p1";
const META = { topic: "Sun’iy intellektning oliy ta’limdagi o‘rni", author: "K", workLabel: "Maqola", language: "uz", toolId: "article" } as unknown as DocMeta;

function review(score: number, extra: Partial<ArticleReview> = {}): ArticleReview {
  return {
    score,
    checks: [
      { id: "structure", level: "green", label: "Tuzilma" },
      { id: "udk", level: "yellow", label: "UDK", detail: "Profil UDK talab qiladi — ko‘rsatilmagan" },
      { id: "filler", level: "yellow", label: "«Suv» iboralar", detail: "2 ta", fix: { op: "rewrite", target: "intro", instruction: "Remove filler phrases." } },
      { id: "limitations", level: "yellow", label: "Cheklovlar", fix: { op: "rewrite", target: "discussion", instruction: "Add limitations." } },
    ],
    judgeNotes: [],
    verifiedShare: 1,
    recentShare: 1,
    builtAt: "2026-09-12T00:00:00.000Z",
    userNeeds: [
      { id: "udk", label: "UDK", hint: "Formadagi «Taklif» tugmasi bilan oling" },
      { id: "results", label: "Natijalarim", hint: "Tajriba natijalaringizni kiriting" },
    ],
    ...extra,
  };
}

function makeDoc(): AcademicDoc {
  const d = JSON.parse(JSON.stringify(sampleArticleDoc(META))) as AcademicDoc;
  d.article!.review = review(71);
  return d;
}

type Call = { url: string; method: string; body: Record<string, unknown> | null };
type Server = { calls: Call[]; patches: Call[]; polishes: Call[]; doc: AcademicDoc; version: number; failNext: string | null; accept: boolean };

/** Server taqlidi: `POST …/polish` — qabul: bo'limlar qayta yozildi + jurnalli hisobot; rad: faqat jurnalli hisobot (eski matn). */
function stubServer(init: AcademicDoc = makeDoc()): Server {
  const s: Server = { calls: [], patches: [], polishes: [], doc: init, version: 1, failNext: null, accept: true };
  const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

  (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown, opts?: RequestInit) => {
    const url = String(input);
    const method = opts?.method ?? "GET";
    const body = typeof opts?.body === "string" ? (JSON.parse(opts.body) as Record<string, unknown>) : null;
    const call = { url, method, body };
    s.calls.push(call);

    if (method === "PATCH" && url.endsWith("/doc")) {
      s.patches.push(call);
      if (body?.baseVersion !== s.version) return json(409, { code: "version", docVersion: s.version });
      const res = applyArticleOps(s.doc, (body?.ops ?? []) as ArticleOp[], { genId: GEN_ID });
      if (!res.ok) return json(422, { error: res.error, at: res.at });
      s.doc = res.doc;
      s.version += 1;
      return json(200, { generation: generation(s) });
    }
    if (method === "POST" && url.endsWith("/polish")) {
      s.polishes.push(call);
      if (s.failNext) {
        const code = s.failNext;
        s.failNext = null;
        return json(409, { code, error: "Konflikt" });
      }
      if (body?.baseVersion !== s.version) return json(409, { code: "version", docVersion: s.version });
      const log: PolishLog = s.accept
        ? { before: 71, after: 86, applied: [{ target: "intro", instruction: "x" }, { target: "discussion", instruction: "y" }], skipped: [{ id: "udk", reason: "user" }], accepted: true, at: "2026-09-12T01:00:00.000Z" }
        : { before: 71, after: 66, applied: [{ target: "intro", instruction: "x" }], skipped: [{ id: "udk", reason: "user" }], accepted: false, at: "2026-09-12T01:00:00.000Z" };
      const ops: ArticleOp[] = s.accept
        ? [
            { op: "setSection", sectionId: "intro", blocks: [{ kind: "p", text: "Sayqallangan kirish: aniq maqsad va manba [W4385]." }] },
            { op: "review", review: review(86, { polish: log, userNeeds: [{ id: "udk", label: "UDK", hint: "Formadagi «Taklif» tugmasi bilan oling" }] }) },
          ]
        : [{ op: "review", review: review(71, { polish: log }) }];
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
  return { id: GEN_ID, type: "article", status: "COMPLETED", doc: s.doc, docVersion: s.version, fileVersion: 1, imageRedraws: 0, hasFile: true, hasPrev: false };
}

afterEach(() => cleanup());

function pause(ms: number) {
  return act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

type Gen = ReturnType<typeof generation>;

/** Sahifa taqlidi — `ResultView.onPolish` bilan bir xil naqsh: avval navbat `save`, keyin polish, 409 → qayta yuklash. */
function Page({ initial }: { initial: Gen }) {
  const [gen, setGen] = useState<Gen>(initial);
  const [st, setSt] = useState<EditActionsState | null>(null);
  const [polishing, setPolishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const genRef = useRef(gen);
  genRef.current = gen;
  const adopt = useCallback((g: unknown) => {
    const merged = { ...genRef.current, ...(g as Gen) };
    genRef.current = merged;
    setGen(merged);
  }, []);
  const onPolish = useCallback(async () => {
    setPolishing(true);
    setError(null);
    try {
      if (st?.pending) await st.save();
      const r = await polishArticle(genRef.current.id, genRef.current.docVersion);
      adopt(r.generation);
    } catch (e) {
      setError(editErrorText(e));
      if (editErrorCode(e)) {
        const res = await fetch(`/api/generations/${GEN_ID}`);
        adopt(((await res.json()) as { generation: Gen }).generation);
      }
    } finally {
      setPolishing(false);
    }
  }, [st, adopt]);
  return h(
    "div",
    null,
    h(EditActions, { state: st }),
    error ? h("div", { "data-page-error": "1" }, error) : null,
    gen.doc.article?.review ? h(ArticleReviewPanel, { review: gen.doc.article.review, onFix: () => {}, onPolish: () => void onPolish(), polishing }) : null,
    h(WordViewer, { doc: gen.doc, gen, onGen: adopt, onEditState: setSt }),
  );
}

async function mount(s: Server) {
  render(h(Page, { initial: generation(s) }));
  await pause(30);
}

const polishBtn = () => document.querySelector("[data-polish-button]") as HTMLButtonElement | null;
const score = () => document.querySelector("[data-review-score]")?.getAttribute("data-review-score");
function pageHas(re: RegExp): boolean {
  return [...document.querySelectorAll("[data-page]")].some((p) => re.test(p.textContent ?? ""));
}

/* ══════════════════════════════ testlar ══════════════════════════════ */

test("«Hammasini tuzatish» → POST …/polish {baseVersion} → yangi ball, jurnal, yangi bo'lim matni ekranda; PATCH ketmaydi", async () => {
  const s = stubServer();
  await mount(s);
  assert.equal(score(), "71");
  assert.ok(document.querySelector("[data-user-needs]"), "«Sizdan kutiladi» bloki yo'q");
  assert.equal(document.querySelectorAll("[data-user-need]").length, 2);
  assert.ok(document.querySelector('[data-user-need="results"]')?.textContent?.includes("Natijalarim"));
  assert.ok(!document.querySelector("[data-polish-log]"), "hali jurnal bo'lmasligi kerak");
  const btn = polishBtn();
  assert.ok(btn && !btn.disabled, "tugma faol emas");
  await act(async () => {
    fireEvent.click(btn!);
  });
  await pause(40);
  assert.equal(s.polishes.length, 1, "polish chaqirilmadi");
  assert.equal(s.polishes[0].body?.baseVersion, 1);
  assert.deepEqual(Object.keys(s.polishes[0].body ?? {}), ["baseVersion"], "tana faqat baseVersion");
  assert.equal(s.patches.length, 0, "sayqal PATCH orqali ketmasligi kerak");
  assert.equal(score(), "86", "ball yangilanmadi");
  const log = document.querySelector("[data-polish-log]");
  assert.ok(log, "jurnal satri yo'q");
  assert.match(log!.textContent ?? "", /Avto-sayqal: 71 → 86 ball, 2 band tuzatildi; 1 band sizning ma’lumotingizni kutmoqda/);
  assert.equal(log!.getAttribute("data-polish-accepted"), "1");
  assert.ok(pageHas(/Sayqallangan kirish/), "yangi bo'lim matni ekranda yo'q");
  // «Sizdan kutiladi» yangi hisobotdan: endi faqat UDK.
  assert.equal(document.querySelectorAll("[data-user-need]").length, 1);
  assert.ok(!polishBtn()!.getAttribute("aria-busy"), "sayqal tugagach busy qolmasligi kerak");
});

test("sayqal davomida tugma «Tuzatilmoqda…» va «Tuzatish» tugmalari o'chiq", async () => {
  const s = stubServer();
  const orig = globalThis.fetch;
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown, opts?: RequestInit) => {
    if (String(input).endsWith("/polish")) await gate;
    return orig(input as string, opts);
  };
  await mount(s);
  await act(async () => {
    fireEvent.click(polishBtn()!);
  });
  await pause(10);
  assert.equal(polishBtn()!.textContent, "Tuzatilmoqda… ~1 daqiqa");
  assert.ok(polishBtn()!.disabled);
  const fixes = [...document.querySelectorAll("[data-review-fix]")] as HTMLButtonElement[];
  assert.ok(fixes.length >= 1 && fixes.every((b) => b.disabled), "sayqal paytida «Tuzatish» faol qoldi");
  release();
  await pause(40);
  assert.equal(polishBtn()!.textContent, "Hammasini tuzatish");
  assert.equal(score(), "86");
});

test("rad (server eski hujjat + jurnal): matn o'zgarmaydi, ball eski, jurnal «ballni oshirmadi»", async () => {
  const s = stubServer();
  s.accept = false;
  await mount(s);
  await act(async () => {
    fireEvent.click(polishBtn()!);
  });
  await pause(40);
  assert.equal(score(), "71");
  assert.ok(pageHas(/Oliy ta’limda raqamli transformatsiya/), "eski matn qolishi kerak");
  assert.ok(!pageHas(/Sayqallangan kirish/));
  const log = document.querySelector("[data-polish-log]");
  assert.ok(log);
  assert.match(log!.textContent ?? "", /ballni oshirmadi \(71 → 66\) — eski matn qoldirildi/);
  assert.equal(log!.getAttribute("data-polish-accepted"), "0");
});

test("409 — hujjat serverdan qayta yuklanadi, xato ko'rsatiladi", async () => {
  const s = stubServer();
  await mount(s);
  s.failNext = "version";
  await act(async () => {
    fireEvent.click(polishBtn()!);
  });
  await pause(40);
  assert.equal(s.polishes.length, 1);
  assert.ok(s.calls.some((c) => c.method === "GET"), "409 dan keyin hujjat qayta yuklanmadi");
  assert.ok(document.querySelector("[data-page-error]"), "xato matni yo'q");
  assert.equal(score(), "71");
  assert.ok(!polishBtn()!.disabled, "409 dan keyin tugma yana faol bo'lishi kerak");
});

test("saqlanmagan navbat avval PATCH bilan ketadi, keyin polish YANGI versiya bilan", async () => {
  const s = stubServer();
  await mount(s);
  await act(async () => {
    fireEvent.click(screen.getByText("Tahrirlash"));
  });
  await pause(30);
  const el = document.querySelector('[data-page] [data-path="heading:results"]') as HTMLElement | null;
  assert.ok(el, "tahrir nishoni yo'q");
  fireEvent.dblClick(el!);
  el!.textContent = "NATIJALAR";
  fireEvent.keyDown(el!, { key: "Enter" });
  await pause(10);
  assert.ok(screen.queryByText(/^Saqlash · /), "navbat yo'q");
  await act(async () => {
    fireEvent.click(polishBtn()!);
  });
  await pause(60);
  assert.equal(s.patches.length, 1, "navbat saqlanmadi");
  assert.equal(s.polishes.length, 1);
  assert.equal(s.polishes[0].body?.baseVersion, 2, "polish yangi versiya bilan ketishi kerak");
  assert.equal(s.doc.sections[2].title, "NATIJALAR");
  assert.equal(score(), "86");
});

test("tuzatiladigan band bo'lmasa tugma o'chiq", async () => {
  const d = makeDoc();
  d.article!.review = review(88, { checks: [{ id: "udk", level: "yellow", label: "UDK" }, { id: "structure", level: "green", label: "T" }] });
  const s = stubServer(d);
  await mount(s);
  assert.ok(polishBtn()!.disabled);
  fireEvent.click(polishBtn()!);
  await pause(20);
  assert.equal(s.polishes.length, 0);
});
