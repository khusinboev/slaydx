import type { Metadata } from "next";
import { SystemPage } from "@/components/admin/system/SystemPage";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Tizim holati" };

/** S15: system health (permission `system.view`, enforced by the API). */
export default function AdminSystemRoute() {
  return <SystemPage />;
}
