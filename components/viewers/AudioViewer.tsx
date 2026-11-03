"use client";

import { Mic } from "lucide-react";
import type { AcademicDoc, StudioAudioDoc } from "@/lib/generation/types";
import { useApiSrc } from "@/lib/use-api-src";

/**
 * AUDIO KO'RUVCHISI (AUDIT-22 R0) — podkast va tabriknoma.
 *
 * «Ko'rdim = oldim» ning audio varianti: pleer AYNAN yuklab olinadigan
 * faylni o'ynatadi (`/api/generations/{id}/file?inline=1`, `ImageViewer`
 * naqshi — u ham aktiv URL ini hujjatdan oladi), transkript esa
 * `doc.audio.script` dan chiziladi, ya'ni eshitilgan matn bilan
 * ekrandagi matn BITTA manbadan keladi. Ilgari shunday ko'ruvchi
 * umuman yo'q edi va MP3 `WordViewer` ga tushib, bo'sh varaq chizardi.
 *
 * `inline=1` SHART: `attachment` bilan Chrome `<audio>` manbasini
 * o'ynatmasdan yuklab olishga o'tadi (Tarjimon 2 dagi PDF iframe bilan
 * bir xil sabab). CSP `media-src 'self'` — `next.config.ts` da.
 *
 * Viewer redesign V4: `flow` ramka — ichki scroll qutisi yo'q, transkript
 * sahifa oqimida (sahifa scroll bo'ladi); pleer bloki natija sarlavhasi
 * ostida `sticky` (md+; telefonda oqimda, balandlikni yemasin) — uzun transkript o'qilayotganda ham to'xtatish/surish
 * qo'l ostida. Yuklab olish: natija sarlavhasidagi «Yuklab olish» (MP3)
 * BITTA aniq yuklash; ko'ruvchi ichidagi ikkinchi «MP3 yuklab olish»
 * havolasi olib tashlandi (ikkilanish). Ekspire bo'lgan/faylsiz
 * generatsiyada sarlavha tugmasi ham, pleer ham ishlamaydi — mos.
 */
