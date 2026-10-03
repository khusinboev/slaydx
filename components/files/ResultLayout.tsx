"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ChevronRight, PanelRightClose, PanelRightOpen, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { useDialog } from "../overlays/useDialog";
import { readPanelOpen, useWide, writePanelOpen } from "./result-layout/prefs";
import type { ChipTone } from "./result-layout/summary";

/**
 * Natija sahifasining maketi (viewer redesign V0, `docs/viewer/PLAN.md`).
 *
 * BITTA sahifa scroll'i: sahifa AppShell `<main>` ichida aylanadi, bu
 * yerda `overflow-hidden` ham, ichki scroll qutisi ham yo'q. Ilgari
 * hisobot (45vh) + o'yin havolasi (45vh) + ko'ruvchi (70vh) bitta
 * `overflow-hidden` qutiga tiqilardi va hujjat oxiri ko'rinmasdi
 * (R1 §1, R2: tinglash/saralashda 0 %).
 *
 * Shartnoma (ko'ruvchilar shunga tayanadi):
 * - `--result-header-h` — sticky sarlavha balandligi (px, ResizeObserver);
 *   ko'ruvchi toolbari `sticky top-[var(--result-header-h)]` bilan ostiga yopishadi;
 * - `--result-fill-h` — sarlavha ostidagi qolgan ekran:
 *   `calc(100svh - var(--app-topbar-h) - var(--result-header-h))`;
 *   `fill` ko'ruvchi (slayd) aynan shu balandlikni oladi;
 * - `--app-topbar-h` — AppShell TopBar (`h-14`).
 *
 * Ikkinchi darajali bloklar (`sections`: tayyorlik hisoboti, o'yin
 * havolasi) HECH QACHON mazmun ustida turmaydi: ≥ 1280 px da o'ngdagi
 * yig'iladigan panel (sticky, o'z scroll'i — yagona ruxsat etilgan
 * ikkinchi scroll, unda hujjat mazmuni yo'q), torroq ekranda sarlavha
 * chiplari ochadigan pastki varaq (fokus tuzog'i, Escape, fokus qaytadi).
 *
 * Panel mazmuni DOM da BIR MARTA chiziladi — keng/tor rejim faqat
 * klasslar bilan almashadi; panel ichidagi holat (masalan o'yin
 * natijalari sahifasi) ekran o'lchami o'zgarganda yo'qolmaydi.
 */

export type PanelSection = {
  /** `data-panel-section` va chip ↔ bo'lim bog'lanishi: "review", "share". */
  id: string;
  /** Bo'lim nomi — panel sarlavhasi va ekran o'quvchi uchun. */
  title: string;
  /** Sarlavha chipidagi qisqa xulosa («Tayyorlik 77 · 2 xato»). */
  chip: string;
  tone?: ChipTone;
  content: ReactNode;
};

const TONE_DOT: Record<ChipTone, string> = {
  green: "bg-emerald-500",
  yellow: "bg-amber-500",
  red: "bg-red-500",
  neutral: "bg-muted-foreground/50",
};

