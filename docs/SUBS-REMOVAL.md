# Removing subscriptions (Pro / obuna): plan

Base: `feat/admin-panel` @ `e57ffa5`, read through `git archive` because the worktree HEAD `ffddd39` is 155 commits behind. Line numbers are for e57ffa5.

**Out of scope:** the "Pro slayd" tool (`pro-slide`, `PRO_SLIDE_*`, `ProSlideForm`, «Pro · ustamasiz» CustomTemplateCard.tsx:167); upload "kvota" (`upload-quota.ts`); provider-quota text in `lib/generation/*`.

## Key facts
- Pro's only server effect is quota; nothing outside the UI reads `plan`/`premium`. The queue has **no priority** (jobs.ts:795-799 orders by `created_at`) despite «Navbatda ustuvorlik» at PurchasePage.tsx:15, and quota never expires (02-plan.md:49). No benefit needs to become universal.
- Ledger kinds: 008_admin.sql:29-30. `UNIQUE(kind, reference)`: 001_init.sql:130-131. `purpose ∈ {topup, pro}`: 001:138. `clawback_wallet ∈ {balance, quota}`: 029:109.
- Bot (telegram.ts:153-160) has no subscription text; no emails exist.

## 1–2. Inventory and changes

### A. Server money: WP1
| Where | Change |
|---|---|
| payments.ts:113-118 `PRO_PLAN`, :192, :387-391 | Delete `PRO_PLAN`. `createOrder` accepts only `topup`. Keep the `Purpose` type for history. A **legacy pro order paid after deploy** settles idempotently as kind `subscription` with `balance_delta = amount_soum` and no `plan` write, which keeps the purpose→kind mapping admin SQL relies on. |
| orders/route.ts:4,12,28 | Drop `plan` from GET. POST with `purpose:"pro"` returns 400 «Obuna to'xtatilgan». |
| credits.ts:299-340 `activatePro`/`activateProInTx` | Delete. |
| credits.ts:25-37 `splitFor` (points→quota→balance) | Keep the logic. Quota is always 0 after 034, so it is a defensive drain. Fix the comment. |
| credits.ts:187-240 `refundRatio`, refund-tx.ts:38-53 `refundInTx` | **Fold the quota share into balance** (`quota_delta=0`, `balance_delta=q+b`), or refunding a pre-conversion charge recreates quota. The per-column invariant holds. |
| credits.ts:356,378; admin-wallet.ts:25 | Keep `quota` in the `Wallet` type for history. New adjustments accept only `points\|balance`. |
| spend.ts:30,161,291 | Change the text only: «balans yoki Pro obuna» → «balans». Keep the sums at :307-309, because historical quota charges are paid money. |
| session.ts:29-31,69-70,89-90,101-103,131-132 | Remove `plan`, `planExpiresAt`, `premium`. **Keep `quota`** (always 0) for one release, or an open old tab's `creditTotal` becomes NaN. |
| retention.ts:73; cash sums in admin-metrics/pricing/users (`balance_delta+quota_delta`) | Keep: they are correct for history. |

### B. Consumer UI: WP2
- PurchasePage.tsx:10-16, :98, :143-217: replace the Bepul/Pro grid with one «Balansni to'ldirish» card. Keep the order history and polling.
- purchase/page.tsx:6-7: change the metadata.
- PayDialog.tsx:22,42,59-60,87,90: remove the `isPro` branch.
- ui.ts:19-35: remove `payPlan`.
- api-client.ts:208-210, :802, :810, :822: drop `plan`, `planExpiresAt` and `premium`; set `purpose: "topup"`.
- types.ts:186-188 and store.ts:399-400: drop `premium` and `plan`.
- ProfilePage.tsx:110-121 (PRO badge and expiry), :129 «Tariflar» → «Balansni to'ldirish», :133-135: show only the Ball and Balans stats.
- Sidebar.tsx:131-135: remove the PRO badge.
- SearchDialog.tsx:95-96: change «Tariflar / Rejani tanlang».
- Comments: TopBar.tsx:91, ToolChrome.tsx:86.
- `/uz/purchase` URL stays (sitemap.ts:11, orders/route.ts:66).

