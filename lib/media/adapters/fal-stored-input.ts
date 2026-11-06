/**
 * A fal queue job whose input file travels through fal storage (Studio P11): dubbing (`fal-dub.ts`) and the photo avatars
 * (`fal-avatar.ts`). The queue protocol is the fal video adapter's (`FalQueueVariant`); this adds the file around it. The
 * input is uploaded before the submit, and `dropInput` removes it. The adapter keeps no state: `onInputStored` hands the URL
 * to the host before the paid call, the host keeps it on the `media_jobs` row, so a resumed job or housekeeping can delete a
 * file another worker uploaded. The file's expiry covers the rest.
 */
import { MediaError, type AdapterAsset, type AdapterDeps, type AdapterInput, type MediaAdapter } from "../../studio-core";
import { getProviderKey } from "../../server/providers/resolve";
import { falVideoAdapter, type FalDeps, type FalQueueVariant } from "./fal";
import { FAL_FILE_PENDING, deleteFalFile, uploadFalFile } from "./fal-storage";

export function falStoredInputAdapter(o: Pick<FalDeps, "key" | "lookup">, variant: (fileUrl: string) => FalQueueVariant, assetOf: (input: Pick<AdapterInput, "assets">) => AdapterAsset | null): MediaAdapter {
  const keyOf = o.key ?? (() => getProviderKey("fal"));
  const queue = falVideoAdapter({ ...o, variant: variant(FAL_FILE_PENDING) });

  return {
    ...queue,
    async submit(input: AdapterInput, deps: AdapterDeps = {}) {
      const key = keyOf();
      if (!key) throw new MediaError("fal", "FAL_KEY yo'q", { accepted: false });
      // Every pure check first: nothing is uploaded for a request that cannot be sent.
      queue.buildRequest!(input);
      const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
      const budget = deps.deadline ? deps.deadline - (deps.now ?? Date.now)() : undefined;
      const fileUrl = await uploadFalFile(assetOf(input)!, { key, fetchImpl, ...(budget !== undefined ? { timeoutMs: budget } : {}), ...(o.lookup ? { lookup: o.lookup } : {}) });
      try {
        // A failed note must not cost the job: the expiry still removes the file.
        await deps.onInputStored?.(fileUrl).catch(() => undefined);
        return await falVideoAdapter({ ...o, variant: variant(fileUrl) }).submit(input, deps);
      } catch (e) {
        await deleteFalFile(fileUrl, { key, fetchImpl });
        throw e;
      }
    },
    async dropInput(url, deps: AdapterDeps = {}) {
      const key = keyOf();
      if (key) await deleteFalFile(url, { key, ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}) });
    },
  };
}
