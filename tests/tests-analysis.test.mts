/**
 * «Test ishlash» -- the AI analysis of the wrong answers (owner 2026-10-31, migration 063): `lib/tests/analysis.ts`
 * (prompt, parser), `lib/server/test-analysis.ts` (shared cache, claim, background line) and
 * `GET /api/tests/attempts/{id}/analysis` on real Postgres (own throwaway database). The model is stubbed: either
 * the analyzer seam or Gemini's HTTP endpoint (`fetch`), never the network.
 *
 * Mutation checks (each broken on purpose, the named test failed, then restored):
 *   1. the `status = 'finished'` check dropped from `attemptAnalysis`        -> «never before finish»;
 *   2. the `user_id` condition dropped from the attempt query               -> «ownership»;
 *   3. `claim` always succeeds (the ON CONFLICT ... WHERE made `true`)       -> «concurrent requests: one model call per question»;
 *   4. the cache read skipped (every request claims a new row)              -> «cache: a second user ... no second model call»;
 *   5. the image not attached to the Gemini request                         -> «Gemini call: the image goes inline, the model comes from the slot»;
 *   6. `MAX_CONCURRENT` gate removed from `slot`                            -> «at most 3 model calls at once»;
 *   7. the image always attached (`sendsImage` -> true)                      -> «text questions (migration 064)» and «the image goes to the model only for ...»;
 *   8. the image-only fallback removed (`rowOf` returns only the own row)    -> «text questions (migration 064)» (the cached one is re-analysed);
 *   9. the fallback serving a FAILED old row (`old?.status === "ready"` dropped) -> same test (the failed one never restarts).
 */
process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.APP_URL = "https://slaydx.test";
process.env.WORKER_INLINE = "false";
process.env.GEMINI_API_KEY = "test-gemini-key-not-real";
import "./helpers/next-request.mts";
import test from "node:test";
import assert from "node:assert/strict";
import { createIsolatedDb } from "./helpers/isolated-db.mts";
import { inRequest } from "./helpers/next-request.mts";
import { mkUser, setSetting } from "./helpers/chat-fixtures.mts";

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("testsanalysis") : { isolated: false, drop: async () => {} };
const skip = hasDb && iso.isolated ? false : "alohida Postgres baza yo'q";

const pure = await import("../lib/tests/analysis.ts");

/* ───────────────────────── pure: prompt and parser ───────────────────────── */

test("parser: explanation + a reason for EVERY other option, else unusable", () => {
  const ok = pure.parseAnalysis(
    { correct: "  4 chunki 2+2=4. ", options: [{ letter: "a", why: "3 — bitta kam" }, { letter: "C", why: "5 — ortiqcha" }, { letter: "D", why: "6 — ko‘paytirish emas" }, { letter: "B", why: "ignored: the correct one" }] },
    1,
  );
  assert.deepEqual(ok, { explanation: "4 chunki 2+2=4.", wrong: { "0": "3 — bitta kam", "2": "5 — ortiqcha", "3": "6 — ko‘paytirish emas" } });
  assert.equal(pure.parseAnalysis({ correct: "x", options: [{ letter: "A", why: "a" }, { letter: "C", why: "c" }] }, 1), null, "D missing");
  assert.equal(pure.parseAnalysis({ correct: "", options: [] }, 0), null);
  assert.equal(pure.parseAnalysis(null, 0), null);
  assert.equal(pure.parseAnalysis("text", 0), null);
  const long = pure.parseAnalysis({ correct: "so‘z ".repeat(600), options: ["B", "C", "D"].map((letter) => ({ letter, why: "sabab" })) }, 0)!;
  assert.ok(long.explanation.length <= pure.ANALYSIS_TEXT_MAX + 1 && long.explanation.endsWith("…"), "clipped at a word");
});

