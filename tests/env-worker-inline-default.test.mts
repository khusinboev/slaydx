import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

/*
 * CONC-17 (prod-readiness): `WORKER_INLINE` berilmasa production'da inline
 * worker YOQILMASLIGI kerak — aks holda compose override'siz ishga tushgan har
 * web nusxasi navbatni o'zi ham bajarib, web jarayonini og'ir ishga to'ldiradi.
 * Dev'da (NODE_ENV≠production) avvalgidek yoqiq qoladi.
 */
function inlineFlag(nodeEnv: string): string {
  const code = `import("./lib/server/env.ts").then(m => process.stdout.write(String(m.env.worker.inline)))`;
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: nodeEnv, SESSION_SECRET: "x".repeat(48), NEXT_PHASE: "phase-production-build" };
  delete env.WORKER_INLINE;
  return execFileSync(process.execPath, ["--import", "tsx", "--conditions=react-server", "-e", code], { env, encoding: "utf8" }).trim();
}

test("production: WORKER_INLINE berilmasa inline worker o'chiq", () => {
  assert.equal(inlineFlag("production"), "false");
});

test("development: WORKER_INLINE berilmasa inline worker yoqiq (avvalgidek)", () => {
  assert.equal(inlineFlag("development"), "true");
});
