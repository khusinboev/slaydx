/**
 * Browser registry of the voice-clone price (the `price-adjust.ts` / `setClientMediaPricing` pattern): the «Ovoz» tab
 * stores the number `GET /api/media/voices` returns (`clonePrice`, the server's `studio.clone_price` setting) so
 * `priceFor(studio-voice)` shows what the server will charge. Invisible on the server (every server price takes its
 * pricing block explicitly). Client-safe.
 */
import { clonePriceOf } from "./studio-speech";

let clientClonePrice: number | null = null;

/** Stores a validated clone price; returns whether it changed. */
export function setClientClonePrice(raw: unknown): boolean {
  const next = raw === null || raw === undefined ? null : clonePriceOf(raw);
  if (next === clientClonePrice) return false;
  clientClonePrice = next;
  return true;
}

/** The browser's clone price; always `null` on the server. */
export function getClientClonePrice(): number | null {
  if (typeof window === "undefined") return null;
  return clientClonePrice;
}
