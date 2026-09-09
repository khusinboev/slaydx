import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h, act } from "react";
import { render, fireEvent, screen, cleanup } from "@testing-library/react";
import { SlideViewer } from "../../components/viewers/SlideViewer.tsx";
import { useSlideEdit, type SlideEdit } from "../../components/files/useSlideEdit.ts";
import { applyDocOps, type DocOp } from "../../lib/generation/slide-edit.ts";
import type { AcademicDoc } from "../../lib/generation/types.ts";
import type { SlideModel } from "../../lib/generation/slide-types.ts";

/**
 * Tahrirning KLIENT OQIMI (jsdom + `fetch` stubi).
 *
 * Bu yerda tekshiriladigan narsa ekrandagi piksel emas, TARMOQ
 * xatti-harakati: tez-tez qilingan tahrirlar bitta `PATCH` ga
 * yig'iladimi, PPTX bitta marta qayta yasaladimi, 409 dan keyin klient
 * serverga bo'ysunadimi. Bularning har biri noto'g'ri bo'lsa xato
 * ekranda emas — hisobda va faylda ko'rinadi.
 *
 * `fetch` stubi serverni TAQLID qiladi: `PATCH` kelgan operatsiyalarni
 * aynan `applyDocOps` bilan qo'llaydi (server ham shuni chaqiradi),
 * shuning uchun test klient va server bir xil hujjatga kelishini ham
 * qulflaydi.
 */

const GEN_ID = "gen1";

const slides: SlideModel[] = [
  { id: "s0", layout: "title", title: "Muqova", subtitle: "Izoh" },
  { id: "s1", layout: "bullets", title: "Birinchi", bullets: ["Bir", "Ikki"] },
  { id: "s2", layout: "bullets", title: "Ikkinchi", bullets: ["Uch"] },
];

function makeDoc(list: SlideModel[] = slides): AcademicDoc {
  return {
    meta: { topic: "Mavzu", author: "Aliyev", workLabel: "Taqdimot", language: "uz", speakerNotes: true },
    titlePage: false,
    toc: false,
    sections: [],
    slides: list,
  } as unknown as AcademicDoc;
}

type Call = { url: string; method: string; body: Record<string, unknown> | null };

type Server = {
  calls: Call[];
  patches: Call[];
  doc: AcademicDoc;
  version: number;
  /** Keyingi PATCH shu kod bilan yiqiladi (409 sinovi uchun). */
  failNext: string | null;
};

