"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { useCoarsePointer } from "@/lib/hooks/useCoarsePointer";
import { ApiImg } from "@/lib/use-api-src";
import { OverlayFrame, OverlayHeader, OverlayPanel, OverlayScrim } from "@/components/overlays/OverlayFrame";
import { useDialog } from "@/components/overlays/useDialog";
import { fetchLibrary } from "./studio-api";
import type { LibraryData } from "./studio-types";

/** The library is the same for everyone and changes rarely: one load per page visit (the server caches 30 s). */
let loaded: Promise<LibraryData> | null = null;

/** Forget the cached library (tests). */
export function dropLibraryCache(): void {
  loaded = null;
}

function loadLibrary(): Promise<LibraryData> {
  loaded ??= fetchLibrary().catch((e: unknown) => {
    loaded = null;
    throw e;
  });
  return loaded;
}

/**
 * «Namuna promptlar» (docs/studio/P2B-SPEC.md, canvas phone «Rasm»): a bottom sheet (a centred dialog on a desktop) with
 * category chips and the curated prompts. Tapping a prompt hands its text to the form (`onPick`) and closes the sheet;
 * nothing is charged. A `useDialog` overlay: the back button closes it first.
 */
export function LibrarySheet({ onPick, onClose }: { onPick: (prompt: string) => void; onClose: () => void }) {
  const phone = useCoarsePointer();
  const panelRef = useDialog(true, onClose);
  const [data, setData] = useState<LibraryData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    loadLibrary().then(
      (d) => live && setData(d),
      (e: unknown) => live && setError(e instanceof Error ? e.message : "Namunalar yuklanmadi"),
    );
    return () => {
      live = false;
    };
  }, [attempt]);

  const items = data ? data.items.filter((i) => !category || i.category === category) : [];
  const chip = "pointer-coarse:min-h-11 focus-visible:ring-ring shrink-0 rounded-[12px] px-3 py-1.5 text-[13.5px] outline-none focus-visible:ring-2";
  return (
    <OverlayFrame label="Namuna promptlar" phone={phone} sheet className={phone ? "flex items-end justify-center" : "flex items-center justify-center p-4"}>
      <OverlayScrim onClose={onClose} />
      <OverlayPanel ref={panelRef} phone={phone} sheet className={phone ? "min-h-[70svh]" : "max-w-xl"}>
        <div data-library-sheet>
          <OverlayHeader title="Namuna promptlar" phone={phone} onClose={onClose} className="mb-2" />
          {error ? (
            <p role="alert" className="text-destructive text-[14.5px]" data-library-error>
              {error}{" "}
              <button
                type="button"
                className="pointer-coarse:min-h-11 font-semibold underline underline-offset-2"
                onClick={() => {
                  setError(null);
                  setAttempt((n) => n + 1);
                }}
              >
                Qayta urinish
              </button>
            </p>
          ) : !data ? (
            <div className="flex flex-col gap-2" role="status" aria-label="Namunalar yuklanmoqda" data-library-loading>
              {[0, 1, 2].map((i) => (
                <div key={i} className="bg-muted/60 h-16 animate-pulse rounded-[16px]" />
              ))}
            </div>
          ) : data.items.length === 0 ? (
            <p className="text-muted-foreground text-[14.5px]" data-library-empty>
              Hozircha namuna promptlar yo‘q.
            </p>
          ) : (
            <>
              <div role="group" aria-label="Toifa" className="-mx-1 mb-3 flex gap-1.5 overflow-x-auto px-1 pb-1" data-library-chips>
                <button type="button" data-library-chip="all" aria-pressed={category === null} onClick={() => setCategory(null)} className={cn(chip, category === null ? "bg-foreground text-background font-semibold" : "bg-muted")}>
                  Hammasi
                </button>
                {data.categories.map((c) => (
                  <button key={c.id} type="button" data-library-chip={c.id} aria-pressed={category === c.id} onClick={() => setCategory(c.id)} className={cn(chip, category === c.id ? "bg-foreground text-background font-semibold" : "bg-muted")}>
                    {c.label}
                  </button>
                ))}
              </div>
              <ul className="flex flex-col gap-2" data-library-list>
                {items.map((it) => (
                  <li key={it.id}>
                    <button
                      type="button"
                      data-library-item={it.id}
                      onClick={() => {
                        onPick(it.prompt);
                        onClose();
                      }}
                      className="bg-card hover:border-foreground/25 focus-visible:ring-ring flex w-full items-start gap-3 rounded-[16px] border p-3 text-left outline-none focus-visible:ring-2"
                    >
                      {it.previewUrl ? <ApiImg src={it.previewUrl} alt="" loading="lazy" className="bg-muted size-14 shrink-0 rounded-[12px] object-cover" /> : null}
                      <span className="min-w-0 flex-1">
                        <span className="block text-[14.5px] font-bold">{it.title}</span>
                        <span className="text-muted-foreground mt-0.5 line-clamp-2 block text-[13px] leading-snug">{it.prompt}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </OverlayPanel>
    </OverlayFrame>
  );
}
