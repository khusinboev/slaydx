import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ToolChrome } from "../../components/forms/ToolChrome.tsx";
import { useAppStore } from "../../lib/store.ts";
import { useChannelGate, gateFromError } from "../../lib/channel-gate.ts";
import { useUi } from "../../lib/ui.ts";
import * as api from "../../lib/api-client.ts";

/**
 * Mandatory channels card on tool pages (docs/bonus/BONUS3.md C-Q2/C-Q3): checked on page load
 * (`GET /api/channels/required`), set by the 403 of `createGeneration`, «✅ Tekshirish» re-checks
 * with `fresh=1`; `telegram_required` opens the Telegram login dialog; ≥ 44 px targets; only t.me
 * links become hrefs; the form's own error line is not repeated under the card.
 *
 * Mutation checks (each made the named test fail, then restored):
 *   - the load-time `requiredChannels()` effect removed → «load: channel_required card»;
 *   - `reportGate` call removed from `createGeneration` → «submit 403 → card»;
 *   - `check()` without `fresh` → «Tekshirish: fresh re-check clears the card»;
 *   - `SAFE_JOIN` accepting any https URL → «only t.me links».
 */

const realFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  useChannelGate.setState({ gate: null });
  useUi.setState({ overlay: null });
});

const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const user = { id: "u1", telegramId: "777", name: "Ali", points: 0, quota: 0, balance: 50_000, isAdmin: false } as unknown as api.ServerUser;
const CH = [{ id: "7", title: "SlaydX rasmiy", joinUrl: "https://t.me/slaydx_rasmiy" }];

function stub(answers: Record<string, unknown>[]): string[] {
  const urls: string[] = [];
  let i = 0;
  globalThis.fetch = (async (url: string) => {
    urls.push(String(url));
    if (String(url).startsWith("/api/channels/required")) return json(200, answers[Math.min(i++, answers.length - 1)]);
    return json(404, { error: "no" });
  }) as typeof fetch;
  return urls;
}

const chrome = (error?: string | null) =>
  render(h(ToolChrome, { title: "Slayd", submitLabel: "Yaratish", onSubmit: () => {}, children: h("div", { "data-form": true }), error }));

test("load: channel_required card with a 44 px t.me button per channel and «✅ Tekshirish»", async () => {
  useAppStore.setState({ loggedIn: true, user });
  const urls = stub([{ ok: false, needsTelegram: false, channels: CH }]);
  chrome();
  const card = await waitFor(() => {
    const el = document.querySelector("[data-channel-gate=channels]");
    assert.ok(el, "the card appears before anything is submitted");
    return el;
  });
  assert.equal(urls[0], "/api/channels/required");
  assert.match(card.textContent ?? "", /Avval kanalga obuna bo‘ling/);
  const link = card.querySelector<HTMLAnchorElement>("[data-channel-link='7']")!;
  assert.equal(link.getAttribute("href"), "https://t.me/slaydx_rasmiy");
  assert.equal(link.getAttribute("target"), "_blank");
  assert.match(link.className, /min-h-11/);
  assert.match(card.querySelector("[data-channel-check]")!.className, /min-h-11/);
  // The card comes before the form.
  assert.ok(card.compareDocumentPosition(document.querySelector("[data-form]")!) & Node.DOCUMENT_POSITION_FOLLOWING);
});

test("Tekshirish: fresh re-check — still missing → note; joined → the card disappears", async () => {
  useAppStore.setState({ loggedIn: true, user });
  const urls = stub([
    { ok: false, needsTelegram: false, channels: CH },
    { ok: false, needsTelegram: false, channels: CH },
    { ok: true, needsTelegram: false, channels: [] },
  ]);
  chrome();
  const check = await screen.findByRole("button", { name: "✅ Tekshirish" });
  fireEvent.click(check);
  await screen.findByText(/Obuna hali ko‘rinmayapti/);
  fireEvent.click(screen.getByRole("button", { name: "✅ Tekshirish" }));
  await waitFor(() => assert.ok(!document.querySelector("[data-channel-gate]")));
  assert.deepEqual(urls, ["/api/channels/required", "/api/channels/required?fresh=1", "/api/channels/required?fresh=1"]);
});

test("telegram_required: «Telegram orqali kiring» opens the login dialog back to this page", async () => {
  useAppStore.setState({ loggedIn: true, user });
  stub([{ ok: false, needsTelegram: true, channels: CH }]);
  chrome();
  const btn = await screen.findByRole("button", { name: "Telegram orqali kiring" });
  assert.match(btn.className, /min-h-11/);
  assert.ok(!document.querySelector("[data-channel-link]"), "no channel buttons before Telegram");
  fireEvent.click(btn);
  assert.equal(useUi.getState().overlay, "login");
});

test("allowed / logged out: no card, no request when logged out", async () => {
  useAppStore.setState({ loggedIn: true, user });
  stub([{ ok: true, needsTelegram: false, channels: [] }]);
  chrome();
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(!document.querySelector("[data-channel-gate]"));
  cleanup();
  useAppStore.setState({ loggedIn: false, user: null });
  const urls = stub([{ ok: false, needsTelegram: false, channels: CH }]);
  chrome();
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(urls, []);
  assert.ok(!document.querySelector("[data-channel-gate]"));
});

test("submit 403 → card; the form's error line is not repeated under it", async () => {
  useAppStore.setState({ loggedIn: true, user });
  globalThis.fetch = (async (url: string) => {
    if (String(url).startsWith("/api/channels/required")) return json(200, { ok: true, needsTelegram: false, channels: [] });
    return json(403, { error: "Avval kanalga obuna bo‘ling", code: "channel_required", channels: CH });
  }) as typeof fetch;
  chrome("Avval kanalga obuna bo‘ling");
  await new Promise((r) => setTimeout(r, 20));
  await assert.rejects(api.createGeneration("essay", { topic: "Suv" }), (e: { status: number }) => e.status === 403);
  await waitFor(() => assert.ok(document.querySelector("[data-channel-gate=channels]")));
  assert.ok(!document.querySelector("[role=alert]"), "no duplicate error line while the card explains it");
});

test("only t.me links become hrefs; other codes are not a gate", () => {
  const g = gateFromError(403, {
    code: "channel_required",
    channels: [
      { id: "1", title: "A", joinUrl: "https://evil.example/x" },
      { id: "2", title: "B", joinUrl: "javascript:alert(1)" },
      { id: "3", title: "C", joinUrl: "https://t.me/+AbCdEf123456" },
    ],
  });
  assert.deepEqual(g?.channels.map((c) => c.joinUrl), [null, null, "https://t.me/+AbCdEf123456"]);
  assert.equal(gateFromError(403, { code: "forbidden" }), null);
  assert.equal(gateFromError(409, { code: "channel_required" }), null);
});
