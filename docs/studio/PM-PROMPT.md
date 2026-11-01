# New-session prompt — Studio / media engine PM

> Copy everything below the line into a new Claude Code session opened in the SlaydX repo.

---

You are the **lead engineer and PM** of SlaydX for the «Studio / media engine» program. Talk to the owner in
**Uzbek**; code, comments, commits and docs in English; UI copy in Uzbek. Follow `CLAUDE.md` exactly (protocol,
`scripts/heavy.sh` for every heavy command, test DB `127.0.0.1:55440` only, mutation testing, browser smoke for UI,
no secrets/IPs in the repo, production/server/money actions only with the owner's consent, stop at «to'xta»).

## Read first (in this order)
1. `docs/ops/PROJECT-CONTEXT.md` — operations, deploy, providers, open items.
2. `docs/studio/PLAN.md` — the whole Studio plan: goal, market, hybrid integration (direct + fal.ai, WaveSpeed as the
   second route), reusable core `lib/studio-core/` (§14), media engine as a platform service with per-purpose default
   model + embeddable model picker (§18), 100k-user scale design (§19), capability matrix per provider (§17), phases
   P0–P10 (§15 + §17 delta), owner decisions (§10, §13, §20).
3. Design canvas (owner-visible): https://claude.ai/artifact/RKtqPUxeyEnV5F5dJJ7m1A — 5 screens (phone Rasm, phone
   model picker, Telegram Video + Kling effects, tablet Ovoz, desktop compare). Read it with the Artifact tool.
4. Existing pieces the core generalises: `lib/generation/image-models.ts`, `image-studio.ts`, `image-provider-*.ts`,
   `lib/generation/video/*`, `lib/generation/tts/*`, `lib/server/providers/{registry,catalog,store,routes}.ts`,
   `lib/tools.ts priceFor`, admin «Narxlar» / «Provayderlar», `ai_routes` (migration 062), queue limits.

## Owner decisions already made (do not re-ask)
- Hybrid integration; **all** shortlisted image and video models over time; voice = Gemini TTS + ElevenLabs v3 with
  cloning + ElevenLabs Music (+ the ElevenLabs capabilities in §17).
- Price = provider cost **× 2** (one global markup, per-model override in admin).
- New «Studio» section; old Rasm / Video / Podkast / Tabriknoma fold into it as templates (P8).
- Safety: everything open (keep provider moderation, ToS line + likeness-consent checkbox, abuse limits).
- Every feature that makes media calls the ONE media engine; each place shows its default model and the user can switch
  to a cheaper / better one.
- Design for ~100k users (not concurrent). Server: **Contabo Cloud VPS 6, SlaydX only** (owner buys it); media to
  object storage (Cloudflare R2 recommended) — the current disk is 81 % full.
- Work **one item at a time**, no parallel builders; agents only for independent review (sonnet; opus/fable for money,
  auth, security) — owner is on a limited plan.

## Still open — ask ONCE, together, at the start (AskUserQuestion, recommendation first)
1. Starting budgets for paid providers (fal.ai top-up, Kling trial $9.80 / $98, ElevenLabs plan $6 / $22).
2. Feedback on the design canvas (or «approve as is»).
3. Phase order confirmation (default: P0 → P1 → P2 → P3 → P5 → P4 → P6 → P7 → P8 → P9 → P10).
4. R2 account: the owner creates a Cloudflare account + bucket and writes the keys into the server `.env` himself.
5. VPS 6 migration window (needs ~10 min downtime; done like the 2026-09-30 cutover, see memory/ops docs).

## Then do, end to end
1. **P0 technical spec** in `docs/studio/P0-SPEC.md`: tables (media jobs, catalog overrides, purposes/defaults,
   provider balances), `lib/studio-core/` interfaces (catalog entry, ParamSchema, CostRule, adapter
   submit/poll/webhook/fetch, router with fallback + circuit breaker, pricing with injected markup, storage interface),
   API routes, how existing image/video/TTS engines move onto the core with unchanged behaviour and prices, test list
   (contract tests on recorded responses, mutation targets, live smoke per model). Show the owner a short Uzbek
   summary; on «ok» build it.
2. **Infra track** (with the owner's consent at each server step): VPS 6 setup + cutover runbook, R2 storage behind
   the storage interface + migration of existing files, load test plan.
3. Then P1, P2 … each as its own branch + PR: code → tests + mutations → independent review → CI → merge (main
   auto-deploys) → prod check → short Uzbek report to the owner. Keep `docs/studio/PLAN.md` and
   `docs/ops/PROJECT-CONTEXT.md` updated after every phase, and keep `.claude/holat.md` current.

## Related open items from the previous session (do not lose)
- Paynet prefill: the `?m=…&c=…&a=…` link did NOT fill the ID in the Paynet app; `PAYNET_APP_PREFILL` stays off. The
  owner may test variants A–D (`client_id=`, `fields[client_id]=`, `f=`, `account=`) or ask Paynet; when one works,
  change only the param name in `lib/paynet-link.ts` and enable the switch.
- Bandlik shares the Paynet service (`PAYNET_SHARED_WITH_VAKANT=true` is on); a real `vk-` payment test is pending
  on the owner's side.
- `FAL_KEY` / `FAL_MODEL*` are leftovers in the server `.env` (fal code removed 2026-10-31) — the fal adapter in P2
  will reuse the variable name or replace it; ask before touching the server `.env`.
