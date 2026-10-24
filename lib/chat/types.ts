/**
 * AI chat -- shared, client-safe constants and wire types (no `server-only`).
 *
 * The server owns every rule (`lib/server/chat/*`); the web page and the bot only render what these types
 * describe. A proposal card is DATA: the model never produces a button, and a card's token is issued by the
 * server for one user, one set of values and ten minutes.
 */

/** Messages of context sent to the model: the last 10 turns (a turn = one user message and its reply). */
export const CHAT_HISTORY_TURNS = 10;
/** Longest accepted user message (characters). */
export const CHAT_MESSAGE_MAX = 2000;
/** A proposal token is valid for this long. */
export const PROPOSAL_TTL_MS = 10 * 60 * 1000;
/** Bot chat mode ends after this much idle time (or /stop). */
export const BOT_CHAT_IDLE_MS = 15 * 60 * 1000;
/** Messages older than this are purged by the housekeeping step. */
export const CHAT_RETENTION_DAYS = 30;

export type ChatCardParam = { label: string; value: string };

/**
 * A proposal shown to the user.
 *   - `confirm`: the values are valid; `price` is the server price, `token` + `hash` go back with the tap;
 *   - `adjust`: something is missing or invalid; `issues` says what -- there is nothing to confirm.
 */
export type ChatCard =
  | {
      kind: "confirm";
      proposalId: string;
      tool: string;
      toolTitle: string;
      params: ChatCardParam[];
      price: number;
      token: string;
      hash: string;
      expiresAt: string;
      /** Set once the proposal was confirmed or cancelled (a history reload shows it as done). */
      state?: "open" | "used" | "expired";
    }
  | { kind: "adjust"; tool: string; toolTitle: string; params: ChatCardParam[]; issues: string[] };

export type ChatConfirmCard = Extract<ChatCard, { kind: "confirm" }>;

export type ChatMessageView = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  card?: ChatCard | null;
};

export type ChatStatus = {
  enabled: boolean;
  freeLimit: number;
  freeUsed: number;
  freeLeft: number;
  pricePerMessage: number;
  /** Wallet total (bonus + balance) in so'm. */
  balance: number;
};

export type ChatReply = {
  reply: ChatMessageView;
  /** Charged for this message (0 = free). */
  charged: number;
  status: ChatStatus;
  replayed?: boolean;
};

/** `Bugun tekin: N/10` -- the one line every surface shows. */
export function freeLine(status: Pick<ChatStatus, "freeLeft" | "freeLimit">): string {
  return `Bugun tekin: ${status.freeLeft}/${status.freeLimit}`;
}
