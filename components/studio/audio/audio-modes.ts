/**
 * The «Audio» tab's modes as the catalog offers them now (pure, no React: the tab, the handoffs and the tests share it).
 */
import type { ClientEntry } from "@/lib/studio-core";
import { AUDIO_MODES, type AudioMode } from "@/lib/media/catalog-audio";

/**
 * The modes the catalog offers now, in chip order (none while `studio.audio.enabled` is off): `entries` = the mode's
 * offered models in their order, `entry` = the first of them (the default).
 */
export function offeredModes(models: readonly ClientEntry[]): { mode: AudioMode; label: string; entry: ClientEntry; entries: ClientEntry[] }[] {
  return AUDIO_MODES.flatMap((m) => {
    const entries = m.models.flatMap((id) => models.filter((e) => e.id === id));
    return entries.length ? [{ mode: m.mode, label: m.label, entry: entries[0]!, entries }] : [];
  });
}

/** A model's name in its mode's picker: the maker when the entry carries the mode's own name («Musiqa»), else both. */
export function audioModelLabel(entry: Pick<ClientEntry, "label" | "maker">, modeLabel: string): string {
  return entry.label === modeLabel ? entry.maker : `${entry.maker} ${entry.label}`;
}
