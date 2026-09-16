import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h, act, useCallback, useRef, useState } from "react";
import { render, fireEvent, screen, cleanup } from "@testing-library/react";
import { WordViewer } from "../../components/viewers/WordViewer.tsx";
import { EditActions, type EditActionsState } from "../../components/files/EditActions.tsx";
import { applyWorkOps, type WorkOp } from "../../lib/generation/work/edit.ts";
import { WORK_TOOLS } from "../../components/files/useWorkEdit.ts";
import { sampleWorkDoc } from "../../lib/generation/work/samples.ts";
import type { AcademicDoc, DocMeta } from "../../lib/generation/types.ts";

/**
 * TALABA ISHI ko'ruvchisidagi TAHRIR (AUDIT-19 WP-C) — jsdom + `fetch`
 * stubi, `ui/article-viewer-edit` naqshi.
 *
 * `fetch` stubi serverni TAQLID qiladi: `PATCH` kelgan op larni AYNAN
 * `applyWorkOps` bilan qo'llaydi (server `workAdapter` ham shuni
 * chaqiradi) — ya'ni ekrandagi natija bilan bazadagi natija bitta
 * funksiyadan chiqadi.
 *
 * `lib/server/**` bu yerga import QILINMAYDI (`server-only`).
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

const GEN_ID = "gen-w1";
const META = {
  topic: "Oliy ta’limda adaptiv o‘qitish tizimlarini joriy etish",
  workLabel: "Kurs ishi",
  language: "uz",
  toolId: "coursework",
} as unknown as DocMeta;

function makeDoc(): AcademicDoc {
  return JSON.parse(JSON.stringify(sampleWorkDoc(META))) as AcademicDoc;
}

type Call = { url: string; method: string; body: Record<string, unknown> | null };
type Server = { calls: Call[]; patches: Call[]; doc: AcademicDoc; version: number; failNext: string | null };

function stubServer(init: AcademicDoc = makeDoc(), toolId = "coursework"): Server {
  const s: Server = { calls: [], patches: [], doc: init, version: 1, failNext: null };
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
      const res = applyWorkOps(s.doc, (body?.ops ?? []) as WorkOp[], { genId: GEN_ID });
      if (!res.ok) return json(422, { error: res.error, at: res.at });
      s.doc = res.doc;
      s.version += 1;
      return json(200, { generation: generation(s, toolId) });
    }
    if (method === "POST" && url.endsWith("/rebuild")) return json(200, { fileVersion: s.version, docVersion: s.version, rebuilt: true });
    if (method === "GET") return json(200, { generation: generation(s, toolId) });
    return json(404, { error: "yo'q" });
  };
  return s;
}

function generation(s: Server, toolId = "coursework") {
  return { id: GEN_ID, type: toolId, status: "COMPLETED", doc: s.doc, docVersion: s.version, fileVersion: 1, imageRedraws: 0, hasFile: true, hasPrev: false };
}

afterEach(() => cleanup());

function pause(ms: number) {
  return act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

type Gen = ReturnType<typeof generation>;

/** Sahifa taqlidi — `ResultView` kabi: `EditActions` + ko'ruvchi. */
function Page({ initial }: { initial: Gen }) {
  const [gen, setGen] = useState<Gen>(initial);
  const [st, setSt] = useState<EditActionsState | null>(null);
  const genRef = useRef(gen);
  genRef.current = gen;
  const adopt = useCallback((g: unknown) => {
    const merged = { ...genRef.current, ...(g as Gen) };
    genRef.current = merged;
    setGen(merged);
  }, []);
  return h("div", null, h(EditActions, { state: st }), h(WordViewer, { doc: gen.doc, gen, onGen: adopt, onEditState: setSt }));
}

