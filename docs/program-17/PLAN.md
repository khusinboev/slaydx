# Program 17 (2026-10-22) — plan and owner decisions

The owner sent 17 requests. Each item ships as **its own branch + PR** (`main` auto-deploys), reviewed and merged by the lead.
Order: Phase 0 → A → B → C → D. Builders: ≤ 2 sonnet agents in parallel on disjoint files; strongest-model review only for
money / auth / crypto items (marked 🔒).

## Owner decisions
| # | Decision |
|---|---|
| D1 | All user-facing units become **«so'm»**, the bonus part **«bonus so'm»** (1 point = 1 so'm, accounting unchanged). Ledger note strings and API field names (`spentTanga`, …) stay — old rows are mapped by regex. «ball» meaning a grade/score stays. |
| D2 | Signup bonus stays 2 000 (already in code, `SIGNUP_BONUS_POINTS`). |
| D3 | Referral tiers halved, same boundaries: friends 1–25 → 1 000, 26–50 → 500, 51+ → 250. History rows keep their stored amounts. |
| D4 | Ambassador: every payment by a referred user credits the referrer **N % (default 10, admin setting) of `amount_soum`** as bonus; never reversed (payments are never refunded to users); no cash-out; self-referral / NULL referrer → nothing. |
| D5 | Bonus protection: global daily bonus budget + monthly cap for the daily quiz (admin settings); bonus so'm cannot pay for video tools. |
| D6 | Oferta (public offer) covers current AND planned features (selfie/voice processing, ambassador terms, reviews, no refunds). Lead drafts, owner approves. New users accept at /start; existing users before their next generation or payment. Ships behind `oferta.gate_enabled` (deployed off, switched on after a prod check). |
| D7 | Only Gemini is live now; OpenAI-image / Kling / ElevenLabs adapters are still built. Admin «Provayderlar» page: enter API keys (encrypted, own key, audited, step-up) and switch providers on/off; a disabled provider is hidden from forms; env keys remain the fallback. |
| D8 | bmbtestbot (on our server) is ours: analyse read-only, import questions + mechanics, paid tests in the WebApp, correct answers shown at the end. |
| D9 | New Latin alphabet: official table from the web; base on the strongest permissive-licence (MIT/Apache/BSD, not GPL) open-source converter, add what is missing; table shown to the owner before shipping. |

## Phases
| Phase | Items | Notes |
|---|---|---|
| 0 | hygiene | main synced, stale worktrees/branches removed, CLAUDE.md banner, holat.md, PROJECT-CONTEXT §7 |
| A | 1 so'm → 3 referral → 4 payment reminder ‖ 9 rating bonus → 11 ambassador 🔒 → 12 oferta 🔒 | 1 runs alone first (touches the most files); 4 and 11 share one money review |
| B | 6 alphabet ‖ 13 file conversion, 16 daily quiz | 6 and 13 start with a spike (alphabet table / soffice RAM) |
| C | provider key store 🔒 → 14 graduation portrait, 5-image, 10 handwritten work, 17 templates | new tools one at a time (shared `ToolId` boilerplate) |
| D | 7 paid tests 🔒, 8 AI chat 🔒, 15 strict-professor simulator, 5-video/voice 🔒 | video needs an async-job + charge/refund spike |

## Pre-allocated identifiers (avoid collisions between parallel branches)
| Item | Migration | Settings keys |
|---|---|---|
| 4 payment reminder | `051_payment_reminder.sql` — `payment_orders.reminded_at` (backfill `now()` for existing rows) | — |
| 9 rating bonus | `052_app_ratings.sql` | — |
| 11 ambassador | none expected | `ambassador.percent` |
| 12 oferta | `053_offer_acceptance.sql` — `users.offer_version`, `users.offer_accepted_at` | `oferta.gate_enabled`, `oferta.version` |
| D5 bonus protection | — | `bonus.daily_budget`, `daily_quiz.monthly_cap` |
Later phases take the next free number at branch time.

## Item notes (entry points found by exploration)
- **1:** add one formatter; repoint `formatTanga` (`lib/tools.ts`), `fmtTanga` (`lib/admin-format.ts`), `components/wallet/wallet-model.ts` `unit`, bot `i18n.ts` `unit.tanga` (bot already has `unit.som`). ~48 test files pin the word; `tests/bot-ui.test.mts` asserts no `\bball\b` in the bot.
- **3:** `REFERRAL_TIERS` in `lib/referral.ts`; tests `tests/referrals.test.mts`, `tests/referral-bot.test.mts`.
- **4:** leader-only `payment-reminder` step in `purgeHousekeeping` (`lib/server/worker.ts`); `provider='click'`, state created/pending, age 5–60 min, no later paid order; claim with `UPDATE … RETURNING` before `sendMessage`; skip `bot_blocked_at`; support URL button + «Qayta to'lash». Write the "worker sends one DM" helper reusable for item 16.
- **9:** `topUpInTx(…, "rating:<userId>", "bonus", …)`; ≥ 1 finished generation; feedback ≥ 30 chars / ≥ 5 words / repetition filter; ledger prefix in wallet-model and bot screens; admin list.
- **11:** `payAmbassadorInTx` next to `payPaymentBonusInTx` inside `settleOrderInTx` (Click + Paynet), ref `ambassador:<orderId>`, floor rounding.
- **12:** gate in `assertCanCreate` (`lib/server/mandatory-channels.ts`) and the payment order routes; `SessionUser` fields; bot /start (keep login-nonce payloads working) sends the PDF + «Qabul qilaman» callback; web/Mini App modal.
