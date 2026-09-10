import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h, act, useState } from "react";
import { render, fireEvent, screen, cleanup } from "@testing-library/react";
import { ResumeViewer } from "../../components/viewers/ResumeViewer.tsx";
import { EditActions, type EditActionsState } from "../../components/files/EditActions.tsx";
import { applyResumeOps, type ResumeOp } from "../../lib/generation/resume/edit.ts";
import { docFromResume } from "../../lib/generation/resume/model.ts";
import { sampleResume } from "../../lib/generation/resume/samples.ts";
import type { AcademicDoc, DocMeta } from "../../lib/generation/types.ts";

/**
 * Rezyume ko'ruvchisidagi TAHRIR (jsdom + `fetch` stubi).
 *
 * `tests/ui/slide-viewer-edit.test.mts` bilan bir xil yondashuv: bu
 * yerda ekrandagi piksel emas, TARMOQ va HOLAT xatti-harakati
 * sinaladi — server FAQAT «Saqlash» bosilganda chaqiriladimi, yig'ilgan
 * operatsiyalar bitta `PATCH` ga tushadimi, undan keyin DOCX qayta
 * yasaladimi, 409 dan keyin klient serverga bo'ysunadimi.
 *
 * `fetch` stubi serverni TAQLID qiladi: `PATCH` kelgan operatsiyalarni
 * AYNAN `applyResumeOps` bilan qo'llaydi (server ham shuni chaqiradi),
 * ya'ni test klient va server bir xil hujjatga kelishini ham qulflaydi.
 */

/*
 * `useVisiblePage` `IntersectionObserver` ni so'raydi — jsdom da u yo'q.
 * Sahifa raqamini kuzatish bu testda sinalmaydi, shuning uchun bo'sh
 * taqlid yetarli (`setup.ts` dagi `ResizeObserver` bilan bir xil naqsh).
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

const GEN_ID = "gen-r1";

const META: DocMeta = {
  topic: "Moliya tahlilchisi",
  author: "Karimova Dilnoza",
  workLabel: "Rezyume",
  language: "uz",
  toolId: "resume",
} as unknown as DocMeta;

function makeDoc(): AcademicDoc {
  const m = sampleResume("modern", undefined, false);
  m.experience = m.experience.map((e, i) =>
    i === 0 ? { ...e, bullets: e.bullets.map((b, j) => (j === 0 ? { ...b, ai: true as const } : b)) } : e,
  );
  return docFromResume(m, META);
}

type Call = { url: string; method: string; body: Record<string, unknown> | null };
type Server = { calls: Call[]; patches: Call[]; doc: AcademicDoc; version: number; failNext: string | null };

function stubServer(init: AcademicDoc = makeDoc()): Server {
  const s: Server = { calls: [], patches: [], doc: init, version: 1, failNext: null };
  const json = (status: number, data: unknown) =>
    new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

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
      const res = applyResumeOps(s.doc, (body?.ops ?? []) as ResumeOp[], { genId: GEN_ID });
      if (!res.ok) return json(422, { error: res.error, at: res.at });
      s.doc = res.doc;
      s.version += 1;
      return json(200, { generation: generation(s) });
    }
    if (method === "POST" && url.endsWith("/rebuild")) {
      return json(200, { fileVersion: s.version, docVersion: s.version, rebuilt: true });
    }
    if (method === "GET") return json(200, { generation: generation(s) });
    return json(404, { error: "yo'q" });
  };
  return s;
}

function generation(s: Server) {
  return {
    id: GEN_ID,
    type: "resume",
    status: "COMPLETED",
    doc: s.doc,
    docVersion: s.version,
    fileVersion: 1,
    imageRedraws: 0,
    hasFile: true,
    hasPrev: false,
  };
}

afterEach(() => cleanup());

function pause(ms: number) {
  return act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

function ops(call: Call | undefined): ResumeOp[] {
  return (call?.body?.ops ?? []) as ResumeOp[];
}

/** Sahifa taqlidi — `ResultView` kabi (`onEditState` → `EditActions`). */
function Page({ doc, gen }: { doc: AcademicDoc; gen: unknown }) {
  const [st, setSt] = useState<EditActionsState | null>(null);
  return h("div", null, h(EditActions, { state: st }), h(ResumeViewer, { doc, gen, onEditState: setSt }));
}

