import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h, act, useCallback, useRef, useState } from "react";
import { render, fireEvent, screen, cleanup } from "@testing-library/react";
import { WordViewer } from "../../components/viewers/WordViewer.tsx";
import { EditActions, type EditActionsState } from "../../components/files/EditActions.tsx";
import { applyTeacherOps, type TeacherOp } from "../../lib/generation/teacher/edit.ts";
import { planTeacher } from "../../lib/generation/teacher/layout.ts";
import { sampleTeacherDoc } from "../../lib/generation/teacher/samples.ts";
import type { AcademicDoc } from "../../lib/generation/types.ts";

/**
 * O'QITUVCHI HUJJATI ko'ruvchisidagi TAHRIR (AUDIT-20 WP-D) — jsdom +
 * `fetch` stubi, `ui/work-viewer-edit` naqshi.
 *
 * `fetch` stubi serverni TAQLID qiladi: `PATCH` kelgan op larni AYNAN
 * `applyTeacherOps` bilan qo'llaydi (server `teacherAdapter` ham shuni
 * chaqiradi) — ekrandagi natija bilan bazadagi natija bitta
 * funksiyadan chiqadi.
 *
 * Bu yerda qulflanadigan QAROR: o'qituvchi hujjatida tahrir nishoni
 * NASR bloki ham, MODEL maydoni ham bo'lishi mumkin (`teacher.…`) —
 * ikkalasi ham `data-path` orqali bir xil ishlaydi, chunki
 * `teacherEditTargets` nishonni REJADAN oladi.
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

const GEN_ID = "gen-t1";

const makeDoc = (kind: "lesson" | "glossary" | "map" | "test" = "lesson"): AcademicDoc =>
  JSON.parse(JSON.stringify(sampleTeacherDoc(kind))) as AcademicDoc;

type Call = { url: string; method: string; body: Record<string, unknown> | null };
type Server = { calls: Call[]; patches: Call[]; doc: AcademicDoc; version: number };

function stubServer(init: AcademicDoc = makeDoc(), toolId = "lesson-plan"): Server {
  const s: Server = { calls: [], patches: [], doc: init, version: 1 };
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
      const res = applyTeacherOps(s.doc, (body?.ops ?? []) as TeacherOp[], { genId: GEN_ID });
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

function generation(s: Server, toolId = "lesson-plan") {
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

async function openEditor(s: Server, toolId = "lesson-plan") {
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

function ops(call: Call | undefined): TeacherOp[] {
  return (call?.body?.ops ?? []) as TeacherOp[];
}

/** Uy vazifasi bo'limining yagona paragrafi. */
const HOMEWORK = "sections.3.blocks.0";

/* ══════════════════════════════ nishonlar ══════════════════════════════ */

test("tahrir rejimi: varaqda nishonlar (shapka maydoni, paragraf, bo'lim sarlavhasi)", async () => {
  const s = stubServer();
  await openEditor(s);
  assert.ok(document.querySelector("[data-article-editor]"), "tahrir qatlami yo'q");
  byPath(HOMEWORK);
  byPath("heading:goal");
  byPath("heading:stages");
  byPath("teacher.school.subject");
  assert.ok(!document.querySelector("[aria-hidden] [data-path]"), "o'lchov daraxtiga nishon tushdi");
  assert.equal(s.calls.length, 0, "tahrir rejimida serverga chiqildi");
});

test("REJADAN chiqadigan matnlar tahrirlanmaydi: hujjat nomi, «Tasdiqlayman», jadval raqami", async () => {
  const s = stubServer();
  await openEditor(s);
  const texts = [...document.querySelectorAll("[data-page] [data-path]")].map((e) => (e.textContent ?? "").trim());
  assert.ok(!texts.includes("DARS ISHLANMASI"), "hujjat nomi tahrirga ochilgan");
  assert.ok(!texts.some((t) => t.startsWith("Tasdiqlayman")), "«Tasdiqlayman» bloki tahrirga ochilgan");
  assert.ok(!texts.some((t) => /^\d+-jadval$/.test(t)), "jadval raqami tahrirga ochilgan");
  assert.ok(texts.length > 8, `nishonlar soni juda kam: ${texts.length}`);
});

/* ══════════════════════════════ tahrir oqimi ══════════════════════════════ */

test("dblclick → Enter: bitta saqlanmagan o'zgarish, ekranda yangi matn, tarmoqqa chiqilmaydi", async () => {
  const s = stubServer();
  await openEditor(s);
  typeInto(byPath(HOMEWORK), "Yangilangan uy vazifasi: sxema chizing.");
  await pause(20);
  assert.equal(s.calls.length, 0, "«Saqlash» bosilmasdan server chaqirildi");
  const btn = saveBtn();
  assert.ok(btn, "«Saqlash» tugmasi chiqmadi");
  assert.match(btn!.textContent ?? "", /1/);
  assert.ok(pageHas(/Yangilangan uy vazifasi/), "ekranda yangi matn yo'q");
});

