import test from "node:test";
import assert from "node:assert/strict";

/**
 * Bot screens (docs/bot/PLAN.md, B2) — the pure layer: icon table, premium
 * emoji on/off, button builders, the main reply keyboard, callback codes,
 * i18n completeness and every screen in all three languages. No DB, no
 * network.
 *
 * Mutations (each turned a test red, then restored):
 *   1. `labelled` keeps the fallback emoji in the label when the icon id is used → «premium on: label without emoji»;
 *   2. `tgEmoji` ignores `BOT_PREMIUM_EMOJI` (always `<tg-emoji>`) → «premium off: plain fallback»;
 *   3. keyboard: «Profilim» loses `style: "success"` → «main keyboard layout»;
 *   4. a blocked tool keeps its web_app → «blocked tool → text button»;
 *   5. `parseCallback` accepts `p:e:balance` → «callback codes reject unknown fields»;
 *   6. a Russian i18n entry emptied → «i18n: every key in uz/ru/en»;
 *   7. `maskPhone` shows all digits → «maskPhone».
 */

process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters-long";
process.env.APP_URL = "https://slaydx.test";
process.env.DATABASE_URL ||= "postgres://unused/unused";
delete process.env.BOT_PREMIUM_EMOJI;
delete process.env.BOT_SUPPORT_USERNAME;

const ui = await import("../lib/server/bot/ui.ts");
const { EMOJI_IDS } = await import("../lib/server/bot/emoji-ids.ts");
const i18n = await import("../lib/server/bot/i18n.ts");
const kbd = await import("../lib/server/bot/keyboard.ts");
const codes = await import("../lib/server/bot/codes.ts");
const prof = await import("../lib/server/bot/profile.ts");
const scr = await import("../lib/server/bot/screens.ts");
const fields = await import("../lib/profile/fields.ts");

type Btn = { text: string; style?: string; icon_custom_emoji_id?: string; callback_data?: string; web_app?: { url: string }; url?: string; copy_text?: { text: string } };
const inline = (s: { reply_markup?: unknown }): Btn[] =>
  ((s.reply_markup as { inline_keyboard?: Btn[][] } | undefined)?.inline_keyboard ?? []).flat();

function withPremium<T>(on: boolean, fn: () => T): T {
  const prev = process.env.BOT_PREMIUM_EMOJI;
  process.env.BOT_PREMIUM_EMOJI = on ? "1" : "0";
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.BOT_PREMIUM_EMOJI;
    else process.env.BOT_PREMIUM_EMOJI = prev;
  }
}

const USER = {
  id: "1",
  name: "Husinboyev Adhambek",
  phone: "+998901234567",
  points: 2000,
  quota: 0,
  balance: 10500,
  university: "Toshkent davlat pedagogika universiteti",
  faculty: "Boshlang'ich ta'lim",
  department: "",
  group: "301",
  course: "3",
  author: "",
  subject: "",
  teacher: "",
  city: "Toshkent",
  position: "",
  organization: "",
};

const LANGS = ["uz", "ru", "en"] as const;

