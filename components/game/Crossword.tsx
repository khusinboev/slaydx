"use client";

import { answer, cellKey, crosswordSlots, type GameState } from "@/lib/game/engine";
import { cn } from "@/lib/cn";

/** Katak o'lchami (px) — 360 px ekranda 15 ustunli to'r gorizontal scroll bilan sig'adi. */
const CELL = 30;

/**
 * KROSSVORD EKRANI (AUDIT-22 WP-C) — to'r + savollar, BITTA ekran.
 *
 * Ochiq ko'rinishda to'r faqat SHAKL (`cells` — boolean), harflar yo'q.
 * Kataklar savol raqami va yo'nalishidan tiklanadi
 * (`engine.crosswordSlots`), so'z → harflar payload i esa `finish()` da
 * yig'iladi: kesishgan katakni o'yinchi bir marta yozadi va u IKKALA
 * so'zga tushadi.
 *
 * Har katak — `<input maxLength={2}>`: `oʻ`/`gʻ` ikki kod nuqtasi, lekin
 * bitta katak (`engine.oneLetter`). Yozilgandan keyin fokus KEYINGI
 * katakka o'tmaydi — yo'nalishni bilmasdan «keyingi» qaysiligi noaniq,
 * noto'g'ri sakrash esa qo'lda tuzatishdan battar.
 *
 * To'r `overflow-x-auto` ichida: telefonda kataklarni kichraytirib
 * o'qib bo'lmaydigan qilgandan ko'ra, surib ko'rgan yaxshi.
 */
export function Crossword({ state, set }: { state: GameState; set: (s: GameState) => void }) {
  const view = state.view;
  if (view.kind !== "crossword") return null;
  const { grid } = view;
  const slots = crosswordSlots(view);
  const numberAt = new Map(grid.numbers.map((n) => [cellKey(n.row, n.col), n.number]));

  return (
    <div data-game="crossword">
      <div className="-mx-1 overflow-x-auto px-1 pb-1">
        <div
          className="grid w-max gap-px"
          style={{ gridTemplateColumns: `repeat(${grid.cols}, ${CELL}px)` }}
          role="grid"
          aria-label="Krossvord to‘ri"
        >
          {grid.cells.map((row, r) =>
            row.map((open, c) => {
              const key = cellKey(r, c);
              if (!open) return <div key={key} className="bg-muted/60 rounded-[3px]" style={{ height: CELL }} />;
              const num = numberAt.get(key);
              return (
                <div key={key} className="border-input bg-background relative rounded-[3px] border" style={{ height: CELL }}>
                  {num ? (
                    <span className="text-muted-foreground pointer-events-none absolute top-0 left-0.5 text-[8px] leading-none" aria-hidden>
                      {num}
                    </span>
                  ) : null}
                  <input
                    data-cell={key}
                    aria-label={`Katak ${r + 1}-qator ${c + 1}-ustun`}
                    className="size-full bg-transparent text-center text-[15px] font-semibold uppercase outline-none focus:bg-primary/15"
                    maxLength={2}
                    autoComplete="off"
                    inputMode="text"
                    value={String(state.answers[key] ?? "")}
                    onChange={(e) => set(answer(state, key, e.target.value))}
                  />
                </div>
              );
            }),
          )}
        </div>
      </div>

      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        {(["across", "down"] as const).map((dir) => (
          <section key={dir}>
            <h2 className="text-muted-foreground mb-1.5 text-xs font-semibold tracking-wide uppercase">
              {dir === "across" ? "Gorizontal" : "Vertikal"}
            </h2>
            <ol className="flex flex-col gap-1.5">
              {slots
                .filter((s) => s.dir === dir)
                .map((s) => {
                  const filled = s.cells.length > 0 && s.cells.every((c) => state.answers[cellKey(c.row, c.col)]);
                  return (
                    <li
                      key={`${dir}-${s.wordId}`}
                      data-clue={s.wordId}
                      className={cn("text-[14px] leading-snug", filled && "text-muted-foreground")}
                    >
                      <span className="font-semibold">{s.number}.</span> {s.text}{" "}
                      <span className="text-muted-foreground">({s.length})</span>
                    </li>
                  );
                })}
            </ol>
          </section>
        ))}
      </div>
    </div>
  );
}
