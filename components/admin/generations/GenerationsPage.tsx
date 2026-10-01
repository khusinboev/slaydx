"use client";

import type { FilterOption } from "@/components/admin/ui";
import { GenerationsTable } from "./GenerationsTable";

/** S6 `/admin/generations`: page header + the URL-driven jobs table. */
export function GenerationsPage({ tools }: { tools: ReadonlyArray<FilterOption> }) {
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="text-[22px] font-semibold tracking-tight">Generatsiyalar</h1>
        <p className="text-muted-foreground text-[13px]">Barcha foydalanuvchilarning ishlari: holat, pul, AI xarajati va xatolar</p>
      </header>
      <GenerationsTable tools={tools} />
    </div>
  );
}
