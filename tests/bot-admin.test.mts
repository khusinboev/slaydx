import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomInt } from "node:crypto";

/**
 * In-bot admin panel end to end (docs/bot-admin/PLAN.md): every update goes
 * through `handleUpdate` with the Bot API stubbed at `fetch`; real Postgres
 * (fresh test DB only), synthetic Telegram ids.
 *
 * Mutations (each turned a test red, then restored):
 *   1. `lookupAdmin` without the `is_blocked` check → «blocked admin gets nothing»;
 *   2. `lookupAdmin` accepting `disabled` accounts → «revoked admin gets nothing»;
 *   3. `handleAdminCallback` without the per-action `allowed()` check → «viewer: stats only»;
 *   4. `bcSend` passing the CURRENT audience count instead of the tapped one → «confirm count changed»;
 *   5. `bcSend` without clearing the draft after queueing → «confirm creates exactly one broadcast».
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
const nb = (s: string) => s.replace(/(\d) (\d)/g, "$1\u00a0$2");
if (hasDb) await ensureMigrated();

type Call = { method: string; body: Record<string, unknown> };
let calls: Call[] = [];
let msgSeq = 1000;
/** getChat answers by chat_id / @username. */
const chats: Record<string, { id: number; type: string; title: string; username?: string }> = {};
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
    if (/^send(Message|Photo|Video)$/.test(method)) return ok({ message_id: ++msgSeq });
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
const cbUpdate = (from: number, data: string, messageId = 555) => ({
  update_id: ++seq,
  callback_query: { id: `cq${++seq}`, from: { id: from }, message: { message_id: messageId, chat: { id: from, type: "private" } }, data },
});
const sends = (method = "sendMessage") => calls.filter((c) => c.method === method);
const edits = () => calls.filter((c) => c.method === "editMessageText");
const toasts = () => calls.filter((c) => c.method === "answerCallbackQuery").map((c) => c.body.text as string | undefined);
type Btn = { text: string; callback_data?: string; url?: string; style?: string };
const buttons = (body: Record<string, unknown>): Btn[] => ((body.reply_markup as { inline_keyboard?: Btn[][] } | undefined)?.inline_keyboard ?? []).flat();
const datas = (body: Record<string, unknown>) => buttons(body).map((b) => b.callback_data).filter(Boolean);
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
  const kb = (sends()[0]!.body.reply_markup as { keyboard: Array<Array<{ request_contact?: boolean }>> }).keyboard;
  assert.equal(kb[0]![0]!.request_contact, true, "contact-sharing flow");
  installFetch();
  await tg.handleUpdate(textUpdate(u.tg, "🛠 Admin"));
  assert.equal(sends().length, 1);
  assert.doesNotMatch(String(sends()[0]!.body.text), /Admin panel/, "ordinary text for a non-admin");
  installFetch();
  await tg.handleUpdate(textUpdate(u.tg, "/start"));
  const rows = (sends().at(-1)!.body.reply_markup as { keyboard: Btn[][] }).keyboard;
  assert.ok(!rows.flat().some((b) => /Admin/.test(b.text)), "no «🛠 Admin» row");
});

test("access: an owner — /admin opens the admin menu as a REPLY keyboard (owner C-Q6); a tap runs the action; «Asosiy menyu» restores the main keyboard", { skip }, async () => {
  const a = await newAdmin("owner");
  installFetch();
  await tg.handleUpdate(textUpdate(a.tg, "/admin"));
  const panel = sends()[0]!.body;
  assert.match(String(panel.text), /^🛠 <b>Admin panel<\/b>\n\nAdmin Bot, rolingiz: <b>ega<\/b>\./);
  const kb = (panel.reply_markup as { keyboard: Btn[][]; is_persistent: boolean }).keyboard;
  // MUTATION: the old inline panel (buttons under the message) instead of the bottom keyboard.
  assert.deepEqual(kb.map((r) => r.map((b) => `${b.text}${b.style ? `(${b.style})` : ""}`)), [
    ["📈 Statistika(primary)", "📢 Xabar yuborish"],
    ["🔔 Kanal ulash", "💳 To‘lov bonusi"],
    ["⬅️ Asosiy menyu"],
  ]);
  installFetch();
  await tg.handleUpdate(textUpdate(a.tg, "🛠 Admin"));
  assert.match(String(sends()[0]!.body.text), /Admin panel/);

  installFetch();
  await tg.handleUpdate(textUpdate(a.tg, "📈 Statistika"));
  assert.equal(sends()[0]!.body.text, "⏳");
  assert.match(String(edits()[0]!.body.text), /Foydalanuvchilar/, "the stats card replaces the placeholder");

  installFetch();
  await tg.handleUpdate(textUpdate(a.tg, "⬅️ Asosiy menyu"));
  const main = (sends()[0]!.body.reply_markup as { keyboard: Btn[][] }).keyboard;
  assert.deepEqual(main.at(-1), [{ text: "🛠 Admin", style: "primary" }], "main keyboard with the admin row");
  assert.ok(main.flat().some((b) => /Slayd/.test(b.text)));
});

