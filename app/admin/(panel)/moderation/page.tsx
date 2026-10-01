import type { Metadata } from "next";
import { ModerationPage } from "@/components/admin/moderation/ModerationPage";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Moderatsiya" };

/** S12: public game links and results (permission `moderation.view`, enforced by the API). */
export default function AdminModerationRoute() {
  return <ModerationPage />;
}
