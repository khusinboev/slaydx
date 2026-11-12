"use client";

import { useState } from "react";
import { Pause, Play, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { useApiSrc } from "@/lib/use-api-src";
import { uzbekFirst, type LibraryVoice } from "@/lib/media/catalog-speech";
import { previewUrl, type UserVoice } from "./voice-api";

/** The filter chips of the voice list (canvas): «Mening ovozlarim» only where the model takes clones. */
export type VoiceFilter = "all" | "male" | "female" | "mine";
export const FILTER_LABEL: Readonly<Record<VoiceFilter, string>> = { all: "Hammasi", male: "Erkak", female: "Ayol", mine: "Mening ovozlarim" };

export type VoiceRow = {
  value: string;
  name: string;
  gender: "female" | "male" | null;
  previewKey: string;
  mine: boolean;
  status?: "creating" | "ready";
  expiresAt?: string | null;
  /** A native Uzbek speaker (the «O‘zbekcha» badge, listed first). */
  native?: boolean;
  /** Short Uzbek style line («Diktor», «Suhbat»…). */
  note?: string;
};

/**
 * The rows a filter shows: the user's own clones («Mening ovozlarim», also in «Hammasi»), then the library voices (by
 * gender) with the native Uzbek voices first.
 */
export function voiceRows(library: readonly LibraryVoice[], provider: "elevenlabs" | "gemini", mine: readonly UserVoice[], takesClones: boolean, filter: VoiceFilter): VoiceRow[] {
  const own: VoiceRow[] = takesClones
    ? mine.map((v) => ({ value: v.voice, name: v.name, gender: null, previewKey: v.voice, mine: true, status: v.status, expiresAt: v.expiresAt }))
    : [];
  const lib: VoiceRow[] = uzbekFirst(library).map((v) => ({
    value: v.id,
    name: v.name,
    gender: v.gender,
    previewKey: `${provider}:${v.id}`,
    mine: false,
    ...(v.native ? { native: true } : {}),
    ...(v.note ? { note: v.note } : {}),
  }));
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

/** Section header before row `i`: «O‘zbek tilidagi ovozlar» at the first native row, «Boshqa ovozlar» after them. */
export function groupHeaderAt(rows: readonly VoiceRow[], i: number): string | null {
  const r = rows[i];
  if (!r || r.mine || !rows.some((x) => x.native)) return null;
  if (i === rows.findIndex((x) => x.native)) return "O‘zbek tilidagi ovozlar";
  if (i === rows.findIndex((x) => !x.mine && !x.native)) return "Boshqa ovozlar";
  return null;
}

/** «Ayol» on a library with native Uzbek voices (all male): why no female voice is native. */
export const FEMALE_UZ_HINT = "O‘zbek tilida so‘zlovchi ayol ovozi hozircha yo‘q — bu ovozlar o‘zbekchani biroz chet el talaffuzi bilan o‘qiydi.";

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
  uzbekHint = false,
}: {
  rows: readonly VoiceRow[];
  value: string;
  onPick: (value: string) => void;
  filter: VoiceFilter;
  onFilter: (f: VoiceFilter) => void;
  filters: readonly VoiceFilter[];
  onDelete?: (row: VoiceRow) => void;
  deleting?: boolean;
  /** The library has native Uzbek voices (all male): «Ayol» says how the female voices read Uzbek. */
  uzbekHint?: boolean;
}) {
  const [playing, setPlaying] = useState<string | null>(null);
  const [previewFailed, setPreviewFailed] = useState<string | null>(null);
  const failedName = rows.find((r) => r.previewKey === previewFailed)?.name ?? null;
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
      {uzbekHint && filter === "female" ? (
        <p className="text-muted-foreground mb-2 text-[13px] leading-snug" data-voice-female-hint>
          {FEMALE_UZ_HINT}
        </p>
      ) : null}
      {rows.length === 0 ? (
        <p className="text-muted-foreground text-[14px]" data-voice-empty>
          {filter === "mine" ? "Sizda hali klon ovoz yo‘q." : "Bu turda ovoz yo‘q."}
        </p>
      ) : (
        <ul role="radiogroup" aria-label="Ovoz" className="flex flex-col gap-1.5">
          {rows.flatMap((r, i) => {
            const on = r.value === value;
            const ready = r.status !== "creating";
            const left = r.mine ? daysLeft(r.expiresAt) : null;
            const header = groupHeaderAt(rows, i);
            const head = header ? (
              <li key={`group:${header}`} role="presentation" className="text-muted-foreground px-1 pt-1.5 text-[12.5px] font-semibold" data-voice-group={r.native ? "uz" : "other"}>
                {header}
              </li>
            ) : null;
            const row = (
              <li key={r.value} className={cn("flex items-center gap-2 rounded-[14px] border-2 p-1.5", on ? "border-primary" : "border-transparent bg-muted/50")} data-voice-row={r.value}>
                <button
                  type="button"
                  aria-label={playing === r.previewKey ? `${r.name}: to‘xtatish` : `${r.name}: namunani tinglash`}
                  data-voice-play={r.previewKey}
                  disabled={!ready}
                  onClick={() => {
                    setPreviewFailed(null);
                    setPlaying((p) => (p === r.previewKey ? null : r.previewKey));
                  }}
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
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-[15px] font-semibold">{r.name}</span>
                    {r.native ? (
                      <span className="bg-primary/10 text-primary shrink-0 rounded-full px-1.5 py-px text-[11.5px] font-semibold" data-voice-badge="uz">
                        O‘zbekcha
                      </span>
                    ) : null}
                  </span>
                  <span className="text-muted-foreground text-[12.5px]">
                    {r.mine
                      ? ready
                        ? left !== null
                          ? `Mening ovozim · ishlatilmasa ${left} kundan keyin o‘chadi`
                          : "Mening ovozim"
                        : "Tayyorlanmoqda…"
                      : [r.note, r.gender ? GENDER_LABEL[r.gender] : ""].filter(Boolean).join(" · ")}
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
            return head ? [head, row] : [row];
          })}
        </ul>
      )}
      {failedName ? (
        <p role="alert" className="text-destructive mt-2 text-[13.5px] leading-snug" data-voice-preview-error>
          «{failedName}» namunasi ochilmadi — qayta bosib ko‘ring.
        </p>
      ) : null}
      {playing ? (
        <PreviewPlayer
          key={playing}
          previewKey={playing}
          onEnd={() => setPlaying(null)}
          onFail={() => {
            setPreviewFailed(playing);
            setPlaying(null);
          }}
        />
      ) : null}
    </div>
  );
}

/** The one preview playing now (mounted only while playing, so nothing is fetched before a click). */
function PreviewPlayer({ previewKey, onEnd, onFail }: { previewKey: string; onEnd: () => void; onFail: () => void }) {
  const src = useApiSrc(previewUrl(previewKey));
  return <audio autoPlay src={src} onEnded={onEnd} onError={onFail} className="hidden" data-voice-preview={previewKey} />;
}

/** The voice list before it is usable: the failure with its retry, or the loading line. */
export function VoicesState({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  if (error) {
    return (
      <p role="alert" className="text-destructive text-[14px]" data-voices-error>
        {error}{" "}
        <button type="button" data-voices-retry onClick={onRetry} className="pointer-coarse:min-h-11 font-semibold underline underline-offset-2">
          Qayta urinish
        </button>
      </p>
    );
  }
  return (
    <p className="text-muted-foreground text-[13.5px]" role="status" data-voices-loading>
      Ovozlar yuklanmoqda...
    </p>
  );
}
