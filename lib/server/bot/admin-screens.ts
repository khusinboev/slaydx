import { groupDigits } from "../../format";
import { TOOL_BY_ID } from "../../tools";
import type { BonusChannelItem, BotAdminStatus } from "../admin-bonus-channels";
import { BUTTON_TEXT_MAX, CAPTION_MAX } from "../broadcast-content";
import type { AdminBroadcast, BroadcastStats } from "../admin-broadcasts";
import type { Permission } from "../admin-rbac";
import { acb, type AudienceCode, type ChannelField, type ChannelType, type TypedField } from "./admin-codes";
import { at } from "./admin-i18n";
import type { BotAdmin } from "./admin-access";
import type { BotStats } from "./admin-stats";
import type { BroadcastDraft, ChannelDraft, ScreenKey } from "./admin-state";
import { toolTitle, type Lang } from "./i18n";
import { clip, esc, keyboardButton, tgEmoji, type ButtonStyle, type IconKey, type KeyboardButton, type Screen } from "./ui";

/**
 * In-bot admin panel screens (docs/bot-admin/PLAN.md) — pure renderers.
 * Buttons appear only for what the role may do; the handlers re-check anyway.
 *
 * Every screen is a REPLY keyboard (owner 2026-10-09): a screen declares its buttons as rows of
 * `{label, callback code}`; `keyScreen` renders the keyboard and the flat `keys` list (label -> code) that
 * the bot stores for the chat (`admin-state.ts writeKeys`). A tap arrives as a plain text message, is mapped
 * back to the code and runs the SAME handler the inline button ran. The only inline buttons left are the
 * broadcast's own URL button (the recipients' copy), which Telegram allows nowhere else.
 */

/** A screen of the admin panel: the message, its reply keyboard and the label -> code map of that keyboard. */
export type AdminScreen = Screen & { keys: ScreenKey[] };

type KeyDef = { icon: IconKey | null; text: string; code: string; style?: ButtonStyle };
const key = (icon: IconKey | null, text: string, code: string, style?: ButtonStyle): KeyDef => ({ icon, text, code, ...(style ? { style } : {}) });

/** The screen's reply keyboard (rows of `KeyDef`; empty rows / falsy buttons dropped) + its label -> code map. */
function keyScreen(text: string, ...defs: (KeyDef | null | undefined | false)[][]): AdminScreen {
  const keyboard: KeyboardButton[][] = [];
  const keys: ScreenKey[] = [];
  for (const row of defs) {
    const line: KeyboardButton[] = [];
    for (const k of row) {
      if (!k) continue;
      const b = keyboardButton(k.icon, k.text, k.style ? { style: k.style } : {});
      line.push(b);
      keys.push({ text: b.text, code: k.code });
    }
    if (line.length) keyboard.push(line);
  }
  return { text, reply_markup: { keyboard, is_persistent: true, resize_keyboard: true }, keys };
}

/**
 * Channel bonus presets (docs/bonus/PLAN.md B-Q2): optional — news 2 000 once, extra 1 000 + 2 000
 * after 7 days; mandatory (BONUS3.md C-Q2) — 2 000 once (the default) or no bonus at all.
 */
export const CHANNEL_PRESETS: Record<ChannelType, { joinBonus: number; stayBonus: number; stayDays: number }> = {
  n: { joinBonus: 2000, stayBonus: 0, stayDays: 7 },
  e: { joinBonus: 1000, stayBonus: 2000, stayDays: 7 },
  m: { joinBonus: 2000, stayBonus: 0, stayDays: 7 },
  z: { joinBonus: 0, stayBonus: 0, stayDays: 7 },
};

