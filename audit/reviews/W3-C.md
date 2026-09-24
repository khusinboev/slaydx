# W3-C review: payments (CONC-02, DB-09, BEA-05, OBS-09, OBS-14, TEST-01)

- **Reviewer:** independent, read-only.
- **Branch:** `worktree-agent-a060b3c0e42a97718` (`807db84`, `4fc1dea`), compared with `audit/production-readiness...`.
- **Files:** `lib/server/payments.ts`, `lib/server/payment-events.ts`, `lib/server/migrations/025_payment_events.sql`, `app/api/payments/{payme,click}/route.ts`, `tests/payments-orders.test.mts`.

## Verdict: **CHANGES REQUESTED**

The money core is correct and is a real improvement:
- `settleOrder` and `cancelOrder` now hold the order-row lock.
- The state change and the ledger write happen in one transaction.
- The Perform ∥ Cancel and Complete ∥ Complete races no longer lose or duplicate money.

One protocol change is wrong, though. The fix answers a **busy or closed order with an account error (-31051 / -31052)**. The official Payme sandbox spec and Payme's own reference template both answer it with **-31008**. The audit finding BEA-05 proposed the wrong code (its confidence was "medium"), and the fix followed it and locked it in with a test. That would fail Payme merchant acceptance. The claimed 1-year purge is also never called.

### Required changes

1. **Payme busy/closed order → -31008, not -31051/-31052.** Do this in `payable()` (`app/api/payments/payme/route.ts:130-131`) and in the attach-race branch (`:177`). Keep `-31050` + `data:"order_id"` for an unknown order or a wrong provider, and keep `-31001` for a wrong amount. Update test 6 in `tests/payments-orders.test.mts:306-325` to match.
   - Spec, Payme «Песочница» (developer.help.paycom.uz/pesochnitsa): *«на запрос к реализованному методу CreateTransaction c новой транзакцией и состоянием счета «В ожидании оплаты» — ответ с ошибкой -31008: "Невозможно выполнить операцию"»*.
   - Official template `PaycomUZ/paycom-integration-php-template`:
     - `Order::validate`: `if ($this->state != self::STATE_WAITING_PAY) throw … ERROR_COULD_NOT_PERFORM` (-31008). It runs in both CheckPerformTransaction and CreateTransaction.
     - `CheckPerformTransaction`: *"There is other active/completed transaction for this order."* → `ERROR_COULD_NOT_PERFORM`.
   - The pre-fix code already returned -31008 on Create for a non-`created` order. Only CheckPerform's `allow:true` for pending/cancelled orders was wrong, and switching that to -31008 fixes BEA-05 #2 without breaking certification.
2. **Wire `purgePaymentEvents()` into worker `housekeeping`.** Use the separate `step(...)` pattern in `lib/server/worker.ts:428+`. Today it is dead code: `grep purgePaymentEvents` finds only its definition and the test. So the claim "1-year purge" does not hold and `payment_events` grows without bound. If `worker.ts` belongs to another package this wave, do it in the wave wrap-up. Either way it must land before this is marked closed.

### Must sandbox-test before prod (not blocking the merge)

- **A. Click, serial duplicate `Complete` on an already-paid order now returns `error: 0`.**
  - Click's reference implementation (`click-llc/click-integration-php`, `BasicPaymentsErrors::request_check`) returns `-4 "Already paid"` whenever the payment is CONFIRMED, including on Complete. BEA-05 #5 asked for -4.
  - Money-wise, 0 is the safer answer: Click cannot read it as a failure and reverse a payment we already credited.
  - Still, this is a conscious deviation. Confirm it with Click's test console (or Click support), then record the decision in the code comment.
- **B. Payme Create with `time` older than 12 h → -31008.** The template answers `ERROR_INVALID_ACCOUNT` with `data:"time"` here, but its condition is inverted (`time - now >= TIMEOUT`). The sandbox does not test this case. -31008 is reasonable, but verify it.
- **C. Internal exception → -31008.** This is unchanged behaviour. The spec has `-32400` (system error), and the template uses `ERROR_INTERNAL_SYSTEM` for exactly this. After a rolled-back Perform, -31008 may make Payme cancel rather than retry. That stays consistent (no credit, and the hold is released), but consider switching to -32400. Decide with the sandbox.
- **D. Run the full sandbox scenario set** (test.paycom.uz) against staging once #1 is fixed:
  - both "create → cancel" and "create → perform → cancel";
  - wrong amount, wrong account, bad auth.

