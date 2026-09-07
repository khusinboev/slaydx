"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { contentHeightPx } from "@/lib/viewers/metrics";
import { splitByHeight, type TextSplitter } from "@/lib/viewers/split";

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
    /**
     * Sahifadan uzun matnli bandlarni Word kabi bo'lib ko'rsatish.
     *
     * Berilmasa uzun band o'z varag'iga joylashadi va `.word-sheet`
     * `overflow:hidden` ostida past qismi kesiladi (AUDIT-6 3-band).
     * Split berilganda esa `h > limit` matnli band so'zlar bo'yicha ikkiga
     * bo'linadi: birinchi qism sig'adi, qolgani keyingi varag'ida davom
     * etadi. O'lchov juda uzun bandni QAYTA chizish uchun yana bir
     * aylanish qiladi — shuning uchun bo'laklar ham aniq o'lchanadi.
     */
    split?: TextSplitter<T>;
  } = {},
): { pages: T[][] | null; measureNode: ReactNode } {
  const ref = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<T[][] | null>(null);
  // Split'dan chiqqan bandlar — `signature` o'zgarmasa saqlanadi, aks holda
  // yangi `items` ishlatiladi (eski bo'lingan ro'yxat yangisiga tegishli emas).
  const [flow, setFlow] = useState<{ sig: string; list: T[] } | null>(null);
  const limit = opts.limit ?? contentHeightPx({ footer: true });
  const signature = opts.key ?? String(items.length);
  const renderItems = flow?.sig === signature ? flow.list : items;

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const hs = (Array.from(root.children) as HTMLElement[]).map((el) => el.getBoundingClientRect().height);

    // Uzun matnli bandlarni bo'lamiz. `changed` bo'lsa, yangi `list` ni
    // chizib yuboramiz (DOM qayta quriladi) va keyingi aylanishda bo'laklar
    // aniq o'lchanadi. Bo'lak ham sig'masa — u ham bo'linadi (iterativ).
    if (opts.split) {
      const next = splitByHeight(renderItems, hs, limit, opts.split);
      if (next.changed) {
        setFlow({ sig: signature, list: next.list });
        return;
      }
    }

    const out: T[][] = [];
    let cur: T[] = [];
    let used = 0;
    renderItems.forEach((item, i) => {
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
    // `renderItems` / `opts.split` — barqaror (callback'lar), `flow` esa
    // split'ning keyingi aylanishini bildiradi.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, limit, flow]);

  const measureNode = (
    <div
      aria-hidden
      ref={ref}
      className={cn(
        // `invisible` — layout'da qoladi (o'lchov ishlaydi), lekin brauzer
        // Ctrl+F uni o'tkazib yuboradi (matn ikki marta topilmaydi).
        "invisible pointer-events-none fixed top-0 -left-[12000px] w-[165mm] font-[family-name:var(--font-doc)] text-[14pt] leading-[1.5]",
        opts.className,
      )}
    >
      {renderItems.map((it, i) => (
        <div key={i} style={{ display: "flow-root" }}>
          {render(it, i)}
        </div>
      ))}
    </div>
  );

  return { pages, measureNode };
}
