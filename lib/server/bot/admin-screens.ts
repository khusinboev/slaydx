import { groupDigits } from "../../format";
import { TOOL_BY_ID } from "../../tools";
import type { BonusChannelItem } from "../admin-bonus-channels";
import { BUTTON_TEXT_MAX, CAPTION_MAX } from "../broadcast-content";
import type { AdminBroadcast, BroadcastStats } from "../admin-broadcasts";
import type { Permission } from "../admin-rbac";
import { acb, type AudienceCode, type ChannelType } from "./admin-codes";
import { at } from "./admin-i18n";
import type { BotAdmin } from "./admin-access";
import type { BotStats } from "./admin-stats";
import type { BroadcastDraft, ChannelDraft } from "./admin-state";
import { toolTitle, type Lang } from "./i18n";
import { clip, esc, inlineButton, keyboardButton, rows, tgEmoji, type InlineButton, type KeyboardButton, type Screen } from "./ui";

/**
 * In-bot admin panel screens (docs/bot-admin/PLAN.md) — pure renderers.
 * Buttons appear only for what the role may do; the handlers re-check anyway.
 */

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
const back = (lang: Lang, data = acb.panel()) => inlineButton("back", at(lang, "btn.back"), { callback_data: data });
const cancel = (lang: Lang) => inlineButton("cancel", at(lang, "btn.cancel"), { callback_data: acb.cancel() }, "danger");

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
export function adminMenuScreen(a: BotAdmin): Screen {
  const l = a.lang;
  return {
    text: `${head("admin", at(l, "panel.title"))}\n\n${at(l, "panel.lead", { name: esc(a.name), role: at(l, `role.${a.role}`) })}\n\n${at(l, "panel.menuHint")}`,
    reply_markup: adminMenuKeyboard(a),
  };
}

export function panelScreen(a: BotAdmin, payBonusPercent?: number): Screen {
  const l = a.lang;
  return {
    text: `${head("admin", at(l, "panel.title"))}\n\n${at(l, "panel.lead", { name: esc(a.name), role: at(l, `role.${a.role}`) })}`,
    reply_markup: rows(
      [can(a, "dashboard.view") && inlineButton("chart", at(l, "panel.stats"), { callback_data: acb.stats() }, "primary")],
      [can(a, "broadcasts.send") && inlineButton("megaphone", at(l, "panel.broadcast"), { callback_data: acb.bcStart() })],
      [can(a, "bonus.view") && inlineButton("bell", at(l, "panel.channels"), { callback_data: acb.channels() })],
      [
        can(a, "settings.view") &&
          payBonusPercent !== undefined &&
          inlineButton("card", at(l, "panel.payBonus", { p: payBonusPercent }), { callback_data: acb.payBonus() }),
      ],
      [inlineButton("back", at(l, "panel.close"), { callback_data: acb.close() })],
    ),
  };
}

