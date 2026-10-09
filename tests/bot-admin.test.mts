import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomInt } from "node:crypto";

/**
 * In-bot admin panel end to end (docs/bot-admin/PLAN.md): every update goes
 * through `handleUpdate` with the Bot API stubbed at `fetch`; real Postgres
 * (fresh test DB only), synthetic Telegram ids.
 *
 * Owner 2026-10-09: every admin screen is a REPLY keyboard. A tap arrives as a plain text message that is mapped back
 * to the callback code of the button (`bot_admin_state.keys`, written when the screen is sent) and runs through
 * `handleAdminCallback`. The flows below therefore drive the bot by TYPING button labels (`press`); the inline `a:*`
 * callbacks (`cbUpdate`) are kept only for the «old inline buttons in chat history still work» cases.
 *
 * Mutations (each turned a test red, then restored):
 *   1. `lookupAdmin` without the `is_blocked` check → «blocked admin gets nothing»;
 *   2. `lookupAdmin` accepting `disabled` accounts → «revoked admin gets nothing»;
 *   3. `handleAdminCallback` without the per-action `allowed()` check → «viewer: stats only», «downgraded owner»;
 *   4. `bcSend` passing the CURRENT audience count instead of the tapped one → «confirm count changed»;
 *   5. `bcSend` without clearing the draft after queueing → «confirm creates exactly one broadcast»;
 *   6. `tapScreenKey` serving a text without the `admin.adminId === hit.adminId` / admin checks → «non-admin / revoked /
 *      other account: the label falls through»;
 *   7. `handleAdminCallback` step-up skipped for reply taps (`messageId === null`) → «2FA mode»;
 *   8. `handleAdminInput` taking the step's «Bekor qilish» / «Orqaga» label as content → «free-text steps».
 */

process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters-long";
process.env.APP_URL = "https://slaydx.test";
process.env.TELEGRAM_BOT_TOKEN = "123456:FAKE-admin-bot-token";
process.env.NEXT_PUBLIC_TELEGRAM_BOT = "slaydx_test_bot";
delete process.env.BOT_PREMIUM_EMOJI;
delete process.env.ADMIN_2FA_REQUIRED;
const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";
const skip = hasDb ? false : "Postgres kerak (DATABASE_URL)";

const { query, queryOne, pool, ensureMigrated } = await import("../lib/server/db.ts");
const tg = await import("../lib/server/telegram.ts");
const { upsertTelegramUser } = await import("../lib/server/auth.ts");
const { audienceCount } = await import("../lib/server/admin-broadcasts.ts");
const { deliverBroadcasts } = await import("../lib/server/broadcast-delivery.ts");
const { parseAdminCallback, acb } = await import("../lib/server/bot/admin-codes.ts");
const { ADMIN_TEXT_KEYS, adminRawEntry } = await import("../lib/server/bot/admin-i18n.ts");
const { groupDigits } = await import("../lib/format.ts");
/** `groupDigits` separates thousands with a no-break space. */
const nb = (s: string) => s.replace(/(\d) (\d)/g, "$1 $2");
if (hasDb) await ensureMigrated();

type Call = { method: string; body: Record<string, unknown> };
let calls: Call[] = [];
let msgSeq = 1000;
/** getChat answers by chat_id / @username. */
const chats: Record<string, { id: number; type: string; title: string; username?: string }> = {};
/** The labels of the reply keyboard each chat last received (what its phone shows). */
const shown = new Map<number, string[]>();
type Key = { text: string; style?: string; icon_custom_emoji_id?: string; url?: string };
const kb = (body: Record<string, unknown>): Key[][] => (body.reply_markup as { keyboard?: Key[][] } | undefined)?.keyboard ?? [];
const labels = (body: Record<string, unknown>): string[] => kb(body).flat().map((b) => b.text);

/** Every reply keyboard the bot sends obeys the screen rules: unique labels, ≤ 2 per row unless all are short, resized + persistent. */
function checkKeyboard(body: Record<string, unknown>): void {
  const rows = kb(body);
  if (!rows.length || rows.flat().some((b) => "request_contact" in b)) return; // the contact-sharing keyboard is not an admin screen
  const all = rows.flat().map((b) => b.text);
  assert.equal(new Set(all).size, all.length, `duplicate labels: ${all.join(" | ")}`);
  for (const r of rows) assert.ok(r.length <= 2 || r.every((b) => Array.from(b.text).length <= 6), `row too wide: ${r.map((b) => b.text).join(" | ")}`);
  const m = body.reply_markup as { resize_keyboard?: boolean; is_persistent?: boolean };
  assert.equal(m.resize_keyboard, true);
  assert.equal(m.is_persistent, true);
}

const realFetch = globalThis.fetch;
function installFetch(): void {
  calls = [];
  globalThis.fetch = (async (url: string | URL, init?: { body?: unknown }) => {
    const m = /^https:\/\/api\.telegram\.org\/bot[^/]+\/(\w+)$/.exec(String(url));
    assert.ok(m, `unexpected URL ${url}`);
    const method = m[1]!;
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push({ method, body });
    const ok = (result: unknown) => new Response(JSON.stringify({ ok: true, result }));
    if (method === "getChat") {
      const c = chats[String(body.chat_id)];
      return c ? ok(c) : new Response(JSON.stringify({ ok: false, error_code: 400, description: "Bad Request: chat not found" }));
    }
    if (method === "getChatMember") return ok({ status: "administrator" });
    if (method === "getChatMemberCount") return ok(1234);
    if (method === "createChatInviteLink") return ok({ invite_link: "https://t.me/+AbCdEfGh12345" });
    if (/^send(Message|Photo|Video)$/.test(method)) {
      if (method === "sendMessage" && kb(body).length) {
        checkKeyboard(body);
        shown.set(Number(body.chat_id), labels(body));
      }
      return ok({ message_id: ++msgSeq });
    }
    return ok(true);
  }) as typeof fetch;
}

let seq = Date.now() * 1000 + 700_000;
async function newUser(name = "Admin Bot"): Promise<{ id: string; tg: number }> {
  const tgId = 7_800_000_000 + randomInt(0, 99_999_999);
  const u = await upsertTelegramUser({ telegramId: String(tgId), username: null, name, photoUrl: null });
  return { id: u.id, tg: tgId };
}
async function newAdmin(role = "owner", status = "active"): Promise<{ id: string; tg: number; adminId: string }> {
  const u = await newUser();
  const a = await queryOne<{ id: string }>("INSERT INTO admin_accounts (user_id, role, status) VALUES ($1, $2, $3) RETURNING id::text AS id", [u.id, role, status]);
  return { ...u, adminId: a!.id };
}
const textUpdate = (from: number, text: string, extra: Record<string, unknown> = {}) => ({
  update_id: ++seq,
  message: { message_id: ++seq, chat: { id: from, type: "private" }, from: { id: from, first_name: "Admin" }, text, ...extra },
});
const mediaUpdate = (from: number, extra: Record<string, unknown>) => ({
  update_id: ++seq,
  message: { message_id: ++seq, chat: { id: from, type: "private" }, from: { id: from, first_name: "Admin" }, ...extra },
});
/** An OLD inline button still in the chat history. */
const cbUpdate = (from: number, data: string, messageId = 555) => ({
  update_id: ++seq,
  callback_query: { id: `cq${++seq}`, from: { id: from }, message: { message_id: messageId, chat: { id: from, type: "private" } }, data },
});
const sends = (method = "sendMessage") => calls.filter((c) => c.method === method);
const edits = () => calls.filter((c) => c.method === "editMessageText");
const toasts = () => calls.filter((c) => c.method === "answerCallbackQuery").map((c) => c.body.text as string | undefined);
const texts = () => sends().map((c) => String(c.body.text));

type ScreenKey = { text: string; code: string };
/** The label → code map the bot stored for the chat's current screen. */
const keysOf = async (chat: number): Promise<ScreenKey[]> =>
  (await queryOne<{ keys: ScreenKey[] | null }>("SELECT keys FROM bot_admin_state WHERE chat_id = $1", [chat]))?.keys ?? [];
