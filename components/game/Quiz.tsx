"use client";

import { answer, answerOf, toggleIndex, type GameState } from "@/lib/game/engine";
import { cn } from "@/lib/cn";

/**
 * TEST EKRANI (AUDIT-22 WP-C) — savolma-savol, uch tur.
 *
 * `single` — bitta variant, `multi` — bir nechta (tugma «belgilangan»
 * holatini saqlaydi), `truefalse` — ikkita katta tugma (variantlar
 * ro'yxati ochiq ko'rinishda ATAYLAB bo'sh, `public.ts`).
 *
 * TARTIB: variantlar `publicOptionOrder` aralashtirgan holda keladi va
 * bu yerda QAYTA tartiblanmaydi — `data-option` indeksi aynan payload ga
 * ketadigan son (`lib/game/engine.ts` 1-shartnomasi).
 */
export function Quiz({ state, set }: { state: GameState; set: (s: GameState) => void }) {
  const view = state.view;
  if (view.kind !== "quiz") return null;
  const q = view.questions[state.index];
  if (!q) return null;
  const cur = answerOf(state, q.id);

  return (
    <div data-game="quiz" data-qid={q.id}>
      <p className="text-[17px] leading-snug font-medium text-balance">{q.stem}</p>

      {q.kind === "multi" ? (
        <p className="text-muted-foreground mt-1.5 text-xs">Bir nechta javobni belgilang.</p>
      ) : null}

      {q.kind === "truefalse" ? (
        <div className="mt-4 grid grid-cols-2 gap-2">
          {[
            { value: true, label: "To‘g‘ri" },
            { value: false, label: "Noto‘g‘ri" },
          ].map((o) => (
            <button
              key={String(o.value)}
              type="button"
              data-tf={String(o.value)}
              aria-pressed={cur === o.value}
              className={cn(
                "h-14 rounded-xl border text-[16px] font-medium",
                cur === o.value ? "border-primary bg-primary/15" : "bg-background",
              )}
              onClick={() => set(answer(state, q.id, o.value))}
            >
              {o.label}
            </button>
          ))}
        </div>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {q.options.map((text, i) => {
            const on = q.kind === "multi" ? Array.isArray(cur) && cur.includes(i) : cur === i;
            return (
              <li key={i}>
                <button
                  type="button"
                  data-option={i}
                  aria-pressed={on}
                  className={cn(
                    "flex min-h-12 w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-[15px] leading-snug",
                    on ? "border-primary bg-primary/15 font-medium" : "bg-background",
                  )}
                  onClick={() =>
                    set(answer(state, q.id, q.kind === "multi" ? toggleIndex(cur, i) : i))
                  }
                >
                  {/*
                    Harf belgisi (A, B, C…) — proyektorda o'qituvchi
                    «B variantni tanlang» deya olishi uchun; u TARTIB
                    raqami, javob emas.
                  */}
                  <span
                    className={cn(
                      "flex size-7 shrink-0 items-center justify-center rounded-lg border text-xs font-semibold",
                      on ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground",
                    )}
                    aria-hidden
                  >
                    {String.fromCharCode(65 + i)}
                  </span>
                  <span className="min-w-0">{text}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
