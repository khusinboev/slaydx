import "server-only";
import { MEDIA_CATALOG, MEDIA_PURPOSES } from "../../media/catalog";
import { getProviderKey, isProviderEnabled } from "../providers/resolve";
import { keyUsable } from "../providers/registry";
import { ensureProviderKeys } from "../providers/store";
import { mediaOverrides, type OverrideMap } from "./overrides";
import { getSetting } from "../settings";
import { STUDIO_VIDEO_PURPOSE } from "../../media/catalog-video";

/**
 * Can a catalog model serve a job RIGHT NOW (docs/studio/P1-SPEC.md «Admin»): one of its routes has a provider that is
 * switched on in «Provayderlar» AND keyed (DB or env) with a key of a usable format (`keyUsable`), and the admin did not switch the model off
 * (`media_model_overrides.enabled = false`; no row = on).
 *
 * ONE function for both sides: `GET /api/media/catalog` lists only what passes, and `submitGeneration` refuses (400,
 * nothing charged) what does not — a stale page or a direct POST cannot buy a model the admin hid.
 */
export function modelAvailable(modelId: string, overrides: OverrideMap): boolean {
  const entry = MEDIA_CATALOG.byId(modelId);
  if (!entry) return false;
  if (overrides.get(modelId)?.enabled === false) return false;
  return entry.routes.some((r) => isProviderEnabled(r.provider) && keyUsable(r.provider, getProviderKey(r.provider)));
}

/** The purpose's allowed models available now, in the purpose's (catalog) order. */
export async function availableModels(purposeId: string): Promise<string[]> {
  const purpose = MEDIA_PURPOSES.byId(purposeId);
  if (!purpose) throw new Error(`availability: unknown purpose ${purposeId}`);
  await ensureProviderKeys();
  const overrides = await mediaOverrides();
  const allowed = new Set(purpose.allowed);
  return MEDIA_CATALOG.entries.filter((e) => allowed.has(e.id) && modelAvailable(e.id, overrides)).map((e) => e.id);
}

/**
 * Studio «Video» tab (docs/studio/P3-SPEC.md): the `studio.video` models available now — and NONE while the admin's
 * paid-video switch `video.enabled` is off. One switch for paid video: «Video» and the Studio tab open and close
 * together (`video.enabled` ships dark), then each model follows its provider + the «Media modellari» override.
 */
export async function studioVideoModels(): Promise<string[]> {
  if (!(await getSetting("video.enabled"))) return [];
  return availableModels(STUDIO_VIDEO_PURPOSE);
}

/** Why `modelId` cannot be sold for `purposeId` now (Uzbek, for a 400), `null` when it can. */
export async function modelUnavailable(purposeId: string, modelId: string): Promise<string | null> {
  const purpose = MEDIA_PURPOSES.byId(purposeId);
  if (!purpose || !purpose.allowed.includes(modelId)) return purpose?.kind === "video" ? "Noma'lum video modeli — boshqa modelni tanlang." : "Noma'lum rasm modeli — boshqa modelni tanlang.";
  return (await availableModels(purposeId)).includes(modelId) ? null : "Tanlangan model hozir mavjud emas — boshqa modelni tanlang.";
}