/** Ko'ruvchini ochadi va TAHRIR rejimini yoqadi. */
function openEditor(s: Server) {
  render(h(Page, { doc: s.doc, gen: generation(s) }));
  const btn = screen.getByText("Tahrirlash");
  fireEvent.click(btn);
  return btn;
}

/** Birinchi varaqdagi `data-path` elementi. */
function byPath(path: string): HTMLElement {
  const el = document.querySelector(`[data-resume-editor] [data-path="${path}"]`);
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

/* ══════════════════════════════ tahrir oqimi ══════════════════════════════ */

test("dblclick → Enter: bitta saqlanmagan o'zgarish, tarmoqqa chiqilmaydi", async () => {
  const s = stubServer();
  openEditor(s);
  typeInto(byPath("identity.fullName"), "Yangi Ism");
  await pause(0);

  assert.equal(s.calls.length, 0, "«Saqlash» bosilmasdan server chaqirildi");
  const btn = saveBtn();
  assert.ok(btn, "«Saqlash» tugmasi chiqmadi");
  assert.match(btn!.textContent ?? "", /1/);
  assert.ok(screen.getByText("Yangi Ism"), "ekranda yangi matn yo'q");
});

test("Esc tahrirni bekor qiladi — matn ham, navbat ham o'zgarmaydi", async () => {
  const s = stubServer();
  openEditor(s);
  const el = byPath("identity.headline");
  const before = el.textContent;
  fireEvent.dblClick(el);
  el.textContent = "Boshqa lavozim";
  fireEvent.keyDown(el, { key: "Escape" });
  await pause(0);

  assert.equal(el.textContent, before, "Esc dan keyin matn qaytmadi");
  assert.equal(saveBtn(), null, "Esc navbatga operatsiya qo'shdi");
});

test("o'zgarmagan matn operatsiya YARATMAYDI (bo'sh PATCH bo'lmasin)", async () => {
  const s = stubServer();
  openEditor(s);
  const el = byPath("summary");
  fireEvent.dblClick(el);
  fireEvent.keyDown(el, { key: "Enter" });
  await pause(0);
  assert.equal(saveBtn(), null);
});

test("`ai` band ekranda nishonlanadi va uni o'chirish `bulletRemove` beradi", async () => {
  const s = stubServer();
  openEditor(s);
  assert.ok(document.querySelector("[data-resume-ai]"), "AI nishoni chizilmadi");

  const before = s.doc.resume!.experience[0].bullets.length;
  const btns = screen.getAllByLabelText("Bandni o‘chirish");
  fireEvent.click(btns[0]);
  await pause(0);

  const btn = saveBtn();
  assert.ok(btn, "band o'chirilmadi");
  fireEvent.click(btn!);
  await pause(10);
  assert.deepEqual(ops(s.patches[0])[0], { op: "bulletRemove", row: 0, index: 0 });
  assert.equal(s.doc.resume!.experience[0].bullets.length, before - 1);
});

test("Ctrl+Z tahrirni qaytaradi va navbat o'sadi (teskari op ham navbatda)", async () => {
  const s = stubServer();
  openEditor(s);
  typeInto(byPath("identity.fullName"), "Birinchi");
  await pause(0);
  assert.match(saveBtn()!.textContent ?? "", /1/);

  await act(async () => {
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
  });
  assert.ok(screen.getByText("Karimova Dilnoza"), "Ctrl+Z asl matnni qaytarmadi");
  assert.match(saveBtn()!.textContent ?? "", /2/, "teskari op navbatga tushmadi");
});

test("shablon almashsa `template` opi ketadi va maket o'zgaradi", async () => {
  const s = stubServer();
  openEditor(s);
  assert.ok(document.querySelector('[data-resume-zone="aside"]'), "modern da panel bo'lishi kerak");

  const select = screen.getByLabelText("Shablon") as HTMLSelectElement;
  await act(async () => {
    fireEvent.change(select, { target: { value: "classic" } });
  });

  assert.equal(document.querySelector('[data-resume-zone="aside"]'), null, "classic da panel qolib ketdi");
  assert.ok(document.querySelector('[data-resume-zone="header"]'), "classic da bosh qism yo'q");

  const btn = saveBtn();
  assert.ok(btn);
  fireEvent.click(btn!);
  await pause(10);
  assert.deepEqual(ops(s.patches[0])[0], { op: "template", template: "classic" });
  assert.equal(s.doc.resume!.template, "classic");
});

test("palitra almashsa `palette` opi ketadi", async () => {
  const s = stubServer();
  openEditor(s);
  const select = screen.getByLabelText("Rang") as HTMLSelectElement;
  await act(async () => {
    fireEvent.change(select, { target: { value: "ocean" } });
  });
  fireEvent.click(saveBtn()!);
  await pause(10);
  assert.deepEqual(ops(s.patches[0])[0], { op: "palette", palette: "ocean" });
});

test("«Saqlash» — yig'ilgan oplar BITTA PATCH da, keyin rebuild", async () => {
  const s = stubServer();
  openEditor(s);
  typeInto(byPath("identity.fullName"), "Ism Bir");
  typeInto(byPath("identity.headline"), "Lavozim Bir");
  await pause(0);
  assert.equal(s.calls.length, 0);

  fireEvent.click(saveBtn()!);
  await pause(20);

  assert.equal(s.patches.length, 1, "har op uchun alohida PATCH ketdi");
  const sent = ops(s.patches[0]);
  assert.equal(sent.length, 2);
  assert.equal(s.patches[0].body?.baseVersion, 1, "`baseVersion` yuborilmadi");
  assert.equal(s.doc.resume!.identity.fullName, "Ism Bir");
  assert.equal(s.doc.meta.author, "Ism Bir", "`meta` sinxronlanmadi");
  assert.ok(
    s.calls.some((c) => c.method === "POST" && c.url.endsWith("/rebuild")),
    "saqlashdan keyin DOCX qayta yasalmadi",
  );
  assert.equal(saveBtn(), null, "saqlashdan keyin navbat tozalanmadi");
});

test("409 — navbat tashlanadi va hujjat serverdan qayta yuklanadi", async () => {
  const s = stubServer();
  openEditor(s);
  typeInto(byPath("identity.fullName"), "Ism Ikki");
  await pause(0);

  s.failNext = "version";
  fireEvent.click(saveBtn()!);
  await pause(20);

  assert.equal(s.patches.length, 1);
  assert.ok(
    s.calls.some((c) => c.method === "GET"),
    "409 dan keyin hujjat qayta yuklanmadi",
  );
  assert.equal(saveBtn(), null, "409 dan keyin navbat tozalanmadi");
  assert.ok(screen.getByText("Karimova Dilnoza"), "ekran serverdagi holatga qaytmadi");
});

test("tahrir rejimi o'chirilganda `data-path` nishonlari yo'qoladi", async () => {
  const s = stubServer();
  const btn = openEditor(s);
  assert.ok(document.querySelector("[data-resume-editor] [data-path]"));
  await act(async () => {
    fireEvent.click(btn);
  });
  assert.equal(document.querySelector("[data-resume-editor]"), null, "tahrir qatlami qoldi");
  assert.equal(document.querySelector("[data-path]"), null, "tahrir nishonlari qoldi");
});

test("ko'nikma qo'shish/olib tashlash BUTUN ro'yxatni yuboradi", async () => {
  const s = stubServer();
  openEditor(s);
  const before = s.doc.resume!.skills.map((x) => x.text);

  fireEvent.click(screen.getByLabelText("Ko‘nikma qo‘shish"));
  await pause(0);
  fireEvent.click(saveBtn()!);
  await pause(20);

  const sent = ops(s.patches[0])[0] as Extract<ResumeOp, { op: "list" }>;
  assert.equal(sent.op, "list");
  assert.equal(sent.items.length, before.length + 1);
  assert.equal(s.doc.resume!.skills.length, before.length + 1);
});
