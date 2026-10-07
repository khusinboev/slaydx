/**
 * Pure part of the «+» sheet (`CreateSheet.tsx`): which tools come first.
 */

/** Shown first when the user has made nothing yet (or fewer than `n` kinds). */
export const DEFAULT_TOP_TOOLS = ["slide", "referat", "essay", "test"] as const;

/**
 * The user's most-used tools: generation `type`s counted, the more frequent
 * first, ties by the most recent use (`generations` is newest first, as the
 * API returns it). Unknown types are skipped; the list is topped up from
 * `DEFAULT_TOP_TOOLS`, never with duplicates, up to `n`.
 */
export function mostUsedToolIds(
  generations: ReadonlyArray<{ type: string }>,
  known: ReadonlySet<string>,
  n = 4,
): string[] {
  const count = new Map<string, number>();
  const firstSeen = new Map<string, number>();
  generations.forEach((g, i) => {
    if (!known.has(g.type)) return;
    count.set(g.type, (count.get(g.type) ?? 0) + 1);
    if (!firstSeen.has(g.type)) firstSeen.set(g.type, i);
  });
  const used = [...count.keys()].sort(
    (a, b) => count.get(b)! - count.get(a)! || firstSeen.get(a)! - firstSeen.get(b)!,
  );
  const out = used.slice(0, n);
  for (const id of DEFAULT_TOP_TOOLS) {
    if (out.length >= n) break;
    if (known.has(id) && !out.includes(id)) out.push(id);
  }
  return out;
}
