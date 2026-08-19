import { Suspense } from "react";
import type { Metadata } from "next";
import { PurchasePage } from "@/components/purchase/PurchasePage";

export const metadata: Metadata = {
  title: "Tariflar",
  description: "Bepul va Pro rejalar — kvota, narx va to'lov usullari",
};

export default function Page() {
  // `useSearchParams` (to'lovdan qaytish `?order=`) Suspense talab qiladi.
  return (
    <Suspense fallback={<div className="text-muted-foreground p-8 text-sm">Yuklanmoqda...</div>}>
      <PurchasePage />
    </Suspense>
  );
}
