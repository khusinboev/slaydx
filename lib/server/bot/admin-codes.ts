/**
 * Callback codes of the in-bot admin panel (docs/bot-admin/PLAN.md). All start
 * with `a:` and stay far below Telegram's 64-byte limit (the longest,
 * `a:bk:<id>` with an 18-digit id, is 23 bytes). They carry no permission and
 * no identity: the admin account and its role are re-read on every tap
 * (`admin-access.ts adminCtx`). Ids in codes are only targets — every service
 * re-reads the row itself.
 *
 *   a:h               panel          a:z            close          a:x   cancel the pending input
 *   a:s               Statistika (and its «Yangilash»)
 *   a:b               broadcast: ask for the message
 *   a:bb / a:bd       add / remove the link button
 *   a:ba              audience choice       a:bv  back to the draft card
 *   a:bu:<all|act|new>  audience picked → preview
 *   a:bt              test send to me
 *   a:bs:<n>          send to n recipients (n = the count the admin saw; checked by `sendBroadcast`)
 *   a:bp:<id>         broadcast progress
 *   a:bc:<id>         ask to stop       a:bk:<id>  stop (confirmed)
 *   a:c               channel list      a:cn       connect: ask for the channel
 *   a:ck:<m|o>        mandatory / optional picked → bonus presets   a:cg  back to that choice
 *   a:cy:<n|e|m|z>    preset picked → confirm   a:cf  back to the preset choice
 *                     (optional: n news, e extra; mandatory: m with a bonus, z without — C-Q2)
 *   a:cc:<n|e|m|z>    connect (confirmed)       a:ct:<id>  toggle active
 */

export const AUDIENCE_CODES = ["all", "act", "new"] as const;
export type AudienceCode = (typeof AUDIENCE_CODES)[number];
export const CHANNEL_TYPES = ["n", "e", "m", "z"] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];
/** Presets offered for an optional / a mandatory channel (docs/bonus/BONUS3.md C-Q2). */
export const OPTIONAL_TYPES = ["n", "e"] as const satisfies readonly ChannelType[];
export const MANDATORY_TYPES = ["m", "z"] as const satisfies readonly ChannelType[];
export const CHANNEL_KINDS = ["m", "o"] as const;
export type ChannelKind = (typeof CHANNEL_KINDS)[number];
/** Whether `type` is a preset of the mandatory (`true`) or the optional (`false`) kind. */
export function typeFits(type: ChannelType, mandatory: boolean): boolean {
  return ((mandatory ? MANDATORY_TYPES : OPTIONAL_TYPES) as readonly ChannelType[]).includes(type);
}

export const acb = {
  panel: () => "a:h",
  close: () => "a:z",
  cancel: () => "a:x",
  stats: () => "a:s",
  bcStart: () => "a:b",
  bcButton: () => "a:bb",
  bcButtonDrop: () => "a:bd",
  bcAudience: () => "a:ba",
  bcDraft: () => "a:bv",
  bcPick: (a: AudienceCode) => `a:bu:${a}`,
  bcTest: () => "a:bt",
  bcSend: (n: number) => `a:bs:${n}`,
  bcProgress: (id: string) => `a:bp:${id}`,
  bcStopAsk: (id: string) => `a:bc:${id}`,
  bcStop: (id: string) => `a:bk:${id}`,
  channels: () => "a:c",
  chConnect: () => "a:cn",
  chKind: (k: ChannelKind) => `a:ck:${k}`,
  chKinds: () => "a:cg",
  chType: (t: ChannelType) => `a:cy:${t}`,
  chTypes: () => "a:cf",
  chCreate: (t: ChannelType) => `a:cc:${t}`,
  chToggle: (id: string) => `a:ct:${id}`,
};

export type AdminCallback =
  | { kind: "panel" }
  | { kind: "close" }
  | { kind: "cancel" }
  | { kind: "stats" }
  | { kind: "bcStart" }
  | { kind: "bcButton" }
  | { kind: "bcButtonDrop" }
  | { kind: "bcAudience" }
  | { kind: "bcDraft" }
  | { kind: "bcPick"; audience: AudienceCode }
  | { kind: "bcTest" }
  | { kind: "bcSend"; count: number }
  | { kind: "bcProgress"; id: string }
  | { kind: "bcStopAsk"; id: string }
  | { kind: "bcStop"; id: string }
  | { kind: "channels" }
  | { kind: "chConnect" }
  | { kind: "chKind"; mandatory: boolean }
  | { kind: "chKinds" }
  | { kind: "chType"; type: ChannelType }
  | { kind: "chTypes" }
  | { kind: "chCreate"; type: ChannelType }
  | { kind: "chToggle"; id: string }
  | { kind: "unknown" };

const ID = /^[1-9]\d{0,17}$/;
const COUNT = /^(0|[1-9]\d{0,8})$/;

export function isAdminCallback(data: string | undefined | null): boolean {
  return typeof data === "string" && data.startsWith("a:");
}

export function parseAdminCallback(data: string | undefined | null): AdminCallback {
  const parts = String(data ?? "").split(":");
  if (parts[0] !== "a") return { kind: "unknown" };
  const [, b, c] = parts;
  if (parts.length === 2) {
    switch (b) {
      case "h":
        return { kind: "panel" };
      case "z":
        return { kind: "close" };
      case "x":
        return { kind: "cancel" };
      case "s":
        return { kind: "stats" };
      case "b":
        return { kind: "bcStart" };
      case "bb":
        return { kind: "bcButton" };
      case "bd":
        return { kind: "bcButtonDrop" };
      case "ba":
        return { kind: "bcAudience" };
      case "bv":
        return { kind: "bcDraft" };
      case "bt":
        return { kind: "bcTest" };
      case "c":
        return { kind: "channels" };
      case "cn":
        return { kind: "chConnect" };
      case "cf":
        return { kind: "chTypes" };
      case "cg":
        return { kind: "chKinds" };
    }
    return { kind: "unknown" };
  }
  if (parts.length !== 3 || c === undefined) return { kind: "unknown" };
  switch (b) {
    case "bu":
      return (AUDIENCE_CODES as readonly string[]).includes(c) ? { kind: "bcPick", audience: c as AudienceCode } : { kind: "unknown" };
    case "bs":
      return COUNT.test(c) ? { kind: "bcSend", count: Number(c) } : { kind: "unknown" };
    case "bp":
      return ID.test(c) ? { kind: "bcProgress", id: c } : { kind: "unknown" };
    case "bc":
      return ID.test(c) ? { kind: "bcStopAsk", id: c } : { kind: "unknown" };
    case "bk":
      return ID.test(c) ? { kind: "bcStop", id: c } : { kind: "unknown" };
    case "ck":
      return (CHANNEL_KINDS as readonly string[]).includes(c) ? { kind: "chKind", mandatory: c === "m" } : { kind: "unknown" };
    case "cy":
      return (CHANNEL_TYPES as readonly string[]).includes(c) ? { kind: "chType", type: c as ChannelType } : { kind: "unknown" };
    case "cc":
      return (CHANNEL_TYPES as readonly string[]).includes(c) ? { kind: "chCreate", type: c as ChannelType } : { kind: "unknown" };
    case "ct":
      return ID.test(c) ? { kind: "chToggle", id: c } : { kind: "unknown" };
  }
  return { kind: "unknown" };
}