const offered = async (chat: number): Promise<string[]> => (await keysOf(chat)).map((k) => k.code);
/** The label of the button that stands for `code` on the current screen (and proof the phone shows it). */
async function labelFor(chat: number, code: string): Promise<string> {
  const keys = await keysOf(chat);
  const k = keys.find((x) => x.code === code);
  assert.ok(k, `the current screen has no button for ${code}; it offers ${keys.map((x) => x.code).join(", ") || "nothing"}`);
  assert.ok(shown.get(chat)?.includes(k!.text), `«${k!.text}» is not on the keyboard the chat shows: ${shown.get(chat)?.join(" | ")}`);
  return k!.text;
}
/** Taps the button for `code`: its label arrives as a plain text message. */
const press = async (a: { tg: number }, code: string): Promise<void> => tg.handleUpdate(textUpdate(a.tg, await labelFor(a.tg, code)));
/** From the admin menu to the confirm screen of a broadcast with this text. */
async function toConfirm(a: { tg: number }, text: string, audience: "all" | "act" | "new" = "new"): Promise<void> {
  installFetch();
  await tg.handleUpdate(textUpdate(a.tg, "📢 Xabar yuborish"));
  await tg.handleUpdate(textUpdate(a.tg, text));
  await press(a, acb.bcAudience());
  await press(a, acb.bcPick(audience));
}
const audit = (adminId: string, action: string) =>
  query<{ outcome: string; meta: Record<string, unknown> | null; target_id: string | null; user_agent: string | null; after: Record<string, unknown> | null }>(
    "SELECT outcome, meta, target_id, user_agent, after FROM admin_audit_log WHERE admin_id = $1 AND action = $2 ORDER BY id",
    [adminId, action],
  );
const broadcastsBy = (adminId: string) =>
  query<{ id: string; status: string; total: number; text: string; content: Record<string, unknown> | null }>(
    "SELECT id::text AS id, status, total, text, content FROM broadcasts WHERE created_by = $1 ORDER BY id",
    [adminId],
  );
const stepOf = async (chat: number) => (await queryOne<{ step: string | null }>("SELECT step FROM bot_admin_state WHERE chat_id = $1", [chat]))?.step ?? null;

after(async () => {
  globalThis.fetch = realFetch;
  if (hasDb) await pool().end();
});

test("codes: every admin code parses back and fits 64 bytes; i18n filled in uz/ru/en", () => {
  for (const d of [acb.panel(), acb.stats(), acb.bcPick("new"), acb.bcSend(123456789), acb.bcStop("999999999999999999"), acb.chCreate("e"), acb.chToggle("12"), acb.payBonus(), acb.pbOther(), acb.pbPick(0), acb.pbSet(50)]) {
    assert.notEqual(parseAdminCallback(d).kind, "unknown", d);
    assert.ok(Buffer.byteLength(d) <= 64);
  }
  assert.deepEqual(parseAdminCallback("a:pk:15"), { kind: "pbSet", percent: 15 });
  assert.deepEqual(parseAdminCallback("a:pv:0"), { kind: "pbPick", percent: 0 });
  // MUTATION: the code bound 50 → 99 lets a forged `a:pk:51` reach the service (it would still refuse with 400).
  for (const bad of ["a:bs:-1", "a:bu:vip", "a:ct:0x1", "a:bk:1:2", "a", "a:pk:51", "a:pk:-1", "a:pk:05", "a:pk:1.5", "a:pv:100", "a:pk:"]) {
    assert.equal(parseAdminCallback(bad).kind, "unknown", bad);
  }
  for (const k of ADMIN_TEXT_KEYS) for (const l of ["uz", "ru", "en"] as const) assert.ok(adminRawEntry(k)[l].trim(), `${k}.${l}`);
});

test("access: a non-admin tap gets «Ruxsat yo‘q» and nothing else; /admin keeps the contact flow; no admin row", { skip }, async () => {
  const u = await newUser();
  installFetch();
  await tg.handleUpdate(cbUpdate(u.tg, "a:s"));
  assert.deepEqual(toasts(), ["Ruxsat yo‘q"]);
  assert.equal(calls.length, 1, "only the toast");
  installFetch();
  await tg.handleUpdate(textUpdate(u.tg, "/admin"));
  const ck = (sends()[0]!.body.reply_markup as { keyboard: Array<Array<{ request_contact?: boolean }>> }).keyboard;
  assert.equal(ck[0]![0]!.request_contact, true, "contact-sharing flow");
  installFetch();
  await tg.handleUpdate(textUpdate(u.tg, "🛠 Admin"));
  assert.equal(sends().length, 1);
  assert.doesNotMatch(String(sends()[0]!.body.text), /Admin panel/, "ordinary text for a non-admin");
  installFetch();
  await tg.handleUpdate(textUpdate(u.tg, "/start"));
  const rows = (sends().at(-1)!.body.reply_markup as { keyboard: Key[][] }).keyboard;
  assert.ok(!rows.flat().some((b) => /Admin/.test(b.text)), "no «🛠 Admin» row");
  assert.equal(await queryOne("SELECT 1 FROM bot_admin_state WHERE chat_id = $1", [u.tg]), null, "no admin state for a non-admin");
});

test("access: an owner — /admin opens the admin menu as a REPLY keyboard (owner C-Q6); a tap sends the screen as a NEW message; «Asosiy menyu» restores the main keyboard", { skip }, async () => {
  const a = await newAdmin("owner");
  installFetch();
  await tg.handleUpdate(textUpdate(a.tg, "/admin"));
  // MUTATION: the main keyboard sent after the panel would replace the admin menu (review F1).
  assert.equal(sends().length, 1, "only the admin menu — no main keyboard on top of it");
  const panel = sends()[0]!.body;
  assert.match(String(panel.text), /^🛠 <b>Admin panel<\/b>\n\nAdmin Bot, rolingiz: <b>ega<\/b>\./);
  // MUTATION: the old inline panel (buttons under the message) instead of the bottom keyboard.
  assert.deepEqual(kb(panel).map((r) => r.map((b) => `${b.text}${b.style ? `(${b.style})` : ""}`)), [
    ["📈 Statistika(primary)", "📢 Xabar yuborish"],
    ["🔔 Kanal ulash", "💳 To‘lov bonusi"],
    ["⬅️ Asosiy menyu"],
  ]);
  installFetch();
  await tg.handleUpdate(textUpdate(a.tg, "🛠 Admin"));
  assert.equal(sends().length, 1, "«🛠 Admin» too: just the admin menu");
  assert.match(String(sends()[0]!.body.text), /Admin panel/);

  installFetch();
  await tg.handleUpdate(textUpdate(a.tg, "📈 Statistika"));
  assert.equal(sends().length, 1, "one new message — no ⏳ placeholder");
  assert.equal(edits().length, 0, "a reply keyboard cannot be edited: nothing is edited");
  const stats = sends()[0]!.body;
  assert.match(String(stats.text), /Foydalanuvchilar/);
  assert.deepEqual(kb(stats).map((r) => r.map((b) => b.text)), [["🔄 Yangilash", "⬅️ Orqaga"]]);
  assert.equal(kb(stats)[0]![0]!.style, "primary");
  assert.deepEqual(await offered(a.tg), [acb.stats(), acb.panel()]);

  // «Yangilash» runs the same action again — a fresh message.
  installFetch();
  await press(a, acb.stats());
  assert.equal(sends().length, 1);
  assert.match(String(sends()[0]!.body.text), /Foydalanuvchilar/);

  // «Orqaga»: the admin menu again (there is no inline message to delete); the screen buttons are gone.
  installFetch();
  await press(a, acb.panel());
  assert.equal(sends("deleteMessage").length, 0);
  assert.match(String(sends()[0]!.body.text), /Admin panel/);
  assert.deepEqual(kb(sends()[0]!.body).at(-1)!.map((b) => b.text), ["⬅️ Asosiy menyu"]);
  assert.deepEqual(await offered(a.tg), [], "the menu's own texts are static");

  installFetch();
  await tg.handleUpdate(textUpdate(a.tg, "⬅️ Asosiy menyu"));
  const main = (sends()[0]!.body.reply_markup as { keyboard: Key[][] }).keyboard;
  assert.deepEqual(main.at(-1), [{ text: "🛠 Admin", style: "primary" }], "main keyboard with the admin row");
  assert.ok(main.flat().some((b) => /Slayd/.test(b.text)));
});