test("admin reply menu: a NON-admin typing «Statistika» / «Asosiy menyu» gets no admin screen (text falls through)", { skip }, async () => {
  const u = await newUser();
  for (const text of ["📈 Statistika", "⬅️ Asosiy menyu"]) {
    installFetch();
    await tg.handleUpdate(textUpdate(u.tg, text));
    assert.ok(!sends().some((m) => m.body.text === "⏳" || /Foydalanuvchilar|Admin panel/.test(String(m.body.text))), text);
    // MUTATION: the menu handler swallowing a non-admin's text — the usual bot reply must still come.
    assert.ok(sends().length >= 1, `${text}: the ordinary reply still arrives`);
  }
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

test("access: viewer sees Statistika only (no bonus section); a broadcast tap is refused and audited — MUTATSIYA 3", { skip }, async () => {
  const v = await newAdmin("viewer");
  installFetch();
  await tg.handleUpdate(textUpdate(v.tg, "/admin"));
  const vkb = (sends()[0]!.body.reply_markup as { keyboard: Btn[][] }).keyboard;
  assert.deepEqual(vkb.flat().map((b) => b.text), ["📈 Statistika", "🔔 Kanal ulash", "💳 To‘lov bonusi", "⬅️ Asosiy menyu"], "viewer has bonus.view + settings.view, not broadcasts.send");
  const s = await newAdmin("support");
  installFetch();
  await tg.handleUpdate(cbUpdate(s.tg, "a:b"));
  assert.deepEqual(toasts(), ["Ruxsat yo‘q"]);
  assert.equal(edits().length, 0);
  const rows = await audit(s.adminId, "auth.denied");
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.outcome, "denied");
  assert.deepEqual(rows[0]!.meta, { permission: "broadcasts.send", scope: "bot/admin" });
  installFetch();
  await tg.handleUpdate(cbUpdate(s.tg, "a:s"));
  const text = String(edits()[0]!.body.text);
  assert.match(text, /Foydalanuvchilar/);
  assert.doesNotMatch(text, /Bonuslar/, "support has no bonus.view");
  installFetch();
  await tg.handleUpdate(cbUpdate(s.tg, "a:ct:1"));
  assert.deepEqual(toasts(), ["Ruxsat yo‘q"]);
});

test("Statistika: numbers from the database, grouped digits, bonuses by type, channel members", { skip }, async () => {
  const a = await newAdmin("owner");
  const chat = -1_003_000_000_000 - randomInt(0, 999_999_999);
  await query(`INSERT INTO bonus_channels (chat_id, username, title, join_bonus, stay_bonus, stay_days, sort) VALUES ($1, 'stat_news', 'Stat <kanal>', 2000, 0, 7, -5)`, [chat]);
  installFetch();
  await tg.handleUpdate(cbUpdate(a.tg, "a:s", 88));
  const text = String(edits()[0]!.body.text);
  const total = Number((await queryOne<{ n: string }>("SELECT count(*)::text AS n FROM users"))!.n);
  assert.match(text, new RegExp(`Jami: <b>${groupDigits(total)}</b> · bugun \\+\\d`));
  assert.match(text, /Faol \(30 kun\): <b>\d/);
  assert.match(text, /Bugun: <b>\d+<\/b> · 7 kun: <b>\d+<\/b>/);
  assert.match(text, /Tushum \(so‘m\)/);
  const signup = await queryOne<{ s: string; n: string }>("SELECT sum(points_delta)::text AS s, count(*)::text AS n FROM transactions WHERE kind = 'bonus' AND reference LIKE 'signup:%'");
  assert.ok(text.includes(`Ro‘yxatdan o‘tish: <b>${groupDigits(Number(signup!.s))} so‘m</b> (${groupDigits(Number(signup!.n))} ta)`), text);
  assert.ok(text.includes(nb("Stat &lt;kanal&gt;: <b>1 234</b> obunachi · bonus orqali 0")), "escaped title, getChatMemberCount");
  assert.deepEqual(datas(edits()[0]!.body), ["a:s", "a:h"]);
  await query("UPDATE bonus_channels SET active = false WHERE chat_id = $1", [chat]);
});

test("Xabar yuborish: text + bold + button → audience counts → preview → test → confirm creates exactly ONE broadcast, delivered as is — MUTATSIYA 5", { skip }, async () => {
  const a = await newAdmin("owner");
  installFetch();
  await tg.handleUpdate(cbUpdate(a.tg, "a:b", 900));
  assert.match(String(edits()[0]!.body.text), /Xabar yuborish<\/b>\n\nFoydalanuvchilarga yuboriladigan xabarni/);

  installFetch();
  const entities = [{ type: "bold", offset: 0, length: 6 }, { type: "mention", offset: 7, length: 3 }];
  await tg.handleUpdate(textUpdate(a.tg, "Salom! Yangi slayd vositasi", { entities }));
  const draft = sends()[0]!.body;
  assert.match(String(draft.text), /Xabar qabul qilindi<\/b>\n\nTuri: <b>matn<\/b> · 27 belgi\nTugma: yo‘q/);
  assert.deepEqual(datas(draft), ["a:bb", "a:ba", "a:x"]);

  installFetch();
  await tg.handleUpdate(cbUpdate(a.tg, "a:bb", 901));
  installFetch();
  await tg.handleUpdate(textUpdate(a.tg, "Saytni ochish | ftp://bad"));
  assert.match(String(sends()[0]!.body.text), /Tushunmadim/);
  installFetch();
  await tg.handleUpdate(textUpdate(a.tg, "Saytni ochish | https://slaydx.uz/uz"));
  assert.match(String(sends()[0]!.body.text), /Tugma: <b>Saytni ochish<\/b> → https:\/\/slaydx\.uz\/uz/);

  installFetch();
  await tg.handleUpdate(cbUpdate(a.tg, "a:ba", 902));
  const aud = edits()[0]!.body;
  const all = (await audienceCount({ kind: "all" })).count;
  const act = (await audienceCount({ kind: "active_days", days: 30 })).count;
  const nw = (await audienceCount({ kind: "new_days", days: 7 })).count;
  assert.deepEqual(
    buttons(aud).slice(0, 3).map((b) => [b.text, b.callback_data]),
    [
      [`👥 Hamma · ${groupDigits(all)}`, "a:bu:all"],
      [`🔥 Faollar (30 kun) · ${groupDigits(act)}`, "a:bu:act"],
      [`🆕 Yangilar (7 kun) · ${groupDigits(nw)}`, "a:bu:new"],
    ],
  );

  installFetch();
  await tg.handleUpdate(cbUpdate(a.tg, "a:bu:new", 902));
  const [preview, confirm] = sends();
  assert.deepEqual(preview!.body, {
    chat_id: String(a.tg),
    text: "Salom! Yangi slayd vositasi",
    entities: [{ type: "bold", offset: 0, length: 6 }],
    reply_markup: { inline_keyboard: [[{ text: "Saytni ochish", url: "https://slaydx.uz/uz" }]] },
  });
  assert.match(String(confirm!.body.text), new RegExp(`Auditoriya: <b>Yangilar \\(7 kun\\)</b> — <b>${groupDigits(nw)}</b> kishi`));
  assert.deepEqual(datas(confirm!.body), ["a:bt", `a:bs:${nw}`, "a:ba", "a:x"]);
  assert.equal((await broadcastsBy(a.adminId)).length, 0, "nothing created before a test or the send");

  installFetch();
  await tg.handleUpdate(cbUpdate(a.tg, "a:bt", 903));
  assert.deepEqual(toasts(), ["🧪 Sinov xabari yuborildi"]);
  assert.equal(sends()[0]!.body.chat_id, String(a.tg));
  assert.deepEqual(sends()[0]!.body.entities, [{ type: "bold", offset: 0, length: 6 }]);
  assert.equal((await broadcastsBy(a.adminId)).length, 1);
  assert.equal((await audit(a.adminId, "broadcasts.test"))[0]!.meta!.via, "bot");

  installFetch();
  await tg.handleUpdate(cbUpdate(a.tg, `a:bs:${nw}`, 903));
  assert.deepEqual(toasts(), ["✅ Navbatga qo‘yildi"]);
  assert.match(String(edits()[0]!.body.text), /Holat: <b>navbatda<\/b>/);
  installFetch();
  await tg.handleUpdate(cbUpdate(a.tg, `a:bs:${nw}`, 903));
  assert.deepEqual(toasts(), ["Bu qadam eskirgan — qaytadan boshlang"], "a second tap sends nothing");

  const bs = await broadcastsBy(a.adminId);
  assert.equal(bs.length, 1, "exactly one broadcast");
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

  // Delivery: as is, then the admin gets the summary (other queued broadcasts of the shared DB are stopped first).
  await query("UPDATE broadcasts SET status = 'cancelled' WHERE status IN ('queued','sending') AND id <> $1", [bs[0]!.id]);
  installFetch();
  const out = await deliverBroadcasts({ sleep: async () => undefined, perSecond: 1000 });
  assert.equal(out.sent, nw);
  const delivered = sends().filter((c) => c.body.text === "Salom! Yangi slayd vositasi");
  assert.equal(delivered.length, nw);
  assert.ok(delivered.every((c) => (c.body.reply_markup as { inline_keyboard: Btn[][] }).inline_keyboard[0]![0]!.url === "https://slaydx.uz/uz"));
  const notice = sends().find((c) => c.body.chat_id === a.tg && /yuborildi<\/b>/.test(String(c.body.text)));
  assert.ok(notice, "summary to the admin");
  assert.match(String(notice!.body.text), new RegExp(`Xabar #${bs[0]!.id} yuborildi</b>\\nYetkazildi: <b>${groupDigits(nw)}</b> · yetkazilmadi: 0`));
});

test("Xabar yuborish: confirm with a stale count is refused and re-rendered; nothing queued — MUTATSIYA 4", { skip }, async () => {
  const a = await newAdmin("owner");
  installFetch();
  await tg.handleUpdate(cbUpdate(a.tg, "a:b"));
  await tg.handleUpdate(textUpdate(a.tg, "Eslatma"));
  await tg.handleUpdate(cbUpdate(a.tg, "a:bu:all"));
  const all = (await audienceCount({ kind: "all" })).count;
  installFetch();
  await tg.handleUpdate(cbUpdate(a.tg, `a:bs:${all + 5}`, 321));
  assert.deepEqual(toasts(), [`Auditoriya o‘zgardi: hozir ${all} kishi — qayta tasdiqlang`]);
  assert.ok(datas(edits()[0]!.body).includes(`a:bs:${all}`));
  const bs = await broadcastsBy(a.adminId);
  assert.equal(bs.length, 1);
  assert.equal(bs[0]!.status, "draft");
  // Cancel: the draft row is cancelled (audited), the panel comes back.
  installFetch();
  await tg.handleUpdate(cbUpdate(a.tg, "a:x", 321));
  assert.deepEqual(toasts(), ["Bekor qilindi"]);
  assert.equal((await broadcastsBy(a.adminId))[0]!.status, "cancelled");
  assert.equal((await audit(a.adminId, "broadcasts.cancel")).length, 1);
});

test("Xabar yuborish: photo with caption → sendPhoto; video + button → sendVideo; a sticker is refused", { skip }, async () => {
  const a = await newAdmin("admin");
  installFetch();
  await tg.handleUpdate(cbUpdate(a.tg, "a:b"));
  installFetch();
  await tg.handleUpdate(mediaUpdate(a.tg, { sticker: { file_id: "CAACAgIAAxkBAAIBsticker" } }));
  assert.match(String(sends()[0]!.body.text), /Faqat matn, rasm yoki video yuboring/);
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
  await tg.handleUpdate(cbUpdate(a.tg, "a:bu:all"));
  assert.deepEqual(sends("sendPhoto")[0]!.body, {
    chat_id: String(a.tg),
    photo: "AgACAgIAAxkBAAIBlarge",
    caption: "Yangi dizayn",
    caption_entities: [{ type: "italic", offset: 0, length: 5 }],
  });

  installFetch();
  await tg.handleUpdate(cbUpdate(a.tg, "a:b"));
  await tg.handleUpdate(mediaUpdate(a.tg, { video: { file_id: "BAACAgIAAxkBAAIBvideo1" }, caption: "Qo‘llanma" }));
  await tg.handleUpdate(cbUpdate(a.tg, "a:bb"));
  await tg.handleUpdate(textUpdate(a.tg, "Ko‘rish\nhttps://slaydx.uz/uz/create"));
  installFetch();
  await tg.handleUpdate(cbUpdate(a.tg, "a:bt"));
  assert.deepEqual(toasts(), ["Bu qadam eskirgan — qaytadan boshlang"], "no audience picked yet");
  installFetch();
  await tg.handleUpdate(cbUpdate(a.tg, "a:bu:act"));
  installFetch();
  await tg.handleUpdate(cbUpdate(a.tg, "a:bt"));
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

test("Kanal ulash: forward from the channel → type → confirm → created (audited); @username; duplicate; toggle", { skip }, async () => {
  const a = await newAdmin("owner");
  const chatId = -1_004_000_000_000 - randomInt(0, 999_999_999);
  const uname = `adm_news_${randomInt(0, 99_999)}`;
  chats[String(chatId)] = { id: chatId, type: "channel", title: "Admin <yangiliklar>", username: uname };
  chats[`@${uname}`] = chats[String(chatId)]!;

  installFetch();
  await tg.handleUpdate(cbUpdate(a.tg, "a:c", 600));
  assert.match(String(edits()[0]!.body.text), /Bonus kanallar/);
  installFetch();
  await tg.handleUpdate(cbUpdate(a.tg, "a:cn", 600));
  assert.match(String(edits()[0]!.body.text), /postni shu yerga <b>forward<\/b>/);
  installFetch();
  await tg.handleUpdate(textUpdate(a.tg, "salom", { forward_origin: { type: "user", sender_user: { id: 1 } } }));
  assert.match(String(sends()[0]!.body.text), /Bu kanal posti emas/);
  installFetch();
  await tg.handleUpdate(textUpdate(a.tg, "post", { forward_origin: { type: "channel", chat: { id: chatId, type: "channel", title: "x" }, message_id: 5 } }));
  // C-Q2: after resolving, «🔒 Majburiy» / «➕ Ixtiyoriy» first, then the presets of that kind.
  const kindScreen = sends()[0]!.body;
  assert.match(String(kindScreen.text), /Admin &lt;yangiliklar&gt;<\/b>\n@adm_news_\d+ · ID <code>-100\d+<\/code>\n\n✅ Bot kanalda admin\./);
  assert.deepEqual(buttons(kindScreen).slice(0, 2).map((b) => [b.text, b.callback_data]), [["🔒 Majburiy", "a:ck:m"], ["➕ Ixtiyoriy", "a:ck:o"]]);
  installFetch();
  await tg.handleUpdate(cbUpdate(a.tg, "a:ck:o", 601));
  const typeScreen = edits()[0]!.body;
  assert.match(String(typeScreen.text), /Obuna: <b>➕ Ixtiyoriy<\/b>/);
  assert.deepEqual(buttons(typeScreen).slice(0, 2).map((b) => b.text), ["📄 Yangiliklar · 2 000 so‘m", "➕ Qo‘shimcha · 1 000 + 7 kunda 2 000"].map(nb));
  installFetch();
  await tg.handleUpdate(cbUpdate(a.tg, "a:cy:z", 601));
  assert.ok(toasts()[0], "a mandatory preset on an optional draft is refused");
  installFetch();
  await tg.handleUpdate(cbUpdate(a.tg, "a:cy:e", 601));
  assert.ok(String(edits()[0]!.body.text).includes(nb("Obuna bo‘lganda: <b>1 000 so‘m</b>\n7 kun qolsa: yana <b>2 000 so‘m</b>")));
  installFetch();
  await tg.handleUpdate(cbUpdate(a.tg, "a:cc:e", 601));
  assert.deepEqual(toasts(), ["✅ Kanal ulandi"]);
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
  await tg.handleUpdate(cbUpdate(a.tg, "a:cn", 602));
  installFetch();
  await tg.handleUpdate(textUpdate(a.tg, `@${uname}`));
  assert.match(String(sends()[0]!.body.text), /allaqachon ulangan/);
  assert.equal((await audit(a.adminId, "bonus_channel.create")).length, 1);

  // A new channel by t.me link → 🔒 Majburiy → «Bonussiz» (a mandatory channel may pay nothing).
  const chat2 = chatId - 1;
  const uname2 = `${uname}_b`;
  chats[`@${uname2}`] = { id: chat2, type: "channel", title: "Ikkinchi", username: uname2 };
  chats[String(chat2)] = chats[`@${uname2}`]!;
  installFetch();
  await tg.handleUpdate(cbUpdate(a.tg, "a:cn", 603));
  await tg.handleUpdate(textUpdate(a.tg, `https://t.me/${uname2}`));
  installFetch();
  await tg.handleUpdate(cbUpdate(a.tg, "a:ck:m", 604));
  const mScreen = edits()[0]!.body;
  assert.match(String(mScreen.text), /Obuna: <b>🔒 Majburiy<\/b>/);
  assert.deepEqual(buttons(mScreen).slice(0, 3).map((b) => b.callback_data), ["a:cy:m", "a:cy:z", "a:cg"]);
  installFetch();
  await tg.handleUpdate(cbUpdate(a.tg, "a:cy:n", 604));
  assert.ok(toasts()[0], "an optional preset on a mandatory draft is refused");
  await tg.handleUpdate(cbUpdate(a.tg, "a:cy:z", 604));
  assert.ok(String(edits().at(-1)!.body.text).includes("Obuna bo‘lganda: <b>bonussiz</b>"));
  await tg.handleUpdate(cbUpdate(a.tg, "a:cc:z", 604));
  const r2 = await queryOne<{ id: string; join_bonus: number; stay_bonus: number; mandatory: boolean }>(
    "SELECT id::text AS id, join_bonus, stay_bonus, mandatory FROM bonus_channels WHERE chat_id = $1",
    [chat2],
  );
  assert.deepEqual({ ...r2, id: undefined }, { id: undefined, join_bonus: 0, stay_bonus: 0, mandatory: true });
  const c2 = (await audit(a.adminId, "bonus_channel.create")).find((x) => x.target_id === r2!.id);
  assert.equal((c2!.after as Record<string, unknown>).mandatory, true, "audited as mandatory");
  // The list marks it with 🔒.
  installFetch();
  await tg.handleUpdate(cbUpdate(a.tg, "a:c", 604));
  assert.ok(buttons(edits()[0]!.body).some((b) => b.callback_data === `a:ct:${r2!.id}` && b.text.includes("🔒 Ikkinchi")));

  // Toggle: ⏸ (audited), the list re-rendered.
  installFetch();
  await tg.handleUpdate(cbUpdate(a.tg, `a:ct:${row!.id}`, 605));
  assert.deepEqual(toasts(), ["⏸ To‘xtatildi"]);
  assert.equal((await queryOne<{ active: boolean }>("SELECT active FROM bonus_channels WHERE id = $1", [row!.id]))!.active, false);
  const upd = await audit(a.adminId, "bonus_channel.update");
  assert.deepEqual([upd[0]!.after], [{ active: false }]);
  assert.ok(buttons(edits()[0]!.body).some((b) => b.callback_data === `a:ct:${row!.id}` && b.text.startsWith("⏸")));
  await query("UPDATE bonus_channels SET active = false WHERE chat_id = ANY($1::bigint[])", [[chatId, chat2]]);
});

test("2FA mode: an un-enrolled admin has no panel; an enrolled one must give a code before a confirmed change", { skip }, async () => {
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
    await tg.handleUpdate(cbUpdate(enrolled.tg, `a:ct:${ch!.id}`, 700));
    assert.match(String(edits()[0]!.body.text), /6 xonali kodni/);
    assert.equal((await queryOne<{ active: boolean }>("SELECT active FROM bonus_channels WHERE id = $1", [ch!.id]))!.active, false, "nothing changed yet");
    installFetch();
    await tg.handleUpdate(textUpdate(enrolled.tg, "12ab"));
    assert.ok(calls.some((c) => c.method === "deleteMessage"), "the code message is removed");
    assert.match(String(sends()[0]!.body.text), /6 xonali/);
  } finally {
    delete process.env.ADMIN_2FA_REQUIRED;
  }
});

test("Xabar yuborish: a CONCURRENT double tap on «Yuborish» without a test creates and queues exactly ONE broadcast (review MAJOR)", { skip }, async () => {
  const a = await newAdmin("owner");
  installFetch();
  await tg.handleUpdate(cbUpdate(a.tg, "a:b", 950));
  installFetch();
  await tg.handleUpdate(textUpdate(a.tg, "Ikki marta bosish sinovi"));
  installFetch();
  await tg.handleUpdate(cbUpdate(a.tg, "a:ba", 951));
  installFetch();
  await tg.handleUpdate(cbUpdate(a.tg, "a:bu:new", 951));
  const nw = (await audienceCount({ kind: "new_days", days: 7 })).count;
  installFetch();
  // Two separate updates (different update ids) handled at the same time — no earlier test send.
  // MUTATION: without the per-chat lock in ensureBroadcast both taps created their own broadcast row.
  await Promise.all([tg.handleUpdate(cbUpdate(a.tg, `a:bs:${nw}`, 952)), tg.handleUpdate(cbUpdate(a.tg, `a:bs:${nw}`, 952))]);
  const bs = await broadcastsBy(a.adminId);
  assert.equal(bs.length, 1, "exactly one broadcast row");
  assert.equal(bs[0]!.status, "queued");
  assert.equal((await audit(a.adminId, "broadcasts.send")).length, 1, "queued once");
});

test("Progress card: pause / resume buttons, the engine edits the SAME message, support cannot pause (docs/bonus/BONUS3.md C-Q5)", { skip }, async () => {
  const a = await newAdmin("owner");
  const viewer = await newAdmin("support");
  installFetch();
  await tg.handleUpdate(cbUpdate(a.tg, "a:b", 960));
  await tg.handleUpdate(textUpdate(a.tg, "Pauza va davom ettirish"));
  await tg.handleUpdate(cbUpdate(a.tg, "a:ba", 961));
  await tg.handleUpdate(cbUpdate(a.tg, "a:bu:new", 961));
  const nw = (await audienceCount({ kind: "new_days", days: 7 })).count;
  installFetch();
  await tg.handleUpdate(cbUpdate(a.tg, `a:bs:${nw}`, 962));
  const [b] = await broadcastsBy(a.adminId);
  assert.ok(b);
  assert.equal(b!.status, "queued");
  assert.equal((b!.content!.notify as { messageId?: number }).messageId, 962, "the progress message is remembered for the engine");
  assert.deepEqual(datas(edits()[0]!.body), ["a:bp:" + b!.id, "a:bw:" + b!.id, "a:bc:" + b!.id, "a:h"]);

  // Pause → «pauzada», the button flips to «Davom ettirish».
  installFetch();
  await tg.handleUpdate(cbUpdate(a.tg, `a:bw:${b!.id}`, 962));
  assert.deepEqual(toasts(), ["⏸ Pauzada"]);
  assert.match(String(edits()[0]!.body.text), /Holat: <b>pauzada<\/b>/);
  assert.deepEqual(datas(edits()[0]!.body), ["a:bp:" + b!.id, "a:br:" + b!.id, "a:bc:" + b!.id, "a:h"]);
  assert.equal((await broadcastsBy(a.adminId))[0]!.status, "paused");
  const pa = await audit(a.adminId, "broadcasts.pause");
  assert.equal(pa.length, 1);
  assert.deepEqual(pa[0]!.meta, { via: "bot" });

  // Support (broadcasts.view only) cannot pause or resume.
  installFetch();
  await tg.handleUpdate(cbUpdate(viewer.tg, `a:br:${b!.id}`, 970));
  assert.deepEqual(toasts(), ["Ruxsat yo‘q"]);
  assert.equal((await broadcastsBy(a.adminId))[0]!.status, "paused");

  // The engine's in-place edit: editMessageText on message 962 with the current card.
  installFetch();
  const { editBroadcastProgress } = await import("../lib/server/bot/admin.ts");
  await editBroadcastProgress(b!.id, { chatId: String(a.tg), lang: "uz", messageId: 962 });
  assert.equal(edits().length, 1);
  assert.equal(edits()[0]!.body.message_id, 962);
  assert.equal(edits()[0]!.body.chat_id, a.tg);
  assert.match(String(edits()[0]!.body.text), /Holat: <b>pauzada<\/b>/);
  assert.equal(sends().length, 0, "never a new message");

  // Resume → never started → back to «navbatda».
  installFetch();
  await tg.handleUpdate(cbUpdate(a.tg, `a:br:${b!.id}`, 962));
  assert.deepEqual(toasts(), ["▶️ Davom etmoqda"]);
  assert.match(String(edits()[0]!.body.text), /Holat: <b>navbatda<\/b>/);
  assert.equal((await broadcastsBy(a.adminId))[0]!.status, "queued");
  // A stale second tap on «Davom ettirish» of an already resumed card is harmless.
  installFetch();
  await tg.handleUpdate(cbUpdate(a.tg, `a:br:${b!.id}`, 962));
  assert.match(String(edits()[0]!.body.text), /Holat: <b>navbatda<\/b>/, "409 swallowed, the card shows the truth");
});

test("Progress card text: speed and ETA while sending; the abort reason when failed", async () => {
  const base = {
    id: "9", status: "sending", text: "x", audience: { kind: "all" }, total: 1000, sent: 100, failed: 0, createdBy: null, createdByName: null,
    createdAt: "", queuedAt: null, finishedAt: null, startedAt: null, heartbeatAt: null, failReason: null,
  } as unknown as import("../lib/server/admin-broadcasts.ts").AdminBroadcast;
  const stats = { total: 1000, sent: 100, failed: 0, pending: 900, inFlight: 8, retrying: 0, speed: 24.8, etaSeconds: 90, failedReasons: [] };
  const { progressScreen } = await import("../lib/server/bot/admin-screens.ts");
  const live = progressScreen("uz", base, stats, true);
  assert.match(live.text, /Tezlik: 24\.8 ta\/s · taxminan 1 min 30 s qoldi/);
  const failed = progressScreen("uz", { ...base, status: "failed", failReason: "Birinchi 200 ta yuborish muvaffaqiyatsiz <x>" }, { ...stats, speed: 0, etaSeconds: null }, true);
  assert.match(failed.text, /xato bilan to‘xtatildi/);
  assert.match(failed.text, /Birinchi 200 ta yuborish muvaffaqiyatsiz &lt;x&gt;/, "escaped");
  assert.ok(!/Tezlik/.test(failed.text));
  const paused = progressScreen("uz", { ...base, status: "paused" }, { ...stats, speed: 0, etaSeconds: null }, true);
  assert.ok(JSON.stringify(paused.reply_markup).includes("a:br:9"));
  const noPerm = progressScreen("uz", base, stats, false);
  assert.ok(!JSON.stringify(noPerm.reply_markup).includes("a:bw:9"), "no pause button without broadcasts.send");
});
