# Todo sprint 2026-10-07 — plan and owner decisions

`main` auto-deploys (docs/ops/DEPLOY.md): every package lands on its own branch, passes an independent review and CI, then is merged by the lead.

| # | Request (owner) | Package |
|---|---|---|
| 1 | Slide viewing (phone, enlarged): tapping the right side goes next, but the left side / swiping back does not go to the previous slide | T1 |
| 2 | Long lists/sections: a «back to top» button appears after scrolling down; one tap scrolls to the top | T2 |
| 3 | Referral points: 2000 per invited person; full who-invited-whom record; one shared user base for bot and site; a user who deletes the bot and returns via a referral link must not be rewarded again | T3 |
| 4 | «Saqlash» (to the bot) and «Ulashish» must offer a per-material file format choice like «Yuklab olish» | T4 |

## Owner decisions
| # | Decision |
|---|---|
| D1 | Referral reward: **2000 points to the inviter immediately when the invited person registers** via the link (a brand-new account only; once per invited Telegram account) |
| D2 | The invited person gets **no extra bonus** beyond the normal 3000 signup bonus |
| D3 | **No cap** on invitations; an admin signal when a referrer gets an unusual number in a day (burst) |
| D4 | Release each package as soon as it is reviewed and CI is green; **T3 (points) needs the owner's explicit approval before merge** |

## Design notes
- **T3 single base:** the bot already registers every private-chat user on their first message (`registerBotUser`, prod since 2026-10-05) and the site registers on login → one `users` table keyed by `telegram_id`. Referral rewards are tied to the moment an account is CREATED (INSERT, not conflict-update), so deleting/re-adding the bot or re-opening a link can never reward twice: an existing user is never a "new" referee. Additive migration `037_referrals.sql`: `users.ref_code` (unique, random, not the telegram id) + `referrals(referee_user_id UNIQUE, referrer_user_id, source 'bot'|'web', created_at, rewarded points, ledger ref)`; the reward is a `topUpInTx` with a unique ledger reference (`referral:<referee_id>`) in the same transaction as the insert (idempotent, ledger invariant kept). Self-referral and unknown/blocked referrers are ignored (recorded as no-reward). Links: bot `https://t.me/<bot>?start=ref_<code>` (the `/start` payload router already refuses non-nonce payloads — extend it) and web `/uz?ref=<code>` (stored in a short cookie until the first Telegram login). Profile section «Do'stlarni taklif qilish»: link, copy/share, count and points earned, recent invitees (names only). Burst signal: >25 referrals by one referrer in 24 h → one `error_log` row per referrer per day (shows in the admin errors page and the watchdog's new-error-type alert); admin user detail shows referrer / invited count.
- **T4:** reuse `DownloadSheet` (`mode: "save" | "share"`) and the format registry; one-format tools skip the sheet; the chosen format goes to the existing routes (`format` already supported, 202 preparing handled).
- **T1:** find the enlarged/fullscreen slide mode in `SlideViewer.tsx`/`SlideStage.tsx`/`useSlideKeys.ts`: left tap zone and swipe-right must go to the previous slide, swipe-left to the next; no conflicts with edit/zoom gestures; Telegram vertical-swipe is already disabled.
- **T2:** one shared `ScrollToTop` in the app shell's scroll container (AppShell), shown after ~600 px (or 1.5 screens), 44 px, bottom-right above safe areas/sticky bars/Telegram safe-area vars, smooth scroll respecting `prefers-reduced-motion`, hidden when a dialog/sheet is open, keyboard-accessible, not on desktop pages where the window scrolls less than the threshold.

## Packages (file ownership)
| WP | Files | Model |
|---|---|---|
| T1 slide navigation | `components/viewers/SlideViewer.tsx`, `SlideStage.tsx`, `useSlideKeys.ts`, new helper files in `components/viewers/slide-nav/`, tests | sonnet |
| T2 scroll-to-top | new `components/shell/ScrollToTop.tsx`, `components/shell/AppShell.tsx` (mount only), tests | sonnet |
| T3 referral | `lib/server/migrations/037_referrals.sql`, new `lib/server/referrals.ts`, `lib/server/auth.ts` (registration hook), `lib/server/telegram.ts` (`/start ref_…`), `app/api/referral/*`, `app/api/auth/telegram/*` (referral cookie hand-off only), profile UI (`components/profile/*`, profile page), admin user-detail read-only fields (find the minimal admin files; admin rules in docs/admin/AGENT-BRIEF.md), tests | opus |
| T4 save/share formats | `components/files/{ResultActions,DownloadSheet,ShareButton,SaveToBotButton}.tsx`, `lib/downloads/deliver.ts` (only if needed), tests | opus |
| Reviews | T3: security+money (fable); T1/T2/T4: correctness/UX (opus) | |
