"use client";

import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Info, TriangleAlert } from "lucide-react";
import { useCan } from "@/components/admin/shell";
import { Button, Card, ErrorState, Forbidden, KpiTile, Skeleton, TabPanel, Tabs, type TabItem } from "@/components/admin/ui";
import { AdminReauthCancelledError, adminErrorMessage, isAbortError } from "@/lib/admin-api/core";
import { fmtNumber, fmtUsd } from "@/lib/admin-format";
import { testProvider, type ProviderItem, type ProvidersResponse } from "@/lib/admin-api/providers";
import { ProviderDeleteKeyDialog, ProviderKeyDialog, ProviderToggleDialog } from "./ProviderDialogs";
import { CategoryTab, OverviewTab } from "./CategoryViews";
import { buildCategories, kpis, parseTab, type TabId } from "./categories";
import { moneyText, type Period } from "./format";
import type { TestState } from "./ProviderTable";
import { useProviders } from "./useProviders";

const ID_PREFIX = "providers";
const DOT = { ok: "bg-success", single: "bg-warning", missing: "bg-destructive", off: "bg-muted-foreground" } as const;
const DOT_TEXT = { ok: "yetarli", single: "zaxirasiz", missing: "yetarli emas", off: "o'chirilgan" } as const;

function Loading() {
  return (
    <div aria-busy="true" aria-label="Yuklanmoqda" className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 min-[1100px]:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[88px] w-full rounded-xl" />
        ))}
      </div>
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-32 w-full rounded-xl" />
      ))}
    </div>
  );
}

/**
 * `/admin/providers` «AI provayderlar» (program-17 D7; new layout 2026-10-31; `settings.view`, edits `settings.edit` with
 * step-up). Four KPI tiles, then category tabs (the selected one lives in `?tab=`): «Umumiy» lists every category with its
 * verdict, a category tab holds the verdict banner, the providers table, the routing order and the spend. Every provider
 * action is in the table: switch, key in / replace / delete, live test. A key is typed into a password field and never shown
 * again; roles without edit rights see no controls. Permissions are enforced by the API; hiding the controls is cosmetic.
 */
