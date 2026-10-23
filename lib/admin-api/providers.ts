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
};

export type ProvidersResponse = {
  items: ProviderItem[];
  /** Keys can be stored: a sealing key is configured on the server. */
  canStoreKeys: boolean;
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
