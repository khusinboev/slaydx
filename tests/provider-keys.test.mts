import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { createIsolatedDb } from "./helpers/isolated-db.mts";

/**
 * Provider key store (program-17 decision D7): registry, sealing, resolution and the wiring into the LLM chain,
 * the image sources, TTS and the feature flags -- on a throwaway Postgres.
 *
 *   - crypto: seal/open round trip; the wrong provider id (AAD) and a modified ciphertext fail; the key comes from
 *     `PROVIDER_KEYS_KEY`, else HKDF of `ADMIN_TOTP_KEY` with a fixed context; a different context is a different key;
 *   - resolution: DB key > env; disabled hides BOTH; unknown ids are empty; the cache honours its TTL, is dropped by
 *     an invalidation, survives a failing load and backs off;
 *   - NO ROWS = BEFORE: the LLM chain, the image sources, TTS, the feature flags and `providerKeys()` answer exactly
 *     what the env-only code answered (an independent re-implementation of the old rule is the oracle);
 *   - disabled providers are skipped by the LLM chain and the image chain and hide the tools that need them;
 *   - the registry covers every key env var the generation code reads, and nothing reads such a variable directly.
 *
 * Mutation checks (each made the named test fail, then restored): see tests/provider-keys-admin.test.mts header
 * for the API ones; here
 *   - drop the AAD in `providers/crypto.ts` -> "wrong provider id" + "swapped row" tests;
 *   - ignore `enabled` in `getProviderKey` -> "disabled hides both" + the chain/image skip tests;
 *   - prefer the env key over the DB key -> "DB key wins" + the openrouter header test.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.APP_URL = "http://localhost:3000";
process.env.WORKER_INLINE = "false";
const ADMIN_KEY = randomBytes(32).toString("base64");
process.env.ADMIN_TOTP_KEY = ADMIN_KEY;
delete process.env.PROVIDER_KEYS_KEY;

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";
const skip = hasDb ? false : "DATABASE_URL yo'q";
const iso = hasDb ? await createIsolatedDb("provkeys") : { isolated: false, drop: async () => {} };

const { query, ensureMigrated, pool } = await import("../lib/server/db.ts");
const crypto = await import("../lib/server/providers/crypto.ts");
const adminCrypto = await import("../lib/server/admin-crypto.ts");
const resolve = await import("../lib/server/providers/resolve.ts");
const store = await import("../lib/server/providers/store.ts");
const registry = await import("../lib/server/providers/registry.ts");
const serverEnv = await import("../lib/server/env.ts");
const adminAi = await import("../lib/server/admin-ai.ts");
const { completeWithChain } = await import("../lib/generation/llm/chain.ts");
const { parseRoleSpec } = await import("../lib/generation/llm/types.ts");
const { llmProvider, llmEnabled } = await import("../lib/generation/llm.ts");
const { makeOpenrouterAdapter } = await import("../lib/generation/llm/openrouter.ts");
const { makeAnthropicAdapter } = await import("../lib/generation/llm/anthropic.ts");
const openalex = await import("../lib/generation/research/openalex.ts");
const googlebooks = await import("../lib/generation/research/googlebooks.ts");
const { chainProvider, pickProvider } = await import("../lib/generation/image-provider.ts");
const { pexelsProvider } = await import("../lib/generation/image-provider-pexels.ts");
const { pixabayProvider } = await import("../lib/generation/image-provider-pixabay.ts");
const { falProvider } = await import("../lib/generation/image-provider-fal.ts");
const { geminiProvider } = await import("../lib/generation/image-provider-gemini.ts");
const ttsGemini = await import("../lib/generation/tts/gemini.ts");
const ttsAzure = await import("../lib/generation/tts/azure.ts");
const ttsAisha = await import("../lib/generation/tts/aisha.ts");
const { toolBlockedReason, TOOL_BY_ID } = await import("../lib/tools.ts");
const { resetBreakers } = await import("../lib/generation/llm/breaker.ts");

const ROOT = path.resolve(import.meta.dirname, "..");

if (hasDb) await ensureMigrated();

after(async () => {
  if (!hasDb) return;
  store.stopProviderKeyRefresh();
  await pool().end();
  await iso.drop();
});

const ALL_ENV = [...new Set(registry.PROVIDERS.flatMap((p) => [...p.envKeys]))];
const TTS_BACKUP = { azureRegion: serverEnv.env.tts.azureRegion, geminiModel: serverEnv.env.tts.geminiModel };
const ENV_BACKUP: Record<string, string | undefined> = {};
for (const k of [...ALL_ENV, "AZURE_SPEECH_REGION", "TTS_GEMINI_MODEL", "PROVIDER_KEYS_KEY", "ADMIN_TOTP_KEY", "LLM_WRITER"]) ENV_BACKUP[k] = process.env[k];

beforeEach(() => {
  for (const k of ALL_ENV) delete process.env[k];
  delete process.env.AZURE_SPEECH_REGION;
  delete process.env.TTS_GEMINI_MODEL;
  delete process.env.PROVIDER_KEYS_KEY;
  process.env.ADMIN_TOTP_KEY = ADMIN_KEY;
  resolve.registerProviderSource(null);
  resolve.resetProviderCache();
  resetBreakers();
});

const snap = (rows: Record<string, { enabled?: boolean; key?: string | null; unreadable?: boolean }>) =>
  new Map(Object.entries(rows).map(([id, r]) => [id, { enabled: r.enabled ?? true, key: r.key ?? null, unreadable: r.unreadable ?? false }]));

// ───────────────────────────── registry

test("registry: unique ids, Uzbek labels, kinds, env names; reserved providers are not implemented", () => {
  const ids = registry.PROVIDERS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(
    [...ids].sort(),
    ["anthropic", "aisha", "azure", "elevenlabs", "fal", "gemini", "googlebooks", "kling", "openai", "openai-image", "openalex", "openrouter", "pexels", "pixabay", "veo", "xai"].sort(),
  );
  for (const p of registry.PROVIDERS) {
    assert.ok(p.label.trim() && p.kinds.length > 0 && p.envKeys.length > 0 && p.keyHint.trim(), p.id);
    assert.ok(p.envKeys.every((e) => /^[A-Z0-9_]+$/.test(e)), p.id);
    assert.ok(p.id.length <= 40, "the table CHECK allows 40 characters");
  }
  for (const id of ["openai-image", "veo", "kling", "elevenlabs"]) {
    const def = registry.providerDef(id)!;
    assert.equal(def.implemented, false, `${id}: reserved`);
    assert.equal(def.testable, false);
  }
  assert.deepEqual(registry.providerDef("veo")!.envKeys, ["GEMINI_API_KEY"], "Veo uses the Gemini key");
  assert.equal(registry.providerDef("nope"), null);
  assert.equal(registry.providerDef("__proto__"), null);
  assert.equal(registry.isProviderId("constructor"), false);
});

test("registry: every LLM adapter id exists with kind llm; non-LLM ids are not valid LLM role specs", () => {
  for (const id of ["gemini", "anthropic", "openrouter", "xai", "openai"]) {
    assert.ok(registry.providerDef(id)?.kinds.includes("llm" as never), id);
    assert.equal(parseRoleSpec(`${id}:m`).length, 1, id);
  }
  for (const id of ["fal", "pexels", "azure", "kling"]) assert.deepEqual(parseRoleSpec(`${id}:m`), [], id);
});

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

test("registry covers every provider key env var the generation code reads, and nothing reads one directly", () => {
  const known = new Set<string>(ALL_ENV);
  // Not provider keys: sealing/signing keys and payment secrets live elsewhere.
  const NOT_PROVIDER = new Set(["ADMIN_TOTP_KEY", "PROVIDER_KEYS_KEY", "PAYME_KEY", "PAYME_TEST_KEY", "CLICK_SECRET_KEY", "CRON_SECRET", "TELEGRAM_WEBHOOK_SECRET", "SESSION_SECRET"]);
  const files = [...walk(path.join(ROOT, "lib/generation")), ...walk(path.join(ROOT, "lib/server"))];
  const unknown: string[] = [];
  const direct: string[] = [];
  const ALLOWED_DIRECT = new Set(["lib/server/providers/resolve.ts", "lib/server/admin-providers.ts", "lib/server/providers/probe.ts", "lib/server/env.ts"]);
  for (const f of files) {
    const rel = path.relative(ROOT, f).split(path.sep).join("/");
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/process\.env\.([A-Z][A-Z0-9_]*(?:API_KEY|_KEY))\b/g)) {
      const name = m[1]!;
      if (NOT_PROVIDER.has(name)) continue;
      if (!known.has(name)) unknown.push(`${rel}: ${name}`);
      else if (!ALLOWED_DIRECT.has(rel)) direct.push(`${rel}: ${name}`);
    }
    // `env.<group>.key` style reads of the boot-time snapshot would bypass the resolver as well.
    if (!ALLOWED_DIRECT.has(rel) && /\benv\.(gemini|xai|fal)\.key\b/.test(src)) direct.push(`${rel}: env.<provider>.key`);
  }
  assert.deepEqual(unknown, [], "a key env var the registry does not know");
  assert.deepEqual(direct, [], "a provider key read that bypasses the resolver");
});

// ───────────────────────────── crypto

const PLAIN = "Zq7Kp9Xw3Lm5Rt8Vb2NcAA11";

test("crypto: seal/open round trip; the stored bytes are versioned ASCII and hold no plaintext", () => {
  const blob = crypto.sealProviderKey("gemini", PLAIN);
  assert.ok(Buffer.isBuffer(blob));
  assert.ok(blob.toString("ascii").startsWith("pk1."), "versioned format");
  assert.ok(!blob.toString("latin1").includes(PLAIN) && !blob.toString("base64").includes(PLAIN));
  assert.equal(crypto.openProviderKey("gemini", blob), PLAIN);
  // Random IV: sealing twice gives different bytes, both open.
  const again = crypto.sealProviderKey("gemini", PLAIN);
  assert.notDeepEqual(again, blob);
  assert.equal(crypto.openProviderKey("gemini", again), PLAIN);
  assert.equal(crypto.providerCryptoAvailable(), true);
});

test("crypto: the provider id is bound as AAD -- a ciphertext of another provider does not open", () => {
  const blob = crypto.sealProviderKey("gemini", PLAIN);
  assert.throws(() => crypto.openProviderKey("anthropic", blob), (e: { code?: string }) => e.code === "tampered");
  assert.throws(() => crypto.openProviderKey("Gemini", blob), (e: { code?: string }) => e.code === "tampered", "case matters");
  assert.throws(() => crypto.openProviderKey("", blob), (e: { code?: string }) => e.code === "tampered");
});

test("crypto: a modified ciphertext, a wrong version and garbage are errors, never a different value", () => {
  const blob = crypto.sealProviderKey("fal", PLAIN);
  const text = blob.toString("ascii");
  // Flip one base64url character in the middle (the tag and the ciphertext are both covered by GCM).
  const i = Math.floor((text.length + 4) / 2);
  const flipped = text.slice(0, i) + (text[i] === "A" ? "B" : "A") + text.slice(i + 1);
  assert.throws(() => crypto.openProviderKey("fal", Buffer.from(flipped, "ascii")), (e: { code?: string }) => e.code === "tampered");
  assert.throws(() => crypto.openProviderKey("fal", Buffer.from(text.replace("pk1.", "pk2."), "ascii")), (e: { code?: string }) => e.code === "bad_version");
  assert.throws(() => crypto.openProviderKey("fal", Buffer.from("v1." + text.slice(4), "ascii")), (e: { code?: string }) => e.code === "bad_version", "an admin-seal prefix is not accepted");
  assert.throws(() => crypto.openProviderKey("fal", Buffer.from("pk1.!!!", "ascii")), (e: { code?: string }) => e.code === "bad_format");
  assert.throws(() => crypto.openProviderKey("fal", Buffer.from("pk1.AAAA", "ascii")), (e: { code?: string }) => e.code === "bad_format");
  assert.throws(() => crypto.openProviderKey("fal", Buffer.alloc(0)));
});

test("crypto: without PROVIDER_KEYS_KEY the key is HKDF(ADMIN_TOTP_KEY, context); with it, HKDF of that master", () => {
  const sealedFallback = crypto.sealProviderKey("gemini", PLAIN);
  // The same master supplied as PROVIDER_KEYS_KEY derives the same sealing key.
  process.env.PROVIDER_KEYS_KEY = ADMIN_KEY;
  assert.equal(crypto.openProviderKey("gemini", sealedFallback), PLAIN, "same master, same derived key");
  // A different PROVIDER_KEYS_KEY: the old ciphertext no longer opens (and ADMIN_TOTP_KEY is not consulted any more).
  process.env.PROVIDER_KEYS_KEY = randomBytes(32).toString("base64");
  assert.throws(() => crypto.openProviderKey("gemini", sealedFallback), (e: { code?: string }) => e.code === "tampered");
  const sealedOwn = crypto.sealProviderKey("gemini", PLAIN);
  assert.equal(crypto.openProviderKey("gemini", sealedOwn), PLAIN);
  // Back to the fallback: the key sealed under PROVIDER_KEYS_KEY is unreadable.
  delete process.env.PROVIDER_KEYS_KEY;
  assert.throws(() => crypto.openProviderKey("gemini", sealedOwn), (e: { code?: string }) => e.code === "tampered");
});

test("crypto: the context string is part of the key; the derived key differs from the master and from admin-crypto's keys", () => {
  const master = Buffer.from(ADMIN_KEY, "base64");
  const a = crypto.deriveProviderSealKey(master);
  assert.equal(a.length, 32);
  assert.ok(!a.equals(master), "never the master itself");
  assert.deepEqual(a, crypto.deriveProviderSealKey(master, crypto.PROVIDER_KEYS_CONTEXT), "deterministic");
  assert.equal(crypto.PROVIDER_KEYS_CONTEXT, "slaydx/provider-keys/v1");
  assert.ok(!a.equals(crypto.deriveProviderSealKey(master, "slaydx/provider-keys/v2")), "another context, another key");
  assert.ok(!a.equals(crypto.deriveProviderSealKey(master, "slaydx:admin-totp-seal")));
  assert.ok(!a.equals(crypto.deriveProviderSealKey(randomBytes(32))), "another master, another key");
  // A TOTP secret sealed by admin-crypto cannot be opened as a provider key and vice versa.
  const totp = adminCrypto.seal("JBSWY3DPEHPK3PXP", "gemini");
  assert.throws(() => crypto.openProviderKey("gemini", Buffer.from(totp, "ascii")), (e: { code?: string }) => e.code === "bad_version");
  assert.throws(() => adminCrypto.open(crypto.sealProviderKey("gemini", PLAIN).toString("ascii"), "gemini"), (e: { code?: string }) => e.code === "bad_version");
});

test("crypto: no usable master key is a typed error, a malformed PROVIDER_KEYS_KEY never falls back silently", () => {
  delete process.env.ADMIN_TOTP_KEY;
  assert.equal(crypto.providerCryptoAvailable(), false);
  assert.throws(() => crypto.sealProviderKey("gemini", PLAIN), (e: { code?: string }) => e.code === "key_missing");
  process.env.PROVIDER_KEYS_KEY = "not-base64-32-bytes";
  process.env.ADMIN_TOTP_KEY = ADMIN_KEY;
  assert.equal(crypto.providerCryptoAvailable(), false, "ADMIN_TOTP_KEY is valid but PROVIDER_KEYS_KEY is set and wrong");
  assert.throws(() => crypto.sealProviderKey("gemini", PLAIN), (e: { code?: string }) => e.code === "key_invalid");
  process.env.PROVIDER_KEYS_KEY = randomBytes(16).toString("base64");
  assert.throws(() => crypto.sealProviderKey("gemini", PLAIN), (e: { code?: string }) => e.code === "key_invalid", "16 bytes is too short");
});

// ───────────────────────────── resolver

test("resolver: no snapshot = the env var; trimmed; blank is none; unknown ids are empty", () => {
  assert.equal(resolve.getProviderKey("gemini"), "");
  process.env.GEMINI_API_KEY = "  env-gemini-1234  ";
  assert.equal(resolve.getProviderKey("gemini"), "env-gemini-1234");
  process.env.GEMINI_API_KEY = "   ";
  assert.equal(resolve.getProviderKey("gemini"), "");
  assert.equal(resolve.getProviderKey("nope"), "");
  assert.equal(resolve.getProviderKey("__proto__"), "");
  assert.equal(resolve.isProviderEnabled("gemini"), true);
  assert.equal(resolve.isProviderEnabled("nope"), true, "no row = enabled");
  // Veo and OpenAI images share the env var of their sibling.
  process.env.GEMINI_API_KEY = "env-gemini-1234";
  process.env.OPENAI_API_KEY = "env-openai-1234";
  assert.equal(resolve.getProviderKey("veo"), "env-gemini-1234");
  assert.equal(resolve.getProviderKey("openai-image"), "env-openai-1234");
});

test("resolver: the DB key wins over the env var; without a DB key the env var applies", () => {
  process.env.FAL_KEY = "env-fal-key-1";
  process.env.PEXELS_API_KEY = "env-pexels-1";
  resolve.setProviderSnapshot(snap({ fal: { key: "db-fal-key-1" }, pexels: { key: null } }));
  assert.equal(resolve.getProviderKey("fal"), "db-fal-key-1");
  assert.equal(resolve.keySourceOf("fal"), "db");
  assert.equal(resolve.getProviderKey("pexels"), "env-pexels-1", "a row without a key falls back");
  assert.equal(resolve.keySourceOf("pexels"), "env");
  // A key stored for a provider with no env var at all works as well.
  resolve.setProviderSnapshot(snap({ anthropic: { key: "db-anthropic-1" } }));
  assert.equal(resolve.getProviderKey("anthropic"), "db-anthropic-1");
  // A key that cannot be decrypted is ignored.
  resolve.setProviderSnapshot(snap({ fal: { key: null, unreadable: true } }));
  assert.equal(resolve.getProviderKey("fal"), "env-fal-key-1");
});

test("resolver: a disabled provider hides BOTH the DB key and the env var", () => {
  process.env.GEMINI_API_KEY = "env-gemini-1234";
  resolve.setProviderSnapshot(snap({ gemini: { enabled: false, key: "db-gemini-1234" } }));
  assert.equal(resolve.isProviderEnabled("gemini"), false);
  assert.equal(resolve.getProviderKey("gemini"), "");
  assert.equal(resolve.keySourceOf("gemini"), "none");
  assert.equal(resolve.hasEnvKey("gemini"), true, "the env var is still there, only unavailable");
  resolve.setProviderSnapshot(snap({ gemini: { enabled: false, key: null } }));
  assert.equal(resolve.getProviderKey("gemini"), "");
  // Re-enabled: back to the DB key / env var.
  resolve.setProviderSnapshot(snap({ gemini: { enabled: true, key: null } }));
  assert.equal(resolve.getProviderKey("gemini"), "env-gemini-1234");
  // Disabling one provider leaves the others alone.
  process.env.XAI_API_KEY = "env-xai-1234";
  resolve.setProviderSnapshot(snap({ gemini: { enabled: false } }));
  assert.equal(resolve.getProviderKey("xai"), "env-xai-1234");
});

test("cache: loads once per TTL, an invalidation forces a reload, a failing load keeps the last snapshot and backs off", async () => {
  let loads = 0;
  let fail = false;
  let rows = snap({ fal: { key: "v1-fal-key-1" } });
  resolve.registerProviderSource(async () => {
    loads++;
    if (fail) throw new Error("db down");
    return rows;
  });
  const T0 = 1_000_000;
  await resolve.primeProviderKeys({ now: T0 });
  assert.equal(loads, 1);
  assert.equal(resolve.getProviderKey("fal"), "v1-fal-key-1");

  rows = snap({ fal: { key: "v2-fal-key-2" } });
  await resolve.primeProviderKeys({ now: T0 + resolve.PROVIDER_CACHE_TTL_MS - 1 });
  assert.equal(loads, 1, "fresh: no reload");
  assert.equal(resolve.getProviderKey("fal"), "v1-fal-key-1", "the change is not visible inside the TTL");
  await resolve.primeProviderKeys({ now: T0 + resolve.PROVIDER_CACHE_TTL_MS });
  assert.equal(loads, 2, "TTL over: reload");
  assert.equal(resolve.getProviderKey("fal"), "v2-fal-key-2");
  assert.equal(resolve.PROVIDER_CACHE_TTL_MS, 30_000);

  // This process's own write: invalidation, then the very next prime reloads even inside the TTL.
  rows = snap({ fal: { key: "v3-fal-key-3" } });
  resolve.invalidateProviderCache();
  await resolve.primeProviderKeys({ now: T0 + resolve.PROVIDER_CACHE_TTL_MS + 1 });
  assert.equal(loads, 3);
  assert.equal(resolve.getProviderKey("fal"), "v3-fal-key-3");

  // A failing load keeps the last good snapshot, does not throw, and does not hammer the database.
  fail = true;
  const T1 = T0 + 10 * resolve.PROVIDER_CACHE_TTL_MS;
  await resolve.primeProviderKeys({ now: T1 });
  assert.equal(loads, 4);
  assert.equal(resolve.getProviderKey("fal"), "v3-fal-key-3");
  await resolve.primeProviderKeys({ now: T1 + 1_000 });
  assert.equal(loads, 4, "backing off after a failure");
  await resolve.primeProviderKeys({ now: T1 + 1_000, force: true });
  assert.equal(loads, 5, "force ignores the back-off");
  fail = false;
  await resolve.primeProviderKeys({ now: T1 + 6_000 });
  assert.equal(loads, 6);
  assert.equal(resolve.providerCacheAgeMs(T1 + 6_000), 0);
});

test("cache: concurrent primes share one load; a load racing an invalidation is discarded", async () => {
  let loads = 0;
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  resolve.registerProviderSource(async () => {
    loads++;
    await gate;
    return snap({ fal: { key: "racing-fal-key" } });
  });
  const a = resolve.primeProviderKeys({ now: 5 });
  const b = resolve.primeProviderKeys({ now: 5 });
  resolve.invalidateProviderCache(); // a write committed while the load was running
  release();
  await Promise.all([a, b]);
  assert.equal(loads, 1);
  assert.equal(resolve.providerCacheAgeMs(5), Number.POSITIVE_INFINITY, "the stale load did not mark the cache fresh");
});

test("resolver: a synchronous throw in the source is contained", async () => {
  resolve.registerProviderSource(() => {
    throw new Error("boom");
  });
  await assert.doesNotReject(resolve.primeProviderKeys({ now: 1 }));
  assert.equal(resolve.getProviderKey("gemini"), "");
});

// ───────────────────────────── store (real database)

test("store: rows are decrypted into the snapshot; unreadable and unknown rows are contained", { skip }, async () => {
  await query("DELETE FROM provider_settings");
  const sealed = crypto.sealProviderKey("fal", PLAIN);
  await query("INSERT INTO provider_settings (provider, enabled, key_ciphertext, key_hint) VALUES ('fal', true, $1, '…AA11')", [sealed]);
  // A ciphertext copied from the fal row onto the pexels row (AAD mismatch): unreadable, not decrypted as fal's key.
  await query("INSERT INTO provider_settings (provider, enabled, key_ciphertext, key_hint) VALUES ('pexels', true, $1, '…AA11')", [sealed]);
  await query("INSERT INTO provider_settings (provider, enabled) VALUES ('gemini', false)");
  await query("INSERT INTO provider_settings (provider, enabled) VALUES ('retired-provider', false)");
  const s = await store.loadProviderSnapshot();
  assert.deepEqual([...s.keys()].sort(), ["fal", "gemini", "pexels"], "a row of a provider the registry does not know is ignored");
  assert.deepEqual(s.get("fal"), { enabled: true, key: PLAIN, unreadable: false });
  assert.deepEqual(s.get("pexels"), { enabled: true, key: null, unreadable: true }, "swapped row does not open");
  assert.deepEqual(s.get("gemini"), { enabled: false, key: null, unreadable: false });

  process.env.PEXELS_API_KEY = "env-pexels-1";
  resolve.setProviderSnapshot(s);
  assert.equal(resolve.getProviderKey("fal"), PLAIN);
  assert.equal(resolve.getProviderKey("pexels"), "env-pexels-1", "unreadable falls back to the env var");
  await query("DELETE FROM provider_settings");
});

test("store: the table enforces key/hint pairing and the id length", { skip }, async () => {
  await query("DELETE FROM provider_settings");
  await assert.rejects(query("INSERT INTO provider_settings (provider, key_ciphertext) VALUES ('fal', $1)", [Buffer.from("x")]), /provider_settings_key_pair/);
  await assert.rejects(query("INSERT INTO provider_settings (provider, key_hint) VALUES ('fal', '…abcd')"), /provider_settings_key_pair/);
  await assert.rejects(query("INSERT INTO provider_settings (provider) VALUES ($1)", ["x".repeat(41)]));
});

test("store: another process sees a change only after the TTL (the documented propagation)", { skip }, async () => {
  await query("DELETE FROM provider_settings");
  resolve.registerProviderSource(store.loadProviderSnapshot);
  const T0 = 9_000_000;
  await resolve.primeProviderKeys({ now: T0, force: true });
  assert.equal(resolve.isProviderEnabled("xai"), true);
  // "The other process" (web) switches xai off.
  await query("INSERT INTO provider_settings (provider, enabled) VALUES ('xai', false)");
  await resolve.primeProviderKeys({ now: T0 + 29_000 });
  assert.equal(resolve.isProviderEnabled("xai"), true, "still the old snapshot inside the TTL");
  await resolve.primeProviderKeys({ now: T0 + 30_000 });
  assert.equal(resolve.isProviderEnabled("xai"), false, "visible after the TTL");
  await query("DELETE FROM provider_settings");
});

test("store: the refresh timer is unref'd, single, and stoppable", { skip }, async () => {
  resolve.registerProviderSource(store.loadProviderSnapshot);
  await store.startProviderKeyRefresh(60_000);
  const t1 = (globalThis as { __slaydxProviderRefresh?: { hasRef: () => boolean } }).__slaydxProviderRefresh;
  assert.ok(t1, "timer installed");
  assert.equal(t1.hasRef(), false, "unref'd: never keeps the process alive");
  await store.startProviderKeyRefresh(60_000);
  assert.equal((globalThis as { __slaydxProviderRefresh?: unknown }).__slaydxProviderRefresh, t1, "a second start is a no-op");
  store.stopProviderKeyRefresh();
  assert.equal((globalThis as { __slaydxProviderRefresh?: unknown }).__slaydxProviderRefresh, undefined);
});

// ───────────────────────────── NO ROWS = BEFORE (the old env-only rules are the oracle)

/** The pre-store rule for a key: the raw env var, trimmed. */
const oldKey = (name: string): string => (process.env[name] ?? "").trim();