/** Every screen of the bot, in one language (for the generic checks). */
function allScreens(lang: (typeof LANGS)[number]) {
  const files = Array.from({ length: 5 }, (_, i) => ({
    id: `00000000-0000-4000-8000-00000000000${i}`,
    type: ["slide", "image", "pro-slide", "referat", "translation"][i]!,
    topic: `Mavzu ${i} <b>&`,
    status: ["COMPLETED", "IN_PROGRESS", "QUEUED", "FAILED", "CANCELLED"][i]!,
    progress: 42,
    createdAt: "2026-10-08T05:24:00.000Z",
  }));
  const ref = { link: "https://t.me/slaydx_test_bot?start=ref_abcdefgh", rewardPoints: 2000, invitedCount: 3, earnedPoints: 6000 };
  return {
    welcome: scr.welcomeScreen(lang, { user: USER, loginLink: "https://slaydx.test/api/auth/telegram/enter?t=" + "x".repeat(43), rewardPoints: 2000 }),
    login: scr.loginScreen(lang, "https://slaydx.test/api/auth/telegram/enter?t=" + "x".repeat(43)),
    profile: prof.profileCard(USER, lang, ref.link),
    shaxsiy: prof.sectionScreen(USER, "shaxsiy", lang),
    oqish: prof.sectionScreen(USER, "oqish", lang),
    ish: prof.sectionScreen(USER, "ish", lang),
    prompt: prof.promptScreen(USER, "organization", lang),
    promptLong: prof.promptScreen(USER, "department", lang, { kind: "long", length: 245 }),
    saved: prof.savedScreen("department", "Jahon tarixi kafedrasi", lang),
    files: scr.filesScreen(lang, 7_300_000_001, 1, files, true),
    filesEmpty: scr.filesScreen(lang, 7_300_000_001, 0, [], false),
    wallet: scr.walletScreen(lang, USER, [
      { kind: "topup", amount: 20000, note: "Payme orqali", createdAt: "2026-10-05T10:00:00Z" },
      { kind: "charge", amount: -3000, note: "slide: Iqlim o'zgarishi", createdAt: "2026-10-07T10:00:00Z" },
      { kind: "bonus", amount: 2000, note: "Do'st taklifi: Ali", createdAt: "2026-10-07T11:00:00Z" },
    ]),
    referral: scr.referralScreen(lang, ref, "wallet"),
    help: scr.helpScreen(lang),
    language: scr.languageScreen(lang, "p"),
    keyboardNote: kbd.keyboardMessage(lang, 7_300_000_001, "note", { llm: true, images: true }),
  };
}

test("emoji table: every id is a numeric string, every key has a fallback", () => {
  for (const [key, icon] of Object.entries(ui.ICONS) as [string, { fallback: string; id?: string }][]) {
    assert.ok(icon.fallback && icon.fallback.trim().length > 0, `${key}: fallback`);
    assert.doesNotMatch(icon.fallback, /[A-Za-z0-9]/, `${key}: fallback is an emoji, not text`);
    if (icon.id !== undefined) assert.match(icon.id, /^\d{5,25}$/, `${key}: numeric custom emoji id`);
  }
  assert.ok(Object.keys(EMOJI_IDS).length >= 60, "the lead's pack table is in");
  for (const k of ["slide", "image", "pro", "files", "wallet", "help", "lang", "card", "gift", "study", "work", "edit"] as const) {
    assert.ok(EMOJI_IDS[k].id, `${k} has a premium id`);
  }
});

test("premium off: plain fallback in texts and labels, no icon ids", () => {
  withPremium(false, () => {
    assert.equal(ui.tgEmoji("slide"), "📊", "MUTATSIYA 2");
    const b = ui.inlineButton("slide", "Slayd", { callback_data: "n" }, "primary");
    assert.deepEqual(b, { text: "📊 Slayd", callback_data: "n", style: "primary" });
    for (const lang of LANGS) {
      for (const [name, s] of Object.entries(allScreens(lang))) {
        assert.ok(!s.text.includes("<tg-emoji"), `${lang}/${name}: no tg-emoji`);
        assert.ok(!JSON.stringify(s.reply_markup ?? {}).includes("icon_custom_emoji_id"), `${lang}/${name}: no icon ids`);
      }
    }
  });
});

test("premium on: <tg-emoji> in texts, icon_custom_emoji_id on buttons and NO emoji in those labels", () => {
  withPremium(true, () => {
    assert.equal(ui.tgEmoji("slide"), `<tg-emoji emoji-id="${EMOJI_IDS.slide.id}">📊</tg-emoji>`);
    assert.equal(ui.tgEmoji("profile"), "👤", "a key without an id stays plain");
    const b = ui.inlineButton("slide", "Slayd", { callback_data: "n" });
    assert.deepEqual(b, { text: "Slayd", icon_custom_emoji_id: EMOJI_IDS.slide.id, callback_data: "n" }, "MUTATSIYA 1");
    assert.deepEqual(ui.inlineButton("back", "Orqaga", { callback_data: "p:h" }), { text: "⬅️ Orqaga", callback_data: "p:h" });
    for (const lang of LANGS) {
      for (const [name, s] of Object.entries(allScreens(lang))) {
        const markup = s.reply_markup as { inline_keyboard?: Btn[][]; keyboard?: Btn[][] } | undefined;
        for (const btn of [...(markup?.inline_keyboard ?? []), ...(markup?.keyboard ?? [])].flat()) {
          if (!btn.icon_custom_emoji_id) continue;
          const icon = Object.values(ui.ICONS).find((i) => i.id === btn.icon_custom_emoji_id);
          assert.ok(icon, `${lang}/${name}: id from the table`);
          assert.ok(!btn.text.includes(icon.fallback), `${lang}/${name}: «${btn.text}» has no duplicate emoji`);
        }
      }
      assert.ok(allScreens(lang).profile.text.includes("<tg-emoji"), `${lang}: profile text uses premium emoji`);
    }
  });
});

