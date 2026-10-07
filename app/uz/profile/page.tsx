import { ProfilePage } from "@/components/profile/ProfilePage";
import { PageHeader } from "@/components/shell/PageHeader";
import { ThemeToggle } from "@/components/shell/ThemeToggle";
import { AdminLink } from "@/components/shell/AdminLink";

/**
 * Profil tab. Interim (F0): today's `ProfilePage` under the tab's header, plus
 * the admin entry that left the removed Sidebar. Package W4 replaces it with the
 * profile index and `/uz/profile/<step>` pages.
 */
export default function Page() {
  return (
    <div className="flex w-full flex-col">
      <PageHeader title="Profil" actions={<ThemeToggle />} contentClassName="max-w-4xl" />
      <div className="mx-auto w-full max-w-4xl px-4 empty:hidden">
        <AdminLink className="mt-1" />
      </div>
      <ProfilePage />
    </div>
  );
}
