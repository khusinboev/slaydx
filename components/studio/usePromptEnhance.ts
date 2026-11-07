"use client";

import { useRef, useState } from "react";
import type { EnhanceKind } from "@/lib/media/enhance";
import { enhancePrompt } from "./studio-api";

const norm = (text: string) => text.replace(/\s+/g, " ").trim();

/**
 * «Yaxshilash (AI)» of a prompt box: a free rewrite written back into the box, an error goes to the tab's error line.
 *
 * `shown(text)` says the box still holds the button's own answer: the user has read that text, so «AI yaxshilash» does not
 * rewrite it again behind their back. Any edit makes it the user's text once more.
 */
export function usePromptEnhance(kind: EnhanceKind, read: () => string, write: (prompt: string) => void, onError: (message: string | null) => void) {
  const [enhancing, setEnhancing] = useState(false);
  const last = useRef<string | null>(null);
  async function enhance() {
    setEnhancing(true);
    onError(null);
    try {
      const out = await enhancePrompt(read(), kind);
      last.current = norm(out);
      write(out);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Tavsif yaxshilanmadi");
    } finally {
      setEnhancing(false);
    }
  }
  const shown = (text: string) => last.current !== null && norm(text) === last.current;
  return { enhance, enhancing, shown };
}
