import { env } from "../env";
import { formatJoinDate, formatPoints, telegramShareUrl } from "../../referral";
import { TOOL_BY_ID } from "../../tools";
import { BOT_LANGUAGES } from "../../profile/fields";
import { FILES_PAGE_SIZE, cb, type Origin } from "./codes";
import { LANG_NAMES, LANGS, t, toolTitle, type Lang } from "./i18n";
import { creditTotal, type ProfileUser } from "./profile";
import { appUrl, clip, esc, inlineButton, isPublicHttps, rows, tgEmoji, type IconKey, type InlineButton, type Screen } from "./ui";

/**
 * The other chat screens (docs/bot/PLAN.md + owner scope 2026-10-08): /start
 * welcome, /login, Ishlarim, Hamyon, referral, Yordam, Til. Pure renderers.
 */

/* ───────────────────────── /start, /login ───────────────────────── */

export type WelcomeInput = {
  /** `null` outside a private chat (nobody is registered there). */
  user: Pick<ProfileUser, "name" | "points" | "quota" | "balance"> | null;
  /** The one-time site login link (`createBotLoginLink`). */
  loginLink: string;
  rewardPoints: number;
};

/**
 * Welcome card (mockup screen 1). The persistent keyboard goes in a SECOND
 * message (`keyboard.ts keyboardMessage`): one message holds one reply_markup,
 * and this one carries the inline buttons — Mini App (initData → silent
 * login), all tools, invite, and the historical one-time site link.
 * Without a public URL (local dev) there are no buttons and the link is
 * written into the text.
 */
export function welcomeScreen(lang: Lang, w: WelcomeInput): Screen {
  const name = w.user?.name?.trim();
  const lines = [
    `${tgEmoji("wave")} <b>${name ? t(lang, "welcome.hello", { name: esc(name) }) : t(lang, "welcome.helloAnon")}</b>`,
    `${tgEmoji("sparkles")} ${t(lang, "welcome.pitch")}`,
  ];
  if (w.user) {
    lines.push(
      `<blockquote>${tgEmoji("wallet")} ${t(lang, "welcome.balance", { n: t(lang, "unit.tanga", { n: formatPoints(creditTotal(w.user)) }) })}\n` +
        `${tgEmoji("gift")} ${t(lang, "welcome.invite", { n: t(lang, "unit.ball", { n: formatPoints(w.rewardPoints) }) })}</blockquote>`,
    );
  }
  lines.push("", `${tgEmoji("app")} ${t(lang, "welcome.app")}`, `${tgEmoji("web")} ${t(lang, "welcome.site")}`);

  const app = appUrl("/uz");
  const tools = appUrl("/uz/create");
  if (!app || !isPublicHttps(w.loginLink)) return { text: `${lines.join("\n")}\n\n${w.loginLink}` };
  return {
    text: lines.join("\n"),
    reply_markup: rows(
      [inlineButton("app", t(lang, "btn.openApp"), { web_app: { url: app } }, "primary")],
      [
        tools ? inlineButton("tools", t(lang, "btn.allTools"), { web_app: { url: tools } }) : null,
        w.user ? inlineButton("gift", t(lang, "btn.invite"), { callback_data: cb.invite() }) : null,
      ],
      [inlineButton("web", t(lang, "btn.site"), { url: w.loginLink })],
    ),
  };
}

/** `/login`: the two historical buttons (Mini App, one-time site link). */
export function loginScreen(lang: Lang, link: string): Screen {
  const app = appUrl("/uz");
  const text = t(lang, "login.text");
  if (!app || !isPublicHttps(link)) return { text: `${text}\n\n${link}` };
  return {
    text,
    reply_markup: rows(
      [inlineButton("app", t(lang, "login.app"), { web_app: { url: app } })],
      [inlineButton("web", t(lang, "login.site"), { url: link })],
    ),
  };
}

/* ───────────────────────── Ishlarim ───────────────────────── */

export type FileItem = { id: string; type: string; topic: string; status: string; progress: number; createdAt: string };