const som = (lang: Lang, v: number): string => (lang === "uz" ? `${groupDigits(v)} so‘m` : lang === "ru" ? `${groupDigits(v)} сум` : `${groupDigits(v)} UZS`);
const g = groupDigits;
const can = (a: BotAdmin, p: Permission) => a.permissions.includes(p);
const head = (icon: Parameters<typeof tgEmoji>[0], title: string) => `${tgEmoji(icon)} <b>${title}</b>`;
const back = (lang: Lang, code = acb.panel()) => key("back", at(lang, "btn.back"), code);
const cancel = (lang: Lang) => key("cancel", at(lang, "btn.cancel"), acb.cancel(), "danger");

/* ───────────────────────── Panel ───────────────────────── */

/** `payBonusPercent`: the current payment bonus (C-Q4) for the «💳 To‘lov bonusi: N%» button (roles with settings.view). */
/** Admin menu items of the reply keyboard (owner C-Q6): label key, icon, the panel action (callback code) it opens. */
export const ADMIN_MENU = [
  { key: "panel.stats", icon: "chart", data: acb.stats(), perm: "dashboard.view" },
  { key: "panel.broadcast", icon: "megaphone", data: acb.bcStart(), perm: "broadcasts.send" },
  { key: "panel.channels", icon: "bell", data: acb.channels(), perm: "bonus.view" },
  { key: "kb.payBonus", icon: "card", data: acb.payBonus(), perm: "settings.view" },
] as const satisfies readonly { key: string; icon: string; data: string; perm: Permission }[];

/**
 * The admin menu as a REPLY keyboard at the bottom (owner C-Q6): two per row, only what the role may open,
 * then «⬅️ Asosiy menyu». The texts are matched back by `adminMenuAction`; every tap re-checks the account.
 */
export function adminMenuKeyboard(a: BotAdmin): Record<string, unknown> {
  const l = a.lang;
  const items: KeyboardButton[] = ADMIN_MENU.filter((m) => can(a, m.perm)).map((m, i) =>
    keyboardButton(m.icon, at(l, m.key), i === 0 ? { style: "primary" } : {}),
  );
  const pairs: KeyboardButton[][] = [];
  for (let i = 0; i < items.length; i += 2) pairs.push(items.slice(i, i + 2));
  return {
    keyboard: [...pairs, [keyboardButton("back", at(l, "kb.mainMenu"))]],
    is_persistent: true,
    resize_keyboard: true,
  };
}

/** The panel's opening message: title, who you are, the hint — with the admin reply keyboard. */
export function adminMenuScreen(a: BotAdmin): AdminScreen {
  const l = a.lang;
  return {
    text: `${head("admin", at(l, "panel.title"))}\n\n${at(l, "panel.lead", { name: esc(a.name), role: at(l, `role.${a.role}`) })}\n\n${at(l, "panel.menuHint")}`,
    reply_markup: adminMenuKeyboard(a),
    // The menu's own texts are static (`admin.ts adminMenuAction`); no per-screen buttons.
    keys: [],
  };
}

/* ───────────────────────── Statistika ───────────────────────── */

function toolName(lang: Lang, id: string): string {
  const tool = (TOOL_BY_ID as Record<string, { title: string } | undefined>)[id];
  return toolTitle(lang, id, tool?.title ?? id);
}

function tashkentTime(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tashkent",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
    .format(d)
    .replace(",", "");
}

