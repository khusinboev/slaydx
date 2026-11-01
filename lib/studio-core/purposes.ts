import type { Catalog } from "./catalog";
import type { MediaKind } from "./types";

/**
 * Purposes (docs/studio/P0-SPEC.md §3.7, PLAN §18): every place that makes media names WHAT it needs
 * (`slide.illustration`, `podcast.voice`…), never a provider. A purpose has an allowed model list and a default the
 * admin can change; `userCanChoose` purposes show the embeddable model picker.
 */
export type PurposeSpec = {
  id: string;
  kind: MediaKind;
  allowed: readonly string[];
  default: string;
  userCanChoose: boolean;
};

export type Purposes = {
  readonly specs: readonly PurposeSpec[];
  byId(id: string): PurposeSpec | null;
};

export function definePurposes(catalog: Catalog, specs: readonly PurposeSpec[]): Purposes {
  const map = new Map<string, PurposeSpec>();
  for (const s of specs) {
    if (map.has(s.id)) throw new Error(`purposes: duplicate "${s.id}"`);
    if (!s.allowed.includes(s.default)) throw new Error(`purposes: "${s.id}" default is not allowed`);
    for (const id of s.allowed) {
      const e = catalog.byId(id);
      if (!e) throw new Error(`purposes: "${s.id}" allows unknown model "${id}"`);
      if (e.kind !== s.kind) throw new Error(`purposes: "${s.id}" allows a ${e.kind} model`);
    }
    map.set(s.id, s);
  }
  return { specs, byId: (id) => map.get(id) ?? null };
}

export type Resolved = { ok: true; modelId: string } | { ok: false; reason: "unknown-purpose" | "not-allowed" | "unavailable" };

/**
 * The model a job of `purpose` runs on.
 *
 *   requested   the user's pick (picker) — must be allowed AND available, never silently swapped for another model
 *               (the price shown was for that model);
 *   storedDefault  the admin's default (ignored when it is no longer allowed);
 *   available   models whose provider is on, keyed and healthy right now.
 *
 * Without a pick: the default when available, else the first available allowed model (in allowed order), else none.
 */
export function resolveModel(
  purposes: Purposes,
  purposeId: string,
  o: { requested?: string | null; storedDefault?: string | null; available: (modelId: string) => boolean },
): Resolved {
  const spec = purposes.byId(purposeId);
  if (!spec) return { ok: false, reason: "unknown-purpose" };
  if (o.requested) {
    if (!spec.allowed.includes(o.requested)) return { ok: false, reason: "not-allowed" };
    return o.available(o.requested) ? { ok: true, modelId: o.requested } : { ok: false, reason: "unavailable" };
  }
  const first = o.storedDefault && spec.allowed.includes(o.storedDefault) ? o.storedDefault : spec.default;
  const order = [first, ...spec.allowed.filter((id) => id !== first)];
  const hit = order.find((id) => o.available(id));
  return hit ? { ok: true, modelId: hit } : { ok: false, reason: "unavailable" };
}
