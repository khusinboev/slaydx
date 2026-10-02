import type { Metadata } from "next";
import { GenerationsPage } from "@/components/admin/generations/GenerationsPage";
import { adminToolOptions } from "@/lib/server/admin-generations";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Generatsiyalar" };

/** S6: jobs list (permission `jobs.view`, enforced by the API). Tool options come from the server registry. */
export default function AdminGenerationsRoute() {
  return <GenerationsPage tools={adminToolOptions()} />;
}
