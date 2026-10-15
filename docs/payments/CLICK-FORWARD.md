# Click callbacks shared with Bandlik.uz (vakant3)

One Click service, one callback URL (`/api/payments/click` on SlaydX). Click sends every Prepare (action=0) and Complete (action=1) there.

- vakant3 orders use `merchant_trans_id` = `vk-<id>`; SlaydX orders are UUIDs (`createOrder` → `randomUUID()`, column `payment_orders.id uuid`), so the prefix cannot collide (`tests/click-forward.test.mts`).
- The route reads the body ONCE as text. If `merchant_trans_id` starts with `vk-` the raw text is POSTed unchanged (same Content-Type, header `X-Forwarded-By: slaydx`,
  8 s timeout, no redirects) to `VAKANT_CLICK_FORWARD_URL` (default `https://abitur24.uz/api/payments/click`); an HTTP 200 + JSON object reply is returned to Click byte for byte.
  Any other outcome (timeout, network error, non-200, non-JSON) → Click error `-7`, note `forward_failed`, so Click does not complete the payment.
- SlaydX does no lookup, settle, cancel, credit or signature decision for `vk-` orders and writes nothing to its payment tables; it logs one line per forward
  (`[click] forwarded to vakant`: action, merchantTransId, upstreamStatus, ms) — never the sign_string or a secret.
- Everything else parses from the same text exactly as before (`readParams` replays it into a `Request`).
- Body cap 64 KB (Click callbacks are a few hundred bytes).
- Contract with vakant3 (do not change without telling that side): `POST <url>`, body + Content-Type as received, answer HTTP 200 + Click JSON
  `{click_trans_id, merchant_trans_id, merchant_prepare_id | merchant_confirm_id, error, error_note}`; vakant3 verifies the signature itself (same `CLICK_SECRET_KEY`).