test("old inline buttons in the chat history still work: back / cancel remove the message and bring the reply-keyboard menu; a screen comes as a NEW message and the old buttons are removed", { skip }, async () => {
  const a = await newAdmin("owner");
  for (const data of ["a:h", "a:x", "a:z"]) {
    installFetch();
    await tg.handleUpdate(cbUpdate(a.tg, data, 555));
    // MUTATION: editing the message into an inline panel instead of removing it.
    assert.deepEqual(sends("deleteMessage").map((c) => c.body.message_id), [555], data);
    assert.equal(edits().length, 0, `${data}: no inline card`);
    const menu = sends().at(-1)!.body;
    assert.match(String(menu.text), /Admin panel/, data);
    assert.deepEqual(kb(menu).at(-1)!.map((b) => b.text), ["⬅️ Asosiy menyu"], data);
  }
  installFetch();
  await tg.handleUpdate(cbUpdate(a.tg, "a:x", 556));
  assert.match(String(sends().at(-1)!.body.text), /^Bekor qilindi\n\n🛠 <b>Admin panel/, "the toast is the first line of the next screen");
  assert.deepEqual(toasts(), [undefined], "the callback is only acknowledged (no popup text): the toast is part of the screen");

  installFetch();
  await tg.handleUpdate(cbUpdate(a.tg, "a:s", 557));
  assert.equal(edits().length, 0);
  assert.match(String(sends()[0]!.body.text), /Foydalanuvchilar/);
  assert.deepEqual(labels(sends()[0]!.body), ["🔄 Yangilash", "⬅️ Orqaga"]);
  const cleared = sends("editMessageReplyMarkup");
  assert.deepEqual(cleared.map((c) => [c.body.message_id, c.body.reply_markup]), [[557, { inline_keyboard: [] }]], "the tapped inline buttons are removed");
  assert.deepEqual(await offered(a.tg), [acb.stats(), acb.panel()], "the new screen is tappable by reply");
});

test("admin reply texts: a NON-admin typing a menu label or a screen label gets no admin screen (text falls through to the ordinary bot)", { skip }, async () => {
  const u = await newUser();
  for (const text of ["📈 Statistika", "⬅️ Asosiy menyu", "🔄 Yangilash", "⬅️ Orqaga", "✖️ Bekor qilish", "1. ✅ Kanal", "✅ 10%", "🔒 Majburiy"]) {
    installFetch();
    await tg.handleUpdate(textUpdate(u.tg, text));
    assert.ok(!sends().some((m) => m.body.text === "⏳" || /Foydalanuvchilar|Admin panel|Ruxsat/.test(String(m.body.text))), text);
    // MUTATION: the reply handler swallowing a non-admin's text — the usual bot reply must still come.
    assert.ok(sends().length >= 1, `${text}: the ordinary reply still arrives`);
  }
  assert.equal(await queryOne("SELECT 1 FROM bot_admin_state WHERE chat_id = $1", [u.tg]), null);
});

test("admin reply texts: a revoked admin's stale screen labels and another account's map fall through — MUTATSIYA 6", { skip }, async () => {
  const a = await newAdmin("owner");
  const other = await newAdmin("owner");
  installFetch();
  await tg.handleUpdate(textUpdate(a.tg, "📈 Statistika"));
  assert.deepEqual(await offered(a.tg), [acb.stats(), acb.panel()]);
  // The chat's row now belongs to ANOTHER admin account (an account re-linked to the chat): its labels are not ours.
  await query("UPDATE bot_admin_state SET admin_id = $2 WHERE chat_id = $1", [a.tg, other.adminId]);
  installFetch();
  await tg.handleUpdate(textUpdate(a.tg, "🔄 Yangilash"));
  assert.ok(!texts().some((t) => /Foydalanuvchilar/.test(t)), "another account's map is never consulted");
  assert.equal(sends().length, 1, "the ordinary reply");
  await query("UPDATE bot_admin_state SET admin_id = $2 WHERE chat_id = $1", [a.tg, a.adminId]);
  installFetch();
  await tg.handleUpdate(textUpdate(a.tg, "🔄 Yangilash"));
  assert.match(texts()[0]!, /Foydalanuvchilar/, "the same label works for the right account");
  // Expired: a screen's labels live 12 h; the static menu keeps working.
  // MUTATION: matching labels without the age limit.
  await query("UPDATE bot_admin_state SET updated_at = now() - interval '13 hours' WHERE chat_id = $1", [a.tg]);
  installFetch();
  await tg.handleUpdate(textUpdate(a.tg, "🔄 Yangilash"));
  assert.ok(!texts().some((t) => /Foydalanuvchilar/.test(t)), "an expired label falls through");
  installFetch();
  await tg.handleUpdate(textUpdate(a.tg, "📈 Statistika"));
  assert.match(texts()[0]!, /Foydalanuvchilar/, "the static menu does not expire");
  // Revoked: the stale map stays in the row, but the account is no admin any more.
  await query("UPDATE admin_accounts SET status = 'disabled' WHERE id = $1", [a.adminId]);
  installFetch();
  await tg.handleUpdate(textUpdate(a.tg, "🔄 Yangilash"));
  assert.ok(!texts().some((t) => /Foydalanuvchilar|Ruxsat/.test(t)), "a revoked admin gets the ordinary bot");
  assert.equal(sends().length, 1);
  installFetch();
  await tg.handleUpdate(textUpdate(a.tg, "📈 Statistika"));
  assert.ok(!texts().some((t) => /Foydalanuvchilar/.test(t)), "and the static menu too");
});

test("access: revoked (disabled) and blocked admins get nothing — MUTATSIYA 1, 2", { skip }, async () => {
  const revoked = await newAdmin("owner", "disabled");
  const blocked = await newAdmin("owner");
  await query("UPDATE users SET is_blocked = true WHERE id = $1", [blocked.id]);
  for (const x of [revoked, blocked]) {
    installFetch();
    await tg.handleUpdate(cbUpdate(x.tg, "a:s"));
    assert.deepEqual(toasts(), ["Ruxsat yo‘q"]);
    assert.equal(calls.length, 1);
  }
  installFetch();
  await tg.handleUpdate(textUpdate(revoked.tg, "/admin"));
  assert.ok(!sends().some((s) => /Admin panel/.test(String(s.body.text))));
});

test("access: viewer sees Statistika only (no bonus section); a broadcast tap — inline or typed — is refused and audited — MUTATSIYA 3", { skip }, async () => {
  const v = await newAdmin("viewer");
  installFetch();
  await tg.handleUpdate(textUpdate(v.tg, "/admin"));
  assert.deepEqual(labels(sends()[0]!.body), ["📈 Statistika", "🔔 Kanal ulash", "💳 To‘lov bonusi", "⬅️ Asosiy menyu"], "viewer has bonus.view + settings.view, not broadcasts.send");
  const s = await newAdmin("support");
  installFetch();
  await tg.handleUpdate(cbUpdate(s.tg, "a:b"));
  assert.deepEqual(toasts(), ["Ruxsat yo‘q"]);
  assert.equal(edits().length, 0);
  const rows = await audit(s.adminId, "auth.denied");
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.outcome, "denied");
  assert.deepEqual(rows[0]!.meta, { permission: "broadcasts.send", scope: "bot/admin" });
  // The same refusal when the label of the menu button is TYPED (the reply path): a message, no flow, an audit row.
  installFetch();
  await tg.handleUpdate(textUpdate(s.tg, "📢 Xabar yuborish"));
  assert.deepEqual(texts(), ["Ruxsat yo‘q"]);
  assert.equal(sends().length, 1);
  assert.equal(await stepOf(s.tg), null, "no broadcast flow started");
  assert.equal((await audit(s.adminId, "auth.denied")).length, 2);
  installFetch();
  await tg.handleUpdate(textUpdate(s.tg, "📈 Statistika"));
  const text = texts()[0]!;
  assert.match(text, /Foydalanuvchilar/);
  assert.doesNotMatch(text, /Bonuslar/, "support has no bonus.view");
  installFetch();
  await tg.handleUpdate(cbUpdate(s.tg, "a:ct:1"));
  assert.deepEqual(toasts(), ["Ruxsat yo‘q"]);
});

