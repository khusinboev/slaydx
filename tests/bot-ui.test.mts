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
 *   7. `maskPhone` shows all digits → «maskPhone»;
 *   B1. a joined channel's button without `style: "success"` → «bonuses message (uz)»;
 *   B2. the invite button green at 0 invites → «before the first invite / after the first top-up»;
 *   B3. the Hamyon history not cut to WALLET_RECENT → «Hamyon card: only the LAST 3»;
 *   B4. the blank line after the greeting removed → «/start welcome»;
 *   B5. a bonus ledger line in tanga → «Hamyon, referral, Yordam, Til».
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
const bonus = await import("../lib/server/bot/bonus.ts");
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

/** «Bonus olish» data: a new channel, one waiting for its stay bonus (3 of 7 days), one fully paid, one without a username. */
const BONUS_NOW = Date.parse("2026-10-08T12:00:00.000Z");
function bonusTasks() {
  const day = 86_400_000;
  return {
    channels: [
      { id: "1", title: "SlaydX yangiliklari", username: "slaydx_news", joinUrl: "https://t.me/slaydx_news", joinBonus: 2000, stayBonus: 0, stayDays: 7, claim: null },
      {
        id: "2",
        title: "Talabalar <kanali> & co",
        username: "talaba_kanal",
        joinUrl: "https://t.me/talaba_kanal",
        joinBonus: 1000,
        stayBonus: 2000,
        stayDays: 7,
        claim: { joinedAt: new Date(BONUS_NOW - 3 * day - 3_600_000).toISOString(), joinPaid: 1000, stayPaid: null, leftAt: null },
      },
      {
        id: "3",
        title: "Paid",
        username: "paid_channel",
        joinUrl: "https://t.me/paid_channel",
        joinBonus: 1000,
        stayBonus: 2000,
        stayDays: 7,
        claim: { joinedAt: new Date(BONUS_NOW - 9 * day).toISOString(), joinPaid: 1000, stayPaid: 2000, leftAt: null },
      },
      { id: "999999999999999999", title: "Yopiq kanal", username: null, joinUrl: null, joinBonus: 1000, stayBonus: 2000, stayDays: 7, claim: null },
      { id: "5", title: "Taklif havolali kanal", username: null, joinUrl: "https://t.me/+AbCdEf123456", joinBonus: 1000, stayBonus: 0, stayDays: 7, claim: null },
    ],
    referral: { link: "https://t.me/slaydx_test_bot?start=ref_abcdefgh", rewardPoints: 2000, invitedCount: 3, earnedPoints: 6000 },
    signupPoints: 2000,
    paymentBonus: { percent: 10, earnedPoints: 0 },
    earnedTotal: 10000,
    availableTotal: 8000,
  };
}

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
    bonus: bonus.bonusScreen(lang, bonusTasks(), BONUS_NOW),
    bonusFresh: bonus.bonusScreen(
      lang,
      { ...bonusTasks(), referral: { ...bonusTasks().referral, invitedCount: 0, earnedPoints: 0 }, paymentBonus: { percent: 0, earnedPoints: 5000 } },
      BONUS_NOW,
    ),
    bonusEmpty: bonus.bonusScreen(lang, { ...bonusTasks(), channels: [] }, BONUS_NOW),
    stayNotice: bonus.stayPaidNotice(lang, { points: 2000, title: "Kanal & <b>", stayDays: 7 }),
    joinNotice: bonus.joinPaidNotice(lang, { points: 1000, title: "Kanal & <b>", stayBonus: 2000, stayDays: 7 }),
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