/** Minimal server taqlidi — `applyDocOps` bilan haqiqiy hujjat yuritadi. */
function stubServer(init: AcademicDoc = makeDoc()): Server {
  const s: Server = { calls: [], patches: [], doc: init, version: 1, failNext: null };
  const json = (status: number, data: unknown) =>
    new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

  (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown, opts?: RequestInit) => {
    const url = String(input);
    const method = opts?.method ?? "GET";
    const body =
      typeof opts?.body === "string" ? (JSON.parse(opts.body) as Record<string, unknown>) : null;
    const call = { url, method, body };
    s.calls.push(call);

    if (method === "PATCH" && url.endsWith("/doc")) {
      s.patches.push(call);
      if (s.failNext) {
        const code = s.failNext;
        s.failNext = null;
        return json(409, { code, error: "Konflikt" });
      }
      const res = applyDocOps(s.doc, (body?.ops ?? []) as DocOp[], { genId: GEN_ID });
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
    type: "slide",
    status: "COMPLETED",
    doc: s.doc,
    docVersion: s.version,
    fileVersion: 1,
    imageRedraws: 0,
    hasFile: true,
  };
}

// Har testdan keyin DOM tozalanadi — aks holda yiqilgan testning
// qoldig'i keyingilarida «bir nechta element topildi» bo'lib chiqadi.
afterEach(() => cleanup());

function pause(ms: number) {
  return act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

function ops(call: Call | undefined): DocOp[] {
  return (call?.body?.ops ?? []) as DocOp[];
}

// ══════════════════════════════════ Ko'ruvchi orqali

/**
 * SAHNADAGI element (eskiz panelidagi emas).
 *
 * Eskizlar ham `SlideCanvas` bilan chiziladi, ya'ni `data-src` ular
 * ichida ham bor — tahrir esa faqat sahnada ishlaydi.
 */
function stageQuery(sel: string): HTMLElement {
  const host = document.querySelector("[data-slide-frame]");
  assert.ok(host, "tahrir rejimida sahna ramkasi belgilangan bo'lishi kerak");
  const el = host.querySelector(sel);
  assert.ok(el, `sahnada «${sel}» topilmadi`);
  return el as HTMLElement;
}

function openEditor(s: Server) {
  render(h(SlideViewer, { doc: s.doc, gen: generation(s) }));
  fireEvent.click(screen.getByText("Tahrirlash"));
}

test("«Tahrirlash» bosilsa maket chiplari va slayd tugmalari chiqadi", () => {
  const s = stubServer();
  openEditor(s);
  assert.ok(screen.getByText("Slayd"), "«+ Slayd» tugmasi");
  assert.ok(screen.getByText("O‘chirish"), "o'chirish tugmasi");
  // Muqova slaydidan faqat `section`/`closing` ga o'girish mumkin —
  // `canConvert` qolgan chiplarni umuman chizmaydi.
  assert.ok(screen.getByText("Bo‘lim"), "mumkin bo'lgan maket chipi");
  assert.equal(screen.queryByText("Jadval"), null, "mumkin bo'lmagan maket chipi chiqmasligi kerak");
  cleanup();
});

test("uchta tez operatsiya — BITTA PATCH (400 ms koalessiya)", async () => {
  const s = stubServer();
  openEditor(s);
  const add = screen.getByText("Slayd");
  fireEvent.click(add);
  fireEvent.click(add);
  fireEvent.click(add);
  assert.equal(s.patches.length, 0, "koalessiya oynasida hali so'rov ketmasligi kerak");
  await pause(600);
  assert.equal(s.patches.length, 1, "uchala op bitta so'rovda ketishi kerak");
  assert.equal(ops(s.patches[0]).length, 3);
  assert.equal(s.doc.slides?.length, 6, "server ham uchta slayd qo'shgan bo'lishi kerak");
  cleanup();
});

test("Ctrl+Z teskari operatsiyani yuboradi", async () => {
  const s = stubServer();
  openEditor(s);
  fireEvent.click(screen.getByText("Slayd"));
  await pause(600);
  assert.deepEqual(ops(s.patches[0]), [{ op: "add", after: 0 }]);

  fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
  await pause(600);
  assert.equal(s.patches.length, 2);
  assert.deepEqual(ops(s.patches[1]), [{ op: "delete", index: 1 }]);
  assert.equal(s.doc.slides?.length, 3, "bekor qilingandan keyin deka asl holatida");
  cleanup();
});

test("textarea fokusda Ctrl+Z ko'ruvchiga TEGMAYDI", async () => {
  const s = stubServer();
  openEditor(s);
  // Bandli slaydga o'tamiz (muqovada ro'yxat yo'q).
  fireEvent.click(document.querySelectorAll("[data-thumb-index]")[1]);
  fireEvent.click(screen.getByText("Slayd"));
  await pause(600);
  const before = s.patches.length;

  // Matn maydonini ochamiz va aynan unda Ctrl+Z bosamiz — bu brauzerning
  // o'z bekor qilishi, deka o'zgarmasligi kerak.
  fireEvent.click(document.querySelectorAll("[data-thumb-index]")[1]);
  const target = stageQuery("li[data-src]");
  assert.ok(target, "tahrir rejimida bandlarda data-src bo'ladi");
  fireEvent.doubleClick(target);
  const ta = screen.getByLabelText("Matnni tahrirlash");
  fireEvent.keyDown(ta, { key: "z", ctrlKey: true });
  await pause(600);
  assert.equal(s.patches.length, before, "matn yozayotganda deka bekor qilinmasligi kerak");
  cleanup();
});

test("sahnada ikki bosish → matn serverga yetib boradi", async () => {
  const s = stubServer();
  openEditor(s);
  fireEvent.click(document.querySelectorAll("[data-thumb-index]")[1]);
  fireEvent.doubleClick(stageQuery("li[data-src]"));
  const ta = screen.getByLabelText("Matnni tahrirlash");
  fireEvent.change(ta, { target: { value: "Tuzatilgan band" } });
  fireEvent.keyDown(ta, { key: "Enter" });
  await pause(600);
  assert.deepEqual(ops(s.patches[0]), [
    { op: "text", index: 1, src: { f: "bullets", i: 0 }, value: "Tuzatilgan band" },
  ]);
  assert.equal(s.doc.slides?.[1].bullets?.[0], "Tuzatilgan band", "server hujjatida ham o'zgargan");
  cleanup();
});

test("eskizni sudrash → to'g'ri `reorder` tartibi", async () => {
  const s = stubServer();
  openEditor(s);
  const thumbs = document.querySelectorAll("[data-thumb-index]");
  assert.equal(thumbs.length, 3);
  fireEvent.dragStart(thumbs[0]);
  fireEvent.drop(thumbs[1]);
  await pause(600);
  assert.deepEqual(ops(s.patches[0]), [{ op: "reorder", order: [1, 0, 2] }]);
  assert.equal(s.doc.slides?.[0].title, "Birinchi", "birinchi o'ringa ikkinchi slayd chiqadi");
  cleanup();
});

test("o'chirish IKKI bosishda, bitta slaydli dekada tugma o'chiq", async () => {
  const s = stubServer();
  openEditor(s);
  const btn = screen.getByText("O‘chirish");
  fireEvent.click(btn);
  await pause(500);
  assert.equal(s.patches.length, 0, "birinchi bosish faqat tasdiq so'raydi");
  fireEvent.click(screen.getByText("Rostdan?"));
  await pause(600);
  assert.deepEqual(ops(s.patches[0]), [{ op: "delete", index: 0 }]);
  cleanup();

  const one = stubServer(makeDoc([slides[1]]));
  openEditor(one);
  const only = screen.getByText("O‘chirish").closest("button") as HTMLButtonElement;
  assert.equal(only.disabled, true, "oxirgi slaydni o'chirib bo'lmaydi");
  cleanup();
});

test("izoh maydoni `notes` operatsiyasini beradi", async () => {
  const s = stubServer();
  openEditor(s);
  const notes = screen.getByLabelText("Ma’ruzachi izohi") as HTMLTextAreaElement;
  fireEvent.change(notes, { target: { value: "Bu yerda sekin gapiraman" } });
  fireEvent.blur(notes);
  await pause(600);
  assert.deepEqual(ops(s.patches[0]), [{ op: "notes", index: 0, value: "Bu yerda sekin gapiraman" }]);
  cleanup();
});

// ══════════════════════════════════ Hook (qisqartirilgan taymerlar bilan)

let hook: SlideEdit | null = null;

function Harness({ gen, rebuildMs }: { gen: unknown; rebuildMs: number }) {
  hook = useSlideEdit({ gen, coalesceMs: 10, rebuildMs });
  return h("span", null, hook.canUndo ? "undo-bor" : "undo-yo‘q");
}

test("PPTX bitta marta qayta yasaladi (debounce)", async () => {
  const s = stubServer();
  render(h(Harness, { gen: generation(s), rebuildMs: 60 }));
  await act(async () => {
    hook!.run([{ op: "add", after: 0 }]);
  });
  await act(async () => {
    hook!.run([{ op: "add", after: 0 }]);
  });
  await pause(300);
  const rebuilds = s.calls.filter((c) => c.url.endsWith("/rebuild"));
  assert.equal(rebuilds.length, 1, "har PATCH emas, oxirgisidan keyin BITTA rebuild");
  cleanup();
});

test("409 → hujjat serverdan qayta yuklanadi, steklar bo'shaydi", async () => {
  const s = stubServer();
  render(h(Harness, { gen: generation(s), rebuildMs: 60 }));
  await act(async () => {
    hook!.run([{ op: "text", index: 1, src: { f: "title" }, value: "Mahalliy sarlavha" }]);
  });
  assert.equal(hook!.canUndo, true, "operatsiyadan keyin undo bo'lishi kerak");
  s.failNext = "version";
  await pause(200);

  assert.equal(hook!.canUndo, false, "409 dan keyin stek tozalanadi");
  assert.equal(hook!.canRedo, false);
  assert.ok(
    s.calls.some((c) => c.method === "GET"),
    "409 dan keyin hujjat qayta yuklanishi kerak",
  );
  assert.equal(
    hook!.doc?.slides?.[1].title,
    "Birinchi",
    "server rad etgan tahrir ekranda ham qolmasligi kerak",
  );
  assert.ok(hook!.error, "foydalanuvchiga xabar berilishi kerak");
  cleanup();
});

test("ensureFresh navbatni bo'shatadi va faylni yangilaydi", async () => {
  const s = stubServer();
  render(h(Harness, { gen: generation(s), rebuildMs: 100000 }));
  await act(async () => {
    hook!.run([{ op: "add", after: 0 }]);
  });
  await act(async () => {
    await hook!.ensureFresh();
  });
  assert.equal(s.patches.length, 1, "kutayotgan operatsiya darhol yuborilishi kerak");
  assert.equal(
    s.calls.filter((c) => c.url.endsWith("/rebuild")).length,
    1,
    "debounce kutilmaydi — fayl darhol yangilanadi",
  );
  assert.equal(hook!.stale, false);
  cleanup();
});

test("bitta so'rov uchayotganda ikkinchisi navbatda kutadi", async () => {
  const s = stubServer();
  render(h(Harness, { gen: generation(s), rebuildMs: 100000 }));
  await act(async () => {
    hook!.run([{ op: "add", after: 0 }]);
    hook!.run([{ op: "add", after: 0 }]);
  });
  await pause(200);
  // Ikkalasi bitta oynaga tushdi — bitta so'rov, ikkita op.
  assert.equal(s.patches.length, 1);
  assert.equal(ops(s.patches[0]).length, 2);
  // Har bir PATCH oldingi javobdagi versiyani ishlatadi (409 bo'lmasin).
  assert.equal(s.patches[0].body?.baseVersion, 1);
  cleanup();
});
