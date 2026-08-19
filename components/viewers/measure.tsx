"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { contentHeightPx } from "@/lib/viewers/metrics";

/**
 * Bandlarni HAQIQIY balandligi bo'yicha varaqlarga joylaydi.
 *
 * Nega kerak: ko'ruvchilarning har biri o'z sahifalash usulini ishlatardi
 * va to'rttasi hech narsa o'lchamasdi — glossariyda «8 ta atama», dars
 * rejasida «2 varaq», jadvalda «N qator» kabi qat'iy sonlar. Kontent
 * uzunroq bo'lsa matn varaqdan chiqib ketardi va qo'shni varaq ustiga
 * tushardi.
 *
 * O'lchov ekrandan tashqarida, HAQIQIY kenglik (165 mm) va hujjat shrifti
 * bilan bajariladi. Har band `flow-root` o'ramida — usiz bolaning
 * vertikal chegarasi o'ramdan chiqib ketadi va balandlik kam o'lchanadi.
 */
export function useMeasuredPages<T>(
  items: T[],
  render: (item: T, index: number) => ReactNode,
  opts: {
    limit?: number;
    className?: string;
    key?: string;
    /** Shu band doim yangi varaqdan boshlansin (masalan har keys). */
    breakBefore?: (item: T, index: number) => boolean;
  } = {},
): { pages: T[][] | null; measureNode: ReactNode } {
  const ref = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<T[][] | null>(null);
  const limit = opts.limit ?? contentHeightPx({ footer: true });
  const signature = opts.key ?? String(items.length);

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const hs = (Array.from(root.children) as HTMLElement[]).map((el) => el.getBoundingClientRect().height);
    const out: T[][] = [];
    let cur: T[] = [];
    let used = 0;
    items.forEach((item, i) => {
      const h = Math.max(8, hs[i] ?? 24);
      const forced = cur.length > 0 && Boolean(opts.breakBefore?.(item, i));
      if (forced || (cur.length && used + h > limit)) {
        out.push(cur);
        cur = [item];
        used = h;
      } else {
        cur.push(item);
        used += h;
      }
    });
    if (cur.length) out.push(cur);
    setPages(out.length ? out : [[]]);
    // `signature` — bandlar o'zgarganini bildiradi; `items` har renderda
    // yangi massiv bo'lishi mumkin, shuning uchun unga bog'lanmaymiz.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, limit]);

  const measureNode = (
    <div
      aria-hidden
      ref={ref}
      className={cn(
        "pointer-events-none fixed top-0 -left-[12000px] w-[165mm] font-[family-name:var(--font-doc)] text-[14pt] leading-[1.5]",
        opts.className,
      )}
    >
      {items.map((it, i) => (
        <div key={i} style={{ display: "flow-root" }}>
          {render(it, i)}
        </div>
      ))}
    </div>
  );

  return { pages, measureNode };
}
