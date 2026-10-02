"use client";

import { Badge, type FilterOption } from "@/components/admin/ui";
import { GAME_KINDS, type GameLinkKind } from "@/lib/admin-api/moderation";

/** Uzbek names of the public game kinds (S12). */
export const KIND_LABEL: Record<GameLinkKind, string> = {
  quiz: "Test",
  crossword: "Krossvord",
  flashcards: "Flesh kartalar",
  sorting: "Saralash",
  listening: "Tinglash",
};

export const KIND_OPTIONS: ReadonlyArray<FilterOption> = GAME_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }));

export const kindLabel = (kind: string): string => (KIND_LABEL as Record<string, string>)[kind] ?? kind;

/** Active filter values as the `Segmented` control and the URL carry them. */
export const ACTIVE_OPTIONS: ReadonlyArray<FilterOption> = [
  { value: "", label: "Barchasi" },
  { value: "1", label: "Faol" },
  { value: "0", label: "Faol emas" },
];

export function LinkStatusPill({ active }: { active: boolean }) {
  return active ? (
    <Badge tone="success" dot>
      Faol
    </Badge>
  ) : (
    <Badge tone="neutral" dot>
      Faol emas
    </Badge>
  );
}

/** First 8 characters of an id: enough to tell rows apart. */
export const shortId = (id: string): string => id.slice(0, 8);
