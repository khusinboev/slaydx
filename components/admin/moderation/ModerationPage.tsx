"use client";

import { LinksTable } from "./LinksTable";

/** S12 `/admin/moderation`: page header + the URL-driven links table. */
export function ModerationPage() {
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="text-[22px] font-semibold tracking-tight">Moderatsiya</h1>
        <p className="text-muted-foreground text-[13px]">Ommaviy o&apos;yin havolalari va anonim natijalar</p>
      </header>
      <LinksTable />
    </div>
  );
}