export function closedScreen(lang: Lang): Screen {
  return { text: at(lang, "panel.closed") };
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

export function statsScreen(a: BotAdmin, s: BotStats): Screen {
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
  return {
    text: lines.join("\n"),
    reply_markup: rows([inlineButton("refresh", at(l, "btn.refresh"), { callback_data: acb.stats() }, "primary")], [back(l)]),
  };
}

/* ───────────────────────── Xabar yuborish ───────────────────────── */

export function broadcastAskScreen(lang: Lang): Screen {
  return { text: `${head("megaphone", at(lang, "bc.title"))}\n\n${at(lang, "bc.ask")}`, reply_markup: rows([cancel(lang)]) };
}

export type InputProblem =
  | { kind: "type" }
  | { kind: "long"; n: number; max: number }
  | { kind: "caption"; n: number }
  | { kind: "button" };

/** The prompt again with what was wrong on top (a new message under the admin's answer). */
export function inputProblemScreen(lang: Lang, p: InputProblem, prompt: Screen): Screen {
  const why =
    p.kind === "type"
      ? at(lang, "bc.badType")
      : p.kind === "long"
        ? at(lang, "bc.tooLong", { n: g(p.n), max: g(p.max) })
        : p.kind === "caption"
          ? at(lang, "bc.captionLong", { n: g(p.n), max: g(CAPTION_MAX) })
          : at(lang, "bc.buttonBad", { max: BUTTON_TEXT_MAX });
  return { text: `${tgEmoji("warn")} ${esc(why)}\n\n${prompt.text}`, reply_markup: prompt.reply_markup };
}

export function draftScreen(lang: Lang, d: BroadcastDraft): Screen {
  const b = d.content.button;
  return {
    text: [
      head("megaphone", at(lang, "bc.received")),
      "",
      at(lang, "bc.kindLine", { kind: at(lang, `bc.kind.${d.content.kind}`), n: g(Array.from(d.text).length) }),
      b ? at(lang, "bc.buttonLine", { text: esc(b.text), url: esc(b.url) }) : at(lang, "bc.noButton"),
      "",
      at(lang, "bc.draftHint"),
    ].join("\n"),
    reply_markup: rows(
      [
        b
          ? inlineButton("cancel", at(lang, "bc.removeButton"), { callback_data: acb.bcButtonDrop() })
          : inlineButton("link", at(lang, "bc.addButton"), { callback_data: acb.bcButton() }),
      ],
      [inlineButton("group", at(lang, "bc.toAudience"), { callback_data: acb.bcAudience() }, "primary")],
      [cancel(lang)],
    ),
  };
}

export function buttonAskScreen(lang: Lang): Screen {
  return {
    text: `${head("link", at(lang, "bc.addButton"))}\n\n${at(lang, "bc.buttonAsk", { max: BUTTON_TEXT_MAX })}`,
    reply_markup: rows([back(lang, acb.cancel())]),
  };
}

const AUD_KEY = { all: "aud.all", act: "aud.act", new: "aud.new" } as const;
const AUD_ICON = { all: "group", act: "fire", new: "new" } as const;

export function audienceLabel(lang: Lang, a: AudienceCode): string {
  return at(lang, AUD_KEY[a]);
}

export function audienceScreen(lang: Lang, counts: Record<AudienceCode, number>): Screen {
  const btn = (a: AudienceCode) => inlineButton(AUD_ICON[a], `${audienceLabel(lang, a)} · ${g(counts[a])}`, { callback_data: acb.bcPick(a) });
  return {
    text: `${head("group", at(lang, "bc.audienceTitle"))}\n\n${at(lang, "bc.audienceLead")}`,
    reply_markup: rows([btn("all")], [btn("act")], [btn("new")], [back(lang, acb.bcDraft())], [cancel(lang)]),
  };
}

/** Under the preview copy: audience + count, «🧪 O‘zimga sinov», «✅ Yuborish (N kishiga)». */
export function confirmScreen(lang: Lang, a: AudienceCode, count: number): Screen {
  const lines = [head("search", at(lang, "bc.previewTitle")), "", at(lang, "bc.previewLine", { aud: audienceLabel(lang, a), n: g(count) })];
  lines.push(count > 0 ? at(lang, "bc.previewHint") : `${tgEmoji("warn")} ${at(lang, "bc.empty")}`);
  return {
    text: lines.join("\n"),
    reply_markup: rows(
      [inlineButton("sparkles", at(lang, "bc.test"), { callback_data: acb.bcTest() })],
      [count > 0 && inlineButton("save", at(lang, "bc.send", { n: g(count) }), { callback_data: acb.bcSend(count) }, "success")],
      [back(lang, acb.bcAudience())],
      [cancel(lang)],
    ),
  };
}

export function progressScreen(lang: Lang, b: AdminBroadcast, s: BroadcastStats, canStop: boolean): Screen {
  const live = b.status === "queued" || b.status === "sending" || b.status === "draft";
  return {
    text: [
      head("megaphone", at(lang, "bc.status", { id: b.id })),
      "",
      at(lang, "bc.statusLine", { status: at(lang, `bc.st.${b.status}`) }),
      at(lang, "bc.progress", { sent: g(s.sent), total: g(s.total), failed: g(s.failed), pending: g(s.pending) }),
    ].join("\n"),
    reply_markup: rows(
      [live && inlineButton("refresh", at(lang, "btn.refresh"), { callback_data: acb.bcProgress(b.id) }, "primary")],
      [live && canStop && inlineButton("stop", at(lang, "bc.stop"), { callback_data: acb.bcStopAsk(b.id) }, "danger")],
      [inlineButton("admin", at(lang, "btn.panel"), { callback_data: acb.panel() })],
    ),
  };
}

export function stopAskScreen(lang: Lang, id: string, unsent: number): Screen {
  return {
    text: `${tgEmoji("stop")} ${at(lang, "bc.stopAsk", { id, n: g(unsent) })}`,
    reply_markup: rows(
      [inlineButton("stop", at(lang, "bc.stopYes"), { callback_data: acb.bcStop(id) }, "danger")],
      [back(lang, acb.bcProgress(id))],
    ),
  };
}

export function broadcastDoneScreen(lang: Lang, id: string, s: { sent: number; failed: number; total: number }): Screen {
  return {
    text: `${tgEmoji("party")} <b>${at(lang, "bc.doneTitle", { id })}</b>\n${at(lang, "bc.doneLine", { sent: g(s.sent), failed: g(s.failed), total: g(s.total) })}`,
    reply_markup: rows([inlineButton("admin", at(lang, "btn.panel"), { callback_data: acb.panel() })]),
  };
}

/* ───────────────────────── Kanal ulash ───────────────────────── */

function amountText(lang: Lang, c: { joinBonus: number; stayBonus: number; stayDays: number }): string {
  if (c.stayBonus > 0) return at(lang, "ch.amountE", { join: som(lang, c.joinBonus), stay: som(lang, c.stayBonus), days: c.stayDays });
  return c.joinBonus > 0 ? som(lang, c.joinBonus) : at(lang, "ch.noBonus");
}

/** «🔒 » before a mandatory channel (C-Q2). */
const lockMark = (c: { mandatory?: boolean }) => (c.mandatory ? "🔒 " : "");

export function channelsScreen(a: BotAdmin, items: BonusChannelItem[]): Screen {
  const l = a.lang;
  const edit = can(a, "bonus.edit");
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
  if (items.length) lines.push("", edit ? at(l, "ch.toggleHint") : at(l, "ch.viewOnly"));
  const toggles: InlineButton[][] = edit
    ? items.slice(0, 20).map((c) => [inlineButton(null, `${c.active ? "✅" : "⏸"} ${lockMark(c)}${clip(c.title, 30)}`, { callback_data: acb.chToggle(c.id) })])
    : [];
  return {
    text: lines.join("\n"),
    reply_markup: rows(...toggles, [edit && inlineButton("plus", at(l, "ch.connect"), { callback_data: acb.chConnect() }, "primary")], [back(l)]),
  };
}

export function channelAskScreen(lang: Lang): Screen {
  return { text: `${head("megaphone", at(lang, "ch.connect"))}\n\n${at(lang, "ch.ask")}`, reply_markup: rows([cancel(lang)]) };
}

export function channelProblemScreen(lang: Lang, why: string): Screen {
  const prompt = channelAskScreen(lang);
  return { text: `${tgEmoji("warn")} ${why}\n\n${prompt.text}`, reply_markup: prompt.reply_markup };
}

function channelHead(lang: Lang, d: ChannelDraft): string[] {
  const where = d.username ? `@${esc(d.username)}` : at(lang, "ch.private");
  const bot = d.botAdmin === "admin" ? at(lang, "ch.botAdmin") : d.botAdmin === "not_admin" ? at(lang, "ch.botNotAdmin") : at(lang, "ch.botUnknown");
  return [head("megaphone", esc(clip(d.title, 60))), `${where} · ID <code>${esc(d.chatId)}</code>`, "", bot];
}

/** After resolving the channel: «🔒 Majburiy» or «➕ Ixtiyoriy» (docs/bonus/BONUS3.md C-Q2), then the bonus presets. */
export function channelKindScreen(lang: Lang, d: ChannelDraft): Screen {
  return {
    text: [...channelHead(lang, d), "", at(lang, "ch.pickKind")].join("\n"),
    reply_markup: rows(
      [inlineButton(null, at(lang, "ch.kindM"), { callback_data: acb.chKind("m") }, "primary")],
      [inlineButton(null, at(lang, "ch.kindO"), { callback_data: acb.chKind("o") })],
      [cancel(lang)],
    ),
  };
}

/** Bonus presets of the picked kind: mandatory — 2 000 (default) / no bonus; optional — today's news / extra. */
export function channelTypeScreen(lang: Lang, d: ChannelDraft): Screen {
  const kind = d.mandatory ? at(lang, "ch.kindM") : at(lang, "ch.kindO");
  const n = CHANNEL_PRESETS.n;
  const e = CHANNEL_PRESETS.e;
  const presets: InlineButton[][] = d.mandatory
    ? [
        [inlineButton("gift", at(lang, "ch.typeM", { join: som(lang, CHANNEL_PRESETS.m.joinBonus) }), { callback_data: acb.chType("m") }, "primary")],
        [inlineButton(null, at(lang, "ch.typeZ"), { callback_data: acb.chType("z") })],
      ]
    : [
        [inlineButton("doc", at(lang, "ch.typeN", { join: som(lang, n.joinBonus) }), { callback_data: acb.chType("n") })],
        [inlineButton("plus", at(lang, "ch.typeE", { join: g(e.joinBonus), stay: g(e.stayBonus), days: e.stayDays }), { callback_data: acb.chType("e") })],
      ];
  return {
    text: [...channelHead(lang, d), "", at(lang, "ch.confirmKind", { kind }), "", at(lang, "ch.pickType")].join("\n"),
    reply_markup: rows(...presets, [back(lang, acb.chKinds())], [cancel(lang)]),
  };
}

export function channelConfirmScreen(lang: Lang, d: ChannelDraft, type: ChannelType): Screen {
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
  return {
    text: lines.join("\n"),
    reply_markup: rows(
      [inlineButton("save", at(lang, "ch.confirm"), { callback_data: acb.chCreate(type) }, "success")],
      [back(lang, acb.chTypes())],
      [cancel(lang)],
    ),
  };
}

/* ───────────────────────── To‘lov bonusi (C-Q4) ───────────────────────── */

/** The quick choices; any other 0–50 value goes through «Boshqa». */
export const PAY_BONUS_PRESETS = [0, 5, 10, 15, 20] as const;

/** The payment bonus card: the current percent, the rule, and (settings.edit) the choices. */
export function payBonusScreen(a: BotAdmin, percent: number): Screen {
  const l = a.lang;
  const edit = can(a, "settings.edit");
  const lines = [head("card", at(l, "pb.title")), "", percent > 0 ? at(l, "pb.now", { p: percent }) : at(l, "pb.off"), at(l, "pb.rule")];
  lines.push("", edit ? at(l, "pb.pick") : at(l, "pb.viewOnly"));
  const choices: InlineButton[] = edit
    ? PAY_BONUS_PRESETS.map((p) =>
        inlineButton(p === percent ? "save" : null, `${p}%`, { callback_data: acb.pbPick(p) }, p === percent ? "success" : undefined),
      )
    : [];
  return {
    text: lines.join("\n"),
    reply_markup: rows(
      choices,
      [edit && inlineButton("edit", at(l, "pb.other"), { callback_data: acb.pbOther() })],
      [back(l)],
    ),
  };
}

export function payBonusAskScreen(lang: Lang, problem?: string): Screen {
  return {
    text: `${problem ? `${tgEmoji("warn")} ${problem}\n\n` : ""}${head("card", at(lang, "pb.title"))}\n\n${at(lang, "pb.ask")}`,
    reply_markup: rows([back(lang, acb.payBonus())]),
  };
}

export function payBonusConfirmScreen(lang: Lang, from: number, to: number): Screen {
  return {
    text: `${head("card", at(lang, "pb.title"))}\n\n${at(lang, "pb.confirmAsk", { from, to })}`,
    reply_markup: rows(
      [inlineButton("save", at(lang, "pb.confirm", { to }), { callback_data: acb.pbSet(to) }, "success")],
      [back(lang, acb.payBonus())],
    ),
  };
}

/* ───────────────────────── Step-up ───────────────────────── */

export function stepUpScreen(lang: Lang, problem?: string): Screen {
  return {
    text: `${problem ? `${tgEmoji("warn")} ${esc(problem)}\n\n` : ""}${head("lock", at(lang, "su.title"))}\n\n${at(lang, "su.ask")}`,
    reply_markup: rows([cancel(lang)]),
  };
}
