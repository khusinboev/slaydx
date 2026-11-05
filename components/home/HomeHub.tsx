"use client";

import Link from "next/link";
import { ArrowRight, Bell, Search } from "lucide-react";
import { useAppStore } from "@/lib/store";
import { useUi } from "@/lib/ui";
import { PageHeader, HeaderIconButton } from "@/components/shell/PageHeader";
import { ThemeToggle } from "@/components/shell/ThemeToggle";
import { BalanceChip } from "@/components/shell/BalanceChip";
import { useReturnToLogin } from "@/components/shell/useReturnToLogin";
import { useMarketOn } from "@/components/market/MarketClosed";
import { greetingTitle, homeCells, homeSlides } from "./hub/hub-model";
import { HubBanner } from "./hub/HubBanner";
import { HubGrid } from "./hub/HubGrid";
import { HubSection, HUB_ENTER, HUB_STAGGER_MS, SECTION_LINK_CLASS } from "./hub/HubSection";
import { MarketRail } from "./hub/MarketRail";
import { RecentFiles } from "./hub/RecentFiles";
import { SignedOutCard } from "./hub/SignedOutCard";
import { useLoginGate } from "./hub/useLoginGate";
import { useRecentFiles } from "./hub/useRecentFiles";

/** Hub content width (centred 1040 px on a desktop); the header row matches it. */
const WIDTH = "max-w-[1040px]";

/**
 * Bosh (`/uz`) — the home hub, variant C «Xizmatlar panjarasi» (owner decision
 * 2026-11-06, docs/redesign/PLAN.md), top to bottom:
 *
 *   - header: «Salom, <first name>» (never a phone number — «Salom!» when the
 *     account has no real name), balance chip (→ Hamyon), search (the shell
 *     binds Cmd/Ctrl+K), quick theme, notifications;
 *   - the promo banner (`HubBanner`): market, Studio, AI yordamchi, domla, by their switches;
 *   - the service grid (`HubGrid`): eight cells, Slayd emphasised, «Barchasi» → `/uz/create`;
 *   - «Davom ettirish»: the 3 latest files + «Barchasi →» Ishlarim; signed out,
 *     a login card instead; signed in without a file, nothing;
 *   - «Ishlar bozori»: a rail of popular ready works (`MarketRail`, behind `features.market`).
 *
 * Banner and grid links keep the «+» sheet's login gate. Until the session is
 * known what depends on a switch is a skeleton of the same size. `?returnTo=`
 * opens the login (`useReturnToLogin`).
 */
export function HomeHub() {
  useReturnToLogin();
  const user = useAppStore((s) => s.user);
  const sessionChecked = useAppStore((s) => s.sessionChecked);
  const loggedIn = useAppStore((s) => s.loggedIn);
  const features = useAppStore((s) => s.features);
  const open = useUi((s) => s.open);
  const gate = useLoginGate();
  const marketOn = useMarketOn();
  const recent = useRecentFiles();
  const signedOut = sessionChecked && !loggedIn;
  const pending = !sessionChecked && !features;
  const noFiles = recent.phase === "ready" && recent.files.length === 0;

  return (
    <div className="flex w-full flex-col" data-home-hub>
      <PageHeader
        title={<span className="text-[20px] sm:text-[24px]">{greetingTitle(user)}</span>}
        contentClassName={WIDTH}
        actions={
          <>
            <BalanceChip />
            <div className="flex items-center">
              <HeaderIconButton label="Qidirish" title="Qidirish (Ctrl+K)" aria-keyshortcuts="Control+K Meta+K" onClick={() => open("search")}>
                <Search className="size-[1.2rem]" aria-hidden />
              </HeaderIconButton>
              <ThemeToggle />
              <HeaderIconButton label="Bildirishnomalar" title="Bildirishnomalar (Alt+T)" onClick={() => open("notifications")}>
                <Bell className="size-[1.2rem]" aria-hidden />
              </HeaderIconButton>
            </div>
          </>
        }
      />
      <div className={`mx-auto flex w-full ${WIDTH} flex-col gap-5 px-4 pt-1 pb-6 text-[15.5px]`}>
        <HubBanner slides={homeSlides(features, marketOn)} pending={pending} onPick={gate} index={0} />
        <HubGrid cells={homeCells(features)} pending={pending} onPick={gate} index={1} />
        {signedOut ? (
          <div className={HUB_ENTER} style={{ animationDelay: `${2 * HUB_STAGGER_MS}ms` }}>
            <SignedOutCard onLogin={() => open("login")} />
          </div>
        ) : noFiles ? null : (
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
            <RecentFiles state={recent} />
          </HubSection>
        )}
        <MarketRail index={3} />
      </div>
    </div>
  );
}
