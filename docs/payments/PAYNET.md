# Paynet (UZPAYNET) provider — SPEC (2026-10-16, owner decisions)

Source documents (not in the repo): Paynet «Порядок технического взаимодействия» (Приложение №2, contract S-2075) and «UWS_JSON» (JSON-RPC 2.0
spec v3.3). Paynet's own tester (`paynet-tester-linux`, local web page) drives acceptance. We are the **provider**: Paynet agents (terminals,
kiosks, apps) send JSON-RPC calls to ONE URL of ours; we credit the user's wallet.

## Owner decisions
- Payer identifier = **SlaydX ID** (`users.id`, numeric). Only 5 of ~6 000 users have a phone, so a phone cannot identify payers. Parameter name `client_id`.
- Payment type «Многоразовые» (top-up). **CancelTransaction is never honoured** — payments are non-refundable (owner: «bizga o'tkazilgan to'lov bekor qilinmaydi»).
- `GetInformation` returns a partially hidden name («Adham B.») and the balance.
- Bandlik.uz (vakant3) shares the Paynet endpoint like it shares Click: its requests are FORWARDED untouched (see «Forwarding»).

## Endpoint
`POST /api/payments/paynet`, JSON-RPC 2.0, UTF-8, dates `YYYY-MM-DD HH:mm:ss` in GMT+5 (Asia/Tashkent, no DST). All answers are HTTP 200 + JSON
except 401 / 403. `id` of the request is echoed (null when unknown). Body ≤ 64 KB (read while reading, else `-32600`).

### Security
1. **HTTP Basic** (`PAYNET_USERNAME` / `PAYNET_PASSWORD`, compared in constant time via sha256 digests). Missing / wrong / not configured → **HTTP 401**
   + `WWW-Authenticate: Basic realm="paynet"` + `{jsonrpc,id:null,error:{code:412,"Неверный логин или пароль"}}`.
