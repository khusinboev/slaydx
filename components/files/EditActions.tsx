"use client";

import { Check, RotateCcw, Save } from "lucide-react";
import { cn } from "@/lib/cn";
import { useConfirmClick } from "../overlays/useConfirmClick";

/**
 * Ko'ruvchi tahririning SAHIFA SARLAVHASIDAGI holati.
 *
 * Tahrir holati `SlideViewer` ichida (`useSlideEdit`) yashaydi, lekin
 * «Saqlash» va «Asliga qaytarish» sahifa sarlavhasida, «Yuklab olish»
 * yonida turadi: foydalanuvchi faylni olishdan oldin saqlanmagan
 * o'zgarish borligini AYNAN o'sha yerda ko'radi («ko'rdim = oldim»).
 * `SlideViewer` `onEditState` bilan shu obyektni yuqoriga beradi.
 */
export type EditActionsState = {
  /** Saqlanmagan operatsiyalar soni. */
  pending: number;
  saving: boolean;
  /** Endigina saqlandi — qisqa «Saqlandi ✓». */
  justSaved: boolean;
  save: () => Promise<void> | void;
  /** Saqlanmagan o'zgarishlarni bekor qilish (faqat klientda). */
  discard: () => void;
};

export function EditActions({ state }: { state: EditActionsState | null }) {
  /*
   * «Asliga qaytarish» IKKI bosishda: bitta tasodifiy bosish yigirma
   * daqiqalik tahrirni yo'qotardi (Ctrl+Z ham qaytarmaydi — steklar
   * tozalanadi).
   */
  const discard = useConfirmClick(() => state?.discard());
  if (!state) return null;
  const { pending, saving, justSaved, save } = state;
  if (pending === 0 && !saving) {
    return justSaved ? (
      <span className="inline-flex items-center gap-1 text-xs text-emerald-600" data-edit-saved>
        <Check className="size-3.5" />
        Saqlandi
      </span>
    ) : null;
  }
  return (
    <div className="flex items-center gap-2" data-edit-actions>
      <button
        type="button"
        title="Saqlanmagan o‘zgarishlarni bekor qilish"
        disabled={saving}
        className={cn(
          "inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm disabled:opacity-60",
          discard.armed ? "border-amber-500 bg-amber-500 text-white" : "bg-card",
        )}
        onClick={discard.trigger}
      >
        <RotateCcw className="size-4" />
        <span className={discard.armed ? "inline" : "hidden sm:inline"}>{discard.armed ? "Rostdan?" : "Asliga qaytarish"}</span>
      </button>
      <button
        type="button"
        title="Saqlash (Ctrl+S)"
        disabled={saving || pending === 0}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-sky-500 px-3 text-sm font-medium text-white hover:bg-sky-400 disabled:opacity-60"
        onClick={() => void save()}
      >
        <Save className="size-4" />
        {saving ? "Saqlanmoqda…" : `Saqlash · ${pending}`}
      </button>
    </div>
  );
}
