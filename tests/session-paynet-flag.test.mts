import "./helpers/next-request.mts";
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { inRequest } from "./helpers/next-request.mts";
import { createIsolatedDb } from "./helpers/isolated-db.mts";

/**
 * `GET /api/auth/session` tells the wallet whether to show the «Paynet orqali to'lash» card:
 * `features.payments.paynet` is `paynetConfigured()` (login + password + at least one serviceId) and is NOT part of
 * `paymentsConfigured()` (Paynet is paid at an agent, so PayDialog must never see it as a checkout provider).
 *
 * `env` is read once at import with all three PAYNET_* set (→ true); the partial cases blank one field of the live
 * `env.paynet` object (no password / no serviceId / no login → false) and restore it.
 *
 * Mutations (each turned the named test red, then restored):
 *   `paynet: paynetConfigured()` dropped from the session route → "payments.paynet";
 *   the flag hard-coded `true` → "payments.paynet" (partial cases);
 *   `paynet` spread into `paymentsConfigured()` → "paymentsConfigured stays click/payme".
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";
const skip = hasDb ? false : "DATABASE_URL yo'q";
const iso = hasDb ? await createIsolatedDb("sessionpaynet") : { isolated: false, drop: async () => {} };
process.env.PAYNET_USERNAME = "paynet-user";
process.env.PAYNET_PASSWORD = "paynet-pass";
process.env.PAYNET_SERVICE_IDS = "1001";

const { GET } = await import("../app/api/auth/session/route.ts");
const { env, paymentsConfigured, paynetConfigured } = await import("../lib/server/env.ts");
const { ensureMigrated, pool } = await import("../lib/server/db.ts");
if (hasDb) await ensureMigrated();

after(async () => {
  if (!hasDb) return;
  await pool().end();
  await iso.drop();
});

async function features(): Promise<{ payments: Record<string, unknown> }> {
  const req = new Request("http://localhost/api/auth/session");
  const res = await inRequest(req, () => GET(req));
  assert.equal(res.status, 200);
  return ((await res.json()) as { features: { payments: Record<string, unknown> } }).features;
}

test("session: payments.paynet is true only when login, password and a serviceId are set", { skip }, async () => {
  assert.equal(paynetConfigured(), true);
  assert.equal((await features()).payments.paynet, true, "configured");

  const saved = { ...env.paynet };
  try {
    for (const [field, blank] of [["password", ""], ["username", ""], ["serviceIds", []]] as const) {
      (env.paynet as Record<string, unknown>)[field] = blank;
      assert.equal(paynetConfigured(), false, `${field} missing`);
      assert.equal((await features()).payments.paynet, false, `partial: ${field} missing`);
      Object.assign(env.paynet, saved);
    }
  } finally {
    Object.assign(env.paynet, saved);
  }
  assert.equal((await features()).payments.paynet, true, "restored");
});

test("session: paymentsConfigured stays click/payme — Paynet is never a checkout provider", { skip }, async () => {
  assert.deepEqual(Object.keys(paymentsConfigured()).sort(), ["click", "payme"]);
  const f = await features();
  assert.deepEqual(Object.keys(f.payments).sort(), ["click", "clickDirect", "payme", "paynet", "paynetUrl"]);
});

test("session: payments.paynetUrl is the https app link only while Paynet is live; null otherwise", { skip }, async () => {
  const saved = { ...env.paynet };
  try {
    assert.equal((await features()).payments.paynetUrl, null, "no PAYNET_APP_URL → null");
    Object.assign(env.paynet, { appUrl: "https://app.paynet.test/?m=1" });
    assert.equal((await features()).payments.paynetUrl, "https://app.paynet.test/?m=1");
    Object.assign(env.paynet, { appUrl: "http://app.paynet.test/?m=1" });
    assert.equal((await features()).payments.paynetUrl, null, "plain http is never offered");
    Object.assign(env.paynet, { appUrl: "https://app.paynet.test/?m=1", password: "" });
    assert.equal((await features()).payments.paynetUrl, null, "Paynet not live → no link");
  } finally {
    Object.assign(env.paynet, saved);
  }
});
