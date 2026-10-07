"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { ArrowUp } from "lucide-react";
import { getNavSnapshot, getServerNavSnapshot, subscribeNav } from "@/lib/nav/history";
import { useVisualViewport } from "@/lib/hooks/useVisualViewport";
import { isCoarsePointer } from "@/lib/hooks/useCoarsePointer";
import { isTextEntry } from "@/components/forms/useKeyboardInset";
import { SAFE_BOTTOM, SAFE_RIGHT, atLeast } from "./safe-area";
import { directionOf, dockInset, liftAbove, nextVisible, type Band, type ScrollDirection } from "./scroll-to-top";

/**
 * «Tepaga chiqish» — one floating button for every page in the app shell
 * (todo T2, owner request: after scrolling a long list or document down, one
 * tap goes back to the top).
 *
 * What scrolls. The shell is `h-svh overflow-hidden`; the page scrolls in
 * `<main id="main">` (docs/viewer/PLAN.md: «One page scroll»), NOT in the
 * window. `AppShell` hands that element over as `container`. The listener sits
 * on the container itself (scroll events do not bubble), so the slide stage,
 * the result panel body, the topic-chip row and any other inner scroller never
 * reach it. Phone-width forms, the home file list, the catalogue, profile,
 * purchase and result pages all scroll in that one element.
 *
 * Visibility rules live in `scroll-to-top.ts` (pure, tested). Besides them:
 *   - a route change hides the button at once and re-reads the position after
 *     the new page (and Next's / NavProvider's scroll restore) has settled;
 *   - on touch it is not rendered while a text field inside the container has
 *     focus: the on-screen keyboard is (about to be) open, and `useKeyboardInset`
 *     keeps the focused field 16 px above the visible bottom, which is exactly
 *     the button's slot. `isTextEntry` is the same predicate the form chrome
 *     uses (text-like inputs, textarea, contentEditable; a native `<select>`
 *     opens a picker, not a keyboard, so it does not count);
 *   - while any overlay is open it is not rendered (`getNavSnapshot().overlays`
 *     counts every `useDialog` / `useOverlayHistory` layer: login, search,
 *     download sheet, result panel sheet, menus, lightbox… and the shell's own
 *     mobile drawer);
 *   - it sits above the safe areas (`--tg-safe-bottom` → `env()`), above the
 *     on-screen keyboard (`--kb-h`, kept alive by `useVisualViewport` while the
 *     button is mounted) and above bottom bars (`[data-submit-bar]` of the tool
 *     forms, or any element marked `data-scroll-top-avoid`) — measured, so a bar
 *     resting above the form's bottom padding does not push it up. The document
 *     edit bar needs no entry: it owns an overlay layer, so the button is gone
 *     while it shows. Next to the result page's open side panel (≥ 1280 px) it
 *     moves left of the panel instead of covering its corner.
 *
 * It is `position: fixed` with `z-30`: below the drawer (`z-40`) and every
 * dialog/sheet (`z-50`+), above the sticky result header (`z-20`).
 */

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
/** Bars the button must clear. The tool forms' submit bar marks itself; others can opt in. */
const AVOID_SELECTOR = "[data-submit-bar], [data-scroll-top-avoid]";
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]';

/** Attributes whose change moves what the button must clear: the bars, and the result dock opening / closing. */
const BAR_ATTRIBUTES = ["data-submit-bar", "data-scroll-top-avoid", "data-panel-open", "data-result-panel"];
/** The result page's docked side panel (≥ 1280 px, open). */
const DOCK_SELECTOR = '[data-result-panel="dock"][data-panel-open="1"]';

export const SCROLL_TOP_LABEL = "Tepaga chiqish";

/** A bar was added, removed or switched (the form's sticky → inline while typing). Other DOM churn is ignored. */
function touchesBar(r: MutationRecord): boolean {
  if (r.type === "attributes") return true; // already filtered to the bar attributes
  const hit = (n: Node) => n instanceof Element && (n.matches(AVOID_SELECTOR) || n.querySelector(AVOID_SELECTOR) !== null);
  for (const n of r.addedNodes) if (hit(n)) return true;
  for (const n of r.removedNodes) if (hit(n)) return true;
  return false;
}

function prefersReducedMotion(): boolean {
  try {
    return typeof window.matchMedia === "function" && window.matchMedia(REDUCED_MOTION).matches;
  } catch {
    return false;
  }
}