test("access: a button of an OLDER screen is re-checked when typed — an owner downgraded to viewer cannot toggle a channel or connect one — MUTATSIYA 3", { skip }, async () => {
  const a = await newAdmin("owner");
  const ch = await queryOne<{ id: string }>(
    `INSERT INTO bonus_channels (chat_id, title, join_bonus, stay_bonus, stay_days, sort, active) VALUES ($1, 'Downgrade', 1000, 0, 7, 60, true) RETURNING id::text AS id`,
    [-1_006_000_000_000 - randomInt(0, 999_999_999)],
  );
  installFetch();
  await tg.handleUpdate(textUpdate(a.tg, "🔔 Kanal ulash"));
  const toggle = await labelFor(a.tg, acb.chToggle(ch!.id));
  const connect = await labelFor(a.tg, acb.chConnect());
  await query("UPDATE admin_accounts SET role = 'viewer' WHERE id = $1", [a.adminId]);
  for (const label of [toggle, connect]) {
    installFetch();
    await tg.handleUpdate(textUpdate(a.tg, label));
    assert.deepEqual(texts(), ["Ruxsat yo‘q"], label);
    assert.equal(sends().length, 1, label);
  }
  assert.equal((await queryOne<{ active: boolean }>("SELECT active FROM bonus_channels WHERE id = $1", [ch!.id]))!.active, true, "nothing changed");
  assert.equal(await stepOf(a.tg), null, "the connect flow did not start");
  const denied = await audit(a.adminId, "auth.denied");
  assert.equal(denied.length, 2);
  assert.deepEqual(denied.map((r) => (r.meta as { permission: string }).permission), ["bonus.edit", "bonus.edit"]);
  await query("UPDATE bonus_channels SET active = false WHERE id = $1", [ch!.id]);
});

test("Statistika: numbers from the database, grouped digits, bonuses by type, channel members", { skip }, async () => {
  const a = await newAdmin("owner");
  const chat = -1_003_000_000_000 - randomInt(0, 999_999_999);
  await query(`INSERT INTO bonus_channels (chat_id, username, title, join_bonus, stay_bonus, stay_days, sort) VALUES ($1, 'stat_news', 'Stat <kanal>', 2000, 0, 7, -5)`, [chat]);
  installFetch();
  await tg.handleUpdate(textUpdate(a.tg, "📈 Statistika"));
  const text = String(sends()[0]!.body.text);
  const total = Number((await queryOne<{ n: string }>("SELECT count(*)::text AS n FROM users"))!.n);
  assert.match(text, new RegExp(`Jami: <b>${groupDigits(total)}</b> · bugun \\+\\d`));
  assert.match(text, /Faol \(30 kun\): <b>\d/);
  assert.match(text, /Bugun: <b>\d+<\/b> · 7 kun: <b>\d+<\/b>/);
  assert.match(text, /Tushum \(so‘m\)/);
  const signup = await queryOne<{ s: string; n: string }>("SELECT sum(points_delta)::text AS s, count(*)::text AS n FROM transactions WHERE kind = 'bonus' AND reference LIKE 'signup:%'");
  assert.ok(text.includes(`Ro‘yxatdan o‘tish: <b>${groupDigits(Number(signup!.s))} so‘m</b> (${groupDigits(Number(signup!.n))} ta)`), text);
  assert.ok(text.includes(nb("Stat &lt;kanal&gt;: <b>1 234</b> obunachi · bonus orqali 0")), "escaped title, getChatMemberCount");
  assert.deepEqual(await offered(a.tg), [acb.stats(), acb.panel()]);
  await query("UPDATE bonus_channels SET active = false WHERE chat_id = $1", [chat]);
});

test("Xabar yuborish: text + bold + button → audience counts → preview → test → confirm creates exactly ONE broadcast, delivered as is — MUTATSIYA 5", { skip }, async () => {
  const a = await newAdmin("owner");
  installFetch();
  await tg.handleUpdate(textUpdate(a.tg, "📢 Xabar yuborish"));
  assert.equal(edits().length, 0);
  const ask = sends()[0]!.body;
  assert.match(String(ask.text), /Xabar yuborish<\/b>\n\nFoydalanuvchilarga yuboriladigan xabarni/);
  assert.deepEqual(labels(ask), ["✖️ Bekor qilish"], "a free-text step shows only «Bekor qilish»");
  assert.deepEqual(await offered(a.tg), [acb.cancel()]);

  installFetch();
  const entities = [{ type: "bold", offset: 0, length: 6 }, { type: "mention", offset: 7, length: 3 }];
  await tg.handleUpdate(textUpdate(a.tg, "Salom! Yangi slayd vositasi", { entities }));
  const draft = sends()[0]!.body;
  assert.match(String(draft.text), /Xabar qabul qilindi<\/b>\n\nTuri: <b>matn<\/b> · 27 belgi\nTugma: yo‘q/);
  assert.deepEqual(labels(draft), ["🔗 Tugma qo‘shish", "👥 Auditoriyani tanlash", "✖️ Bekor qilish"]);
  assert.deepEqual(await offered(a.tg), [acb.bcButton(), acb.bcAudience(), acb.cancel()]);

  installFetch();
  await press(a, acb.bcButton());
  assert.deepEqual(labels(sends()[0]!.body), ["⬅️ Orqaga", "✖️ Bekor qilish"]);
  assert.deepEqual(await offered(a.tg), [acb.bcDraft(), acb.cancel()], "«Orqaga» returns to the draft, «Bekor qilish» drops it");
  installFetch();
  await tg.handleUpdate(textUpdate(a.tg, "Saytni ochish | ftp://bad"));
  assert.match(String(sends()[0]!.body.text), /Tushunmadim/);
  assert.deepEqual(await offered(a.tg), [acb.bcDraft(), acb.cancel()], "still waiting for the button");
  installFetch();
  await tg.handleUpdate(textUpdate(a.tg, "Saytni ochish | https://slaydx.uz/uz"));
  assert.match(String(sends()[0]!.body.text), /Tugma: <b>Saytni ochish<\/b> → https:\/\/slaydx\.uz\/uz/);
  assert.deepEqual(labels(sends()[0]!.body), ["✖️ Tugmani olib tashlash", "👥 Auditoriyani tanlash", "✖️ Bekor qilish"]);

  installFetch();
  await press(a, acb.bcAudience());
  const all = (await audienceCount({ kind: "all" })).count;
  const act = (await audienceCount({ kind: "active_days", days: 30 })).count;
  const nw = (await audienceCount({ kind: "new_days", days: 7 })).count;
  assert.deepEqual(
    (await keysOf(a.tg)).slice(0, 3).map((k) => [k.text, k.code]),
    [
      [`👥 Hamma · ${groupDigits(all)}`, "a:bu:all"],
      [`🔥 Faollar (30 kun) · ${groupDigits(act)}`, "a:bu:act"],
      [`🆕 Yangilar (7 kun) · ${groupDigits(nw)}`, "a:bu:new"],
    ],
  );

  installFetch();
  await press(a, acb.bcPick("new"));
  assert.equal(sends().length, 2, "the preview copy, then the confirm screen");
  const [preview, confirm] = sends();
  assert.deepEqual(preview!.body, {
    chat_id: String(a.tg),
    text: "Salom! Yangi slayd vositasi",
    entities: [{ type: "bold", offset: 0, length: 6 }],
    // The one inline button left: the broadcast's own URL button (the recipients' copy).
    reply_markup: { inline_keyboard: [[{ text: "Saytni ochish", url: "https://slaydx.uz/uz" }]] },
  });
  assert.match(String(confirm!.body.text), new RegExp(`Auditoriya: <b>Yangilar \\(7 kun\\)</b> — <b>${groupDigits(nw)}</b> kishi`));
  assert.deepEqual(await offered(a.tg), ["a:bt", `a:bs:${nw}`, "a:ba", "a:x"]);
  assert.deepEqual(labels(confirm!.body), ["✨ O‘zimga sinov", `✅ Yuborish (${groupDigits(nw)} kishiga)`, "⬅️ Orqaga", "✖️ Bekor qilish"].map(nb));
  assert.equal((await broadcastsBy(a.adminId)).length, 0, "nothing created before a test or the send");

  installFetch();
  await press(a, acb.bcTest());
  assert.equal(sends()[0]!.body.chat_id, String(a.tg));
  assert.deepEqual(sends()[0]!.body.entities, [{ type: "bold", offset: 0, length: 6 }]);
  assert.equal(sends()[1]!.body.text, "🧪 Sinov xabari yuborildi", "no popup for a reply tap: the answer is a message");
  assert.equal(sends().length, 2);
  assert.deepEqual(await offered(a.tg), ["a:bt", `a:bs:${nw}`, "a:ba", "a:x"], "the confirm keyboard stays");
  assert.equal((await broadcastsBy(a.adminId)).length, 1);
  assert.equal((await audit(a.adminId, "broadcasts.test"))[0]!.meta!.via, "bot");

  installFetch();
  const sendLabel = await labelFor(a.tg, acb.bcSend(nw));
  await tg.handleUpdate(textUpdate(a.tg, sendLabel));
  assert.equal(edits().length, 0);
  const card = sends()[0]!.body;
  assert.match(String(card.text), /^✅ Navbatga qo‘yildi\n\n/, "the toast is the first line of the progress card");
  assert.match(String(card.text), /Holat: <b>navbatda<\/b>/);
  const bs = await broadcastsBy(a.adminId);
  assert.equal(bs.length, 1, "exactly one broadcast");
  assert.deepEqual(await offered(a.tg), [`a:bp:${bs[0]!.id}`, `a:bw:${bs[0]!.id}`, `a:bc:${bs[0]!.id}`, "a:h"]);
  assert.equal((bs[0]!.content!.notify as { messageId?: number }).messageId, msgSeq, "the engine edits THIS card");
  // The label is gone from the screen: typing it again starts nothing; an old inline button answers «eskirgan».
  installFetch();
  await tg.handleUpdate(textUpdate(a.tg, sendLabel));
  assert.equal((await broadcastsBy(a.adminId)).length, 1);
  installFetch();
  await tg.handleUpdate(cbUpdate(a.tg, `a:bs:${nw}`, 903));
  assert.deepEqual(toasts(), ["Bu qadam eskirgan — qaytadan boshlang"], "a second tap sends nothing");

  assert.equal(bs[0]!.status, "queued");
  assert.equal(bs[0]!.total, nw);
  assert.equal(bs[0]!.content!.kind, "text");
  assert.deepEqual(bs[0]!.content!.button, { text: "Saytni ochish", url: "https://slaydx.uz/uz" });
  const create = await audit(a.adminId, "broadcasts.create");
  assert.equal(create.length, 1);
  assert.equal(create[0]!.user_agent, "telegram-bot");
  assert.deepEqual(create[0]!.meta, { via: "bot" });
  const send = await audit(a.adminId, "broadcasts.send");
  assert.equal(send.length, 1);
  assert.deepEqual(send[0]!.meta, { audience: { kind: "new_days", days: 7 }, confirmCount: nw, via: "bot" });

  // Delivery: as is, then the admin gets the summary WITH THE ADMIN MENU reply keyboard (other queued broadcasts of the shared DB are stopped first).
  await query("UPDATE broadcasts SET status = 'cancelled' WHERE status IN ('queued','sending') AND id <> $1", [bs[0]!.id]);
  installFetch();
  const out = await deliverBroadcasts({ sleep: async () => undefined, perSecond: 1000 });
  assert.equal(out.sent, nw);
  const delivered = sends().filter((c) => c.body.text === "Salom! Yangi slayd vositasi");
  assert.equal(delivered.length, nw);
  assert.ok(delivered.every((c) => (c.body.reply_markup as { inline_keyboard: Key[][] }).inline_keyboard[0]![0]!.url === "https://slaydx.uz/uz"));
  const notice = sends().find((c) => c.body.chat_id === a.tg && /yuborildi<\/b>/.test(String(c.body.text)));
  assert.ok(notice, "summary to the admin");
  assert.match(String(notice!.body.text), new RegExp(`Xabar #${bs[0]!.id} yuborildi</b>\\nYetkazildi: <b>${groupDigits(nw)}</b> · yetkazilmadi: 0`));
  assert.deepEqual(labels(notice!.body), ["📈 Statistika", "📢 Xabar yuborish", "🔔 Kanal ulash", "💳 To‘lov bonusi", "⬅️ Asosiy menyu"]);
  assert.ok(!JSON.stringify(notice!.body).includes("inline_keyboard"), "no inline buttons on the summary");
  assert.deepEqual(await offered(a.tg), [], "the progress controls are over");
});

