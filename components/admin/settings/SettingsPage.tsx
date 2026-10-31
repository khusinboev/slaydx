"use client";

import { useCallback, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, Info, Search, TriangleAlert } from "lucide-react";
import { useCan } from "@/components/admin/shell";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, Forbidden, Skeleton, TabPanel, Tabs, type TabItem } from "@/components/admin/ui";
import type { SettingItem } from "@/lib/admin-api/settings";
import { formatValue, noteFor, PROPAGATION_NOTE, warningsFor, type ToolOption } from "./format";
import { isFeatureKey, keysForTab, OTHER_DEF, OTHER_TAB, OVERVIEW_TAB, STOP_KEYS, TAB_DEFS, tabOfKey, type TabDef } from "./layout";
import { SettingEditDialog } from "./SettingEditDialog";
import { SettingResetDialog } from "./SettingResetDialog";
import { ROW_GRID, SettingRow } from "./SettingRow";
import { useSettings } from "./useSettings";

const ID_PREFIX = "settings";

function Loading() {
  return (
    <div aria-busy="true" aria-label="Yuklanmoqda" className="flex flex-col gap-4">
      <Card>
        {[1, 2, 3, 4].map((r) => (
          <div key={r} className="flex flex-col gap-2 border-t px-4 py-3.5 first:border-t-0">
            <Skeleton className="h-4 w-56 max-w-full" />
            <Skeleton className="h-3 w-80 max-w-full" />
          </div>
        ))}
      </Card>
    </div>
  );
}

/** Column captions: shown from 1100 px, where rows are table rows. */
function ColumnHeader() {
  return (
    <div className={`text-muted-foreground hidden border-b px-4 py-2 text-[11px] font-medium tracking-wide uppercase ${ROW_GRID}`}>
      <span>Sozlama</span>
      <span>Hozirgi qiymat</span>
      <span>Standart</span>
      <span className="text-right">Amal</span>
    </div>
  );
}

/**
 * S14 `/admin/settings`: runtime settings in category tabs (the tab is in the URL,
 * `?tab=`), an overview first, a search over every tab. Each row shows the value with
 * its unit, the default, who changed it and when. Viewers and finance only read;
 * editors get a switch for flags, «O'zgartirish» for values and «Standartga qaytarish»
 * for overrides; the dialogs (reason, step-up, audit) are unchanged. `tools` is the
 * registry the server page passes in (this module must not import `lib/tools.ts`).
 */
