"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Mic, Square, Upload, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatSom } from "@/lib/format";
import { Card, Row } from "@/components/forms/compact";
import { Field } from "@/components/forms/shared";
import { TextInput } from "@/components/forms/fields";
import { prepareSample, type PreparedSample } from "./wav";
import type { CloneOffer } from "./voice-api";

const BTN =
  "focus-visible:ring-ring bg-card hover:bg-muted pointer-coarse:min-h-11 inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[12px] border px-3 text-[14px] font-semibold outline-none focus-visible:ring-2 disabled:opacity-50";

/** What the panel hands to the tab when the user presses «Klonlash». */
export type CloneRequest = { name: string; sample: PreparedSample; consent: true };

/** Why «Klonlash» is not pressable yet (Uzbek), `null` when it is. The consent checkbox is mandatory. */
export function cloneBlocker(o: { name: string; sample: PreparedSample | null; consent: boolean; offer: CloneOffer }): string | null {
  if (!o.sample) return "Avval ovozingizni yozing yoki fayl yuklang.";
  if (o.sample.seconds < o.offer.minSeconds) return `Yozuv kamida ${o.offer.minSeconds} soniya bo‘lsin.`;
  if (o.sample.seconds > o.offer.maxSeconds) return `Yozuv ${Math.round(o.offer.maxSeconds / 60)} daqiqadan oshmasin.`;
  if (o.sample.blob.size > o.offer.maxBytes) return "Yozuv 10 MB dan katta.";
  if (!o.name.trim()) return "Ovozga nom bering.";
  if (!o.consent) return "«Bu ovozdan foydalanishga haqqim bor» belgisini qo‘ying.";
  return null;
}

/**
 * «+ O'z ovozimni klonlash» (docs/studio/P5-SPEC.md): record (MediaRecorder) or upload ≥ 30 s of speech, name it, tick
 * the mandatory consent («Bu ovozdan foydalanishga haqqim bor» — stored with the sample), pay the fixed price. The
 * ToS line says what is forbidden and that an unused clone is deleted after N days.
 */
export function ClonePanel({
  offer,
  price,
  busy,
  error,
  onSubmit,
  onClose,
}: {
  offer: CloneOffer;
  /** The price on the button (`studio.clone_price` + the tool's %). */
  price: number;
  busy: boolean;
  error: string | null;
  onSubmit: (r: CloneRequest) => void;
  onClose: () => void;
}) {
  const consentId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("Mening ovozim");
  const [sample, setSample] = useState<PreparedSample | null>(null);
  const [consent, setConsent] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [local, setLocal] = useState<string | null>(null);
  const rec = useRef<{ mr: MediaRecorder; stream: MediaStream; chunks: Blob[]; timer: ReturnType<typeof setInterval> } | null>(null);

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
      setSample(await prepareSample(blob));
    } catch (e) {
      setSample(null);
      setLocal(e instanceof Error ? e.message : "Yozuv o‘qilmadi");
    }
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
        // Never past the server's maximum.
        if (s >= offer.maxSeconds) stop();
      }, 250);
      rec.current = { mr, stream, chunks, timer };
      setElapsed(0);
      setSample(null);
      mr.start(1000);
      setRecording(true);
    } catch {
      setLocal("Mikrofonga ruxsat berilmadi.");
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

  const blocker = cloneBlocker({ name, sample, consent, offer });
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  return (
    <Card title="O‘z ovozimni klonlash">
      <div data-clone-panel className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-2">
          <p className="text-muted-foreground text-[13.5px] leading-snug">
            Kamida {offer.minSeconds} soniya tinch joyda, aniq gapiring (1–2 daqiqa yaxshiroq). Klon bilan ovozlash oddiy ElevenLabs narxida.
          </p>
          <button type="button" aria-label="Yopish" onClick={onClose} className="hover:bg-muted focus-visible:ring-ring flex size-11 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-2" data-clone-close>
            <X className="size-4" aria-hidden />
          </button>
        </div>
        <Row label="Ovoz nomi">
          <Field id="name">
            <TextInput value={name} onChange={(v) => setName(v.slice(0, 40))} />
          </Field>
        </Row>
        <Row label="Yozuv" wide>
          <Field id="sampleId">
            <div className="flex flex-wrap items-center gap-2">
              {recording ? (
                <button type="button" onClick={stop} className={cn(BTN, "border-destructive text-destructive")} data-clone-stop>
                  <Square className="size-4" aria-hidden />
                  To‘xtatish · {fmt(elapsed)}
                </button>
              ) : (
                <button type="button" onClick={() => void start()} disabled={busy} className={BTN} data-clone-record>
                  <Mic className="size-4" aria-hidden />
                  Yozib olish
                </button>
              )}
              <button type="button" onClick={() => fileRef.current?.click()} disabled={busy || recording} className={BTN} data-clone-upload>
                <Upload className="size-4" aria-hidden />
                Fayl yuklash
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="audio/*"
                hidden
                data-clone-file
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void take(f);
                }}
              />
              {sample ? (
                <span className="text-[13.5px] font-semibold tabular-nums" data-clone-sample-seconds>
                  Yozuv: {fmt(sample.seconds)}
                </span>
              ) : null}
            </div>
          </Field>
        </Row>
        <label htmlFor={consentId} className="flex items-start gap-2.5 text-[14px] leading-snug" data-clone-consent-row>
          <input id={consentId} type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="accent-primary mt-0.5 size-5 shrink-0" data-clone-consent />
          <span>{offer.consentText || "Bu ovozdan foydalanishga haqqim bor."}</span>
        </label>
        <p className="text-muted-foreground text-[12.5px] leading-snug" data-clone-tos>
          Birovning ovozini roziligisiz klonlash va undan aldash, tuhmat yoki firibgarlik uchun foydalanish taqiqlanadi — buzilsa klon o‘chiriladi va
          hisob bloklanadi. Rozilik vaqti va manzili qayd etiladi. Klon {offer.unusedDays} kun ishlatilmasa o‘chiriladi (oldindan ogohlantiramiz). Bitta
          foydalanuvchida bitta klon; o‘chirib, yangisini yaratish mumkin (qayta to‘lanadi).
        </p>
        {local || error ? (
          <p role="alert" className="text-destructive text-[14px]" data-clone-error>
            {local || error}
          </p>
        ) : null}
        <button
          type="button"
          disabled={busy || recording || blocker !== null}
          onClick={() => sample && consent && onSubmit({ name: name.trim(), sample, consent: true })}
          className="bg-primary text-primary-foreground focus-visible:ring-ring min-h-12 rounded-[14px] px-4 text-[15px] font-bold outline-none focus-visible:ring-2 disabled:opacity-50"
          data-clone-submit
          title={blocker ?? undefined}
        >
          {busy ? "Yuborilmoqda..." : `Klonlash · ${formatSom(price)}`}
        </button>
        {blocker && !busy ? (
          <p className="text-muted-foreground text-[13px]" data-clone-blocker>
            {blocker}
          </p>
        ) : null}
      </div>
    </Card>
  );
}