test("prompt: names the subject, the correct letter, the text options and asks about every other option", () => {
  const u = pure.analysisUser({ subject: "Matematika", text: "2+2?", options: ["3", "4", "5", "6"], hasImage: false }, 1);
  assert.match(u, /Fan: Matematika/);
  assert.match(u, /B\) 4/);
  assert.match(u, /To‘g‘ri javob: B\./);
  assert.match(u, /\(A, C, D\)/);
  assert.match(pure.analysisUser({ subject: "Tarix", text: null, options: null, hasImage: true }, 3), /Savol rasmda berilgan/);
  assert.match(pure.ANALYSIS_SYSTEM, /o‘zbek tilida/);
});

test("prompt with text (migration 064): the text and options are in it; a figure is announced only when the image goes along; LaTeX is flagged", () => {
  const textOnly = pure.analysisUser({ subject: "Matematika", text: "Hisoblang: $\\frac{1}{4}$", options: ["0", "1", "−1", "$\\frac{1}{5}$"], hasImage: false }, 3);
  assert.match(textOnly, /Savol: Hisoblang: \$\\frac\{1\}\{4\}\$/);
  assert.match(textOnly, /D\) \$\\frac\{1\}\{5\}\$/);
  assert.match(textOnly, /LaTeX/, "formulas are flagged so the answer is plain text");
  assert.ok(!/rasm/i.test(textOnly), "no image: the prompt does not mention one");
  const figure = pure.analysisUser({ subject: "Matematika", text: "Jadvalda berilgan.", options: ["1", "2", "3", "4"], hasImage: true }, 0);
  assert.match(figure, /Rasmda savolga tegishli chizma yoki jadval berilgan/);
  assert.match(figure, /Savol: Jadvalda berilgan\./);
  assert.ok(!/Savol rasmda berilgan/.test(figure), "the question itself is the text, the image only a figure");
  assert.ok(!/LaTeX/.test(figure), "no formula, no LaTeX note");
});

test("the image goes to the model only for an image-only question or a figure", () => {
  const q = (question_text: string | null, has_figure: boolean, hasBytes = true) => pure.sendsImage({ question_text, has_figure, hasBytes });
  assert.equal(q(null, false), true, "image-only");
  assert.equal(q("matn", true), true, "text + figure");
  assert.equal(q("matn", false), false, "text only: cheaper and exact");
  assert.equal(q(null, false, false), false, "nothing to send");
});

/* ───────────────────────── service + route ───────────────────────── */

