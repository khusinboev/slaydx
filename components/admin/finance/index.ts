/**
 * Finance module (WP4): S10 summary, global ledger, reconciliation.
 *
 * Reuse contract for other screens (WP2's user page, "Hisob" tab):
 *
 *   <LedgerTable fixedFilters={{ userId }} embedded />
 *
 *   - `fixedFilters.userId` pins the ledger (and its CSV export) to one user; the
 *     user column and the user filter are hidden and "clear filters" keeps it;
 *   - `embedded` keeps filters and paging in local state (the host page's URL is
 *     never written); default page size 20 (`pageSize` overrides, 1..100);
 *   - data comes from `GET /api/admin/transactions` (finance.view): a role
 *     without it (support, moderator) sees the in-table "Ruxsat yo'q" state, so
 *     the host may hide the tab with `useCan("finance.view")` or use its own
 *     `users.view` endpoint for those roles;
 *   - references link to `/admin/payments/:id` or `/admin/generations/:id`
 *     when they resolve; the CSV button shows only with `finance.export`.
 */
export { LedgerTable, LEDGER_FILTER_KEYS, type LedgerTableProps } from "./LedgerTable";
export { FinancePage } from "./FinancePage";
export { FinanceSummaryView, compactSoum } from "./FinanceSummaryView";
export { ReconciliationView, TIMEOUT_TEXT } from "./ReconciliationView";