export function ProvidersPage() {
  const canEdit = useCan("settings.edit");
  const { state, refreshing, reload } = useProviders();
  const searchParams = useSearchParams();
  const [tab, setTabState] = useState<TabId>(() => parseTab(searchParams?.get("tab")));
  const [keyFor, setKeyFor] = useState<ProviderItem | null>(null);
  const [deleteFor, setDeleteFor] = useState<ProviderItem | null>(null);
  const [toggleFor, setToggleFor] = useState<ProviderItem | null>(null);
  const [tests, setTests] = useState<Record<string, TestState>>({});
  const [period, setPeriod] = useState<Period>("d30");

  // Native history update (as the other admin pages do): the tab survives a reload and can be shared.
  const setTab = useCallback((id: string) => {
    const next = parseTab(id);
    setTabState(next);
    try {
      const q = new URLSearchParams(window.location.search);
      if (next === "overview") q.delete("tab");
      else q.set("tab", next);
      const qs = q.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
    } catch {
      /* no history (tests, embedded): the state alone still switches the tab */
    }
  }, []);

  const data: ProvidersResponse | null = state.status === "ready" ? state.data : null;
  const propagationSec = data?.propagationSec ?? 30;
  const categories = useMemo(() => (data ? buildCategories(data) : []), [data]);
  const k = useMemo(() => (data ? kpis(data, categories) : null), [data, categories]);

  async function runTest(item: ProviderItem) {
    setTests((t) => ({ ...t, [item.id]: { status: "running" } }));
    try {
      const r = await testProvider(item.id);
      setTests((t) => ({ ...t, [item.id]: { status: "done", ...r } }));
    } catch (e) {
      if (isAbortError(e) || e instanceof AdminReauthCancelledError) {
        setTests((t) => Object.fromEntries(Object.entries(t).filter(([id]) => id !== item.id)));
        return;
      }
      setTests((t) => ({ ...t, [item.id]: { status: "done", ok: false, message: adminErrorMessage(e) } }));
    }
  }

  const tabItems: TabItem[] = [
    { id: "overview", label: "Umumiy" },
    ...categories.map((c) => ({
      id: c.id,
      label: c.label,
      badge: (
        <>
          <span data-tab-dot={c.verdict} aria-hidden="true" className={`inline-block size-2 rounded-full ${DOT[c.verdict]}`} />
          <span className="sr-only"> — {DOT_TEXT[c.verdict]}</span>
        </>
      ),
    })),
  ];
  const current = categories.find((c) => c.id === tab);
  const active: TabId = current ? tab : "overview";

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <header className="flex flex-wrap items-end gap-x-3 gap-y-2">
        <div className="min-w-0 flex-[1_1_360px]">
          <h1 className="text-[22px] font-semibold tracking-tight">AI provayderlar</h1>
          <p className="text-muted-foreground mt-1 max-w-3xl text-[13px]">
            Saytdagi har bir AI vazifasi qaysi xizmatda ishlaydi, qancha turadi va zaxirasi bormi. Toifani tanlang — ichida provayderlar, ishlatish tartibi va sarf.
            {canEdit ? "" : " Sizda faqat ko'rish huquqi bor."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={reload} loading={refreshing}>
            Yangilash
          </Button>
        </div>
      </header>

      {state.status === "loading" ? <Loading /> : null}
      {state.status === "forbidden" ? <Forbidden /> : null}
      {state.status === "error" ? (
        <Card>
          <ErrorState message={state.message} requestId={state.requestId} onRetry={reload} />
        </Card>
      ) : null}

      {data && k ? (
        <>
          {!data.canStoreKeys ? (
            <div role="alert" data-crypto-missing className="bg-warning/10 text-foreground flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-[13px]">
              <TriangleAlert className="text-warning mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <p>
                Kalitlarni saqlash uchun serverda shifrlash kaliti sozlanmagan (<span className="font-mono">PROVIDER_KEYS_KEY</span> yoki{" "}
                <span className="font-mono">ADMIN_TOTP_KEY</span>). Provayderlarni yoqish va o&apos;chirish ishlayveradi.
              </p>
            </div>
          ) : null}
          {data.sealingKey === "admin" ? (
            <div role="note" data-key-fallback className="bg-info/10 text-foreground flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-[13px]">
              <Info className="text-info mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <p>
                Tavsiya: serverda <span className="font-mono">PROVIDER_KEYS_KEY</span> o&apos;rnating. Hozir kalitlar{" "}
                <span className="font-mono">ADMIN_TOTP_KEY</span> asosida shifrlanmoqda; <span className="font-mono">PROVIDER_KEYS_KEY</span> keyin
                qo&apos;yilsa, saqlangan kalitlar o&apos;qilmay qoladi — uni birinchi kalit kiritishdan oldin qo&apos;ying.
              </p>
            </div>
          ) : null}

          <section aria-label="Umumiy ko'rsatkichlar" data-summary className="grid grid-cols-2 gap-3 min-[1100px]:grid-cols-4">
            <KpiTile label="30 kunlik AI sarfi" value={moneyText(data.total30.usd, data.soumPerUsd)} hint={`${fmtNumber(data.total30.calls)} ta so'rov`} />
            <KpiTile
              label="Eng katta xarajat"
              value={k.top ? `${k.top.label} · ${k.top.share}%` : "—"}
              hint={k.top ? k.top.providers.map((p) => `${p.label} ${fmtUsd(p.usd)}`).join(" · ") : "30 kunda pullik sarf yo'q"}
            />
            <KpiTile label="Ishlayotgan provayderlar" value={`${k.usable} / ${k.total}`} hint={`${k.paidUsable} to'lovli · ${k.freeUsable} bepul`} />
            <KpiTile label="Diqqat talab" value={k.attention === 0 ? "Hammasi joyida" : `${k.attention} ta`} hint={k.reason ?? "Yetarli emas yoki zaxirasiz vazifa yo'q"} />
          </section>

          <Tabs tabs={tabItems} value={active} onChange={setTab} ariaLabel="Toifalar" idPrefix={ID_PREFIX} />
          <TabPanel idPrefix={ID_PREFIX} id={active}>
            {current ? (
              <CategoryTab
                category={current}
                categories={categories}
                canEdit={canEdit}
                canStoreKeys={data.canStoreKeys}
                period={period}
                onPeriod={setPeriod}
                propagationSec={propagationSec}
                tests={tests}
                onToggle={setToggleFor}
                onKey={setKeyFor}
                onDeleteKey={setDeleteFor}
                onTest={(it) => void runTest(it)}
                onChanged={reload}
              />
            ) : (
              <OverviewTab
                categories={categories}
                system={data.system}
                onOpen={setTab}
                legacy={
                  data.otherUsage.length > 0 ? (
                    <p data-other-usage className="text-muted-foreground text-[12.5px]">
                      Eski provayderlar sarfi (30 kun): {data.otherUsage.map((o) => `${o.provider} — ${o.calls} ta so'rov, $${o.usd.toFixed(2)}`).join("; ")}. Ular endi ishlatilmaydi,
                      tarix umumiy sarfda saqlanadi.
                    </p>
                  ) : null
                }
              />
            )}
          </TabPanel>
        </>
      ) : null}

      <ProviderKeyDialog
        item={keyFor}
        propagationSec={propagationSec}
        onClose={() => setKeyFor(null)}
        onSaved={() => {
          setKeyFor(null);
          reload();
        }}
      />
      <ProviderDeleteKeyDialog
        item={deleteFor}
        propagationSec={propagationSec}
        onClose={() => setDeleteFor(null)}
        onSaved={() => {
          setDeleteFor(null);
          reload();
        }}
        onStale={reload}
      />
      <ProviderToggleDialog
        item={toggleFor}
        propagationSec={propagationSec}
        onClose={() => setToggleFor(null)}
        onSaved={() => {
          setToggleFor(null);
          reload();
        }}
        onStale={reload}
      />
    </div>
  );
}
