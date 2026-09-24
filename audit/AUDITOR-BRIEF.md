# Auditor brief — production-readiness audit (branch `audit/production-readiness`)

Every Phase-2 auditor reads this file first. It is the contract for scope, rules and output.

## 1. What we are asking

Find every bug, security vulnerability and component that will fail under many concurrent
users / real market conditions. This audit is **not** about document/slide *content quality*
(prompts, layout, typography, gates) — 24 earlier audits (`docs/AUDIT*.md`) covered that.
Do not re-report product-quality items unless they cause a crash, data loss, security issue,
money loss, or failure under load.

**Target load (assume unless the code proves otherwise):** 50 000 registered users,
2 000 concurrently active, peak bursts 10× normal traffic (e.g. exam season, a Telegram post).
Deployment today: ONE VPS shared with two other projects, `docker compose` with one `web`
(Next.js standalone), one `worker` (`WORKER_CONCURRENCY=2` default), one Postgres 16; nginx in front.
When a finding is load-related, say **at roughly what scale it breaks** and **the failure mechanism**.

## 2. Inputs

- `audit/01-map.md` — architecture map (stack, processes, flows, state).
- `audit/scout/{app,server,generation,frontend}.md` — detailed factual notes with file:line.
- `CLAUDE.md`, `README.md`, `.claude/structure.md` — project docs (Uzbek). Verify everything against code:
  the scouts are fast models and can be wrong; **code is the only source of truth**.

## 3. Rules (strict — violating these fails the audit)

1. **Read-only.** The only file you may create or modify is your own findings file
   `audit/findings/<auditor>.md`. No code edits, no `git` commands that change state
   (no checkout/commit/stash/reset), no `npm install`.
2. **No heavy commands.** This laptop has 14 GB RAM and has been OOM-killed by parallel test runs.
   Do NOT run `npm test`, `tsc`, `next build`, dev servers, Playwright, LibreOffice, `npm run live`
   or any `scripts/*.mts`. Reading code, `grep`, `sed -n`, `git log/show/grep` (read-only) are fine.
   If a finding needs a runtime proof, write the reproduction as a script/test *in the finding text*
   — the orchestrator runs proofs later, serially, through `scripts/heavy.sh`.
3. **Never touch production or paid APIs.** No calls to Gemini/Anthropic/OpenAI/xAI/fal/Pexels/Azure/Payme/Click/Telegram,
   no SSH, no network calls except `npm audit`/registry metadata where your scope says so.
4. **Never print secrets.** Do not open `.env`, `.env.local`, `.env.*` (except `.env.example`). If you
   find a secret in code or git history, report only *where* (file:line or commit + path) and *what kind*
   ("Telegram bot token"), masked (first 4 chars max). Never paste the value.
5. The repo is **PUBLIC on GitHub** (`khusinboev/slaydx`). Anything ever committed is public — factor that into severity.

## 4. Severity

- **P0** — security breach, data loss/corruption, money loss, or total outage (reachable by an ordinary/unauthenticated user or by normal load).
- **P1** — fails under the target load, or crashes/breaks a common flow.
- **P2** — bug, degraded UX, partial failure, rare-path breakage.
- **P3** — performance/maintainability/optimization.

Be calibrated: a P0 must be reachable in practice — state the precondition. Theoretical issues with
no reachable path are P3 or "rejected by self". Do not inflate.

## 5. Finding format (mandatory, one block per finding)

```markdown
### <AUDITOR>-<NN> — <one-line title>
- **Severity:** P0 | P1 | P2 | P3
- **Location:** `path/to/file.ts:123` (list every relevant site)
- **Evidence:** exact code quoted (short) + reasoning. For load issues: the mechanism and roughly at what scale it breaks.
- **Reproduction:** concrete steps, a curl sequence, or a test/script sketch that would fail today.
- **Proposed fix:** concrete and minimal (name the function/query/config to change).
- **Effort:** S | M | L
- **Confidence:** high | medium | low — if not high, say what would confirm it.
```

No vague findings ("could be improved", "consider adding"). If you are unsure, keep it but mark
confidence low and state the check that would confirm it. Prefix IDs with your auditor tag
(e.g. `SEC-01`, `DB-07`). Number sequentially.

## 6. Findings file layout

```markdown
# <auditor name> — findings
Scope actually covered: <dirs/files you really read>. Not covered: <what you skipped and why>.
Summary: P0 n · P1 n · P2 n · P3 n

<finding blocks, most severe first>

## Checked and OK
<short bullets: things you verified are handled correctly, with file:line — this prevents re-auditing>
```

## 7. Final message to the orchestrator

≤ 200 words: the findings file path, counts per severity, and one line per P0/P1 (ID — title — file:line).
Nothing else; the details live in the file.