### C. Admin: WP3
- **Remove plan:** admin-users.ts:52-53,84,117-134,174-175,189-191,209-210,220,249-250,313,326-327,347-348; admin-api/users.ts:22-23,32-33,50,147; UsersPage.tsx:23,42,69,102-103,155-160; UserDetail.tsx:196,214,277.
- **Quota display:** relabel it «Kvota (eski)» and keep it read-only in the API and CSV (admin-users.ts:329,350; admin-finance.ts:710; money/shared.ts:8). Hide the UI column or tile when it is 0: UsersPage.tsx:106, UserDetail.tsx:226, FinanceSummaryView.tsx:96,102,110,126.
- **Wallet adjust:** admin-api/money.ts:13-14 and WalletAdjustDialog.tsx:109 get `points|balance` only.
- **External refund:** `clawbackWalletOf` at admin-order-refund.ts:80-83 always returns `balance`. `creditedUnits` at :98-108 reads `quota_delta+balance_delta` of the settlement row. ExternalRefundDialog.tsx:30,48 switches to balance.
- **Keep for history:** `ORDER_PURPOSES` and `SETTLE_KIND_SQL`/`CREDITED_SQL` (admin-payments.ts:40,106-108), the order ledger (:600), `resolveLedgerLinks` (:403,450), finance `byPurpose.pro` (admin-finance.ts:110,126,148,167-192), metrics `revenueSoum.pro` (admin-metrics.ts:46,238,260-261,293,346,353-354; admin-api/metrics.ts:29,51).
- **Labels:** the pro labels in labels.ts:22,29 and OrdersTable.tsx:179 become «Pro obuna (eski)». FinanceSummaryView.tsx:167-168 shows the pro row only when its order count is above 0.
- **New kind `quota_merge`:** add it to `TRANSACTION_KINDS` (admin-payments.ts:347, admin-api/payments.ts:84-85, admin-api/users.ts:102-103) and to labels.ts:24-41 (`KIND_LABEL`/`KIND_TONE`). `ledgerTotals` (admin-finance.ts:207) correctly leaves it out of cash and adjustments.
- **Seed:** in admin-seed-dev.mts, lines :265,468,510,544,549 must insert legacy pro orders and `subscription` rows by direct SQL, then call the merge. Rewrite the broadcast text at :954.

### D. Scripts and docs: WP4
- topup.mts:5,18,21-22,52: drop the `quota` wallet. Same in README.md:304 and `.claude/deploy.md:252` (untracked).
- README.md:434-437,479: rewrite the credit model.
- metrics-report.mts:196: relabel to «(eski)».
- docs/admin/02-plan.md:50,621,628,663,664,792: update.
- Keep the three-wallet sums in seed-demo.mts:365, seed-images.mts:40, smoke.mjs:82-89.

## 3. Historical data (never rewritten)
- These stay as they are: `payment_orders.purpose='pro'`, `kind='subscription'` rows, the `quota_delta` columns, `users.plan`/`plan_expires_at` (no longer read), `payment_refunds.clawback_wallet='quota'` and the `payment_ledger` view (025:46-63).
- Must keep resolving: `paid_without_ledger` (admin-finance.ts:420 via `CREDITED_SQL`), order detail, ledger links, and `walletLedgerMismatch` (admin-finance.ts:526-537), which compares **all three columns**, so the conversion must go through the ledger.

## 4. Quota → balance conversion: migration `034_quota_merge.sql`
Why not a CLI: the kind CHECK needs a migration anyway; `migrate()` (db.ts) runs each file once, in one transaction under an advisory lock, recorded in `schema_migrations`; identical in CI/dev; no manual deploy step. Precedent: 031 writes audit rows with `admin_id NULL`.

```sql
SET LOCAL lock_timeout = '5s';
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_kind_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_kind_check CHECK (kind IN
 ('charge','refund','topup','bonus','subscription','admin_credit','admin_debit','quota_merge')) NOT VALID;
ALTER TABLE transactions VALIDATE CONSTRAINT transactions_kind_check;   -- additive widening

WITH src AS (SELECT id, quota FROM users WHERE quota > 0 FOR UPDATE),
moved AS (
  UPDATE users u SET balance = u.balance + s.quota, quota = 0, updated_at = now()
    FROM src s WHERE u.id = s.id
  RETURNING u.id, s.quota AS q, u.balance AS bal_after),
led AS (
  INSERT INTO transactions (user_id, kind, quota_delta, balance_delta, reference, note)
  SELECT id, 'quota_merge', -q, q, 'quota-merge:' || id,
         'Kvota balansga o''tkazildi: ' || q || ' tanga' FROM moved
  RETURNING id, user_id)
INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, outcome, reason, before, after, meta)
SELECT NULL, 'users.wallet.quota_merge', 'user', m.id::text, 'ok', 'Obuna olib tashlandi',
       jsonb_build_object('quota', m.q, 'balance', m.bal_after - m.q),
       jsonb_build_object('quota', 0, 'balance', m.bal_after),
       jsonb_build_object('via', 'migration 034', 'transactionId', l.id)
  FROM moved m JOIN led l ON l.user_id = m.id;
```
- **One row** per user (`quota −q`, `balance +q`): every column equals its ledger sum and the total is unchanged. The new kind keeps it out of revenue, adjustments and cash.
- `UNIQUE` reference blocks a second merge per user; re-runs are no-ops (`quota > 0` is empty).
- Consumer history (`recentTransactions`) shows amount 0, so the sum goes in the note.
- Old containers could refund into quota during the swap. If `SELECT count(*) FROM users WHERE quota>0` is not 0 after deploy, an optional `admin:merge-quota` CLI (same SQL, reference `quota-merge:<id>:<txid>`) sweeps it.
- **Pre-deploy (read-only, owner approval):**
  - `SELECT count(*), sum(quota) FROM users WHERE quota>0` (expect 8 and 2 700 000).
  - `SELECT count(*) FROM payment_orders WHERE purpose='pro' AND state IN ('created','pending')`.
- **Post-deploy:** `wallet_ledger_mismatch` = 0, Σbalance +2 700 000 exactly, 8 audit rows.

