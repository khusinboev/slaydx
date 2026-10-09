"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { copyToClipboard } from "@/lib/share";
import { Button } from "./Button";

/** Writes to the clipboard; falls back to a hidden textarea where the async API is unavailable (HTTP, old WebViews). */
export const copyText = (text: string): Promise<boolean> => copyToClipboard(text);

export function CopyButton({
  value,
  label = "Nusxa olish",
  copiedLabel = "Nusxalandi",
}: {
  value: string;
  label?: string;
  copiedLabel?: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function copy() {
    const ok = await copyText(value);
    setState(ok ? "copied" : "failed");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 1800);
  }

  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={copy}
      icon={state === "copied" ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
    >
      <span aria-live="polite">{state === "copied" ? copiedLabel : state === "failed" ? "Nusxalab bo'lmadi" : label}</span>
    </Button>
  );
}
