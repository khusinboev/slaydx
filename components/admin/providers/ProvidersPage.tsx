"use client";

import { useMemo, useState } from "react";
import { Info, TriangleAlert } from "lucide-react";
import { useCan } from "@/components/admin/shell";
import { Card, EmptyState, ErrorState, Forbidden, Segmented, Skeleton } from "@/components/admin/ui";
import { AdminReauthCancelledError, adminErrorMessage, isAbortError } from "@/lib/admin-api/core";
import { testProvider, type ProviderItem, type ProvidersResponse } from "@/lib/admin-api/providers";
import { ProviderDeleteKeyDialog, ProviderKeyDialog, ProviderToggleDialog } from "./ProviderDialogs";
import { ProviderCard, type TestState } from "./ProviderCard";
import { PurposeCard } from "./PurposeCard";
import { SummaryStrip } from "./SummaryStrip";
import { SystemSection } from "./SystemSection";
import { PERIODS, propagationNote, providerNeedsAttention, type Period } from "./format";
import { useProviders } from "./useProviders";

function Loading() {
  return (
    <div aria-busy="true" aria-label="Yuklanmoqda" className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
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

const NEED_RANK = { required: 0, recommended: 1, optional: 2 } as const;

type Filter = "all" | "paid" | "free" | "attention";

function matches(item: ProviderItem, filter: Filter): boolean {
  if (filter === "paid") return item.billing !== "free";
  if (filter === "free") return item.billing === "free";
  if (filter === "attention") return providerNeedsAttention(item) || !item.usable;
  return true;
}

/**
 * `/admin/providers` «Provayderlar» (program-17 D7, redesigned 2026-10-31; `settings.view`, edits `settings.edit` with
 * step-up). One page answers three questions in plain words:
 *   1. What does the product need each provider FOR, and is the current setup enough? (purpose cards, with the
 *      provider/model order editable right there);
 *   2. Which providers cost money, which are free, and how much has each been used? (provider cards, today / 7 / 30
 *      days, daily trend, split by kind);
 *   3. Is the machinery behind them healthy? (processes, circuit breakers, limiters).
 * Every provider action is here: switch on/off, key in / replace / delete, live test. A key is typed into a password
 * field and never shown again; roles without edit rights see no hint at all. Permissions are enforced by the API;
 * hiding the controls is cosmetic.
 */
export function ProvidersPage() {
  const canEdit = useCan("settings.edit");
  const { state, refreshing, reload } = useProviders();
  const [keyFor, setKeyFor] = useState<ProviderItem | null>(null);
  const [deleteFor, setDeleteFor] = useState<ProviderItem | null>(null);
  const [toggleFor, setToggleFor] = useState<ProviderItem | null>(null);
  const [tests, setTests] = useState<Record<string, TestState>>({});
  const [period, setPeriod] = useState<Period>("d30");
  const [filter, setFilter] = useState<Filter>("all");

  const data: ProvidersResponse | null = state.status === "ready" ? state.data : null;
  const propagationSec = data?.propagationSec ?? 30;

  const byId = useMemo(() => Object.fromEntries((data?.items ?? []).map((i) => [i.id, i])) as Record<string, ProviderItem>, [data]);
  const purposeTitles = useMemo(() => Object.fromEntries((data?.purposes ?? []).map((p) => [p.id, p.title])), [data]);
  const sorted = useMemo(
    () => [...(data?.items ?? [])].sort((a, b) => NEED_RANK[a.need] - NEED_RANK[b.need] || b.usage.d30.usd - a.usage.d30.usd || b.usage.d30.calls - a.usage.d30.calls || a.label.localeCompare(b.label)),
    [data],
  );
  const visible = sorted.filter((i) => matches(i, filter));

  const counts = {
    all: sorted.length,
    paid: sorted.filter((i) => matches(i, "paid")).length,
    free: sorted.filter((i) => matches(i, "free")).length,
    attention: sorted.filter((i) => matches(i, "attention")).length,
  };

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

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-[22px] font-semibold tracking-tight">Provayderlar va AI sozlamalari</h1>
        <p className="text-muted-foreground max-w-3xl text-[13px]">
          Saytdagi AI xizmatlari qaysi provayderlarda ishlaydi, qaysilari pullik, qancha ishlatilgan va hozirgi sozlama yetarlimi — hammasi shu
          yerda. Kalit, yoqish/o&apos;chirish va ishlatish tartibini ham shu yerdan o&apos;zgartirasiz.{canEdit ? "" : " Sizda faqat ko'rish huquqi bor."}
          {refreshing ? <span className="text-muted-foreground"> Yangilanmoqda…</span> : null}
        </p>
      </header>

      {state.status === "loading" ? <Loading /> : null}
      {state.status === "forbidden" ? <Forbidden /> : null}
      {state.status === "error" ? (
        <Card>
          <ErrorState message={state.message} requestId={state.requestId} onRetry={reload} />
        </Card>
      ) : null}

      {data ? (
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

          <SummaryStrip data={data} />

          <section aria-labelledby="purposes-h" className="flex flex-col gap-3">
            <div>
              <h2 id="purposes-h" className="text-base font-semibold">
                Nima uchun nima kerak
              </h2>
              <p className="text-muted-foreground text-[12.5px]">
                Har bir vazifa uchun: nima yetarli, qaysi provayderlar xizmat qila oladi va hozir qaysi biri ishlayapti. {propagationNote(propagationSec)}
              </p>
            </div>
            <div className="grid gap-3 xl:grid-cols-2">
              {data.purposes.map((p) => (
                <PurposeCard key={p.id} purpose={p} providers={byId} canEdit={canEdit} propagationSec={propagationSec} onChanged={reload} />
              ))}
            </div>
          </section>

          <section aria-labelledby="providers-h" className="flex flex-col gap-3">
            <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
              <div className="min-w-0 flex-1">
                <h2 id="providers-h" className="text-base font-semibold">
                  Provayderlar
                </h2>
                <p className="text-muted-foreground text-[12.5px]">Kim pullik, kim bepul, qancha ishlatilgan. Bazadagi kalit serverdagi (env) kalitdan ustun turadi.</p>
              </div>
              <Segmented
                ariaLabel="Ishlatilish davri"
                value={period}
                onChange={(v) => setPeriod(v as Period)}
                options={PERIODS.map((p) => ({ value: p.value, label: p.label }))}
              />
              <Segmented
                ariaLabel="Provayderlarni saralash"
                value={filter}
                onChange={(v) => setFilter(v as Filter)}
                options={[
                  { value: "all", label: `Hammasi ${counts.all}` },
                  { value: "paid", label: `To'lovli ${counts.paid}` },
                  { value: "free", label: `Bepul ${counts.free}` },
                  { value: "attention", label: `Ishlamayotgan ${counts.attention}` },
                ]}
              />
            </div>
            {visible.length === 0 ? (
              <Card>
                <EmptyState title="Bu saralashda provayder yo'q" description="Boshqa saralashni tanlang." />
              </Card>
            ) : (
              <div className="grid gap-3 xl:grid-cols-2">
                {visible.map((item) => (
                  <ProviderCard
                    key={item.id}
                    item={item}
                    canEdit={canEdit}
                    canStoreKeys={data.canStoreKeys}
                    period={period}
                    soumPerUsd={data.soumPerUsd}
                    purposeTitles={purposeTitles}
                    test={tests[item.id]}
                    onToggle={setToggleFor}
                    onKey={setKeyFor}
                    onDeleteKey={setDeleteFor}
                    onTest={(it) => void runTest(it)}
                  />
                ))}
              </div>
            )}
            {data.otherUsage.length > 0 ? (
              <p data-other-usage className="text-muted-foreground text-xs">
                Eski provayderlar sarfi (30 kun): {data.otherUsage.map((o) => `${o.provider} — ${o.calls} ta so'rov, $${o.usd.toFixed(2)}`).join("; ")}. Ular endi ishlatilmaydi,
                tarix umumiy sarfda saqlanadi.
              </p>
            ) : null}
          </section>

          <SystemSection system={data.system} />
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