2. **IP allow-list** `PAYNET_ALLOWED_IPS` (comma separated IPs / CIDRs; Paynet's: `213.230.106.112/28`, `213.230.65.80/28`), client IP from `clientIp(req)`
   (trusted proxy header). Empty = off (testing; a warning is logged once). Not allowed → **HTTP 403** + error 601. nginx can enforce the same ranges (server change, owner consent).
3. Nothing about the password is ever logged or stored in `payment_events`.
4. Response time budget 500 ms: one short transaction per call, no outbound calls on our own orders.

### Config (env, web container only)
`PAYNET_USERNAME`, `PAYNET_PASSWORD`, `PAYNET_SERVICE_IDS` (comma list of OUR Paynet serviceIds), `PAYNET_CLIENT_PARAM` (default `client_id`),
`PAYNET_ALLOWED_IPS`, `PAYNET_VAKANT_SERVICE_IDS`, `VAKANT_PAYNET_FORWARD_URL` (default `https://abitur24.uz/api/payments/paynet`).
Not configured (no username, password or service ids) → every call is a 401. `paymentsConfigured().paynet` is true only when all three are set.

## Methods (acceptance = Paynet tester)
Common validation: body is ONE object with `jsonrpc:"2.0"`, string `method`, `id` (string|number), `params` object, else `-32600`; invalid JSON `-32700`;
non-POST `-32300`; unknown method (incl. `ChangePassword`) `-32601`; missing required params `-32602`; any internal failure `-32603`
(never leak details). `serviceId` must be an integer in `PAYNET_SERVICE_IDS`, else **305**.

Client lookup (`fields[PAYNET_CLIENT_PARAM]`): absent → **411**; not 1–18 digits → **401**; no such `users.id` (also too large for bigint, `0000000000`) → **302**;
`users.is_blocked` → **501**.

| Method | Params | Result / errors |
|---|---|---|
| `GetInformation` | serviceId, fields | `{status:"0", timestamp, fields:{name:"Adham B.", balance:<users.balance, so'm>}}`. The tester reads `balance` **in so'm** (NOT tiyin). |
| `PerformTransaction` | amount (tiyin), serviceId, transactionId (Paynet's number), fields | Validate: integer `>0` and multiple of 100 (whole so'm) else **413**; `< MIN_TOPUP_SOUM` → 413, `> MAX_TOPUP_SOUM` → **415**; `transactionId` positive safe integer (digit string accepted) else `-32602`. Duplicate `transactionId` → **201**. Success `{timestamp, providerTrnId, fields:{client_id, balance:<new balance so'm>}}`. Credits `amount/100` so'm to `users.balance` + the payment bonus (ball) — via the existing settle path, ledger reference `paynet:<transactionId>`. Insert + settle are ONE transaction; two concurrent calls with the same `transactionId` → exactly one credit, the other gets 201. |
| `CheckTransaction` | serviceId, transactionId, timestamp | found/paid `{transactionState:1, providerTrnId, timestamp}`; not found `{transactionState:3, providerTrnId:0, timestamp}`; invalid `timestamp` → **414**. |
| `CancelTransaction` | serviceId, transactionId, timestamp | Never cancels. Found → error **77** («payments are non-refundable»); not found → **203**. |
| `GetStatement` | serviceId, dateFrom, dateTo | `{statements:[{amount (tiyin), transactionId, providerTrnId, timestamp}]}` of PAID Paynet orders with `perform_time` in `[dateFrom, dateTo]` (Tashkent time), ordered, ≤ 50 000 rows. Invalid / reversed dates → **414**. |

## Data model
Migration `050_paynet.sql`: widens `payment_orders.provider` and `payment_events.provider` CHECKs to include `'paynet'` (DROP + ADD CONSTRAINT → the deploy guard
refuses it: the owner runs `slaydx-deploy <sha> --allow-destructive` once, like 048), `paynet_trn_seq` + `payment_orders.paynet_trn_id BIGINT` (our numeric `providerTrnId`, unique),
index for GetStatement. A Paynet top-up is a normal `payment_orders` row: provider `paynet`, purpose `topup`, `provider_txn = String(transactionId)`, state `paid`,
`create_time = perform_time = now (ms)`. The existing unique index `(provider, provider_txn)` is the idempotency guard; every admin report keeps working because the row is a normal order.
Every authenticated call is also logged to `payment_events` (provider `paynet`, method, order id, transactionId, params with secrets redacted, response code).

## Forwarding to Bandlik.uz (vakant3)
Decided BEFORE our own auth (Bandlik authenticates with its own credentials): forward when the parsed request's `serviceId` is in `PAYNET_VAKANT_SERVICE_IDS`, **or** any string value in
`params.fields` starts with `vk-` / `vk_` (Get/Perform of a Bandlik payer). The raw body, `Content-Type` and `Authorization` are POSTed unchanged (+ `X-Forwarded-By: slaydx`) to
`VAKANT_PAYNET_FORWARD_URL`; 8 s timeout, no redirects, ≤ 20 in flight, reply ≤ 16 KB; HTTP 200 + JSON object is returned verbatim; anything else → JSON-RPC `-32603` «forward_failed» (id echoed).
SlaydX writes nothing to its payment tables for forwarded calls. Same hardening and tests as `docs/payments/CLICK-FORWARD.md` (share the helper in `lib/server/click-forward.ts`).
Contract for the vakant3 side: it receives exactly what Paynet sent (including the Basic header), answers HTTP 200 + a JSON-RPC response.

## Implementation (core backend, `feat/paynet-core`)
- `lib/server/migrations/050_paynet.sql` — as «Data model»; GetStatement index `payment_orders_paynet_paid_idx (perform_time, paynet_trn_id) WHERE provider='paynet' AND state='paid'`; ROLLBACK block in the header.
- `lib/server/payments.ts` — `settleOrderInTx(client, orderId, performTime, opts)` is the old `settleOrder` body (returns `{outcome, credited, bonusPoints, bonusPercent}`, never logs);
  `settleOrder` is the transaction wrapper with the same post-COMMIT log (Click / Payme unchanged). `createPaidPaynetOrder` inserts the order (`state 'pending'`, `create_time = now`,
  `paynet_trn_id = nextval`) and calls `settleOrderInTx` in ONE transaction; a unique violation on `payment_orders_txn_idx` rolls everything back and returns `duplicate`.
  `findPaynetOrder`, `paynetStatement` (half-open `[from, to)` in ms).
- `lib/server/paynet.ts` — everything protocol-side; `app/api/payments/paynet/route.ts` is a thin `POST` (+ every other HTTP method → `-32300`).
- `lib/server/click-forward.ts` — `forwardRaw` is the shared hardened forward (Click keeps `forwardToVakant`, same log line); each channel has its own 20-in-flight budget.

Behaviour details fixed by the implementation (not spelled out above):
- Check order per request: forward decision → IP → auth → envelope errors (`-32700` / `-32600`, so an unauthenticated caller only ever sees 401 / 403) → method.
- Per method: required params present (`-32602`) → `serviceId` (305) → `transactionId` (`-32602`) → `timestamp`/dates (414) or amount (413 / 415) → payer (411 / 401 / 302 / 501) → work.
  `fields` missing or not an object → `-32602`; present but without the client param → 411.
- `transactionId`: number or digit string, canonicalised (`"000123"` and `123` are the same id → 201). `serviceId`: integer or digit string. Amount: integer or digit string.
- Client id: number or 1–18 digits, looked up as `bigint` (leading zeros allowed: `"007"` = user 7; `0` / `0000000000` → 302).
- `CheckTransaction`: `transactionState` 1 paid, 2 cancelled (cannot happen today), 3 not found; `timestamp` = the perform time (now when not found).
- `GetStatement`: both ends inclusive to the second (`perform_time < dateTo + 1 s`), ordered by `perform_time, providerTrnId`; `transactionId` returned as a number.
- Errors carry Russian messages (Paynet's); internal failures are `-32603 «Системная ошибка»` with the detail only in our log.
- `payment_events`: every call that passed auth (envelope errors and `-32601` included): method, order id, transactionId, params (`redactPayload`), response code (0 = success).
- Log: one `[paynet] call` line (method, serviceId, code, http, ms, detail, forwarded) + `[paynet] forwarded to vakant` for forwards; the empty-allow-list warning once per process.
- Tests: `tests/paynet.test.mts` (route against Postgres) and `tests/paynet-forward.test.mts`; their headers list the mutations each suite was checked against.

## UI
Wallet: a «Paynet orqali to'lash» card (only when Paynet is configured) showing the user's SlaydX ID with a copy button and 3 short steps (Paynet agent → service «SlaydX» → enter the ID).
Admin: provider `Paynet` everywhere providers appear (labels, filters, revenue by provider, order search / settle-ref matching, exports, bot admin stats if provider-specific).
