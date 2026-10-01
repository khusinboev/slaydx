"use client";

import type { ReactNode } from "react";
import { JsonView } from "@/components/admin/ui";
import type { PublicGameView } from "@/lib/game/public";
import { kindLabel } from "./shared";

/**
 * The public view of a game link, shown as DATA (React text nodes only; the
 * strings come from a model and a teacher, so they are never interpreted as
 * markup, T7). `view` is exactly what `/api/o/<token>` returns to a player:
 * the correct answers are already stripped by the server.
 */

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h4 className="text-muted-foreground text-[11.5px] font-semibold tracking-wide uppercase">{title}</h4>
      {children}
    </section>
  );
}

function QuizView({ view }: { view: Extract<PublicGameView, { kind: "quiz" }> }) {
  return (
    <ol className="flex flex-col gap-3 text-[13px]">
      {view.questions.map((q, i) => (
        <li key={q.id} className="flex flex-col gap-1">
          <p className="font-medium break-words">
            {i + 1}. {q.stem}
          </p>
          {q.options.length ? (
            <ul className="text-muted-foreground list-disc pl-5">
              {q.options.map((o, j) => (
                <li key={j} className="break-words">
                  {o}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-xs">To&apos;g&apos;ri / Noto&apos;g&apos;ri</p>
          )}
        </li>
      ))}
    </ol>
  );
}

function CrosswordView({ view }: { view: Extract<PublicGameView, { kind: "crossword" }> }) {
  const numberAt = new Map(view.grid.numbers.map((n) => [`${n.row}:${n.col}`, n.number]));
  return (
    <div className="flex flex-col gap-3 text-[13px]">
      <div className="max-w-full overflow-x-auto">
        <div
          role="img"
          aria-label={`Krossvord to'ri: ${view.grid.rows} qator, ${view.grid.cols} ustun`}
          className="inline-grid gap-px"
          style={{ gridTemplateColumns: `repeat(${view.grid.cols}, 1.25rem)` }}
        >
          {view.grid.cells.flatMap((row, r) =>
            row.map((open, c) => (
              <div
                key={`${r}:${c}`}
                className={open ? "bg-card border-input relative size-5 border text-[9px] leading-none" : "bg-foreground/80 size-5"}
              >
                {open && numberAt.has(`${r}:${c}`) ? <span className="absolute top-px left-0.5">{numberAt.get(`${r}:${c}`)}</span> : null}
              </div>
            )),
          )}
        </div>
      </div>
      {(["across", "down"] as const).map((dir) => (
        <Section key={dir} title={dir === "across" ? "Gorizontal" : "Vertikal"}>
          <ul className="flex flex-col gap-0.5">
            {view.clues[dir].map((c) => (
              <li key={c.wordId} className="break-words">
                <span className="tabular-nums">{c.number}.</span> {c.text} <span className="text-muted-foreground tabular-nums">({c.length})</span>
              </li>
            ))}
          </ul>
        </Section>
      ))}
    </div>
  );
}

function CardsView({ view }: { view: Extract<PublicGameView, { kind: "flashcards" }> }) {
  return (
    <ul className="flex flex-col gap-1.5 text-[13px]">
      {view.cards.map((c) => (
        <li key={c.id} className="grid grid-cols-2 gap-3 border-b pb-1.5 last:border-b-0">
          <span className="font-medium break-words">{c.front}</span>
          <span className="text-muted-foreground break-words">{c.back}</span>
        </li>
      ))}
    </ul>
  );
}

function SortingView({ view }: { view: Extract<PublicGameView, { kind: "sorting" }> }) {
  return (
    <div className="flex flex-col gap-3 text-[13px]">
      <Section title="Toifalar">
        <ul className="flex flex-wrap gap-1.5">
          {view.categories.map((c) => (
            <li key={c.id} className="bg-muted rounded-full px-2.5 py-0.5 break-words">
              {c.name}
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Elementlar">
        <ul className="flex flex-col gap-0.5">
          {view.items.map((i) => (
            <li key={i.id} className="break-words">
              {i.text}
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

function ListeningView({ view }: { view: Extract<PublicGameView, { kind: "listening" }> }) {
  return (
    <ol className="flex flex-col gap-3 text-[13px]">
      {view.items.map((it, i) => (
        <li key={it.id} className="flex flex-col gap-1">
          <p className="font-medium break-words">
            {i + 1}. {it.text} {it.audioAssetId ? null : <span className="text-muted-foreground text-xs">(audiosiz)</span>}
          </p>
          <ul className="text-muted-foreground list-disc pl-5">
            {it.options.map((o, j) => (
              <li key={j} className="break-words">
                {o}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}

function Body({ view }: { view: PublicGameView }) {
  switch (view.kind) {
    case "quiz":
      return <QuizView view={view} />;
    case "crossword":
      return <CrosswordView view={view} />;
    case "flashcards":
      return <CardsView view={view} />;
    case "sorting":
      return <SortingView view={view} />;
    case "listening":
      return <ListeningView view={view} />;
  }
}

/** `view === null`: the public route would answer 404 (the job is not ready or the document is not a game). */
export function GamePreview({ view }: { view: PublicGameView | null }) {
  if (!view) {
    return (
      <p className="text-muted-foreground text-[13px]">
        Ochiq ko&apos;rinish mavjud emas: ish tayyor emas yoki hujjat o&apos;yin emas.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3" data-testid="game-preview">
      <p className="text-[13px]">
        <span className="font-semibold break-words">{view.title}</span>
        <span className="text-muted-foreground">
          {" "}
          · {kindLabel(view.kind)} · {view.total.toLocaleString("uz-UZ")} ta topshiriq
        </span>
      </p>
      <div className="max-h-80 overflow-y-auto rounded-lg border p-3">
        <Body view={view} />
      </div>
      <details className="text-[12.5px]">
        <summary className="text-muted-foreground cursor-pointer select-none">Xom JSON</summary>
        <div className="mt-2">
          <JsonView value={view} maxHeightClass="max-h-64" />
        </div>
      </details>
    </div>
  );
}
