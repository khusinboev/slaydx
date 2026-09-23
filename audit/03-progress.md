# 03 — Fix progress (finding → status → commit)

Status legend: ✅ fixed & merged · 🔄 in review · 🛠 in progress · ⏳ planned · ⏸ owner decision · ✖ won't fix

## Wave 1 — P0

| Cluster | Findings | Package | Status | Commit(s) | Review |
|---|---|---|---|---|---|
| C01 admin takeover | SECA-01, DEPS-08, ABUSE-06, TEST-12 (partial) | W1-A | ✅ merged | `44aab5b`, `94b9689` → merge `c0a3dec` | `audit/reviews/W1-A.md` (approved on re-review) |
| C02 returnTo XSS | FE-01, SECA-02 | W1-B | ✅ merged | `73433e1`, `62b086f` → merge `8da3314` | `audit/reviews/W1-B.md` (approved on re-review) |
| C03 JSONB surrogate/NUL | BEB-01, BEA-02 | W1-C | ✅ merged | `1e3e864`, `6bc1353` → merge `5b15ad3` | `audit/reviews/W1-C.md` (approved) |
| C04+C06 parsing freeze | SECB-01, SECB-02, SECB-04, SECB-05, CONC-09, FILE-02, FILE-04, TEST-11 | W1-D | 🛠 review changes (R1–R3) | `65fbd58..6536324` | `audit/reviews/W1-D.md` |
| C10 free-LLM spend | EXT-02, ABUSE-01, CONC-11 (partial), CONC-13, SCALE-14, BEA-11 (partial) | W1-E | ✅ merged | `890ce4b`, `0645c82` → merge `3368af3` | `audit/reviews/W1-E.md` (approved on re-review) |

## Wave 2 — P1

| Cluster | Findings | Package | Status | Commit(s) | Review |
|---|---|---|---|---|---|
| C07 LibreOffice fan-out | FILE-03, FILE-06, CONC-01, CONC-08, BEA-20, SCALE-04, SCALE-07 | W2-A | ✅ merged | `2245655`, `f61621a`, `0175311` → merge `59f569f` | `audit/reviews/W2-A.md` (approved on re-review; R1 template-route 503 → W2-C) |
| C08/C09/C16/C22-admission | SCALE-01, FE-05, BEA-07, DB-06, SCALE-08, BEA-06, DB-03, SCALE-03, CONC-18, SCALE-12, FE-08, FE-12, CONC-07, SCALE-05, SCALE-02 (part) | W2-B | 🛠 in progress | — | — |
| C17/C18/C19/C24 + C22 compose | INFRA-01, TEST-05, CONC-17, INFRA-04, INFRA-15, OBS-10, INFRA-06, OBS-04, OBS-12, OBS-01, FE-16, INFRA-05, INFRA-10 | W2-D1 | 🛠 in progress | — | — |
| C23 retention + queue TTL + C27 | FILE-01, DB-01, BEB-06, BEB-03, CONC-04, BEA-18, DB-10, UX-07 (server) | W2-D2 | 🛠 review changes | `d3334f3`, `b009d4e`, `68a4702` | `audit/reviews/W2-D2.md` |
| C20/C21 + UX-08 + W1-E UI | FE-02, UX-05, FE-14, FE-03, UX-08 | W2-E | 🛠 in progress | — | — |
| C11/C13/C29 + leftovers | EXT-01, DB-02, EXT-08, SCALE-10, BEA-15, ABUSE-05, SECA-03, SECB-05 (rest) | W2-C | ⏳ after W1-D | — | — |

Wave-level gates (after all W1 merges): full `npm run check`, `npm run build`, throwaway-Postgres start smoke — pending.

## Event log
- 2026-09-23 22:12 laptop reboot (scratchpad lost, all deliverables committed); ~22:35 VS Code crash (no OOM in kernel log) — agents resumed with SendMessage, no committed work lost.
