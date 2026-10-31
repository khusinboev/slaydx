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
2. **IP allow-list** `PAYNET_ALLOWED_IPS` (comma separated IPs / CIDRs — the two ranges Paynet publishes in its technical document, section «Сетевое соединение»; the values live in the server `.env`, not in the repo), client IP from `clientIp(req)`
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
Routing is by **serviceId only**: a call whose `params.serviceId` is in `PAYNET_VAKANT_SERVICE_IDS` (and not in `PAYNET_SERVICE_IDS` — ours win on an overlap) is forwarded.
A payer-prefix rule (`vk-`) was rejected after review: Check / Cancel / GetStatement carry no payer, so one payment's follow-up calls would be split between two systems.
**Bandlik therefore needs its own Paynet serviceId** (ask Paynet).
Order per request: body read once (≤ 64 KB) → parse once → **IP allow-list (for every call, so SlaydX is not an open relay)** → forward decision → our own Basic auth → method.
The raw body, `Content-Type` and `Authorization` are POSTed unchanged (+ `X-Forwarded-By: slaydx`) to `VAKANT_PAYNET_FORWARD_URL`; 8 s timeout, no redirects, ≤ 20 in flight (own budget, separate from Click's),
reply ≤ 16 KB; HTTP 200 + JSON object is returned verbatim; anything else → JSON-RPC `-32603` «forward_failed» (id echoed). SlaydX writes nothing to its payment tables for forwarded calls.
Contract for the vakant3 side: it receives exactly what Paynet sent (including the Basic header), answers HTTP 200 + a JSON-RPC response; do not IP-filter SlaydX's server.
Go-live checklist: `PAYNET_ALLOWED_IPS` set (needs `TRUST_PROXY=true`, nginx `X-Forwarded-For`), `runtimeWarnings` flags an empty list, a missing TRUST_PROXY and overlapping serviceIds.

## UI
Wallet (owner 2026-10-31): the top-up dialog (`PayDialog`) lists «Paynet» next to the Click/Payme methods (only when Paynet is configured); after the amount is chosen it opens the Paynet step (`components/overlays/pay/PaynetStep.tsx`): the amount, the user's SlaydX ID with a copy button and 3 short steps (Paynet app/terminal → service «SlaydX» → enter the ID and pay the amount). No order is created — Paynet's own call credits the wallet. The former standalone wallet card was removed.
Admin: provider `Paynet` everywhere providers appear (labels, filters, revenue by provider, order search / settle-ref matching, exports, bot admin stats if provider-specific).

## Shared service with Bandlik.uz — ONE Paynet service (owner 2026-10-30)
Supersedes «Bandlik needs its own serviceId» for the default setup (dedicated `PAYNET_VAKANT_SERVICE_IDS` still work, unchanged). Paynet has ONE service
(`serviceId` 1) and ONE login/password; the two projects are told apart only by the payer id: **Bandlik payers start with `vk-` / `vk_`** (SlaydX ids are digits).
Behind the flag `PAYNET_SHARED_WITH_VAKANT` (default OFF — turn it on only once Bandlik.uz serves the endpoint below, otherwise GetStatement would fail):

| Call | Rule |
|---|---|
| GetInformation / PerformTransaction, payer `vk-…` | relayed verbatim to `VAKANT_PAYNET_FORWARD_URL` **after our own Basic auth** (same login for both, so only an authenticated Paynet call is relayed; the IP allow-list still comes first). Perform: an invalid transactionId is `-32602` locally; a SlaydX order under the id → 201; otherwise the id is **claimed for Bandlik in `paynet_routes` BEFORE the relay** (if the claim cannot be written nothing is relayed). |
| PerformTransaction, digit payer | claims the id for SlaydX **inside the credit transaction**; a claim conflict (Bandlik already owns the id) → 201, nothing credited. So ONE system owns every transactionId — the primary key decides atomically, one Paynet payment can never be credited twice. |
| CheckTransaction / CancelTransaction | SlaydX order / `slaydx` claim → answered here; `vakant` claim → relayed (also while Bandlik's Perform is still in flight or its reply was lost — never «not found»); unowned id → answered locally (state 3 / 203). Bandlik unreachable → `-32603 forward_failed`. |
| GetStatement | our rows + Bandlik's `result.statements` (same request relayed, 4 MB reply cap), one row per transactionId (ours win, but a transactionId reported by BOTH is logged at error level), ordered by time then id. Bandlik rows are validated strictly (unique transactionId, providerTrnId > 0, positive integer tiyin amount, valid GMT+5 time). **All or nothing**: if Bandlik's list cannot be read or is malformed the call is `-32603` (Paynet retries) — never half a statement. |
| everything else | SlaydX, as before. Nothing is written to payment tables for relayed calls (only the route row). |

**Contract for the Bandlik side** (`POST VAKANT_PAYNET_FORWARD_URL`, default `https://abitur24.uz/api/payments/paynet`): it receives exactly what Paynet sent, including the
`Authorization: Basic …` header (the SAME login/password as SlaydX's — verify it) and `X-Forwarded-By: slaydx`; answers HTTP 200 + a JSON-RPC 2.0 response with the request `id`.
Methods: GetInformation, PerformTransaction (idempotent by `transactionId`: a repeat is error 201), CheckTransaction, CancelTransaction, GetStatement
(only Bandlik's own transactions, `amount` in tiyin, `timestamp` `YYYY-MM-DD HH:mm:ss` GMT+5). Its payer ids start with `vk-` / `vk_`. **Its `providerTrnId` values start at 1 000 000 000** so they never overlap SlaydX's sequence inside one merged statement. It may receive a retry of the same Perform (answer 201, never credit twice) and a Check/Cancel for an id it never committed (state 3 / 203). Do not IP-filter SlaydX's server;
answer within ~400 ms (our relay adds ~20–50 ms to Paynet's 500 ms budget). The Bandlik repo is not touched from here.

## Wallet / bot
`PAYNET_APP_URL` (https only, shown only while Paynet is live): Paynet step button «Paynet ilovasida to'lash» in the top-up dialog and, in the bot wallet, the SlaydX ID block + «Paynet'da to'lash» button.
