# Review — W1-A (C01 admin takeover), commit 44aab5b

(Recorded by the orchestrator from the reviewer's report; the reviewer's own file write was declined.)

**Verdict: CHANGES REQUESTED**

Verified: 30/30 tests pass (admin-contact, admin, telegram-link, telegram-bot-login), 0 skipped, Telegram calls stubbed. No Telegram input path lets a user store someone else's number.

Required:
- **R1** `lib/server/telegram.ts:334` still canonicalises a 9-digit `phone_number` to `+998…`, so `phone_number:"<9 digits>"` with a matching `user_id` is stored as the admin number (test 5 in `tests/admin-contact.test.mts:185` expects this). It also corrupts genuine 9-digit international numbers (+299 / +298 / +376). Fix: store `+<digits>` exactly as Telegram sends it, reject lengths outside 7–15 digits, and flip test 5 to expect "not admin".

Nits: add a `forward_origin` test case; only accept contacts in private chats (`chat.type === "private"`).

Deploy note (owner, read-only): on prod, confirm that only the admin's own `telegram_id` holds the admin phone in either form (with and without `998`).

## Re-review — commit 94b9689

**Verdict: APPROVE**

- **R1 is resolved.** `handleContact` saves the number as `+<digits>` exactly as Telegram sent it. Nothing adds a country code any more; `normalizePhone` is no longer imported in `telegram.ts`. Numbers with fewer than 7 or more than 15 digits are rejected. `isAdminPhone` compares digits exactly, so a 9-digit number is saved as `+976063896` and is not admin. Test 5 now expects that.
- **No non-admin path left.** An account passes `isAdminPhone` only if the saved number's digits exactly match `998976063896`. The only way to save a number is a contact that meets all of these:
  - it comes from `update.message`
  - it was sent in a private chat
  - it was not forwarded (`forward_origin`, `forward_date` and `forward_from` are all checked)
  - `contact.user_id === from.id`

  `session.ts`, `admin.ts` and `app/uz/admin/page.tsx` all go through the same strict check.
- **The real admin's own share still works.** Telegram sends `998976063896` (sometimes with a `+`), which is saved as `+998976063896` and passes the admin check; test "o'zining xalqaro shakldagi admin raqami" covers it. `chat.type` is a required Bot API field, so real private chats always get `"private"`.
- **Nits are done.** Tests now cover `forward_origin`, a group chat, and a number that is too short.
- **Tests:** the 4 files through `heavy2.sh` with the throwaway DB give 33 pass, 0 fail, 0 skipped. Telegram calls are stubbed.
- **Deploy note still applies:** on prod, confirm that only the admin's own `telegram_id` holds `998976063896` or `976063896` in either form.
