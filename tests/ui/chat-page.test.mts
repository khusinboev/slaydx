import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { ChatPage } from "../../components/chat/ChatPage.tsx";

/**
 * AI chat page (`/uz/chat`, owner request 8): history load, «Bugun tekin: N/10», sending (with a stable client id on retry),
 * the proposal card (price, Tasdiqlash / Bekor qilish -> the token goes to /api/chat/confirm), an adjust card without
 * buttons, a 402 with a top-up link, and the off state.
 *
 * Mutations (restored): the confirm POST dropping the token -> «Tasdiqlash posts the card's token and hash»;
 * the retry minting a new client id -> «a failed send is retried with the same client id»;
 * the free line not read from the status -> «Bugun tekin».
 */

const realFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const status = (over: Record<string, unknown> = {}) => ({ enabled: true, freeLimit: 10, freeUsed: 3, freeLeft: 7, pricePerMessage: 100, balance: 5000, ...over });
type Call = { url: string; method: string; body: Record<string, unknown> | null };

function stub(handlers: { get?: () => Response; post?: Record<string, (body: Record<string, unknown>, n: number) => Response> }) {
  const calls: Call[] = [];
  const counts: Record<string, number> = {};
  globalThis.fetch = (async (input: unknown, init: RequestInit = {}) => {
    const url = String(input);
    const method = (init.method ?? "GET").toUpperCase();
    const body = typeof init.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    calls.push({ url, method, body });
    if (method === "GET") return handlers.get ? handlers.get() : json(200, { status: status(), messages: [] });
    counts[url] = (counts[url] ?? 0) + 1;
    const fn = handlers.post?.[url];
    return fn ? fn(body ?? {}, counts[url]!) : json(404, { error: "yo'q" });
  }) as typeof fetch;
  return calls;
}

const q = (sel: string) => document.querySelector(sel) as HTMLElement;
const qa = (sel: string) => [...document.querySelectorAll(sel)] as HTMLElement[];
const input = () => q("[data-chat-input]") as HTMLTextAreaElement;
const type = (v: string) => fireEvent.change(input(), { target: { value: v } });
const submit = () => fireEvent.submit(q("[data-chat-form]"));

const CARD = {
  kind: "confirm" as const,
  proposalId: "9",
  tool: "slide",
  toolTitle: "Slayd",
  params: [
    { label: "Mavzu", value: "Suv" },
    { label: "Slaydlar soni", value: "10" },
  ],
  price: 3000,
  token: "T".repeat(43),
  hash: "abcdef0123456789",
  expiresAt: new Date(Date.now() + 600_000).toISOString(),
  state: "open" as const,
};
const reply = (card: unknown = null, over: Record<string, unknown> = {}) => ({
  reply: { id: "r1", role: "assistant", content: "Mana taklif:", createdAt: new Date().toISOString(), card },
  charged: 0,
  status: status({ freeLeft: 6, freeUsed: 4 }),
  ...over,
});

test("loads the history and shows «Bugun tekin: N/10»", async () => {
  stub({
    get: () =>
      json(200, {
        status: status(),
        messages: [
          { id: "1", role: "user", content: "Salom", createdAt: new Date().toISOString() },
          { id: "2", role: "assistant", content: "Assalomu alaykum!", createdAt: new Date().toISOString() },
        ],
      }),
  });
  render(h(ChatPage));
  await waitFor(() => assert.equal(qa("[data-chat-msg]").length, 2));
  assert.equal(q("[data-chat-free]").textContent, "Bugun tekin: 7/10");
  assert.equal(qa("[data-chat-msg=user]")[0]!.textContent, "Salom");
  assert.ok(!q("[data-chat-price]"), "no price line while free messages remain");
});

test("an empty chat offers suggestions; tapping one fills the box", async () => {
  stub({});
  render(h(ChatPage));
  await waitFor(() => assert.ok(q("[data-chat-empty]")));
  fireEvent.click(qa("[data-chat-suggestion]")[0]!);
  assert.equal(input().value, "Slayd narxi qancha?");
});

