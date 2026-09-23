# Fixer brief — Phase 4 fix waves

Every fixer agent reads this first. It is the contract; violating it fails the package.

## 1. Setup (you run in your own git worktree)
1. `git log --oneline -1` must show the commit that added this file (or later on `audit/production-readiness`).
2. Symlink shared deps once: `ln -s /home/adhambek/projects/pythons/slaydbot/slaydx/node_modules node_modules`
   and `ln -s /home/adhambek/projects/pythons/slaydbot/slaydx/.env.local .env.local` (never commit them; never `npm install`).
3. Read `CLAUDE.md` (project rules, Uzbek comments), your cluster rows in `audit/02-triage.md`, the finding
   blocks in `audit/findings/*.md` and the reviewer verdict in `audit/triage/verify-*.md` named in your assignment.

## 2. Heavy commands — ONLY through the 2-slot gate
`/tmp/claude-1000/-home-adhambek-projects-pythons-slaydbot/c9481df2-e551-4eb4-b6f4-de7690317f2f/scratchpad/heavy2.sh [-m 2G] [-t 600] <cmd>`
(run from your worktree root). It allows at most 2 heavy processes machine-wide (all agents together) and caps memory.
- Run SINGLE test files: `heavy2.sh npx tsx --env-file-if-exists=.env.local --conditions=react-server --test tests/<file>.test.mts`
  (UI: `heavy2.sh npx tsx --tsconfig tsconfig.viewer.json --test tests/ui/<file>.test.mts`).
- Never the full suite, never `next build`. One final `heavy2.sh -m 4G npx tsc --noEmit` and `npm run lint` on your changed files is allowed.
- jsdom: never `assert.equal(el, null)` / `deepEqual` on DOM nodes — use `assert.ok(!el)`.

## 3. Database tests
Use the throwaway Postgres, never the dev or prod DB: prefix the command with
`DATABASE_URL=postgres://slaydx:audit@127.0.0.1:55439/slaydx` (process env beats `.env.local`). It is already migrated.

## 4. Safety
No calls to any paid/external API (Gemini, Anthropic, Telegram, Payme…): tests stub `fetch`. Never print secrets.
Never touch `main`, never push, never rewrite history.

## 5. Quality bar
- **Regression test first:** write the test, run it against the UNFIXED code and see it fail (record the failure line),
  then fix, then see it pass.
- **Mutation check:** after the fix passes, revert the decisive line(s) of the fix, confirm the test fails, restore.
  Report "mutation X → test Y failed".
- Minimal, explicit fixes; match surrounding style; comments in Uzbek like the surrounding code; no TODOs, no silent `catch {}`;
  every new network call has a timeout; SQL stays parameterised.
- **File ownership:** edit ONLY the files listed for your package (plus new files you create and new tests). If another
  file must change, do not edit it — explain in your final report.
- Commit in your worktree branch after each logical step (message: `W1-X: <what> (<finding IDs>)`, ending with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`).

## 6. Final message (≤250 words)
Branch name; commits; each finding ID → fixed/partial/not fixed; tests added (file names) with before/after results;
mutation results; tsc/lint result; anything you could not do or that needs another package or the owner.