test("Xabar yuborish: confirm with a stale count is refused and re-rendered; nothing queued — MUTATSIYA 4", { skip }, async () => {
  const a = await newAdmin("owner");
  await toConfirm(a, "Eslatma", "all");
  const all = (await audienceCount({ kind: "all" })).count;
  assert.ok((await offered(a.tg)).includes(`a:bs:${all}`));
  await newUser(); // the audience grows between the confirm screen and the tap
  installFetch();
  await press(a, acb.bcSend(all));
  assert.equal(sends().length, 1);
  assert.match(String(sends()[0]!.body.text), new RegExp(`^Auditoriya o‘zgardi: hozir ${all + 1} kishi — qayta tasdiqlang\\n\\n`));
  assert.ok((await offered(a.tg)).includes(`a:bs:${all + 1}`), "the confirm button carries the new count");
  const bs = await broadcastsBy(a.adminId);
  assert.equal(bs.length, 1);
  assert.equal(bs[0]!.status, "draft");
  // Cancel: the draft row is cancelled (audited), the admin menu comes back.
  installFetch();
  await press(a, acb.cancel());
  assert.match(String(sends()[0]!.body.text), /^Bekor qilindi\n\n🛠 <b>Admin panel/);
  assert.equal(sends("deleteMessage").length, 0);
  assert.equal((await broadcastsBy(a.adminId))[0]!.status, "cancelled");
  assert.equal((await audit(a.adminId, "broadcasts.cancel")).length, 1);
});

test("Xabar yuborish: photo with caption → sendPhoto; video + button → sendVideo; a sticker is refused", { skip }, async () => {
  const a = await newAdmin("admin");
  installFetch();
  await tg.handleUpdate(textUpdate(a.tg, "📢 Xabar yuborish"));
  installFetch();
  await tg.handleUpdate(mediaUpdate(a.tg, { sticker: { file_id: "CAACAgIAAxkBAAIBsticker" } }));
  assert.match(String(sends()[0]!.body.text), /Faqat matn, rasm yoki video yuboring/);
  assert.deepEqual(await offered(a.tg), [acb.cancel()]);
  installFetch();
  await tg.handleUpdate(
    mediaUpdate(a.tg, {
      photo: [{ file_id: "AgACAgIAAxkBAAIBsmall", width: 90 }, { file_id: "AgACAgIAAxkBAAIBlarge", width: 1280 }],
      caption: "Yangi dizayn",
      caption_entities: [{ type: "italic", offset: 0, length: 5 }],
    }),
  );
  assert.match(String(sends()[0]!.body.text), /Turi: <b>rasm<\/b>/);
  installFetch();
  await press(a, acb.bcAudience());
  installFetch();
  await press(a, acb.bcPick("all"));
  assert.deepEqual(sends("sendPhoto")[0]!.body, {
    chat_id: String(a.tg),
    photo: "AgACAgIAAxkBAAIBlarge",
    caption: "Yangi dizayn",
    caption_entities: [{ type: "italic", offset: 0, length: 5 }],
  });

  installFetch();
  await tg.handleUpdate(textUpdate(a.tg, "📢 Xabar yuborish"));
  await tg.handleUpdate(mediaUpdate(a.tg, { video: { file_id: "BAACAgIAAxkBAAIBvideo1" }, caption: "Qo‘llanma" }));
  await press(a, acb.bcButton());
  await tg.handleUpdate(textUpdate(a.tg, "Ko‘rish\nhttps://slaydx.uz/uz/create"));
  // An OLD inline «Sinov» button of an earlier card: no audience picked yet → expired.
  installFetch();
  await tg.handleUpdate(cbUpdate(a.tg, "a:bt"));
  assert.deepEqual(toasts(), ["Bu qadam eskirgan — qaytadan boshlang"], "no audience picked yet");
  installFetch();
  await press(a, acb.bcAudience());
  await press(a, acb.bcPick("act"));
  installFetch();
  await press(a, acb.bcTest());
  assert.deepEqual(sends("sendVideo")[0]!.body, {
    chat_id: String(a.tg),
    video: "BAACAgIAAxkBAAIBvideo1",
    supports_streaming: true,
    caption: "Qo‘llanma",
    reply_markup: { inline_keyboard: [[{ text: "Ko‘rish", url: "https://slaydx.uz/uz/create" }]] },
  });
  const bs = await broadcastsBy(a.adminId);
  assert.equal(bs.at(-1)!.content!.kind, "video");
  assert.equal(bs.at(-1)!.text, "Qo‘llanma");
});