function setEnv(vars: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

type FakeCall = { provider: string };

function fakeAdapters(calls: FakeCall[]) {
  const mk = (id: string) => ({
    id,
    async complete() {
      calls.push({ provider: id });
      return { ok: true as const, text: "ok", usage: { inputTokens: 1, outputTokens: 1 } };
    },
  });
  return { gemini: mk("gemini"), anthropic: mk("anthropic"), openrouter: mk("openrouter"), xai: mk("xai"), openai: mk("openai") } as never;
}

const LLM_ENV: Record<string, string> = {
  gemini: "GEMINI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  xai: "XAI_API_KEY",
  openai: "OPENAI_API_KEY",
};
const ORDER = ["anthropic", "gemini", "openrouter", "xai", "openai"] as const;
const SPECS = ORDER.map((provider) => ({ provider, model: "m" }));

async function runChain(): Promise<{ called: string[]; used: string | null; log: string[] }> {
  const calls: FakeCall[] = [];
  const log: string[] = [];
  const res = await completeWithChain("writer", SPECS, "s", "u", { maxTokens: 10, timeoutMs: 5_000 }, { adapters: fakeAdapters(calls), log: (l) => log.push(l) });
  return { called: calls.map((c) => c.provider), used: res?.usage.provider ?? null, log };
}

test("NO ROWS = before: the LLM chain picks what the env-only rule picks, over every combination of keys", async () => {
  const providers = Object.keys(LLM_ENV);
  for (let mask = 0; mask < 1 << providers.length; mask++) {
    resetBreakers();
    const vars: Record<string, string | undefined> = {};
    providers.forEach((p, i) => {
      // Alternate between a real value and a blank one: blank = no key, as before.
      vars[LLM_ENV[p]!] = mask & (1 << i) ? `env-${p}-key-1` : i % 2 ? "   " : undefined;
    });
    setEnv(vars);
    const expected = ORDER.find((p) => oldKey(LLM_ENV[p]!) !== "") ?? null;
    const { called, used } = await runChain();
    assert.equal(used, expected, `mask ${mask}`);
    assert.deepEqual(called, expected ? [expected] : [], `mask ${mask}`);
    // Defaults of llm.ts: Gemini first, then xAI, else none.
    assert.equal(llmProvider(), oldKey("GEMINI_API_KEY") ? "gemini" : oldKey("XAI_API_KEY") ? "xai" : null, `llmProvider ${mask}`);
    assert.equal(llmEnabled(), llmProvider() !== null);
    assert.equal(serverEnv.llmConfigured(), Boolean(oldKey("GEMINI_API_KEY") || oldKey("XAI_API_KEY")), `llmConfigured ${mask}`);
    assert.equal(adminAi.providerKeys().anthropic, oldKey("ANTHROPIC_API_KEY") !== "", `providerKeys ${mask}`);
    assert.equal(adminAi.providerKeys().openai, oldKey("OPENAI_API_KEY") !== "");
    assert.equal(adminAi.providerKeys().openrouter, oldKey("OPENROUTER_API_KEY") !== "");
    assert.equal(adminAi.providerKeys().xai, oldKey("XAI_API_KEY") !== "");
    assert.equal(adminAi.providerKeys().gemini, oldKey("GEMINI_API_KEY") !== "");
  }
});

test("NO ROWS = before: image sources, TTS providers, feature flags and key presence follow the env exactly", () => {
  const combos: Record<string, string | undefined>[] = [
    {},
    { GEMINI_API_KEY: "env-gemini-1234" },
    { GEMINI_API_KEY: "env-gemini-1234", TTS_GEMINI_MODEL: "tts-model" },
    { PEXELS_API_KEY: "env-pexels-1", PIXABAY_API_KEY: "env-pixabay-1" },
    { FAL_KEY: "env-fal-key-1" },
    { FAL_KEY: "  ", PEXELS_API_KEY: "\t" },
    { AZURE_SPEECH_KEY: "env-azure-1234" },
    { AZURE_SPEECH_KEY: "env-azure-1234", AZURE_SPEECH_REGION: "westeurope" },
    { AISHA_API_KEY: "env-aisha-1234" },
    { GEMINI_API_KEY: "env-gemini-1234", XAI_API_KEY: "env-xai-1234", FAL_KEY: "env-fal-key-1", PEXELS_API_KEY: "env-pexels-1", PIXABAY_API_KEY: "env-pixabay-1", AZURE_SPEECH_KEY: "env-azure-1234", AZURE_SPEECH_REGION: "westeurope", AISHA_API_KEY: "env-aisha-1234", TTS_GEMINI_MODEL: "tts-model" },
  ];
  for (const vars of combos) {
    for (const k of [...ALL_ENV, "AZURE_SPEECH_REGION", "TTS_GEMINI_MODEL"]) delete process.env[k];
    setEnv(vars);
    const where = JSON.stringify(Object.keys(vars));
    // Image sources.
    assert.equal(pexelsProvider.hasKey(), oldKey("PEXELS_API_KEY") !== "", where);
    assert.equal(pixabayProvider.hasKey(), oldKey("PIXABAY_API_KEY") !== "", where);
    assert.equal(falProvider.hasKey(), oldKey("FAL_KEY") !== "", where);
    assert.equal(geminiProvider.hasKey(), oldKey("GEMINI_API_KEY") !== "", where);
    assert.equal(chainProvider([pexelsProvider, pixabayProvider, falProvider]).hasKey(), Boolean(oldKey("PEXELS_API_KEY") || oldKey("PIXABAY_API_KEY") || oldKey("FAL_KEY")), where);
    assert.equal(pickProvider({ toolId: "pro-slide" }).hasKey(), oldKey("GEMINI_API_KEY") !== "", where);
    assert.equal(pickProvider({ toolId: "slide" }).hasKey(), Boolean(oldKey("PEXELS_API_KEY") || oldKey("PIXABAY_API_KEY")), where);
    // TTS.
    const geminiTtsOn = oldKey("GEMINI_API_KEY") !== "" && oldKey("TTS_GEMINI_MODEL") !== "";
    const azureOn = oldKey("AZURE_SPEECH_KEY") !== "" && oldKey("AZURE_SPEECH_REGION") !== "";
    const aishaOn = oldKey("AISHA_API_KEY") !== "";
    assert.equal(ttsGemini.makeGeminiTts().configured(), geminiTtsOn, where);
    assert.equal(ttsAzure.makeAzureTts().configured(), azureOn, where);
    assert.equal(ttsAisha.makeAishaTts().configured(), aishaOn, where);
    // `env.tts.*` is the boot-time snapshot of the non-secret TTS settings: align it with this combination.
    Object.assign(serverEnv.env.tts, { azureRegion: oldKey("AZURE_SPEECH_REGION"), geminiModel: oldKey("TTS_GEMINI_MODEL") });
    assert.equal(serverEnv.ttsConfigured(), geminiTtsOn || azureOn || aishaOn, where);
    // The legacy accessors.
    assert.equal(ttsGemini.geminiKey(), oldKey("GEMINI_API_KEY"), where);
    assert.equal(ttsAzure.azureKey(), oldKey("AZURE_SPEECH_KEY"), where);
    assert.equal(ttsAisha.aishaKey(), oldKey("AISHA_API_KEY"), where);
    // Feature flags: nothing is ever blocked for TTS merely because a key is missing.
    assert.equal(serverEnv.ttsFeature(), true, where);
    assert.equal(serverEnv.imagesConfigured(), oldKey("GEMINI_API_KEY") !== "", where);
    const features = { llm: serverEnv.llmConfigured(), images: serverEnv.imagesConfigured(), tts: serverEnv.ttsFeature() };
    assert.equal(toolBlockedReason(TOOL_BY_ID.podcast, features), serverEnv.llmConfigured() ? null : toolBlockedReason(TOOL_BY_ID.podcast, { llm: false, images: false }), where);
    // admin-ai key presence.
    const k = adminAi.providerKeys();
    assert.deepEqual(
      [k.fal, k.pexels, k.pixabay, k.azureTts, k.aisha],
      [oldKey("FAL_KEY") !== "", oldKey("PEXELS_API_KEY") !== "", oldKey("PIXABAY_API_KEY") !== "", azureOn, aishaOn],
      where,
    );
  }
});

// ───────────────────────────── disabled / DB key wiring

test("a disabled LLM provider is skipped and the chain falls through to the next", async () => {
  setEnv({ GEMINI_API_KEY: "env-gemini-1234", ANTHROPIC_API_KEY: "env-anthropic-1", XAI_API_KEY: "env-xai-1234" });
  assert.equal((await runChain()).used, "anthropic", "baseline: first key wins");
  resolve.setProviderSnapshot(snap({ anthropic: { enabled: false } }));
  resetBreakers();
  const r = await runChain();
  assert.equal(r.used, "gemini");
  assert.deepEqual(r.called, ["gemini"], "the disabled provider's adapter is never called");
  assert.ok(r.log.some((l) => l.includes("anthropic:m") && l.includes("kalit yo'q")), "reported as no key");
  // Disable the next two as well: the last enabled provider answers; with all off nothing is called.
  resolve.setProviderSnapshot(snap({ anthropic: { enabled: false }, gemini: { enabled: false } }));
  resetBreakers();
  assert.equal((await runChain()).used, "xai");
  resolve.setProviderSnapshot(snap({ anthropic: { enabled: false }, gemini: { enabled: false }, xai: { enabled: false } }));
  resetBreakers();
  const none = await runChain();
  assert.equal(none.used, null);
  assert.deepEqual(none.called, []);
  // Disabled means unavailable even for the default (non-chain) path.
  assert.equal(llmProvider(), null);
  assert.equal(serverEnv.llmConfigured(), false);
  assert.equal(toolBlockedReason(TOOL_BY_ID.slide, { llm: serverEnv.llmConfigured(), images: true }), "AI xizmati vaqtincha o‘chiq: serverda matn kaliti sozlanmagan.");
});

test("a key stored in the DB is used by the adapter, and wins over the env var", async () => {
  setEnv({ OPENROUTER_API_KEY: "env-openrouter-key-1" });
  const seen: string[] = [];
  const fetchImpl = (async (_url: string, init: { headers: Record<string, string> }) => {
    seen.push(init.headers.Authorization!);
    return new Response(JSON.stringify({ choices: [{ message: { content: "hi" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200 });
  }) as unknown as typeof fetch;
  const adapter = makeOpenrouterAdapter({ fetchImpl });
  const opts = { maxTokens: 10, timeoutMs: 5_000 };
  assert.equal((await adapter.complete("m", "s", "u", opts)).ok, true);
  resolve.setProviderSnapshot(snap({ openrouter: { key: "db-openrouter-key-1" } }));
  assert.equal((await adapter.complete("m", "s", "u", opts)).ok, true);
  resolve.setProviderSnapshot(snap({ openrouter: { key: "db-openrouter-key-1", enabled: false } }));
  const off = await adapter.complete("m", "s", "u", opts);
  assert.equal(off.ok, false, "disabled: the adapter has no key");
  assert.deepEqual(seen, ["Bearer env-openrouter-key-1", "Bearer db-openrouter-key-1"]);
});

test("a disabled image source is skipped; the chain falls through to the next one", async () => {
  setEnv({ PEXELS_API_KEY: "env-pexels-1", PIXABAY_API_KEY: "env-pixabay-1", FAL_KEY: "env-fal-key-1" });
  const urls: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    if (url.includes("pexels")) return new Response(JSON.stringify({ photos: [{ src: { large2x: "https://images.pexels.com/a.jpg" } }] }), { status: 200 });
    if (url.includes("pixabay")) return new Response(JSON.stringify({ hits: [{ largeImageURL: "https://pixabay.com/b.jpg" }] }), { status: 200 });
    return new Response("{}", { status: 500 });
  }) as typeof fetch;
  const ask = { prompt: "p", size: { width: 1024, height: 768 }, styleId: "photo" as never, searchQuery: "nature" };
  try {
    const first = await chainProvider([pexelsProvider, pixabayProvider, falProvider]).fetchImage(ask);
    assert.equal(first.ok && first.image.url, "https://images.pexels.com/a.jpg", "baseline: Pexels first");
    urls.length = 0;
    resolve.setProviderSnapshot(snap({ pexels: { enabled: false } }));
    const chain = chainProvider([pexelsProvider, pixabayProvider, falProvider]);
    assert.equal(chain.hasKey(), true);
    const second = await chain.fetchImage(ask);
    assert.equal(second.ok && second.image.url, "https://pixabay.com/b.jpg");
    assert.ok(urls.every((u) => !u.includes("pexels")), `Pexels was never contacted: ${urls.join(", ")}`);
    // Both stock sources off and no fal: nothing is contacted at all.
    urls.length = 0;
    resolve.setProviderSnapshot(snap({ pexels: { enabled: false }, pixabay: { enabled: false }, fal: { enabled: false } }));
    const chain3 = chainProvider([pexelsProvider, pixabayProvider, falProvider]);
    assert.equal(chain3.hasKey(), false);
    const res = await chain3.fetchImage(ask);
    assert.equal(res.ok, false);
    assert.equal(!res.ok && res.reason, "no-key");
    assert.deepEqual(urls, []);
    // The Gemini image path (pro-slide) closes when Gemini is off.
    setEnv({ GEMINI_API_KEY: "env-gemini-1234" });
    resolve.setProviderSnapshot(snap({ gemini: { enabled: false } }));
    assert.equal(pickProvider({ toolId: "pro-slide" }).hasKey(), false);
    assert.equal(serverEnv.imagesConfigured(), false);
    assert.equal(toolBlockedReason(TOOL_BY_ID.image, { llm: true, images: serverEnv.imagesConfigured() }), "Rasm xizmati vaqtincha o‘chiq: serverda rasm kaliti sozlanmagan.");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("disabled voice providers: TTS stops, the audio tools hide only when none is left, key-less setups are untouched", () => {
  setEnv({ GEMINI_API_KEY: "env-gemini-1234", TTS_GEMINI_MODEL: "tts-model", AISHA_API_KEY: "env-aisha-1234" });
  Object.assign(serverEnv.env.tts, { azureRegion: "", geminiModel: "tts-model" });
  assert.equal(ttsGemini.makeGeminiTts().configured(), true);
  assert.equal(serverEnv.ttsFeature(), true);
  resolve.setProviderSnapshot(snap({ gemini: { enabled: false } }));
  assert.equal(ttsGemini.makeGeminiTts().configured(), false);
  assert.equal(ttsAisha.makeAishaTts().configured(), true);
  assert.equal(serverEnv.ttsFeature(), true, "Aisha is still usable");
  resolve.setProviderSnapshot(snap({ gemini: { enabled: false }, aisha: { enabled: false } }));
  assert.equal(serverEnv.ttsConfigured(), false);
  assert.equal(serverEnv.ttsFeature(), false, "every usable voice provider is off");
  const features = { llm: true, images: true, tts: serverEnv.ttsFeature() };
  assert.equal(toolBlockedReason(TOOL_BY_ID.podcast, features), "Ovoz xizmati vaqtincha o‘chiq: serverda ovoz kaliti sozlanmagan.");
  assert.equal(toolBlockedReason(TOOL_BY_ID.greeting, features), "Ovoz xizmati vaqtincha o‘chiq: serverda ovoz kaliti sozlanmagan.");
  assert.equal(toolBlockedReason(TOOL_BY_ID.slide, features), null, "other tools are not affected");
  // `tts` absent (an older client/server) blocks nothing.
  assert.equal(toolBlockedReason(TOOL_BY_ID.podcast, { llm: true, images: true }), null);
  // A reserved provider switched off (ElevenLabs is not implemented) never hides a tool.
  resolve.setProviderSnapshot(snap({ elevenlabs: { enabled: false } }));
  assert.equal(serverEnv.ttsFeature(), true);
});

test("admin-ai providerKeys(): a DB key counts, a disabled provider is false even with an env var", () => {
  setEnv({ FAL_KEY: "env-fal-key-1" });
  assert.equal(adminAi.providerKeys().fal, true);
  resolve.setProviderSnapshot(snap({ fal: { enabled: false } }));
  assert.equal(adminAi.providerKeys().fal, false);
  resolve.setProviderSnapshot(snap({ anthropic: { key: "db-anthropic-1" }, azure: { key: "db-azure-key-1" } }));
  assert.equal(adminAi.providerKeys().anthropic, true, "stored in the DB only");
  assert.equal(adminAi.providerKeys().azureTts, false, "Azure still needs its region");
  setEnv({ AZURE_SPEECH_REGION: "westeurope" });
  assert.equal(adminAi.providerKeys().azureTts, true);
});

// ───────────────────────────── review fixes: no implicit env fallback, research gating, warnings

test("anthropic adapter: a provider switched off AFTER the chain's check sends no request (the SDK must not fall back to the env key)", async () => {
  setEnv({ ANTHROPIC_API_KEY: "env-anthropic-key-1" });
  const requests: { url: string; key: string | null }[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const h = new Headers(init?.headers);
    requests.push({ url: String(input), key: h.get("x-api-key") });
    return new Response(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }), { status: 401, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const adapter = makeAnthropicAdapter();
    const opts = { maxTokens: 100, timeoutMs: 5_000 };
    // Control: enabled, env key -> the request goes out WITH the env key (so the stub really sees SDK traffic).
    const on = await adapter.complete("claude-x", "s", "u", opts);
    assert.equal(on.ok, false);
    assert.ok(requests.length >= 1, "control: a request went out");
    assert.equal(requests[0]!.key, "env-anthropic-key-1");
    // The chain checks the key, then the admin switches the provider off, then the adapter runs.
    requests.length = 0;
    assert.ok(resolve.getProviderKey("anthropic"), "chain check passes");
    resolve.setProviderSnapshot(snap({ anthropic: { enabled: false } }));
    const off = await adapter.complete("claude-x", "s", "u", opts);
    assert.equal(off.ok, false);
    assert.equal(!off.ok && off.retryable, false);
    assert.equal(requests.length, 0, "no request: the env key must not be used");
    // Same when the env var is gone and nothing is stored.
    resolve.setProviderSnapshot(snap({}));
    delete process.env.ANTHROPIC_API_KEY;
    assert.equal((await adapter.complete("claude-x", "s", "u", opts)).ok, false);
    assert.equal(requests.length, 0);
    // A stored key is passed explicitly.
    resolve.setProviderSnapshot(snap({ anthropic: { key: "db-anthropic-key-1" } }));
    await adapter.complete("claude-x", "s", "u", opts);
    assert.equal(requests[0]!.key, "db-anthropic-key-1");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("research sources: OpenAlex and Google Books switched off make NO call (and ignore the cache); on, they call", async () => {
  const calls: string[] = [];
  const fetchImpl = (async (url: string | URL | Request) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ results: [], items: [] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  const tag = randomBytes(4).toString("hex");
  // Control: both enabled.
  await openalex.searchWorks(`teaching ${tag}`, { fetchImpl });
  await googlebooks.searchBooks(`pedagogika ${tag}`, { fetchImpl });
  await openalex.getWork("W1234567", { fetchImpl });
  assert.equal(calls.length, 3, `control: ${calls.join(", ")}`);
  // OpenAlex off.
  calls.length = 0;
  resolve.setProviderSnapshot(snap({ openalex: { enabled: false } }));
  assert.deepEqual(await openalex.searchWorks(`teaching ${tag}`, { fetchImpl }), []);
  assert.equal(await openalex.getWork("W1234567", { fetchImpl }), null);
  assert.deepEqual(calls, [], "OpenAlex off: no request");
  await googlebooks.searchBooks(`pedagogika ${tag}-2`, { fetchImpl });
  assert.equal(calls.length, 1, "Google Books is independent");
  // Google Books off (searchBooks and verifyIsbn, which goes through it).
  calls.length = 0;
  resolve.setProviderSnapshot(snap({ googlebooks: { enabled: false } }));
  assert.deepEqual(await googlebooks.searchBooks(`pedagogika ${tag}`, { fetchImpl }), []);
  assert.equal(await googlebooks.verifyIsbn("9780306406157", { fetchImpl }), null);
  assert.deepEqual(calls, [], "Google Books off: no request");
  // Without any row both are enabled again.
  resolve.setProviderSnapshot(snap({}));
  await openalex.searchWorks(`teaching ${tag}-3`, { fetchImpl });
  assert.equal(calls.length, 1);
});

test("runtime config: the Azure key is read through the resolver; unreadable stored keys raise a warning", () => {
  Object.assign(serverEnv.env.tts, { azureRegion: "" });
  const regionProblems = () => serverEnv.assertRuntimeConfig().filter((p) => p.includes("AZURE_SPEECH_REGION"));
  assert.deepEqual(regionProblems(), []);
  // A key stored in the DB (no env var) without a region is the same misconfiguration as the env one.
  resolve.setProviderSnapshot(snap({ azure: { key: "db-azure-key-1234" } }));
  assert.equal(regionProblems().length, 1);
  // Switched off: the key is not in use, nothing to complain about.
  setEnv({ AZURE_SPEECH_KEY: "env-azure-key-1234" });
  resolve.setProviderSnapshot(snap({ azure: { enabled: false } }));
  assert.deepEqual(regionProblems(), []);
  resolve.setProviderSnapshot(snap({}));
  assert.equal(regionProblems().length, 1, "env key without region, as before");

  const warn = () => serverEnv.runtimeWarnings().filter((w) => w.includes("saqlangan kalit o'qilmaydi"));
  assert.deepEqual(warn(), []);
  resolve.setProviderSnapshot(snap({ fal: { unreadable: true }, aisha: { unreadable: true }, pexels: { key: "db-pexels-key-1" } }));
  assert.deepEqual(resolve.unreadableProviders(), ["aisha", "fal"]);
  const w = warn();
  assert.equal(w.length, 1);
  assert.match(w[0]!, /PROVIDER_KEYS_KEY o'zgarganmi\?/);
  assert.ok(w[0]!.includes("aisha, fal") && !w[0]!.includes("db-pexels-key-1"));
  Object.assign(serverEnv.env.tts, TTS_BACKUP);
});

test("sealingKeySource: provider / admin fallback / none", () => {
  assert.equal(crypto.sealingKeySource(), "admin");
  process.env.PROVIDER_KEYS_KEY = randomBytes(32).toString("base64");
  assert.equal(crypto.sealingKeySource(), "provider");
  process.env.PROVIDER_KEYS_KEY = "broken";
  assert.equal(crypto.sealingKeySource(), "none", "a malformed PROVIDER_KEYS_KEY is not usable and is not replaced by the fallback");
  delete process.env.PROVIDER_KEYS_KEY;
  delete process.env.ADMIN_TOTP_KEY;
  assert.equal(crypto.sealingKeySource(), "none");
});

test("env is restored for the other suites", () => {
  Object.assign(serverEnv.env.tts, TTS_BACKUP);
  for (const [k, v] of Object.entries(ENV_BACKUP)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  assert.ok(true);
});
