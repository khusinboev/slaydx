import { ProfileHome } from "@/components/profile/ProfileHome";
import { PageHeader } from "@/components/shell/PageHeader";
import { ThemeToggle } from "@/components/shell/ThemeToggle";

/** Profil tab: the W4 index (rows link to `/uz/profile/<step>`; admin row inside) under the tab header. */
export default function Page() {
  return (
    <div className="flex w-full flex-col">
      <PageHeader title="Profil" actions={<ThemeToggle />} contentClassName="max-w-xl" />
      <ProfileHome header={null} />
    </div>
  );
}