export type ScrollToTopProps = {
  /** The page's scroll container (`<main id="main">`); `null` until it mounts. */
  container: HTMLElement | null;
  /**
   * Called with `true` while the button is on screen, `false` otherwise. The shell
   * uses it to give the end of the page 4.5 rem + the safe area of bottom room, so
   * the last lines and controls can be scrolled out from under the button.
   */
  onShownChange?: (shown: boolean) => void;
};

export function ScrollToTop({ container, onShownChange }: ScrollToTopProps) {
  const pathname = usePathname();
  const overlays = useSyncExternalStore(subscribeNav, () => getNavSnapshot().overlays, () => getServerNavSnapshot().overlays);
  const [visible, setVisible] = useState(false);
  const typing = useTypingInside(container);

  useEffect(() => {
    if (!container) return;
    let last = container.scrollTop;
    let dir: ScrollDirection = null;
    let shown = false;
    let raf: number | null = null;

    const apply = (next: boolean) => {
      if (next === shown) return;
      shown = next;
      setVisible(next);
    };
    const measure = () => {
      const top = container.scrollTop;
      dir = directionOf(last, top, dir);
      last = top;
      apply(nextVisible({ top, height: container.clientHeight, dir, visible: shown }));
    };
    const onScroll = () => measure();
    // A resize (rotation, keyboard on Android) moves the thresholds.
    const onResize = () => measure();

    // New route: the old position says nothing about the new page. Start hidden,
    // then read once the page committed and the scroll was restored or reset.
    apply(false);
    last = 0;
    dir = null;
    const settle = () => {
      raf = requestAnimationFrame(() => {
        raf = requestAnimationFrame(() => {
          raf = null;
          last = container.scrollTop;
          measure();
        });
      });
    };
    settle();

    container.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    return () => {
      container.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      if (raf !== null) cancelAnimationFrame(raf);
      shown = false;
      setVisible(false);
    };
  }, [container, pathname]);

  const shown = !!container && visible && !typing && overlays === 0;
  // The shell reserves room under the page's last lines while the button is there (m1).
  useEffect(() => {
    onShownChange?.(shown);
    return () => onShownChange?.(false);
  }, [shown, onShownChange]);

  if (!shown || !container) return null;
  return <ScrollToTopButton container={container} />;
}

/**
 * A text field inside `container` has focus on a touch device (see the header).
 * `focusout` carries the next focus target in `relatedTarget` (no flicker when
 * focus moves between two fields); without one (blur to nothing, window lost
 * focus) the active element is re-read in a microtask.
 */
function useTypingInside(container: HTMLElement | null): boolean {
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    if (!container) return;
    const inside = (el: Element | null): boolean => !!el && container.contains(el) && isTextEntry(el);
    const recheck = () => setTyping(isCoarsePointer() && inside(document.activeElement));
    const onIn = (e: FocusEvent) => setTyping(isCoarsePointer() && inside(e.target as Element | null));
    const onOut = (e: FocusEvent) => {
      const next = e.relatedTarget as Element | null;
      if (next) setTyping(isCoarsePointer() && inside(next));
      else queueMicrotask(recheck);
    };
    recheck();
    container.addEventListener("focusin", onIn);
    container.addEventListener("focusout", onOut);
    return () => {
      container.removeEventListener("focusin", onIn);
      container.removeEventListener("focusout", onOut);
      setTyping(false);
    };
  }, [container]);
  return typing;
}

/** Visible and exposed: no `hidden` / `inert` / `aria-hidden` / `display:none` / `visibility:hidden` on the element or above it (up to `root`). */
function reachable(el: HTMLElement, root: HTMLElement): boolean {
  for (let n: HTMLElement | null = el; n; n = n.parentElement) {
    if (n.hidden || n.hasAttribute("inert") || n.getAttribute("aria-hidden") === "true") return false;
    const st = getComputedStyle(n);
    if (st.display === "none" || st.visibility === "hidden") return false;
    if (n === root) break;
  }
  return true;
}

/** Focus a non-tabbable element for the moment (`tabindex=-1`, no ring on the whole page) and undo it on blur. */
function focusTemporarily(el: HTMLElement, root: HTMLElement) {
  const hadTabindex = el.hasAttribute("tabindex");
  const outline = el.style.outline;
  if (!hadTabindex) el.setAttribute("tabindex", "-1");
  if (el === root) el.style.outline = "none";
  el.addEventListener(
    "blur",
    () => {
      if (!hadTabindex) el.removeAttribute("tabindex");
      if (el === root) el.style.outline = outline;
    },
    { once: true },
  );
  el.focus({ preventScroll: true });
}

