import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { RatingCard, type RatingStatusView } from "../../components/profile/RatingCard.tsx";

/**
 * Profile card «Ilovani baholang» (docs/program-17/PLAN.md item 9).
 *
 * Mutations (each turned a test red, then restored):
 *   1. submit enabled without a star → «stars + text enable the button»;
 *   2. the live hint ignores the validator (length only) → «junk text keeps the button off»;
 *   3. `hasFinished` ignored (always rateable) → «no finished generation»;
 *   4. the rated status renders the form again → «rated: only Rahmat».
 */

const realFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});
const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
type Call = { url: string; method: string; body: Record<string, unknown> | null };
function stub(status: RatingStatusView, post?: () => Response): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: unknown, init: RequestInit = {}) => {
    const c = { url: String(input), method: (init.method ?? "GET").toUpperCase(), body: typeof init.body === "string" ? JSON.parse(init.body) : null };
    calls.push(c);
    if (c.method === "POST") return post ? post() : json(200, { stars: 5, rewardPoints: 500, credited: true });
    return json(200, status);
  }) as typeof fetch;
  return calls;
}
const q = (sel: string) => document.querySelector(sel) as HTMLElement;
const submit = () => q("[data-rating-submit]") as HTMLButtonElement;
const GOOD = "Ilova juda qulay, slaydlar tez tayyorlanadi va dizayni menga yoqdi.";
const type = (v: string) => fireEvent.change(q("[data-rating-text]"), { target: { value: v } });

test("ready card: stars + valid text enable the button; junk text keeps it off with a live hint", async () => {
  const calls = stub({ rated: false, stars: null, hasFinished: true, rewardPoints: 500 });
  render(h(RatingCard));
  await waitFor(() => assert.ok(q('[data-rating-card="ready"]')));
  assert.match(q("[data-rating-lead]").textContent!, /\+500 bonus so'm/);
  assert.equal(submit().disabled, true);
  assert.match(q("[data-rating-hint]").textContent!, /30/);

  type(GOOD);
  assert.equal(submit().disabled, true, "no star yet");
  fireEvent.click(q('[data-rating-star="4"]'));
  assert.equal(q('[data-rating-star="4"]').getAttribute("aria-checked"), "true");
  assert.equal(submit().disabled, false);

  type("asdfgh qwerty zxcvbn poiuyt lkjhgf mnbvcx");
  assert.equal(submit().disabled, true, "mash keeps it off");
  assert.match(q("[data-rating-hint]").textContent!, /mazmunli/);
  assert.equal(calls.filter((c) => c.method === "POST").length, 0);

  type(GOOD);
  fireEvent.click(submit());
  await waitFor(() => assert.ok(q('[data-rating-card="rated"]')));
  assert.equal(q("[data-rating-paid]").textContent, "+500 bonus so'm");
  const post = calls.find((c) => c.method === "POST")!;
  assert.equal(post.url, "/api/ratings");
  assert.deepEqual(post.body, { stars: 4, feedback: GOOD });
});

test("no finished generation: explained, stars and text disabled", async () => {
  stub({ rated: false, stars: null, hasFinished: false, rewardPoints: 500 });
  render(h(RatingCard));
  await waitFor(() => assert.ok(q('[data-rating-card="ready"]')));
  assert.match(q("[data-rating-locked]").textContent!, /avval kamida bitta hujjat/);
  assert.equal((q("[data-rating-text]") as HTMLTextAreaElement).disabled, true);
  assert.equal((q('[data-rating-star="5"]') as HTMLButtonElement).disabled, true);
  assert.equal(submit().disabled, true);
});

test("rated: only Rahmat, no form", async () => {
  stub({ rated: true, stars: 5, hasFinished: true, rewardPoints: 500 });
  render(h(RatingCard));
  await waitFor(() => assert.ok(q('[data-rating-card="rated"]')));
  assert.match(q("[data-rating-thanks]").textContent!, /qabul qilindi/);
  assert.ok(!document.querySelector("[data-rating-text]"));
  assert.ok(!document.querySelector("[data-rating-submit]"));
});

test("server rejection shows its message; already_rated switches to Rahmat", async () => {
  stub({ rated: false, stars: null, hasFinished: true, rewardPoints: 500 }, () => json(400, { error: "Matn mazmunli ko'rinmayapti.", code: "gibberish" }));
  render(h(RatingCard));
  await waitFor(() => assert.ok(q('[data-rating-card="ready"]')));
  type(GOOD);
  fireEvent.click(q('[data-rating-star="5"]'));
  fireEvent.click(submit());
  await waitFor(() => assert.match(q("[data-rating-error]").textContent!, /mazmunli/));
  assert.ok(q('[data-rating-card="ready"]'));

  stub({ rated: false, stars: null, hasFinished: true, rewardPoints: 500 }, () => json(409, { error: "Allaqachon.", code: "already_rated" }));
  fireEvent.click(submit());
  await waitFor(() => assert.ok(q('[data-rating-card="rated"]')));
});

test("reward 0: no amount promised", async () => {
  stub({ rated: false, stars: null, hasFinished: true, rewardPoints: 0 });
  render(h(RatingCard));
  await waitFor(() => assert.ok(q('[data-rating-card="ready"]')));
  assert.ok(!/bonus so'm/.test(q("[data-rating-lead]").textContent!));
  assert.equal(submit().textContent, "Yuborish");
});
