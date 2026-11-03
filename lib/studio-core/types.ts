/**
 * Media engine core — shared vocabulary (docs/studio/P0-SPEC.md §3).
 *
 * `lib/studio-core/` is provider-agnostic and host-agnostic: it never imports SlaydX code (wallet, DB, settings, UI),
 * so it can move into a package for another project. `tests/studio-core-purity.test.mts` pins that rule. Client-safe:
 * no node built-ins, no `server-only`.
 */

export type MediaKind = "image" | "video" | "speech" | "music" | "sfx";

export const MEDIA_KINDS: readonly MediaKind[] = ["image", "video", "speech", "music", "sfx"];

export type Capability =
  | "t2i" | "i2i" | "edit" | "inpaint" | "upscale" | "bg-remove" | "vectorize"
  | "t2v" | "i2v" | "effect" | "extend" | "lipsync"
  | "tts" | "dialogue" | "clone" | "voice-design" | "music" | "sfx" | "stt" | "voice-changer" | "isolate";

/** A provider's output: bytes it returned inline, or a URL the host downloads (never shown to users as is). */
export type MediaOutput = { kind: "inline"; bytes: Uint8Array; mime: string } | { kind: "url"; url: string; mime?: string };

/**
 * Why a provider call failed, in the terms the router and the host act on.
 *
 *   retryable  a later or a different route may succeed (429, 5xx, network, timeout before acceptance);
 *   safety     the provider refused the content (the user gets a clear message and a refund, no fallback);
 *   accepted   the provider had ALREADY taken the job when it failed (cost may be incurred): the router never falls
 *              back after this, a second route would mean double cost and double output.
 */
export class MediaError extends Error {
  readonly provider: string;
  readonly status?: number;
  readonly retryable: boolean;
  readonly safety: boolean;
  readonly accepted: boolean;

  constructor(provider: string, message: string, o: { status?: number; retryable?: boolean; safety?: boolean; accepted?: boolean } = {}) {
    super(message);
    this.name = "MediaError";
    this.provider = provider;
    if (o.status !== undefined) this.status = o.status;
    this.retryable = o.retryable ?? false;
    this.safety = o.safety ?? false;
    this.accepted = o.accepted ?? false;
  }
}

/** HTTP status → retryable, the rule every adapter uses (401/402/403 = account problem, never retried). */
export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}
