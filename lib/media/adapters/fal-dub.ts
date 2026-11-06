/**
 * Studio P11 package E: dubbing through fal (`fal-ai/elevenlabs/dubbing`, `fal-ai/heygen/v2/translate/speed`), for the
 * P10 engine `lib/generation/studio/dub.ts`, which polls inside the job.
 *
 * It is the fal video adapter's queue protocol with another request and output (`FalQueueVariant`): the same key, host,
 * redirect, scrub and `accepted` rules, the same status and result mapping, the same safe download. Only two things are
 * added around it. The source is uploaded to fal storage before the submit, and the upload is removed when the op ends:
 * the engine calls `cancel` after the download and on giving up, the file's expiry covers a worker that died in between.
 *
 * Op id: `fal:<endpoint>:<request_id>`, as for a clip, so a re-run of the job resumes it; `FAL_DUB_ENDPOINTS` bounds it.
 */
import { MediaError, sniffMime, type AdapterDeps, type AdapterInput, type MediaAdapter } from "../../studio-core";
import { getProviderKey } from "../../server/providers/resolve";
import { SPEECH_TOOL_OUTPUT_MAX_BYTES } from "../catalog-transcribe";
import { FAL_QUEUE_HOST, falVideoAdapter, type FalDeps, type FalQueueVariant } from "./fal";
import { FAL_DUB_ENDPOINTS, falDubBody } from "./fal-audio-models";
import { FAL_FILE_PENDING, FAL_RETENTION_SEC, deleteFalFile, falFileAsset, falLifecycleHeader, uploadFalFile } from "./fal-storage";

export const FAL_DUB_ADAPTER_ID = "fal-dub";
/** fal drops a dub it could not start within this: the job's whole budget is 600 s, and rendering needs most of it. */
export const FAL_DUB_START_TIMEOUT_SEC = 180;

const fileUrlOf = (v: unknown): string | null => {
  const url = v && typeof v === "object" ? (v as { url?: unknown }).url : null;
  return typeof url === "string" && url ? url : null;
};

/** The dubbed file: `video` for a video source (the pages), else `audio`. Dubbing's audio format is not stated: sniffed. */
export function falDubOutput(result: unknown): string | null {
  const r = (result && typeof result === "object" ? result : {}) as { video?: unknown; audio?: unknown };
  return fileUrlOf(r.video) ?? fileUrlOf(r.audio);
}

function variant(fileUrl: string): FalQueueVariant {
  return {
    id: FAL_DUB_ADAPTER_ID,
    endpoints: FAL_DUB_ENDPOINTS,
    startTimeoutSec: FAL_DUB_START_TIMEOUT_SEC,
    maxBytes: SPEECH_TOOL_OUTPUT_MAX_BYTES,
    outputOf: falDubOutput,
    accepts: (b) => ["video/mp4", "audio/mpeg"].includes(sniffMime(b) ?? ""),
    request(input) {
      const endpoint = input.upstreamModel;
      const asset = falFileAsset(input);
      if (!FAL_DUB_ENDPOINTS.has(endpoint)) throw new MediaError("fal", `unknown fal dub endpoint ${endpoint}`);
      if (!asset) throw new MediaError("fal", "no source media");
      return {
        endpoint,
        url: `https://${FAL_QUEUE_HOST}/${endpoint}`,
        headers: { "Content-Type": "application/json", ...falLifecycleHeader(FAL_RETENTION_SEC) },
        body: falDubBody(endpoint, input.params, asset, fileUrl),
      };
    },
  };
}

export function falDubAdapter(o: Pick<FalDeps, "key" | "lookup"> = {}): MediaAdapter {
  const keyOf = o.key ?? (() => getProviderKey("fal"));
  const queue = falVideoAdapter({ ...o, variant: variant(FAL_FILE_PENDING) });
  /** op id → its uploaded source, while this worker holds the job. */
  const uploads = new Map<string, string>();

  return {
    ...queue,
    async submit(input: AdapterInput, deps: AdapterDeps = {}) {
      const key = keyOf();
      if (!key) throw new MediaError("fal", "FAL_KEY yo'q", { accepted: false });
      // Every pure check first: nothing is uploaded for a request that cannot be sent.
      queue.buildRequest!(input);
      const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
      const budget = deps.deadline ? deps.deadline - (deps.now ?? Date.now)() : undefined;
      const fileUrl = await uploadFalFile(falFileAsset(input)!, { key, fetchImpl, ...(budget !== undefined ? { timeoutMs: budget } : {}), ...(o.lookup ? { lookup: o.lookup } : {}) });
      try {
        const out = await falVideoAdapter({ ...o, variant: variant(fileUrl) }).submit(input, deps);
        if ("opId" in out) uploads.set(out.opId, fileUrl);
        return out;
      } catch (e) {
        await deleteFalFile(fileUrl, { key, fetchImpl });
        throw e;
      }
    },
    async cancel(opId, deps: AdapterDeps = {}) {
      const fileUrl = uploads.get(opId);
      uploads.delete(opId);
      try {
        return await queue.cancel!(opId, deps);
      } finally {
        const key = keyOf();
        if (fileUrl && key) await deleteFalFile(fileUrl, { key, ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}) });
      }
    },
  };
}