async function openEditor(s: Server, toolId = "coursework") {
  render(h(Page, { initial: generation(s, toolId) }));
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

function typeInto(el: HTMLElement, text: string) {
  fireEvent.dblClick(el);
  assert.equal(el.getAttribute("contenteditable"), "true", "maydon tahrirga ochilmadi");
  el.textContent = text;
  fireEvent.keyDown(el, { key: "Enter" });
}

const saveBtn = () => screen.queryByText(/^Saqlash · /);

function pageHas(re: RegExp): boolean {
  return [...document.querySelectorAll("[data-page]")].some((p) => re.test(p.textContent ?? ""));
}

function ops(call: Call | undefined): WorkOp[] {
  return (call?.body?.ops ?? []) as WorkOp[];
}

/** `ch1.1` bo'limining birinchi bloki yo'li. */
const P0 = "sections.2.blocks.0";

/* ══════════════════════════════ nishonlar ══════════════════════════════ */

test("tahrir rejimi: varaqda nishonlar (paragraf, bob/paragraf sarlavhasi, rasm/jadval sarlavhasi, katak)", async () => {
  const s = stubServer();
  await openEditor(s);
  assert.ok(document.querySelector("[data-article-editor]"), "tahrir qatlami yo'q");
  byPath(P0);
  byPath("heading:intro");
  byPath("heading:ch1");
  byPath("heading:ch1.1");
  byPath("heading:conclusion");
  byPath("caption:figure:f1");
  byPath("caption:table:t1");
  byPath("cell:t1:0:1");
  byPath("cell:t1:-1:0");
  assert.ok(!document.querySelector("[aria-hidden] [data-path]"), "o'lchov daraxtiga nishon tushdi");
  assert.equal(s.calls.length, 0, "tahrir rejimida serverga chiqildi");
});

test("REJADAN chiqadigan matnlar tahrirlanmaydi: jadval raqami, «Manba:» va adabiyot satri", async () => {
  const s = stubServer();
  await openEditor(s);
  const paths = [...document.querySelectorAll("[data-page] [data-path]")].map((e) => e.getAttribute("data-path") ?? "");
  assert.ok(paths.length > 10, `nishonlar soni juda kam: ${paths.length}`);
  const texts = [...document.querySelectorAll("[data-page] [data-path]")].map((e) => e.textContent ?? "");
  assert.ok(!texts.some((t) => t.trim() === "1.1-jadval"), "jadval raqami tahrirga ochilgan");
  assert.ok(!texts.some((t) => t.trim().startsWith("Manba:")), "«Manba:» qatori tahrirga ochilgan");
  assert.ok(!texts.some((t) => /^\d+\. Karimov A\.N\./.test(t.trim())), "adabiyot satri tahrirga ochilgan");
  // Bob sarlavhasi RAQAMSIZ ochiladi — «1-BOB.» op ga kirmasin.
  const head = byPath("heading:ch1");
  fireEvent.dblClick(head);
  assert.equal(head.textContent, "Adaptiv o‘qitish tizimlarining nazariy asoslari", "sarlavha raqami bilan ochildi");
});

/* ══════════════════════════════ tahrir oqimi ══════════════════════════════ */

test("dblclick → Enter: bitta saqlanmagan o'zgarish, ekranda yangi matn, tarmoqqa chiqilmaydi", async () => {
  const s = stubServer();
  await openEditor(s);
  typeInto(byPath(P0), "Adaptiv o‘qitish — yangilangan ta’rif.");
  await pause(20);
  assert.equal(s.calls.length, 0, "«Saqlash» bosilmasdan server chaqirildi");
  const btn = saveBtn();
  assert.ok(btn, "«Saqlash» tugmasi chiqmadi");
  assert.match(btn!.textContent ?? "", /1/);
  assert.ok(pageHas(/Adaptiv o‘qitish — yangilangan ta’rif\./), "ekranda yangi matn yo'q");
});

test("«Saqlash» — BITTA `PATCH`, WORK op tili bilan; keyin `rebuild`", async () => {
  const s = stubServer();
  await openEditor(s);
  typeInto(byPath(P0), "Birinchi tahrir.");
  typeInto(byPath("heading:ch1.1"), "Tushuncha va tasnif");
  await pause(20);
  await act(async () => {
    fireEvent.click(saveBtn()!);
  });
  await pause(60);
  assert.equal(s.patches.length, 1, `bitta PATCH kutilgan, bo'ldi: ${s.patches.length}`);
  const sent = ops(s.patches[0]);
  assert.equal(sent.length, 2, "ikkala o'zgarish bitta so'rovga yig'ilmadi");
  assert.deepEqual(
    sent.map((o) => o.op),
    ["text", "heading"],
  );
  assert.equal(sent[1].op === "heading" ? sent[1].sectionId : "", "ch1.1");
  assert.ok(s.calls.some((c) => c.url.endsWith("/rebuild")), "DOCX qayta yasalmadi");
  // Serverdagi hujjat ham yangilandi va BOB DARAXTI sinxron.
  assert.equal(s.doc.work!.chapters[0].paragraphs[0].title, "Tushuncha va tasnif");
});

test("jadval katagi va rasm sarlavhasi — o'z op lari bilan", async () => {
  const s = stubServer();
  await openEditor(s);
  typeInto(byPath("cell:t1:0:2"), "Har haftalik test");
  typeInto(byPath("caption:figure:f1"), "Tizimning blok-sxemasi");
  await pause(20);
  await act(async () => {
    fireEvent.click(saveBtn()!);
  });
  await pause(60);
  const sent = ops(s.patches[0]);
  assert.deepEqual(
    sent.map((o) => o.op),
    ["cell", "caption"],
  );
  assert.equal(s.doc.tables![0].rows[0][2], "Har haftalik test");
  assert.equal(s.doc.work!.figures[0].caption, "Tizimning blok-sxemasi");
  // Ekranda raqam REJADAN qayta qo'yiladi.
  assert.ok(pageHas(/2\.1-rasm\. Tizimning blok-sxemasi/), "yangi sarlavha raqam bilan chizilmadi");
});

test("Ctrl+Z — o'zgarish BIRINCHI bosishda qaytadi; tarmoqqa chiqilmaydi", async () => {
  const s = stubServer();
  await openEditor(s);
  const before = s.doc.sections[2].blocks[0].text;
  typeInto(byPath(P0), "Qaytariladigan matn.");
  await pause(20);
  assert.ok(pageHas(/Qaytariladigan matn\./));
  assert.match(saveBtn()!.textContent ?? "", /Saqlash · 1$/, "bitta tahrir uchun bittadan ko'p op navbatga tushdi");
  await act(async () => {
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
  });
  await pause(20);
  assert.ok(!pageHas(/Qaytariladigan matn\./), "Ctrl+Z birinchi bosishda qaytarmadi");
  assert.equal(s.calls.length, 0, "undo serverga chiqdi");
  /*
   * Undo O'ZI ham navbatga tushadi (teskari op) — shuning uchun saqlash
   * tugmasi qoladi; saqlangandan keyin bazadagi matn ASLIGA qaytishi
   * kerak. Aynan shu «ekran qaytdi, baza qaytmadi» holati xavfli.
   */
  await act(async () => {
    fireEvent.click(saveBtn()!);
  });
  await pause(60);
  assert.equal(s.doc.sections[2].blocks[0].text, before, "undo dan keyin bazadagi matn asliga qaytmadi");
});

test("iqtibos: ochilganda `[6, 45-b.]` ko'rinadi, saqlanganda XOM `[u1; 45-b.]` saqlanadi", async () => {
  const s = stubServer();
  await openEditor(s);
  const el = byPath(P0);
  fireEvent.dblClick(el);
  const cites = [...el.querySelectorAll("[data-cite-raw]")];
  assert.ok(cites.length >= 2, `iqtibos spanlari topilmadi: ${cites.length}`);
  const raws = cites.map((c) => c.getAttribute("data-cite-raw"));
  assert.ok(raws.includes("[W2741809807]"), `xom iqtibos yo'q: ${raws.join(" ")}`);
  assert.ok(raws.includes("[u1; 45-b.]"), `lokatorli xom iqtibos yo'q: ${raws.join(" ")}`);
  const shown = cites.map((c) => c.textContent);
  assert.ok(shown.some((t) => /^\[\d+\]$/.test(t ?? "")), `raqamli ko'rinish yo'q: ${shown.join(" ")}`);
  assert.ok(shown.some((t) => /^\[\d+, 45-b\.\]$/.test(t ?? "")), `lokatorli ko'rinish vergul bilan bo'lishi kerak: ${shown.join(" ")}`);
  assert.equal(cites[0].getAttribute("contenteditable"), "false", "iqtibos spani tahrirlanadigan bo'lib qoldi");

  // Matn tugunini o'zgartiramiz, spanlarni saqlab qolamiz.
  el.firstChild!.textContent = "Tahrirlangan boshlanish ";
  fireEvent.keyDown(el, { key: "Enter" });
  await pause(20);
  await act(async () => {
    fireEvent.click(saveBtn()!);
  });
  await pause(60);
  const saved = s.doc.sections[2].blocks[0].text;
  assert.ok(saved.startsWith("Tahrirlangan boshlanish"), `matn saqlanmadi: ${saved}`);
  assert.ok(saved.includes("[W2741809807]"), `xom id yo'qoldi: ${saved}`);
  assert.ok(saved.includes("[u1; 45-b.]"), `lokatorli xom id yo'qoldi: ${saved}`);
  // Manbalar ro'yxati O'ZGARMADI — iqtiboslar joyida.
  assert.equal(s.doc.work!.references.filter((r) => r.cited).length, 15);
});

test("409 `version` — klient serverga BO'YSUNADI (hujjat qayta yuklanadi)", async () => {
  const s = stubServer();
  await openEditor(s);
  s.failNext = "version";
  typeInto(byPath(P0), "Konfliktli matn.");
  await pause(20);
  await act(async () => {
    fireEvent.click(saveBtn()!);
  });
  await pause(80);
  assert.equal(s.patches.length, 1);
  assert.ok(!pageHas(/Konfliktli matn\./), "409 dan keyin klient o'z matnini saqlab qoldi");
  assert.ok(s.calls.some((c) => c.method === "GET"), "hujjat serverdan qayta yuklanmadi");
});

test("REFERAT ham tahrirlanadi (bir xil op tili), INSHO — yo'q", async () => {
  const doc = JSON.parse(JSON.stringify(sampleWorkDoc({ ...META, toolId: "referat", workLabel: "Referat" } as DocMeta, { genre: "referat", kind: "informative" }))) as AcademicDoc;
  const s = stubServer(doc, "referat");
  await openEditor(s, "referat");
  byPath("heading:ch1");
  typeInto(byPath("heading:ch1"), "Yangi bo‘lim nomi");
  await pause(20);
  await act(async () => {
    fireEvent.click(saveBtn()!);
  });
  await pause(60);
  assert.equal(s.patches.length, 1);
  assert.equal(s.doc.sections.find((x) => x.id === "ch1")!.title, "Yangi bo‘lim nomi");
  // Referat bo'limi «1. » bilan chiziladi, «1-BOB.» bilan emas.
  assert.ok(pageHas(/1\. YANGI BO‘LIM NOMI/), "referat bo'limi raqami noto'g'ri");

  /*
   * Insho WP-E1 dan beri O'Z adapteri bilan tahrirlanadi (maqola op
   * tili) — `useWorkEdit` uni QABUL QILMAYDI, ya'ni talaba ishining op
   * tili inshoga tushmaydi.
   */
  assert.ok(!WORK_TOOLS.includes("essay" as never), "insho work op tiliga tushdi");
  assert.deepEqual([...WORK_TOOLS], ["coursework", "referat", "mustaqil-ish"]);
});

test("ESKI hujjat (`doc.work` yo'q) — tahrir tugmasi UMUMAN chiqmaydi", async () => {
  const doc = makeDoc();
  delete doc.work;
  doc.sections = doc.sections.filter((x) => x.blocks.length);
  const s = stubServer(doc);
  render(h(Page, { initial: generation(s) }));
  await pause(30);
  assert.ok(!screen.queryByText("Tahrirlash"), "eski hujjat tahrirga ochildi");
  assert.ok(pageHas(/Mavzuning dolzarbligi/), "eski hujjat chizilmadi");
});
