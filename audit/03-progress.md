# 03 — Fix progress (finding → status → commit)

Status legend: ✅ fixed & merged · 🔄 in review · 🛠 in progress · ⏳ planned · ⏸ owner decision · ✖ won't fix

## Wave 1 — P0

| Cluster | Findings | Package | Status | Commit(s) | Review |
|---|---|---|---|---|---|
| C01 admin takeover | SECA-01, DEPS-08, ABUSE-06, TEST-12 | W1-A | 🛠 review R1 being applied | `44aab5b` | `audit/reviews/W1-A.md` (changes requested) |
| C02 returnTo XSS | FE-01, SECA-02 | W1-B | ✅ merged | `73433e1`, `62b086f` → merge `8da3314` | `audit/reviews/W1-B.md` (approved on re-review) |
| C03 JSONB surrogate/NUL | BEB-01, BEA-02 | W1-C | ✅ merged | `1e3e864`, `6bc1353` → merge `5b15ad3` | `audit/reviews/W1-C.md` (approved) |
| C04+C06 parsing freeze | SECB-01, SECB-02, SECB-04, SECB-05, CONC-09, FILE-02, FILE-04, TEST-11 | W1-D | 🛠 in progress | — | — |
| C10 free-LLM spend | EXT-02, ABUSE-01, CONC-11 (partial), CONC-13, SCALE-14, BEA-11 (partial) | W1-E | 🔄 re-review | `890ce4b`, `0645c82` | `audit/reviews/W1-E.md` |

Wave-level gates (after all W1 merges): full `npm run check`, `npm run build`, throwaway-Postgres start smoke — pending.

## Event log
- 2026-09-23 22:12 laptop reboot (scratchpad lost, all deliverables committed); ~22:35 VS Code crash (no OOM in kernel log) — agents resumed with SendMessage, no committed work lost.