export function statsScreen(a: BotAdmin, s: BotStats): AdminScreen {
  const l = a.lang;
  const lines = [
    head("chart", at(l, "st.title")),
    "",
    `${tgEmoji("group")} <b>${at(l, "st.users")}</b>`,
    at(l, "st.usersLine", { total: g(s.users.total), today: g(s.users.today), week: g(s.users.week) }),
    at(l, "st.active", { n: g(s.users.active30) }),
    "",
    `${tgEmoji("doc")} <b>${at(l, "st.docs")}</b>`,
    at(l, "st.docsLine", { today: g(s.docs.today), week: g(s.docs.week) }),
    `${at(l, "st.top")} ${
      s.docs.top.length ? s.docs.top.map((t, i) => `${i + 1}. ${esc(toolName(l, t.toolId))} — ${g(t.count)}`).join(" · ") : at(l, "st.none")
    }`,
    "",
    `${tgEmoji("money")} <b>${at(l, "st.money")}</b>`,
    at(l, "st.moneyLine", {
      today: g(s.money.today),
      todayN: g(s.money.todayN),
      week: g(s.money.week),
      weekN: g(s.money.weekN),
      month: g(s.money.month),
      monthN: g(s.money.monthN),
    }),
  ];
  // Bonus payouts and channels are the «Bonus kanallar» data: only for roles with bonus.view.
  if (can(a, "bonus.view")) {
    lines.push("", `${tgEmoji("gift")} <b>${at(l, "st.bonus")}</b>`);
    if (!s.bonuses.length) lines.push(at(l, "st.none"));
    for (const b of s.bonuses) {
      lines.push(at(l, "st.bonusLine", { label: at(l, `st.bonus.${b.kind}`), sum: som(l, b.sum), n: g(b.count) }));
    }
    lines.push("", `${tgEmoji("megaphone")} <b>${at(l, "st.channels")}</b>`);
    if (!s.channels.length) lines.push(at(l, "st.noChannels"));
    for (const c of s.channels) {
      lines.push(
        at(l, "st.channelLine", { title: esc(clip(c.title, 40)), members: c.members === null ? "—" : g(c.members), joined: g(c.joined) }),
      );
    }
  }
  lines.push("", `<i>${at(l, "st.at", { time: tashkentTime(s.at) })}</i>`);
  return keyScreen(lines.join("\n"), [key("refresh", at(l, "btn.refresh"), acb.stats(), "primary"), back(l)]);
}

/* ───────────────────────── Xabar yuborish ───────────────────────── */

export function broadcastAskScreen(lang: Lang): AdminScreen {
  return keyScreen(`${head("megaphone", at(lang, "bc.title"))}\n\n${at(lang, "bc.ask")}`, [cancel(lang)]);
}

export type InputProblem =
  | { kind: "type" }
  | { kind: "long"; n: number; max: number }
  | { kind: "caption"; n: number }
  | { kind: "button" };

/** The prompt again with what was wrong on top (a new message under the admin's answer). */
export function inputProblemScreen(lang: Lang, p: InputProblem, prompt: AdminScreen): AdminScreen {
  const why =
    p.kind === "type"
      ? at(lang, "bc.badType")
      : p.kind === "long"
        ? at(lang, "bc.tooLong", { n: g(p.n), max: g(p.max) })
        : p.kind === "caption"
          ? at(lang, "bc.captionLong", { n: g(p.n), max: g(CAPTION_MAX) })
          : at(lang, "bc.buttonBad", { max: BUTTON_TEXT_MAX });
  return { ...prompt, text: `${tgEmoji("warn")} ${esc(why)}\n\n${prompt.text}` };
}

export function draftScreen(lang: Lang, d: BroadcastDraft): AdminScreen {
  const b = d.content.button;
  return keyScreen(
    [
      head("megaphone", at(lang, "bc.received")),
      "",
      at(lang, "bc.kindLine", { kind: at(lang, `bc.kind.${d.content.kind}`), n: g(Array.from(d.text).length) }),
      b ? at(lang, "bc.buttonLine", { text: esc(b.text), url: esc(b.url) }) : at(lang, "bc.noButton"),
      "",
      at(lang, "bc.draftHint"),
    ].join("\n"),
    [b ? key("cancel", at(lang, "bc.removeButton"), acb.bcButtonDrop()) : key("link", at(lang, "bc.addButton"), acb.bcButton())],
    [key("group", at(lang, "bc.toAudience"), acb.bcAudience(), "primary")],
    [cancel(lang)],
  );
}

