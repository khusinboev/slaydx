/**
 * Referral program — shared, pure rules (server AND client; no `server-only`).
 *
 * Owner decisions (docs/todo-2026-10-07/PLAN.md D1–D3): the inviter earns
 * `REFERRAL_REWARD_POINTS` bonus points the moment the invited person's
 * account is CREATED through the link (a brand-new account only, once per
 * Telegram account); the invited person gets nothing extra; no cap.
 *
 * A referral code is random (never the Telegram id) and lower-case from an
 * alphabet without look-alikes (0/o, 1/l/i), so it survives being read out
 * or retyped. It travels in three shapes:
 *   - bot deep link   `https://t.me/<bot>?start=ref_<code>`  (`/start ref_<code>`)
 *   - Mini App link   `startapp=ref_<code>`                  (initData `start_param`)
 *   - web link        `<app>/uz?ref=<code>`                  (short cookie until the first login)
 */

/** Points credited to the inviter per brand-new invited account (D1). */
export const REFERRAL_REWARD_POINTS = 2000;

/** Unambiguous lower-case alphabet: no 0, 1, i, l, o. 31 symbols. */
export const REF_CODE_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";

/** Length of a newly generated code (31^8 ≈ 8.5e11 codes). */
export const REF_CODE_LENGTH = 8;

/** Accepted lengths: 8 today; up to 10 leaves room to lengthen codes later without breaking old links. */
const REF_CODE_RE = new RegExp(`^[${REF_CODE_ALPHABET}]{${REF_CODE_LENGTH},10}$`);

/** `/start` and `startapp` payload prefix of a referral link. */
export const REF_START_PREFIX = "ref_";

/** The web link query parameter. */
export const REF_QUERY_PARAM = "ref";

/** Pure: the normalised code, or `null` when the value is not code-shaped. */
export function normalizeRefCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toLowerCase();
  return REF_CODE_RE.test(code) ? code : null;
}

/** Pure: `ref_<code>` → `<code>`; anything else (a login nonce, `inline`, `s_…`) → `null`. */
export function refCodeFromStartPayload(payload: unknown): string | null {
  if (typeof payload !== "string") return null;
  const p = payload.trim();
  if (!p.toLowerCase().startsWith(REF_START_PREFIX)) return null;
  return normalizeRefCode(p.slice(REF_START_PREFIX.length));
}

/** `https://t.me/<bot>?start=ref_<code>`, or `null` without a bot username. */
export function referralBotLink(botUsername: string | null | undefined, code: string): string | null {
  const bot = (botUsername ?? "").trim().replace(/^@/, "");
  if (!/^[A-Za-z0-9_]{3,64}$/.test(bot)) return null;
  return `https://t.me/${bot}?start=${REF_START_PREFIX}${code}`;
}

/** `<app>/uz?ref=<code>`. */
export function referralWebLink(appUrl: string, code: string): string {
  return `${appUrl.replace(/\/+$/, "")}/uz?${REF_QUERY_PARAM}=${encodeURIComponent(code)}`;
}

/**
 * Points as the UI writes them: «2 000» (NBSP between groups, never wraps).
 * By hand, not `toLocaleString("uz-UZ")`: ICU data differs between Node and
 * browsers — Chromium writes «2,000» (found by the T3 smoke; `lib/admin-format.ts`
 * avoids it for the same reason).
 */
export function formatPoints(n: number): string {
  const v = Math.round(Number.isFinite(n) ? n : 0);
  const body = String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return v < 0 ? `-${body}` : body;
}

/** A join date as `dd.mm.yyyy` in Tashkent (UTC+5, no DST) — by hand for the same reason. */
export function formatJoinDate(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const d = new Date(t + 5 * 3_600_000);
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
}

/** The program rule shown on the profile and in the bot. */
export function referralRuleText(points = REFERRAL_REWARD_POINTS): string {
  return `Har bir yangi do'st uchun ${formatPoints(points)} ball. Do'stingiz ilovaga birinchi marta kirganda hisoblanadi.`;
}

/** Text that accompanies a shared link (Telegram share sheet / Web Share). */
export const REFERRAL_SHARE_TEXT =
  "SlaydX — AI yordamida slayd, referat, kurs ishi va boshqa hujjatlarni bir necha daqiqada tayyorlaydi. Havola orqali kiring:";

/** `https://t.me/share/url?url=…&text=…` — Telegram's own «send to a chat» sheet. */
export function telegramShareUrl(link: string, text = REFERRAL_SHARE_TEXT): string {
  return `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;
}
