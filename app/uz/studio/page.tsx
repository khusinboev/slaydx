import { Suspense } from "react";
import type { Metadata } from "next";
import { StudioPage } from "@/components/studio/StudioPage";

// The brand name is added by the `template` in `app/layout.tsx`.
export const metadata: Metadata = {
  title: "Studio",
  description: "Eng kuchli modellar bilan rasm yarating: narx yaratishdan oldin ko‘rinadi",
};

export default function Page() {
  // `useSearchParams` (the tab and the mode in the URL) needs a Suspense boundary.
  return (
    <Suspense>
      <StudioPage />
    </Suspense>
  );
}