export function buttonAskScreen(lang: Lang): AdminScreen {
  return keyScreen(`${head("link", at(lang, "bc.addButton"))}\n\n${at(lang, "bc.buttonAsk", { max: BUTTON_TEXT_MAX })}`, [back(lang, acb.bcDraft()), cancel(lang)]);
}

const AUD_KEY = { all: "aud.all", act: "aud.act", new: "aud.new" } as const;
const AUD_ICON = { all: "group", act: "fire", new: "new" } as const;

export function audienceLabel(lang: Lang, a: AudienceCode): string {
  return at(lang, AUD_KEY[a]);
}

export function audienceScreen(lang: Lang, counts: Record<AudienceCode, number>): AdminScreen {
  const btn = (a: AudienceCode) => key(AUD_ICON[a], `${audienceLabel(lang, a)} · ${g(counts[a])}`, acb.bcPick(a));
  return keyScreen(`${head("group", at(lang, "bc.audienceTitle"))}\n\n${at(lang, "bc.audienceLead")}`, [btn("all")], [btn("act")], [btn("new")], [back(lang, acb.bcDraft()), cancel(lang)]);
}

/** Under the preview copy: audience + count, «🧪 O‘zimga sinov», «✅ Yuborish (N kishiga)». */
export function confirmScreen(lang: Lang, a: AudienceCode, count: number): AdminScreen {
  const lines = [head("search", at(lang, "bc.previewTitle")), "", at(lang, "bc.previewLine", { aud: audienceLabel(lang, a), n: g(count) })];
  lines.push(count > 0 ? at(lang, "bc.previewHint") : `${tgEmoji("warn")} ${at(lang, "bc.empty")}`);
  return keyScreen(
    lines.join("\n"),
    [key("sparkles", at(lang, "bc.test"), acb.bcTest())],
    [count > 0 && key("save", at(lang, "bc.send", { n: g(count) }), acb.bcSend(count), "success")],
    [back(lang, acb.bcAudience()), cancel(lang)],
  );
}

/** «1 daq 05 s» / «42 s» for the ETA line. */
function etaText(seconds: number): string {
  const t = Math.max(0, Math.round(seconds));
  return t < 60 ? `${t} s` : `${Math.floor(t / 60)} min ${String(t % 60).padStart(2, "0")} s`;
}

export function progressScreen(lang: Lang, b: AdminBroadcast, s: BroadcastStats, canStop: boolean): AdminScreen {
  const running = b.status === "queued" || b.status === "sending";
  const live = running || b.status === "draft" || b.status === "paused";
  const lines = [
    head("megaphone", at(lang, "bc.status", { id: b.id })),
    "",
    at(lang, "bc.statusLine", { status: at(lang, `bc.st.${b.status}`) }),
    at(lang, "bc.progress", { sent: g(s.sent), total: g(s.total), failed: g(s.failed), pending: g(s.pending) }),
  ];
  if (running && s.speed > 0) {
    lines.push(at(lang, "bc.speed", { speed: s.speed.toFixed(1), eta: s.etaSeconds === null ? "—" : etaText(s.etaSeconds) }));
  }
  if (b.status === "failed" && b.failReason) lines.push("", esc(b.failReason));
  // The bot message itself is only edited as TEXT by the delivery loop; these are the controls (reply keyboard).
  return keyScreen(
    lines.join("\n"),
    [
      live && key("refresh", at(lang, "btn.refresh"), acb.bcProgress(b.id), "primary"),
      running && canStop && key("clock", at(lang, "bc.pause"), acb.bcPause(b.id)),
      b.status === "paused" && canStop && key("next", at(lang, "bc.resume"), acb.bcResume(b.id), "success"),
    ],
    [live && b.status !== "draft" && canStop && key("stop", at(lang, "bc.stop"), acb.bcStopAsk(b.id), "danger"), key("admin", at(lang, "btn.panel"), acb.panel())],
  );
}

