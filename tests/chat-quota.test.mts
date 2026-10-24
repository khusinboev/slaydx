import test from "node:test";
import assert from "node:assert/strict";
import { createIsolatedDb } from "./helpers/isolated-db.mts";
import { cid, clearSetting, mkUser, setSetting, silentLlm, stubLlm, wallet } from "./helpers/chat-fixtures.mts";

/**
 * AI chat quota and money (owner request 8): 10 free messages per Tashkent day, then `chat.price_per_message`
 * charged once per message id; kill switches; refunds. Real Postgres, stubbed LLM.
 *
 * Mutations (each turned a test red, then restored):
 *   1. `FREE_LLM_WEIGHT.chat` / the daily bucket miscounted (chat counted twice per message) -> "10 free messages, then paid";
 *   2. the per-message idempotency (`claimMessage` conflict clause / replay) removed -> "a retried send ...";
 *   3. `chat.enabled` check removed from `sendChatMessage` -> "kill switch".
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.APP_URL = "https://slaydx.test";
const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("chatquota") : { isolated: false, drop: async () => {} };
const skip = hasDb && iso.isolated ? false : "alohida Postgres baza yo'q";

test("AI chat quota and charging", { skip }, async (t) => {
  const { query, migrate, pool } = await import("../lib/server/db.ts");
  const chat = await import("../lib/server/chat/service.ts");
  await migrate();
  t.after(async () => {
    await pool().end();
    await iso.drop();
  });
  const messages = async (uid: string, role?: string) =>
    Number((await query<{ n: string }>(`SELECT count(*) AS n FROM chat_messages m JOIN chat_conversations c ON c.id = m.conversation_id WHERE c.user_id = $1 ${role ? "AND m.role = '" + role + "'" : ""}`, [uid]))[0]!.n);
  const charges = async (uid: string) =>
    (await query<{ reference: string; points_delta: string; balance_delta: string }>("SELECT reference, points_delta, balance_delta FROM transactions WHERE user_id = $1 AND kind = 'charge' ORDER BY id", [uid]));

  await t.test("10 free messages, then paid: bonus so'm first, 100 each, with 'Bugun tekin' counting down", async () => {
    const uid = await mkUser(query, { points: 150, balance: 1000 });
    const llm = stubLlm();
    const send = (text: string) => chat.sendChatMessage({ userId: uid, channel: "web", text, clientId: cid() }, { complete: llm.complete });
    for (let i = 1; i <= 10; i++) {
      const r = await send(`savol ${i}`);
      assert.equal(r.charged, 0, `message ${i} must be free`);
      assert.equal(r.status.freeLeft, 10 - i, `left after ${i}`);
      assert.equal(r.status.freeLimit, 10);
    }
    assert.deepEqual(await wallet(query, uid), { points: 150, balance: 1000, total: 1150 }, "free messages cost nothing");
    assert.equal((await charges(uid)).length, 0);

    const r11 = await send("o'n birinchi");
    assert.equal(r11.charged, 100);
    assert.equal(r11.status.freeLeft, 0);
    assert.deepEqual(await wallet(query, uid), { points: 50, balance: 1000, total: 1050 }, "bonus so'm is spent first");
    const r12 = await send("o'n ikkinchi");
    assert.equal(r12.charged, 100);
    // 50 bonus + 50 balance
    assert.deepEqual(await wallet(query, uid), { points: 0, balance: 950, total: 950 });
    assert.equal((await charges(uid)).length, 2);
    assert.equal(llm.calls.length, 12);
    assert.equal(await messages(uid, "user"), 12);
    assert.equal(await messages(uid, "assistant"), 12);
  });

  await t.test("a retried send (same client id) returns the same reply: one answer, one charge, one model call", async () => {
    const uid = await mkUser(query, { balance: 1000 });
    const llm = stubLlm();
    const free = (id: string) => chat.sendChatMessage({ userId: uid, channel: "web", text: "x", clientId: id }, { complete: llm.complete });
    for (let i = 0; i < 10; i++) await free(cid());
    const id = cid();
    const a = await free(id);
    const b = await free(id);
    const c = await free(id);
    assert.equal(a.charged, 100);
    assert.equal(b.replayed, true);
    assert.equal(b.reply.id, a.reply.id);
    assert.equal(c.reply.id, a.reply.id);
    assert.equal((await charges(uid)).length, 1, "charged once");
    assert.equal((await wallet(query, uid)).balance, 900);
    assert.equal(llm.calls.length, 11, "the model answered once");
    // Parallel duplicates: exactly one charge as well.
    const id2 = cid();
    const settled = await Promise.allSettled([free(id2), free(id2), free(id2)]);
    assert.ok(settled.some((s) => s.status === "fulfilled"));
    assert.equal((await charges(uid)).length, 2, "two distinct messages, two charges");
  });

  await t.test("the ledger reference is the message id: chat:<id>", async () => {
    const uid = await mkUser(query, { balance: 500 });
    const llm = stubLlm();
    for (let i = 0; i < 10; i++) await chat.sendChatMessage({ userId: uid, channel: "web", text: "x", clientId: cid() }, { complete: llm.complete });
    await chat.sendChatMessage({ userId: uid, channel: "web", text: "paid", clientId: cid() }, { complete: llm.complete });
    const [row] = await charges(uid);
    const msg = (await query<{ id: string; charged_points: number }>("SELECT m.id::text AS id, m.charged_points FROM chat_messages m JOIN chat_conversations c ON c.id = m.conversation_id WHERE c.user_id = $1 AND m.role = 'user' AND m.charged_points > 0", [uid]))[0]!;
    assert.equal(row!.reference, `chat:${msg.id}`);
    assert.equal(msg.charged_points, 100);
  });

  await t.test("insufficient balance after the free ones: 402 with a top-up link, nothing charged, no model call, no message kept", async () => {
    const uid = await mkUser(query, { balance: 60 });
    const llm = stubLlm();
    for (let i = 0; i < 10; i++) await chat.sendChatMessage({ userId: uid, channel: "web", text: "x", clientId: cid() }, { complete: llm.complete });
    const before = llm.calls.length;
    const rows = await messages(uid);
    await assert.rejects(
      chat.sendChatMessage({ userId: uid, channel: "web", text: "yana", clientId: cid() }, { complete: llm.complete }),
      (e: { status?: number; extra?: Record<string, unknown> }) =>
        e.status === 402 && e.extra?.code === "insufficient" && e.extra.required === 100 && e.extra.available === 60 && String(e.extra.topUp).endsWith("/uz/wallet"),
    );
    assert.equal(llm.calls.length, before);
    assert.equal((await wallet(query, uid)).balance, 60);
    assert.equal((await charges(uid)).length, 0);
    assert.equal(await messages(uid), rows, "the refused message is not stored");
  });

  await t.test("the model gives no answer: a free slot comes back, a paid message is refunded", async () => {
    const uid = await mkUser(query, { balance: 500 });
    const ok = stubLlm();
    const s1 = await chat.sendChatMessage({ userId: uid, channel: "web", text: "a", clientId: cid() }, { complete: ok.complete });
    assert.equal(s1.status.freeLeft, 9);
    await assert.rejects(chat.sendChatMessage({ userId: uid, channel: "web", text: "b", clientId: cid() }, { complete: silentLlm }), (e: { status?: number }) => e.status === 503);
    assert.equal((await chat.chatStatus(uid)).freeLeft, 9, "the failed free message did not use a slot");
    for (let i = 0; i < 9; i++) await chat.sendChatMessage({ userId: uid, channel: "web", text: "x", clientId: cid() }, { complete: ok.complete });
    await assert.rejects(chat.sendChatMessage({ userId: uid, channel: "web", text: "c", clientId: cid() }, { complete: silentLlm }), (e: { status?: number }) => e.status === 503);
    assert.equal((await wallet(query, uid)).balance, 500, "refunded");
    const refunds = Number((await query<{ n: string }>("SELECT count(*) AS n FROM transactions WHERE user_id = $1 AND kind = 'refund'", [uid]))[0]!.n);
    assert.equal(refunds, 1);
    // The same text can be sent again and is charged once.
    const again = await chat.sendChatMessage({ userId: uid, channel: "web", text: "c", clientId: cid() }, { complete: ok.complete });
    assert.equal(again.charged, 100);
    assert.equal((await wallet(query, uid)).balance, 400);
  });

  await t.test("price 0: the chat closes after the free messages instead of becoming unlimited", async (tt) => {
    const uid = await mkUser(query, { balance: 500 });
    const llm = stubLlm();
    await setSetting(query, "chat.price_per_message", 0);
    tt.after(() => clearSetting(query, "chat.price_per_message"));
    for (let i = 0; i < 10; i++) await chat.sendChatMessage({ userId: uid, channel: "web", text: "x", clientId: cid() }, { complete: llm.complete });
    await assert.rejects(
      chat.sendChatMessage({ userId: uid, channel: "web", text: "y", clientId: cid() }, { complete: llm.complete }),
      (e: { status?: number; extra?: Record<string, unknown> }) => e.status === 429 && e.extra?.code === "free_exhausted",
    );
    assert.equal(llm.calls.length, 10);
  });

  await t.test("a changed price setting applies to the next paid message", async (tt) => {
    const uid = await mkUser(query, { balance: 1000 });
    const llm = stubLlm();
    await setSetting(query, "chat.price_per_message", 250);
    tt.after(() => clearSetting(query, "chat.price_per_message"));
    for (let i = 0; i < 10; i++) await chat.sendChatMessage({ userId: uid, channel: "web", text: "x", clientId: cid() }, { complete: llm.complete });
    const r = await chat.sendChatMessage({ userId: uid, channel: "web", text: "y", clientId: cid() }, { complete: llm.complete });
    assert.equal(r.charged, 250);
    assert.equal(r.status.pricePerMessage, 250);
    assert.equal((await wallet(query, uid)).balance, 750);
  });

  await t.test("kill switch chat.enabled=false: 503 before any model call or charge; free_llm.disabled stops it too", async (tt) => {
    const uid = await mkUser(query, { balance: 500 });
    const llm = stubLlm();
    await setSetting(query, "chat.enabled", false);
    await assert.rejects(
      chat.sendChatMessage({ userId: uid, channel: "web", text: "x", clientId: cid() }, { complete: llm.complete }),
      (e: { status?: number; extra?: Record<string, unknown> }) => e.status === 503 && e.extra?.code === "disabled",
    );
    assert.equal(llm.calls.length, 0);
    assert.equal((await chat.chatStatus(uid)).enabled, false);
    await setSetting(query, "chat.enabled", true);
    assert.equal((await chat.chatStatus(uid)).enabled, true);
    await setSetting(query, "free_llm.disabled", true);
    tt.after(() => clearSetting(query, "free_llm.disabled"));
    await assert.rejects(chat.sendChatMessage({ userId: uid, channel: "web", text: "x", clientId: cid() }, { complete: llm.complete }), (e: { status?: number }) => e.status === 503);
    assert.equal(llm.calls.length, 0);
    assert.equal((await chat.chatStatus(uid)).enabled, false);
  });

  await t.test("the global free cap stops free messages (503) without touching the wallet", async (tt) => {
    const uid = await mkUser(query, { balance: 500 });
    const llm = stubLlm();
    await setSetting(query, "free_llm.daily.global", 0);
    tt.after(() => clearSetting(query, "free_llm.daily.global"));
    await assert.rejects(
      chat.sendChatMessage({ userId: uid, channel: "web", text: "x", clientId: cid() }, { complete: llm.complete }),
      (e: { status?: number; extra?: Record<string, unknown> }) => e.status === 503 && e.extra?.code === "global",
    );
    assert.equal(llm.calls.length, 0);
    assert.equal((await wallet(query, uid)).balance, 500);
  });

  await t.test("the free count resets with the Tashkent day", async () => {
    const uid = await mkUser(query, { balance: 0 });
    const llm = stubLlm();
    const day1 = Date.parse("2026-11-03T10:00:00Z");
    for (let i = 0; i < 10; i++) await chat.sendChatMessage({ userId: uid, channel: "web", text: "x", clientId: cid() }, { complete: llm.complete, now: day1 });
    assert.equal((await chat.chatStatus(uid, { now: day1 })).freeLeft, 0);
    // 18:59 UTC is still the same Tashkent day, 19:00 UTC is the next one.
    assert.equal((await chat.chatStatus(uid, { now: Date.parse("2026-11-03T18:59:00Z") })).freeLeft, 0);
    assert.equal((await chat.chatStatus(uid, { now: Date.parse("2026-11-03T19:00:00Z") })).freeLeft, 10);
  });

  await t.test("spend lands in ai_usage as free:chat, also for a paid message", async () => {
    const { flushAiUsage } = await import("../lib/server/ai-usage.ts");
    const uid = await mkUser(query, { balance: 500 });
    const llm = stubLlm();
    for (let i = 0; i < 11; i++) await chat.sendChatMessage({ userId: uid, channel: "web", text: "x", clientId: cid() }, { complete: llm.complete });
    await flushAiUsage();
    const rows = await query<{ tool_id: string; calls: number }>("SELECT tool_id, calls FROM ai_usage WHERE user_id = $1", [uid]);
    assert.equal(rows.length, 11);
    assert.ok(rows.every((r) => r.tool_id === "free:chat" && r.calls === 1));
  });

  await t.test("input checks: empty, too long, bad client id", async () => {
    const uid = await mkUser(query, { balance: 500 });
    const llm = stubLlm();
    const go = (text: unknown, clientId: unknown = cid()) => chat.sendChatMessage({ userId: uid, channel: "web", text, clientId }, { complete: llm.complete });
    await assert.rejects(go("   "), (e: { status?: number }) => e.status === 400);
    await assert.rejects(go("x".repeat(2001)), (e: { status?: number }) => e.status === 400);
    await assert.rejects(go("ok", "a b"), (e: { status?: number }) => e.status === 400);
    await assert.rejects(go(42), (e: { status?: number }) => e.status === 400);
    assert.equal(llm.calls.length, 0);
  });

  await t.test("context: the last 10 turns reach the model, older ones do not", async () => {
    const uid = await mkUser(query, { balance: 5000 });
    const llm = stubLlm();
    for (let i = 1; i <= 14; i++) await chat.sendChatMessage({ userId: uid, channel: "web", text: `turn-${i}`, clientId: cid() }, { complete: llm.complete });
    const last = llm.calls.at(-1)!.user;
    assert.ok(last.includes("turn-13") && last.includes("turn-4"), "turns 4..13 are in the context");
    assert.ok(!last.includes("turn-3<") && !/turn-3\n/.test(last) && !last.includes("turn-2\n") && !last.includes("turn-1\n"), "older turns are not");
    assert.ok(last.includes("turn-14"), "the new message");
  });
});
