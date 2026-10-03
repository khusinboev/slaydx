/**
 * In-app history engine (docs/nav/PLAN.md, R4 §5). Framework-free; React
 * bindings live in `components/nav/*`.
 *
 * Every history entry is stamped with `history.state.sx = { i, o? }`:
 *   - `i`: the entry's index inside this tab's in-app run (0 = the first
 *     in-app entry: fresh tab, deep link, external referrer). `backTo()`
 *     goes back only when the page's base entry has `i > 0`; otherwise it
 *     REPLACES the page with its parent, so back never leaves the site.
 *   - `o`: the token of the overlay / leave-guard "layer" that pushed this
 *     entry (same URL as the page under it). Back from it closes the layer.
 *
 * Next 15.5 facts this relies on (verified in 15.5.26, R4 §5):
 *   - Next writes its entries with `history.pushState/replaceState`; for
 *     navigate / refresh / server actions it does NOT keep custom keys. The
 *     engine wraps both methods and re-injects the stamp of the current entry
 *     from its in-memory mirror, so `router.refresh()` never erases it.
 *   - A `popstate` makes Next dispatch a RESTORE, which DISCARDS a pending
 *     navigate/refresh. Pops between our own same-URL entries are therefore
 *     swallowed (`stopImmediatePropagation` in a capture listener, which runs
 *     before Next's), so `close(); router.push(x)` and `close(); router.refresh()`
 *     keep working.
 *
 * One engine per tab (module scope), mirrored to sessionStorage for the
 * cross-document cases (reload, hard navigation).
 */
import { adminListOf, isAdminListPath, parentOf } from "./parents";

export type LayerKind = "overlay" | "guard";
export type PopReason = "back" | "navigate";
export type PopInfo = {
  /** `back`: a back press popped the entry. `navigate`: the page is being left. */
  reason: PopReason;
  /** The traversal stopped on the entry right under this layer (a single back press). */
  landedOnBase: boolean;
};

type Layer = {
  token: string;
  kind: LayerKind;
  /** History index of the entry this layer pushed; -1 while its push waits for an in-flight pop. */
  index: number;
  onPop: (info: PopInfo) => void;
  /** Released while not on top: its entry is skipped by the next traversal. */
  dead: boolean;
  /** Released on top; the pop runs in a microtask unless a new layer takes the entry over. */
  releasing: boolean;
  /** `inputSeq` when opened: same value at a navigation = opened by the gesture that navigated. */
  openedInput: number;
};
type Sx = { i: number; o?: string };
/** A traversal we started ourselves: matched FIFO by its delta, not by a user press. */
type Expected = { delta: number; at: number; seq: number; swallow?: boolean; then?: () => void };

/** The subset of the app router the engine needs (`AppRouterInstance` satisfies it). */
export type NavRouter = { push: (href: string) => void; replace: (href: string) => void };

export type NavSnapshot = {
  /** Current history index. */
  index: number;
  /** Open overlay layers. */
  overlays: number;
  /** Some leave guard has unsaved work. */
  guardPending: boolean;
  /** `location.href` of the current entry. */
  href: string;
};

export type NavigateKind = "push" | "replace" | "traverse";
export type NavigateEvent = {
  kind: NavigateKind;
  href: string;
  pathname: string;
  index: number;
  from: string;
  /** `inputSequence()` at commit: overlays opened before this input belong to the old page. */
  input: number;
};

export type LeaveGuard = {
  isPending: () => boolean;
  /** Resolve `false` (or throw) when the save failed: the navigation is then cancelled. */
  save: () => Promise<boolean | void>;
  onError?: (error: unknown) => void;
};

const STORE_KEY = "sx:nav";
const LIST_KEY = "sx:list:";
const EXPECT_TTL_MS = 2000;

// ---------------------------------------------------------------- state

