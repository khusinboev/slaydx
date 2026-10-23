import type { Metadata } from "next";
import { ProvidersPage } from "@/components/admin/providers/ProvidersPage";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Provayderlar" };

/** `/admin/providers`: AI provider keys and switches (program-17 D7; permission `settings.view`, enforced by the API). */
export default function AdminProvidersRoute() {
  return <ProvidersPage />;
}
