"use client";

import { adminGet, adminSend, type AdminCallOptions } from "./core";

/**
 * Provider keys and switches API (program-17 decision D7; permissions `settings.view` / `settings.edit`).
 * Thin typed wrappers over `core.ts` (AbortSignal, 401 `reauth` step-up + one retry, 403/404 classes).
 *
 * No call here ever receives a key back. The key travels one way only: `setProviderKey` sends it, the answer
 * is the provider's state (`hasDbKey`, masked `keyHint`).
 *
 * Types are declared here, not imported from `lib/server/**` (admin client code must not reach server
 * modules, tests/admin-boundary.test.mts).
 */

export type ProviderKind = "llm" | "image" | "tts" | "video" | "research";
export type ProviderKeySource = "db" | "env" | "none";

export type ProviderBilling = "paid" | "free" | "free-tier";
export type ProviderNeed = "required" | "recommended" | "optional";
export type PurposeId = "text" | "image" | "stock" | "tts" | "stt" | "search" | "sources" | "video";
export type Verdict = "ok" | "single" | "missing" | "off";
export type RouteId = "llm.model" | "llm.writer" | "llm.researcher" | "llm.judge" | "llm.fast" | "image.gemini" | "tts.order";
export type RouteShape = "chain" | "model" | "order";
export type RouteSource = "db" | "env" | "default";

export type UsageTotals = {
  calls: number;
  /** Failed requests; `null` when the source does not track failures (paid providers). */
  errors: number | null;
  inputTokens: number;
  outputTokens: number;
  units: number;
  usd: number;
};
export type KindUsage = { kind: string; calls: number; units: number; inputTokens: number; outputTokens: number; usd: number };
export type ModelUsage = { model: string; kind: string; calls: number; usd: number };
export type DayUsage = { day: string; calls: number; usd: number };
export type ProviderUsage = {
  today: UsageTotals;
  d7: UsageTotals;
  d30: UsageTotals;
  lastDay: string | null;
  kinds: KindUsage[];
  models: ModelUsage[];
  daily: DayUsage[];
};

export type ProviderItem = {
  id: string;
  label: string;
  kinds: ProviderKind[];
  /** The adapter exists. `false`: a key can be stored, nothing reads it yet («tez orada»). */
  implemented: boolean;
  /** «Tekshirish» has a live call for this provider. */
  testable: boolean;
  /** What a key looks like. */
  keyFormat: string;
  enabled: boolean;
  hasDbKey: boolean;
  /** `…a1B2`; `null` without a stored key and for roles that may not edit. */
  keyHint: string | null;
  envPresent: boolean;
  /** Where the key in use comes from (`none` also when the provider is switched off). */
  keySource: ProviderKeySource;
  /** A key is stored but cannot be decrypted (the sealing key changed): enter it again. */
  unreadable: boolean;
  updatedBy: string | null;
  updatedAt: string | null;
  /** Can serve requests right now: switched on and a key resolves. */
  usable: boolean;
  billing: ProviderBilling;
  priceNote: string;
  /** What the product uses it for, one sentence. */
  role: string;
  need: ProviderNeed;
  keyUrl: string | null;
  purposes: PurposeId[];
  /** A circuit breaker of this provider is open: requests are skipped until `openUntil`. */
  breaker: { state: "open" | "half-open"; openUntil: string | null } | null;
  usage: ProviderUsage;
};

export type RouteEntry = { provider: string; model: string | null };
export type RouteEntryState = RouteEntry & { label: string; usable: boolean };
export type ModelOption = { provider: string; model: string; inUsdPerM: number | null; outUsdPerM: number | null; perImageUsd: number | null };

export type RouteItem = {
  id: RouteId;
  title: string;
  help: string;
  shape: RouteShape;
  max: number;
  providers: { id: string; label: string }[];
  models: ModelOption[];
  /** `db` = the admin's choice, `env` = the server's environment variable, `default` = built in. */
  source: RouteSource;
  entries: RouteEntryState[];
  /** What «Standartga qaytarish» restores. */
  fallbackEntries: RouteEntryState[];
  updatedBy: string | null;
  updatedAt: string | null;
};