test("main keyboard layout: 3/2/2 rows, styles, persistent, placeholder; tools → personal web_app links", () => {
  const kb = kbd.mainKeyboard("uz", 7_300_000_001, { llm: true, images: true }) as {
    keyboard: Btn[][];
    is_persistent: boolean;
    resize_keyboard: boolean;
    input_field_placeholder: string;
  };
  assert.deepEqual(
    kb.keyboard.map((r) => r.map((b) => `${b.text}${b.style ? `(${b.style})` : ""}${b.web_app ? "[app]" : ""}`)),
    [
      ["📊 Slayd(primary)[app]", "🖼 Rasm[app]", "💎 Pro slayd[app]"],
      ["📂 Ishlarim", "💰 Hamyon"],
      ["👤 Profilim(success)", "❓ Yordam"],
    ],
    "MUTATSIYA 3",
  );
  assert.equal(kb.is_persistent, true);
  assert.equal(kb.resize_keyboard, true);
  assert.equal(kb.input_field_placeholder, "Vositani tanlang yoki xabar yozing…");
  const urls = kb.keyboard[0]!.map((b) => b.web_app!.url);
  assert.ok(urls[0]!.startsWith("https://slaydx.test/uz/slide"), urls[0]);
  assert.ok(urls[1]!.startsWith("https://slaydx.test/uz/rasm"), urls[1]);
  assert.ok(urls[2]!.startsWith("https://slaydx.test/uz/pro-slide"), urls[2]);
  const ru = kbd.mainKeyboard("ru", 1, { llm: true, images: true }) as { keyboard: Btn[][]; input_field_placeholder: string };
  assert.deepEqual(ru.keyboard.flat().map((b) => b.text), ["📊 Слайды", "🖼 Картинка", "💎 Pro слайды", "📂 Мои работы", "💰 Кошелёк", "👤 Мой профиль", "❓ Помощь"]);
  assert.equal(ru.input_field_placeholder, "Выберите инструмент или напишите сообщение…");
});

test("blocked tool → text button (bot answers «vaqtincha o‘chiq»); no public URL → text button", async () => {
  const kb = kbd.mainKeyboard("uz", 1, { llm: true, images: false }) as { keyboard: Btn[][] };
  assert.ok(kb.keyboard[0]![0]!.web_app, "slide still works");
  assert.equal(kb.keyboard[0]![1]!.web_app, undefined, "MUTATSIYA 4: image blocked → text");
  const noLlm = kbd.mainKeyboard("uz", 1, { llm: false, images: true }) as { keyboard: Btn[][] };
  assert.deepEqual(noLlm.keyboard[0]!.map((b) => Boolean(b.web_app)), [false, true, false], "every tool needs the LLM except the image");
  assert.equal(kbd.toolBlocked("image", { llm: true, images: false }), "Rasm xizmati vaqtincha o‘chiq: serverda rasm kaliti sozlanmagan.");
  const { env } = (await import("../lib/server/env.ts")) as unknown as { env: { appUrl: string } };
  const prev = env.appUrl;
  env.appUrl = "http://localhost:3000";
  try {
    const local = kbd.mainKeyboard("uz", 1, { llm: true, images: true }) as { keyboard: Btn[][] };
    assert.ok(local.keyboard.flat().every((b) => !b.web_app), "localhost: botAppUrl null → no web_app");
  } finally {
    env.appUrl = prev;
  }
});

test("matchKeyboard: any language, with or without the emoji (premium labels are bare)", () => {
  assert.equal(kbd.matchKeyboard("👤 Profilim"), "profile");
  assert.equal(kbd.matchKeyboard("Profilim"), "profile");
  assert.equal(kbd.matchKeyboard("👤 Мой профиль"), "profile");
  assert.equal(kbd.matchKeyboard("📂 My files"), "files");
  assert.equal(kbd.matchKeyboard("💰 Кошелёк"), "wallet");
  assert.equal(kbd.matchKeyboard("❓ Help"), "help");
  assert.equal(kbd.matchKeyboard("💎 Pro slayd"), "pro");
  assert.equal(kbd.matchKeyboard("📊 Slayd"), "slide");
  assert.equal(kbd.matchKeyboard("Boshlang'ich ta'lim kafedrasi"), null);
  assert.equal(kbd.matchKeyboard("/start"), null);
  assert.equal(kbd.matchKeyboard(""), null);
});

