"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, Square, Upload } from "lucide-react";
import { cn } from "@/lib/cn";
import { Card } from "@/components/forms/compact";
import { Field } from "@/components/forms/shared";
import { AUDIO_INPUT_MAX_BYTES, AUDIO_INPUT_MAX_SECONDS, AUDIO_INPUT_MIN_SECONDS } from "@/lib/media/catalog-audio";
import { AUDIO_INPUT_TOS } from "@/lib/media/studio-audio";
import { prepareSample, type PreparedSample } from "../voice/wav";

const BTN =
  "focus-visible:ring-ring bg-card hover:bg-muted inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[12px] border px-3 text-[14px] font-semibold outline-none focus-visible:ring-2 disabled:opacity-50";

/** Why a prepared input cannot be uploaded (Uzbek), `null` when it can — the server's limits, checked first in the browser. */
export function inputBlocker(s: Pick<PreparedSample, "seconds" | "blob">): string | null {
  if (s.seconds < AUDIO_INPUT_MIN_SECONDS) return `Audio kamida ${AUDIO_INPUT_MIN_SECONDS} soniya bo‘lsin.`;
  if (s.seconds > AUDIO_INPUT_MAX_SECONDS + 0.5) return `Audio ${AUDIO_INPUT_MAX_SECONDS / 60} daqiqadan oshmasin.`;
  if (s.blob.size > AUDIO_INPUT_MAX_BYTES) return "Audio 25 MB dan katta.";
  return null;
}

export const fmtSeconds = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/**
 * The audio a voice-changer / isolator job works on (docs/studio/P6-SPEC.md): record (MediaRecorder) or pick a file;
 * the browser converts it with the P5 converter (`prepareSample`: 16-bit mono WAV 24 kHz, an MP3 as is) and hands it to
 * `onPrepared`, which uploads it. The row is the `inputId` / `inputSeconds` fields: the server-measured billed seconds
 * are shown once uploaded — the same number the price is computed from. The ToS line is text (no checkbox).
 */
export function AudioInputRow({
  seconds,
  uploading,
  error,
  onPrepared,
}: {
  /** Billed seconds of the uploaded input, `null` when none is uploaded yet. */
  seconds: number | null;
  uploading: boolean;
  error: string | null;
  onPrepared: (s: PreparedSample) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [local, setLocal] = useState<string | null>(null);
  const rec = useRef<{ mr: MediaRecorder; stream: MediaStream; timer: ReturnType<typeof setInterval> } | null>(null);

  useEffect(
    () => () => {
      const r = rec.current;
      if (r) {
        clearInterval(r.timer);
        r.stream.getTracks().forEach((t) => t.stop());
      }
    },
    [],
  );

  async function take(blob: Blob) {
    setLocal(null);
    try {
      const prepared = await prepareSample(blob);
      const bad = inputBlocker(prepared);
      if (bad) {
        setLocal(bad);
        return;
      }
      onPrepared(prepared);
    } catch (e) {
      setLocal(e instanceof Error ? e.message : "Audio o‘qilmadi");
    }
  }

  function stop() {
    const r = rec.current;
    if (!r) return;
    clearInterval(r.timer);
    rec.current = null;
    if (r.mr.state !== "inactive") r.mr.stop();
    setRecording(false);
  }

  async function start() {
    setLocal(null);
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setLocal("Bu brauzerda yozib bo‘lmaydi — tayyor faylni yuklang.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        void take(new Blob(chunks, { type: mr.mimeType || "audio/webm" }));
      };
      const t0 = Date.now();
      const timer = setInterval(() => {
        const s = Math.floor((Date.now() - t0) / 1000);
        setElapsed(s);
        if (s >= AUDIO_INPUT_MAX_SECONDS) stop();
      }, 250);
      rec.current = { mr, stream, timer };
      setElapsed(0);
      mr.start(1000);
      setRecording(true);
    } catch {
      setLocal("Mikrofonga ruxsat berilmadi.");
    }
  }

  const message = local || error;
  return (
    <Card title="Audio yozuv">
      <div className="flex flex-col gap-2.5" data-audio-input>
        <p className="text-muted-foreground text-[13.5px] leading-snug">
          {AUDIO_INPUT_MIN_SECONDS} soniyadan {AUDIO_INPUT_MAX_SECONDS / 60} daqiqagacha. Narx yozuv uzunligiga qarab hisoblanadi.
        </p>
        <Field id="inputId">
          <div className="flex flex-wrap items-center gap-2">
            {recording ? (
              <button type="button" onClick={stop} className={cn(BTN, "border-destructive text-destructive")} data-audio-stop>
                <Square className="size-4" aria-hidden />
                To‘xtatish · {fmtSeconds(elapsed)}
              </button>
            ) : (
              <button type="button" onClick={() => void start()} disabled={uploading} className={BTN} data-audio-record>
                <Mic className="size-4" aria-hidden />
                Yozib olish
              </button>
            )}
            <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading || recording} className={BTN} data-audio-upload>
              <Upload className="size-4" aria-hidden />
              Fayl yuklash
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="audio/*"
              hidden
              data-audio-file
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void take(f);
              }}
            />
          </div>
        </Field>
        <Field id="inputSeconds">
          <p className="text-[13.5px] font-semibold tabular-nums" data-audio-input-seconds role="status">
            {uploading ? "Yuklanmoqda..." : seconds !== null ? `Yuklandi: ${fmtSeconds(seconds)} (${seconds} s)` : "Hali audio tanlanmagan"}
          </p>
        </Field>
        <p className="text-muted-foreground text-[12.5px] leading-snug" data-audio-tos>
          {AUDIO_INPUT_TOS} Birovning ovozini roziligisiz ishlatish, aldash yoki tuhmat uchun foydalanish taqiqlanadi. Yuklangan fayl 1 kundan keyin
          o‘chiriladi.
        </p>
        {message ? (
          <p role="alert" className="text-destructive text-[14px]" data-audio-input-error>
            {message}
          </p>
        ) : null}
      </div>
    </Card>
  );
}
