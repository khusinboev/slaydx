"use client";

import { useEffect, useRef, useState } from "react";
import { Volume2 } from "lucide-react";
import { answer, answerOf, type GameState } from "@/lib/game/engine";
import { cn } from "@/lib/cn";

/**
 * TINGLASH EKRANI (AUDIT-22 WP-C) — audio → variant tanlash.
 *
 * TTS HALI YO'Q (WP-A, kalitlar egasidan): shu sababli `audioAssetId`
 * odatda `undefined` bo'ladi va ekran buni JIMGINA yutmaydi — «audio
 * hali tayyor emas» deb AYTADI va topshiriqni o'tkazib yuborishga
 * ruxsat beradi. Eshitmasdan tanlangan variant baribir yuboriladi va
 * xato deb sanaladi — bu halol, «0 ball» ekranidan ko'ra tushunarli.
 *
 * MATN KO'RSATILMAYDI, chunki uni ochiq ko'rinish BERMAYDI
 * (`PublicListeningItem` da `text` maydoni yo'q). Matnli zaxira
 * («o'qib topish» rejimi) uchun `lib/game/public.ts` ga maydon qo'shish
 * kerak — WP-C egaligida emas, hisobotda ochiq band sifatida.
 *
 * Audio `<audio>` elementi bilan: `onError` bo'lsa ham ekran yiqilmaydi,
 * shunchaki «audio yo'q» holatiga tushadi.
 */
export function Listening({
  state,
  set,
  audioSrc,
}: {
  state: GameState;
  set: (s: GameState) => void;
  /** `assetId` → havola. Berilmasa (yoki `null` qaytarsa) — audiosiz rejim. */
  audioSrc?: (assetId: string) => string | null;
}) {
  const view = state.view;
  const item = view.kind === "listening" ? view.items[state.index] : undefined;
  const src = item?.audioAssetId && audioSrc ? audioSrc(item.audioAssetId) : null;

  const ref = useRef<HTMLAudioElement | null>(null);
  const [broken, setBroken] = useState(false);

  // Topshiriq almashganda «buzuq audio» belgisi tozalanadi — aks holda
  // bitta yiqilgan fayl qolgan hammasini audiosiz qilib qo'yardi.
  useEffect(() => setBroken(false), [item?.id]);

  if (view.kind !== "listening" || !item) return null;
  const cur = answerOf(state, item.id);
  const playable = Boolean(src) && !broken;

  return (
    <div data-game="listening" data-item={item.id}>
      {playable ? (
        <>
          <audio ref={ref} src={src ?? undefined} preload="none" onError={() => setBroken(true)} data-audio />
          <button
            type="button"
            data-play
            className="bg-primary text-primary-foreground flex h-16 w-full items-center justify-center gap-2 rounded-2xl text-[17px] font-semibold"
            onClick={() => {
              const el = ref.current;
              if (!el) return;
              el.currentTime = 0;
              void el.play?.()?.catch?.(() => setBroken(true));
            }}
          >
            <Volume2 className="size-6" aria-hidden />
            Tinglash
          </button>
          <p className="text-muted-foreground mt-2 text-center text-xs">Xohlagancha qayta eshitishingiz mumkin.</p>
        </>
      ) : (
        <p className="border-input bg-muted/40 rounded-xl border border-dashed px-4 py-5 text-center text-sm" data-no-audio>
          Audio hali tayyor emas — bu topshiriqni o‘tkazib yuborishingiz mumkin.
        </p>
      )}

      <p className="text-muted-foreground mt-5 text-sm">Qaysi ma’noni eshitdingiz?</p>
      <ul className="mt-2 flex flex-col gap-2">
        {item.options.map((text, i) => (
          <li key={i}>
            <button
              type="button"
              data-option={i}
              aria-pressed={cur === i}
              className={cn(
                "min-h-12 w-full rounded-xl border px-3 py-2.5 text-left text-[15px] leading-snug",
                cur === i ? "border-primary bg-primary/15 font-medium" : "bg-background",
              )}
              onClick={() => set(answer(state, item.id, i))}
            >
              {text}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
