"use client";

import type { CatalogLoad } from "./studio-api";

/**
 * A tab's catalog before it is usable, in place of the form: the failure with «Qayta urinish», or a skeleton. `label`
 * names the loading tab for a screen reader, `blocks` are the skeleton's height classes.
 */
export function CatalogState({ state, onRetry, label, blocks }: { state: CatalogLoad; onRetry: () => void; label: string; blocks: readonly string[] }) {
  if (state.status === "error") {
    return (
      <p role="alert" className="text-destructive text-[14.5px]" data-studio-catalog-error>
        {state.message}{" "}
        <button type="button" onClick={onRetry} className="pointer-coarse:min-h-11 font-semibold underline underline-offset-2">
          Qayta urinish
        </button>
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3" role="status" aria-label={label} data-studio-loading>
      {blocks.map((b, i) => (
        <div key={i} className={`bg-muted/60 animate-pulse ${b}`} />
      ))}
    </div>
  );
}
