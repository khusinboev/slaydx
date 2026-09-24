/**
 * Cookie YOZADIGAN route'lar uchun Next so'rov konteksti (chiqish, kirish).
 *
 * `next-request.mts` dagi `inRequest` cookie'larni faqat O'QIYDI
 * (`phase: "render"`) — `cookies().set(...)` u yerda
 * `ReadonlyRequestCookiesError` beradi. Haqiqiy route handler'da Next
 * `phase: "action"` va o'zgaruvchan cookie omborini beradi, javobga esa
 * o'zgargan cookie'larni o'zi qo'shadi. Bu yordamchi shu omborni quradi va
 * route yozgan `Set-Cookie` qatorlarini qaytaradi.
 */
import "./next-request.mts"; // `globalThis.AsyncLocalStorage` — `next/*` dan OLDIN.

const { workAsyncStorage } = await import("next/dist/server/app-render/work-async-storage.external.js");
const { workUnitAsyncStorage } = await import("next/dist/server/app-render/work-unit-async-storage.external.js");
const { RequestCookiesAdapter, MutableRequestCookiesAdapter } = await import(
  "next/dist/server/web/spec-extension/adapters/request-cookies.js"
);
const { RequestCookies } = await import("next/dist/server/web/spec-extension/cookies.js");

/** `fn` ni cookie yozish mumkin bo'lgan so'rov kontekstida bajaradi; `setCookies` — route yozgan cookie'lar. */
export async function inRouteRequest<T>(req: Request, fn: () => Promise<T>): Promise<{ result: T; setCookies: string[] }> {
  let setCookies: string[] = [];
  const mutable = MutableRequestCookiesAdapter.wrap(new RequestCookies(req.headers), (list: string[]) => {
    setCookies = list;
  });
  const store = {
    type: "request",
    phase: "action",
    cookies: RequestCookiesAdapter.seal(new RequestCookies(req.headers)),
    mutableCookies: mutable,
    userspaceMutableCookies: mutable,
  };
  const work = { route: new URL(req.url).pathname, forceStatic: false, dynamicShouldError: false };
  const result = await workAsyncStorage.run(work as never, () => workUnitAsyncStorage.run(store as never, fn));
  return { result, setCookies };
}
