/**
 * Route handler'ni HAQIQIY `requireUser` bilan chaqirish uchun Next so'rov konteksti.
 *
 * `requireUser` → `currentUser` → `cookies()` (`next/headers`) faqat Next
 * so'rov konteksti ichida ishlaydi, shuning uchun ilgari route testlari
 * route'ning o'zini emas, u chaqiradigan funksiyani sinardi. Bu yordamchi
 * Next'ning o'z `AsyncLocalStorage` omborlarini (`workAsyncStorage` +
 * `workUnitAsyncStorage`, `type: "request"`) cookie sarlavhasi bilan
 * to'ldiradi — route to'liq yo'l bilan (sessiya jadvali, egalik SQL,
 * `handler` xato xaritasi) ishlaydi.
 *
 * Bu modul `next/headers` dan OLDIN import qilinishi kerak: Next
 * `globalThis.AsyncLocalStorage` ni modul yuklanayotganda o'qiydi.
 */
import { AsyncLocalStorage } from "node:async_hooks";

(globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage ??= AsyncLocalStorage;

const { workAsyncStorage } = await import("next/dist/server/app-render/work-async-storage.external.js");
const { workUnitAsyncStorage } = await import("next/dist/server/app-render/work-unit-async-storage.external.js");
const { RequestCookiesAdapter } = await import("next/dist/server/web/spec-extension/adapters/request-cookies.js");
const { RequestCookies } = await import("next/dist/server/web/spec-extension/cookies.js");

/** `fn` ni `req` ning cookie'lari ko'rinadigan Next so'rov kontekstida bajaradi. */
export function inRequest<T>(req: Request, fn: () => Promise<T>): Promise<T> {
  const store = {
    type: "request",
    phase: "render",
    cookies: RequestCookiesAdapter.seal(new RequestCookies(req.headers)),
  };
  const work = { route: new URL(req.url).pathname, forceStatic: false, dynamicShouldError: false };
  return workAsyncStorage.run(work as never, () => workUnitAsyncStorage.run(store as never, fn));
}