test("main keyboard layout (owner 2026-10-08): 5 rows × 2, styles, persistent, placeholder; six tools → personal web_app links", () => {
  const kb = kbd.mainKeyboard("uz", 7_300_000_001, { llm: true, images: true }) as {
    keyboard: Btn[][];
    is_persistent: boolean;
    resize_keyboard: boolean;
    input_field_placeholder: string;
  };
  assert.deepEqual(
    kb.keyboard.map((r) => r.map((b) => `${b.text}${b.style ? `(${b.style})` : ""}${b.web_app ? "[app]" : ""}`)),
    [
      ["📊 Slayd(primary)[app]", "💎 Pro slayd[app]"],
      ["📝 Mustaqil ish[app]", "📄 Referat[app]"],
      ["🖼 Rasm[app]", "💼 Rezyume[app]"],
      ["📂 Ishlarim", "💰 Hamyon / Bonus"],
      ["👤 Profil(success)", "❓ Yordam"],
    ],
    "MUTATSIYA 3",
  );
  assert.equal(kb.is_persistent, true);
  assert.equal(kb.resize_keyboard, true);
  assert.equal(kb.input_field_placeholder, "Vositani tanlang yoki xabar yozing…");
  const urls = kb.keyboard.slice(0, 3).flat().map((b) => b.web_app!.url.split("?")[0]);
  assert.deepEqual(urls, [
    "https://slaydx.test/uz/slide",
    "https://slaydx.test/uz/pro-slide",
    "https://slaydx.test/uz/mustaqil-ish",
    "https://slaydx.test/uz/referat",
    "https://slaydx.test/uz/rasm",
    "https://slaydx.test/uz/resume",
  ]);
  assert.ok(kb.keyboard.slice(0, 3).flat().every((b) => b.web_app!.url.includes("bt=")), "reply-keyboard tools carry the personal link");
  const ru = kbd.mainKeyboard("ru", 1, { llm: true, images: true }) as { keyboard: Btn[][]; input_field_placeholder: string };
  assert.deepEqual(ru.keyboard.flat().map((b) => b.text), [
    "📊 Слайды",
    "💎 Pro слайды",
    "📝 Самостоятельная работа",
    "📄 Реферат",
    "🖼 Картинка",
    "💼 Резюме",
    "📂 Мои работы",
    "💰 Кошелёк / Бонус",
    "👤 Профиль",
    "❓ Помощь",
  ]);
  assert.equal(ru.input_field_placeholder, "Выберите инструмент или напишите сообщение…");
});

