import "server-only";
import type { PoolClient } from "pg";
import { ApiError } from "./api";
import { adminTx } from "./admin-audit";
import { parseReason } from "./admin-accounts";
import type { AdminActor } from "./admin-handler";
import { getToolPricing } from "./pricing";
import { keyUsable } from "./providers/registry";
import { ensureProviderKeys } from "./providers/store";
import { getProviderKey, isProviderEnabled } from "./providers/resolve";
import { modelAvailable, modelSwitchedOn } from "./media/availability";
import { invalidateMediaOverrides, readOverrides, type ModelOverride } from "./media/overrides";
import { mediaPricing } from "./media/pricing";
import { applyPriceAdjust } from "../price-adjust";
import { costUsd, isValidMarkup, MARKUP_MAX, MARKUP_MIN, normalize } from "../studio-core";
import { MEDIA_CATALOG, MEDIA_PURPOSES, STUDIO_PURPOSES } from "../media/catalog";
import { liveCostRule, markupOf, studioImagePrice } from "../media/studio-pricing";
import { STUDIO_VIDEO_PURPOSE } from "../media/catalog-video";
import { studioVideoPrice } from "../media/studio-video-pricing";
import { STUDIO_SPEECH_PURPOSE } from "../media/catalog-speech";
import { speechTextParam, studioSpeechPrice } from "../media/studio-speech";
import { AUDIO_MODEL_IDS, LYRIA_MODEL, MUSIC_MODEL, SFX_MODEL } from "../media/catalog-audio";
import { studioAudioPrice } from "../media/studio-audio";
import { DUB_MODEL, SPEECH_TOOL_MODEL_IDS, TRANSCRIBE_MODEL } from "../media/catalog-transcribe";
import { studioDubPrice, studioTranscribePrice } from "../media/studio-transcribe";

/**
 * Admin «Narxlar» → «Media modellari» (docs/studio/P1-SPEC.md «Admin»): per Studio model the provider cost of ONE unit
 * (USD and so'm), the price the user pays for it at the current markup (+ the tool's `tool_pricing` %, exactly as
 * `effectivePrice` charges), the margin, the enable switch and the markup override.
 *
 * Money rule: the price shown here is computed by the SAME function the server charges with (`studioImagePrice` over
 * `mediaPricing()`), never a second formula. Writes: `pricing.edit` permission (step-up), a reason, an audit row with
 * before/after in the same transaction, an optional `expected` state (409 `stale` when someone changed it meanwhile).
 */

/**
 * Models this block manages: the ones the Studio sells (cost × markup) — the Rasm tab's (pictures and, since P2b, the
 * edit / upscale / background-removal models), then the Video tab's (P3). Other catalog entries keep their tool prices.
 * `google/omni-video` is also sold by «Video» at its own ladder: its switch and markup here act on the Studio only.
 */
export function managedModelIds(): string[] {
  // P5: + the «Ovoz» tab's speech models (the clone is a fixed price, `studio.clone_price`, not listed here).
  return [
    ...new Set([
      ...STUDIO_PURPOSES.flatMap((p) => MEDIA_PURPOSES.byId(p)!.allowed),
      ...MEDIA_PURPOSES.byId(STUDIO_VIDEO_PURPOSE)!.allowed,
      ...MEDIA_PURPOSES.byId(STUDIO_SPEECH_PURPOSE)!.allowed,
      // P6: + the «Audio» tab's models (P9: «Musiqa» has two).
      ...AUDIO_MODEL_IDS,
      // P10: «Transkripsiya» / «Dublyaj» (per minute of the source).
      ...SPEECH_TOOL_MODEL_IDS,
    ]),
  ];
}

