"use client";

import { useState } from "react";
import { Pause, Play, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { useApiSrc } from "@/lib/use-api-src";
import type { LibraryVoice } from "@/lib/media/catalog-speech";
import { previewUrl, type UserVoice } from "./voice-api";

/** The filter chips of the voice list (canvas): «Mening ovozlarim» only where the model takes clones. */
export type VoiceFilter = "all" | "male" | "female" | "mine";
export const FILTER_LABEL: Readonly<Record<VoiceFilter, string>> = { all: "Hammasi", male: "Erkak", female: "Ayol", mine: "Mening ovozlarim" };

export type VoiceRow = { value: string; name: string; gender: "female" | "male" | null; previewKey: string; mine: boolean; status?: "creating" | "ready"; expiresAt?: string | null };

/** The rows a filter shows: library voices (by gender) and the user's own clones («Mening ovozlarim», also in «Hammasi»). */
export function voiceRows(library: readonly LibraryVoice[], provider: "elevenlabs" | "gemini", mine: readonly UserVoice[], takesClones: boolean, filter: VoiceFilter): VoiceRow[] {
  const own: VoiceRow[] = takesClones
    ? mine.map((v) => ({ value: v.voice, name: v.name, gender: null, previewKey: v.voice, mine: true, status: v.status, expiresAt: v.expiresAt }))
    : [];
  const lib: VoiceRow[] = library.map((v) => ({ value: v.id, name: v.name, gender: v.gender, previewKey: `${provider}:${v.id}`, mine: false }));
  if (filter === "mine") return own;
  if (filter === "all") return [...own, ...lib];
  return lib.filter((r) => r.gender === filter);
}

/** Days until the 30-day unused purge (the in-app notice), `null` when unknown. */
export function daysLeft(expiresAt: string | null | undefined, now = Date.now()): number | null {
  if (!expiresAt) return null;
  const t = new Date(expiresAt).getTime();
  return Number.isFinite(t) ? Math.max(0, Math.ceil((t - now) / 86_400_000)) : null;
}

const GENDER_LABEL = { female: "Ayol", male: "Erkak" } as const;

/**
 * The voice list with its filter chips and one preview player: a row's ▶ plays the cached Uzbek preview
 * (`/api/media/voices/preview/<key>` — no provider call per click once a voice has been heard by anyone), ■ stops it;
 * one preview plays at a time. Tapping a row picks the voice. A clone row can be deleted here.
 */
export function VoiceList({
  rows,
  value,
  onPick,
  filter,
  onFilter,
  filters,
  onDelete,
  deleting,
}: {
  rows: readonly VoiceRow[];
  value: string;
  onPick: (value: string) => void;
  filter: VoiceFilter;
  onFilter: (f: VoiceFilter) => void;
  filters: readonly VoiceFilter[];
  onDelete?: (row: VoiceRow) => void;
  deleting?: boolean;
}) {
  const [playing, setPlaying] = useState<string | null>(null);
  return (
    <div data-voice-list>
      <div role="group" aria-label="Ovoz turi" className="mb-2.5 flex flex-wrap gap-1.5" data-voice-filters>
        {filters.map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            data-voice-filter={f}
            onClick={() => onFilter(f)}
            className={cn(
              "focus-visible:ring-ring pointer-coarse:min-h-11 min-h-9 rounded-full border px-3 text-[13.5px] font-semibold outline-none focus-visible:ring-2",
              filter === f ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-muted",
            )}
          >
            {FILTER_LABEL[f]}
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <p className="text-muted-foreground text-[14px]" data-voice-empty>
          {filter === "mine" ? "Sizda hali klon ovoz yo‘q." : "Bu turda ovoz yo‘q."}
        </p>
      ) : (
        <ul role="radiogroup" aria-label="Ovoz" className="flex flex-col gap-1.5">
          {rows.map((r) => {
            const on = r.value === value;
            const ready = r.status !== "creating";
            const left = r.mine ? daysLeft(r.expiresAt) : null;
            return (
              <li key={r.value} className={cn("flex items-center gap-2 rounded-[14px] border-2 p-1.5", on ? "border-primary" : "border-transparent bg-muted/50")} data-voice-row={r.value}>
                <button
                  type="button"
                  aria-label={playing === r.previewKey ? `${r.name}: to‘xtatish` : `${r.name}: namunani tinglash`}
                  data-voice-play={r.previewKey}
                  disabled={!ready}
                  onClick={() => setPlaying((p) => (p === r.previewKey ? null : r.previewKey))}
                  className="bg-card focus-visible:ring-ring flex size-11 shrink-0 items-center justify-center rounded-full border outline-none focus-visible:ring-2 disabled:opacity-40"
                >
                  {playing === r.previewKey ? <Pause className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={!ready}
                  data-voice-pick={r.value}
                  onClick={() => onPick(r.value)}
                  className="focus-visible:ring-ring flex min-h-11 min-w-0 flex-1 flex-col justify-center rounded-[10px] px-1 text-left outline-none focus-visible:ring-2 disabled:opacity-60"
                >
                  <span className="truncate text-[15px] font-semibold">{r.name}</span>
                  <span className="text-muted-foreground text-[12.5px]">
                    {r.mine ? (ready ? (left !== null ? `Mening ovozim · ishlatilmasa ${left} kundan keyin o‘chadi` : "Mening ovozim") : "Tayyorlanmoqda…") : r.gender ? GENDER_LABEL[r.gender] : ""}
                  </span>
                </button>
                {r.mine && onDelete && ready ? (
                  <button
                    type="button"
                    aria-label={`${r.name} ovozini o‘chirish`}
                    data-voice-delete={r.value}
                    disabled={deleting}
                    onClick={() => onDelete(r)}
                    className="hover:bg-card focus-visible:ring-ring text-destructive flex size-11 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-2 disabled:opacity-40"
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {playing ? <PreviewPlayer key={playing} previewKey={playing} onEnd={() => setPlaying(null)} /> : null}
    </div>
  );
}

/** The one preview playing now (mounted only while playing, so nothing is fetched before a click). */
function PreviewPlayer({ previewKey, onEnd }: { previewKey: string; onEnd: () => void }) {
  const src = useApiSrc(previewUrl(previewKey));
  return <audio autoPlay src={src} onEnded={onEnd} onError={onEnd} className="hidden" data-voice-preview={previewKey} />;
}