export function stopAskScreen(lang: Lang, id: string, unsent: number): AdminScreen {
  return keyScreen(
    `${tgEmoji("stop")} ${at(lang, "bc.stopAsk", { id, n: g(unsent) })}`,
    [key("stop", at(lang, "bc.stopYes"), acb.bcStop(id), "danger")],
    [back(lang, acb.bcProgress(id))],
  );
}

/** The finished-broadcast summary: text only - the delivery loop sends it with the admin menu reply keyboard. */
export function broadcastDoneScreen(lang: Lang, id: string, s: { sent: number; failed: number; total: number }): Screen {
  return {
    text: `${tgEmoji("party")} <b>${at(lang, "bc.doneTitle", { id })}</b>\n${at(lang, "bc.doneLine", { sent: g(s.sent), failed: g(s.failed), total: g(s.total) })}`,
  };
}

/* ───────────────────────── Kanal ulash ───────────────────────── */

function amountText(lang: Lang, c: { joinBonus: number; stayBonus: number; stayDays: number }): string {
  if (c.stayBonus > 0) return at(lang, "ch.amountE", { join: som(lang, c.joinBonus), stay: som(lang, c.stayBonus), days: c.stayDays });
  return c.joinBonus > 0 ? som(lang, c.joinBonus) : at(lang, "ch.noBonus");
}

/** «🔒 » before a mandatory channel (C-Q2). */
const lockMark = (c: { mandatory?: boolean }) => (c.mandatory ? "🔒 " : "");

export function channelsScreen(a: BotAdmin, items: BonusChannelItem[]): AdminScreen {
  const l = a.lang;
  const lines = [head("megaphone", at(l, "ch.title")), ""];
  if (!items.length) lines.push(at(l, "ch.empty"));
  for (const c of items.slice(0, 20)) {
    lines.push(
      at(l, "ch.line", {
        icon: c.active ? "✅" : "⏸",
        title: `${lockMark(c)}${esc(clip(c.title, 40))}`,
        user: c.username ? ` (@${esc(c.username)})` : "",
        amount: amountText(l, c),
        n: g(c.stats.joinPaidCount),
      }),
    );
  }
  if (items.length) lines.push("", can(a, "bonus.edit") ? at(l, "ch.toggleHint") : at(l, "ch.viewOnly"));
  // One button per channel opens its card (read-only without bonus.edit); the «N.» prefix keeps every label unique
  // (two channels may share a title) and the title is clipped by code points (`clip`), so a label is never cut
  // inside an emoji.
  const rows: KeyDef[][] = items.slice(0, 20).map((c, i) => [key(null, `${i + 1}. ${c.active ? "✅" : "⏸"} ${lockMark(c)}${clip(c.title, 30)}`, acb.chView(c.id))]);
  return keyScreen(lines.join("\n"), ...rows, [can(a, "bonus.edit") && key("plus", at(l, "ch.connect"), acb.chConnect(), "primary"), back(l)]);
}

/** A value of a card field as the card and the confirm screen show it. */
type FieldValue = string | number | boolean | null;

function fieldValueText(lang: Lang, field: ChannelField, v: FieldValue): string {
  switch (field) {
    case "title":
      return esc(clip(String(v ?? ""), 60));
    case "inviteLink":
      return v ? esc(String(v)) : at(lang, "ch.none");
    case "joinBonus":
    case "stayBonus":
      return Number(v) > 0 ? som(lang, Number(v)) : at(lang, "ch.none");
    case "stayDays":
      return at(lang, "ch.days", { n: Number(v) });
    case "sort":
      return g(Number(v));
    case "mandatory":
      return at(lang, v ? "ch.kindM" : "ch.kindO");
    case "active":
      return at(lang, v ? "ch.statusOn" : "ch.statusOff");
  }
}

/** The current value of a field of a stored channel. */
export const channelFieldValue = (c: BonusChannelItem, field: ChannelField): FieldValue => c[field];

