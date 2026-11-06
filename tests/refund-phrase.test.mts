import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { REFUND_PHRASE } from "../lib/refund-phrase.ts";
import { AI_OUTAGE_ERROR, GENERIC_JOB_ERROR, TIMEOUT_JOB_ERROR, VOICE_JOB_ERROR, isUserSafeText } from "../lib/server/user-error.ts";

/**
 * One refund phrase (docs/studio/P11-SPEC.md «C. Reliability»): what a failed job says about the money reads the same
 * everywhere, and it stays in the future tense, because `generations.error` is stored before the refund runs.
 *
 * Mutations (each turned the named test red, then restored):
 *   GENERIC_JOB_ERROR back to «Kredit qaytariladi»                                 -> «the shared messages»;
 *   `lib/generation/studio/mix.ts` REFUND back to «Kredit qaytariladi.»            -> «no other wording»;
 *   VIDEO_DEADLINE_MESSAGE back to «Pul qaytarildi»                                -> «no other wording»;
 *   CompareResults JSX text with «pul balansingizga qaytarildi»                    -> «no other wording».
 */

test("the shared messages carry the phrase, and the phrase passes the user-text filter", () => {
  for (const m of [GENERIC_JOB_ERROR, TIMEOUT_JOB_ERROR, AI_OUTAGE_ERROR, VOICE_JOB_ERROR]) {
    assert.ok(m.includes(REFUND_PHRASE), m);
    assert.equal(isUserSafeText(m), true, m);
  }
  assert.ok(!/qaytarildi/.test(REFUND_PHRASE), "the error row is written before the refund: never the past tense");
});

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? (name === "migrations" ? [] : sources(p)) : /\.tsx?$/.test(name) ? [p] : [];
  });
}

test("no other wording of a failed job's refund in the engine, the job layer or the Studio", () => {
  // «Pul qaytarildi» stays a ledger line (a refund that happened): the wallet, the admin and the log lines say it there.
  const failedJobText = /(?:kredit qaytar|kredit to.liq qaytar|to.lov qaytarildi|pul qaytarildi|pul qaytariladi|pul balansingizga qaytarildi)/i;
  const files = [...sources("lib/generation"), ...sources("lib/server/media"), ...sources("components/studio"), "lib/server/user-error.ts", "lib/server/video-ops.ts", "lib/server/queue-ttl.ts"];
  const hits = files.flatMap((f) =>
    readFileSync(f, "utf8")
      .split("\n")
      .filter((line) => failedJobText.test(line) && !/\blog\(|console\.|^\s*(\*|\/\/)/.test(line))
      .map((line) => `${f}: ${line.trim().slice(0, 120)}`),
  );
  assert.deepEqual(hits, []);
});