test("free-text steps: the step's own button labels are checked BEFORE the text is taken as content — MUTATSIYA 8", { skip }, async () => {
  const a = await newAdmin("owner");
  // Content step: typing «Bekor qilish» cancels; it never becomes the broadcast text.
  installFetch();
  await tg.handleUpdate(textUpdate(a.tg, "📢 Xabar yuborish"));
  assert.equal(await stepOf(a.tg), "bc_msg");
  installFetch();
  await tg.handleUpdate(textUpdate(a.tg, "✖️ Bekor qilish"));
  assert.match(String(sends()[0]!.body.text), /^Bekor qilindi\n\n🛠 <b>Admin panel/);
  assert.equal(await stepOf(a.tg), null);
  assert.equal((await broadcastsBy(a.adminId)).length, 0);

  // Button step: «Orqaga» returns to the draft with the draft intact; the label is not read as a button definition.
  installFetch();
  await tg.handleUpdate(textUpdate(a.tg, "📢 Xabar yuborish"));
  await tg.handleUpdate(textUpdate(a.tg, "Qoralama matni"));
  await press(a, acb.bcButton());
  assert.equal(await stepOf(a.tg), "bc_btn");
  installFetch();
  await tg.handleUpdate(textUpdate(a.tg, "⬅️ Orqaga"));
  assert.match(texts()[0]!, /Xabar qabul qilindi/, "back to the draft card");
  assert.ok(!texts().some((t) => /Tushunmadim/.test(t)));
  assert.equal(await stepOf(a.tg), null);
  assert.deepEqual(await offered(a.tg), [acb.bcButton(), acb.bcAudience(), acb.cancel()]);
  const draftText = (await queryOne<{ t: string }>("SELECT draft->>'text' AS t FROM bot_admin_state WHERE chat_id = $1", [a.tg]))!.t;
  assert.equal(draftText, "Qoralama matni", "the draft survived");

  // Channel step: «Bekor qilish» cancels and is never resolved as a channel.
  installFetch();
  await tg.handleUpdate(textUpdate(a.tg, "🔔 Kanal ulash"));
  await press(a, acb.chConnect());
  assert.equal(await stepOf(a.tg), "ch_ref");
  installFetch();
  await tg.handleUpdate(textUpdate(a.tg, "✖️ Bekor qilish"));
  assert.match(texts()[0]!, /^Bekor qilindi/);
  assert.equal(await stepOf(a.tg), null);
  assert.ok(!calls.some((c) => c.method === "getChat"), "the label was never resolved as a channel");
});

test("Kanal ulash: forward from the channel → type → confirm → created (audited); @username; duplicate; toggle; unique labels", { skip }, async () => {
  const a = await newAdmin("owner");
  const chatId = -1_004_000_000_000 - randomInt(0, 999_999_999);
  const uname = `adm_news_${randomInt(0, 99_999)}`;
  chats[String(chatId)] = { id: chatId, type: "channel", title: "Admin <yangiliklar>", username: uname };
  chats[`@${uname}`] = chats[String(chatId)]!;

  installFetch();
  await tg.handleUpdate(textUpdate(a.tg, "🔔 Kanal ulash"));
  assert.match(String(sends()[0]!.body.text), /Bonus kanallar/);
  installFetch();
  await press(a, acb.chConnect());
  assert.match(String(sends()[0]!.body.text), /postni shu yerga <b>forward<\/b>/);
  assert.deepEqual(labels(sends()[0]!.body), ["✖️ Bekor qilish"]);
  installFetch();
  await tg.handleUpdate(textUpdate(a.tg, "salom", { forward_origin: { type: "user", sender_user: { id: 1 } } }));
  assert.match(String(sends()[0]!.body.text), /Bu kanal posti emas/);
  installFetch();
  await tg.handleUpdate(textUpdate(a.tg, "post", { forward_origin: { type: "channel", chat: { id: chatId, type: "channel", title: "x" }, message_id: 5 } }));
  // C-Q2: after resolving, «🔒 Majburiy» / «➕ Ixtiyoriy» first, then the presets of that kind.
  const kindScreen = sends()[0]!.body;
  assert.match(String(kindScreen.text), /Admin &lt;yangiliklar&gt;<\/b>\n@adm_news_\d+ · ID <code>-100\d+<\/code>\n\n✅ Bot kanalda admin\./);
  assert.deepEqual((await keysOf(a.tg)).slice(0, 2).map((k) => [k.text, k.code]), [["🔒 Majburiy", "a:ck:m"], ["➕ Ixtiyoriy", "a:ck:o"]]);
  assert.deepEqual(kb(kindScreen).map((r) => r.length), [2, 1], "«Majburiy» and «Ixtiyoriy» share a row");
  installFetch();
  await press(a, acb.chKind("o"));
  const typeScreen = sends()[0]!.body;
  assert.match(String(typeScreen.text), /Obuna: <b>➕ Ixtiyoriy<\/b>/);
  assert.deepEqual((await keysOf(a.tg)).slice(0, 2).map((k) => k.text), ["📄 Yangiliklar · 2 000 so‘m", "➕ Qo‘shimcha · 1 000 + 7 kunda 2 000"].map(nb));
  installFetch();
  await tg.handleUpdate(cbUpdate(a.tg, "a:cy:z", 601));
  assert.ok(toasts()[0], "a mandatory preset on an optional draft is refused");
  installFetch();
  await press(a, acb.chType("e"));
  assert.ok(String(sends()[0]!.body.text).includes(nb("Obuna bo‘lganda: <b>1 000 so‘m</b>\n7 kun qolsa: yana <b>2 000 so‘m</b>")));
  installFetch();
  await press(a, acb.chCreate("e"));
  assert.match(String(sends()[0]!.body.text), /^✅ Kanal ulandi\n\n[\s\S]*Bonus kanallar/, "the toast is the first line of the list");
  const row = await queryOne<{ id: string; join_bonus: number; stay_bonus: number; stay_days: number; active: boolean; mandatory: boolean }>(
    "SELECT id::text AS id, join_bonus, stay_bonus, stay_days, active, mandatory FROM bonus_channels WHERE chat_id = $1",
    [chatId],
  );
  assert.deepEqual({ ...row, id: undefined }, { id: undefined, join_bonus: 1000, stay_bonus: 2000, stay_days: 7, active: true, mandatory: false });
  const created = await audit(a.adminId, "bonus_channel.create");
  assert.equal(created.length, 1);
  assert.equal(created[0]!.target_id, row!.id);
  assert.equal(created[0]!.user_agent, "telegram-bot");

  // @username of the same channel → «allaqachon ulangan», nothing new.
  installFetch();
  await press(a, acb.chConnect());
  installFetch();
  await tg.handleUpdate(textUpdate(a.tg, `@${uname}`));
  assert.match(String(sends()[0]!.body.text), /allaqachon ulangan/);
  assert.match(String(sends()[1]!.body.text), /Bonus kanallar/, "then the list again");
  assert.equal((await audit(a.adminId, "bonus_channel.create")).length, 1);

  // A new channel by t.me link → 🔒 Majburiy → «Bonussiz» (a mandatory channel may pay nothing).
  const chat2 = chatId - 1;
  const uname2 = `${uname}_b`;
  chats[`@${uname2}`] = { id: chat2, type: "channel", title: "Ikkinchi", username: uname2 };
  chats[String(chat2)] = chats[`@${uname2}`]!;
  installFetch();
  await press(a, acb.chConnect());
  await tg.handleUpdate(textUpdate(a.tg, `https://t.me/${uname2}`));
  installFetch();
  await press(a, acb.chKind("m"));
  const mScreen = sends()[0]!.body;
  assert.match(String(mScreen.text), /Obuna: <b>🔒 Majburiy<\/b>/);
  assert.deepEqual(await offered(a.tg), ["a:cy:m", "a:cy:z", "a:cg", "a:x"]);
  assert.ok(labels(mScreen).includes("⬅️ Orqaga"));
  installFetch();
  await tg.handleUpdate(cbUpdate(a.tg, "a:cy:n", 604));
  assert.ok(toasts()[0], "an optional preset on a mandatory draft is refused");
  installFetch();
  await press(a, acb.chType("z"));
  assert.ok(String(sends().at(-1)!.body.text).includes("Obuna bo‘lganda: <b>bonussiz</b>"));
  // «Orqaga» of the confirm screen goes back to the preset choice, again by a reply tap.
  installFetch();
  await press(a, acb.chTypes());
  assert.deepEqual(await offered(a.tg), ["a:cy:m", "a:cy:z", "a:cg", "a:x"]);
  installFetch();
  await press(a, acb.chType("z"));
  installFetch();
  await press(a, acb.chCreate("z"));
  const r2 = await queryOne<{ id: string; join_bonus: number; stay_bonus: number; mandatory: boolean }>(
    "SELECT id::text AS id, join_bonus, stay_bonus, mandatory FROM bonus_channels WHERE chat_id = $1",
    [chat2],
  );
  assert.deepEqual({ ...r2, id: undefined }, { id: undefined, join_bonus: 0, stay_bonus: 0, mandatory: true });
  const c2 = (await audit(a.adminId, "bonus_channel.create")).find((x) => x.target_id === r2!.id);
  assert.equal((c2!.after as Record<string, unknown>).mandatory, true, "audited as mandatory");
  // The list marks it with 🔒; labels are numbered so they stay unique.
  const listKeys = await keysOf(a.tg);
  const lockKey = listKeys.find((k) => k.code === `a:ct:${r2!.id}`);
  assert.match(lockKey!.text, /^\d+\. ✅ 🔒 Ikkinchi$/);
  assert.ok(listKeys.some((k) => k.code === acb.chConnect()) && listKeys.some((k) => k.code === acb.panel()));

  // Toggle: ⏸ (audited), the list re-rendered with the result as its first line.
  installFetch();
  await press(a, acb.chToggle(row!.id));
  assert.match(String(sends()[0]!.body.text), /^⏸ To‘xtatildi\n\n/);
  assert.equal((await queryOne<{ active: boolean }>("SELECT active FROM bonus_channels WHERE id = $1", [row!.id]))!.active, false);
  const upd = await audit(a.adminId, "bonus_channel.update");
  assert.deepEqual([upd[0]!.after], [{ active: false }]);
  assert.match((await keysOf(a.tg)).find((k) => k.code === `a:ct:${row!.id}`)!.text, /^\d+\. ⏸ /);
  await query("UPDATE bonus_channels SET active = false WHERE chat_id = ANY($1::bigint[])", [[chatId, chat2]]);
});