export function AudioViewer({ doc, gen }: { doc: AcademicDoc; gen: { id: string; fileName?: string } }) {
  // Studio «Ovoz» (P5) results carry `doc.speech`: the same player, its lines as the transcript.
  // Studio «Audio» (P6) results carry `doc.studioAudio`: the same player for the result file, its details below.
  const audio: { seconds?: number; script: { speaker: string; text: string }[] } | undefined =
    doc.audio ??
    (doc.speech ? { seconds: doc.speech.seconds, script: doc.speech.lines } : doc.studioAudio ? { seconds: doc.studioAudio.seconds, script: [] } : doc.mix ? { seconds: doc.mix.seconds, script: [] } : undefined);
  // Bearer-mode webviews get the bytes through a `blob:` URL (docs/auth/COOKIELESS.md); unchanged otherwise.
  const src = useApiSrc(`/api/generations/${gen.id}/file?inline=1`);
  const script = audio?.script ?? [];
  // Ikki ovozli suhbatda replikalar rol bo'yicha ajratiladi (A — chap, B — o'ng rang).
  const speakers = [...new Set(script.map((l) => l.speaker))];

  return (
    <div className="flex flex-1 flex-col bg-[var(--bg,#fafafa)]" data-audio-viewer>
      <div
        className="no-print z-10 flex shrink-0 flex-col gap-3 border-b border-black/10 bg-[var(--bg,#fafafa)] px-4 py-3 sm:px-6 md:sticky md:top-[var(--result-header-h,0px)]"
        data-audio-player
      >
        <div className="flex items-center gap-2 text-[13px] text-black/70">
          <Mic className="size-4 shrink-0" />
          <span className="truncate font-medium">{doc.meta.topic}</span>
          {audio?.seconds ? <span className="text-black/40">{formatDuration(audio.seconds)}</span> : null}
        </div>
        {audio ? (
          <audio className="w-full" controls preload="metadata" src={src}>
            Brauzeringiz audio pleerni qo‘llab-quvvatlamaydi.
          </audio>
        ) : null}
      </div>

      {doc.studioAudio ? (
        <StudioAudioDetails doc={doc.studioAudio} genId={gen.id} />
      ) : doc.mix ? null : (
        <div className="flex-1 px-4 py-5 sm:px-6" data-audio-transcript>
          <div className="mx-auto max-w-3xl">
            <h2 className="mb-3 text-[13px] font-semibold tracking-wide text-black/50 uppercase">Transkript</h2>
            {script.length === 0 ? (
              /*
               * Ssenariy yo'q — dvigatel ishlamagan (WP-A gacha DOIM
               * shunday). Matn `rasm` ko'ruvchisidan ko'chirilgan: bu
               * foydalanuvchi uchun «xizmat javob bermadi, pul qaytadi»
               * degani, «modul hali yozilmagan» emas.
               */
              <p className="text-sm text-black/55">Ssenariy yaratilmadi — farq balansingizga qaytarildi. Qayta urinib ko‘ring.</p>
            ) : (
              <ol className="space-y-3">
                {script.map((line, i) => (
                  <li key={i} className="flex gap-3">
                    <span
                      className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
                      style={{
                        background: speakers.indexOf(line.speaker) === 0 ? "rgb(168 85 247 / 0.12)" : "rgb(14 165 233 / 0.12)",
                        color: speakers.indexOf(line.speaker) === 0 ? "rgb(126 34 206)" : "rgb(2 132 199)",
                      }}
                    >
                      {line.speaker}
                    </span>
                    <p className="text-[15px] leading-relaxed text-black/80">{line.text}</p>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const MODE_LABEL: Readonly<Record<StudioAudioDoc["mode"], string>> = {
  music: "Musiqa",
  sfx: "Ovoz effekti",
  "voice-changer": "Ovozni almashtirish",
  isolate: "Shovqindan tozalash",
};

/**
 * Studio «Audio» (P6): what was made (mode, description, target voice, billed input length) and, for several
 * sound-effect variants, one player + download per variant (the generation's own assets; the first is the result file).
 */
function StudioAudioDetails({ doc, genId }: { doc: StudioAudioDoc; genId: string }) {
  return (
    <div className="flex-1 px-4 py-5 sm:px-6" data-audio-details>
      <div className="mx-auto flex max-w-3xl flex-col gap-3">
        <p className="text-[13px] font-semibold tracking-wide text-black/50 uppercase">{MODE_LABEL[doc.mode] ?? "Audio"}</p>
        {doc.prompt ? <p className="text-[15px] leading-relaxed break-words text-black/80">{doc.prompt}</p> : null}
        {doc.voices.length ? <p className="text-[14px] text-black/70">Ovoz: {doc.voices.join(", ")}</p> : null}
        {doc.inputSeconds ? <p className="text-[14px] text-black/70">Yuklangan yozuv: {formatDuration(doc.inputSeconds)}</p> : null}
        {doc.variants.length > 1 ? (
          <ol className="flex flex-col gap-3" data-audio-variants>
            {doc.variants.map((v, i) => (
              <Variant key={v.assetId} genId={genId} assetId={v.assetId} index={i} seconds={v.seconds} />
            ))}
          </ol>
        ) : null}
      </div>
    </div>
  );
}

function Variant({ genId, assetId, index, seconds }: { genId: string; assetId: string; index: number; seconds: number }) {
  const url = `/api/generations/${genId}/assets/${assetId}`;
  const src = useApiSrc(url);
  return (
    <li className="flex flex-col gap-1.5 rounded-[14px] border border-black/10 p-3" data-audio-variant={index + 1}>
      <div className="flex items-center justify-between gap-2 text-[13.5px] font-semibold text-black/75">
        <span>
          {index + 1}-variant · {formatDuration(seconds)}
        </span>
        <a
          href={src}
          download={`effekt-${index + 1}.mp3`}
          className="pointer-coarse:min-h-11 inline-flex min-h-9 items-center underline underline-offset-2"
          data-variant-download
        >
          Yuklab olish (MP3)
        </a>
      </div>
      <audio className="w-full" controls preload="none" src={src}>
        Brauzeringiz audio pleerni qo‘llab-quvvatlamaydi.
      </audio>
    </li>
  );
}

/** «3:05» — soniya emas, DAQIQA ko'rsatiladi (paket ham daqiqada sotiladi). */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
