"use client";

import { ApiError, PriceChangedError, request, withRetryHint } from "@/lib/api-client";
import { reportGate } from "@/lib/channel-gate";
import type { CompareKind } from "./compare-model";

/** `POST /api/studio/compare` → 202: the batch id, the sum charged and one generation per model, in tick order. */
export type CompareQueued = { group: string; total: number; items: { id: string; modelId: string; price: number }[] };

export type CompareRequest = {
  kind: CompareKind;
  members: { values: Record<string, unknown>; expectedPrice: number }[];
  expectedTotal: number;
};

/** A retry within this time after a lost answer reuses the key (the server answers with the batch, charges nothing). */
const UNSURE_MS = 10 * 60_000;

/*
 * One key per INTENT (the batch's models + values, never the prices — a stale price must not mint a second purchase),
 * as `createGeneration` does: reused while the request is in flight or its answer was lost; a clear answer (success or
 * refusal) frees it, so a deliberate second «Solishtirish» is a new batch.
 */
let last: { intent: string; key: string; state: "pending" | "unsure"; at: number } | null = null;

/** UUID v4; `randomUUID` exists only in a secure context (https / localhost), so the bytes are the fallback. */
function uuidV4(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === "function") return c.randomUUID();
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function keyFor(intent: string): string {
  const reuse = last !== null && last.intent === intent && (last.state === "pending" || Date.now() - last.at < UNSURE_MS);
  const key = reuse && last ? last.key : uuidV4();
  last = { intent, key, state: "pending", at: Date.now() };
  return key;
}

/** Test seam: forget the remembered key. */
export function resetCompareKey(): void {
  last = null;
}

/**
 * Sends the batch. Every refusal (400 / 402 / 403 / 409 / 422 / 429) means nothing was charged; a 409 `price_changed`
 * comes back as a `PriceChangedError` carrying the server's NEW sum (the panel re-reads the catalog and shows it); a
 * lost answer (network, timeout, 5xx) keeps the key, so pressing again cannot buy the batch twice.
 */
export async function sendCompare(body: CompareRequest): Promise<CompareQueued> {
  const intent = JSON.stringify({ kind: body.kind, values: body.members.map((m) => m.values) });
  const key = keyFor(intent);
  try {
    const res = await request<CompareQueued>("/api/studio/compare", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Idempotency-Key": key },
      timeoutMs: 60_000,
    });
    if (last?.key === key) last = null;
    return res;
  } catch (e) {
    const unsure = !(e instanceof ApiError) || e.status === 0 || e.status === 408 || e.status >= 500;
    if (last?.key === key) last = unsure ? { ...last, state: "unsure", at: Date.now() } : null;
    if (e instanceof ApiError) reportGate(e.status, e.data);
    if (e instanceof ApiError && e.status === 409 && e.data.code === "price_changed" && typeof e.data.price === "number") {
      throw new PriceChangedError(e.message, e.data.price, e.data);
    }
    if (e instanceof ApiError && e.status === 429) throw new ApiError(withRetryHint(e.message, e.retryAfterSec), 429, e.data);
    if (e instanceof ApiError && e.data.timeout === true) {
      throw new ApiError("Server javob bermadi. Qayta yuborishdan oldin Galereyani tekshiring — ishlar navbatga qo‘yilgan bo‘lishi mumkin.", 0, e.data);
    }
    throw e;
  }
}
