"use client";

import { useState } from "react";
import { Info, TriangleAlert } from "lucide-react";
import { useCan } from "@/components/admin/shell";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, Forbidden, Skeleton } from "@/components/admin/ui";
import { cn } from "@/lib/cn";
import { fmtDateTime } from "@/lib/admin-format";
import { AdminReauthCancelledError, adminErrorMessage, isAbortError } from "@/lib/admin-api/core";
import { testProvider, type ProviderItem, type ProviderTestResult } from "@/lib/admin-api/providers";
import { ProviderDeleteKeyDialog, ProviderKeyDialog, ProviderToggleDialog } from "./ProviderDialogs";
import { KIND_LABEL, keyState, propagationNote } from "./format";
import { useProviders } from "./useProviders";

function Loading() {
  return (
    <Card>
      <div aria-busy="true" aria-label="Yuklanmoqda">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex flex-col gap-2 border-t px-4 py-4 first:border-t-0">
            <Skeleton className="h-4 w-48 max-w-full" />
            <Skeleton className="h-3 w-72 max-w-full" />
          </div>
        ))}
      </div>
    </Card>
  );
}

type TestState = { status: "running" } | ({ status: "done" } & ProviderTestResult);

function Row({
  item,
  canEdit,
  canStoreKeys,
  test,
  onToggle,
  onKey,
  onDeleteKey,
  onTest,
}: {
  item: ProviderItem;
  canEdit: boolean;
  canStoreKeys: boolean;
  test: TestState | undefined;
  onToggle: (item: ProviderItem) => void;
  onKey: (item: ProviderItem) => void;
  onDeleteKey: (item: ProviderItem) => void;
  onTest: (item: ProviderItem) => void;
}) {
  const state = keyState(item);
  return (
    <li data-provider={item.id} data-enabled={item.enabled ? "1" : "0"} className="flex flex-wrap items-start gap-x-5 gap-y-3 border-t px-4 py-3.5 first:border-t-0">
      <div className="min-w-[min(100%,14rem)] flex-1">
        <p className="text-[13.5px] font-semibold">{item.label}</p>
        <p className="text-muted-foreground mt-0.5 font-mono text-[11.5px] break-all">{item.id}</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {item.kinds.map((k) => (
            <Badge key={k}>{KIND_LABEL[k]}</Badge>
          ))}
        </div>
        {item.updatedAt ? (
          <p className="text-muted-foreground mt-1.5 text-xs">
            O&apos;zgartirgan: <span className="text-foreground">{item.updatedBy ?? "noma'lum admin"}</span> · {fmtDateTime(item.updatedAt)}
          </p>
        ) : null}
      </div>

      <div className="flex min-w-[8.5rem] flex-col gap-1 text-[13px]">
        <span className="text-muted-foreground text-xs">Holat</span>
        {!item.implemented ? (
          <Badge tone="neutral" title="Adapter hali yozilmagan: kalit saqlanadi, lekin hech narsa uni o'qimaydi">
            Tez orada
          </Badge>
        ) : canEdit ? (
          <label className="inline-flex min-h-9 cursor-pointer items-center gap-2">
            <button
              type="button"
              role="switch"
              aria-checked={item.enabled}
              aria-label={`${item.label}: yoqilgan`}
              onClick={() => onToggle(item)}
              className={cn(
                "focus-visible:ring-ring relative h-6 w-11 shrink-0 rounded-full border transition-colors outline-none focus-visible:ring-2",
                item.enabled ? "border-primary bg-primary" : "border-input bg-muted",
              )}
            >
              <span
                aria-hidden="true"
                className={cn("bg-card absolute top-0.5 left-0.5 size-4.5 rounded-full shadow transition-transform", item.enabled ? "translate-x-5" : "translate-x-0")}
              />
            </button>
            <span aria-hidden="true">{item.enabled ? "Yoqilgan" : "O'chirilgan"}</span>
          </label>
        ) : (
          <Badge tone={item.enabled ? "success" : "warning"} dot>
            {item.enabled ? "Yoqilgan" : "O'chirilgan"}
          </Badge>
        )}
      </div>

      <div className="flex min-w-[10rem] flex-col gap-1 text-[13px]">
        <span className="text-muted-foreground text-xs">Kalit</span>
        <span data-key-state>
          <Badge tone={state.tone} dot>
            {state.label}
          </Badge>
        </span>
        {!item.implemented ? null : !item.enabled ? <span className="text-badge-warning-text text-xs font-medium">O&apos;chirilgan: kalit ishlatilmaydi</span> : null}
      </div>

      {canEdit ? (
        <div className="flex flex-col gap-2 sm:items-end">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => onKey(item)} disabled={!canStoreKeys} title={canStoreKeys ? undefined : "Serverda shifrlash kaliti sozlanmagan"}>
              {item.hasDbKey ? "Almashtirish" : "Kalitni kiritish"}
            </Button>
            {item.hasDbKey ? (
              <Button size="sm" variant="dangerOutline" onClick={() => onDeleteKey(item)}>
                O&apos;chirish
              </Button>
            ) : null}
            {item.testable ? (
              <Button size="sm" variant="ghost" loading={test?.status === "running"} onClick={() => onTest(item)}>
                Tekshirish
              </Button>
            ) : null}
          </div>
          {test?.status === "done" ? (
            <p role="status" data-test-result={test.ok ? "ok" : "fail"} className={cn("max-w-xs text-xs font-medium sm:text-right", test.ok ? "text-badge-success-text" : "text-destructive")}>
              {test.message}
            </p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/**
 * `/admin/providers` «Provayderlar» (program-17 decision D7; `settings.view`, edits `settings.edit` with step-up):
 * one row per AI provider with its on/off switch, where its key comes from (the encrypted database, the env var
 * or nowhere) and the actions Kalitni kiritish / Almashtirish / O'chirish / Tekshirish. A key is typed into a
 * password field and never shown again; roles without edit rights see no hint at all. Permissions are enforced
 * by the API; hiding the controls is cosmetic.
 */
export function ProvidersPage() {
  const canEdit = useCan("settings.edit");
  const { state, reload, replace } = useProviders();
  const [keyFor, setKeyFor] = useState<ProviderItem | null>(null);
  const [deleteFor, setDeleteFor] = useState<ProviderItem | null>(null);
  const [toggleFor, setToggleFor] = useState<ProviderItem | null>(null);
  const [tests, setTests] = useState<Record<string, TestState>>({});

  const data = state.status === "ready" ? state.data : null;
  const propagationSec = data?.propagationSec ?? 30;

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
    <div className="flex min-w-0 flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="text-[22px] font-semibold tracking-tight">Provayderlar</h1>
        <p className="text-muted-foreground text-[13px]">
          AI provayderlarning API kalitlari va yoqish/o&apos;chirish tugmalari. Bazadagi kalit muhitdagi (env) kalitdan ustun turadi; o&apos;chirilgan
          provayder hech qachon ishlatilmaydi.{canEdit ? "" : " Sizda faqat ko'rish huquqi bor."}
        </p>
      </header>

      <div role="note" className="bg-info/10 text-foreground flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-[13px]">
        <Info className="text-info mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <p>{propagationNote(propagationSec)}</p>
      </div>

      {data && !data.canStoreKeys ? (
        <div role="alert" data-crypto-missing className="bg-warning/10 text-foreground flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-[13px]">
          <TriangleAlert className="text-warning mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>
            Kalitlarni saqlash uchun serverda shifrlash kaliti sozlanmagan (<span className="font-mono">PROVIDER_KEYS_KEY</span> yoki{" "}
            <span className="font-mono">ADMIN_TOTP_KEY</span>). Provayderlarni yoqish va o&apos;chirish ishlayveradi.
          </p>
        </div>
      ) : null}

      {data && data.sealingKey === "admin" ? (
        <div role="note" data-key-fallback className="bg-info/10 text-foreground flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-[13px]">
          <Info className="text-info mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>
            Tavsiya: serverda <span className="font-mono">PROVIDER_KEYS_KEY</span> o&apos;rnating. Hozir kalitlar{" "}
            <span className="font-mono">ADMIN_TOTP_KEY</span> asosida shifrlanmoqda; <span className="font-mono">PROVIDER_KEYS_KEY</span> keyin
            qo&apos;yilsa, saqlangan kalitlar o&apos;qilmay qoladi — uni birinchi kalit kiritishdan oldin qo&apos;ying.
          </p>
        </div>
      ) : null}

      {state.status === "loading" ? <Loading /> : null}
      {state.status === "forbidden" ? <Forbidden /> : null}
      {state.status === "error" ? (
        <Card>
          <ErrorState message={state.message} requestId={state.requestId} onRetry={reload} />
        </Card>
      ) : null}
      {data && data.items.length === 0 ? (
        <Card>
          <EmptyState title="Provayderlar yo'q" description="Reyestrda provayder topilmadi." />
        </Card>
      ) : null}
      {data && data.items.length > 0 ? (
        <Card>
          <CardHeader title="Provayderlar" description="Matn, rasm, ovoz, video va manba qidiruv xizmatlari." />
          <ul>
            {data.items.map((item) => (
              <Row
                key={item.id}
                item={item}
                canEdit={canEdit}
                canStoreKeys={data.canStoreKeys}
                test={tests[item.id]}
                onToggle={setToggleFor}
                onKey={setKeyFor}
                onDeleteKey={setDeleteFor}
                onTest={(it) => void runTest(it)}
              />
            ))}
          </ul>
        </Card>
      ) : null}

      <ProviderKeyDialog
        item={keyFor}
        propagationSec={propagationSec}
        onClose={() => setKeyFor(null)}
        onSaved={(item) => {
          replace(item);
          setKeyFor(null);
        }}
      />
      <ProviderDeleteKeyDialog
        item={deleteFor}
        propagationSec={propagationSec}
        onClose={() => setDeleteFor(null)}
        onSaved={(item) => {
          replace(item);
          setDeleteFor(null);
        }}
        onStale={reload}
      />
      <ProviderToggleDialog
        item={toggleFor}
        propagationSec={propagationSec}
        onClose={() => setToggleFor(null)}
        onSaved={(item) => {
          replace(item);
          setToggleFor(null);
        }}
        onStale={reload}
      />
    </div>
  );
}
