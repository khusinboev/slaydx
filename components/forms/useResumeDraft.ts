"use client";

import { useFormDraft } from "./useFormDraft";

/**
 * Rezyume formasi qoralamasi (Rezyume 2, 1-band).
 *
 * Maqola 2 / AUDIT-17 WP4 dan boshlab bu YUPQA O'RAM — haqiqiy mantiq
 * umumiy `useFormDraft("resume")` da (`form_drafts` jadvali, server
 * tomoni `lib/server/form-draft.ts`). Imzo va qaytadigan shakl ATAYLAB
 * o'zgarmagan — `ResumeComposer.tsx` o'zgarishsiz qoladi.
 */
export function useResumeDraft(loggedIn: boolean) {
  return useFormDraft("resume", { enabled: loggedIn });
}
