"use client";

import { ArrowLeft } from "lucide-react";
import { BackLink } from "@/components/nav/BackLink";

/**
 * «←» of the consumer pages that have no tool header (`/uz/create`,
 * `/uz/purchase`, `/uz/profile`). Same look as the one in `ToolChrome`; the
 * target is the page's parent from `parentOf` (`/uz`).
 */
export function PageBack() {
  return (
    <BackLink
      data-page-back
      className="text-muted-foreground hover:text-foreground hover:bg-muted -ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
    >
      <ArrowLeft className="h-5 w-5" />
    </BackLink>
  );
}
