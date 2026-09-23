import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h, act } from "react";
import { render, cleanup } from "@testing-library/react";
import { useSlideEdit, type SlideEdit } from "../../components/files/useSlideEdit.ts";
import { sameJson, useDocEdit } from "../../components/files/useDocEdit.ts";
import { applyDocOps, type DocOp } from "../../lib/generation/slide-edit.ts";
import type { AcademicDoc } from "../../lib/generation/types.ts";
import type { SlideModel } from "../../lib/generation/slide-types.ts";

/**
 * C21 / FE-03 (W2-E) — «Saqlash» hech qachon saqlanmagan tahrirni JIM
 * yo'qotmaydi.
 *
 * Server taqlidi haqiqiy chegarani qo'llaydi: bitta PATCH da 50 tadan
 * ortiq op → 400 (`preParseOps`). Ilgari klient butun navbatni bitta
 * PATCH bilan yuborardi va HAR QANDAY xatoda navbatni tashlab, hujjatni
 * serverdan qayta yuklardi: 51 tahrir yoki bitta 503 — hammasi yo'qolardi.
 *
 * MUTATSIYALAR (tasdiqlangan — natija hisobotda):
 *   1. bo'laklash olib tashlandi (butun navbat bitta PATCH) → «51 op»;
 *   2. xato turini ajratish olib tashlandi (har xatoda navbat tashlanadi)
 *      → «503 da navbat saqlanadi»;
 *   3. `reload` muvaffaqiyatini tekshirish olib tashlandi → «409 + GET
 *      yiqildi».
 */

const GEN_ID = "gen-save";

function makeSlides(n: number): SlideModel[] {
  return Array.from({ length: n }, (_, i) =>
    i === 0
      ? ({ id: "s0", layout: "title", title: "Muqova", subtitle: "Izoh" } as SlideModel)
      : ({ id: `s${i}`, layout: "bullets", title: `Slayd ${i}`, bullets: ["Bir"] } as SlideModel),
  );
}

function makeDoc(n = 4): AcademicDoc {
  return {
    meta: { topic: "Mavzu", author: "A", workLabel: "Taqdimot", language: "uz", speakerNotes: true },
    titlePage: false,
    toc: false,
    sections: [],
    slides: makeSlides(n),
  } as unknown as AcademicDoc;
}

type Call = { url: string; method: string; body: Record<string, unknown> | null };
type Server = {
  calls: Call[];
  patches: Call[];
  doc: AcademicDoc;
  version: number;
  /** Keyingi N ta PATCH shu status bilan yiqiladi. */
  patchFail: { status: number; times: number; code?: string } | null;
  /** GET yiqilsinmi (qayta yuklash ham ishlamaydigan holat). */
  getFails: boolean;
  /** Tana shundan ko'p op bo'lsa 413 (hajm chegarasi taqlidi). */
  maxOpsBeforeTooLarge: number;
  /** PATCH javobini to'xtatib turish (saqlash davomida yangi tahrir). */
  hold: Promise<void> | null;
  /** Keyingi PATCH serverda QO'LLANADI, lekin javob yo'qoladi (mobil aloqa uzildi). */
  loseNext: boolean;
};

function stubServer(init: AcademicDoc = makeDoc()): Server {
  const s: Server = {
    calls: [],
    patches: [],
    doc: init,
    version: 1,
    patchFail: null,
    getFails: false,
    maxOpsBeforeTooLarge: Infinity,
    hold: null,
    loseNext: false,
  };
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
      if (s.hold) await s.hold;
      const ops = (body?.ops ?? []) as DocOp[];
      // Server envelope darvozasi (`lib/server/edit-adapters.ts preParseOps`).
      if (ops.length > 50) return json(400, { error: "Bir so'rovda 50 tadan ortiq operatsiya bo'lmaydi" });
      if (ops.length > s.maxOpsBeforeTooLarge) return json(413, { error: "So'rov hajmi juda katta" });
      if (s.patchFail && s.patchFail.times > 0) {
        s.patchFail.times--;
        const { status, code } = s.patchFail;
        return json(status, code ? { code, error: "Konflikt" } : { error: "Server javob bermadi" });
      }
      if (body?.baseVersion !== s.version) return json(409, { code: "version", error: "Konflikt" });
      const res = applyDocOps(s.doc, ops, { genId: GEN_ID });
      if (!res.ok) return json(422, { error: res.error, at: res.at });
      s.doc = res.doc;
      s.version += 1;
      if (s.loseNext) {
        s.loseNext = false;
        throw new TypeError("Failed to fetch");
      }
      return json(200, { generation: generation(s) });
    }
    if (method === "POST" && url.endsWith("/rebuild")) {
      return json(200, { fileVersion: s.version, docVersion: s.version, rebuilt: true });
    }
    if (method === "GET") {
      if (s.getFails) return json(503, { error: "Server javob bermadi" });
      return json(200, { generation: generation(s) });
    }
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
    hasPrev: false,
  };
}