test("«Saqlash» — BITTA `PATCH`, TEACHER op tili bilan; `data-edit-saved` belgisi", async () => {
  const s = stubServer();
  await openEditor(s);
  typeInto(byPath(HOMEWORK), "Birinchi tahrir.");
  await pause(20);
  await act(async () => {
    fireEvent.click(saveBtn()!);
  });
  await pause(60);
  assert.equal(s.patches.length, 1, `PATCH soni: ${s.patches.length}`);
  const sent = ops(s.patches[0]);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].op, "text");
  assert.ok(sent[0].op === "text" && sent[0].path === HOMEWORK);
  // Server AYNI `applyTeacherOps` bilan qo'lladi — model ham ergashdi.
  assert.equal(s.doc.teacher!.lesson!.homework, "Birinchi tahrir.", "model yangilanmadi");
  await pause(40);
  assert.ok(document.querySelector("[data-edit-saved]"), "«saqlandi» belgisi chiqmadi");
});

test("MODEL maydoni (shapkadagi fan) tahrirlanadi va modelga tushadi", async () => {
  const s = stubServer();
  await openEditor(s);
  const el = byPath("teacher.school.subject");
  // Shapkada «Yorliq: qiymat» — maydon FAQAT qiymatni ochadi.
  fireEvent.dblClick(el);
  assert.equal(el.textContent, "Biologiya", "shapka maydoni yorliq bilan ochildi");
  el.textContent = "Kimyo";
  fireEvent.keyDown(el, { key: "Enter" });
  await pause(20);
  await act(async () => {
    fireEvent.click(saveBtn()!);
  });
  await pause(60);
  const sent = ops(s.patches[0]);
  assert.ok(sent[0].op === "text" && sent[0].path === "teacher.school.subject", JSON.stringify(sent));
  assert.equal(s.doc.teacher!.school.subject, "Kimyo");
});

test("JADVAL KATAGI: `table:<n>` nishoni bilan tahrirlanadi va modelga ko'chadi", async () => {
  const doc = makeDoc("map");
  const s = stubServer(doc, "texnologik-xarita");
  await openEditor(s, "texnologik-xarita");
  /*
   * Xarita jadvali HUJJAT jadvali — nishoni `table:<n>` (hisobot va
   * sayqal bilan AYNI sintaksis). `WordViewer` unga ustun indeksini
   * qo'shadi: `cell:table:0:<r>:<c>`.
   */
  const cell = document.querySelector('[data-page] [data-path^="cell:table:0:0:"]');
  assert.ok(cell, "jadval katagi nishoni yo'q");
  const el = cell as HTMLElement;
  const c = Number((el.getAttribute("data-path") ?? "").split(":").pop());
  fireEvent.dblClick(el);
  el.textContent = "Yangi mavzu nomi";
  fireEvent.keyDown(el, { key: "Enter" });
  await pause(20);
  await act(async () => {
    fireEvent.click(saveBtn()!);
  });
  await pause(60);
  const sent = ops(s.patches[0]);
  assert.equal(sent[0].op, "cell");
  assert.ok(sent[0].op === "cell" && sent[0].tableId === "table:0", JSON.stringify(sent[0]));
  assert.equal(s.doc.tables![0].rows[0][c], "Yangi mavzu nomi");
  // «Mavzu» ustuni bo'lsa model ham ergashadi (raqam ustuni — yo'q).
  if (c === 2) assert.equal(s.doc.teacher!.map!.quarters[0].weeks[0].topic, "Yangi mavzu nomi", "model eski mavzuda qoldi");
});

test("GLOSSARIY: atama sarlavhasi tahrirlansa model `terms[].term` ham yangilanadi", async () => {
  const doc = makeDoc("glossary");
  const s = stubServer(doc, "glossary");
  await openEditor(s, "glossary");
  const first = doc.teacher!.glossary!.terms[0].term;
  const el = byPath("sections.1.blocks.0");
  assert.equal(el.textContent?.trim(), first, "birinchi atama sarlavhasi emas");
  typeInto(el, "Xlorofill");
  await pause(20);
  await act(async () => {
    fireEvent.click(saveBtn()!);
  });
  await pause(60);
  assert.equal(s.doc.teacher!.glossary!.terms[0].term, "Xlorofill", "model atama nomini olmadi");
  assert.equal(s.doc.sections[1].blocks[0].text, "Xlorofill");
});

test("Esc — o'zgarish bekor qilinadi, `PATCH` yo'q", async () => {
  const s = stubServer();
  await openEditor(s);
  const el = byPath(HOMEWORK);
  const before = el.textContent ?? "";
  fireEvent.dblClick(el);
  el.textContent = "Bekor qilinadigan matn";
  fireEvent.keyDown(el, { key: "Escape" });
  await pause(20);
  assert.ok(!saveBtn(), "Esc dan keyin ham saqlanmagan o'zgarish qoldi");
  assert.equal(s.patches.length, 0);
  assert.ok(pageHas(new RegExp(before.slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))), "asl matn qaytmadi");
});

test("eski hujjat (`doc.teacher` yo'q) — tahrir tugmasi UMUMAN chiqmaydi", async () => {
  const legacy = makeDoc();
  delete legacy.teacher;
  const s = stubServer(legacy);
  render(h(Page, { initial: generation(s) }));
  await pause(30);
  assert.ok(!screen.queryByText("Tahrirlash"), "eski hujjatda tahrir tugmasi chiqdi (saqlashda 409 bo'lardi)");
});
