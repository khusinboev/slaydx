import type { Metadata } from "next";
import { BroadcastsPage } from "@/components/admin/broadcasts/BroadcastsPage";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "E'lonlar" };

/** S13: Telegram announcements (permission `broadcasts.view`, enforced by the API). */
export default function AdminBroadcastsRoute() {
  return <BroadcastsPage />;
}