test("Kanal ulash: two channels with the SAME title get different labels and each toggles its own row; a long title is clipped by code points", { skip }, async () => {
  const a = await newAdmin("owner");
  const title = `Bir xil nom ${"🎓".repeat(40)}`;
  const ids: string[] = [];
  for (let i = 0; i < 2; i++) {
    const r = await queryOne<{ id: string }>(
      `INSERT INTO bonus_channels (chat_id, title, join_bonus, stay_bonus, stay_days, sort, active) VALUES ($1, $2, 1000, 0, 7, $3, true) RETURNING id::text AS id`,
      [-1_007_000_000_000 - randomInt(0, 999_999_999), title, -100 + i],
    );
    ids.push(r!.id);
  }
  installFetch();
  await tg.handleUpdate(textUpdate(a.tg, "🔔 Kanal ulash"));
  const keys = await keysOf(a.tg);
  const l0 = keys.find((k) => k.code === acb.chToggle(ids[0]!))!.text;
  const l1 = keys.find((k) => k.code === acb.chToggle(ids[1]!))!.text;
  assert.notEqual(l0, l1);
  for (const l of [l0, l1]) assert.ok(!l.includes("�") && Array.from(l).length <= 45, l);
  installFetch();
  await tg.handleUpdate(textUpdate(a.tg, l1));
  const rows = await query<{ id: string; active: boolean }>("SELECT id::text AS id, active FROM bonus_channels WHERE id = ANY($1::bigint[]) ORDER BY id", [ids]);
  assert.deepEqual(rows.map((r) => r.active), [true, false], "only the tapped row changed");
  await query("UPDATE bonus_channels SET active = false WHERE id = ANY($1::bigint[])", [ids]);
});

test("2FA mode: an un-enrolled admin has no panel; an enrolled one must give a code before a confirmed change — also when the confirm is a REPLY tap — MUTATSIYA 7", { skip }, async () => {
  const plain = await newAdmin("owner");
  const enrolled = await newAdmin("owner");
  await query("UPDATE admin_accounts SET totp_secret_enc = 'sealed', totp_enabled_at = now() WHERE id = $1", [enrolled.adminId]);
  const ch = await queryOne<{ id: string }>(
    `INSERT INTO bonus_channels (chat_id, title, join_bonus, stay_bonus, stay_days, sort, active) VALUES ($1, 'Tfa', 1000, 0, 7, 50, false) RETURNING id::text AS id`,
    [-1_005_000_000_000 - randomInt(0, 999_999_999)],
  );
  process.env.ADMIN_2FA_REQUIRED = "1";
  try {
    installFetch();
    await tg.handleUpdate(cbUpdate(plain.tg, "a:s"));
    assert.deepEqual(toasts(), ["Ruxsat yo‘q"]);
    installFetch();
    await tg.handleUpdate(textUpdate(plain.tg, "📈 Statistika"));
    assert.ok(!texts().some((t) => /Foydalanuvchilar/.test(t)), "an un-enrolled admin gets no reply screen either");
    installFetch();
    await tg.handleUpdate(textUpdate(enrolled.tg, "🔔 Kanal ulash"));
    installFetch();
    await press(enrolled, acb.chToggle(ch!.id));
    assert.match(String(sends()[0]!.body.text), /6 xonali kodni/);
    assert.deepEqual(labels(sends()[0]!.body), ["✖️ Bekor qilish"]);
    assert.equal(await stepOf(enrolled.tg), "totp");
    assert.equal((await queryOne<{ active: boolean }>("SELECT active FROM bonus_channels WHERE id = $1", [ch!.id]))!.active, false, "nothing changed yet");
    installFetch();
    await tg.handleUpdate(textUpdate(enrolled.tg, "12ab"));
    assert.ok(calls.some((c) => c.method === "deleteMessage"), "the code message is removed");
    assert.match(String(sends()[0]!.body.text), /6 xonali/);
    assert.equal(await stepOf(enrolled.tg), "totp", "still waiting for a valid code");
    // «Bekor qilish» at the code step drops it; the change never happens.
    installFetch();
    await press(enrolled, acb.cancel());
    assert.equal(await stepOf(enrolled.tg), null);
    assert.equal((await queryOne<{ active: boolean }>("SELECT active FROM bonus_channels WHERE id = $1", [ch!.id]))!.active, false);
  } finally {
    delete process.env.ADMIN_2FA_REQUIRED;
  }
});

test("Xabar yuborish: a CONCURRENT double tap on «Yuborish» without a test creates and queues exactly ONE broadcast (review MAJOR)", { skip }, async () => {
  const a = await newAdmin("owner");
  await toConfirm(a, "Ikki marta bosish sinovi");
  const nw = (await audienceCount({ kind: "new_days", days: 7 })).count;
  const label = await labelFor(a.tg, acb.bcSend(nw));
  installFetch();
  // Two separate updates (different update ids) handled at the same time — no earlier test send.
  // MUTATION: without the per-chat lock in ensureBroadcast both taps created their own broadcast row.
  await Promise.all([tg.handleUpdate(textUpdate(a.tg, label)), tg.handleUpdate(textUpdate(a.tg, label))]);
  const bs = await broadcastsBy(a.adminId);
  assert.equal(bs.length, 1, "exactly one broadcast row");
  assert.equal(bs[0]!.status, "queued");
  assert.equal((await audit(a.adminId, "broadcasts.send")).length, 1, "queued once");
});

