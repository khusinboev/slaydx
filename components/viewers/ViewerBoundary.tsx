"use client";

import { Component, createElement, lazy, useEffect, useState, type ComponentProps, type ComponentType, type ErrorInfo, type ReactNode } from "react";
import { isChunkLoadError, reloadOnceForChunkError } from "@/lib/chunk-reload";

/**
 * Ko'ruvchi bo'laklarini yuklash: xato chegarasi, qayta urinish va skelet
 * (viewer polish V5b, `docs/viewer/PLAN.md` «Phase 2» 5-band).
 *
 * Muammo: ko'ruvchilar `React.lazy` bo'laklari. Tarmoq uzilsa yoki deploydan
 * keyin eski xesh so'ralsa `import()` rad etiladi; `React.lazy` rad etilgan
 * promise'ni KESHLAYDI — oddiy qayta chizish o'sha xatoni qayta otadi va
 * ko'ruvchi abadiy «Yuklanmoqda…» yoki umumiy xato sahifasida qolardi.
 *
 * - `retryableLazy` — `lazy` o'rami: `resetViewerChunks()` har bo'lakka YANGI
 *   `lazy` beradi, ya'ni keyingi chizishda `import()` haqiqatan qayta bajariladi.
 * - `ViewerBoundary` — xato chegarasi: «Ko'ruvchini yuklab bo'lmadi» +
 *   «Qayta urinish»; bo'lak xatosida («ChunkLoadError», deploydan keyin) —
 *   qo'shimcha «Sahifani yangilash» (to'liq qayta yuklash).
 * - `ViewerLoading` — ramka kattaligidagi skelet; ~10 s dan oshsa — maslahat va «Qayta urinish».
 */

const resetters: Array<() => void> = [];

/** `lazy` o'rami: `resetViewerChunks()` dan keyin `load` qayta chaqiriladi (keshlangan rad etish tashlanadi). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- `React.lazy` imzosi bilan bir xil
export function retryableLazy<T extends ComponentType<any>>(load: () => Promise<{ default: T }>): ComponentType<ComponentProps<T>> {
  let Inner = lazy(load);
  resetters.push(() => {
    Inner = lazy(load);
  });
  // Doimiy o'ram: element turi o'zgarmaydi, har chizishda joriy `Inner` olinadi.
  return function RetryableLazy(props: ComponentProps<T>) {
    return createElement(Inner as unknown as ComponentType<ComponentProps<T>>, props);
  };
}

/** Barcha ko'ruvchi bo'laklari uchun yangi `lazy` — keyingi chizishda `import()` qayta bajariladi. */
export function resetViewerChunks(): void {
  for (const r of resetters) r();
}

type BoundaryProps = { onRetry: () => void; children?: ReactNode };

export class ViewerBoundary extends Component<BoundaryProps, { error: unknown }> {
  state: { error: unknown } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error: error ?? new Error("viewer") };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("[viewer] ko'ruvchi yuklanmadi/yiqildi", error, info.componentStack);
    // Deploydan keyingi eski xesh: app/error.tsx dagidek BIR MARTA avtomatik to'liq qayta yuklash (sikl himoyasi bilan).
    reloadOnceForChunkError(error);
  }

  render() {
    if (this.state.error == null) return this.props.children;
    const chunk = isChunkLoadError(this.state.error);
    return (
      <div role="alert" data-viewer-error={chunk ? "chunk" : "render"} className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-sm font-medium">Ko‘ruvchini yuklab bo‘lmadi</p>
        <p className="text-muted-foreground max-w-sm text-xs">
          {chunk
            ? "Aloqa uzilgan yoki sayt yangilangan bo‘lishi mumkin. Qayta urinib ko‘ring; yordam bermasa sahifani yangilang."
            : "Kutilmagan xato yuz berdi. Qayta urinib ko‘ring."}
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <button
            type="button"
            data-viewer-retry
            onClick={this.props.onRetry}
            className="bg-primary text-primary-foreground inline-flex h-9 items-center rounded-lg px-4 text-sm font-medium"
          >
            Qayta urinish
          </button>
          {chunk ? (
            <button
              type="button"
              data-viewer-reload
              onClick={() => window.location.reload()}
              className="bg-card inline-flex h-9 items-center rounded-lg border px-4 text-sm"
            >
              Sahifani yangilash
            </button>
          ) : null}
        </div>
      </div>
    );
  }
}

/** Bo'lak shuncha vaqtdan oshsa maslahat chiqadi. */
export const SLOW_LOAD_MS = 10_000;

/**
 * Suspense zaxirasi: ramkani to'ldiradigan skelet (asboblar qatori + sahifa
 * o'rni), shuning uchun ko'ruvchi kelganda sahifa sakramaydi. Ramka o'zi
 * (`frameClass`) kattalikni beradi — bu `flex-1`.
 */
export function ViewerLoading({ onRetry, slowMs = SLOW_LOAD_MS }: { onRetry: () => void; slowMs?: number }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), slowMs);
    return () => clearTimeout(t);
  }, [slowMs]);
  return (
    <div role="status" aria-busy="true" aria-live="polite" data-viewer-loading className="flex flex-1 flex-col">
      <div className="bg-muted/50 h-10 shrink-0 animate-pulse border-b" aria-hidden />
      <div className="flex flex-1 items-start justify-center p-3 sm:p-6" aria-hidden>
        <div className="bg-muted/60 aspect-[210/297] w-full max-w-3xl animate-pulse rounded-md" />
      </div>
      <p className="text-muted-foreground px-4 pb-4 text-center text-sm">Yuklanmoqda...</p>
      {slow ? (
        <div className="flex flex-col items-center gap-2 px-4 pb-6 text-center" data-viewer-slow>
          <p className="text-muted-foreground text-xs">Yuklash odatdagidan uzoq davom etmoqda. Aloqani tekshirib, qayta urinib ko‘ring.</p>
          <button type="button" data-viewer-retry onClick={onRetry} className="bg-card inline-flex h-9 items-center rounded-lg border px-4 text-sm">
            Qayta urinish
          </button>
        </div>
      ) : null}
    </div>
  );
}
