/** Shared class names of the wallet dialog's steps (same look as the existing inputs / buttons). */

export const sectionLabel = "text-muted-foreground mb-2.5 text-[13px] font-semibold tracking-[0.06em] uppercase";
export const fieldLabel = "text-muted-foreground mb-1.5 block text-[14.5px] font-medium";
/** 16 px text: iOS does not zoom the page on focus. */
export const inputCls =
  "border-input bg-background focus:ring-ring h-12 w-full rounded-[14px] border px-3.5 text-base tabular-nums outline-none focus:ring-2 disabled:opacity-60 aria-[invalid=true]:border-destructive";
export const primaryBtn =
  "bg-primary text-primary-foreground focus-visible:ring-ring flex h-12 w-full items-center justify-center rounded-[16px] text-[15.5px] font-semibold outline-none transition-[filter,transform] hover:brightness-95 focus-visible:ring-2 active:scale-[0.98] disabled:opacity-40 motion-reduce:transform-none";
export const textBtn =
  "text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex min-h-10 items-center rounded-[12px] px-2 text-[14px] font-medium underline-offset-2 outline-none hover:underline focus-visible:ring-2";
export const fieldError = "text-destructive mt-1.5 text-[13.5px] leading-snug";
