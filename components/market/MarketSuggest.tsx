"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { ArrowRight, Store, X } from "lucide-react";
import * as api from "@/lib/api-client";
import { formatSom } from "@/lib/format";
import { isMarketTool } from "@/lib/market/registry";
import type { MarketCard } from "@/lib/market/types";
import { TOOL_BY_ID } from "@/lib/tools";
import type { ToolId } from "@/lib/types";
import { useMarketOn } from "./MarketClosed";
import { itemHref } from "./market-model";

export const SUGGEST_MIN_CHARS = 8;
export const SUGGEST_DEBOUNCE_MS = 600;
/** A restored draft sets the field without an input event: one look after the form settled. */
const DRAFT_SETTLE_MS = 1_500;

/** The topic field of a tool form: `data-field="topic"`, or the slide forms' inline field (by its accessible name). */
function topicInput(toolId: ToolId): HTMLInputElement | HTMLTextAreaElement | null {
  const legend = TOOL_BY_ID[toolId]?.topicLegend ?? "Mavzu";
  return document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    `[data-tool-chrome] [data-field="topic"] input, [data-tool-chrome] [data-field="topic"] textarea, [data-tool-chrome] input[aria-label="${CSS_ESCAPE(legend)}"]`,
  );
}

const CSS_ESCAPE = (s: string): string => s.replace(/["\\]/g, "\\$&");

/**
 * «Tayyor varianti bor» (§5.1): watches the topic field of a tool form from the page wrapper, not from inside the composers,
 * asks `GET /api/market/suggest` after a typing pause and draws one chip right under the field (a small host element next to
 * the input, portal target). Hidden with the market off, for a tool the market does not sell, and after «×» for this page.
 */
export function MarketSuggest({ toolId }: { toolId: ToolId }) {
  const on = useMarketOn();
  const [item, setItem] = useState<MarketCard | null>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const asked = useRef("");

  useEffect(() => {
    if (!on || !isMarketTool(toolId) || dismissed) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let ctrl: AbortController | null = null;

    const ask = (topic: string) => {
      ctrl?.abort();
      const mine = new AbortController();
      ctrl = mine;
      api
        .marketSuggest(toolId, topic, { signal: mine.signal })
        .then((r) => {
          if (!mine.signal.aborted) setItem(r.items[0] ?? null);
        })
        .catch(() => {
          // A suggestion is a bonus: a failure shows nothing.
        });
    };

    const scan = () => {
      const input = topicInput(toolId);
      const topic = input?.value.trim() ?? "";
      if (topic.length < SUGGEST_MIN_CHARS) {
        asked.current = "";
        ctrl?.abort();
        setItem(null);
        return;
      }
      if (topic === asked.current) return;
      asked.current = topic;
      ask(topic);
    };

    const onInput = (e: Event) => {
      const input = topicInput(toolId);
      if (!input || e.target !== input) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(scan, SUGGEST_DEBOUNCE_MS);
    };

    document.addEventListener("input", onInput);
    const settle = setTimeout(scan, DRAFT_SETTLE_MS);
    return () => {
      document.removeEventListener("input", onInput);
      clearTimeout(settle);
      if (timer) clearTimeout(timer);
      ctrl?.abort();
    };
  }, [dismissed, on, toolId]);

  // The chip lives right after the field. The host is ours: React never draws into it, so the form's tree is untouched.
  useEffect(() => {
    if (!item || dismissed) return;
    const input = topicInput(toolId);
    const anchor = input?.closest('[data-field="topic"]') ?? input;
    if (!anchor) return;
    const el = document.createElement("div");
    el.dataset.marketSuggestHost = "";
    anchor.insertAdjacentElement("afterend", el);
    setHost(el);
    return () => {
      el.remove();
      setHost(null);
    };
  }, [dismissed, item, toolId]);

  if (!item || !host || dismissed) return null;
  return createPortal(
    <div data-market-suggest className="bg-accent-soft mt-2 flex min-w-0 items-center gap-1 rounded-[14px] pr-1">
      <Link href={itemHref(item.id)} data-market-suggest-link className="focus-visible:ring-ring flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-[14px] py-1.5 pl-3 text-[14.5px] leading-snug outline-none focus-visible:ring-2">
        <Store className="text-accent-soft-foreground size-4 shrink-0" aria-hidden />
        <span className="line-clamp-2 min-w-0 flex-1">
          <span className="font-semibold">Tayyor varianti bor:</span> <span className="break-words">«{item.title}»</span> — <span className="font-semibold whitespace-nowrap tabular-nums">{formatSom(item.price)}</span>
        </span>
        <ArrowRight className="text-accent-soft-foreground size-4 shrink-0" aria-hidden />
      </Link>
      <button type="button" aria-label="Yopish" data-market-suggest-close onClick={() => setDismissed(true)} className="text-muted-foreground hover:text-foreground focus-visible:ring-ring grid size-11 shrink-0 place-items-center rounded-[12px] outline-none focus-visible:ring-2">
        <X className="size-4" aria-hidden />
      </button>
    </div>,
    host,
  );
}
