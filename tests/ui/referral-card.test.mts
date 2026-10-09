import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ReferralCard, type ReferralSummaryView } from "../../components/profile/ReferralCard.tsx";
import { ReferralCapture } from "../../components/referral/ReferralCapture.tsx";

/**
 * Profile section «Do'stlarni taklif qiling» and the `/uz?ref=` capture (T3).
 *
 * Mutations (each turned a test red, then restored):
 *   1. the share button opens the bot link itself instead of t.me/share/url → «Mini App share»;
 *   2. no `execCommand` fallback → «copy fallback»;
 *   3. the kind switch ignored (always the bot link) → «Sayt switch»;
 *   4. ReferralCapture posts any `ref` value (no shape check) → «capture».
 */

const realFetch = globalThis.fetch;
const win = window as unknown as Record<string, unknown>;
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  delete win.Telegram;
  delete win.TelegramWebviewProxy;
  window.history.replaceState(null, "", "/");
});

const DATA: ReferralSummaryView = {
  code: "k7m3p9qx",
  botLink: "https://t.me/slaydx_bot?start=ref_k7m3p9qx",
  webLink: "https://slaydx.uz/uz?ref=k7m3p9qx",
  rewardPoints: 2000,
  invitedCount: 3,
  earnedPoints: 6000,
  recent: [
    { name: "Dilnoza Karimova", joinedAt: "2026-10-06T08:00:00.000Z" },
    { name: "Jasur Aliyev", joinedAt: "2026-10-05T08:00:00.000Z" },
  ],
};

const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

type Call = { url: string; method: string; body: unknown };
function stub(handler: (c: Call) => Response): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: unknown, init: RequestInit = {}) => {
    const c = { url: String(input), method: (init.method ?? "GET").toUpperCase(), body: typeof init.body === "string" ? JSON.parse(init.body) : null };
    calls.push(c);
    return handler(c);
  }) as typeof fetch;
  return calls;
}

const linkField = () => document.querySelector("[data-referral-link]") as HTMLInputElement;

async function ready(data: ReferralSummaryView = DATA) {
  const calls = stub((c) => {
    assert.equal(`${c.method} ${c.url}`, "GET /api/referral");
    return json(200, data);
  });
  const view = render(h(ReferralCard));
  await waitFor(() => assert.ok(document.querySelector('[data-referral-card="ready"]')));
  return { calls, view };
}

test("ReferralCard: loading → link, rule, counters and recent names; Sayt switch shows the web link", async () => {
  let release: (r: Response) => void = () => {};
  globalThis.fetch = (() => new Promise<Response>((r) => (release = r))) as typeof fetch;
  render(h(ReferralCard));
  assert.ok(document.querySelector('[data-referral-card="loading"]'));
  await act(async () => release(json(200, DATA)));
  await waitFor(() => assert.ok(document.querySelector('[data-referral-card="ready"]')));
  assert.ok(screen.getByRole("heading", { name: "Do'stlarni taklif qiling" }));
  assert.match(
    document.querySelector("[data-referral-rule]")!.textContent!,
    /^Har bir yangi do'st uchun 2\s000 ball\. Do'stingiz ilovaga birinchi marta kirganda hisoblanadi\.$/,
  );
  assert.equal(linkField().value, DATA.botLink);
  assert.equal(document.querySelector("[data-referral-invited]")!.textContent, "3");
  assert.equal(document.querySelector("[data-referral-earned]")!.textContent, "6 000", "NBSP groups, as in every browser");
  const items = [...document.querySelectorAll("[data-referral-recent] li")].map((li) => li.textContent);
  assert.equal(items.length, 2);
  assert.equal(items[0], "Dilnoza Karimova06.10.2026", "name + Tashkent dd.mm.yyyy");
  fireEvent.click(screen.getByRole("button", { name: "Sayt" }));
  assert.equal(linkField().value, DATA.webLink, "MUTATSIYA 3");
  assert.equal(screen.getByRole("button", { name: "Sayt" }).getAttribute("aria-pressed"), "true");
  fireEvent.click(screen.getByRole("button", { name: "Telegram bot" }));
  assert.equal(linkField().value, DATA.botLink);
});

