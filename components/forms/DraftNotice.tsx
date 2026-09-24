"use client";

import { useDraftNotice } from "./useFormDraft";

/**
 * Qoralama eslatmasi (FE-17) — kichik, xira qator; xato emas.
 *
 * Ilgari qoralama saqlanmay qolganini (413 — fayl matni bilan 200 KB dan
 * oshgan, tarmoq xatosi) foydalanuvchi hech qachon bilmasdi va sahifani
 * yopib butun formani yo'qotardi. `ToolChrome` har formada chizadi.
 */
export function DraftNotice() {
  const failed = useDraftNotice((s) => s.failed);
  const detachedFile = useDraftNotice((s) => s.detachedFile);
  if (!failed && !detachedFile) return null;
  return (
    <p role="status" data-draft-notice className="text-muted-foreground mb-4 text-[12.5px]">
      {detachedFile ? (
        <>
          Qoralama tiklandi. «{detachedFile}» fayli matni qoralamada saqlanmaydi — faylni qayta biriktiring.
          {failed ? " " : null}
        </>
      ) : null}
      {failed ? "Qoralama saqlanmadi — sahifani yopsangiz, oxirgi o‘zgarishlar yo‘qolishi mumkin." : null}
    </p>
  );
}
