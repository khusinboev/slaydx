/**
 * jsdom muhiti — interaktiv (dblclick, Enter/Esc, DnD, Ctrl+Z) testlar uchun.
 * SSR testlari (`tests/viewer/`) statik HTML ni sinaydi; bu yerda esa
 * haqiqiy DOM hodisalari va React holati. Har test faylining boshida
 * `import "./setup.ts"` bo'lishi shart.
 */
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
const g = globalThis as unknown as Record<string, unknown>;
g.window = dom.window;
g.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
g.HTMLElement = dom.window.HTMLElement;
g.Element = dom.window.Element;
g.Node = dom.window.Node;
g.KeyboardEvent = dom.window.KeyboardEvent;
g.MouseEvent = dom.window.MouseEvent;
g.DragEvent = dom.window.Event; // jsdom da DragEvent yo'q — Event bilan almashtiriladi
g.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
g.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 0) as unknown as number;
g.cancelAnimationFrame = (id: number) => clearTimeout(id);
g.IS_REACT_ACT_ENVIRONMENT = true;
if (!("ResizeObserver" in g)) {
  g.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}
