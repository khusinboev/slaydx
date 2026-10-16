"use client";

import { OrdersTable } from "./OrdersTable";

/** S8 `/admin/payments`: Click, Payme and Paynet orders (plan §7.1). */
export function PaymentsPage() {
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="text-[22px] font-semibold tracking-tight">To&apos;lovlar</h1>
        <p className="text-muted-foreground text-[13px]">Click, Payme va Paynet buyurtmalari, holati va hisobga yozilgani</p>
      </header>
      <OrdersTable />
    </div>
  );
}