/**
 * Where keyboard focus goes after the jump to the top: the first real control
 * (skipping `tabindex=-1`, hidden and `aria-hidden` ones — focusing those is a
 * no-op that would drop focus to `<body>` — and text fields, which would raise
 * the keyboard on a phone), else the page's `<h1>`, else the page container.
 */
function focusPageStart(root: HTMLElement) {
  for (const el of root.querySelectorAll<HTMLElement>(FOCUSABLE)) {
    if (el.tabIndex < 0 || isTextEntry(el) || !reachable(el, root)) continue;
    el.focus({ preventScroll: true });
    return;
  }
  const h1 = root.querySelector<HTMLElement>("h1");
  focusTemporarily(h1 && reachable(h1, root) ? h1 : root, root);
}

function ScrollToTopButton({ container }: { container: HTMLElement }) {
  // Keeps `--kb-h` on <html> while this button is mounted (and re-renders on keyboard changes).
  const viewport = useVisualViewport();
  const anchorRef = useRef<HTMLDivElement>(null);
  const [lift, setLift] = useState(0);
  // Extra right offset (px) while the result page's side panel is docked open; 0 = none.
  const [dockRight, setDockRight] = useState(0);
  const [entered, setEntered] = useState(false);

  const measureLift = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const anchorBottom = anchor.getBoundingClientRect().bottom;
    const bars: Band[] = [];
    for (const el of document.querySelectorAll<HTMLElement>(AVOID_SELECTOR)) {
      const r = el.getBoundingClientRect();
      bars.push({ top: r.top, bottom: r.bottom });
    }
    setLift(liftAbove(anchorBottom, bars));
    const dock = document.querySelector<HTMLElement>(DOCK_SELECTOR);
    const d = dock ? dock.getBoundingClientRect() : null;
    setDockRight(d ? dockInset(d.left, d.width, document.documentElement.clientWidth || window.innerWidth) : 0);
  }, []);

  // Fade in once (no movement: the anchor's position must stay exact for measuring).
  useEffect(() => {
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Bars come and go with the keyboard, with editing and with scrolling.
  useLayoutEffect(() => {
    measureLift();
    let raf: number | null = null;
    const schedule = () => {
      if (raf !== null) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        measureLift();
      });
    };
    container.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    let mo: MutationObserver | null = null;
    if (typeof MutationObserver === "function") {
      mo = new MutationObserver((records) => {
        if (records.some(touchesBar)) schedule();
      });
      mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: BAR_ATTRIBUTES });
    }
    return () => {
      container.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      mo?.disconnect();
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, [container, measureLift, viewport.keyboardHeight, viewport.height]);

  const goTop = (e: React.MouseEvent<HTMLButtonElement>) => {
    const smooth = !prefersReducedMotion();
    if (typeof container.scrollTo === "function") {
      container.scrollTo({ top: 0, behavior: smooth ? "smooth" : "auto" });
    } else {
      container.scrollTop = 0;
    }
    // Keyboard activation (`detail === 0`): the button disappears, so hand the
    // focus to the start of the page; the next Tab continues from there.
    if (e.detail === 0) focusPageStart(container);
  };

  return (
    <div
      ref={anchorRef}
      data-scroll-top-anchor
      className={`no-print pointer-events-none fixed z-30 h-0 w-0 transition-opacity duration-150 motion-reduce:transition-none ${entered ? "opacity-100" : "opacity-0"}`}
      style={{
        // 20 px: clears a classic 15–17 px scrollbar of <main> on desktops.
        // Docked result panel: sit just left of it, not over its «Tuzatish» buttons.
        right: dockRight > 0 ? `${dockRight}px` : atLeast("1.25rem", SAFE_RIGHT),
        bottom: `calc(${SAFE_BOTTOM} + 1rem + var(--kb-h, 0px))`,
      }}
    >
      <button
        type="button"
        data-scroll-top
        aria-label={SCROLL_TOP_LABEL}
        title={SCROLL_TOP_LABEL}
        onClick={goTop}
        className="bg-card text-foreground hover:bg-accent focus-visible:ring-ring pointer-events-auto absolute right-0 bottom-0 flex size-11 touch-manipulation items-center justify-center rounded-full border shadow-lg ring-1 ring-black/5 transition-transform duration-150 outline-none select-none focus-visible:ring-2 motion-reduce:transition-none dark:border-white/25 dark:bg-[#26231e] dark:ring-white/10 dark:hover:bg-[#312d26]"
        style={{ transform: lift ? `translateY(${-lift}px)` : undefined }}
      >
        <ArrowUp className="size-5" aria-hidden />
      </button>
    </div>
  );
}
