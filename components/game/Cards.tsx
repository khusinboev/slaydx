"use client";

import { answer, answerOf, flip, type GameState } from "@/lib/game/engine";
import { cn } from "@/lib/cn";

/**
 * FLESH KARTALAR EKRANI (AUDIT-22 WP-C) — TAKRORLASH mashqi.
 *
 * ORQA YUZ BU YERDA YO'Q va bo'lmaydi: `publicGameView` faqat old yuzni
 * beradi (karta to'plami bosma hujjatda allaqachon bor, ochiq havola
 * esa uning nusxasi emas). Shuning uchun «ag'darish» — javobni
 * KO'RSATISH emas, o'zini tekshirishga O'TISH: o'yinchi javobni ichida
 * aytadi, kartani ag'daradi va halol belgilaydi.
 *
 * Ball ham shundan: «bildim» soni (`score.ts` izohida — bu imtihon
 * bahosi emas, takrorlash ustuni). Ikki tugma ham javobni YOZADI, ya'ni
 * «bilmadim» ham progressda sanaladi: o'quvchi to'plamni oxirigacha
 * ko'rib chiqsin, yarmida tashlab ketmasin.
 */
export function Cards({ state, set }: { state: GameState; set: (s: GameState) => void }) {
  const view = state.view;
  if (view.kind !== "flashcards") return null;
  const card = view.cards[state.index];
  if (!card) return null;
  const mark = answerOf(state, card.id);

  return (
    <div data-game="flashcards" data-card={card.id}>
      <button
        type="button"
        data-flip
        aria-pressed={state.flipped}
        className="bg-background flex min-h-40 w-full items-center justify-center rounded-2xl border px-4 py-8 text-center"
        onClick={() => set(flip(state))}
      >
        {state.flipped ? (
          <span className="text-muted-foreground text-[15px] leading-snug">
            Javobni esladingizmi? O‘zingizni halol baholang.
          </span>
        ) : (
          <span className="text-[19px] leading-snug font-semibold text-balance">{card.front}</span>
        )}
      </button>

      {!state.flipped ? (
        <p className="text-muted-foreground mt-2 text-center text-xs">
          Javobni o‘ylang, so‘ng kartani bosing.
        </p>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {[
            { value: false, label: "Bilmadim", tone: "border-input" },
            { value: true, label: "Bildim", tone: "border-primary" },
          ].map((o) => (
            <button
              key={String(o.value)}
              type="button"
              data-know={String(o.value)}
              aria-pressed={mark === o.value}
              className={cn(
                "h-12 rounded-xl border text-[15px] font-medium",
                mark === o.value ? "border-primary bg-primary/15" : `bg-background ${o.tone}`,
              )}
              onClick={() => set(answer(state, card.id, o.value))}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
