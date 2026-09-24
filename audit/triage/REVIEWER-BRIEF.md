# Reviewer brief — Phase 3 verification of P0/P1 findings

You are an independent REVIEWER (not the auditor who wrote the finding). Your job: decide, from the code,
whether each assigned finding is real, how severe it really is, and exactly what its fix touches.

## Inputs
- `audit/AUDITOR-BRIEF.md` §1 (target load) and §4 (severity scale — use it strictly; P0 = reachable
  security breach / data loss / money loss / total outage; P1 = fails at target load or breaks a common flow).
- The finding blocks named in your assignment, in `audit/findings/*.md` (find them by ID heading `### <ID>`).
- `audit/01-map.md` for orientation. **Code is the only source of truth.**

## Rules
- Read-only, except your own output file `audit/triage/verify-<group>.md`. No code edits, no git state changes.
- No heavy commands unless your assignment explicitly allows ONE probe; then run it only via
  `scripts/heavy.sh -m 1G -t 120 <cmd>`, never against prod or paid APIs, and put the probe script in
  `/tmp/claude-1000/-home-adhambek-projects-pythons-slaydbot/c9481df2-e551-4eb4-b6f4-de7690317f2f/scratchpad/probes/`.
- Never open `.env*` files (except `.env.example`) or print secrets.

## Output — one block per assigned finding (or per merged cluster)
```markdown
### <ID>[ + <merged IDs>] — <short title>
- **Verdict:** CONFIRMED | CONFIRMED-DOWNGRADE | CONFIRMED-UPGRADE | REJECTED (false positive) | UNCERTAIN (needs runtime proof)
- **Final severity:** P0|P1|P2|P3 — one sentence why, against the brief's scale (state the precondition).
- **Evidence:** the decisive code, quoted short, with file:line (re-read it yourself; do not copy the auditor).
- **Duplicates / related:** other finding IDs that are the same root cause (search the other findings files).
- **Fix scope:** every file the minimal fix must touch; flag SHARED files (migrations, package.json,
  next.config.ts, docker-compose.yml, Dockerfile, lib/server/env.ts, lib/server/db.ts) explicitly.
- **Fix notes:** is the auditor's proposed fix correct and minimal? pitfalls, better alternative, owner decision needed?
- **Regression test:** the test that fails today and passes after the fix (file name, what it asserts, pure vs needs Postgres).
```
End with a 5-line summary: counts per verdict, and any finding that needs an OWNER DECISION.
Final message to the orchestrator: ≤150 words (path + verdict counts + upgrades/rejections one line each).