test("Progress card: reply controls (pause / resume / refresh / stop), the engine edits the SAME message as text, support cannot pause (docs/bonus/BONUS3.md C-Q5)", { skip }, async () => {
  const a = await newAdmin("owner");
  const viewer = await newAdmin("support");
  await toConfirm(a, "Pauza va davom ettirish");
  const nw = (await audienceCount({ kind: "new_days", days: 7 })).count;
  installFetch();
  await press(a, acb.bcSend(nw));
  const [b] = await broadcastsBy(a.adminId);
  assert.ok(b);
  assert.equal(b!.status, "queued");
  const card1 = msgSeq;
  assert.equal((b!.content!.notify as { messageId?: number }).messageId, card1, "the progress message is remembered for the engine");
  assert.deepEqual(await offered(a.tg), ["a:bp:" + b!.id, "a:bw:" + b!.id, "a:bc:" + b!.id, "a:h"]);
  assert.deepEqual(labels(sends()[0]!.body), ["🔄 Yangilash", "⏳ Pauza", "⛔ To‘xtatish", "🛠 Admin panel"]);

  // Pause → «pauzada», the keyboard flips to «Davom ettirish»; the superseded card is removed and the engine follows the new one.
  installFetch();
  await press(a, acb.bcPause(b!.id));
  assert.match(String(sends()[0]!.body.text), /^⏸ Pauzada\n\n/);
  assert.match(String(sends()[0]!.body.text), /Holat: <b>pauzada<\/b>/);
  assert.deepEqual(await offered(a.tg), ["a:bp:" + b!.id, "a:br:" + b!.id, "a:bc:" + b!.id, "a:h"]);
  const card2 = msgSeq;
  assert.deepEqual(sends("deleteMessage").map((c) => c.body.message_id), [card1], "the old card is removed");
  assert.equal(((await broadcastsBy(a.adminId))[0]!.content!.notify as { messageId?: number }).messageId, card2);
  assert.equal((await broadcastsBy(a.adminId))[0]!.status, "paused");
  const pa = await audit(a.adminId, "broadcasts.pause");
  assert.equal(pa.length, 1);
  assert.deepEqual(pa[0]!.meta, { via: "bot" });

  // Support (broadcasts.view only) cannot pause or resume.
  installFetch();
  await tg.handleUpdate(cbUpdate(viewer.tg, `a:br:${b!.id}`, 970));
  assert.deepEqual(toasts(), ["Ruxsat yo‘q"]);
  assert.equal((await broadcastsBy(a.adminId))[0]!.status, "paused");

  // The engine's in-place edit: editMessageText on the CURRENT card with the live text, no inline buttons.
  installFetch();
  const { editBroadcastProgress } = await import("../lib/server/bot/admin.ts");
  await editBroadcastProgress(b!.id, { chatId: String(a.tg), lang: "uz", messageId: card2 });
  assert.equal(edits().length, 1);
  assert.equal(edits()[0]!.body.message_id, card2);
  assert.equal(edits()[0]!.body.chat_id, a.tg);
  assert.match(String(edits()[0]!.body.text), /Holat: <b>pauzada<\/b>/);
  assert.deepEqual(edits()[0]!.body.reply_markup, { inline_keyboard: [] }, "text only: the controls are the reply keyboard");
  assert.equal(sends().length, 0, "never a new message");

  // «Yangilash» sends a fresh card (and removes the old one).
  installFetch();
  await press(a, acb.bcProgress(b!.id));
  assert.match(String(sends()[0]!.body.text), /^Yangilandi\n\n/);
  assert.deepEqual(sends("deleteMessage").map((c) => c.body.message_id), [card2]);

  // Resume → never started → back to «navbatda».
  installFetch();
  await press(a, acb.bcResume(b!.id));
  assert.match(String(sends()[0]!.body.text), /^▶️ Davom etmoqda\n\n/);
  assert.match(String(sends()[0]!.body.text), /Holat: <b>navbatda<\/b>/);
  assert.equal((await broadcastsBy(a.adminId))[0]!.status, "queued");
  // A stale second tap on «Davom ettirish» of an old inline card is harmless.
  installFetch();
  await tg.handleUpdate(cbUpdate(a.tg, `a:br:${b!.id}`, 962));
  assert.match(String(sends()[0]!.body.text), /Holat: <b>navbatda<\/b>/, "409 swallowed, the card shows the truth");

  // Stop: ask, «Orqaga» returns to the card, then the confirmed stop.
  installFetch();
  await press(a, acb.bcStopAsk(b!.id));
  assert.deepEqual(await offered(a.tg), [`a:bk:${b!.id}`, `a:bp:${b!.id}`]);
  installFetch();
  await press(a, acb.bcProgress(b!.id));
  installFetch();
  await press(a, acb.bcStopAsk(b!.id));
  installFetch();
  await press(a, acb.bcStop(b!.id));
  assert.match(String(sends()[0]!.body.text), /^⛔ To‘xtatildi\n\n/);
  assert.equal((await broadcastsBy(a.adminId))[0]!.status, "cancelled");
  assert.equal((await audit(a.adminId, "broadcasts.cancel")).length, 1);
});

test("Progress card text: speed and ETA while sending; the abort reason when failed; the controls are reply buttons", async () => {
  const base = {
    id: "9", status: "sending", text: "x", audience: { kind: "all" }, total: 1000, sent: 100, failed: 0, createdBy: null, createdByName: null,
    createdAt: "", queuedAt: null, finishedAt: null, startedAt: null, heartbeatAt: null, failReason: null,
  } as unknown as import("../lib/server/admin-broadcasts.ts").AdminBroadcast;
  const stats = { total: 1000, sent: 100, failed: 0, pending: 900, inFlight: 8, retrying: 0, speed: 24.8, etaSeconds: 90, failedReasons: [] };
  const { progressScreen } = await import("../lib/server/bot/admin-screens.ts");
  const live = progressScreen("uz", base, stats, true);
  assert.match(live.text, /Tezlik: 24\.8 ta\/s · taxminan 1 min 30 s qoldi/);
  assert.deepEqual(live.keys.map((k) => k.code), ["a:bp:9", "a:bw:9", "a:bc:9", "a:h"]);
  assert.ok(!JSON.stringify(live.reply_markup).includes("inline_keyboard"));
  const failed = progressScreen("uz", { ...base, status: "failed", failReason: "Birinchi 200 ta yuborish muvaffaqiyatsiz <x>" }, { ...stats, speed: 0, etaSeconds: null }, true);
  assert.match(failed.text, /xato bilan to‘xtatildi/);
  assert.match(failed.text, /Birinchi 200 ta yuborish muvaffaqiyatsiz &lt;x&gt;/, "escaped");
  assert.ok(!/Tezlik/.test(failed.text));
  const paused = progressScreen("uz", { ...base, status: "paused" }, { ...stats, speed: 0, etaSeconds: null }, true);
  assert.ok(paused.keys.some((k) => k.code === "a:br:9"));
  const noPerm = progressScreen("uz", base, stats, false);
  assert.ok(!noPerm.keys.some((k) => k.code === "a:bw:9" || k.code === "a:bc:9"), "no pause / stop button without broadcasts.send");
});

test("screen buttons: the stored label → code map equals the keyboard on the wire, in plain and premium-emoji mode", async () => {
  const { draftScreen, audienceScreen, channelKindScreen } = await import("../lib/server/bot/admin-screens.ts");
  const draft = { t: "bc", text: "Salom", content: { kind: "text" as const, button: { text: "Ochish", url: "https://slaydx.uz" } } } as const;
  const chan = { t: "ch", chatId: "-1001", title: "Kanal", username: null, botAdmin: "admin" } as const;
  for (const premium of [false, true]) {
    if (premium) process.env.BOT_PREMIUM_EMOJI = "1";
    else delete process.env.BOT_PREMIUM_EMOJI;
    try {
      for (const s of [draftScreen("uz", draft), audienceScreen("uz", { all: 5, act: 3, new: 1 }), channelKindScreen("uz", chan)]) {
        const wire = (s.reply_markup as { keyboard: Key[][] }).keyboard.flat().map((b) => b.text);
        assert.deepEqual(s.keys.map((k) => k.text), wire, `premium=${premium}`);
        assert.equal(new Set(wire).size, wire.length);
        assert.ok(!JSON.stringify(s.reply_markup).includes("callback_data"), "no callback data in a reply keyboard");
      }
    } finally {
      delete process.env.BOT_PREMIUM_EMOJI;
    }
  }
});
