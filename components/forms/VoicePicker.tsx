"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Play, Square } from "lucide-react";
import { cn } from "@/lib/cn";
import { AUDIO_VOICE_OPTIONS } from "@/lib/generation/audio/registry";
import type { TtsVoiceChoice } from "@/lib/generation/tts/types";

/**
 * Voice choice of the podcast / greeting form: two cards (female / male), each with
 * a ▶︎ button that plays a short sample of that voice.
 *
 * - The card (a `role="radio"` button) and its ▶︎ button are SIBLINGS, never nested
 *   (a button inside a radio button is invalid markup and breaks screen readers).
 * - One sample plays at a time: starting one pauses and rewinds the other; pressing
 *   the playing one again stops it. Nothing plays by itself (`preload="none"`, no
 *   autoplay), so the first byte is fetched only after a tap — also required by the
 *   Telegram Mini App webview, which blocks audio that does not start from a gesture.
 * - Playing a sample does NOT change the selected voice; choosing is a separate tap.
 * - The sample files are generated once (`AUDIO_VOICE_OPTIONS`), never at runtime. A
 *   file that fails to load (offline, blocked) leaves a short status line, not a
 *   broken form.
 */
export function VoicePicker({ value, onChange }: { value: TtsVoiceChoice; onChange: (v: TtsVoiceChoice) => void }) {
  const groupId = useId();
  const [playing, setPlaying] = useState<TtsVoiceChoice | null>(null);
  const [failed, setFailed] = useState(false);
  const audios = useRef<Partial<Record<TtsVoiceChoice, HTMLAudioElement>>>({});
  // Mirrors `playing` for code that must not wait for a render (unmount, quick double taps).
  const active = useRef<TtsVoiceChoice | null>(null);

  const setActive = useCallback((v: TtsVoiceChoice | null) => {
    active.current = v;
    setPlaying(v);
  }, []);

  /** Pause and rewind the playing sample unless it is `keep`. */
  const stop = useCallback((keep?: TtsVoiceChoice) => {
    const cur = active.current;
    if (!cur || cur === keep) return;
    const a = audios.current[cur];
    if (!a) return;
    a.pause();
    try {
      a.currentTime = 0;
    } catch {
      // a media element that has not loaded metadata may refuse to seek
    }
  }, []);

  // Leaving the form must silence a sample that is still playing.
  useEffect(() => () => stop(), [stop]);

  function toggle(voice: TtsVoiceChoice) {
    const a = audios.current[voice];
    if (!a) return;
    setFailed(false);
    if (active.current === voice) {
      a.pause();
      setActive(null);
      return;
    }
    stop(voice);
    try {
      a.currentTime = 0;
    } catch {
      // see stop()
    }
    setActive(voice);
    // play() rejects when the webview refuses it or the file is missing — drop the "playing" state.
    void a.play()?.catch?.(() => {
      if (active.current === voice) setActive(null);
      setFailed(true);
    });
  }

  const idle = (voice: TtsVoiceChoice) => {
    if (active.current === voice) setActive(null);
  };

  return (
    <div>
      <div role="radiogroup" aria-label="Ovoz" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {AUDIO_VOICE_OPTIONS.map((o) => {
          const on = value === o.value;
          const isPlaying = playing === o.value;
          const labelId = `${groupId}-${o.value}`;
          return (
            <div
              key={o.value}
              data-voice-option={o.value}
              className={cn("flex items-center gap-1 rounded-[14px] border pr-1.5 transition-colors", on ? "border-primary bg-primary/5" : "border-input bg-card")}
            >
              <button
                type="button"
                role="radio"
                id={labelId}
                aria-checked={on}
                onClick={() => onChange(o.value)}
                className={cn(
                  "focus-visible:ring-ring pointer-coarse:min-h-11 min-w-0 flex-1 rounded-[14px] px-3 py-2.5 text-left text-[15px] leading-snug outline-none focus-visible:ring-2",
                  on ? "text-foreground font-semibold" : "text-muted-foreground hover:text-foreground font-medium",
                )}
              >
                {o.label}
              </button>
              <button
                type="button"
                aria-label="Namunani tinglash"
                title="Namunani tinglash"
                aria-pressed={isPlaying}
                aria-describedby={labelId}
                data-voice-sample={o.value}
                onClick={() => toggle(o.value)}
                className={cn(
                  "focus-visible:ring-ring pointer-coarse:size-11 grid size-9 shrink-0 place-items-center rounded-full border outline-none transition-colors focus-visible:ring-2",
                  isPlaying ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card text-foreground hover:bg-muted",
                )}
              >
                {isPlaying ? <Square className="size-3.5 fill-current" aria-hidden /> : <Play className="size-4 fill-current" aria-hidden />}
              </button>
              <audio
                ref={(el) => {
                  // Never cleared on detach: React nulls refs BEFORE passive-effect cleanups run,
                  // and the unmount cleanup still has to reach these elements to pause them.
                  if (el) audios.current[o.value] = el;
                }}
                src={o.sample}
                preload="none"
                data-voice-audio={o.value}
                onEnded={() => idle(o.value)}
                onPause={() => idle(o.value)}
                onError={() => {
                  idle(o.value);
                  setFailed(true);
                }}
              />
            </div>
          );
        })}
      </div>
      {failed ? (
        <p role="status" className="text-muted-foreground mt-1 text-[13px]">
          Namunani yuklab bo‘lmadi — ovozni baribir tanlashingiz mumkin.
        </p>
      ) : null}
    </div>
  );
}