### Non-blocking notes

- **Pre-auth body read.** `readRpc` checks `content-length`, but a chunked body with no length is still read in full before the 64 KB check. That is an unauthenticated memory read, so it depends on nginx `client_max_body_size`. Put a comment on it, or stream it with a byte cap.
- **Duplicated credit logic.** `creditInTx` duplicates `credits.ts topUp` (its own comment says so). When `credits.ts` is free, extract a `topUpInTx` so the two cannot drift apart.
- **Click `Complete` without `merchant_prepare_id`** is still accepted on a `created` order. This is unchanged: the reference implementation requires the prepare id, and the signature covers it. Worth tightening later (-6 if empty).
- **`payment_ledger` join** on `provider || ':' || COALESCE(provider_txn, id::text)` is correct for every reference `settleOrder` writes. It is not indexable, which is fine for ad-hoc sverka.

## 1. Spec conformance

| behaviour change | spec reference | conforms? | sandbox-test before prod? |
|---|---|---|---|
| Payme 12 h timeout: repeated Create / Perform on state-1 txn older than 43 200 000 ms → cancel reason 4 + -31008 | CreateTransaction page: «Отмена транзакции по таймауту производится через 12 часов — 43 200 000 миллисекунд … переходит в состояние … (-1), с причиной … (4)»; template `isExpired()` → `cancel(REASON_CANCELLED_BY_TIMEOUT)` + `ERROR_COULD_NOT_PERFORM` | yes | yes (scenario) |
| Payme new Create with `time` ≥ 12 h old → -31008 | not in the public doc; template uses -31050 + `data:"time"` (with an inverted condition) | uncertain | **yes** (B) |
| Repeated Create on state ≠ 1 (paid/cancelled) → -31008 (previously a paid txn returned a result) | template: `state != STATE_CREATED` → `ERROR_COULD_NOT_PERFORM` «Transaction found, but is not active» | yes | yes |
| CheckPerform / Create on a busy order (other txn pending) → **-31051** | sandbox: «CreateTransaction c новой транзакцией и состоянием счета «В ожидании оплаты» — ответ с ошибкой -31008»; template `Order::validate` → -31008 | **NO** | **yes, fix first (#1)** |
| CheckPerform / Create on a paid/cancelled order → **-31052** | template `Order::validate` → -31008 | **NO** (should be -31008) | yes (#1) |
| Unknown order / other-provider order → -31050 + `data:"order_id"` | sandbox: «CheckPerformTransaction и CreateTransaction … ошибками -31050 — -31099: «Неверный код заказа»»; errors table: `data` = name of the account sub-field | yes | yes |
| Wrong amount → -31001 | sandbox: «ответы с ошибкой -31001: «Неверная сумма»» | yes | yes |
| Perform on cancelled → -31008; Perform on paid → result `state:2`, original `perform_time` | PerformTransaction errors: -31003 «Транзакция не найдена», -31008 «Невозможно выполнить данную операцию»; template returns the existing result for a completed txn | yes | yes |
| Cancel after Perform → -31007 (unchanged, now decided under the lock) | CancelTransaction: «-31007 Заказ выполнен. Невозможно отменить транзакцию» | yes | yes (scenario 2) |
| Repeated Cancel returns the first `cancel_time`/`reason` | template CancelTransaction returns the stored cancel_time for a cancelled txn | yes | yes |
| AUTH failure echoes the request `id`, -32504 | JSON-RPC 2.0 + Payme errors «-32504 Недостаточно привилегий для выполнения метода» | yes | yes (bad-auth case) |
| Create missing `id`/`time` → -32600 | errors table «-32600 Отсутствуют обязательные поля в RPC-запросе или тип полей не соответствует спецификации» | yes | no |
| Localised `message` {ru, uz, en} | errors table: message is an object with ru/uz/en | yes | no |
| Click Complete `error<0` on a paid order → -4, not cancelled | reference `complete()`: `if error<0 && !in_array(result.error,[-4,-9])` → cancel/-9, otherwise the -4 stands | yes | yes |
| Click Complete `error<0` on a pending order → cancel, -9 | same | yes | yes |
| Click duplicate Complete on a paid order → **0** (serial and concurrent) | reference `request_check`: CONFIRMED → `-4 'Already paid'` | **deviation** (safe for money) | **yes** (A) |
| Click cross-provider order → -5 | reference: order not found → `-5 'User does not exist'` | yes | no |
| Click amount / prepare-id / sign → -2 / -6 / -1 | reference table | yes (order of checks differs slightly: amount is checked before -4) | no |

Notes on the evidence:
- Click docs (docs.click.uz) is a SPA and could not be fetched. The Click column cites the official `click-llc/click-integration-php` source.
- The Payme method pages render only partially over WebFetch (the `oshibki-errors` page failed TLS). The sandbox page quote above was fetched verbatim.

## 2. Money invariants

- **No double credit.**
  - Perform ∥ Perform and Complete ∥ Complete: the second call waits on `FOR UPDATE` and sees `paid`, so it returns `already_paid`. `creditInTx` also re-checks `UNIQUE(kind, reference)` under the user lock.
  - A Complete whose amount differs from Prepare is rejected against `order.amountSoum` (-2) before any lock.
  - A Complete carrying another `click_trans_id` → -6.
  - A second Payme txn cannot be attached (`attachTransaction` refuses when `provider_txn` differs).
- **No credit on a cancelled order.** Under the lock, `settleOrder` returns `cancelled`/`expired` before crediting. The timeout cancel happens inside the same locked transaction.
- **Cancel after Perform is still rejected.** `cancelOrder` returns `paid` under the lock, which becomes Payme -31007 / Click -4. The paid → cancelled path that DB-09 described is gone.
- **`creditInTx` versus `topUp` / `activatePro`.** Same table, same `kind` (`topup` / `subscription`), same reference `"<provider>:<txn|id>"`, same note, same quota/balance deltas, and the same `plan='pro'` plus `GREATEST(COALESCE(plan_expires_at, now()), now()) + days` update, applied only when the credit was new. The differences:
  - it takes the user lock *before* the idempotency SELECT, which is stricter;
  - it drops `points`, which the payment paths never used;
  - Pro's quota and plan are now atomic, which fixes a latent partial-state bug.
  Wallet CHECKs are unaffected (only positive deltas).
- **Ledger invariant.** The tests assert `balance == SUM(balance_delta)` and `quota == SUM(quota_delta)` per user, including after 20 randomised Perform ∥ Cancel races (test 10).

## 3. Lock order

The order is `payment_orders` then `users`, and every path that takes both follows it. `chargeInTx`, `refundRatio`, `refund-tx`, `adminAdjustWallet` and `auth.ts` lock `users` only and never touch `payment_orders`. `attachTransaction` locks the order only. There is no user-delete path, so no reverse cascade. `UPDATE payment_orders` never changes `user_id`, so it takes no FK KEY SHARE on `users`. **No deadlock cycle.**

## 4. Redaction

- **What is stored.** Only the request body. The `Authorization` header is never passed in.
- **What is redacted.** `SECRET_KEY` blanks `sign_string`, `sign`, `password` (Payme ChangePassword), `key`, `token`, `authorization`, and similar names, at any depth up to 6.
- **Size limits.** Arrays are capped at 100 items. The whole payload is capped at 16 000 chars; beyond that it is stored as `{truncated, head}`, and the head is cut *after* redaction. Scalar columns are clipped to 200 chars.
- **Write failures.** The audit write never throws into the provider response.
- **Scope.** Only authenticated or signed requests are recorded.

Test 16 checks all of this on the real rows.

## 5. Migration 025

- **Additive only:** a new table, three indexes and a view. All are `IF NOT EXISTS` or `CREATE OR REPLACE`, so re-running is idempotent and nothing existing is locked or changed. Backward compatible.
- **Rollback:** the documented rollback (drop the view, drop the table, delete the `schema_migrations` row) is correct and complete.
- **Numbering:** the 023/024 gap is harmless because the runner applies any unapplied file in name order.
- **Open item:** retention is not wired (#2).

## 6. Tests

Run from the worktree root with `DATABASE_URL=postgres://slaydx:audit@127.0.0.1:55439/slaydx` through `heavy2.sh -m 3G -t 900`.

| suite | result |
|---|---|
| `payments-orders.test.mts` + `payments.test.mts` + `payme-sandbox.test.mts` | **29 pass, 0 fail** |
| `payments-orders` on its own | 18 pass, **0 skipped**; all 17 DB subtests really ran |

Test 6 currently pins the non-conforming -31051/-31052 and must change with #1.

---

## Re-review: commit `5268853`

### Verdict: **APPROVE**

R1 is fixed and verified. R2 is tracked (see below) and does not block.

### R1: busy / paid / cancelled order now → -31008

`payable()` now reads:

```ts
if (!order || order.provider !== "payme") return rpcError(id, ORDER /* -31050 */, "order_id");
if (Number(amount) !== tiyin(order.amountSoum)) return rpcError(id, AMOUNT /* -31001 */);
if (order.state !== "created") return rpcError(id, CANT_PERFORM /* -31008 */);
```

- **Attach race.** It returns `CANT_PERFORM` too.
- **Leftovers removed.** `BUSY` and `CLOSED` are gone; `grep 3105[12]|BUSY|CLOSED` over the routes and tests finds nothing.
- **Same-id concurrent Create.** Two Creates with the same txn id still both succeed: `attachTransaction` returns true when `provider_txn === txn`, so there is no false -31008.

This conforms to the spec on every point:

| case | spec | code now |
|---|---|---|
| New Create on an order «В ожидании оплаты» | Payme «Песочница» requires -31008 | -31008 |
| CheckPerform when another transaction is active or completed | template `CheckPerformTransaction` returns `ERROR_COULD_NOT_PERFORM` | -31008 |
| Order state is not "waiting pay" | template `Order::validate` returns -31008 | -31008 |
| Unknown or other-provider order | sandbox «-31050 — -31099: Неверный код заказа», with `data` = account field | -31050 + `data:"order_id"` |
| Wrong amount | sandbox | -31001, checked before the state check |

**Test 6** was rewritten. It now asserts -31008 for:
- CheckPerform on a pending order;
- Create with a new id on a pending order, and the first transaction stays `state 1`;
- CheckPerform after that transaction is cancelled;
- CheckPerform and Create on a paid order.

`payme-sandbox.test.mts` still asserts -31050 for an unknown order.

**Suites re-run** (worktree root, `DATABASE_URL=postgres://slaydx:audit@127.0.0.1:55439/slaydx`, `heavy2.sh -m 3G -t 900`):

| suites | tests | pass | fail | skipped |
|---|---|---|---|---|
| `payments-orders` + `payments` + `payme-sandbox` | 29 | 29 | 0 | 0 |

Test 6 is GREEN.

The table in section 1 above still shows the rows before `5268853`. For these two rows, the status is now:

| behaviour | conforms? |
|---|---|
| Busy order → -31008 | yes |
| Paid / cancelled order → -31008 | yes |

### R2: `purgePaymentEvents` housekeeping wiring (tracked, not blocking)

The orchestrator will wire it into `lib/server/worker.ts` housekeeping right after the merge. Until that lands, `payment_events` has no retention; this item stays open in the audit trail.

### Still must be sandbox-tested before prod

- **A. Click duplicate Complete on a paid order returns `error: 0`.** The official reference returns `-4 Already paid`. Our 0 is safe for money, but confirm it in Click's test console or with Click support, and record the decision.
- **B. Payme new Create with `time` ≥ 12 h old returns -31008.** Payme's template returns -31050 with `data:"time"`, but its condition is inverted, and the sandbox does not test this case.
- **C. An internal exception returns -31008.** The spec has `-32400`. Decide which one after the sandbox run.
- **D. Run the full Payme sandbox set on staging:**
  - create → cancel;
  - create → perform → cancel;
  - wrong amount;
  - wrong account;
  - bad auth;
  - the «В ожидании оплаты» case, which should now pass.
