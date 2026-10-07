"use client";

import Link from "next/link";
import { ArrowRight, Bell, Search } from "lucide-react";
import { useAppStore } from "@/lib/store";
import { useUi } from "@/lib/ui";
import { PageHeader, HeaderIconButton } from "@/components/shell/PageHeader";
import { ThemeToggle } from "@/components/shell/ThemeToggle";
import { BalanceChip } from "@/components/shell/BalanceChip";
import { useReturnToLogin } from "@/components/shell/useReturnToLogin";
import { greetingTitle } from "./hub/hub-model";
import { HubSection, HUB_STAGGER_MS, SECTION_LINK_CLASS } from "./hub/HubSection";
import { HubSearch } from "./hub/HubSearch";
import { QuickStart } from "./hub/QuickStart";
import { RecentFiles } from "./hub/RecentFiles";
import { SignedOutCard } from "./hub/SignedOutCard";
import { ToolsByGroup } from "./hub/ToolsByGroup";
import { useLoginGate } from "./hub/useLoginGate";
import { useRecentFiles } from "./hub/useRecentFiles";

/** Hub content width (PLAN W1: centred ~1040 px on a desktop); the header row matches it. */
const WIDTH = "max-w-[1040px]";

/**
 * Bosh (`/uz`) — the home hub, variant A «Iliq» (docs/redesign/PLAN.md W1):
 *
 *   - header: «Salom, <first name>» (never a phone number — «Salom!» when the
 *     account has no real name), «Bugun nima yaratamiz?», search / quick theme
 *     / notifications; the balance chip (→ Hamyon) beside the search field;
 *   - «Vosita yoki fayl qidirish» → the search dialog (Cmd/Ctrl+K hint);
 *   - «Tez boshlash»: Slayd, Referat, Insho, Rezyume;
 *   - «Davom ettirish»: the 3 latest files + «Barchasi →» Ishlarim; signed out,
 *     a login card instead;
 *   - «Barcha vositalar» by group + «Hammasi» → `/uz/create`.
 * Tool links keep the «+» sheet's login gate. ≥ 1024 px: quick start and
 * recent files side by side. `?returnTo=` opens the login (`useReturnToLogin`).
 */
export function HomeHub() {
  useReturnToLogin();
  const user = useAppStore((s) => s.user);
  const sessionChecked = useAppStore((s) => s.sessionChecked);
  const loggedIn = useAppStore((s) => s.loggedIn);
  const open = useUi((s) => s.open);
  const gate = useLoginGate();
  const recent = useRecentFiles();
  const signedOut = sessionChecked && !loggedIn;

  return (
    <div className="flex w-full flex-col" data-home-hub>
      <PageHeader
        title={greetingTitle(user)}
        subtitle="Bugun nima yaratamiz?"
        contentClassName={WIDTH}
        actions={
          <>
            <HeaderIconButton label="Qidirish" onClick={() => open("search")}>
              <Search className="size-[1.2rem]" aria-hidden />
            </HeaderIconButton>
            <ThemeToggle />
            <HeaderIconButton label="Bildirishnomalar" title="Bildirishnomalar (Alt+T)" onClick={() => open("notifications")}>
              <Bell className="size-[1.2rem]" aria-hidden />
            </HeaderIconButton>
          </>
        }
      />
      <div className={`mx-auto flex w-full ${WIDTH} flex-col gap-5 px-4 pt-1 pb-6 text-[15.5px]`}>
        <div
          className="flex items-center gap-2 motion-safe:animate-[slx-enter-fade_240ms_ease-out_backwards]"
          data-hub-top
        >
          <div className="min-w-0 flex-1">
            <HubSearch onOpen={() => open("search")} />
          </div>
          <BalanceChip />
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 lg:gap-6">
          {signedOut ? (
            <div
              className="motion-safe:animate-[slx-enter-fade_240ms_ease-out_backwards] lg:order-2 lg:pt-[3.375rem]"
              style={{ animationDelay: `${HUB_STAGGER_MS}ms` }}
            >
              <SignedOutCard onLogin={() => open("login")} />
            </div>
          ) : null}
          <HubSection id="quick" title="Tez boshlash" index={1}>
            <QuickStart onPick={gate} />
          </HubSection>
          {signedOut ? null : (
            <HubSection
              id="recent"
              title="Davom ettirish"
              index={2}
              action={
                <Link href="/uz/files" data-hub-all-files className={SECTION_LINK_CLASS}>
                  Barchasi
                  <ArrowRight className="size-4" aria-hidden />
                </Link>
              }
            >
              <RecentFiles state={recent} onCreate={() => open("create")} />
            </HubSection>
          )}
        </div>

        <HubSection
          id="tools"
          title="Barcha vositalar"
          index={3}
          action={
            <Link href="/uz/create" data-hub-catalogue onClick={() => gate("/uz/create")} className={SECTION_LINK_CLASS}>
              Hammasi
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          }
        >
          <ToolsByGroup onPick={gate} />
        </HubSection>
      </div>
    </div>
  );
}
