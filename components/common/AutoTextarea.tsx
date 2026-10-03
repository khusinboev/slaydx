"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type ChangeEvent,
  type CSSProperties,
  type TextareaHTMLAttributes,
} from "react";

/**
 * AutoTextarea — the one textarea primitive (policy: docs/TEXTAREA-POLICY.md).
 *
 * A drop-in `<textarea>` that never shows a manual resize handle. Its height is
 * chosen by the component, not the user:
 *   - `mode="auto"` (default): grows/shrinks with the text between `minRows`
 *     and `maxRows` (or the `maxHeight` CSS length); past the cap it scrolls
 *     internally. Below the cap `overflow-y` is hidden so no scrollbar flickers.
 *   - `mode="fixed"`: exactly `rows` (or `minRows`) lines, internal scroll.
 *
 * Deliberately imports nothing but React: it is shared by consumer forms and
 * `components/admin/**`, so it must stay outside every bundle/boundary rule.
 */

export type AutoTextareaMode = "auto" | "fixed";

export interface AutoTextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** "auto" grows with the content (default); "fixed" keeps `rows` lines and scrolls. */
  mode?: AutoTextareaMode;
  /** Minimum visible lines in auto mode; height in fixed mode when `rows` is absent. Default 2. */
  minRows?: number;
  /** Maximum visible lines in auto mode before internal scrolling. Default 8. */
  maxRows?: number;
  /** CSS length cap (e.g. "60vh"); when set it replaces `maxRows` as the auto-mode cap. */
  maxHeight?: string;
}

// useLayoutEffect warns during SSR; measuring only matters in the browser.
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

const px = (v: string | null | undefined): number => {
  const n = parseFloat(v ?? "");
  return Number.isFinite(n) ? n : 0;
};

/** Line height in px; `normal` (or anything unparseable) falls back to 1.5 × font-size. */
function lineHeightPx(cs: CSSStyleDeclaration): number {
  const fontSize = px(cs.fontSize) || 16;
  const raw = cs.lineHeight.trim();
  if (raw.endsWith("px")) return px(raw) || fontSize * 1.5;
  // Browsers resolve unitless values to px, but be safe for other environments.
  if (/^[\d.]+$/.test(raw)) return parseFloat(raw) * fontSize || fontSize * 1.5;
  return fontSize * 1.5;
}

/** Ancestors (and the document) whose scroll offset could move when the textarea collapses for measuring. */
function scrollSnapshot(el: HTMLElement): Array<[Element, number]> {
  const out: Array<[Element, number]> = [];
  for (let p = el.parentElement; p; p = p.parentElement) if (p.scrollTop > 0) out.push([p, p.scrollTop]);
  const root = el.ownerDocument.scrollingElement;
  if (root && root.scrollTop > 0 && !out.some(([e]) => e === root)) out.push([root, root.scrollTop]);
  return out;
}

export const AutoTextarea = forwardRef<HTMLTextAreaElement, AutoTextareaProps>(function AutoTextarea(
  { mode = "auto", minRows = 2, maxRows = 8, maxHeight, rows, style, onChange, value, ...rest },
  forwardedRef,
) {
  const elRef = useRef<HTMLTextAreaElement | null>(null);

  const setRefs = useCallback(
    (node: HTMLTextAreaElement | null) => {
      elRef.current = node;
      if (typeof forwardedRef === "function") forwardedRef(node);
      else if (forwardedRef) forwardedRef.current = node;
    },
    [forwardedRef],
  );

  const fixedRows = Math.max(1, rows ?? minRows);
  const lo = Math.max(1, minRows);
  const hi = Math.max(lo, maxRows);

  const resize = useCallback(() => {
    const el = elRef.current;
    if (!el) return;
    const view = el.ownerDocument.defaultView;
    if (!view) return;
    const cs = view.getComputedStyle(el);
    const lh = lineHeightPx(cs);
    const padY = px(cs.paddingTop) + px(cs.paddingBottom);
    const borderY = px(cs.borderTopWidth) + px(cs.borderBottomWidth);
    const borderBox = cs.boxSizing === "border-box";
    // style.height (content-box: content only; border-box: content + padding + border).
    const toHeight = (content: number) => content + (borderBox ? padY + borderY : 0);

    if (mode === "fixed") {
      el.style.height = `${toHeight(fixedRows * lh)}px`;
      el.style.overflowY = "auto";
      return;
    }

    // Cap: maxRows lines, tightened by any resolved max-height (the `maxHeight`
    // prop, applied inline below, or a CSS class) so overflow is never clipped.
    let capContent = hi * lh;
    const maxH = cs.maxHeight.trim();
    if (maxH.endsWith("px")) {
      const capBox = px(maxH);
      const capFromCss = borderBox ? capBox - padY - borderY : capBox;
      capContent = maxHeight ? capFromCss : Math.min(capContent, capFromCss);
    }
    const minContent = Math.min(lo * lh, Math.max(capContent, 0)) || lo * lh;

    // Reset-to-auto + scrollHeight; keep the textarea's own and the page's
    // scroll offsets so the collapse used for measuring never shows as a jump.
    const ownScroll = el.scrollTop;
    const ancestors = scrollSnapshot(el);
    el.style.height = "auto";
    const needed = el.scrollHeight - padY; // scrollHeight = content + padding, no border
    const content = Math.min(Math.max(needed, minContent), Math.max(capContent, minContent));
    el.style.height = `${toHeight(content)}px`;
    el.style.overflowY = needed > capContent + 0.5 ? "auto" : "hidden";
    el.scrollTop = ownScroll;
    for (const [node, top] of ancestors) if (node.scrollTop !== top) node.scrollTop = top;
  }, [mode, fixedRows, lo, hi, maxHeight]);

  // Mount, config change and programmatic value changes (draft restore, AI rewrite, reset to "").
  useIsoLayoutEffect(() => {
    resize();
  }, [resize, value]);

  // Width changes re-wrap the text; fonts loading late change line metrics.
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    let alive = true;
    let lastWidth = el.getBoundingClientRect().width;
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver((entries) => {
        const w = entries[entries.length - 1]?.contentRect.width ?? el.getBoundingClientRect().width;
        // Our own height writes also notify; only a width change needs a re-measure.
        if (Math.abs(w - lastWidth) < 0.5) return;
        lastWidth = w;
        resize();
      });
      ro.observe(el);
    }
    el.ownerDocument.fonts?.ready.then(() => {
      if (alive) resize();
    });
    return () => {
      alive = false;
      ro?.disconnect();
    };
  }, [resize]);

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => {
      onChange?.(e);
      // Uncontrolled usage has no `value` prop change to react to.
      resize();
    },
    [onChange, resize],
  );

  const merged: CSSProperties = {
    overflowY: mode === "fixed" ? "auto" : "hidden",
    ...style,
    ...(maxHeight && mode === "auto" ? { maxHeight } : null),
    resize: "none",
  };

  return (
    <textarea
      {...rest}
      ref={setRefs}
      value={value}
      rows={mode === "fixed" ? fixedRows : lo}
      onChange={handleChange}
      style={merged}
    />
  );
});

AutoTextarea.displayName = "AutoTextarea";
