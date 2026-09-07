/** `/uz/files/[id]/loading.tsx` dagi izohga qarang — sabab bir xil: bu
 * marshrut `force-dynamic`, har navigatsiyada server bilan aloqa qiladi. */
export default function Loading() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 text-center">
      <div className="border-muted-foreground/30 border-t-primary mx-auto size-6 animate-spin rounded-full border-2" />
      <p className="text-muted-foreground mt-4 text-sm">Yuklanmoqda…</p>
    </div>
  );
}