afterEach(() => cleanup());

let hook: SlideEdit | null = null;
function Harness({ gen }: { gen: unknown }) {
  hook = useSlideEdit({ gen, savedFlashMs: 10 });
  return h("span", null, String(hook.pending));
}

const titleOp = (index: number, value: string): DocOp => ({ op: "text", index, src: { f: "title" }, value });

/** `n` ta alohida tahrir (har biri alohida undo qadami va navbatdagi op). */
async function edits(n: number, index = 1) {
  for (let i = 0; i < n; i++) {
    await act(async () => {
      hook!.run([titleOp(index, `Tahrir ${i + 1}`)]);
    });
  }
}

test("51 tahrir — navbat ≤50 lik bo'laklarda ketadi, hammasi serverga yetadi (FE-03)", async () => {
  const s = stubServer();
  render(h(Harness, { gen: generation(s) }));
  await edits(51);
  assert.equal(hook!.pending, 51);
  await act(async () => {
    await hook!.save();
  });
  assert.ok(s.patches.length >= 2, `bir nechta PATCH (bor: ${s.patches.length})`);
  for (const p of s.patches) {
    assert.ok(((p.body?.ops as unknown[]) ?? []).length <= 50, "har PATCH ≤50 op");
  }
  // Har keyingi bo'lak oldingisining javobidagi versiya bilan ketadi.
  assert.equal(s.patches[1].body?.baseVersion, 2);
  assert.equal(s.doc.slides?.[1].title, "Tahrir 51", "51-tahrir serverda");
  assert.equal(hook!.pending, 0);
  assert.equal(hook!.error, null);
  assert.equal(s.calls.filter((c) => c.url.endsWith("/rebuild")).length, 1, "bitta rebuild oxirida");
});

test("503 — navbat SAQLANADI, tahrir ekranda qoladi, undo ishlaydi, xabar «Saqlanmadi»; qayta «Saqlash» yetkazadi", async () => {
  const s = stubServer();
  render(h(Harness, { gen: generation(s) }));
  await edits(1);
  s.patchFail = { status: 503, times: 1 };
  await act(async () => {
    await hook!.save();
  });
  assert.equal(hook!.pending, 1, "navbat tashlanmadi");
  assert.equal(hook!.doc?.slides?.[1].title, "Tahrir 1", "tahrir ekranda");
  assert.equal(hook!.canUndo, true, "undo steki saqlanadi");
  assert.match(hook!.error ?? "", /Saqlanmadi/);
  assert.equal(s.calls.filter((c) => c.method === "GET").length, 0, "vaqtinchalik xatoda qayta yuklanmaydi");
  await act(async () => {
    await hook!.save();
  });
  assert.equal(hook!.pending, 0, "qayta urinish yetkazdi");
  assert.equal(s.doc.slides?.[1].title, "Tahrir 1");
});

test("tarmoq uzildi (PATCH ham, GET ham) — navbat qoladi, sahifadan chiqish ogohlantiriladi", async () => {
  const s = stubServer();
  render(h(Harness, { gen: generation(s) }));
  await edits(2);
  const realFetch = globalThis.fetch;
  (globalThis as unknown as { fetch: unknown }).fetch = async () => {
    throw new TypeError("Failed to fetch");
  };
  await act(async () => {
    await hook!.save();
  });
  (globalThis as unknown as { fetch: unknown }).fetch = realFetch;
  assert.equal(hook!.pending, 2);
  const ev = new window.Event("beforeunload", { cancelable: true });
  window.dispatchEvent(ev);
  assert.equal(ev.defaultPrevented, true, "beforeunload qurollangan");
});