test("sending posts text + a client id, shows the reply and the new free count", async () => {
  const calls = stub({ post: { "/api/chat": () => json(200, reply()) } });
  render(h(ChatPage));
  await waitFor(() => assert.ok(q("[data-chat-input]")));
  type("Slayd narxi qancha?");
  submit();
  await waitFor(() => assert.equal(qa("[data-chat-msg=assistant]").length, 1));
  const post = calls.find((c) => c.method === "POST")!;
  assert.equal(post.url, "/api/chat");
  assert.equal(post.body!.text, "Slayd narxi qancha?");
  assert.match(String(post.body!.clientId), /^[A-Za-z0-9_-]{8,64}$/);
  assert.equal(q("[data-chat-free]").textContent, "Bugun tekin: 6/10");
  assert.equal(input().value, "", "the box is cleared");
  assert.equal(qa("[data-chat-msg=user]").length, 1);
});

test("Enter sends, Shift+Enter does not; an empty box sends nothing", async () => {
  const calls = stub({ post: { "/api/chat": () => json(200, reply()) } });
  render(h(ChatPage));
  await waitFor(() => assert.ok(q("[data-chat-input]")));
  assert.equal((q("[data-chat-send]") as HTMLButtonElement).disabled, true);
  type("salom");
  fireEvent.keyDown(input(), { key: "Enter", shiftKey: true });
  assert.equal(calls.filter((c) => c.method === "POST").length, 0);
  fireEvent.keyDown(input(), { key: "Enter" });
  await waitFor(() => assert.equal(calls.filter((c) => c.method === "POST").length, 1));
});

test("a failed send is retried with the SAME client id (a lost response cannot charge twice)", async () => {
  const ids: string[] = [];
  stub({
    post: {
      "/api/chat": (body, n) => {
        ids.push(String(body.clientId));
        return n === 1 ? json(503, { error: "AI hozir javob bermadi." }) : json(200, reply());
      },
    },
  });
  render(h(ChatPage));
  await waitFor(() => assert.ok(q("[data-chat-input]")));
  type("savol");
  submit();
  await waitFor(() => assert.ok(q("[data-chat-retry]")));
  assert.match(q("[data-chat-error]").textContent!, /AI hozir javob bermadi/);
  fireEvent.click(q("[data-chat-retry]"));
  await waitFor(() => assert.equal(qa("[data-chat-msg=assistant]").length, 1));
  assert.equal(ids.length, 2);
  assert.equal(ids[0], ids[1]);
});

test("402: the error shows a top-up link and the text stays in the box", async () => {
  stub({ post: { "/api/chat": () => json(402, { error: "Bugungi tekin xabarlar tugadi.", code: "insufficient", topUp: "/uz/wallet" }) } });
  render(h(ChatPage));
  await waitFor(() => assert.ok(q("[data-chat-input]")));
  type("yana savol");
  submit();
  await waitFor(() => assert.ok(q("[data-chat-topup]")));
  assert.equal(q("[data-chat-topup]").getAttribute("href"), "/uz/wallet");
  assert.equal(input().value, "yana savol");
});

