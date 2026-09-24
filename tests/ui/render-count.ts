/**
 * Komponent RENDER sanog'i (FE-13) — React DevTools ilgagi orqali.
 *
 * React DOM ning dev bandli `__REACT_DEVTOOLS_GLOBAL_HOOK__` ga ichki
 * profil ilgaklarini beradi; `markComponentRenderStarted(fiber)` funksiya
 * komponent HAQIQATAN chaqirilganda (memo/bailout paytida EMAS) ishlaydi.
 * Shu bilan «qaysi komponent necha marta chizildi» aniq sanaladi —
 * modul mock (`--experimental-test-module-mocks`) kerak emas.
 *
 * MUHIM: bu fayl `react-dom` dan OLDIN import qilinishi shart
 * (`import "./setup.ts"; import "./render-count.ts";` — keyin qolganlar).
 */
const counts = new Map<string, number>();

type Fiber = { type?: { displayName?: string; name?: string } | string | null };

const profilingHooks = new Proxy(
  {
    markComponentRenderStarted(fiber: Fiber) {
      const t = fiber.type;
      const name = t && typeof t !== "string" ? t.displayName || t.name : undefined;
      if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
    },
  } as Record<string, unknown>,
  // Qolgan barcha `markXxx` ilgaklari — bo'sh funksiya.
  { get: (target, key) => (key in target ? target[key as string] : () => {}) },
);

(globalThis as Record<string, unknown>).__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
  supportsFiber: true,
  renderers: new Map(),
  inject(internals: { injectProfilingHooks?: (h: unknown) => void }) {
    internals.injectProfilingHooks?.(profilingHooks);
    return 1;
  },
  checkDCE() {},
  onScheduleFiberRoot() {},
  onCommitFiberRoot() {},
  onCommitFiberUnmount() {},
  onPostCommitFiberRoot() {},
  setStrictMode() {},
};

/** `name` komponenti oxirgi `resetRenders()` dan beri necha marta chizildi. */
export function renders(name: string): number {
  return counts.get(name) ?? 0;
}

export function resetRenders(): void {
  counts.clear();
}