test("tests analysis: service and API", { skip }, async (t) => {
  const { query, queryOne, migrate, pool } = await import("../lib/server/db.ts");
  const { createSession, SESSION_COOKIE } = await import("../lib/server/session.ts");
  const svc = await import("../lib/server/paid-tests.ts");
  const an = await import("../lib/server/test-analysis.ts");
  const { flushAiUsage } = await import("../lib/server/ai-usage.ts");
  const { setRouteSnapshot, resetRouteSnapshot } = await import("../lib/server/providers/route-resolve.ts");
  const route = await import("../app/api/tests/attempts/[id]/analysis/route.ts");
  await migrate();
  t.after(async () => {
    an.setAnalyzer(null);
    await an.settleAnalyses();
    await pool().end();
    await iso.drop();
  });

  /* fixtures: one subject, 4 questions (one image-only), always the same 4 picked */
  const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63f8cfc0f01f00050001ff89993d1d0000000049454e44ae426082", "hex");
  const bank = (await queryOne<{ id: string }>("INSERT INTO test_banks (slug, title) VALUES ('bmb', 'Tayyor testlar') RETURNING id::text AS id"))!.id;
  const asset = (await queryOne<{ id: string }>("INSERT INTO test_assets (sha256, mime, size_bytes, bytes) VALUES ($1, 'image/png', $2, $3) RETURNING id::text AS id", ["cd".repeat(32), PNG.length, PNG]))!.id;
  const sid = (await queryOne<{ id: string }>("INSERT INTO test_subjects (bank_id, code, name, sort) VALUES ($1, 'math', 'Matematika', 0) RETURNING id::text AS id", [bank]))!.id;
  const QIDS: number[] = [];
  for (let k = 0; k < 4; k++) {
    const img = k === 0;
    const r = await queryOne<{ id: string }>(
      `INSERT INTO test_questions (subject_id, variant, question_text, image_asset_id, options, answer, legacy_ref)
       VALUES ($1, 1, $2, $3, $4::jsonb, $5, $6) RETURNING id::text AS id`,
      [sid, img ? null : `savol ${k}`, img ? asset : null, img ? null : JSON.stringify(["a", "b", "c", "d"]), k % 4, `an:${k}`],
    );
    QIDS.push(Number(r!.id));
  }
  await setSetting(query, "tests.enabled", true);
  await setSetting(query, "tests.questions_per_subject", 4);
  const keyOf = async (qid: number) => (await queryOne<{ answer: number }>("SELECT answer FROM test_questions WHERE id = $1", [qid]))!.answer;

  const login = async () => {
    const uid = await mkUser(query, { points: 50_000 });
    const { token } = await createSession(uid);
    return { uid, cookie: `${SESSION_COOKIE}=${token}` };
  };
  async function get(cookie: string | null, id: string, qs = "") {
    const headers: Record<string, string> = {};
    if (cookie) headers.cookie = cookie;
    const req = new Request(`http://localhost/api/tests/attempts/${id}/analysis${qs}`, { method: "GET", headers });
    const res = await inRequest(req, () => (route.GET as unknown as (r: Request, c: unknown) => Promise<Response>)(req, { params: Promise.resolve({ id }) }));
    return { status: res.status, body: (await res.json()) as Record<string, unknown> & { items?: import("../lib/server/test-analysis.ts").AnalysisItem[]; done?: boolean } };
  }
  /**
   * A finished attempt over the 4 questions: question 0 (image) answered wrong, question 1 right, question 2 wrong,
   * question 3 unanswered. Returns the attempt id.
   */
  async function finishedAttempt(uid: string): Promise<string> {
    const a = await svc.startAttempt(uid, { mode: "subject", subjectCode: "math" });
    for (const [i, how] of (["wrong", "right", "wrong", "skip"] as const).entries()) {
      if (how === "skip") continue;
      const key = await keyOf(QIDS[i]!);
      assert.equal((await svc.answerQuestion(uid, a.attemptId, QIDS[i]!, how === "right" ? key : (key + 1) % 4)).ok, true);
    }
    assert.ok(await svc.finishAttempt(uid, a.attemptId));
    return a.attemptId;
  }
  const clearCache = () => query("DELETE FROM test_analyses");

  type Input = import("../lib/server/test-analysis.ts").AnalyzeInput;
  let calls: Input[] = [];
  const answer = (input: Input) => ({
    explanation: `Q${input.stem.text ?? "img"}: ${"ABCD"[input.correct]} to‘g‘ri`,
    wrong: Object.fromEntries([0, 1, 2, 3].filter((i) => i !== input.correct).map((i) => [String(i), `${"ABCD"[i]} xato`])),
    model: "stub-model",
  });
  const okAnalyzer = async (input: Input) => {
    calls.push(input);
    return answer(input);
  };
  t.beforeEach(() => {
    calls = [];
    an.setAnalyzer(okAnalyzer);
  });

  await t.test("never before finish: 409 with nothing about the key, no row, no model call", async () => {
    await clearCache();
    const u = await login();
    const a = await svc.startAttempt(u.uid, { mode: "subject", subjectCode: "math" });
    await svc.answerQuestion(u.uid, a.attemptId, QIDS[0]!, 0);
    const r = await get(u.cookie, a.attemptId);
    assert.equal(r.status, 409);
    assert.equal(r.body.code, "not_finished");
    assert.deepEqual(Object.keys(r.body).sort(), ["code", "error"], "no items, no letters");
    await an.settleAnalyses();
    assert.equal(calls.length, 0);
    assert.equal(Number((await queryOne<{ n: string }>("SELECT count(*) n FROM test_analyses"))!.n), 0);
    await svc.finishAttempt(u.uid, a.attemptId);
  });

  await t.test("ownership: a foreign, unknown or malformed attempt is a 404; no session is a 401", async () => {
    const owner = await login();
    const thief = await login();
    const id = await finishedAttempt(owner.uid);
    await an.settleAnalyses();
    calls = [];
    const r = await get(thief.cookie, id);
    assert.equal(r.status, 404);
    assert.ok(!("items" in r.body));
    for (const bad of ["00000000-0000-4000-8000-000000000000", "not-a-uuid"]) assert.equal((await get(owner.cookie, bad)).status, 404);
    assert.equal((await get(null, id)).status, 401);
    assert.equal(calls.length, 0);
  });

  await t.test("first request returns at once with «pending», the model runs in the background, then «ready»", async () => {
    await clearCache();
    const u = await login();
    const id = await finishedAttempt(u.uid);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    an.setAnalyzer(async (input) => {
      calls.push(input);
      await gate;
      return answer(input);
    });
    const first = await get(u.cookie, id).finally(() => setTimeout(release, 0));
    assert.equal(first.status, 200);
    assert.deepEqual(first.body.items!.map((i) => [i.questionId, i.status]).sort(), [[QIDS[0], "pending"], [QIDS[2], "pending"], [QIDS[3], "pending"]].sort(), "only the wrong and unanswered questions");
    const order = (await queryOne<{ q: number[] }>("SELECT question_ids AS q FROM test_attempts WHERE id = $1", [id]))!.q;
    assert.deepEqual(first.body.items!.map((i) => i.position), first.body.items!.map((i) => order.indexOf(i.questionId) + 1), "positions follow the attempt's order");
    assert.equal(first.body.done, false);
    assert.ok(first.body.items!.every((i) => i.explanation === null && i.chosenWhy === null));
    await an.settleAnalyses();
    const second = await get(u.cookie, id);
    assert.equal(second.body.done, true);
    const byQ = (n: number) => second.body.items!.find((i) => i.questionId === QIDS[n])!;
    const [q1, q3, q4] = [byQ(0), byQ(2), byQ(3)];
    const k0 = await keyOf(QIDS[0]!);
    assert.equal(q1!.status, "ready");
    assert.equal(q1!.correctLetter, "ABCD"[k0]);
    assert.equal(q1!.chosenLetter, "ABCD"[(k0 + 1) % 4]);
    assert.match(q1!.explanation!, /to‘g‘ri/);
    assert.equal(q1!.chosenWhy, `${"ABCD"[(k0 + 1) % 4]} xato`, "why the user's own option is wrong");
    assert.equal(q3!.status, "ready");
    assert.equal(q4!.chosenLetter, null);
    assert.equal(q4!.chosenWhy, null, "unanswered: only the correct explanation");
    assert.ok(q4!.explanation);
    assert.equal(calls.length, 3, "one model call per wrong question");
    const img = calls.find((c) => c.image)!;
    assert.ok(img.image!.bytes.equals(PNG) && img.image!.mime === "image/png", "the image question hands the bytes to the model");
    assert.equal(img.stem.hasImage, true);
  });

  await t.test("cache: a second user with the same wrong questions -> no second model call", async () => {
    const u = await login();
    const id = await finishedAttempt(u.uid);
    const r = await get(u.cookie, id);
    await an.settleAnalyses();
    assert.equal(calls.length, 0);
    assert.ok(r.body.items!.every((i) => i.status === "ready"));
    assert.equal(r.body.done, true);
    // Repeated polling of the same attempt: still nothing.
    await get(u.cookie, id);
    await an.settleAnalyses();
    assert.equal(calls.length, 0);
  });

  await t.test("concurrent requests: one model call per question", async () => {
    await clearCache();
    const users = await Promise.all([login(), login(), login()]);
    const ids = await Promise.all(users.map((u) => finishedAttempt(u.uid)));
    an.setAnalyzer(async (input) => {
      calls.push(input);
      await new Promise((r) => setTimeout(r, 30));
      return answer(input);
    });
    const all = await Promise.all(users.flatMap((u, i) => [get(u.cookie, ids[i]!), get(u.cookie, ids[i]!)]));
    assert.ok(all.every((r) => r.status === 200));
    await an.settleAnalyses();
    assert.equal(calls.length, 3, "6 parallel requests over the same 3 questions = 3 calls");
    const rows = await query<{ tries: number; status: string }>("SELECT tries, status FROM test_analyses");
    assert.deepEqual(rows.map((r) => [r.tries, r.status]), [[1, "ready"], [1, "ready"], [1, "ready"]]);
  });

  await t.test("a different key is a different analysis (a corrected key never reuses the old text)", async () => {
    const before = Number((await queryOne<{ n: string }>("SELECT count(*) n FROM test_analyses"))!.n);
    await query("UPDATE test_questions SET answer = (answer + 2) % 4 WHERE id = $1", [QIDS[2]]);
    const u = await login();
    const id = await finishedAttempt(u.uid);
    await get(u.cookie, id);
    await an.settleAnalyses();
    assert.equal(calls.length, 1, "only the question whose key changed");
    assert.equal(calls[0]!.correct, await keyOf(QIDS[2]!));
    assert.equal(Number((await queryOne<{ n: string }>("SELECT count(*) n FROM test_analyses"))!.n), before + 1);
    await query("UPDATE test_questions SET answer = (answer + 2) % 4 WHERE id = $1", [QIDS[2]]);
  });

  await t.test("failure: «failed», never breaks the view; retry only on request and after the cool-down", async () => {
    await clearCache();
    const u = await login();
    const id = await finishedAttempt(u.uid);
    an.setAnalyzer(async (input) => {
      calls.push(input);
      throw new Error("Gemini 503: overloaded");
    });
    await get(u.cookie, id);
    await an.settleAnalyses();
    assert.equal(calls.length, 3);
    const failed = await get(u.cookie, id);
    assert.equal(failed.status, 200);
    assert.ok(failed.body.items!.every((i) => i.status === "failed" && i.explanation === null));
    assert.equal(failed.body.done, true, "nothing pending: the page stops polling");
    const err = (await queryOne<{ error: string }>("SELECT error FROM test_analyses LIMIT 1"))!.error;
    assert.match(err, /503/);
    await an.settleAnalyses();
    assert.equal(calls.length, 3, "a plain poll does not retry");

    an.setAnalyzer(okAnalyzer);
    calls = [];
    await get(u.cookie, id, "?retry=1");
    await an.settleAnalyses();
    assert.equal(calls.length, 0, "inside the cool-down a retry is refused");
    await query("UPDATE test_analyses SET updated_at = now() - interval '1 minute'");
    const again = await get(u.cookie, id, "?retry=1");
    assert.ok(again.body.items!.every((i) => i.status !== "failed"), "the retry restarted them (pending, or already ready)");
    await an.settleAnalyses();
    assert.equal(calls.length, 3);
    assert.ok((await get(u.cookie, id)).body.items!.every((i) => i.status === "ready"));
    assert.deepEqual((await query<{ tries: number }>("SELECT tries FROM test_analyses")).map((r) => r.tries), [2, 2, 2]);
  });

  await t.test("a pending row of a crashed process is taken over after its lease", async () => {
    await clearCache();
    const u = await login();
    const id = await finishedAttempt(u.uid);
    // Another process claimed all three and died.
    const keys = await query<{ q: string }>("SELECT unnest($1::bigint[])::text AS q", [[QIDS[0], QIDS[2], QIDS[3]]]);
    an.setAnalyzer(async () => {
      throw new Error("not reached");
    });
    await get(u.cookie, id); // creates the pending rows through the real claim, the job fails...
    await an.settleAnalyses();
    await query("UPDATE test_analyses SET status = 'pending', lease_until = now() + interval '1 minute'");
    an.setAnalyzer(okAnalyzer);
    calls = [];
    const live = await get(u.cookie, id);
    await an.settleAnalyses();
    assert.equal(calls.length, 0, "a live lease is respected");
    assert.ok(live.body.items!.every((i) => i.status === "pending"));
    await query("UPDATE test_analyses SET lease_until = now() - interval '1 second'");
    await get(u.cookie, id);
    await an.settleAnalyses();
    assert.equal(calls.length, keys.length);
    assert.ok((await get(u.cookie, id)).body.items!.every((i) => i.status === "ready"));
  });

  await t.test("at most 3 model calls at once", async () => {
    await clearCache();
    // 3 users x 3 wrong questions, but only 3 distinct questions -> make 9 distinct keys by moving the key around.
    let now = 0;
    let peak = 0;
    an.setAnalyzer(async (input) => {
      calls.push(input);
      now++;
      peak = Math.max(peak, now);
      await new Promise((r) => setTimeout(r, 200));
      now--;
      return answer(input);
    });
    for (let shift = 0; shift < 3; shift++) {
      await query("UPDATE test_questions SET answer = (answer + 1) % 4");
      const u = await login();
      await get(u.cookie, await finishedAttempt(u.uid));
    }
    await an.settleAnalyses();
    assert.ok(calls.length >= 6, `${calls.length} calls`);
    assert.ok(peak <= an.MAX_CONCURRENT, `peak ${peak}`);
    assert.equal(peak, 3, "the line is actually used");
    await query("UPDATE test_questions SET answer = (answer + 1) % 4"); // 4 shifts = back to the original keys
  });

  await t.test("Gemini call: the image goes inline, the model comes from the slot, spend lands in ai_usage", async () => {
    await clearCache();
    an.setAnalyzer(null);
    const realFetch = globalThis.fetch;
    const sent: { url: string; body: Record<string, unknown>; key: string | null }[] = [];
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      sent.push({ url: String(url), body, key: new Headers(init?.headers).get("x-goog-api-key") });
      const text = String(((body.contents as { parts: { text?: string }[] }[])[0]!.parts[0]!.text));
      const correct = "ABCD".indexOf(/To‘g‘ri javob: ([A-D])/.exec(text)![1]!);
      const out = { correct: "Sabab shu.", options: [0, 1, 2, 3].filter((i) => i !== correct).map((i) => ({ letter: "ABCD"[i], why: `${"ABCD"[i]} emas` })) };
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "o‘ylash", thought: true }, { text: JSON.stringify(out) }] } }], usageMetadata: { promptTokenCount: 1500, candidatesTokenCount: 300, thoughtsTokenCount: 700 } }), { status: 200 });
    }) as typeof fetch;
    try {
      const u = await login();
      const id = await finishedAttempt(u.uid);
      await get(u.cookie, id);
      await an.settleAnalyses();
      await flushAiUsage();
      assert.equal(sent.length, 3);
      assert.ok(sent.every((s) => s.url === "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro:generateContent"), "the default slot model");
      assert.ok(sent.every((s) => s.key === "test-gemini-key-not-real"));
      const withImage = sent.filter((s) => JSON.stringify(s.body).includes("inlineData"));
      assert.equal(withImage.length, 1, "only the image question carries an image");
      const part = (withImage[0]!.body.contents as { parts: { inlineData?: { mimeType: string; data: string } }[] }[])[0]!.parts.find((p) => p.inlineData)!;
      assert.deepEqual(part.inlineData, { mimeType: "image/png", data: PNG.toString("base64") }, "the question image is sent inline");
      const cfg = sent[0]!.body.generationConfig as Record<string, unknown>;
      assert.equal(cfg.responseMimeType, "application/json");
      assert.ok(cfg.responseSchema);
      const ready = await get(u.cookie, id);
      assert.ok(ready.body.items!.every((i) => i.status === "ready" && i.explanation === "Sabab shu."), "thought parts are dropped");
      const rows = await query<{ tool_id: string; source: string; calls: number; input_tokens: string; output_tokens: string; usd: string; user_id: string }>(
        "SELECT tool_id, source, calls, input_tokens::text, output_tokens::text, usd::text, user_id::text FROM ai_usage WHERE tool_id = 'tests:analysis' AND user_id = $1",
        [u.uid],
      );
      assert.equal(rows.length, 3, "one spend row per model call");
      for (const r of rows) {
        assert.deepEqual([r.source, r.calls, r.input_tokens, r.output_tokens], ["free", 1, "1500", "1000"], "thinking tokens are billed as output");
        assert.equal(Number(r.usd), 0.015, "1500 x $2/M + 1000 x $12/M");
      }
      assert.equal((await queryOne<{ model: string }>("SELECT DISTINCT model FROM test_analyses"))!.model, "gemini-3.1-pro");

      // The admin switches the slot: the next analysis uses that model.
      await clearCache();
      sent.length = 0;
      setRouteSnapshot(new Map([["tests.analysis", [{ provider: "gemini", model: "gemini-3.7-flash" }]]]));
      const v = await login();
      await get(v.cookie, await finishedAttempt(v.uid));
      await an.settleAnalyses();
      assert.ok(sent.length === 3 && sent.every((s) => s.url.includes("/models/gemini-3.7-flash:generateContent")), "the model comes from the routing slot");
      resetRouteSnapshot();

      // A provider error is a failed (retryable) row, the page still answers.
      await clearCache();
      globalThis.fetch = (async () => new Response(JSON.stringify({ error: { message: "quota" } }), { status: 429 })) as typeof fetch;
      const w = await login();
      const wid = await finishedAttempt(w.uid);
      await get(w.cookie, wid);
      await an.settleAnalyses();
      const f = await get(w.cookie, wid);
      assert.equal(f.status, 200);
      assert.ok(f.body.items!.every((i) => i.status === "failed"));
      assert.match((await queryOne<{ error: string }>("SELECT error FROM test_analyses LIMIT 1"))!.error, /Gemini 429: quota/);
    } finally {
      globalThis.fetch = realFetch;
      an.setAnalyzer(okAnalyzer);
    }
  });

  await t.test("text questions (migration 064): the model gets the text and no image unless there is a figure; image-only rows stay valid", async () => {
    await clearCache();
    // A second subject: four questions that all have BOTH text and the image.
    const tid = (await queryOne<{ id: string }>("INSERT INTO test_subjects (bank_id, code, name, sort) VALUES ($1, 'tarix', 'Tarix', 1) RETURNING id::text AS id", [bank]))!.id;
    const mk = async (k: string, text: string, figure: boolean) =>
      Number((await queryOne<{ id: string }>(
        `INSERT INTO test_questions (subject_id, variant, question_text, image_asset_id, options, answer, has_figure, legacy_ref)
         VALUES ($1, 1, $2, $3, $4::jsonb, 1, $5, $6) RETURNING id::text AS id`,
        [tid, text, asset, JSON.stringify([`${k}-a`, `${k}-b`, `${k}-c`, `${k}-d`]), figure, `an:t:${k}`],
      ))!.id);
    const plain = await mk("plain", "Matnli savol", false);
    const figure = await mk("figure", "Jadvalli savol", true);
    const cached = await mk("cached", "Eski tahlili bor savol", false);
    const failed = await mk("failed", "Eski tahlili xato savol", false);
    const SHA = "cd".repeat(32);
    const optionsOf = (k: string) => [`${k}-a`, `${k}-b`, `${k}-c`, `${k}-d`];
    // Rows written while the questions were image-only: keyed by the image hash alone.
    const oldHash = an.stemHash(SHA, null, null);
    const wrongJson = JSON.stringify({ "0": "a xato", "2": "c xato", "3": "d xato" });
    await query(
      `INSERT INTO test_analyses (question_id, correct, stem_hash, status, explanation, wrong, model) VALUES ($1, 1, $2, 'ready', 'ESKI TAHLIL', $3::jsonb, 'eski-model')`,
      [cached, oldHash, wrongJson],
    );
    await query(`INSERT INTO test_analyses (question_id, correct, stem_hash, status, error) VALUES ($1, 1, $2, 'failed', 'eski xato')`, [failed, oldHash]);

    const u = await login();
    const a = await svc.startAttempt(u.uid, { mode: "subject", subjectCode: "tarix" });
    for (const qid of [plain, figure, cached, failed]) assert.equal((await svc.answerQuestion(u.uid, a.attemptId, qid, 0)).ok, true);
    assert.ok(await svc.finishAttempt(u.uid, a.attemptId));

    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    an.setAnalyzer(async (input) => {
      calls.push(input);
      await gate;
      return answer(input);
    });
    const first = await get(u.cookie, a.attemptId).finally(() => setTimeout(release, 0));
    const status = (r: typeof first, qid: number) => r.body.items!.find((i) => i.questionId === qid)!;
    assert.equal(status(first, cached).status, "ready", "the image-only row is served at once");
    assert.equal(status(first, cached).explanation, "ESKI TAHLIL");
    assert.equal(status(first, cached).chosenWhy, "a xato");
    assert.equal(status(first, failed).status, "pending", "an old FAILED row is not served: a new analysis starts");
    await an.settleAnalyses();
    assert.deepEqual(calls.map((c) => c.stem.text).sort(), ["Eski tahlili xato savol", "Jadvalli savol", "Matnli savol"], "no model call for the cached one");

    const byText = (text: string) => calls.find((c) => c.stem.text === text)!;
    const p = byText("Matnli savol");
    assert.equal(p.image, null, "text without a figure: no image bytes");
    assert.equal(p.stem.hasImage, false);
    assert.deepEqual(p.stem.options, optionsOf("plain"));
    const f = byText("Jadvalli savol");
    assert.ok(f.image!.bytes.equals(PNG) && f.image!.mime === "image/png", "a figure keeps the image");
    assert.equal(f.stem.hasImage, true);
    assert.deepEqual(f.stem.options, optionsOf("figure"));
    assert.equal(byText("Eski tahlili xato savol").image, null);

    // Every one of them is ready now; the cached question was never re-analysed.
    const second = await get(u.cookie, a.attemptId);
    assert.equal(second.body.done, true);
    assert.ok(second.body.items!.every((i) => i.status === "ready"));
    assert.equal(status(second, cached).explanation, "ESKI TAHLIL");
    assert.equal(Number((await queryOne<{ n: string }>("SELECT count(*) n FROM test_analyses WHERE question_id = $1", [cached]))!.n), 1, "still one row for the cached question");

    // An analysis under the NEW hash (text + options) wins over the old image-only one.
    await query(
      `INSERT INTO test_analyses (question_id, correct, stem_hash, status, explanation, wrong, model) VALUES ($1, 1, $2, 'ready', 'YANGI TAHLIL', $3::jsonb, 'yangi-model')`,
      [cached, an.stemHash(SHA, "Eski tahlili bor savol", optionsOf("cached")), wrongJson],
    );
    assert.equal(status(await get(u.cookie, a.attemptId), cached).explanation, "YANGI TAHLIL");

    // The Gemini request: text and options in the prompt; the image part only for the figure.
    const sent: { parts: { text?: string; inlineData?: unknown }[] }[] = [];
    const stub = (async (_url: string | URL, init?: RequestInit) => {
      sent.push((JSON.parse(String(init?.body)) as { contents: typeof sent }).contents[0]!);
      const out = { correct: "Sabab.", options: [0, 2, 3].map((i) => ({ letter: "ABCD"[i], why: "xato" })) };
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(out) }] } }] }), { status: 200 });
    }) as typeof fetch;
    await an.analyzeWithGemini(p, stub);
    await an.analyzeWithGemini(f, stub);
    assert.match(sent[0]!.parts[0]!.text!, /Savol: Matnli savol\nA\) plain-a\nB\) plain-b\nC\) plain-c\nD\) plain-d/);
    assert.equal(sent[0]!.parts.length, 1, "text only: no inlineData part");
    assert.match(sent[1]!.parts[0]!.text!, /Savol: Jadvalli savol/);
    assert.match(sent[1]!.parts[0]!.text!, /chizma yoki jadval/);
    assert.ok(sent[1]!.parts[1]!.inlineData, "the figure rides along inline");
  });

  await t.test("an all-correct attempt has nothing to analyse", async () => {
    const u = await login();
    const a = await svc.startAttempt(u.uid, { mode: "subject", subjectCode: "math" });
    for (const qid of QIDS) await svc.answerQuestion(u.uid, a.attemptId, qid, await keyOf(qid));
    await svc.finishAttempt(u.uid, a.attemptId);
    const r = await get(u.cookie, a.attemptId);
    assert.deepEqual([r.status, r.body.items, r.body.done], [200, [], true]);
    await an.settleAnalyses();
    assert.equal(calls.length, 0);
  });
});