/** What one priced unit of a model is: a picture, a utility job (P2b upscale / background removal), a default-length clip, an effect clip. */
function unitOf(id: string): { label: string; values: Record<string, unknown>; video: boolean; speech?: boolean; audio?: boolean; p10?: "studio-transcribe" | "studio-dub" } {
  const entry = MEDIA_CATALOG.byId(id)!;
  // P10: one minute of the source.
  if (id === TRANSCRIBE_MODEL) return { label: "1 daqiqa", values: { sourceSeconds: 60 }, video: false, p10: "studio-transcribe" };
  if (id === DUB_MODEL) return { label: "1 daqiqa", values: { sourceSeconds: 60 }, video: false, p10: "studio-dub" };
  // P6 «Audio»: a minute of music / of input audio, 10 s of a sound effect (one variant).
  if (AUDIO_MODEL_IDS.includes(id)) {
    if (id === MUSIC_MODEL) return { label: "1 daqiqa", values: { modelId: id, length: "60" }, video: false, audio: true };
    // P9 Lyria: per song — the full song (the dearer of its two kinds).
    if (id === LYRIA_MODEL) return { label: "1 qo‘shiq", values: { modelId: id, length: "song" }, video: false, audio: true };
    if (id === SFX_MODEL) return { label: "10 soniya", values: { modelId: id, duration: 10, variants: 1 }, video: false, audio: true };
    return { label: "1 daqiqa", values: { modelId: id, inputSeconds: 60 }, video: false, audio: true };
  }
  if (entry.kind === "speech") return { label: "1 000 belgi", values: { modelId: id, [speechTextParam(entry)]: "x".repeat(1000) }, video: false, speech: true };
  if (entry.kind !== "video") return { label: entry.cost.per === "job" ? "amal" : "rasm", values: { modelId: id, imageCount: 1 }, video: false };
  if (entry.cost.per === "job") return { label: "effekt", values: { modelId: id }, video: true };
  const secs = normalize(entry.params, {}).seconds;
  return { label: `${String(secs)} soniya`, values: { modelId: id }, video: true };
}

export type MediaModelItem = {
  modelId: string;
  label: string;
  maker: string;
  kind: string;
  /** What one unit is (`rasm`; `amal` for a per-job utility such as upscale). */
  unit: string;
  costUsd: number;
  costSoum: number;
  /** Provider switched on in «Provayderlar» and keyed. */
  providerReady: boolean;
  /** The admin switch (`media_model_overrides.enabled`; absent = on). */
  enabled: boolean;
  /** Sold right now (the Studio picker lists it). */
  available: boolean;
  /** The model's own markup, `null` = the global one. */
  markupOverride: number | null;
  markup: number;
  /** Price of one unit before / after the tool's `tool_pricing` %. */
  priceBase: number;
  price: number;
  marginSoum: number;
  marginPct: number | null;
  updatedAt: string | null;
};

export type MediaModelsOverview = {
  soumPerUsd: number;
  markup: number;
  step: number;
  markupMin: number;
  markupMax: number;
  models: MediaModelItem[];
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function mediaModelsOverview(): Promise<MediaModelsOverview> {
  await ensureProviderKeys();
  const [pricing, overrides, adj, videoAdj, speechAdj, audioAdj, transcribeAdj, dubAdj] = await Promise.all([
    mediaPricing(),
    readOverrides(),
    getToolPricing("studio-image"),
    getToolPricing("studio-video"),
    getToolPricing("studio-speech"),
    getToolPricing("studio-audio"),
    getToolPricing("studio-transcribe"),
    getToolPricing("studio-dub"),
  ]);
  const models = managedModelIds().map((id): MediaModelItem => {
    const entry = MEDIA_CATALOG.byId(id)!;
    const unit = unitOf(id);
    const one = unit.values;
    // The live unit cost (admin slot model), the very number the price is built from.
    const usd = costUsd(liveCostRule(entry.cost, pricing.costUsd?.[id]), normalize(entry.params, one));
    const costSoum = round2(usd * pricing.soumPerUsd);
    // The SAME functions the server charges with (the Rasm tab's / the Video tab's).
    const priceBase = unit.p10 === "studio-transcribe" ? studioTranscribePrice(one, pricing) : unit.p10 === "studio-dub" ? studioDubPrice(one, pricing) : unit.audio ? studioAudioPrice(one, pricing)! : unit.speech ? studioSpeechPrice(one, pricing)! : unit.video ? studioVideoPrice(one, pricing)! : studioImagePrice(one, pricing)!;
    const price = applyPriceAdjust(priceBase, unit.p10 === "studio-transcribe" ? transcribeAdj : unit.p10 === "studio-dub" ? dubAdj : unit.audio ? audioAdj : unit.speech ? speechAdj : unit.video ? videoAdj : adj);
    const o = overrides.get(id);
    return {
      modelId: id,
      label: entry.label,
      maker: entry.maker,
      kind: entry.kind,
      unit: unit.label,
      costUsd: usd,
      costSoum,
      providerReady: entry.routes.some((r) => isProviderEnabled(r.provider) && keyUsable(r.provider, getProviderKey(r.provider))),
      enabled: modelSwitchedOn(entry, o?.enabled),
      available: modelAvailable(id, overrides),
      markupOverride: o?.markup ?? null,
      markup: markupOf(pricing, id),
      priceBase,
      price,
      marginSoum: round2(price - costSoum),
      marginPct: price > 0 ? round2(((price - costSoum) / price) * 100) : null,
      updatedAt: o?.updatedAt ?? null,
    };
  });
  return { soumPerUsd: pricing.soumPerUsd, markup: pricing.markup, step: pricing.step, markupMin: MARKUP_MIN, markupMax: MARKUP_MAX, models };
}

type State = { enabled: boolean; markup: number | null };

function stateOf(id: string, o: ModelOverride | undefined): State {
  return { enabled: modelSwitchedOn(MEDIA_CATALOG.byId(id)!, o?.enabled), markup: o?.markup ?? null };
}

const sameState = (a: State, b: State) => a.enabled === b.enabled && a.markup === b.markup;

export function requireManagedModel(raw: unknown): string {
  if (typeof raw === "string" && managedModelIds().includes(raw)) return raw;
  throw new ApiError("Bunday media model yo'q", 404, { code: "not_found" });
}

/** `{enabled, markup}` of a body: `enabled` boolean, `markup` a number 1–20 or `null` (= the global markup). */
export function parseModelState(body: Record<string, unknown>, label = ""): State {
  const { enabled, markup } = body;
  if (typeof enabled !== "boolean") throw new ApiError(`${label}enabled true yoki false bo'lishi kerak`, 400);
  if (markup !== null && !isValidMarkup(markup)) throw new ApiError(`${label}Ustama ${MARKUP_MIN} dan ${MARKUP_MAX} gacha son bo'lishi kerak (yoki umumiy ustama uchun bo'sh)`, 400);
  // NUMERIC(6,3): what is stored is what is compared afterwards.
  return { enabled, markup: markup === null ? null : Math.round((markup as number) * 1000) / 1000 };
}

/** Optional `expected: {enabled, markup}`: the state the admin was looking at (absent = no check). */
function parseExpectedState(raw: unknown): State | null {
  if (raw === undefined) return null;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ApiError("expected {enabled, markup} bo'lishi kerak", 400);
  return parseModelState(raw as Record<string, unknown>, "expected: ");
}

async function lockModel(client: PoolClient, modelId: string): Promise<State> {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`media_model_overrides:${modelId}`]);
  return stateOf(modelId, (await readOverrides(client)).get(modelId));
}