test("blocked tool → text button (bot answers «vaqtincha o‘chiq»); no public URL → text button", async () => {
  const kb = kbd.mainKeyboard("uz", 1, { llm: true, images: false }) as { keyboard: Btn[][] };
  assert.ok(kb.keyboard[0]![0]!.web_app, "slide still works");
  assert.equal(kb.keyboard[2]![0]!.web_app, undefined, "MUTATSIYA 4: image blocked → text");
  const noLlm = kbd.mainKeyboard("uz", 1, { llm: false, images: true }) as { keyboard: Btn[][] };
  assert.deepEqual(noLlm.keyboard.slice(0, 3).flat().map((b) => Boolean(b.web_app)), [false, false, false, false, true, false], "every tool needs the LLM except the image");
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
  // The 2026-10-08 layout: new tools and renamed buttons; old labels on users' screens keep working.
  assert.equal(kbd.matchKeyboard("📝 Mustaqil ish"), "independent");
  assert.equal(kbd.matchKeyboard("📄 Referat"), "referat");
  assert.equal(kbd.matchKeyboard("💼 Rezyume"), "resume");
  assert.equal(kbd.matchKeyboard("💰 Hamyon / Bonus"), "wallet");
  assert.equal(kbd.matchKeyboard("👤 Profil"), "profile");
  // MUTATION: without `legacy` an old keyboard's «Hamyon» fell through to the «/login yozing» fallback.
  assert.equal(kbd.matchKeyboard("💰 Hamyon"), "wallet");
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
    codes.cb.bonus(),
    codes.cb.bonusRefresh(),
    codes.cb.bonusDone(),
    codes.cb.bonusCheck("1"),
    codes.cb.bonusCheck("999999999999999999"),
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
  assert.deepEqual(codes.parseCallback("b:c:42"), { kind: "bonusCheck", channelId: "42" });
  assert.deepEqual(codes.parseCallback("b:h"), { kind: "bonus" });
  assert.deepEqual(codes.parseCallback("b:r"), { kind: "bonusRefresh" });
  assert.deepEqual(codes.parseCallback("b:d"), { kind: "bonusDone" });
  for (const bad of ["b:c:0", "b:c:-1", "b:c:01", "b:c:1e3", "b:c:1234567890123456789", "b:c", "b:c:", "b:c:1:2", "b:h:1", "b:r:1", "b:d:1", "b:x", "b"]) {
    assert.equal(codes.parseCallback(bad).kind, "unknown", `forged bonus code: ${bad}`);
  }
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
  assert.match(s.text, /💰 12\s500 tanga · ⭐ bonus 2\s000 so‘m/);
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
  assert.match(w.text, /⭐ Shundan bonus: 2\s000 so‘m/);
  assert.match(w.text, /<b>\+20\s000 tanga<\/b> — To‘ldirish · Payme · 05\.10\.2026/);
  assert.match(w.text, /<b>−3\s000 tanga<\/b> — Slayd: Iqlim o'zgarishi · 07\.10\.2026/);
  assert.match(w.text, /<b>\+2\s000 so‘m<\/b> — Taklif bonusi · Ali/);
  assert.match(allScreens("en").wallet.text, /<b>−3\s000 coins<\/b> — Slides: Iqlim o'zgarishi/);
  assert.match(allScreens("ru").wallet.text, /<b>\+2\s000 сум<\/b> — Бонус за приглашение · Ali/);
  assert.match(allScreens("en").wallet.text, /<b>\+2\s000 UZS<\/b> — Invite bonus · Ali/);
  // B2-Q4: big green «🎁 Bonuslar» (full row), then «💳 To‘ldirish» (web app) — nothing else.
  const wRows = (w.reply_markup as { inline_keyboard: Btn[][] }).inline_keyboard;
  assert.deepEqual(wRows, [
    [{ text: "🎁 Bonuslar", callback_data: "b:h", style: "success" }],
    [{ text: "💳 To‘ldirish", web_app: { url: "https://slaydx.test/uz/wallet" }, style: "primary" }],
  ]);

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

/* ── «Sizning bonuslaringiz» (docs/bonus/PLAN.md, Bonus 2: B2-Q2..Q4) ── */

type Row = Btn[];
const kbRows = (s: { reply_markup?: unknown }): Row[] => (s.reply_markup as { inline_keyboard: Row[] }).inline_keyboard;
/** A button as «label | action | style» — the action is the callback, the url without its query, `app:<url>` or `copy`. */
const brief = (b: Btn) =>
  [b.text, b.callback_data ?? (b.web_app ? `app:${b.web_app.url}` : b.url?.replace(/\?.*$/, "") ?? (b.copy_text ? "copy" : "")), b.style ?? ""].join(" | ");

test("bonuses message (uz): summary, short explanation, ONE button per task in order — styles and action types — MUTATSIYA B1, B2", () => {
  const s = allScreens("uz").bonus;
  assert.equal(
    s.text,
    [
      "🎁 <b>Sizning bonuslaringiz</b>",
      "",
      "<blockquote>⭐ Jami olgan bonusingiz: <b>10 000 so‘m</b> · yana olish mumkin: <b>8 000 so‘m</b></blockquote>",
      "",
      "Har bir tugma — bitta vazifa: bajaring, bonus hamyoningizga o‘zi tushadi (✅ — bajarilgan). Bonus xizmatlar uchun tanga kabi sarflanadi.",
      "<i>Kanalga obuna bo‘lgach bonus tushmasa — «Yangilash»ni bosing.</i>",
    ].join("\n"),
  );
  assert.deepEqual(kbRows(s).map((r) => r.map(brief)), [
    ["✅ Ro‘yxatdan o‘tish · +2 000 so‘m | b:d | success"],
    ["✅ 3 do‘st taklif qildingiz · +6 000 so‘m | https://t.me/share/url | success"],
    ["📢 SlaydX yangiliklari · +2 000 so‘m | https://t.me/slaydx_news | "],
    ["✅ Talabalar <k… · +1 000 so‘m · ⏳ 7 kun: 4 kun | b:d | success"],
    ["✅ Paid · +1 000 so‘m · ✅ +2 000 | b:d | success"],
    ["📢 Yopiq kanal · +1 000 so‘m | b:c:999999999999999999 | "],
    ["📢 Taklif havolali kanal · +1 000 so‘m | https://t.me/+AbCdEf123456 | "],
    ["💳 Har to‘ldirishga +10% bonus | app:https://slaydx.test/uz/wallet | "],
    ["🔄 Yangilash | b:r | ", "⬅️ Hamyon | w:h | "],
  ]);
  // The share sheet carries the personal referral link and the share text.
  const share = new URL(kbRows(s)[1]![0]!.url!);
  assert.equal(share.searchParams.get("url"), "https://t.me/slaydx_test_bot?start=ref_abcdefgh");
  assert.match(share.searchParams.get("text") ?? "", /SlaydX/);
  // The top-up opens the plain wallet URL: inline web_app buttons carry initData, no personal `?bt=` link in the chat.
  assert.ok(!kbRows(s)[7]![0]!.web_app!.url.includes("bt="));
});

test("bonuses message: before the first invite / payment bonus off; no public URLs; empty channel list", async () => {
  const f = allScreens("uz").bonusFresh;
  assert.equal(brief(kbRows(f)[1]![0]!), "👥 Do‘st taklif qilish · +2 000 so‘m har biri | https://t.me/share/url | primary");
  // C-Q4: percent 0 → no payment bonus task (the last task row is the last channel).
  assert.equal(brief(kbRows(f).at(-2)![0]!), "📢 Taklif havolali kanal · +1 000 so‘m | https://t.me/+AbCdEf123456 | ");

  // An account from before the sign-up bonus: still done, no amount.
  const old = bonus.bonusScreen("uz", { ...bonusTasks(), signupPoints: 0 }, BONUS_NOW);
  assert.equal(brief(kbRows(old)[0]![0]!), "✅ Ro‘yxatdan o‘tish | b:d | success");

  // No channels: sign-up, invite, top-up, the last row.
  assert.deepEqual(kbRows(allScreens("uz").bonusEmpty).map((r) => r.length), [1, 1, 1, 2]);

  const { env } = (await import("../lib/server/env.ts")) as unknown as { env: { appUrl: string } };
  const prev = env.appUrl;
  env.appUrl = "http://localhost:3000";
  try {
    const local = bonus.bonusScreen("uz", { ...bonusTasks(), referral: { ...bonusTasks().referral, link: "http://localhost:3000/?ref=abcdefgh" } }, BONUS_NOW);
    assert.ok(!inline(local).some((b) => b.web_app), "no public URL → no top-up web_app button");
    assert.deepEqual(kbRows(local)[1]![0]!.copy_text, { text: "http://localhost:3000/?ref=abcdefgh" }, "a local referral link is copied, not shared");
  } finally {
    env.appUrl = prev;
  }
});

test("bonuses message (ru/en): labels, units, styles; every label ≤ 44 chars after its icon (3 languages, premium on/off)", () => {
  assert.deepEqual(kbRows(allScreens("ru").bonus).map((r) => r.map(brief)).slice(0, 4), [
    ["✅ Регистрация · +2 000 сум | b:d | success"],
    ["✅ Приглашено друзей: 3 · +6 000 сум | https://t.me/share/url | success"],
    ["📢 SlaydX yangiliklari · +2 000 сум | https://t.me/slaydx_news | "],
    ["✅ Talabalar <ka… · +1 000 сум · ⏳ 7 дн.: 4 дн. | b:d | success"],
  ]);
  assert.match(allScreens("ru").bonus.text, /Всего получено бонусов: <b>10 000 сум<\/b> · можно получить ещё: <b>8 000 сум<\/b>/);
  assert.deepEqual(kbRows(allScreens("en").bonus).map((r) => r.map(brief)).slice(-2), [
    ["💳 +10% bonus on every top-up | app:https://slaydx.test/uz/wallet | "],
    ["🔄 Refresh | b:r | ", "⬅️ Wallet | w:h | "],
  ]);
  assert.equal(brief(kbRows(allScreens("en").bonusFresh)[1]![0]!), "👥 Invite a friend · +2 000 UZS each | https://t.me/share/url | primary");
  const long = bonus.bonusScreen(
    "uz",
    { ...bonusTasks(), channels: bonusTasks().channels.map((c) => ({ ...c, title: `${c.title} — juda uzun kanal nomi, ataylab cho‘zilgan` })) },
    BONUS_NOW,
  );
  for (const premium of [false, true]) {
    withPremium(premium, () => {
      for (const lang of LANGS) {
        for (const s of [allScreens(lang).bonus, allScreens(lang).bonusFresh, long]) {
          for (const b of inline(s)) {
            const label = premium && b.icon_custom_emoji_id ? b.text : b.text.replace(/^\S+ /, "");
            assert.ok(label.length <= bonus.BONUS_LABEL_MAX, `${lang}: «${b.text}» ${label.length}`);
            if (b.callback_data) assert.ok(Buffer.byteLength(b.callback_data) <= 64);
          }
        }
      }
    });
  }
  assert.ok(inline(long).some((b) => b.text.includes("…")), "long titles are cut");
});

test("bonuses message with premium emoji: icon ids on the task buttons, no duplicate emoji in labels", () => {
  withPremium(true, () => {
    const s = bonus.bonusScreen("uz", bonusTasks(), BONUS_NOW);
    assert.ok(s.text.includes(`<tg-emoji emoji-id="${EMOJI_IDS.gift.id}">🎁</tg-emoji> <b>Sizning bonuslaringiz</b>`));
    // «✅» / «👥» have no premium id: they stay in the label; the top-up («card») gets an icon id and a bare label.
    assert.deepEqual(kbRows(s)[0]![0]!, { text: "✅ Ro‘yxatdan o‘tish · +2 000 so‘m", callback_data: "b:d", style: "success" });
    const fresh = bonus.bonusScreen("uz", { ...bonusTasks(), referral: { ...bonusTasks().referral, invitedCount: 0 } }, BONUS_NOW);
    const invite = kbRows(fresh)[1]![0]!;
    assert.equal(invite.icon_custom_emoji_id, undefined);
    assert.equal(invite.text, "👥 Do‘st taklif qilish · +2 000 so‘m har biri");
    const topup = kbRows(s)[7]![0]!;
    assert.equal(topup.icon_custom_emoji_id, EMOJI_IDS.card.id);
    assert.equal(topup.text, "Har to‘ldirishga +10% bonus");
    const w = scr.walletScreen("uz", USER, []);
    assert.deepEqual(inline(w)[0], { text: "Bonuslar", icon_custom_emoji_id: EMOJI_IDS.gift.id, callback_data: "b:h", style: "success" });
  });
});

test("join / stay notices: so‘m units in 3 languages, escaped titles, «🎁 Bonuslar» button", () => {
  assert.equal(
    allScreens("uz").joinNotice.text,
    "🎉 <b>+1 000 so‘m bonus!</b>\n«Kanal &amp; &lt;b&gt;» kanaliga obuna bo‘lganingiz uchun.\n7 kun obuna bo‘lib qolsangiz — yana +2 000 so‘m.",
  );
  assert.equal(
    bonus.joinPaidNotice("uz", { points: 2000, title: "SlaydX", stayBonus: 0, stayDays: 7 }).text,
    "🎉 <b>+2 000 so‘m bonus!</b>\n«SlaydX» kanaliga obuna bo‘lganingiz uchun.",
  );
  assert.match(allScreens("ru").joinNotice.text, /^🎉 <b>\+1 000 сум бонуса!<\/b>\nЗа подписку на канал «Kanal &amp; &lt;b&gt;»\.\nОстаньтесь подписанным 7 дн\. — и получите ещё \+2 000 сум\.$/);
  assert.match(allScreens("en").joinNotice.text, /^🎉 <b>\+1 000 UZS bonus!<\/b>/);
  assert.equal(
    allScreens("uz").stayNotice.text,
    "🎉 <b>+2 000 so‘m bonus!</b>\n«Kanal &amp; &lt;b&gt;» kanalida 7 kun qolganingiz uchun rahmat! Bonus hamyoningizga qo‘shildi.",
  );
  assert.match(allScreens("en").stayNotice.text, /^🎉 <b>\+2 000 UZS bonus!<\/b>\nThanks for staying in «Kanal &amp; &lt;b&gt;» for 7 days! The bonus is in your wallet\.$/);
  for (const n of [allScreens("uz").joinNotice, allScreens("uz").stayNotice]) {
    assert.deepEqual(inline(n).map(brief), ["🎁 Bonuslar | b:h | success"]);
  }
  assert.deepEqual(inline(allScreens("ru").joinNotice).map(brief), ["🎁 Бонусы | b:h | success"]);
});

test("channel state + ledger titles of channel bonuses (unchanged rules)", () => {
  const claim = (agoDays: number, extra: { stayPaid?: number | null; leftAt?: string | null } = {}) => ({
    joinedAt: new Date(BONUS_NOW - agoDays * 86_400_000).toISOString(),
    joinPaid: 1000,
    stayPaid: extra.stayPaid ?? null,
    leftAt: extra.leftAt ?? null,
  });
  assert.deepEqual(bonus.channelState({ stayBonus: 2000, stayDays: 7, claim: claim(7) }, BONUS_NOW), { kind: "due" }, "day 7 passed, sweep not run yet");
  assert.deepEqual(bonus.channelState({ stayBonus: 2000, stayDays: 7, claim: claim(0) }, BONUS_NOW), { kind: "wait", daysLeft: 7 });
  assert.deepEqual(bonus.channelState({ stayBonus: 2000, stayDays: 7, claim: claim(1, { leftAt: new Date(BONUS_NOW).toISOString() }) }, BONUS_NOW), { kind: "done" });
  assert.deepEqual(bonus.channelState({ stayBonus: 0, stayDays: 7, claim: claim(0) }, BONUS_NOW), { kind: "done" });
  assert.deepEqual(bonus.channelState({ stayBonus: 2000, stayDays: 7, claim: null }, BONUS_NOW), { kind: "new" });
  // A due claim shows 0 days; a channel left before day N shows no stay part (forfeited, B-Q3).
  const t = bonusTasks();
  const due = bonus.bonusScreen("uz", { ...t, channels: [{ ...t.channels[1]!, claim: claim(8) }] }, BONUS_NOW);
  assert.match(kbRows(due)[2]![0]!.text, /· ⏳ 7 kun: 0 kun$/);
  const left = bonus.bonusScreen("uz", { ...t, channels: [{ ...t.channels[1]!, claim: claim(2, { leftAt: new Date(BONUS_NOW).toISOString() }) }] }, BONUS_NOW);
  assert.match(kbRows(left)[2]![0]!.text, /· \+1 000 so‘m$/);

  assert.equal(scr.ledgerTitle("ru", { kind: "bonus", note: "Kanal obunasi: SlaydX" }), "Подписка на канал · SlaydX");
  assert.equal(scr.ledgerTitle("en", { kind: "bonus", note: "Kanalda qolish bonusi: SlaydX" }), "Channel stay bonus · SlaydX");
  assert.equal(scr.ledgerTitle("uz", { kind: "bonus", note: "Kanal obunasi: SlaydX" }), "Kanal obunasi · SlaydX");
});

test("Hamyon card (B2-Q4): only the LAST 3 entries, inside <blockquote expandable> — MUTATSIYA B3", () => {
  const entries = Array.from({ length: 5 }, (_, i) => ({ kind: "charge", amount: -(i + 1) * 1000, note: `slide: Mavzu ${i}`, createdAt: "2026-10-07T10:00:00Z" }));
  const w = scr.walletScreen("uz", USER, entries);
  assert.equal(scr.WALLET_RECENT, 3);
  const quote = /<blockquote expandable>🧾 <b>So‘nggi amallar<\/b>\n([\s\S]*?)<\/blockquote>/.exec(w.text);
  assert.ok(quote, "history is an expandable quote");
  assert.deepEqual(quote[1]!.split("\n").map((l) => /Mavzu (\d)/.exec(l)?.[1]), ["0", "1", "2"]);
  assert.ok(!w.text.includes("Mavzu 3"));
  assert.match(scr.walletScreen("uz", USER, []).text, /<blockquote expandable>🧾 <b>So‘nggi amallar<\/b>\nHali amallar yo‘q\.<\/blockquote>/);
  assert.match(w.text, /^💰 <b>Hamyon<\/b>\n\n<blockquote>💰 Balans: <b>12 500 tanga<\/b>\n⭐ Shundan bonus: 2 000 so‘m<\/blockquote>\n\n<blockquote expandable>/);
});

test("/start welcome: a blank line between greeting · pitch · balance quote · app/site (3 languages) — MUTATSIYA B4", () => {
  for (const lang of LANGS) {
    const sections = allScreens(lang).welcome.text.split("\n\n");
    assert.equal(sections.length, 4, `${lang}: ${JSON.stringify(sections)}`);
    assert.match(sections[0]!, /^👋 <b>/);
    assert.match(sections[1]!, /^✨ /);
    assert.match(sections[2]!, /^<blockquote>💰 [\s\S]*<\/blockquote>$/);
    assert.match(sections[3]!, /^📱 [\s\S]*\n🌐 /);
  }
  assert.match(allScreens("uz").welcome.text, /🎁 Do‘st taklif qiling — har biriga <b>2 000 so‘m<\/b>/);
  assert.match(allScreens("ru").welcome.text, /<b>2 000 сум<\/b> за каждого/);
  // Without an account (a group): greeting · pitch · app/site.
  const anon = scr.welcomeScreen("uz", { user: null, loginLink: "https://slaydx.test/api/auth/telegram/enter?t=" + "x".repeat(43), rewardPoints: 2000 });
  assert.equal(anon.text.split("\n\n").length, 3);
});

test("units (B2-Q3): bonus amounts are so‘m / сум / UZS everywhere in the bot; no «ball» / «баллов» / «points» left", () => {
  for (const lang of LANGS) {
    for (const [name, s] of Object.entries(allScreens(lang))) {
      const all = `${s.text}\n${JSON.stringify(s.reply_markup ?? {})}`;
      assert.doesNotMatch(all, /\bball\b|балл|\bpoints?\b/i, `${lang}/${name}`);
    }
  }
  assert.match(allScreens("uz").referral.text, /Har bir yangi do'st uchun 2 000 so'm bonus\./);
  assert.match(allScreens("uz").referral.text, /Taklif qilinganlar: <b>3<\/b> · Topilgan bonus: <b>6 000 so'm<\/b>/);
  assert.match(allScreens("en").referral.text, /Bonus earned: <b>6 000 UZS<\/b>/);
  assert.match(allScreens("ru").profile.text, /бонус 2 000 сум/);
  assert.equal(i18n.t("en", "unit.som", { n: "1 000" }), "1 000 UZS");
});

/* ── bonus2 review fixes ── */

test("payment bonus task (C-Q4): «💳 Har to‘ldirishga +N% bonus» → wallet web app for any N > 0, in 3 languages; N = 0 → no button", () => {
  const urls = (s: { reply_markup?: unknown }) => inline(s).map((b) => b.web_app?.url ?? "");
  const on = bonus.bonusScreen("uz", { ...bonusTasks(), paymentBonus: { percent: 15, earnedPoints: 40_000 } }, BONUS_NOW);
  const btn = inline(on).find((b) => b.web_app);
  assert.ok(btn, "a web_app button");
  assert.equal(btn!.text.replace(/^💳 /, ""), "Har to‘ldirishga +15% bonus");
  assert.equal(btn!.web_app!.url, "https://slaydx.test/uz/wallet", "plain app URL, no personal link");
  // Still offered after earlier payments: every top-up earns it (the old first-top-up task disappeared after one).
  assert.equal(inline(bonus.bonusScreen("ru", { ...bonusTasks(), paymentBonus: { percent: 7, earnedPoints: 1 } }, BONUS_NOW)).find((b) => b.web_app)!.text.replace(/^💳 /, ""), "+7% бонус к каждому пополнению");
  assert.equal(inline(bonus.bonusScreen("en", { ...bonusTasks(), paymentBonus: { percent: 50, earnedPoints: 0 } }, BONUS_NOW)).find((b) => b.web_app)!.text.replace(/^💳 /, ""), "+50% bonus on every top-up");
  // MUTATION: `percent > 0` check dropped → «+0% bonus» was offered while the bonus is off.
  const off = bonus.bonusScreen("uz", { ...bonusTasks(), paymentBonus: { percent: 0, earnedPoints: 9_000 } }, BONUS_NOW);
  assert.ok(!urls(off).some((u) => u.endsWith("/uz/wallet")), "off → no task button");
  assert.ok(!inline(off).some((b) => /to‘ldirish/i.test(b.text)));
});

test("wallet card: «Har bir to‘ldirishga +N% bonus» line while N > 0; payment bonus ledger rows labelled in 3 languages", () => {
  const on = scr.walletScreen("uz", USER, [], 10);
  assert.match(on.text, /Har bir to‘ldirishga <b>\+10%<\/b> bonus\n.*To‘lov ilovada/);
  assert.match(scr.walletScreen("ru", USER, [], 25).text, /<b>\+25%<\/b> бонус к каждому пополнению/);
  assert.match(scr.walletScreen("en", USER, [], 5).text, /<b>\+5%<\/b> bonus on every top-up/);
  // MUTATION: the `bonusPercent > 0` guard dropped → «+0%» shown while off.
  assert.ok(!/to‘ldirishga/.test(scr.walletScreen("uz", USER, [], 0).text));
  assert.ok(!/to‘ldirishga/.test(scr.walletScreen("uz", USER, []).text), "default: no line");
  const row = { kind: "bonus", amount: 5000, note: "To‘lov bonusi (10%)", createdAt: "2026-10-09T10:00:00Z" };
  assert.match(scr.ledgerLine("uz", row), /— To‘lov bonusi \(10%\) ·/);
  assert.match(scr.ledgerLine("ru", row), /— Бонус за пополнение \(10%\) ·/);
  assert.match(scr.ledgerLine("en", row), /— Payment bonus \(10%\) ·/);
  // A legacy first top-up row still reads as before.
  assert.match(scr.ledgerLine("en", { ...row, note: "Birinchi to‘ldirish bonusi (10%)" }), /— First top-up bonus ·/);
});

test("clip: cuts by code points — an emoji in a long channel title is never split into a lone surrogate", () => {
  const title = "😀".repeat(30);
  const out = ui.clip(title, 10);
  // MUTATION: String#slice cut a surrogate pair → Telegram rejects the whole keyboard («must be UTF-8»).
  assert.equal(Array.from(out).length, 10);
  assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(out), "no lone high surrogate");
});
