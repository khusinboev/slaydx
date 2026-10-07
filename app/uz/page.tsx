import { Suspense } from "react";
import { HomeHub } from "@/components/home/HomeHub";

/** Bosh — the hub tab (docs/redesign/PLAN.md). The file list moved to `/uz/files` (Ishlarim). */
export default function UzHomePage() {
  // `useSearchParams` (`?returnTo=` login hand-off) needs a Suspense boundary.
  return (
    <Suspense fallback={<div className="text-muted-foreground p-8 text-[15px]">Yuklanmoqda...</div>}>
      <HomeHub />
    </Suspense>
  );
}
