/**
 * fal storage (Studio P11 package E): how a user's audio or video reaches a fal model.
 *
 * Why not a `data:` URI: the fal CDN page warns against them above a few KB, no audio page states a size limit for one, and
 * our inputs reach 25 MB. Only `veed/clean-audio` names data URIs at all, so every input takes this one path.
 *
 * Protocol (https://fal.ai/docs/documentation/model-apis/file-access-controls.md «A direct upload is two steps», and
 * https://fal.ai/docs/documentation/model-apis/fal-cdn.md «Deleting Files», read 2026-11-06):
 *   initiate  POST https://rest.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3  `Authorization: Key <FAL_KEY>`,
 *             JSON `{ file_name, content_type }` → `{ upload_url, file_url }`;
 *   upload    PUT upload_url (a presigned URL: WITHOUT the key), `Content-Type`, the bytes;
 *   delete    POST https://rest.fal.ai/storage/files/delete `{ file_url }` (needs the key's `assets:write`).
 * Retention (https://fal.ai/docs/documentation/model-apis/media-expiration.md): `X-Fal-Object-Lifecycle-Preference:
 * {"expiration_duration_seconds": n}`. CDN files are public to whoever has the URL, so an input lives as briefly as the job
 * can use it: the expiry below, and a best-effort delete when the call ends. The file name is a constant, never user text.
 *
 * UNVERIFIED until a live job: the docs show the initiate call with an `initial_acl` lifecycle, not with an expiry (the page
 * says uploads and outputs share the same retention controls); multipart uploads are not used, the docs say the SDKs switch
 * to them at 90 MB and our inputs stop at 25 MB; that the production key may delete.
 *
 * Failures are never `accepted`: nothing was sent to a model, nothing is billed. Messages name only our own constants and
 * the HTTP status, so neither the key nor a presigned URL can reach a log or an error text.
 */
import { MediaError, isRetryableStatus, type AdapterAsset, type AdapterInput } from "../../studio-core";
import { assertPublicHttpsUrl, type LookupFn } from "../../generation/safe-fetch";

export const FAL_STORAGE_INITIATE_URL = "https://rest.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3";
export const FAL_STORAGE_DELETE_URL = "https://rest.fal.ai/storage/files/delete";
/** The worst job (a dub) has 10 minutes; an hour leaves room for fal's queue and never keeps a user's file for days. */
export const FAL_RETENTION_SEC = 3_600;
/** `buildRequest` without an upload (pure tests, probes): the real URL is put in by `submit`. */
export const FAL_FILE_PENDING = "fal-storage://pending";

const INITIATE_MS = 20_000;
const UPLOAD_MAX_MS = 120_000;
const DELETE_MS = 5_000;

const FILE_EXT: Readonly<Record<string, string>> = { "audio/wav": "wav", "audio/mpeg": "mp3", "video/mp4": "mp4" };

export const falLifecycleHeader = (seconds: number): Record<string, string> => ({ "X-Fal-Object-Lifecycle-Preference": JSON.stringify({ expiration_duration_seconds: seconds }) });

/** The job's input file: an «Audio» upload or a P10 source. */
export function falFileAsset(input: Pick<AdapterInput, "assets">): AdapterAsset | null {
  return input.assets?.audio?.[0] ?? input.assets?.media?.[0] ?? null;
}

export type FalStorageDeps = { key: string; fetchImpl?: typeof fetch; timeoutMs?: number; lookup?: LookupFn };

const refused = (msg: string, f: { status?: number; retryable?: boolean } = {}) => new MediaError("fal", msg, { ...f, accepted: false });

/** Uploads one file and returns its fal URL. Throws a never-`accepted` `MediaError`. */
export async function uploadFalFile(asset: AdapterAsset, deps: FalStorageDeps): Promise<string> {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const ext = FILE_EXT[asset.mime];
  if (!ext) throw refused(`upload: ${asset.mime} turi yuklanmaydi`);
  let res: Response;
  try {
    res = await fetchImpl(FAL_STORAGE_INITIATE_URL, {
      method: "POST",
      headers: { Authorization: `Key ${deps.key}`, "Content-Type": "application/json", ...falLifecycleHeader(FAL_RETENTION_SEC) },
      body: JSON.stringify({ file_name: `input.${ext}`, content_type: asset.mime }),
      redirect: "manual",
      signal: AbortSignal.timeout(INITIATE_MS),
    });
  } catch {
    throw refused("upload: initiate javob bermadi", { retryable: true });
  }
  if (!res.ok) throw refused(`upload: initiate ${res.status}`, { status: res.status, retryable: isRetryableStatus(res.status) });
  const body = (await res.json().catch(() => null)) as { upload_url?: unknown; file_url?: unknown } | null;
  const uploadUrl = typeof body?.upload_url === "string" ? body.upload_url : "";
  const fileUrl = typeof body?.file_url === "string" ? body.file_url : "";
  if (!uploadUrl || !/^https:\/\//i.test(fileUrl)) throw refused("upload: javobda URL yo'q");
  try {
    // The answer names this URL, and the user's bytes go there: https on a public host, like an output download.
    await assertPublicHttpsUrl(uploadUrl, deps.lookup);
  } catch {
    throw refused("upload: yuklash manzili rad etildi");
  }
  let put: Response;
  try {
    put = await fetchImpl(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": asset.mime },
      body: new Uint8Array(Buffer.from(asset.base64, "base64")),
      redirect: "manual",
      signal: AbortSignal.timeout(Math.max(1_000, Math.min(UPLOAD_MAX_MS, deps.timeoutMs ?? UPLOAD_MAX_MS))),
    });
  } catch {
    throw refused("upload: fayl yuborilmadi", { retryable: true });
  }
  await put.body?.cancel().catch(() => undefined);
  if (!put.ok) throw refused(`upload: PUT ${put.status}`, { status: put.status, retryable: isRetryableStatus(put.status) });
  return fileUrl;
}

/** Best effort, never throws: the expiry removes what this could not. */
export async function deleteFalFile(fileUrl: string, deps: Pick<FalStorageDeps, "key" | "fetchImpl">): Promise<void> {
  try {
    const res = await (deps.fetchImpl ?? globalThis.fetch)(FAL_STORAGE_DELETE_URL, {
      method: "POST",
      headers: { Authorization: `Key ${deps.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ file_url: fileUrl }),
      redirect: "manual",
      signal: AbortSignal.timeout(DELETE_MS),
    });
    await res.body?.cancel().catch(() => undefined);
    if (!res.ok) console.warn(`[fal-storage] delete answered ${res.status}`);
  } catch {
    console.warn("[fal-storage] delete failed");
  }
}
