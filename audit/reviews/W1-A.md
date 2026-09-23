# Review — W1-A (C01 admin takeover), commit 44aab5b

(Recorded by the orchestrator from the reviewer's report; the reviewer's own file write was declined.)

**Verdict: CHANGES REQUESTED**

Verified: 30/30 tests pass (admin-contact, admin, telegram-link, telegram-bot-login), 0 skipped, Telegram calls stubbed. No Telegram input path lets a user store someone else's number.

Required:
- **R1** `lib/server/telegram.ts:334` still canonicalises a 9-digit `phone_number` to `+998…`, so `phone_number:"<9 digits>"` with a matching `user_id` is stored as the admin number (test 5 in `tests/admin-contact.test.mts:185` expects this). It also corrupts genuine 9-digit international numbers (+299 / +298 / +376). Fix: store `+<digits>` exactly as Telegram sends it, reject lengths outside 7–15 digits, and flip test 5 to expect "not admin".

Nits: add a `forward_origin` test case; only accept contacts in private chats (`chat.type === "private"`).

Deploy note (owner, read-only): on prod, confirm that only the admin's own `telegram_id` holds the admin phone in either form (with and without `998`).
