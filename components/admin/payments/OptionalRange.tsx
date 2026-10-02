"use client";

import { DateRangePicker, Segmented, presetRange } from "@/components/admin/ui";

/**
 * A date filter that may be off: "Hammasi" (no range, e.g. to find an old
 * order by id) or a Tashkent date range (≤ 366 days, the server's cap).
 * Empty `from`/`to` means "off".
 */
export function OptionalRangeFilter({
  from,
  to,
  onChange,
  label = "Davr",
}: {
  from: string;
  to: string;
  onChange: (range: { from: string; to: string }) => void;
  label?: string;
}) {
  const on = Boolean(from || to);
  return (
    <div className="flex min-w-0 flex-col items-start gap-1">
      <span className="text-muted-foreground text-[11px] font-semibold">{label}</span>
      <Segmented
        ariaLabel={label}
        value={on ? "range" : "all"}
        onChange={(v) => onChange(v === "all" ? { from: "", to: "" } : presetRange("30d"))}
        options={[
          { value: "all", label: "Hammasi" },
          { value: "range", label: "Davr tanlash" },
        ]}
      />
      {on ? <DateRangePicker ariaLabel={`${label}: oraliq`} value={{ from: from || to, to: to || from }} onChange={onChange} /> : null}
    </div>
  );
}