## Tests (nothing is weakened)
**Deleted together with their behaviour:**
- credits-atomic.test.mts:15,29-33,125-152: the `activatePro` subtest. The function is deleted; the cancel and refund subtest stays.
- payments-credit-swap.test.mts:14,95-115: the pro branch. **Replace** it with: a legacy pro order settles into `balance`, as kind `subscription`, leaves `plan` untouched, and stays idempotent.
- admin-users.test.mts:253-254,307-308,347-352 and ui/admin-users.test.mts:130-131,141,176,223,268,305-306: the plan filter and plan keys. The blocked, isAdmin and range assertions stay.

**Changed (same strength, new rule):**
- credits.test.mts:55-61: the expected wallets become `{1000, 300, 2200}`. Add «quota never grows».
- admin-wallet.test.mts:304-315: `wallet:"quota"` now returns 400.
- admin-order-refund.test.mts:140-141,276-310: the clawback comes from `balance`; units still come from the order's own row.
- admin-seed-dev.test.mts:206,211,241: `subscription` must still be ≥1, plus `quota_merge` ≥1; drop `users.pro`.

**Fixtures only:**
- Seed pro orders by SQL instead of `PRO_PLAN`: admin-metrics.test:50,260; admin-payments.test:38,128,178-183,475-476; admin-finance.test:39,173,201,275,278,436-437.
- payments.test:233-238: test the tiyin rule on a literal or on `MIN_TOPUP_SOUM`.
- purchase-poll:37: drop `plan`.
- admin-download:113-116: use `blocked=1`.
- Remove `plan`, `planExpiresAt`, `premium` and `payPlan` from: session-resilience:36,44; topup-cta:22; login-returnto:27,44,81,99; price-changed:40; admin-providers:34; template-gallery:25; the ui/*-composer tests; viewer/*-form.
- ui/admin-money:256: keep the pro order and expect wallet balance.

**Unchanged:** metrics-report.test:62, retention.test:149-153, payments-orders.test:151.

**New:**
- quota-merge.test.mts: prior charges/refunds, per-column equality, total preserved, re-run no-op, audit row, mutation.
- Orders route rejects pro; session has no plan; `refundInTx` fold; no «Pro» on Purchase/Sidebar/Profile.
- Playwright smoke: /uz/purchase, profile, admin users/finance.

## 5. Work packages
| WP | Owns | Model | Order |
|---|---|---|---|
| WP0 | migration 034, quota-merge test, the `TRANSACTION_KINDS` ×3 and labels.ts kind entries | opus | first |
| WP1 | payments.ts, orders route, credits.ts, refund-tx.ts, spend.ts, session.ts, users/me route, plus their tests | opus | after WP0 |
| WP2 | Purchase, PayDialog, ui.ts, api-client.ts, types.ts, store.ts, Profile, Sidebar, SearchDialog, page metadata, plus UI fixtures and smoke | sonnet | parallel with WP1. Contract: `SessionUser` without plan/premium, `quota` kept |
| WP3 | admin-* server/api/components (except labels kinds), admin-seed-dev, plus admin tests | sonnet (order-refund: opus) | parallel; needs WP1 to remove `PRO_PLAN` |
| WP4 | README, topup.mts, metrics-report, 02-plan.md, deploy.md | haiku | any time |

Then: integration (tests, tsc, lint, build) and mutation runs on the merge and the refund fold.

## 6. Questions for the owner
1. Should a legacy pro order paid after deploy be credited as 15 000 **balance** (recommended), or should open pro orders be cancelled before deploy?
2. Can users see the merge row in their history (amount 0, note with the sum), or should it be hidden from consumer history?
3. Should the 8 users be told by broadcast?
4. In admin, should quota stay visible as «Kvota (eski)» when non-zero (recommended), or be hidden completely?

## 7. Owner decisions (2026-10-02)
- Subscriptions are removed from the whole product: every content item is paid individually.
- Existing `quota` balances (prod: 8 users, 2 700 000, all `admin_credit`) move to `balance` through migration 034 (`quota_merge`, one ledger row + one audit row per user).
- Prod has **no** payment orders at all (checked 2026-10-02), so there are no open or paid Pro orders to handle. A legacy Pro order paid after deploy (not expected) settles into `balance` as kind `subscription` (section A).
- The merge row IS shown in the user's own history (note carries the amount).
- No broadcast to the affected users.
- Admin: legacy quota / Pro orders shown with an "(eski)" label, only when non-zero.
- Admin panel was deployed first (prod `e57ffa5`, 2026-10-02); this sprint is a second deploy.

## 8. Status (pause 2026-10-02)
- Merged on `feat/remove-subscriptions`: WP0 (migration 034 + tests), WP4 (docs/scripts), WP2 (consumer UI).
- Pending merge: WP1 server (`wip/subs-wp1-server`, complete, final PII/typecheck not re-run) and WP3 admin (`wip/subs-wp3-admin`, WIP, unverified — agent died on a dropped API connection).
- Next: finish and verify WP3 on top of WP1, integrate, full regression, money review of 034 + refund fold, then the second deploy with owner approval.
