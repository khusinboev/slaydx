"use client";

import { useEffect, useState } from "react";
import { Store } from "lucide-react";
import { Switch } from "@/components/forms/compact";
import { Group, IconChip } from "@/components/profile/parts";
import * as api from "@/lib/api-client";
import { useMarketOn } from "./MarketClosed";

/**
 * «Mening ishlarim bozorga chiqmasin» (M7, profile → Xavfsizlik). The switch answers at once and goes back if the server
 * refuses. Shown only with the market on: while it is dark nothing of it is visible (§10.5).
 */
export function MarketOptOut() {
  const on = useMarketOn();
  const [value, setValue] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!on) return;
    let alive = true;
    api
      .getMarketOptOut()
      .then((r) => {
        if (alive) setValue(r.optOut);
      })
      .catch(() => {
        if (alive) setError("Sozlama yuklanmadi.");
      });
    return () => {
      alive = false;
    };
  }, [on]);

  if (!on) return null;

  const change = (next: boolean) => {
    const before = value;
    setValue(next);
    setError(null);
    api.setMarketOptOut(next).catch(() => {
      setValue(before);
      setError("Saqlanmadi. Qayta urinib ko‘ring.");
    });
  };

  return (
    <div className="mt-4" data-market-opt-out>
      <Group label="Ishlar bozori">
        <li className="flex min-h-[54px] items-center gap-3 px-3.5 py-2">
          <IconChip icon={Store} />
          <span className="min-w-0 flex-1">
            <span className="block text-[15.5px] font-medium">Mening ishlarim bozorga chiqmasin</span>
            <span className="text-muted-foreground block text-[13.5px] leading-snug">Ishlaringizning ism-sharifsiz nusxasi boshqalarga sotilmaydi</span>
          </span>
          {value === null ? <span aria-hidden className="bg-muted slx-shimmer h-7 w-12 rounded-full" /> : <Switch checked={value} onChange={change} ariaLabel="Mening ishlarim bozorga chiqmasin" />}
        </li>
      </Group>
      {error ? (
        <p role="alert" className="text-destructive mt-2 px-1 text-[14px]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
