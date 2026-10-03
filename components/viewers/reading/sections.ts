import type { FlowItem } from "@/lib/viewers/flow";

/** A run of flow items that starts on one file page («O‘qish» keeps the page counter meaningful). */
export type ReadingSection = { page: number; items: FlowItem[] };

/** `packPages` may split a long paragraph into `id~0`, `id~1`… parts; reading mode shows the whole item. */
export function baseFlowId(id: string): string {
  const i = id.indexOf("~");
  return i < 0 ? id : id.slice(0, i);
}

/**
 * Groups the UNSPLIT flow items (`docToFlow`) by the file page they start on.
 *
 * Reading mode renders the same flow as the sheets, so every block can be
 * mapped back to its page in `pages` (`packPages` output). The page counter
 * then reads «3 / 12» in both modes for the same text.
 *
 * - A table stays one block: its rows follow the head's section even when
 *   `packPages` continued the table on the next sheet.
 * - Pages only grow; an item missing from `pages` (not packed yet) stays in
 *   the current section.
 * - Without `pages` (still measuring) everything is one section on page 1.
 */
export function readingSections(items: FlowItem[], pages: FlowItem[][] | null): ReadingSection[] {
  const pageOf = new Map<string, number>();
  pages?.forEach((pg, i) => {
    for (const it of pg) {
      const b = baseFlowId(it.id);
      if (!pageOf.has(b)) pageOf.set(b, i + 1);
    }
  });
  const out: ReadingSection[] = [];
  let inTable = false;
  for (const it of items) {
    const cur = out[out.length - 1];
    const tableRow: boolean = it.type === "table-row" && inTable;
    inTable = it.type === "table-head" || tableRow;
    const at = pageOf.get(baseFlowId(it.id));
    const page = tableRow && cur ? cur.page : Math.max(cur?.page ?? 1, at ?? cur?.page ?? 1);
    if (cur && cur.page === page) cur.items.push(it);
    else out.push({ page, items: [it] });
  }
  return out;
}
