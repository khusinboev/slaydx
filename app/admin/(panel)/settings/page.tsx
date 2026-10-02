import type { Metadata } from "next";
import { SettingsPage } from "@/components/admin/settings/SettingsPage";
import { adminToolOptions } from "@/lib/server/admin-generations";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Sozlamalar" };

/** S14: runtime flags (permission `settings.view`, enforced by the API). Tool options come from the server registry. */
export default function AdminSettingsRoute() {
  return <SettingsPage tools={adminToolOptions()} />;
}