test("60 tahrir: 1-bo'lak o'tdi, 2-bo'lak 503 — faqat yuborilmaganlar navbatda, ekranda hammasi", async () => {
  const s = stubServer(makeDoc(4));
  render(h(Harness, { gen: generation(s) }));
  await edits(50, 1);
  await edits(10, 2);
  assert.equal(hook!.pending, 60);
  // Birinchi PATCH o'tadi, ikkinchisi yiqiladi.
  let n = 0;
  const base = globalThis.fetch;
  (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown, opts?: RequestInit) => {
    if ((opts?.method ?? "GET") === "PATCH" && ++n === 2) {
      return new Response(JSON.stringify({ error: "Server javob bermadi" }), { status: 502 });
    }
    return base(input as string, opts);
  };
  await act(async () => {
    await hook!.save();
  });
  (globalThis as unknown as { fetch: unknown }).fetch = base;
  assert.equal(hook!.pending, 10, "50 tasi saqlandi, 10 tasi navbatda");
  assert.equal(s.doc.slides?.[1].title, "Tahrir 50", "1-bo'lak serverda");
  assert.equal(hook!.doc?.slides?.[2].title, "Tahrir 10", "saqlanmagan 2-bo'lak ekranda qoladi");
  await act(async () => {
    await hook!.save();
  });
  assert.equal(hook!.pending, 0);
  assert.equal(s.doc.slides?.[2].title, "Tahrir 10");
});

test("409 + qayta yuklash ham yiqildi — navbat TASHLANMAYDI (ekran va navbat mos qoladi)", async () => {
  const s = stubServer();
  render(h(Harness, { gen: generation(s) }));
  await edits(1);
  s.patchFail = { status: 409, times: 1, code: "version" };
  s.getFails = true;
  await act(async () => {
    await hook!.save();
  });
  assert.equal(hook!.pending, 1, "qayta yuklanmagan hujjat ustida tahrir hali saqlanmagan deb ko'rsatiladi");
  assert.ok(hook!.error);
});

test("409 + qayta yuklash o'tdi — navbat tashlanadi, lekin JIM emas: nechta o'zgarish qo'llanmagani aytiladi", async () => {
  const s = stubServer();
  render(h(Harness, { gen: generation(s) }));
  await edits(3);
  s.patchFail = { status: 409, times: 1, code: "version" };
  await act(async () => {
    await hook!.save();
  });
  assert.equal(hook!.pending, 0);
  assert.equal(hook!.doc?.slides?.[1].title, "Slayd 1", "server hujjati");
  assert.match(hook!.error ?? "", /3 ta/, "yo'qolgan o'zgarishlar soni aytiladi");
});

test("413 — bo'lak kichraytirilib qayta yuboriladi", async () => {
  const s = stubServer();
  s.maxOpsBeforeTooLarge = 20;
  render(h(Harness, { gen: generation(s) }));
  await edits(30);
  await act(async () => {
    await hook!.save();
  });
  assert.equal(hook!.pending, 0);
  assert.equal(s.doc.slides?.[1].title, "Tahrir 30");
});

test("saqlash davomida kiritilgan tahrir yo'qolmaydi (ekranda ham, navbatda ham)", async () => {
  const s = stubServer();
  render(h(Harness, { gen: generation(s) }));
  await edits(1, 1);
  let release!: () => void;
  s.hold = new Promise((r) => (release = r));
  let saving!: Promise<unknown>;
  await act(async () => {
    saving = hook!.save();
  });
  await act(async () => {
    hook!.run([titleOp(2, "Saqlash paytida")]);
  });
  s.hold = null;
  release();
  await act(async () => {
    await saving;
  });
  assert.equal(hook!.pending, 1, "yangi tahrir navbatda");
  assert.equal(hook!.doc?.slides?.[2].title, "Saqlash paytida", "yangi tahrir ekranda");
  assert.equal(hook!.doc?.slides?.[1].title, "Tahrir 1");
});

test("`save` barqaror — o'ram `apply` ni har renderda yangi funksiya qilib bersa ham (render halqasi yo'q)", async () => {
  // `useResumeEdit` `apply: (doc, ops, ctx) => …` ni inline beradi. `save`
  // unga bog'lansa ko'ruvchining `onEditState` effekti har renderda yangi
  // obyekt yuborib, «Maximum update depth exceeded» halqasiga tushardi.
  const s = stubServer();
  const seen: unknown[] = [];
  function Inline({ gen, tick }: { gen: unknown; tick: number }) {
    const ed = useDocEdit<DocOp>({
      gen,
      tools: ["slide"],
      hasModel: () => true,
      apply: (doc, ops, ctx) => applyDocOps(doc, ops, ctx),
      inverse: () => [],
    });
    seen.push(ed.save);
    return h("span", null, String(tick));
  }
  const gen = generation(s);
  const r = render(h(Inline, { gen, tick: 0 }));
  r.rerender(h(Inline, { gen, tick: 1 }));
  r.rerender(h(Inline, { gen, tick: 2 }));
  assert.ok(seen.length >= 3);
  assert.ok(seen.every((f) => f === seen[0]), "`save` har renderda o'sha funksiya");
});

