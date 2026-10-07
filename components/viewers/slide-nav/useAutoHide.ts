"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

/** Idle time (no pointer movement, press or focus) before the enlarged-mode controls fade out (ms). */
export const CHROME_HIDE_MS = 2500;

/**
 * Auto-hide of the enlarged-mode control pill on FINE pointers (a mouse on a
 * desktop / projector): after `CHROME_HIDE_MS` without pointer movement it
 * fades, so the audience sees the slide, not a dark block over its corner
 * (where a user's logo sits). Any pointer move/press or focus change inside
 * the page shows it again; it never hides while the pointer rests ON it or
 * while a control inside has keyboard focus. Touch devices pass
 * `active = false` and keep it visible (no mouse to wake it).
 *
 * The hidden pill stays in the tab order (a Tab press shows it: `focusin`).
 */
export function useAutoHide(
  active: boolean,
  ref: RefObject<HTMLElement | null>,
): { hidden: boolean; onPointerEnter: () => void; onPointerLeave: () => void } {
  const [hidden, setHidden] = useState(false);
  const hovering = useRef(false);

  useEffect(() => {
    if (!active) {
      setHidden(false);
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        const el = ref.current;
        // Resting on the pill, or a button inside it focused: stay, look again later.
        if (hovering.current || (el && document.activeElement && el.contains(document.activeElement))) {
          arm();
          return;
        }
        setHidden(true);
      }, CHROME_HIDE_MS);
    };
    const wake = () => {
      setHidden(false);
      arm();
    };
    arm();
    window.addEventListener("pointermove", wake);
    window.addEventListener("pointerdown", wake);
    window.addEventListener("focusin", wake);
    return () => {
      if (timer !== undefined) clearTimeout(timer);
      window.removeEventListener("pointermove", wake);
      window.removeEventListener("pointerdown", wake);
      window.removeEventListener("focusin", wake);
    };
  }, [active, ref]);

  return {
    hidden: active && hidden,
    onPointerEnter: () => {
      hovering.current = true;
    },
    onPointerLeave: () => {
      hovering.current = false;
    },
  };
}
