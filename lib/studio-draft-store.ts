/**
 * The storage side of the Studio's form drafts (docs/studio/P11-SPEC.md «C. Reliability»), framework-free so the session
 * store can drop them on logout. Storage is a convenience: every read and write is guarded, and a private window, blocked
 * site data or a full quota simply means no draft. The key names the user, so a shared browser never shows one account's
 * text to another.
 */
const PREFIX = "slaydx.studio.draft.v1";
const userPrefix = (userId: string): string => `${PREFIX}.${userId}.`;

export const draftKey = (userId: string, tab: string): string => `${userPrefix(userId)}${tab}`;

/** The stored value, or `null`: nothing stored, storage unavailable, or a value that is not JSON. */
export function readDraft(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

export function writeDraft(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // No storage, or the quota is full: the form goes on without a draft.
  }
}

export function removeDraft(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // No storage: there is nothing to remove.
  }
}

const pendingWriters = new Set<(prefix: string) => void>();

/** A form with a write on the way hears about a logout here: that write must not bring the draft back. */
export function onDraftsDropped(cancel: (prefix: string) => void): () => void {
  pendingWriters.add(cancel);
  return () => {
    pendingWriters.delete(cancel);
  };
}

/** Logout: everything this user typed leaves the browser, including what is still waiting to be written. */
export function dropUserDrafts(userId: string): void {
  const prefix = userPrefix(userId);
  for (const cancel of pendingWriters) cancel(prefix);
  try {
    const store = window.localStorage;
    const keys = Array.from({ length: store.length }, (_, i) => store.key(i)).filter((k): k is string => k?.startsWith(prefix) === true);
    for (const k of keys) store.removeItem(k);
  } catch {
    // No storage: there is nothing to remove.
  }
}
