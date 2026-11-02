import type { Metadata } from "next";
import { StudioLibraryPage } from "@/components/admin/studio/StudioLibraryPage";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Studio kutubxonasi" };

/** Studio prompt library + templates (docs/studio/P2B-SPEC.md; `settings.view`, writes `settings.edit`, enforced by the API). */
export default function AdminStudioLibraryRoute() {
  return <StudioLibraryPage />;
}
