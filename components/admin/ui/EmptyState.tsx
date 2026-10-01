"use client";

import type { ReactNode } from "react";
import { Inbox } from "lucide-react";

/** "Nothing here" with the reason and, when filters are set, a way out (e.g. a clear-filters button). */
export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
      <div className="text-muted-foreground" aria-hidden="true">
        {icon ?? <Inbox className="size-8" />}
      </div>
      <h3 className="text-sm font-semibold">{title}</h3>
      {description ? <p className="text-muted-foreground max-w-md text-[13px]">{description}</p> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
