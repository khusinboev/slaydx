"use client";

import { ArrowLeft } from "lucide-react";
import { BackLink } from "@/components/nav/BackLink";

/**
 * «←» of the consumer pages that have no tool header (`/uz/create`,
 * `/uz/purchase`, `/uz/profile`). Same look as the one in `ToolChrome`; the
 * target is the page's parent from `parentOf` (`/uz`). Touch: a 44 px circle
 * whose negative margins keep the 32 px row and the icon's position (mobile P3).
 */
export function PageBack() {
  return (
    <BackLink
      data-page-back
      className="text-muted-foreground hover:text-foreground hover:bg-muted pointer-coarse:size-11 pointer-coarse:-my-1.5 pointer-coarse:-ml-2.5 pointer-coarse:-mr-1.5 -ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
    >
      <ArrowLeft className="h-5 w-5" />
    </BackLink>
  );
}