test("ReferralCard: without a bot username → no switch, the web link; empty list text", async () => {
  await ready({ ...DATA, botLink: null, recent: [], invitedCount: 0, earnedPoints: 0 });
  assert.ok(!screen.queryByRole("group", { name: "Havola turi" }));
  assert.equal(linkField().value, DATA.webLink);
  assert.ok(document.querySelector('[data-referral-recent="empty"]'));
  assert.ok(screen.getByText(/Hali hech kim qo'shilmagan/));
});

test("ReferralCard: copy uses the Clipboard API → «Havola nusxalandi»", async () => {
  await ready();
  const written: string[] = [];
  Object.defineProperty(navigator, "clipboard", { value: { writeText: async (t: string) => void written.push(t) }, configurable: true });
  try {
    fireEvent.click(screen.getByRole("button", { name: "Nusxalash" }));
    await waitFor(() => assert.equal(document.querySelector("[data-referral-notice]")!.textContent, "Havola nusxalandi"));
    assert.deepEqual(written, [DATA.botLink]);
  } finally {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
  }
});

test("ReferralCard: copy fallback — no Clipboard API → selection + execCommand('copy'); both failing → an error with a hint", async () => {
  await ready();
  Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
  const doc = document as unknown as { execCommand?: (c: string) => boolean };
  const prev = doc.execCommand;
  const commands: string[] = [];
  doc.execCommand = (c: string) => {
    commands.push(c);
    return true;
  };
  try {
    fireEvent.click(screen.getByRole("button", { name: "Nusxalash" }));
    await waitFor(() => assert.equal(document.querySelector("[data-referral-notice]")!.getAttribute("data-referral-notice"), "ok"));
    assert.deepEqual(commands, ["copy"], "MUTATSIYA 2");
    const field = linkField();
    assert.equal(field.selectionStart, 0);
    assert.equal(field.selectionEnd, DATA.botLink!.length, "the field is selected for the copy");

    doc.execCommand = () => false;
    fireEvent.click(screen.getByRole("button", { name: "Nusxalash" }));
    await waitFor(() => assert.equal(document.querySelector("[data-referral-notice]")!.getAttribute("data-referral-notice"), "error"));
    assert.match(document.querySelector("[data-referral-notice]")!.textContent!, /qo'lda nusxalang/);
  } finally {
    doc.execCommand = prev;
  }
});

test("ReferralCard: Mini App share → openTelegramLink(t.me/share/url?url=<link>&text=…)", async () => {
  const opened: string[] = [];
  win.TelegramWebviewProxy = { postEvent() {} };
  win.Telegram = { WebApp: { initData: "user=1", version: "8.0", openTelegramLink: (u: string) => void opened.push(u) } };
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "Ulashish" }));
  assert.equal(opened.length, 1);
  const u = new URL(opened[0]!);
  assert.equal(u.origin + u.pathname, "https://t.me/share/url", "MUTATSIYA 1");
  assert.equal(u.searchParams.get("url"), DATA.botLink);
  assert.match(u.searchParams.get("text")!, /SlaydX/);
});

test("ReferralCard: browser share → navigator.share({url}), no menu", async () => {
  await ready();
  const shared: ShareData[] = [];
  Object.defineProperty(navigator, "share", { value: async (d: ShareData) => void shared.push(d), configurable: true });
  try {
    fireEvent.click(screen.getByRole("button", { name: "Ulashish" }));
    assert.equal(shared.length, 1);
    assert.equal(shared[0]!.url, DATA.botLink);
    await act(async () => {});
    assert.ok(!document.querySelector("[data-share-menu]"), "the native sheet is the whole flow");
  } finally {
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
  }
});

// T-share (docs/share/AUDIT.md #4): this used to copy silently (a 13 px notice). A desktop without Web Share now
// gets the fallback menu; the full matrix lives in tests/ui/share-everywhere.test.mts.
test("ReferralCard: without Web Share → the fallback menu, and «Havolani nusxalash» copies the link", async () => {
  await ready();
  const written: string[] = [];
  Object.defineProperty(navigator, "clipboard", { value: { writeText: async (t: string) => void written.push(t) }, configurable: true });
  try {
    fireEvent.click(screen.getByRole("button", { name: "Ulashish" }));
    await waitFor(() => assert.ok(document.querySelector("[data-share-menu]")));
    assert.deepEqual(written, [], "opening the menu copies nothing");
    fireEvent.click(screen.getByRole("button", { name: "Havolani nusxalash" }));
    await waitFor(() => assert.deepEqual(written, [DATA.botLink]));
  } finally {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
  }
});

test("ReferralCard: load error → message and a 44 px retry that reloads", async () => {
  let n = 0;
  stub(() => (++n === 1 ? json(500, { error: "x" }) : json(200, DATA)));
  render(h(ReferralCard));
  await waitFor(() => assert.ok(document.querySelector('[data-referral-card="error"]')));
  const retry = screen.getByRole("button", { name: "Qayta urinish" });
  assert.match(retry.className, /\bh-11\b/);
  fireEvent.click(retry);
  await waitFor(() => assert.ok(document.querySelector('[data-referral-card="ready"]')));
  assert.equal(n, 2);
});

test("ReferralCard: every control it adds is a 44 px target", async () => {
  await ready();
  for (const name of ["Telegram bot", "Sayt", "Nusxalash", "Ulashish"]) {
    assert.match(screen.getByRole("button", { name }).className, /\bh-11\b/, name);
  }
  assert.match(linkField().className, /\bh-11\b/);
});

test("ReferralCapture: `?ref=<code>` → one POST /api/referral/capture {code}; malformed or absent → no call", async () => {
  const calls = stub(() => json(200, { captured: true }));
  window.history.replaceState(null, "", "/uz?ref=K7M3P9QX");
  render(h(ReferralCapture));
  await waitFor(() => assert.equal(calls.length, 1));
  assert.deepEqual(calls[0], { url: "/api/referral/capture", method: "POST", body: { code: "k7m3p9qx" } });
  cleanup();

  for (const search of ["?ref=../../etc", "?ref=", "", "?foo=k7m3p9qx"]) {
    calls.length = 0;
    window.history.replaceState(null, "", `/uz${search}`);
    render(h(ReferralCapture));
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(calls.length, 0, `MUTATSIYA 4: ${search}`);
    cleanup();
  }
});

test("ReferralCapture: a failing capture is silent (no throw, nothing rendered)", async () => {
  stub(() => json(500, { error: "x" }));
  window.history.replaceState(null, "", "/uz?ref=k7m3p9qx");
  const { container } = render(h(ReferralCapture));
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(container.innerHTML, "");
});