test("when the free messages are used up the page says what the next one costs", async () => {
  stub({ get: () => json(200, { status: status({ freeLeft: 0, freeUsed: 10 }), messages: [] }) });
  render(h(ChatPage));
  await waitFor(() => assert.equal(q("[data-chat-free]").textContent, "Bugun tekin: 0/10"));
  assert.match(q("[data-chat-price]").textContent!, /100 so'm/);
});

test("proposal card: tool, params and the server price; Tasdiqlash posts the card's token and hash, then links to Ishlarim", async () => {
  const calls = stub({
    post: {
      "/api/chat": () => json(200, reply(CARD)),
      "/api/chat/confirm": () => json(202, { id: "gen-1", price: 3000, status: "QUEUED" }),
    },
  });
  render(h(ChatPage));
  await waitFor(() => assert.ok(q("[data-chat-input]")));
  type("Menga 'Suv' haqida 10 slaydli taqdimot qil");
  submit();
  await waitFor(() => assert.ok(q("[data-chat-card=confirm]")));
  assert.equal(q("[data-chat-card-title]").textContent, "Slayd");
  assert.match(q("[data-chat-card-params]").textContent!, /MavzuSuv/);
  assert.match(q("[data-chat-card-params]").textContent!, /Slaydlar soni10/);
  assert.match(q("[data-chat-card-price]").textContent!, /Narx: 3.000 so'm/);
  assert.equal(calls.filter((c) => c.url === "/api/chat/confirm").length, 0, "nothing is confirmed by itself");
  fireEvent.click(q("[data-chat-confirm]"));
  await waitFor(() => assert.ok(q("[data-chat-card-done]")));
  const post = calls.find((c) => c.url === "/api/chat/confirm")!;
  assert.deepEqual(post.body, { token: CARD.token, hash: CARD.hash });
  assert.equal(q("[data-chat-card-done] a").getAttribute("href"), "/uz/files/gen-1");
  assert.ok(!q("[data-chat-confirm]"), "the buttons are gone once started");
});

test("Bekor qilish posts the token to /api/chat/cancel and closes the card", async () => {
  const calls = stub({ post: { "/api/chat": () => json(200, reply(CARD)), "/api/chat/cancel": () => json(200, { ok: true }) } });
  render(h(ChatPage));
  await waitFor(() => assert.ok(q("[data-chat-input]")));
  type("taqdimot");
  submit();
  await waitFor(() => assert.ok(q("[data-chat-cancel]")));
  fireEvent.click(q("[data-chat-cancel]"));
  await waitFor(() => assert.ok(!q("[data-chat-confirm]")));
  assert.deepEqual(calls.find((c) => c.url === "/api/chat/cancel")!.body, { token: CARD.token });
  assert.equal(calls.filter((c) => c.url === "/api/chat/confirm").length, 0);
});

test("confirm refused with 402 shows the amounts and a top-up link; the card stays open for a retry", async () => {
  stub({
    post: {
      "/api/chat": () => json(200, reply(CARD)),
      "/api/chat/confirm": () => json(402, { error: "Balans yetarli emas. Kerak: 3 000 so'm, mavjud: 1 000 so'm.", code: "insufficient", topUp: "/uz/wallet" }),
    },
  });
  render(h(ChatPage));
  await waitFor(() => assert.ok(q("[data-chat-input]")));
  type("taqdimot");
  submit();
  await waitFor(() => assert.ok(q("[data-chat-confirm]")));
  fireEvent.click(q("[data-chat-confirm]"));
  await waitFor(() => assert.ok(q("[data-chat-card-error]")));
  assert.match(q("[data-chat-card-error]").textContent!, /Kerak: 3 000/);
  assert.equal(q("[data-chat-card-error] a").getAttribute("href"), "/uz/wallet");
  assert.ok(q("[data-chat-confirm]"), "still confirmable after topping up");
});

test("an adjust card lists the issues and has no buttons", async () => {
  const adjust = { kind: "adjust", tool: "essay", toolTitle: "Insho", params: [], issues: ["To'ldirilmagan: Insho konteksti"] };
  stub({ post: { "/api/chat": () => json(200, reply(adjust)) } });
  render(h(ChatPage));
  await waitFor(() => assert.ok(q("[data-chat-input]")));
  type("insho yoz");
  submit();
  await waitFor(() => assert.ok(q("[data-chat-card=adjust]")));
  assert.match(q("[data-chat-issues]").textContent!, /Insho konteksti/);
  assert.ok(!q("[data-chat-confirm]") && !q("[data-chat-cancel]"));
});

test("history cards: an open card can be confirmed after a reload, a used one cannot", async () => {
  const now = new Date().toISOString();
  stub({
    get: () =>
      json(200, {
        status: status(),
        messages: [
          { id: "1", role: "assistant", content: "A", createdAt: now, card: { ...CARD, state: "used", token: "" } },
          { id: "2", role: "assistant", content: "B", createdAt: now, card: { ...CARD, proposalId: "10", token: "U".repeat(43), state: "open" } },
        ],
      }),
  });
  render(h(ChatPage));
  await waitFor(() => assert.equal(qa("[data-chat-card=confirm]").length, 2));
  assert.equal(qa("[data-chat-confirm]").length, 1);
  assert.equal(qa("[data-chat-card=confirm]")[0]!.getAttribute("data-card-state"), "used");
});

test("kill switch: the composer is replaced by the off notice", async () => {
  stub({ get: () => json(200, { status: status({ enabled: false }), messages: [] }) });
  render(h(ChatPage));
  await waitFor(() => assert.ok(q("[data-chat-off]")));
  assert.ok(!q("[data-chat-input]"));
});

test("history load failure shows the error", async () => {
  stub({ get: () => json(500, { error: "Server javob bermadi." }) });
  render(h(ChatPage));
  await waitFor(() => assert.ok(q("[data-chat-error]")));
  await act(async () => {});
});
