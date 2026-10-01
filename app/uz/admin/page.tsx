import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * The admin panel moved to `/admin` (docs/admin/02-plan.md §2). Old links and
 * bookmarks keep working; the gate (404 for non-admins) lives in `app/admin/layout.tsx`.
 */
export default function Page() {
  redirect("/admin");
}
