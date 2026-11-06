"use client";

import { useState } from "react";
import type { EnhanceKind } from "@/lib/media/enhance";
import { enhancePrompt } from "./studio-api";

/** «Yaxshilash (AI)» of a prompt box: a free rewrite written back into the box, an error goes to the tab's error line. */
export function usePromptEnhance(kind: EnhanceKind, read: () => string, write: (prompt: string) => void, onError: (message: string | null) => void) {
  const [enhancing, setEnhancing] = useState(false);
  async function enhance() {
    setEnhancing(true);
    onError(null);
    try {
      write(await enhancePrompt(read(), kind));
    } catch (e) {
      onError(e instanceof Error ? e.message : "Tavsif yaxshilanmadi");
    } finally {
      setEnhancing(false);
    }
  }
  return { enhance, enhancing };
}