test("callback codes: round trip, ≤ 64 bytes, unknown/forged codes rejected", () => {
  const all = [
    codes.cb.profile(),
    codes.cb.cancel(),
    codes.cb.files(0),
    codes.cb.files(codes.FILES_MAX_PAGE),
    codes.cb.wallet(),
    codes.cb.walletInvite(),
    codes.cb.invite(),
    codes.cb.help(),
    codes.cb.noop(),
    ...codes.SECTIONS.map((s) => codes.cb.section(s)),
    ...fields.PROFILE_FIELDS.map((f) => codes.cb.edit(f)),
    ...(["p", "y", "n"] as const).flatMap((o) => [codes.cb.langMenu(o), ...LANGS.map((l) => codes.cb.langSet(l, o))]),
  ];
  for (const c of all) {
    assert.ok(Buffer.byteLength(c) <= 64, c);
    assert.notEqual(codes.parseCallback(c).kind, "unknown", c);
  }
  assert.deepEqual(codes.parseCallback("p:e:department"), { kind: "edit", field: "department" });
  assert.deepEqual(codes.parseCallback("l:s:ru:p"), { kind: "langSet", lang: "ru", origin: "p" });
  for (const bad of ["p:e:balance", "p:e:language", "p:e:points", "p:s:korinish", "f:20", "f:-1", "f:1:2", "l:s:de:p", "l:m:x", "x", "", "p:h:1"]) {
    assert.equal(codes.parseCallback(bad).kind, "unknown", `MUTATSIYA 5: ${bad}`);
  }
  assert.throws(() => ui.inlineButton(null, "x", { callback_data: "p:".padEnd(65, "a") }), /64 bytes/);
});

test("every callback_data on every screen (3 languages, premium on/off) is ≤ 64 bytes and parses", () => {
  for (const premium of [false, true]) {
    withPremium(premium, () => {
      for (const lang of LANGS) {
        for (const [name, s] of Object.entries(allScreens(lang))) {
          for (const b of inline(s)) {
            if (b.callback_data === undefined) continue;
            assert.ok(Buffer.byteLength(b.callback_data) <= 64, `${lang}/${name}`);
            assert.notEqual(codes.parseCallback(b.callback_data).kind, "unknown", `${lang}/${name}: ${b.callback_data}`);
          }
        }
      }
    });
  }
});

test("i18n: every key in uz/ru/en, non-empty, same placeholders", () => {
  for (const key of i18n.TEXT_KEYS) {
    const e = i18n.rawEntry(key);
    const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
    for (const lang of LANGS) assert.ok(e[lang]?.trim(), `MUTATSIYA 6: ${key}.${lang}`);
    assert.equal(vars(e.ru), vars(e.uz), `${key}: ru placeholders`);
    assert.equal(vars(e.en), vars(e.uz), `${key}: en placeholders`);
  }
  for (const f of fields.PROFILE_FIELDS) {
    for (const part of ["label", "prompt", "example"] as const) {
      for (const lang of LANGS) assert.ok(i18n.FIELD_TEXT[f][part][lang].trim(), `${f}.${part}.${lang}`);
    }
  }
  assert.equal(i18n.langFromTelegram("ru"), "ru");
  assert.equal(i18n.langFromTelegram("en-US"), "en");
  assert.equal(i18n.langFromTelegram("uk"), "uz");
  assert.equal(i18n.langFromTelegram(undefined), "uz");
  assert.equal(i18n.langOf("de"), "uz");
});