export type PurposeItem = {
  id: PurposeId;
  title: string;
  summary: string;
  need: ProviderNeed;
  minimum: string;
  fallback: boolean;
  providerIds: string[];
  premiumIds: string[];
  verdict: Verdict;
  headline: string;
  detail: string;
  setting: { key: string; label: string; enabled: boolean } | null;
  routes: RouteItem[];
};

export type SystemBody = {
  processes: { process: string; role: "web" | "worker"; lastSeenAt: string; stale: boolean }[];
  breakers: { process: string; name: string; state: "closed" | "open" | "half-open"; openUntil: string | null; failures: number; stale: boolean }[];
  limiters: { process: string; name: string; active: number; waiting: number; max: number; stale: boolean }[];
};

export type ProvidersResponse = {
  items: ProviderItem[];
  purposes: PurposeItem[];
  system: SystemBody;
  /** 30-day spend of providers that are no longer offered (kept so history stays in the totals). */
  otherUsage: { provider: string; calls: number; usd: number }[];
  total30: { calls: number; usd: number };
  soumPerUsd: number;
  generatedAt: string;
  /** Keys can be stored: a sealing key is configured on the server. */
  canStoreKeys: boolean;
  /** `provider` = PROVIDER_KEYS_KEY, `admin` = the ADMIN_TOTP_KEY fallback, `none`. */
  sealingKey: "provider" | "admin" | "none";
  /** A change reaches the other process (web <-> worker) within this many seconds. */
  propagationSec: number;
};

export type ProviderTestResult = { ok: boolean; message: string };

export function listProviders(opts: AdminCallOptions = {}): Promise<ProvidersResponse> {
  return adminGet<ProvidersResponse>("/api/admin/providers", undefined, opts);
}

function pathOf(id: string, leaf: "enabled" | "key" | "test"): string {
  return `/api/admin/providers/${encodeURIComponent(id)}/${leaf}`;
}

/** Switches a provider on or off (step-up and a reason). */
export function setProviderEnabled(id: string, enabled: boolean, reason: string, opts: AdminCallOptions = {}): Promise<{ item: ProviderItem }> {
  return adminSend<{ item: ProviderItem }>("PUT", pathOf(id, "enabled"), { enabled, reason }, opts);
}

/** Stores or replaces the API key (step-up and a reason). The key is sealed on the server and never returned. */
export function setProviderKey(id: string, key: string, reason: string, opts: AdminCallOptions = {}): Promise<{ item: ProviderItem }> {
  return adminSend<{ item: ProviderItem }>("PUT", pathOf(id, "key"), { key, reason }, opts);
}

/** Removes the stored key: the env var applies again (step-up and a reason). */
export function deleteProviderKey(id: string, reason: string, opts: AdminCallOptions = {}): Promise<{ item: ProviderItem }> {
  return adminSend<{ item: ProviderItem }>("DELETE", pathOf(id, "key"), { reason }, opts);
}

/** «Tekshirish»: one cheap live call with the key in use. */
export function testProvider(id: string, opts: AdminCallOptions = {}): Promise<ProviderTestResult> {
  return adminSend<ProviderTestResult>("POST", pathOf(id, "test"), {}, opts);
}

/** Stores the admin's choice for a routing slot (step-up and a reason). */
export function setRoute(id: RouteId, entries: RouteEntry[], reason: string, opts: AdminCallOptions = {}): Promise<{ route: RouteItem }> {
  return adminSend<{ route: RouteItem }>("PUT", `/api/admin/providers/routes/${encodeURIComponent(id)}`, { entries, reason }, opts);
}

/** Removes the admin's choice: the slot goes back to the server's environment value or the built-in default (step-up and a reason). */
export function resetRoute(id: RouteId, reason: string, opts: AdminCallOptions = {}): Promise<{ route: RouteItem }> {
  return adminSend<{ route: RouteItem }>("DELETE", `/api/admin/providers/routes/${encodeURIComponent(id)}`, { reason }, opts);
}
