import type { Metadata } from "next";
import { RatingsPage } from "@/components/admin/ratings/RatingsPage";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Baholar" };

/** App ratings, read-only (permission `bonus.view`, enforced by the API). */
export default function AdminRatingsRoute() {
  return <RatingsPage />;
}