export function ResultLayout({
  header,
  notices,
  sections = [],
  frame,
  children,
}: {
  /** Sarlavha qatori (orqaga, nom, amallar) — sticky blok ichida chiziladi. */
  header: ReactNode;
  /** Qisqa holat qatorlari (PDF holati, xato) — sarlavha ostida, u bilan birga yopishgan. */
  notices?: ReactNode;
  sections?: PanelSection[];
  /** Ko'ruvchi ramkasi (`flow`/`fill`) — faqat belgi (`data-result-frame`); o'lchamni ramkaning o'zi oladi. */
  frame?: "flow" | "fill";
  children: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const wide = useWide();
  const hasPanel = sections.length > 0;

  /*
   * Sarlavha balandligi → `--result-header-h`. To'g'ridan-to'g'ri
   * `style.setProperty` (React holati emas): o'lcham o'zgarganda butun
   * ko'ruvchi daraxti qayta chizilmasin.
   */
  useLayoutEffect(() => {
    const root = rootRef.current;
    const head = headRef.current;
    if (!root || !head) return;
    const apply = () => root.style.setProperty("--result-header-h", `${Math.round(head.getBoundingClientRect().height)}px`);
    apply();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(apply);
    ro.observe(head);
    return () => ro.disconnect();
  }, []);

  /* Keng ekrandagi panel — standart OCHIQ (mazmun bo'lsa), tanlov eslab qolinadi. */
  const [dockOpen, setDockOpen] = useState<boolean>(() => readPanelOpen() ?? true);
  /* Tor ekrandagi varaq — standart YOPIQ: ochilgan varaq hujjatni to'sardi. */
  const [sheetOpen, setSheetOpen] = useState(false);
  /** Chip bosilganda ko'rsatiladigan bo'lim (panel ochilgach unga suriladi). */
  const [target, setTarget] = useState<{ id: string; n: number } | null>(null);

  const setDock = useCallback((open: boolean) => {
    setDockOpen(open);
    writePanelOpen(open);
  }, []);
  const closeSheet = useCallback(() => setSheetOpen(false), []);

  // Ekran kengaysa varaq yopiladi (keng rejimda u panelning o'zi bo'ladi).
  useEffect(() => {
    if (wide) setSheetOpen(false);
  }, [wide]);

  const sheetActive = hasPanel && !wide && sheetOpen;
  const panelRef = useDialog(sheetActive, closeSheet);

  const openSection = useCallback(
    (id: string) => {
      if (wide) setDock(true);
      else setSheetOpen(true);
      setTarget((t) => ({ id, n: (t?.n ?? 0) + 1 }));
    },
    [wide, setDock],
  );

  /*
   * Bo'limga surish faqat PANEL tanasining o'z scroll'ida (`scrollTop`),
   * `scrollIntoView` emas — u sahifani (`<main>`) ham surib yuborardi.
   */
  useEffect(() => {
    if (!target) return;
    const body = bodyRef.current;
    const el = body?.querySelector<HTMLElement>(`[data-panel-section="${target.id}"]`);
    if (!body || !el) return;
    body.scrollTop = el.offsetTop;
    if (wide) el.focus({ preventScroll: true });
  }, [target, wide]);

  const panelVisible = wide ? dockOpen : sheetOpen;
  const panelTitle = sections.map((s) => s.title).join(" · ");

  return (
    <div
      ref={rootRef}
      data-result-layout
      data-result-frame={frame}
      className="flex shrink-0 grow flex-col"
      style={{
        ["--app-topbar-h" as string]: "3.5rem",
        ["--result-fill-h" as string]: "calc(100svh - var(--app-topbar-h) - var(--result-header-h, 0px))",
      }}
    >
      <div ref={headRef} data-result-header className="no-print bg-background/95 sticky top-0 z-20 border-b backdrop-blur">
        {header}
        {notices}
        {hasPanel ? (
          <div className="flex flex-wrap items-center gap-1.5 px-3 pb-2 sm:px-4" data-result-chips>
            {sections.map((s) => (
              <button
                key={s.id}
                type="button"
                data-panel-chip={s.id}
                aria-controls={panelId}
                aria-expanded={panelVisible}
                onClick={() => openSection(s.id)}
                className="bg-card hover:bg-muted inline-flex h-7 max-w-full items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium"
              >
                <span className={cn("size-2 shrink-0 rounded-full", TONE_DOT[s.tone ?? "neutral"])} aria-hidden />
                <span className="truncate">{s.chip}</span>
                <ChevronRight className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
              </button>
            ))}
            <button
              type="button"
              data-panel-toggle
              aria-controls={panelId}
              aria-expanded={dockOpen}
              aria-label={dockOpen ? "Panelni yashirish" : "Panelni ko‘rsatish"}
              title={dockOpen ? "Panelni yashirish" : "Panelni ko‘rsatish"}
              onClick={() => setDock(!dockOpen)}
              className="text-muted-foreground hover:bg-muted ml-auto hidden size-7 items-center justify-center rounded-md xl:inline-flex"
            >
              {dockOpen ? <PanelRightClose className="size-4" /> : <PanelRightOpen className="size-4" />}
            </button>
          </div>
        ) : null}
      </div>

      <div className="flex grow items-start" data-result-body>
        <div className="flex min-w-0 grow flex-col self-stretch" data-result-content>
          {children}
        </div>

        {hasPanel ? (
          <>
            {sheetActive ? (
              <div className="no-print fixed inset-0 z-40 bg-black/40 xl:hidden" aria-hidden onClick={closeSheet} data-panel-backdrop />
            ) : null}
            <aside
              ref={panelRef}
              id={panelId}
              data-result-panel={wide ? "dock" : "sheet"}
              data-panel-open={panelVisible ? "1" : "0"}
              aria-label={panelTitle}
              role={sheetActive ? "dialog" : undefined}
              aria-modal={sheetActive ? true : undefined}
              className={cn(
                "no-print bg-background flex-col",
                // Tor ekran: pastki varaq.
                sheetOpen ? "fixed inset-x-0 bottom-0 z-50 flex max-h-[85svh] rounded-t-2xl border-t shadow-2xl" : "hidden",
                // Keng ekran: o'ngdagi sticky panel, o'z scroll'i bilan.
                dockOpen
                  ? "xl:sticky xl:inset-auto xl:top-[var(--result-header-h)] xl:z-10 xl:flex xl:max-h-[var(--result-fill-h)] xl:w-[380px] xl:shrink-0 xl:rounded-none xl:border-t-0 xl:border-l xl:shadow-none"
                  : "xl:hidden",
              )}
            >
              <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
                <p className="min-w-0 flex-1 truncate text-sm font-semibold">{panelTitle}</p>
                <button
                  type="button"
                  data-panel-close
                  aria-label="Panelni yopish"
                  title="Panelni yopish"
                  onClick={() => (wide ? setDock(false) : closeSheet())}
                  className="text-muted-foreground hover:bg-muted flex size-8 items-center justify-center rounded-md"
                >
                  <X className="size-4" />
                </button>
              </div>
              <div ref={bodyRef} className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain" data-panel-body>
                {sections.map((s) => (
                  <section
                    key={s.id}
                    data-panel-section={s.id}
                    aria-label={s.title}
                    tabIndex={-1}
                    className="border-b p-3 outline-none last:border-b-0"
                  >
                    {s.content}
                  </section>
                ))}
              </div>
            </aside>
          </>
        ) : null}
      </div>
    </div>
  );
}
