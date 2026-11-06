import type { MediaOutput } from "./types";
import type { NormalizedParams } from "./params";

/**
 * Adapter — the only code that speaks one provider's HTTP API (docs/studio/P0-SPEC.md §3.8). Sync providers answer
 * `submit` with the outputs; async ones return an op id that the host parks and polls (or receives by webhook).
 *
 * An adapter maps every failure onto `MediaError` (types.ts): the router's fallback and the host's refund depend on
 * `retryable` / `safety` / `accepted` being right.
 */
export type AdapterAsset = { mime: string; base64: string };

export type AdapterInput = {
  upstreamModel: string;
  params: NormalizedParams;
  /** Uploaded inputs resolved by the host (ownership checked there), by param name. */
  assets?: Readonly<Record<string, readonly AdapterAsset[]>>;
  /** Sent to providers that accept one, so a retried submit never starts a second paid job. */
  idempotencyKey: string;
};

export type AdapterDeps = {
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Epoch ms the call must finish by (the job's remaining budget). */
  deadline?: number;
  /** An input now lives at the provider under this URL: the host records it, awaited BEFORE the paid call, to delete it later. */
  onInputStored?: (url: string) => Promise<void>;
};

export type PollResult =
  | { state: "running"; progress?: number }
  | { state: "done"; outputs: MediaOutput[] }
  | { state: "failed"; message: string; safety: boolean };

export type SubmitResult = { done: MediaOutput[] } | { opId: string };

export interface MediaAdapter {
  id: string;
  configured(): boolean;
  /** Pure: what `submit` would send (contract and probe tests). No key inside. Absent when the wrapped request builder is not pure yet (P0 image/speech wrappers). */
  buildRequest?(input: AdapterInput): { url: string; headers: Record<string, string>; body: unknown };
  submit(input: AdapterInput, deps?: AdapterDeps): Promise<SubmitResult>;
  poll?(opId: string, deps?: AdapterDeps): Promise<PollResult>;
  /**
   * Best effort: ask the provider to drop an async op the host gave up on (its deadline passed), so a late finish is
   * not billed. `completed`: the provider says the op had already finished (it may bill it: reconcile). May throw; the
   * host never lets a cancel failure block its refund.
   */
  cancel?(opId: string, deps?: AdapterDeps): Promise<"cancelled" | "completed">;
  /** Best effort, never throws: deletes an input stored for an op (`onInputStored`). Needs no state of the worker that stored it. */
  dropInput?(url: string, deps?: AdapterDeps): Promise<void>;
  fetchOutput(o: MediaOutput, deps?: AdapterDeps): Promise<Uint8Array>;
}