/**
 * PUT `{modelId, enabled, markup, reason, expected?}`. In ONE transaction: upsert / delete the override row (the
 * default state — the model's default switch, global markup — is «no row») and write the audit row `media_model.update` with before/after.
 * Unchanged → 409 `state`; `expected` no longer current → 409 `stale`; both write nothing. After COMMIT this process's
 * override cache is dropped (others within 30 s; the `expectedPrice` guard covers the gap).
 */
export async function updateMediaModel(admin: AdminActor, body: Record<string, unknown>): Promise<MediaModelsOverview> {
  const modelId = requireManagedModel(body.modelId);
  const next = parseModelState(body);
  const expected = parseExpectedState(body.expected);
  const reason = parseReason(body.reason)!;
  await adminTx(admin, async (client, audit) => {
    const prev = await lockModel(client, modelId);
    if (expected && !sameState(prev, expected)) {
      throw new ApiError("Model sozlamasi boshqa admin tomonidan o'zgartirilgan. Sahifani yangilab, qayta ko'rib chiqing.", 409, { code: "stale" });
    }
    if (sameState(prev, next)) throw new ApiError("Model sozlamasi allaqachon shunday", 409, { code: "state" });
    // The stored switch says only what differs from the model's default: on, or off for a `defaultOff` model.
    const defaultOn = !MEDIA_CATALOG.byId(modelId)!.defaultOff;
    if (next.enabled === defaultOn && next.markup === null) {
      await client.query("DELETE FROM media_model_overrides WHERE model_id = $1", [modelId]);
    } else {
      await client.query(
        `INSERT INTO media_model_overrides (model_id, enabled, markup, updated_by, updated_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (model_id) DO UPDATE SET enabled = EXCLUDED.enabled, markup = EXCLUDED.markup,
           updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [modelId, next.enabled === defaultOn ? null : next.enabled, next.markup, admin.id],
      );
    }
    await audit({ action: "media_model.update", targetType: "media_model", targetId: modelId, reason, before: prev, after: next });
  });
  invalidateMediaOverrides();
  return mediaModelsOverview();
}
