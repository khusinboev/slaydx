"use client";

import { cn } from "@/lib/cn";

/** Pretty JSON; BigInt (not JSON-serialisable) is shown as its decimal string. */
export function prettyJson(value: unknown): string {
  try {
    const text = JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2);
    return text ?? "undefined";
  } catch {
    // Circular structure or a throwing toJSON: show something rather than crash the page.
    return String(value);
  }
}

/**
 * Pretty-printed JSON as plain text inside `<pre>`. Rendered as a React text
 * node, so a payload containing markup (webhook bodies, user input) is shown
 * literally and never interpreted.
 */
export function JsonView({ value, maxHeightClass = "max-h-96" }: { value: unknown; maxHeightClass?: string }) {
  return (
    <pre
      className={cn(
        "bg-muted overflow-auto rounded-lg px-3 py-2.5 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap",
        maxHeightClass,
      )}
    >
      {prettyJson(value)}
    </pre>
  );
}