export function SettingsPage({ tools }: { tools: ReadonlyArray<ToolOption> }) {
  const canEdit = useCan("settings.edit");
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { state, reload, replace } = useSettings();
  const [editing, setEditing] = useState<{ item: SettingItem; presetBool?: boolean } | null>(null);
  const [resetting, setResetting] = useState<SettingItem | null>(null);
  const [query, setQuery] = useState("");

  const items = useMemo(() => (state.status === "ready" ? state.items : []), [state]);
  const tabs: TabDef[] = useMemo(() => (items.some((i) => tabOfKey(i.key) === OTHER_TAB) ? [...TAB_DEFS, OTHER_DEF] : [...TAB_DEFS]), [items]);
  const rawTab = params.get("tab") ?? OVERVIEW_TAB;
  const tab = rawTab === OVERVIEW_TAB || tabs.some((t) => t.id === rawTab) ? rawTab : OVERVIEW_TAB;

  const selectTab = useCallback(
    (id: string) => {
      const next = new URLSearchParams(params.toString());
      if (id === OVERVIEW_TAB) next.delete("tab");
      else next.set("tab", id);
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  const tabItems: TabItem[] = [
    { id: OVERVIEW_TAB, label: "Umumiy" },
    ...tabs.map((t) => {
      const changed = keysForTab(t, items).filter((i) => i.source === "db").length;
      return { id: t.id, label: t.label, badge: changed > 0 ? changed : undefined };
    }),
  ];

  const needle = query.trim().toLowerCase();
  const matches = (item: SettingItem): boolean => {
    const tabLabel = tabs.find((t) => t.id === tabOfKey(item.key))?.label ?? "";
    const hay = `${item.label} ${item.description} ${item.key} ${tabLabel} ${formatValue(item, item.value, tools)}`.toLowerCase();
    return needle.split(/\s+/).every((w) => hay.includes(w));
  };

  const row = (item: SettingItem) => (
    <SettingRow
      key={item.key}
      item={item}
      tools={tools}
      canEdit={canEdit}
      onEdit={(i) => setEditing({ item: i })}
      onReset={setResetting}
      onToggle={(i) => setEditing({ item: i, presetBool: i.type === "bool" ? !i.value : undefined })}
      note={noteFor(item, items)}
    />
  );

  function renderBody() {
    if (needle) {
      const groups = tabs.map((t) => ({ tab: t, found: keysForTab(t, items).filter(matches) })).filter((g) => g.found.length > 0);
      if (groups.length === 0) {
        return (
          <Card>
            <EmptyState title="Hech narsa topilmadi" description={`«${query.trim()}» bo'yicha sozlama yo'q.`} />
          </Card>
        );
      }
      return (
        <div className="flex flex-col gap-4">
          {groups.map((g) => (
            <Card key={g.tab.id}>
              <CardHeader title={g.tab.label} />
              <ColumnHeader />
              <ul>{g.found.map(row)}</ul>
            </Card>
          ))}
        </div>
      );
    }
    if (tab === OVERVIEW_TAB) {
      return (
        <TabPanel idPrefix={ID_PREFIX} id={OVERVIEW_TAB}>
          <Overview items={items} row={row} onOpenTab={selectTab} />
        </TabPanel>
      );
    }
    const def = tabs.find((t) => t.id === tab) ?? OTHER_DEF;
    return (
      <TabPanel idPrefix={ID_PREFIX} id={def.id}>
        <Card>
          <CardHeader title={def.label} description={def.blurb} />
          <ColumnHeader />
          <ul>{keysForTab(def, items).map(row)}</ul>
        </Card>
      </TabPanel>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-[22px] font-semibold tracking-tight">Sozlamalar</h1>
        <p className="text-muted-foreground text-[13px]">
          Qayta deploy qilmasdan o&apos;zgartiriladigan qiymatlar.{canEdit ? "" : " Sizda faqat ko'rish huquqi bor."}
        </p>
      </header>

      <div role="note" className="bg-info/10 text-foreground flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-[13px]">
        <Info className="text-info mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <p>{PROPAGATION_NOTE}</p>
      </div>

      {state.status === "loading" ? <Loading /> : null}
      {state.status === "forbidden" ? <Forbidden /> : null}
      {state.status === "error" ? (
        <Card>
          <ErrorState message={state.message} requestId={state.requestId} onRetry={reload} />
        </Card>
      ) : null}
      {state.status === "ready" && state.items.length === 0 ? (
        <Card>
          <EmptyState title="Sozlamalar yo'q" description="Katalogda sozlama topilmadi." />
        </Card>
      ) : null}
      {state.status === "ready" && state.items.length > 0 ? (
        <>
          <div className="relative">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Sozlamalardan qidirish…"
              aria-label="Sozlamalardan qidirish"
              autoComplete="off"
              className="border-input bg-card focus:ring-ring h-10 w-full rounded-lg border pr-3 pl-9 text-[13px] outline-none focus:ring-2 min-[1100px]:max-w-sm"
            />
          </div>
          {needle ? null : <Tabs tabs={tabItems} value={tab} onChange={selectTab} ariaLabel="Sozlamalar bo'limlari" idPrefix={ID_PREFIX} />}
          {renderBody()}
        </>
      ) : null}

      <SettingEditDialog
        item={editing?.item ?? null}
        presetBool={editing?.presetBool}
        tools={tools}
        onClose={() => setEditing(null)}
        onSaved={(item) => {
          replace(item);
          setEditing(null);
        }}
      />
      <SettingResetDialog
        item={resetting}
        tools={tools}
        onClose={() => setResetting(null)}
        onReset={(item) => {
          replace(item);
          setResetting(null);
        }}
        onStale={reload}
      />
    </div>
  );
}

/** «Umumiy»: what is on or off, what differs from the default, and what needs attention. */
function Overview({
  items,
  row,
  onOpenTab,
}: {
  items: ReadonlyArray<SettingItem>;
  row: (item: SettingItem) => React.ReactNode;
  onOpenTab: (tab: string) => void;
}) {
  const warnings = warningsFor(items);
  const features = items.filter((i) => isFeatureKey(i.key));
  const stops = items.filter((i) => STOP_KEYS.has(i.key));
  const changed = items.filter((i) => i.source === "db");

  const flagLine = (item: SettingItem, stop: boolean) => {
    const on = item.type === "bool" && item.value;
    const text = stop ? (on ? "To'xtatilgan" : "Ishlayapti") : on ? "Yoqilgan" : "O'chiq";
    const good = stop ? !on : on;
    return (
      <li key={item.key} data-overview={item.key} className="flex items-center gap-3 border-t px-4 py-2.5 first:border-t-0">
        <span className="min-w-0 flex-1 text-[13px] font-medium">{item.label}</span>
        <Badge tone={good ? "success" : stop ? "warning" : "neutral"} dot>
          {text}
        </Badge>
        <Button className="max-[1099px]:min-h-10" onClick={() => onOpenTab(tabOfKey(item.key))}>
          Ochish
        </Button>
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader title="Ogohlantirishlar" description="E'tibor talab qiladigan holatlar" />
        {warnings.length === 0 ? (
          <p className="text-muted-foreground flex items-center gap-2 px-4 py-3.5 text-[13px]">
            <CheckCircle2 className="text-success size-4" aria-hidden="true" /> Ogohlantirish yo&apos;q.
          </p>
        ) : (
          <ul>
            {warnings.map((w) => (
              <li key={w.id} data-warning={w.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t px-4 py-3 first:border-t-0">
                <TriangleAlert className="text-warning size-4 shrink-0" aria-hidden="true" />
                <span className="min-w-[min(100%,14rem)] flex-1 text-[13px]">{w.text}</span>
                <Button className="max-[1099px]:min-h-10" onClick={() => onOpenTab(w.tab)}>
                  Tuzatish
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid gap-4 min-[1100px]:grid-cols-2">
        <Card>
          <CardHeader title="Funksiyalar" description="Hozir nima yoqilgan" />
          <ul>{features.map((i) => flagLine(i, false))}</ul>
        </Card>
        <Card>
          <CardHeader title="Favqulodda to'xtatishlar" description="Odatda hammasi «Ishlayapti» bo'lishi kerak" />
          <ul>{stops.map((i) => flagLine(i, true))}</ul>
        </Card>
      </div>

      <Card>
        <CardHeader title="Standartdan farq qiladigan sozlamalar" description={`${changed.length} ta`} />
        {changed.length === 0 ? (
          <p className="text-muted-foreground px-4 py-3.5 text-[13px]">Hamma sozlama standart holatda.</p>
        ) : (
          <>
            <ColumnHeader />
            <ul>{changed.map(row)}</ul>
          </>
        )}
      </Card>
    </div>
  );
}
