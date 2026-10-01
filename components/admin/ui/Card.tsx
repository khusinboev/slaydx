"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Bordered surface. Use `CardHeader` for the title row and `CardBody` for padded content. */
export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn("bg-card rounded-xl border", className)}>{children}</section>;
}

export function CardHeader({
  title,
  description,
  aside,
  as: Heading = "h2",
}: {
  title: ReactNode;
  description?: ReactNode;
  /** Right-aligned content: buttons, a legend, a total. */
  aside?: ReactNode;
  as?: "h2" | "h3";
}) {
  return (
    <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-4 py-3">
      <div className="min-w-0 flex-1">
        <Heading className="text-sm font-semibold">{title}</Heading>
        {description ? <p className="text-muted-foreground mt-0.5 text-xs">{description}</p> : null}
      </div>
      {aside ? <div className="flex flex-wrap items-center gap-2 text-xs">{aside}</div> : null}
    </header>
  );
}

export function CardBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("px-4 py-3.5", className)}>{children}</div>;
}