test("screens render in all three languages: no leaked placeholders, user data escaped", () => {
  for (const lang of LANGS) {
    for (const [name, s] of Object.entries(allScreens(lang))) {
      assert.doesNotMatch(s.text, /\{\w+\}/, `${lang}/${name}: placeholder left`);
      assert.ok(!s.text.includes("<b>&"), `${lang}/${name}: unescaped user data`);
    }
  }
  const files = allScreens("uz").files;
  assert.match(files.text, /«Mavzu 0 &lt;b&gt;&amp;» · 08\.10\.2026/);
  assert.match(files.text, /6\. ✅ <b>Slayd<\/b> · Tayyor/, "page 1 numbering starts at 6");
  assert.match(files.text, /7\. ⏳ <b>Rasm<\/b> · Yozilmoqda 42%/);
  assert.match(allScreens("ru").files.text, /<b>Картинка<\/b> · Пишется 42%/);
  assert.match(allScreens("en").files.text, /<b>Pro slides<\/b> · Queued/);
  const nav = inline(files).filter((b) => b.callback_data?.startsWith("f:")).map((b) => b.callback_data);
  assert.deepEqual(nav, ["f:0", "f:2"]);
  assert.ok(inline(files).filter((b) => b.web_app?.url.includes("/uz/files/")).length === 5, "a button per file");
});

test("Profilim card: masked phone, study summary, money, completion, buttons (copy_text, web_app, primary)", () => {
  const s = prof.profileCard(USER, "uz", "https://t.me/slaydx_test_bot?start=ref_abcdefgh");
  assert.match(s.text, /📞 Telefon: <b>\+998 90 ••• •• 67<\/b>/);
  assert.match(s.text, /🎓 O‘qish: <b>TDPU · 3-kurs<\/b>/);
  assert.match(s.text, /💼 Ish joyi: —/);
  assert.match(s.text, /💰 12\s500 tanga · ⭐ 2\s000 ball/);
  assert.match(s.text, /Profil 50% to‘ldirilgan/);
  const b = inline(s);
  assert.deepEqual(b.find((x) => x.copy_text)?.copy_text, { text: "https://t.me/slaydx_test_bot?start=ref_abcdefgh" });
  assert.equal(b.find((x) => x.web_app?.url === "https://slaydx.test/uz/profile")?.style, "primary");
  assert.ok(b.find((x) => x.web_app?.url === "https://slaydx.test/uz/wallet"));
  assert.deepEqual(b.filter((x) => x.callback_data).map((x) => x.callback_data), ["p:s:shaxsiy", "p:s:oqish", "p:s:ish", "l:m:p"]);
  assert.match(prof.profileCard(USER, "en", null).text, /🎓 Study: <b>TDPU · year 3<\/b>/);
});

test("section, prompt, saved: values on buttons, danger cancel, success Profilim", () => {
  const sec = prof.sectionScreen(USER, "oqish", "uz");
  const labels = inline(sec).map((b) => b.text);
  assert.deepEqual(labels, [
    "🏛 Universitet · TDPU",
    "📚 Fakultet · Boshlang'ich ta'lim",
    "🏷 Kafedra · —",
    "👥 Guruh · 301",
    "💯 Kurs · 3",
    "⬅️ Profilga qaytish",
  ]);
  const prompt = prof.promptScreen(USER, "department", "uz");
  assert.match(prompt.text, /🏷 <b>Kafedra nomini yozing<\/b>/);
  assert.match(prompt.text, /Masalan: Jahon tarixi kafedrasi/);
  assert.deepEqual(inline(prompt), [{ text: "✖️ Bekor qilish", callback_data: "p:x", style: "danger" }]);
  const long = prof.promptScreen(USER, "department", "uz", { kind: "long", length: 245 });
  assert.match(long.text, /^🚨 Juda uzun: 200 belgidan oshmasin \(hozir 245\)\./);
  const saved = prof.savedScreen("department", "Jahon <tarixi>", "uz");
  assert.match(saved.text, /✅ <b>Saqlandi!<\/b>\n<blockquote>🏷 Kafedra: <b>Jahon &lt;tarixi&gt;<\/b><\/blockquote>/);
  assert.deepEqual(inline(saved).map((b) => [b.text, b.callback_data, b.style]), [
    ["🎓 O‘qish joyi", "p:s:oqish", undefined],
    ["👤 Profilim", "p:h", "success"],
  ]);
});