export function fileStatus(lang: Lang, f: Pick<FileItem, "status" | "progress">): { icon: IconKey; label: string } {
  switch (f.status) {
    case "COMPLETED":
      return { icon: "save", label: t(lang, "status.done") };
    case "IN_PROGRESS":
      return { icon: "clock", label: t(lang, "status.running", { p: Math.max(0, Math.min(99, Math.round(Number(f.progress) || 0))) }) };
    case "QUEUED":
      return { icon: "hourglass", label: t(lang, "status.queued") };
    case "FAILED":
      return { icon: "error", label: t(lang, "status.failed") };
    default:
      return { icon: "stop", label: t(lang, "status.cancelled") };
  }
}

function fileToolTitle(lang: Lang, type: string): string {
  const tool = (TOOL_BY_ID as Record<string, { title: string } | undefined>)[type];
  return toolTitle(lang, type, tool?.title ?? type);
}

/** A file's page: the personal link (reply-keyboard style) or, without one, the plain public URL. */
function fileButton(telegramId: number | string, n: number, f: FileItem, lang: Lang): InlineButton | null {
  const path = `/uz/files/${f.id}`;
  const label = `${n}. ${clip(f.topic || fileToolTitle(lang, f.type), 30)}`;
  // An INLINE web_app button carries initData (normal Mini App login), so no personal `?bt=` link
  // is put into chat history (security review MINOR-2).
  void telegramId;
  const plain = appUrl(path);
  return plain ? inlineButton(null, label, { web_app: { url: plain } }) : null;
}

export function filesScreen(
  lang: Lang,
  telegramId: number | string,
  page: number,
  items: FileItem[],
  hasNext: boolean,
): Screen {
  const create = appUrl("/uz/create");
  const newWork = create ? inlineButton("plus", t(lang, "btn.newWork"), { web_app: { url: create } }, "primary") : null;
  const title = `${tgEmoji("files")} <b>${t(lang, "files.title")}</b>`;
  if (!items.length && page === 0) {
    return { text: `${title}\n\n${t(lang, "files.empty")}`, reply_markup: rows([newWork]) };
  }
  const first = page * FILES_PAGE_SIZE + 1;
  const lines = items.map((f, i) => {
    const st = fileStatus(lang, f);
    const topic = clip(f.topic || "", 60);
    return [
      `${first + i}. ${tgEmoji(st.icon)} <b>${esc(fileToolTitle(lang, f.type))}</b> · ${st.label}`,
      `${topic ? `«${esc(topic)}» · ` : ""}${formatJoinDate(f.createdAt)}`,
    ].join("\n");
  });
  const range = items.length ? t(lang, "files.range", { a: first, b: first + items.length - 1 }) : "";
  const text = [`${title}${range ? ` · ${range}` : ""}`, "", lines.join("\n\n"), "", `<i>${t(lang, "files.hint")}</i>`].join("\n");
  const fileRows = items.map((f, i) => [fileButton(telegramId, first + i, f, lang)]);
  return {
    text,
    reply_markup: rows(
      ...fileRows,
      [
        page > 0 ? inlineButton("prev", t(lang, "btn.prev"), { callback_data: cb.files(page - 1) }) : null,
        hasNext ? inlineButton("next", t(lang, "btn.next"), { callback_data: cb.files(page + 1) }) : null,
      ],
      [newWork],
    ),
  };
}

/* ───────────────────────── Hamyon ───────────────────────── */

export type LedgerItem = { kind: string; amount: number; note: string; createdAt: string };

const PROVIDERS: Record<string, string> = { click: "Click", payme: "Payme" };