/**
 * The channel card (owner 2026-10-09): everything the web's edit dialog edits, and the buttons that edit it (roles
 * with bonus.edit; «🗑» only for a PAUSED channel nobody got a bonus from — the web's rule). Others see it read-only.
 */
export function channelCardScreen(a: BotAdmin, c: BonusChannelItem, botAdmin?: BotAdminStatus): AdminScreen {
  const l = a.lang;
  const edit = can(a, "bonus.edit");
  const where = c.username ? `@${esc(c.username)}` : at(l, "ch.private");
  const lines = [
    head("megaphone", esc(clip(c.title, 60))),
    `${where} · ID <code>${esc(c.chatId)}</code>`,
    "",
    at(l, "ch.cardKind", { v: fieldValueText(l, "mandatory", c.mandatory) }),
    at(l, "ch.cardJoin", { v: fieldValueText(l, "joinBonus", c.joinBonus) }),
    at(l, "ch.cardStay", { v: fieldValueText(l, "stayBonus", c.stayBonus), days: fieldValueText(l, "stayDays", c.stayDays) }),
    at(l, "ch.cardLink", { v: fieldValueText(l, "inviteLink", c.inviteLink) }),
    at(l, "ch.cardSort", { v: fieldValueText(l, "sort", c.sort) }),
    at(l, "ch.cardStatus", { v: fieldValueText(l, "active", c.active) }),
    at(l, "ch.cardClaims", { n: g(c.stats.joinPaidCount) }),
  ];
  if (botAdmin) lines.push("", botAdmin === "admin" ? at(l, "ch.botAdmin") : botAdmin === "not_admin" ? at(l, "ch.botNotAdmin") : at(l, "ch.botUnknown"));
  lines.push("", edit ? at(l, "ch.cardHint") : at(l, "ch.viewOnly"));
  const canDelete = !c.active && c.stats.joined === 0;
  const rows: (KeyDef | false)[][] = edit
    ? [
        [key("edit", at(l, "ch.btn.title"), acb.chEdit("title", c.id)), key("link", at(l, "ch.btn.inviteLink"), acb.chEdit("inviteLink", c.id))],
        [key("wallet", at(l, "ch.btn.joinBonus"), acb.chEdit("joinBonus", c.id)), key("gift", at(l, "ch.btn.stayBonus"), acb.chEdit("stayBonus", c.id))],
        [key(null, `📅 ${at(l, "ch.btn.stayDays")}`, acb.chEdit("stayDays", c.id)), key(null, `↕️ ${at(l, "ch.btn.sort")}`, acb.chEdit("sort", c.id))],
        [c.mandatory ? key("plus", at(l, "ch.btn.makeOptional"), acb.chEdit("mandatory", c.id)) : key("lock", at(l, "ch.btn.makeMandatory"), acb.chEdit("mandatory", c.id))],
        [c.active ? key(null, `⏸ ${at(l, "ch.btn.pause")}`, acb.chEdit("active", c.id)) : key("save", at(l, "ch.btn.resume"), acb.chEdit("active", c.id), "success")],
        [canDelete && key(null, `🗑 ${at(l, "ch.btn.delete")}`, acb.chDeleteAsk(c.id), "danger")],
      ]
    : [];
  return keyScreen(lines.join("\n"), ...rows, [back(l, acb.channels())]);
}

/** Asks for the new value of one typed field (title / link / amounts / days / sort); `problem` = why the last answer was refused. */
export function channelEditAskScreen(lang: Lang, c: BonusChannelItem, field: TypedField, problem?: string): AdminScreen {
  const now = fieldValueText(lang, field, channelFieldValue(c, field));
  return keyScreen(
    `${problem ? `${tgEmoji("warn")} ${esc(problem)}\n\n` : ""}${head("megaphone", esc(clip(c.title, 60)))}\n\n<b>${at(lang, `ch.f.${field}`)}</b>\n${at(lang, "ch.nowValue", { v: now })}\n\n${at(lang, `ch.ask.${field}`)}`,
    [field === "inviteLink" && c.inviteLink !== null && key(null, `🧹 ${at(lang, "ch.btn.dropLink")}`, acb.chLinkDrop(c.id))],
    [back(lang, acb.chView(c.id)), cancel(lang)],
  );
}