test("Hamyon, referral, Yordam, Til", async () => {
  const w = allScreens("uz").wallet;
  assert.match(w.text, /Balans: <b>12\s500 tanga<\/b>/);
  assert.match(w.text, /⭐ Shundan bonus: 2\s000 ball/);
  assert.match(w.text, /<b>\+20\s000 tanga<\/b> — To‘ldirish · Payme · 05\.10\.2026/);
  assert.match(w.text, /<b>−3\s000 tanga<\/b> — Slayd: Iqlim o'zgarishi · 07\.10\.2026/);
  assert.match(w.text, /<b>\+2\s000 ball<\/b> — Taklif bonusi · Ali/);
  assert.match(allScreens("en").wallet.text, /<b>−3\s000 coins<\/b> — Slides: Iqlim o'zgarishi/);
  const wb = inline(w);
  assert.equal(wb[0]!.web_app?.url, "https://slaydx.test/uz/wallet");
  assert.equal(wb[0]!.style, "primary");
  assert.equal(wb[1]!.callback_data, "w:r");

  const r = allScreens("uz").referral;
  assert.deepEqual(inline(r).find((b) => b.copy_text)?.copy_text, { text: "https://t.me/slaydx_test_bot?start=ref_abcdefgh" });
  assert.ok(inline(r).some((b) => b.url?.startsWith("https://t.me/share/url?")));
  assert.equal(inline(r).at(-1)!.callback_data, "w:h");

  const h = allScreens("uz").help;
  assert.match(h.text, /<blockquote expandable>/);
  assert.ok(!inline(h).some((b) => b.url?.startsWith("https://t.me/")), "no support contact configured → no button");
  process.env.BOT_SUPPORT_USERNAME = "@slaydx_support";
  try {
    assert.equal(inline(scr.helpScreen("uz")).find((b) => b.url)?.url, "https://t.me/slaydx_support");
  } finally {
    delete process.env.BOT_SUPPORT_USERNAME;
  }

  const l = scr.languageScreen("ru", "y");
  assert.deepEqual(inline(l).map((b) => [b.text, b.callback_data, b.style]), [
    ["🇺🇿 O‘zbekcha", "l:s:uz:y", undefined],
    ["🇷🇺 Русский", "l:s:ru:y", "success"],
    ["🇬🇧 English", "l:s:en:y", undefined],
    ["⬅️ Назад", "y:h", undefined],
  ]);
  assert.equal(inline(scr.languageScreen("uz", "n")).length, 3, "from /til: no back button");
});

test("maskPhone / profileCompletion", () => {
  assert.equal(fields.maskPhone("+998901234567"), "+998 90 ••• •• 67", "MUTATSIYA 7");
  assert.equal(fields.maskPhone("998907654321"), "+998 90 ••• •• 21");
  assert.equal(fields.maskPhone("+4915112345678"), "+4915•••••••78");
  assert.equal(fields.maskPhone(null), "");
  assert.equal(fields.profileCompletion({}), 0);
  assert.equal(fields.profileCompletion(Object.fromEntries(fields.PROFILE_FIELDS.map((f) => [f, "x"]))), 100);
});

/* ── security review (2nd pass) fixes ── */

test("Ishlarim: file buttons are inline web_app WITHOUT a personal ?bt= link (inline buttons carry initData)", () => {
  const files = [{ id: "g1", type: "slide", topic: "Orol", status: "COMPLETED", progress: 100, createdAt: "2026-10-08T08:00:00.000Z" }];
  const s = scr.filesScreen("uz", 7_300_000_001, 0, files, false);
  const btns = (s.reply_markup as { inline_keyboard: { web_app?: { url: string } }[][] }).inline_keyboard.flat();
  const file = btns.find((b) => b.web_app?.url.includes("/uz/files/g1"));
  assert.ok(file, "the file opens in the Mini App");
  // MUTATION: botAppUrl(telegramId, path) put a 7-day sign-in token into chat history.
  assert.ok(!file!.web_app!.url.includes("bt="), file!.web_app!.url);
});

test("cleanFieldValue: one line — newlines/tabs collapse, bidi overrides and other control/format chars go, ZWJ/ZWNJ stay", () => {
  assert.equal(fields.cleanFieldValue("  Jahon\n\ttarixi\r\n kafedrasi  "), "Jahon tarixi kafedrasi");
  // MUTATION: without the \p{Cc}\p{Cf} pass a U+202E «right-to-left override» reverses what admins see.
  assert.equal(fields.cleanFieldValue("abc‮def\u0000"), "abc def");
  assert.equal(fields.cleanFieldValue("👩‍💻 Dev"), "👩‍💻 Dev");
});
