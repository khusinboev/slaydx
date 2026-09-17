"use client";

import { answer, pick, place, type GameState } from "@/lib/game/engine";
import { cn } from "@/lib/cn";

/**
 * SARALASH EKRANI (AUDIT-22 WP-C) — element → toifa, BITTA ekran.
 *
 * ASOSIY OQIM — TANLAB-JOYLASH, drag emas: HTML5 drag-and-drop mobil
 * brauzerlarda umuman ishlamaydi (`touch` hodisalari `dragstart` ga
 * aylanmaydi), o'yin esa birinchi navbatda telefonda o'ynaladi. Shuning
 * uchun: elementni bosasiz (u «qo'lga olinadi»), toifani bosasiz
 * (tushadi). Sichqoncha bilan drag ham ishlaydi va AYNI ikki chaqiruvga
 * tushadi (`pick` → `place`), ya'ni ikkinchi mantiq yo'q.
 *
 * Joylangan element toifa ichida ko'rinadi va bosilsa taxtaga QAYTADI —
 * xatoni tuzatish uchun «bekor qilish» tugmasi kerak bo'lmasin.
 */
export function Sorting({ state, set }: { state: GameState; set: (s: GameState) => void }) {
  const view = state.view;
  if (view.kind !== "sorting") return null;

  const placedIn = (catId: string) => view.items.filter((it) => state.answers[it.id] === catId);
  const pool = view.items.filter((it) => typeof state.answers[it.id] !== "string");

  return (
    <div data-game="sorting">
      <p className="text-muted-foreground text-sm">
        Elementni tanlang, so‘ng mos toifani bosing.
      </p>

      <div className="border-input bg-muted/30 mt-3 min-h-16 rounded-xl border border-dashed p-2" data-pool>
        {pool.length ? (
          <ul className="flex flex-wrap gap-2">
            {pool.map((it) => (
              <li key={it.id}>
                <button
                  type="button"
                  data-item={it.id}
                  aria-pressed={state.picked === it.id}
                  draggable
                  onDragStart={() => set(pick(state, it.id))}
                  className={cn(
                    "min-h-11 rounded-xl border px-3 py-2 text-[15px]",
                    state.picked === it.id ? "border-primary bg-primary/15 font-medium" : "bg-background",
                  )}
                  onClick={() => set(pick(state, it.id))}
                >
                  {it.text}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground py-2 text-center text-sm">Hamma element joylandi.</p>
        )}
      </div>

      <div className="mt-4 flex flex-col gap-3">
        {view.categories.map((cat) => {
          const inside = placedIn(cat.id);
          return (
            <section
              key={cat.id}
              data-category={cat.id}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                set(place(state, cat.id));
              }}
              className={cn(
                "rounded-xl border p-3",
                state.picked ? "border-primary/60 bg-primary/5" : "bg-card",
              )}
            >
              <button
                type="button"
                data-drop={cat.id}
                className="w-full text-left text-[15px] font-semibold"
                disabled={!state.picked}
                onClick={() => set(place(state, cat.id))}
              >
                {cat.name}
                <span className="text-muted-foreground ml-2 text-xs font-normal">
                  {state.picked ? "— shu yerga qo‘yish" : `${inside.length} ta`}
                </span>
              </button>

              {inside.length ? (
                <ul className="mt-2 flex flex-wrap gap-2">
                  {inside.map((it) => (
                    <li key={it.id}>
                      <button
                        type="button"
                        data-placed={it.id}
                        className="border-primary/40 bg-primary/10 min-h-9 rounded-lg border px-2.5 py-1.5 text-[14px]"
                        // Toifadan chiqarish: element taxtaga qaytadi.
                        onClick={() => set(answer(state, it.id, null))}
                      >
                        {it.text} <span className="text-muted-foreground" aria-hidden>×</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}