/** One ledger line's title — the same reading as the web wallet (`components/wallet/wallet-model.ts describeEntry`). */
export function ledgerTitle(lang: Lang, e: Pick<LedgerItem, "kind" | "note">): string {
  const note = (e.note ?? "").trim();
  switch (e.kind) {
    case "charge": {
      const m = /^([a-z0-9-]+):\s*([\s\S]*)$/.exec(note);
      const tool = m ? (TOOL_BY_ID as Record<string, { title: string } | undefined>)[m[1]!] : undefined;
      if (m && tool) {
        const title = toolTitle(lang, m[1]!, tool.title);
        const topic = m[2]!.trim();
        return topic ? `${title}: ${topic}` : title;
      }
      return lang === "uz" && note ? note : t(lang, "ledger.charge");
    }
    case "refund":
      return t(lang, "ledger.refund");
    case "topup": {
      const provider = PROVIDERS[/^(\w+) orqali/i.exec(note)?.[1]?.toLowerCase() ?? ""];
      return provider ? t(lang, "ledger.topupVia", { p: provider }) : t(lang, "ledger.topup");
    }
    case "bonus": {
      const friend = /^Do'st taklifi:\s*(.+)$/.exec(note)?.[1];
      if (friend) return t(lang, "ledger.bonusFriend", { f: friend });
      if (/ro'yxatdan o'tish/i.test(note)) return t(lang, "ledger.signup");
      // Channel bonus notes (`bonus-channels.ts JOIN_NOTE_PREFIX` / `STAY_NOTE_PREFIX`).
      const join = /^Kanal obunasi:\s*(.+)$/.exec(note)?.[1];
      if (join) return t(lang, "ledger.channelJoin", { c: join });
      const stay = /^Kanalda qolish bonusi:\s*(.+)$/.exec(note)?.[1];
      if (stay) return t(lang, "ledger.channelStay", { c: stay });
      return lang === "uz" && note ? note : t(lang, "ledger.bonus");
    }
    case "subscription":
      return t(lang, "ledger.subscription");
    case "admin_credit":
    case "admin_debit":
      return t(lang, "ledger.admin");
    case "quota_merge":
      return t(lang, "ledger.merge");
    default:
      return lang === "uz" && note ? note : t(lang, "ledger.other");
  }
}

export function ledgerLine(lang: Lang, e: LedgerItem): string {
  const n = Math.round(Number.isFinite(e.amount) ? e.amount : 0);
  const body = formatPoints(Math.abs(n));
  const amount = n > 0 ? `+${body}` : n < 0 ? `−${body}` : body;
  const unit = e.kind === "bonus" ? "unit.ball" : "unit.tanga";
  return `<b>${t(lang, unit, { n: amount })}</b> — ${esc(clip(ledgerTitle(lang, e), 60))} · ${formatJoinDate(e.createdAt)}`;
}

export function walletScreen(lang: Lang, user: Pick<ProfileUser, "points" | "quota" | "balance">, recent: LedgerItem[]): Screen {
  const quote = [`${tgEmoji("wallet")} ${t(lang, "wallet.balance", { n: t(lang, "unit.tanga", { n: formatPoints(creditTotal(user)) }) })}`];
  if (user.points > 0) quote.push(`${tgEmoji("star")} ${t(lang, "wallet.bonus", { n: t(lang, "unit.ball", { n: formatPoints(user.points) }) })}`);
  const text = [
    `${tgEmoji("wallet")} <b>${t(lang, "wallet.title")}</b>`,
    "",
    `<blockquote>${quote.join("\n")}</blockquote>`,
    "",
    `${tgEmoji("receipt")} <b>${t(lang, "wallet.recent")}</b>`,
    recent.length ? recent.map((e) => ledgerLine(lang, e)).join("\n") : t(lang, "wallet.none"),
    "",
    `${tgEmoji("card")} <i>${t(lang, "wallet.payNote")}</i>`,
  ].join("\n");
  const wallet = appUrl("/uz/wallet");
  return {
    text,
    // «🎁 Bonus olish» first, full width, green (docs/bonus/PLAN.md flows).
    reply_markup: rows(
      [inlineButton("gift", t(lang, "btn.bonus"), { callback_data: cb.bonus() }, "success")],
      [
        wallet ? inlineButton("card", t(lang, "btn.topup"), { web_app: { url: wallet } }, "primary") : null,
        inlineButton("group", t(lang, "btn.inviteFriend"), { callback_data: cb.walletInvite() }),
      ],
    ),
  };
}