let installed = false;
let cur = 0;
let curSx: Sx = { i: 0 };
let lastHref = "";
let lastState: unknown = null;
let navSeq = 0;
/** Bumped on every pointerdown/keydown: tells "opened with this navigation" from "left open". */
let inputSeq = 0;
let tokenSeq = 0;
let router: NavRouter | null = null;
let layers: Layer[] = [];
let expected: Expected[] = [];
/** Layers taken off the stack by a navigation whose UI is about to be closed (see `closeLater`). */
const pendingClose = new Map<string, Layer>();
const guards = new Set<LeaveGuard>();
const listeners = new Set<() => void>();
const navListeners = new Set<(e: NavigateEvent) => void>();
let snapshot: NavSnapshot = { index: 0, overlays: 0, guardPending: false, href: "" };
let notifyQueued = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let prevPush: History["pushState"] | null = null;
let prevReplace: History["replaceState"] | null = null;
let ourPush: History["pushState"] | null = null;
let ourReplace: History["replaceState"] | null = null;

const hasWindow = () => typeof window !== "undefined" && typeof window.history !== "undefined";

function readSx(state: unknown): Sx | null {
  const sx = (state as { sx?: unknown } | null | undefined)?.sx as Partial<Sx> | undefined;
  if (!sx || typeof sx !== "object" || typeof sx.i !== "number" || !Number.isFinite(sx.i)) return null;
  return typeof sx.o === "string" ? { i: sx.i, o: sx.o } : { i: sx.i };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

function withSx(data: unknown, sx: Sx): unknown {
  if (data == null) return { sx };
  if (!isPlainObject(data)) return data; // foreign non-object state: leave it alone (memory still knows `cur`)
  return { ...data, sx };
}

function storageGet(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
function storageSet(key: string, value: string) {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    /* private mode / quota: memory still works */
  }
}

function mirror() {
  storageSet(STORE_KEY, String(cur));
}

const isLive = (l: Layer) => !l.dead && !l.releasing;

function computeSnapshot(): NavSnapshot {
  const overlays = layers.filter((l) => l.kind === "overlay" && isLive(l)).length;
  let guardPending = false;
  for (const g of guards) if (safePending(g)) guardPending = true;
  return { index: cur, overlays, guardPending, href: lastHref };
}

function safePending(g: LeaveGuard): boolean {
  try {
    return g.isPending();
  } catch {
    return false;
  }
}

/**
 * Listener calls are deferred to a microtask: the wrappers run inside Next's
 * `useInsertionEffect`, where React forbids scheduling updates.
 */
function notify() {
  if (notifyQueued) return;
  notifyQueued = true;
  queueMicrotask(() => {
    notifyQueued = false;
    const next = computeSnapshot();
    const prev = snapshot;
    if (
      next.index === prev.index &&
      next.overlays === prev.overlays &&
      next.guardPending === prev.guardPending &&
      next.href === prev.href
    ) {
      return;
    }
    snapshot = next;
    for (const l of [...listeners]) l();
  });
}

function emitNavigate(kind: NavigateKind, from: string) {
  const href = lastHref;
  const e: NavigateEvent = { kind, href, pathname: pathOf(href), index: cur, from, input: inputSeq };
  queueMicrotask(() => {
    for (const l of [...navListeners]) l(e);
  });
}

function pruneExpected() {
  const now = Date.now();
  expected = expected.filter((x) => now - x.at < EXPECT_TTL_MS);
}

/** Sum of the deltas still in flight: where `cur` will be once they land. */
function effectiveIndex(): number {
  pruneExpected();
  return cur + expected.reduce((s, x) => s + x.delta, 0);
}

function go(delta: number, extra?: Partial<Expected>) {
  expected.push({ delta, at: Date.now(), seq: navSeq, ...extra });
  window.history.go(delta);
}

// ---------------------------------------------------------------- install / boot

/**
 * Installs the history wrappers and the popstate/click listeners once per tab
 * (idempotent; safe in React StrictMode). Called by `NavProvider` and lazily by
 * every entry point, so a dialog that mounts before the provider's effect
 * still gets a stamped history.
 */
export function installNav(): void {
  if (installed || !hasWindow()) return;
  installed = true;
  const h = window.history;

  prevPush = h.pushState;
  prevReplace = h.replaceState;
  ourPush = function pushState(data: unknown, unused: string, url?: string | URL | null) {
    return onPush(data, unused, url);
  };
  ourReplace = function replaceState(data: unknown, unused: string, url?: string | URL | null) {
    return onReplace(data, unused, url);
  };
  h.pushState = ourPush;
  h.replaceState = ourReplace;

  // Capture: at-target capture listeners run before Next's (non-capture) popstate one.
  window.addEventListener("popstate", onPopState, true);
  window.addEventListener("click", onClickCapture, true);
  window.addEventListener("pointerdown", onInput, true);
  window.addEventListener("keydown", onInput, true);

  boot();
}

function onInput() {
  inputSeq += 1;
}

function boot() {
  const h = window.history;
  lastHref = window.location.href;
  const sx = readSx(h.state);
  if (sx) {
    cur = sx.i;
    curSx = { i: cur };
    if (sx.o) {
      // A layer entry from a previous document: its overlay is gone.
      if (navigationType() === "back_forward") {
        // Cross-document traversal into it: keep going the same way.
        const before = Number(storageGet(STORE_KEY));
        const dir = Number.isFinite(before) && sx.i > before ? 1 : -1;
        curSx = sx;
        lastState = h.state;
        mirror();
        h.go(dir);
        return;
      }
      // Reload with an overlay open: keep the entry, drop the stale marker.
      prevReplace!.call(h, withSx(h.state, curSx), "");
    }
  } else {
    // First in-app entry of this document. A same-origin referrer with a
    // known previous index means the entry under it is ours (hard in-app
    // navigation); anything else (new tab, typed URL, external site) is 0.
    const before = storageGet(STORE_KEY);
    const prevIndex = before == null ? NaN : Number(before);
    cur = h.length > 1 && sameOriginReferrer() && Number.isFinite(prevIndex) ? prevIndex + 1 : 0;
    curSx = { i: cur };
    prevReplace!.call(h, withSx(h.state, curSx), "");
  }
  lastState = h.state;
  mirror();
  rememberListUrl(lastHref);
  snapshot = computeSnapshot();
}

function navigationType(): string {
  try {
    const e = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    return e?.type ?? "navigate";
  } catch {
    return "navigate";
  }
}

function sameOriginReferrer(): boolean {
  try {
    return Boolean(document.referrer) && new URL(document.referrer).origin === window.location.origin;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- wrappers

function resolveHref(url: string | URL | null | undefined): string {
  if (url == null || url === "") return window.location.href;
  try {
    return new URL(String(url), window.location.href).href;
  } catch {
    return window.location.href;
  }
}

function pathOf(href: string): string {
  try {
    return new URL(href).pathname;
  } catch {
    return "";
  }
}

function onPush(data: unknown, unused: string, url?: string | URL | null) {
  const from = window.location.href;
  const own = readSx(data);
  let d = data;
  let kept: Layer[] = [];
  if (own) {
    // Our own layer push.
    cur = own.i;
    curSx = own;
  } else {
    // A navigation (Next `router.push`, `<Link>`, third-party pushState): a
    // new entry on top. Every layer is now in the past.
    kept = abandonAll();
    cur += 1;
    curSx = { i: cur };
    d = withSx(data, curSx);
    navSeq += 1;
  }
  const ret = prevPush!.call(window.history, d, unused, url);
  lastState = d;
  lastHref = window.location.href;
  mirror();
  if (!own) {
    rememberListUrl(lastHref);
    emitNavigate("push", from);
  }
  repushLater(kept);
  notify();
  return ret;
}

function onReplace(data: unknown, unused: string, url?: string | URL | null) {
  const from = window.location.href;
  const to = resolveHref(url);
  const own = readSx(data);
  let d = data;
  let kept: Layer[] = [];
  if (own) {
    cur = own.i;
    curSx = own;
  } else {
    if (pathOf(to) !== pathOf(from)) {
      // `router.replace` to another page: the layers' UI is leaving.
      kept = abandonAll();
      curSx = { i: cur };
      navSeq += 1;
    }
    // Same page (Next refresh / server action, search-param state): keep the
    // stamp, layer token included, that Next would otherwise erase.
    d = withSx(data, curSx);
  }
  const ret = prevReplace!.call(window.history, d, unused, url);
  lastState = d;
  lastHref = window.location.href;
  mirror();
  if (to !== from) {
    rememberListUrl(lastHref);
    emitNavigate("replace", from);
  }
  repushLater(kept);
  notify();
  return ret;
}

// ---------------------------------------------------------------- popstate

function takeExpected(fromIndex: number, toIndex: number): Expected | null {
  pruneExpected();
  const x = expected[0];
  if (!x || fromIndex + x.delta !== toIndex) return null;
  expected.shift();
  return x;
}

function onPopState(e: PopStateEvent) {
  const fromIndex = cur;
  const fromHref = lastHref;
  const fromState = lastState;
  const toHref = window.location.href;
  const st = e.state as unknown;
  const sx = readSx(st);

  if (st == null) {
    // Fragment navigation (`#main` skip link): a fresh entry on top. Next
    // ignores null-state pops; stamp it so later traversals know its index.
    cur = fromIndex + 1;
    curSx = { i: cur };
    lastHref = toHref;
    window.history.replaceState({ sx: curSx }, "");
    mirror();
    notify();
    return;
  }

  const toIndex = sx ? sx.i : fromIndex - 1;
  cur = toIndex;
  curSx = sx ?? { i: toIndex };
  lastHref = toHref;
  lastState = st;
  mirror();

  const exp = takeExpected(fromIndex, toIndex);
  if (exp) {
    if (!exp.swallow && exp.seq !== navSeq) {
      // A navigation committed between our `go()` and its pop, so the pop
      // walked back from the NEW page. Hide it from Next and step forward again.
      e.stopImmediatePropagation();
      go(-exp.delta, { swallow: true });
      return;
    }
    // Our own pop: its layers already left the stack.
    layers = layers.filter((l) => l.index < 0 || l.index <= toIndex);
    if (exp.swallow || toHref === fromHref) {
      e.stopImmediatePropagation();
    } else if (pathOf(toHref) === pathOf(fromHref)) {
      carryUrl(e, fromHref, fromState);
    } else {
      // `backTo` crossed pages: Next renders the arrived entry.
      navSeq += 1;
      rememberListUrl(toHref);
      emitNavigate("traverse", fromHref);
    }
    exp.then?.();
    if (!expected.length) flushDeferred();
    notify();
    return;
  }

  const dir = toIndex < fromIndex ? -1 : 1;
  const popped = layers.filter((l) => l.index >= 0 && l.index > toIndex).reverse(); // top first
  layers = layers.filter((l) => l.index < 0 || l.index <= toIndex);
  const lowest = popped.length ? popped[popped.length - 1]! : null;
  const withinPage = lowest != null && toIndex >= lowest.index - 1;

  if (toHref === fromHref) {
    // Only our own same-URL entries were crossed: Next has nothing to do.
    e.stopImmediatePropagation();
  } else if (withinPage && pathOf(toHref) === pathOf(fromHref)) {
    carryUrl(e, fromHref, fromState);
  } else {
    navSeq += 1;
    rememberListUrl(toHref);
    emitNavigate("traverse", fromHref);
  }

  for (const l of popped) {
    if (!isLive(l)) continue;
    callPop(l, { reason: withinPage ? "back" : "navigate", landedOnBase: withinPage && toIndex === l.index - 1 });
  }

  // Orphan: a layer entry whose overlay no longer exists (refresh, a layer
  // released while not on top, navigation while open). Skip it in the
  // direction of travel.
  if (sx?.o && !layers.some((l) => l.token === sx.o && isLive(l))) {
    layers = layers.filter((l) => l.token !== sx.o);
    window.history.go(dir);
  }
  notify();
}

/**
 * The page changed its own URL (same pathname: search-param state such as an
 * `?id=` drawer) while a layer was on top. Popping the layer must not resurrect
 * the old URL: keep Next where it is and move the URL onto the arrived entry.
 */
function carryUrl(e: PopStateEvent, href: string, fromState: unknown) {
  e.stopImmediatePropagation();
  const carried = withSx(e.state, curSx);
  const tree = isPlainObject(fromState) ? fromState.__PRIVATE_NEXTJS_INTERNALS_TREE : undefined;
  if (isPlainObject(carried) && tree !== undefined) carried.__PRIVATE_NEXTJS_INTERNALS_TREE = tree;
  window.history.replaceState(carried, "", href);
}

function callPop(l: Layer, info: PopInfo) {
  try {
    l.onPop(info);
  } catch (err) {
    console.error("[nav] layer onPop:", err);
  }
}

/**
 * Closes the UI of layers that lost their entry to a navigation. Deferred by a
 * task: the owner usually closes it itself in the same click (`close();
 * router.push()`), and its `releaseLayer` then cancels this second close.
 */
function closeLater(gone: Layer[], kinds: LayerKind[] = ["overlay", "guard"]) {
  const list = gone.filter((l) => isLive(l) && kinds.includes(l.kind));
  if (!list.length) return;
  for (const l of list) pendingClose.set(l.token, l);
  setTimeout(() => {
    for (const l of list) {
      if (pendingClose.delete(l.token)) callPop(l, { reason: "navigate", landedOnBase: false });
    }
  }, 0);
}

/**
 * Every layer's entry is now behind a navigation. Overlays opened by the very
 * gesture that navigated (no input since: "open login, then router.push") are
 * meant for the new page and are returned to be re-pushed on top of it; the
 * rest are forgotten and their UI closed.
 */
function abandonAll(): Layer[] {
  if (!layers.length) return [];
  const sameGesture = (l: Layer) => l.kind === "overlay" && isLive(l) && l.openedInput === inputSeq;
  const kept = layers.filter(sameGesture);
  closeLater(layers.filter((l) => !sameGesture(l)));
  layers = kept;
  for (const l of kept) l.index = -1;
  return kept;
}

/** Re-push same-gesture overlays after the navigation's own entry (outside Next's insertion effect). */
function repushLater(kept: Layer[]) {
  if (!kept.length) return;
  queueMicrotask(() => {
    for (const l of kept) if (layers.includes(l) && l.index < 0 && !l.dead) doPush(l);
    notify();
  });
}

// ---------------------------------------------------------------- layers

function newToken() {
  return `${Date.now().toString(36)}.${(++tokenSeq).toString(36)}`;
}

function doPush(l: Layer): boolean {
  const index = cur + 1;
  try {
    window.history.pushState(withSx(window.history.state, { i: index, o: l.token }), "");
  } catch (err) {
    // Safari throttles pushState; without an entry the layer has no back step.
    console.warn("[nav] pushState:", err instanceof Error ? err.message : err);
    layers = layers.filter((x) => x !== l);
    return false;
  }
  l.index = index;
  return true;
}

function flushDeferred() {
  for (const l of layers) {
    if (l.index < 0 && !l.dead) doPush(l);
  }
  layers = layers.filter((l) => l.index >= 0 || !l.dead);
}

/**
 * Pushes a same-URL history entry for an overlay or a leave guard and returns
 * its token. `onPop` runs when a back press or a navigation removes the entry;
 * it is NOT called for `releaseLayer`.
 *
 * A layer released in this same tick hands its entry over instead of a
 * pop + push (StrictMode remount, one dialog replacing another). While one of
 * our pops is in flight the push waits for it, so it cannot be undone by it.
 */
export function pushLayer(kind: LayerKind, onPop: (info: PopInfo) => void): string {
  installNav();
  const token = newToken();
  if (!hasWindow()) return token;
  const top = layers[layers.length - 1];
  if (top && top.releasing && top.index >= 0) {
    Object.assign(top, { token, kind, onPop, releasing: false, dead: false, openedInput: inputSeq });
    if (cur === top.index) {
      window.history.replaceState(withSx(window.history.state, { i: top.index, o: token }), "");
    }
    notify();
    return token;
  }
  const layer: Layer = { token, kind, index: -1, onPop, dead: false, releasing: false, openedInput: inputSeq };
  layers.push(layer);
  pruneExpected();
  if (expected.length) {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(() => {
      flushTimer = null;
      pruneExpected();
      if (!expected.length) flushDeferred();
    }, EXPECT_TTL_MS + 50);
  } else {
    doPush(layer);
  }
  notify();
  return token;
}

/**
 * The owner closed the layer itself (button, Escape, unmount). On top: its
 * entry is popped with exactly one `history.go` (dead layers right under it
 * go in the same call). Not on top: it is marked dead and the next traversal
 * skips its entry. Unknown or already popped tokens are ignored, so a close
 * that follows a back press never pops twice.
 */
export function releaseLayer(token: string): void {
  if (pendingClose.delete(token)) return; // already off the stack; its owner closed it first
  const idx = layers.findIndex((l) => l.token === token);
  if (idx < 0) return;
  const l = layers[idx]!;
  if (l.index < 0) {
    layers.splice(idx, 1);
    notify();
    return;
  }
  if (idx !== layers.length - 1) {
    l.dead = true;
    notify();
    return;
  }
  l.releasing = true;
  notify();
  queueMicrotask(() => finishRelease(l));
}

function finishRelease(l: Layer) {
  if (!l.releasing) return; // handed over to a new layer
  const idx = layers.indexOf(l);
  if (idx < 0) return; // popped, consumed or abandoned meanwhile
  // Pop this entry and every contiguous dead entry right under it.
  let n = 1;
  let j = idx - 1;
  while (j >= 0 && layers[j]!.dead && layers[j]!.index === layers[j + 1]!.index - 1) {
    n += 1;
    j -= 1;
  }
  // Anything stacked above (deferred pushes) stays on the stack.
  layers = [...layers.slice(0, j + 1), ...layers.slice(idx + 1)];
  if (effectiveIndex() === l.index) go(-n);
  notify();
}

/** The layer is the topmost open one (only the top dialog handles Escape). */
export function isTopLayer(token: string): boolean {
  const live = layers.filter(isLive);
  return live.length > 0 && live[live.length - 1]!.token === token;
}

/** The layer still owns an entry (not popped, released or abandoned). */
export function hasLayer(token: string): boolean {
  return layers.some((l) => l.token === token && isLive(l));
}

/** Pushed layer entries stacked above the page's base entry. */
function layersAbove(index: number): number {
  return layers.filter((l) => l.index >= 0 && l.index <= index).length;
}

// ---------------------------------------------------------------- navigation API

/** Registers the app router (from `NavProvider`). `null` on unmount. */
export function setNavRouter(r: NavRouter | null): void {
  router = r;
}

/** Parent of `pathname`, with the remembered admin list URL (`/admin/users?q=…`). */
export function parentHref(pathname: string, search?: string): string | null {
  const list = adminListOf(pathname);
  if (list) {
    const remembered = storageGet(LIST_KEY + list);
    if (remembered && (remembered === list || remembered.startsWith(`${list}?`))) return remembered;
  }
  return parentOf(pathname, search);
}

function rememberListUrl(href: string) {
  try {
    const u = new URL(href);
    if (isAdminListPath(u.pathname)) storageSet(LIST_KEY + u.pathname, u.pathname + u.search);
  } catch {
    /* ignore */
  }
}

/** Router override for one call (a hook bound to its own context, tests). */
export type NavOpts = { router?: NavRouter | null };

function replaceTo(href: string, r: NavRouter | null = router) {
  if (r) r.replace(href);
  else window.location.replace(href);
}

/**
 * In-app back («←», Telegram BackButton, after-save continuation).
 *
 * 1. Leave guards with unsaved work save first; a failed save cancels.
 * 2. The page's base entry has an in-app predecessor (`i > 0`): one
 *    `history.go(-(layers + 1))`, which also leaves any open overlays.
 * 3. Otherwise (fresh tab, deep link, external referrer): REPLACE the page
 *    with `fallback ?? parentOf(path)`. Never `history.back()` there, so back
 *    never leaves the site and never ping-pongs.
 *
 * Resolves `true` when a navigation was started.
 */
export async function backTo(fallback?: string, opts?: NavOpts): Promise<boolean> {
  installNav();
  if (!(await runGuards())) return false;
  return backToUnguarded(fallback, opts?.router ?? router);
}

function backToUnguarded(fallback?: string, r: NavRouter | null = router): boolean {
  if (!hasWindow()) return false;
  const eff = effectiveIndex();
  const k = layersAbove(eff);
  const base = eff - k;
  const leaving = layers;
  if (base > 0) {
    layers = [];
    closeLater(leaving, ["overlay"]);
    go(-(k + 1));
    notify();
    return true;
  }
  const { pathname, search } = window.location;
  const target = fallback ?? parentHref(pathname, search);
  if (!target) return false;
  if (k > 0) {
    // Pop our own entries first so that the page's base entry is the one replaced.
    layers = [];
    closeLater(leaving, ["overlay"]);
    go(-k, { then: () => replaceTo(target, r) });
    notify();
    return true;
  }
  replaceTo(target, r);
  return true;
}

/**
 * Navigates away from an open overlay (search result, login `returnTo`, drawer
 * link). The overlay's entry is REPLACED by `href`, so back from the new page
 * returns to the page under the overlay, not to the overlay. With no layer on
 * the current entry it is a normal push. `external` (payment checkout): pops
 * the layer entries first, then `location.assign(href)`.
 *
 * Call your own `close()` as usual; open overlays are closed here too.
 */
export function navigateFromOverlay(href: string, opts?: NavOpts & { external?: boolean }): void {
  installNav();
  const r = opts?.router ?? router;
  if (!hasWindow()) return;
  const eff = effectiveIndex();
  const k = layersAbove(eff);
  const leaving = layers;
  if (k > 0) {
    layers = [];
    curSx = { i: cur };
    closeLater(leaving, ["overlay"]);
    notify();
  }
  if (opts?.external) {
    if (k > 0) go(-k, { swallow: true, then: () => window.location.assign(href) });
    else window.location.assign(href);
    return;
  }
  if (k > 0) replaceTo(href, r);
  else if (r) r.push(href);
  else window.location.assign(href);
}

/** Telegram BackButton / any system back: close the top overlay, else `backTo()`. */
export function systemBack(opts?: NavOpts): void {
  installNav();
  if (layers.some((l) => l.kind === "overlay" && isLive(l) && l.index >= 0)) {
    window.history.back();
    return;
  }
  void backTo(undefined, opts);
}

// ---------------------------------------------------------------- leave guards

/** Registers a leave guard; returns the unregister function. */
export function registerGuard(g: LeaveGuard): () => void {
  installNav();
  guards.add(g);
  notify();
  return () => {
    guards.delete(g);
    notify();
  };
}

/** Saves every guard with unsaved work. `false` (and that guard's `onError`) when one failed. */
export async function runGuards(): Promise<boolean> {
  for (const g of [...guards]) {
    if (!safePending(g)) continue;
    if (!(await runGuard(g))) return false;
  }
  return true;
}

/** Saves one guard; `false` (after `onError`) when the save failed. */
export async function runGuard(g: LeaveGuard): Promise<boolean> {
  try {
    const ok = await g.save();
    if (ok === false) {
      g.onError?.(new Error("save failed"));
      return false;
    }
    return true;
  } catch (err) {
    g.onError?.(err);
    return false;
  }
}

/**
 * Continues a phone back press after a guard let it through (its entry is
 * already popped): in-app back, else the parent page. On a root with no
 * in-app history (`/o/<token>` opened from a QR code) there is nothing in-app
 * to go to, and the user did press the system back: do the real one.
 */
export function continueBack(opts?: NavOpts): void {
  if (!backToUnguarded(undefined, opts?.router ?? router) && hasWindow()) window.history.back();
}

/** The target of a plain left click on a same-origin `<a>` that leaves this page, else `null`. */
export function internalLinkHref(e: MouseEvent): string | null {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return null;
  const t = e.target as Element | null;
  const a = (typeof t?.closest === "function" ? t.closest("a[href]") : null) as HTMLAnchorElement | null;
  if (!a || a.hasAttribute("download")) return null;
  const target = a.getAttribute("target");
  if (target && target !== "_self") return null;
  let url: URL;
  try {
    url = new URL(a.href, window.location.href);
  } catch {
    return null;
  }
  if (url.origin !== window.location.origin) return null;
  if (url.pathname.startsWith("/api/")) return null; // downloads and API links are not pages
  const here = new URL(window.location.href);
  if (url.pathname === here.pathname && url.search === here.search) return null; // hash-only / same page
  return url.pathname + url.search + url.hash;
}

/** Internal `<a>` clicks while a guard has unsaved work: save first, then go. */
function onClickCapture(e: MouseEvent) {
  if (![...guards].some(safePending)) return;
  const href = internalLinkHref(e);
  if (!href) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  void runGuards().then((ok) => {
    if (ok) navigateFromOverlay(href);
  });
}

// ---------------------------------------------------------------- subscriptions

export function subscribeNav(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getNavSnapshot(): NavSnapshot {
  return snapshot;
}

const SERVER_SNAPSHOT: NavSnapshot = { index: 0, overlays: 0, guardPending: false, href: "" };
export function getServerNavSnapshot(): NavSnapshot {
  return SERVER_SNAPSHOT;
}

/** Recompute the snapshot (a guard's `pending` changed). */
export function refreshNav(): void {
  notify();
}

/** Committed URL changes: push, replace with a new URL, traversal to another URL. */
export function onNavigate(listener: (e: NavigateEvent) => void): () => void {
  navListeners.add(listener);
  return () => {
    navListeners.delete(listener);
  };
}

/** Increments on every pointerdown/keydown (see `NavigateEvent.input`). */
export function inputSequence(): number {
  return inputSeq;
}

/** Increments on every navigation to another entry/page; read synchronously. */
export function navSequence(): number {
  return navSeq;
}

export function currentIndex(): number {
  return cur;
}

// ---------------------------------------------------------------- tests

/** Test-only: uninstall and reset all module state. */
export function __resetNavForTests(): void {
  if (installed && hasWindow()) {
    const h = window.history;
    if (h.pushState === ourPush && prevPush) h.pushState = prevPush;
    if (h.replaceState === ourReplace && prevReplace) h.replaceState = prevReplace;
    window.removeEventListener("popstate", onPopState, true);
    window.removeEventListener("click", onClickCapture, true);
    window.removeEventListener("pointerdown", onInput, true);
    window.removeEventListener("keydown", onInput, true);
  }
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  installed = false;
  cur = 0;
  curSx = { i: 0 };
  lastHref = "";
  lastState = null;
  navSeq = 0;
  inputSeq = 0;
  router = null;
  layers = [];
  expected = [];
  pendingClose.clear();
  guards.clear();
  listeners.clear();
  navListeners.clear();
  snapshot = { index: 0, overlays: 0, guardPending: false, href: "" };
  notifyQueued = false;
  prevPush = prevReplace = ourPush = ourReplace = null;
}

/** Test-only view of the layer stack. */
export function __layersForTests(): ReadonlyArray<{ token: string; kind: LayerKind; index: number; dead: boolean }> {
  return layers.map(({ token, kind, index, dead }) => ({ token, kind, index, dead }));
}
