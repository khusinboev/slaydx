"use client";

import { answer, answerOf, flip, type GameState } from "@/lib/game/engine";
import { cn } from "@/lib/cn";

/**
 * FLESH KARTALAR EKRANI (AUDIT-22 WP-C/R) — TAKRORLASH mashqi.
 *
 * ORQA YUZ (`card.back`, AUDIT-22 R) ENDI bor: `publicGameView` uni
 * ochiq ko'rinishga chiqaradi, chunki bu «javob sizishi» emas —
 * kartalarda server tekshiradigan to'g'ri javob umuman yo'q
 * (`score.ts`). «Ag'darish» baribir javobni AVTOMATIK ko'rsatmaydi:
 * o'yinchi avval javobni ICHIDA aytadi, SO'NG kartani bosadi va orqa
 * yuzni ko'rib o'zini halol baholaydi.
 *
 * Ball shundan: «bildim» soni (`score.ts` izohida — bu imtihon bahosi
 * emas, takrorlash ustuni). Ikki tugma ham javobni YOZADI, ya'ni
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
          <span className="text-muted-foreground text-[16px] leading-snug text-balance" data-back>
            {card.back}
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