test("saqlash yiqilsa server tahriri (rasm yuklash) ishga tushmaydi", async () => {
  const s = stubServer();
  render(h(Harness, { gen: generation(s) }));
  await edits(1);
  s.patchFail = { status: 503, times: 1 };
  let called = false;
  await act(async () => {
    await hook!.serverEdit(async () => {
      called = true;
      throw new Error("chaqirilmasligi kerak");
    });
  });
  assert.equal(called, false);
  assert.equal(hook!.pending, 1);
});

// ─────────────── javob yo'qoldi → qayta «Saqlash» → 409 (review R1)

const LOST_WORDS = /qo‘llanmadi|qaytadan kiriting/;

test("sameJson: `jsonb` kalit tartibini o'zgartirsa ham teng, qiymat farqi — teng emas", () => {
  assert.equal(sameJson({ a: 1, b: [{ x: 1, y: "2" }] }, { b: [{ y: "2", x: 1 }], a: 1 }), true);
  assert.equal(sameJson({ a: 1, b: undefined }, { a: 1 }), true);
  assert.equal(sameJson({ a: [1, 2] }, { a: [2, 1] }), false);
  assert.equal(sameJson({ a: 1 }, { a: "1" }), false);
});

test("javob yo'qoldi (≤50 op): qayta saqlashdagi 409 — tahrir serverda ekani aniqlanadi, «qaytadan kiriting» YO'Q", async () => {
  const s = stubServer();
  render(h(Harness, { gen: generation(s) }));
  await edits(3);
  s.loseNext = true;
  await act(async () => {
    await hook!.save();
  });
  assert.equal(hook!.pending, 3, "javob kelmadi — klient bilmaydi, navbat qoladi");
  assert.equal(s.doc.slides?.[1].title, "Tahrir 3", "server aslida qo'llagan");
  await act(async () => {
    await hook!.save();
  });
  assert.equal(hook!.pending, 0);
  assert.ok(!LOST_WORDS.test(hook!.error ?? ""), `yolg'on xabar: ${hook!.error}`);
  assert.equal(hook!.error, null, "yetgani ANIQLANDI — ogohlantirish ham kerak emas");
  assert.equal(hook!.canUndo, true, "tahrir tarixi saqlanadi");
  assert.equal(hook!.doc?.slides?.[1].title, "Tahrir 3");
  assert.equal(s.version, 2, "ikki marta qo'llanmadi");
});

test("javob yo'qoldi (>50 op): yuborilmagan bo'lak TASHLANMAYDI — qayta saqlash uni ham yetkazadi", async () => {
  const s = stubServer(makeDoc(4));
  render(h(Harness, { gen: generation(s) }));
  await edits(50, 1);
  await edits(10, 2);
  s.loseNext = true;
  await act(async () => {
    await hook!.save();
  });
  assert.equal(hook!.pending, 60);
  await act(async () => {
    await hook!.save();
  });
  assert.equal(hook!.pending, 0, "ikkinchi bo'lak ham yetkazildi");
  assert.equal(s.doc.slides?.[2].title, "Tahrir 10");
  assert.equal(s.doc.slides?.[1].title, "Tahrir 50");
  assert.ok(!LOST_WORDS.test(hook!.error ?? ""));
});

test("javob yo'qoldi, keyin hujjat boshqa joyda ham o'zgardi — halol xabar, qolgan bo'lak navbatda qoladi", async () => {
  const s = stubServer(makeDoc(4));
  render(h(Harness, { gen: generation(s) }));
  await edits(50, 1);
  await edits(10, 2);
  s.loseNext = true;
  await act(async () => {
    await hook!.save();
  });
  // Boshqa yorliqdan tahrir: versiya yana oshdi, 3-slayd sarlavhasi boshqa.
  const other = applyDocOps(s.doc, [titleOp(3, "Boshqa yorliq")], { genId: GEN_ID });
  assert.ok(other.ok);
  s.doc = other.doc;
  s.version += 1;
  await act(async () => {
    await hook!.save();
  });
  assert.ok(!LOST_WORDS.test(hook!.error ?? ""), `yolg'on xabar: ${hook!.error}`);
  assert.match(hook!.error ?? "", /saqlangan bo‘lishi mumkin/);
  assert.equal(hook!.pending, 10, "yuborilmagan 10 ta o'zgarish navbatda (tashlanmadi)");
  assert.equal(hook!.doc?.slides?.[2].title, "Tahrir 10", "ular ekranda ham");
  assert.equal(hook!.doc?.slides?.[3].title, "Boshqa yorliq", "server holati olindi");
});