/** «<field>: old → new. Saqlansinmi?» with «✅ Saqlash» (the confirmed code; step-up in 2FA mode). */
export function channelChangeConfirmScreen(lang: Lang, c: BonusChannelItem, field: ChannelField, from: FieldValue, to: FieldValue): AdminScreen {
  return keyScreen(
    `${head("megaphone", esc(clip(c.title, 60)))}\n\n${at(lang, "ch.editConfirm", { field: at(lang, `ch.f.${field}`), old: fieldValueText(lang, field, from), new: fieldValueText(lang, field, to) })}`,
    [key("save", at(lang, "ch.btn.save"), acb.chSave(c.id), "success")],
    [back(lang, acb.chView(c.id))],
  );
}

/** «🗑 O‘chirish» on the card → confirm: the channel is removed for good (the service audits it). */
export function channelDeleteAskScreen(lang: Lang, c: BonusChannelItem): AdminScreen {
  return keyScreen(
    `${head("warn", at(lang, "ch.deleteTitle"))}\n\n${at(lang, "ch.deleteAsk", { title: esc(clip(c.title, 60)) })}`,
    [key(null, `🗑 ${at(lang, "ch.deleteYes")}`, acb.chDelete(c.id), "danger")],
    [back(lang, acb.chView(c.id))],
  );
}

export function channelAskScreen(lang: Lang): AdminScreen {
  return keyScreen(`${head("megaphone", at(lang, "ch.connect"))}\n\n${at(lang, "ch.ask")}`, [cancel(lang)]);
}

export function channelProblemScreen(lang: Lang, why: string): AdminScreen {
  const prompt = channelAskScreen(lang);
  return { ...prompt, text: `${tgEmoji("warn")} ${why}\n\n${prompt.text}` };
}

function channelHead(lang: Lang, d: ChannelDraft): string[] {
  const where = d.username ? `@${esc(d.username)}` : at(lang, "ch.private");
  const bot = d.botAdmin === "admin" ? at(lang, "ch.botAdmin") : d.botAdmin === "not_admin" ? at(lang, "ch.botNotAdmin") : at(lang, "ch.botUnknown");
  return [head("megaphone", esc(clip(d.title, 60))), `${where} · ID <code>${esc(d.chatId)}</code>`, "", bot];
}

/** After resolving the channel: «🔒 Majburiy» or «➕ Ixtiyoriy» (docs/bonus/BONUS3.md C-Q2), then the bonus presets. */
export function channelKindScreen(lang: Lang, d: ChannelDraft): AdminScreen {
  return keyScreen(
    [...channelHead(lang, d), "", at(lang, "ch.pickKind")].join("\n"),
    [key(null, at(lang, "ch.kindM"), acb.chKind("m"), "primary"), key(null, at(lang, "ch.kindO"), acb.chKind("o"))],
    [cancel(lang)],
  );
}

/** Bonus presets of the picked kind: mandatory — 2 000 (default) / no bonus; optional — today's news / extra. */
export function channelTypeScreen(lang: Lang, d: ChannelDraft): AdminScreen {
  const kind = d.mandatory ? at(lang, "ch.kindM") : at(lang, "ch.kindO");
  const n = CHANNEL_PRESETS.n;
  const e = CHANNEL_PRESETS.e;
  const presets: KeyDef[][] = d.mandatory
    ? [
        [key("gift", at(lang, "ch.typeM", { join: som(lang, CHANNEL_PRESETS.m.joinBonus) }), acb.chType("m"), "primary")],
        [key(null, at(lang, "ch.typeZ"), acb.chType("z"))],
      ]
    : [
        [key("doc", at(lang, "ch.typeN", { join: som(lang, n.joinBonus) }), acb.chType("n"))],
        [key("plus", at(lang, "ch.typeE", { join: g(e.joinBonus), stay: g(e.stayBonus), days: e.stayDays }), acb.chType("e"))],
      ];
  return keyScreen([...channelHead(lang, d), "", at(lang, "ch.confirmKind", { kind }), "", at(lang, "ch.pickType")].join("\n"), ...presets, [back(lang, acb.chKinds()), cancel(lang)]);
}