/* ───────────────────────── Referral ───────────────────────── */

export type ReferralInput = { link: string; rewardPoints: number; invitedCount: number; earnedPoints: number };

/** `/taklif`, the welcome «Taklif» and Hamyon → «Do‘st taklif qilish» (with a way back). */
export function referralScreen(lang: Lang, r: ReferralInput, back: "wallet" | null): Screen {
  const text = [
    `${tgEmoji("gift")} <b>${t(lang, "ref.title")}</b>`,
    "",
    esc(t(lang, "ref.rule", { n: formatPoints(r.rewardPoints) })),
    "",
    t(lang, "ref.link"),
    esc(r.link),
    "",
    t(lang, "ref.counts", { a: formatPoints(r.invitedCount), b: formatPoints(r.earnedPoints) }),
  ].join("\n");
  // t.me links are public https (always valid button URLs); a local web link is not.
  const share = isPublicHttps(r.link) ? inlineButton("share", t(lang, "btn.shareFriends"), { url: telegramShareUrl(r.link) }, "primary") : null;
  return {
    text,
    reply_markup: rows(
      [share],
      [inlineButton("link", t(lang, "btn.copyLink"), { copy_text: { text: r.link.slice(0, 256) } })],
      [back === "wallet" ? inlineButton("back", t(lang, "btn.backWallet"), { callback_data: cb.wallet() }) : null],
    ),
  };
}

/* ───────────────────────── Yordam ───────────────────────── */

export function helpScreen(lang: Lang): Screen {
  const faq = ([1, 2, 3, 4, 5] as const)
    .map((i) => `<b>${t(lang, `help.q${i}`)}</b>\n${t(lang, `help.a${i}`)}`)
    .join("\n\n");
  const text = [
    `${tgEmoji("help")} <b>${t(lang, "help.title")}</b>`,
    "",
    t(lang, "help.about"),
    "",
    `${tgEmoji("pin")} ${t(lang, "help.how")}`,
    "",
    `<blockquote expandable>${tgEmoji("info")} <b>${t(lang, "help.faq")}</b>\n\n${faq}</blockquote>`,
  ].join("\n");
  const support = env.botSupportUsername;
  const supportUrl = /^[A-Za-z0-9_]{4,32}$/.test(support) ? `https://t.me/${support}` : null;
  const app = appUrl("/uz");
  return {
    text,
    reply_markup: rows(
      [
        inlineButton("lang", t(lang, "btn.lang"), { callback_data: cb.langMenu("y") }),
        supportUrl ? inlineButton("support", t(lang, "btn.support"), { url: supportUrl }) : null,
      ],
      [app ? inlineButton("app", t(lang, "btn.openApp"), { web_app: { url: app } }, "primary") : null],
    ),
  };
}

/* ───────────────────────── Til ───────────────────────── */

const FLAGS = { uz: "flagUz", ru: "flagRu", en: "flagEn" } as const satisfies Record<Lang, IconKey>;

export function languageScreen(lang: Lang, origin: Origin): Screen {
  const others = LANGS.filter((l) => l !== lang).map((l) => t(l, "lang.title"));
  const text = [`${tgEmoji("lang")} <b>${t(lang, "lang.title")}</b>`, `<i>${others.join(" · ")}</i>`].join("\n");
  const back = origin === "p" ? cb.profile() : origin === "y" ? cb.help() : null;
  return {
    text,
    reply_markup: rows(
      BOT_LANGUAGES.map((l) =>
        inlineButton(FLAGS[l], LANG_NAMES[l], { callback_data: cb.langSet(l, origin) }, l === lang ? "success" : undefined),
      ),
      [back ? inlineButton("back", t(lang, "btn.back"), { callback_data: back }) : null],
    ),
  };
}

/** After `/til` (no screen to return to): a plain confirmation. */
export function languageSavedScreen(lang: Lang): Screen {
  return { text: `${tgEmoji("save")} ${t(lang, "lang.saved")}`, reply_markup: rows() };
}
