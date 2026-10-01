"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type KeyValueItem = {
  label: string;
  value: ReactNode;
  /** Monospace value (ids, hashes, codes). */
  mono?: boolean;
};

/** Label / value pairs as a description list; empty values render as an em dash. */
export function KeyValueList({ items }: { items: ReadonlyArray<KeyValueItem> }) {
  return (
    <dl className="grid grid-cols-[minmax(7rem,38%)_1fr] gap-x-4 gap-y-2 text-[13px]">
      {items.map((it) => (
        <div key={it.label} className="contents">
          <dt className="text-muted-foreground">{it.label}</dt>
          <dd className={cn("min-w-0 break-words", it.mono && "font-mono text-[12.5px]")}>
            {it.value === null || it.value === undefined || it.value === "" ? "—" : it.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
