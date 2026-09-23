import test from "node:test";
import assert from "node:assert/strict";

/**
 * C07 (CONC-08, SCALE-04): `GET …/file` dagi qayta yasash (`ensureFreshFile`).
 *
 * Bir xil eskirgan hujjatga N ta parallel yuklab olish — BITTA render
 * (jarayon ichida single-flight), va render foydalanuvchi bo'yicha
 * chegaralanadi (limit faqat haqiqatan render kerak bo'lganda sarflanadi).
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";

const { ensureFreshFileShared } = await import("../lib/server/fresh-file.ts");
const { ApiError } = await import("../lib/server/api.ts");

const GEN = "a1b2c3d4-0000-4000-8000-0000000000f1";

function world(opts: { docVersion: number; fileVersion: number; status?: string; renderMs?: number; toolId?: string }) {
  const state = { ...opts, status: opts.status ?? "COMPLETED", toolId: opts.toolId ?? "slide" };
  let inFlight = 0;
  let maxInFlight = 0;
  let renders = 0;
  let charged = 0;
  const deps = {
    versions: async () => ({ docVersion: state.docVersion, fileVersion: state.fileVersion, status: state.status, toolId: state.toolId }),
    ensure: async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      renders += 1;
      await new Promise((r) => setTimeout(r, opts.renderMs ?? 60));
      state.fileVersion = state.docVersion;
      inFlight -= 1;
    },
    limitFn: async () => {
      charged += 1;
    },
  };
  return { deps, state, stats: () => ({ renders, maxInFlight, charged }) };
}

test("5 ta parallel yuklab olish — bitta render, limit bir marta", async () => {
  const w = world({ docVersion: 3, fileVersion: 2 });
  await Promise.all(Array.from({ length: 5 }, () => ensureFreshFileShared(GEN, "u1", w.deps)));
  assert.deepEqual(w.stats(), { renders: 1, maxInFlight: 1, charged: 1 });
});

test("fayl yangi / tayyor emas — render ham, limit ham yo'q", async () => {
  const fresh = world({ docVersion: 2, fileVersion: 2 });
  await ensureFreshFileShared(GEN, "u1", fresh.deps);
  assert.deepEqual(fresh.stats(), { renders: 0, maxInFlight: 0, charged: 0 });
  const running = world({ docVersion: 3, fileVersion: 2, status: "IN_PROGRESS" });
  await ensureFreshFileShared(GEN, "u1", running.deps);
  assert.deepEqual(running.stats(), { renders: 0, maxInFlight: 0, charged: 0 });
  // Tahrirlanmaydigan vosita (adapter yo'q) — `ensureFreshFile` ham hech narsa qilmaydi, token yonmasin.
  const noAdapter = world({ docVersion: 3, fileVersion: 2, toolId: "image" });
  await ensureFreshFileShared(GEN, "u1", noAdapter.deps);
  assert.deepEqual(noAdapter.stats(), { renders: 0, maxInFlight: 0, charged: 0 });
});

test("limit tugagan — 429, render bo'lmaydi; kutayotganlar ham 429 oladi", async () => {
  const w = world({ docVersion: 3, fileVersion: 2 });
  let renders = 0;
  const deps = {
    ...w.deps,
    ensure: async () => {
      renders += 1;
    },
    limitFn: async () => {
      await new Promise((r) => setTimeout(r, 20));
      throw new ApiError("Juda ko'p so'rov", 429, { retryAfter: 60 });
    },
  };
  const results = await Promise.allSettled([1, 2, 3].map(() => ensureFreshFileShared(GEN, "u1", deps)));
  assert.equal(renders, 0);
  for (const r of results) {
    assert.equal(r.status, "rejected");
    assert.equal(((r as PromiseRejectedResult).reason as InstanceType<typeof ApiError>).status, 429);
  }
});

test("turli foydalanuvchi/hujjat — alohida render", async () => {
  const a = world({ docVersion: 3, fileVersion: 2 });
  const b = world({ docVersion: 5, fileVersion: 4 });
  await Promise.all([
    ensureFreshFileShared(GEN, "u1", a.deps),
    ensureFreshFileShared("a1b2c3d4-0000-4000-8000-0000000000f2", "u1", b.deps),
  ]);
  assert.equal(a.stats().renders, 1);
  assert.equal(b.stats().renders, 1);
});

test("render yiqilsa — xato hammaga, keyingi so'rov qayta urina oladi", async () => {
  const w = world({ docVersion: 3, fileVersion: 2 });
  let fail = true;
  const deps = {
    ...w.deps,
    ensure: async () => {
      await new Promise((r) => setTimeout(r, 20));
      if (fail) throw new Error("render yiqildi");
      w.state.fileVersion = w.state.docVersion;
    },
  };
  const results = await Promise.allSettled([1, 2].map(() => ensureFreshFileShared(GEN, "u1", deps)));
  assert.ok(results.every((r) => r.status === "rejected"));
  fail = false;
  await ensureFreshFileShared(GEN, "u1", deps);
  assert.equal(w.state.fileVersion, 3);
});
