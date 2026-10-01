"use client";

import { ShieldX } from "lucide-react";

/** Rendered when the API answers 403: the role lacks the permission. */
export function Forbidden({ message }: { message?: string }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-2 px-4 py-14 text-center">
      <ShieldX className="text-muted-foreground size-9" aria-hidden="true" />
      <p className="text-muted-foreground text-4xl font-bold">403</p>
      <h2 className="text-base font-semibold">Ruxsat yo&apos;q</h2>
      <p className="text-muted-foreground max-w-md text-[13px]">
        {message ?? "Sizning rolingiz bu bo'limni ko'rish uchun yetarli emas."}
      </p>
    </div>
  );
}
