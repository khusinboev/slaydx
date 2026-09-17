"use client";

import { Download, Mic } from "lucide-react";
import type { AcademicDoc } from "@/lib/generation/types";

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
 */
export function AudioViewer({ doc, gen }: { doc: AcademicDoc; gen: { id: string; fileName?: string } }) {
  const audio = doc.audio;
  const src = `/api/generations/${gen.id}/file?inline=1`;
  const script = audio?.script ?? [];
  // Ikki ovozli suhbatda replikalar rol bo'yicha ajratiladi (A — chap, B — o'ng rang).
  const speakers = [...new Set(script.map((l) => l.speaker))];

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[var(--bg,#fafafa)]">
      <div className="no-print flex shrink-0 flex-col gap-3 border-b border-black/10 px-4 py-3 sm:px-6">
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
        <a
          href={`/api/generations/${gen.id}/file`}
          className="inline-flex w-fit items-center gap-2 rounded-lg border border-black/10 px-3 py-1.5 text-[13px] text-black/70 hover:bg-black/5"
          rel="noopener"
        >
          <Download className="size-4" /> MP3 yuklab olish
        </a>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-4 py-5 sm:px-6">
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
    </div>
  );
}

/** «3:05» — soniya emas, DAQIQA ko'rsatiladi (paket ham daqiqada sotiladi). */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