export function channelConfirmScreen(lang: Lang, d: ChannelDraft, type: ChannelType): AdminScreen {
  const p = CHANNEL_PRESETS[type];
  const lines = [
    ...channelHead(lang, d),
    "",
    at(lang, "ch.confirmKind", { kind: d.mandatory ? at(lang, "ch.kindM") : at(lang, "ch.kindO") }),
    at(lang, "ch.confirmType", { type: at(lang, `ch.type.${type}`) }),
    at(lang, "ch.confirmJoin", { join: p.joinBonus > 0 ? som(lang, p.joinBonus) : at(lang, "ch.noBonus") }),
  ];
  if (p.stayBonus > 0) lines.push(at(lang, "ch.confirmStay", { days: p.stayDays, stay: som(lang, p.stayBonus) }));
  lines.push("", at(lang, "ch.confirmAsk"));
  return keyScreen(lines.join("\n"), [key("save", at(lang, "ch.confirm"), acb.chCreate(type), "success")], [back(lang, acb.chTypes()), cancel(lang)]);
}

/* ───────────────────────── To‘lov bonusi (C-Q4) ───────────────────────── */

/** The quick choices; any other 0–50 value goes through «Boshqa». */
export const PAY_BONUS_PRESETS = [0, 5, 10, 15, 20] as const;

/** The payment bonus card: the current percent, the rule, and (settings.edit) the choices. */
export function payBonusScreen(a: BotAdmin, percent: number): AdminScreen {
  const l = a.lang;
  const edit = can(a, "settings.edit");
  const lines = [head("card", at(l, "pb.title")), "", percent > 0 ? at(l, "pb.now", { p: percent }) : at(l, "pb.off"), at(l, "pb.rule")];
  lines.push("", edit ? at(l, "pb.pick") : at(l, "pb.viewOnly"));
  const choices: KeyDef[] = edit ? PAY_BONUS_PRESETS.map((p) => key(p === percent ? "save" : null, `${p}%`, acb.pbPick(p), p === percent ? "success" : undefined)) : [];
  return keyScreen(lines.join("\n"), choices, [edit && key("edit", at(l, "pb.other"), acb.pbOther()), back(l)]);
}

export function payBonusAskScreen(lang: Lang, problem?: string): AdminScreen {
  return keyScreen(`${problem ? `${tgEmoji("warn")} ${problem}\n\n` : ""}${head("card", at(lang, "pb.title"))}\n\n${at(lang, "pb.ask")}`, [back(lang, acb.payBonus()), cancel(lang)]);
}

export function payBonusConfirmScreen(lang: Lang, from: number, to: number): AdminScreen {
  return keyScreen(
    `${head("card", at(lang, "pb.title"))}\n\n${at(lang, "pb.confirmAsk", { from, to })}`,
    [key("save", at(lang, "pb.confirm", { to }), acb.pbSet(to), "success")],
    [back(lang, acb.payBonus())],
  );
}

/* ───────────────────────── Step-up ───────────────────────── */

export function stepUpScreen(lang: Lang, problem?: string): AdminScreen {
  return keyScreen(`${problem ? `${tgEmoji("warn")} ${esc(problem)}\n\n` : ""}${head("lock", at(lang, "su.title"))}\n\n${at(lang, "su.ask")}`, [cancel(lang)]);
}
