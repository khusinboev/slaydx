/**
 * Payments module (WP4): S8 orders list, S9 order detail.
 *
 * Reuse contract for other screens (WP2's user page, "To'lovlar" tab):
 *
 *   <OrdersTable fixedFilters={{ userId }} embedded />
 *
 *   - `fixedFilters.userId` pins the list (and its CSV export) to one user; the
 *     user column and the user filter are hidden and "clear filters" keeps it;
 *   - `embedded` keeps filters, sort and paging in local state (the host page's
 *     URL is never written); default page size 20 (`pageSize` overrides, 1..100);
 *   - data comes from `GET /api/admin/orders` (payments.view): a role without it
 *     sees the in-table "Ruxsat yo'q" state, so the host may also hide the tab
 *     with `useCan("payments.view")`;
 *   - a row opens `/admin/payments/:id`; the CSV button shows only with
 *     `payments.export` (step-up on the server).
 */
export { OrdersTable, ORDER_FILTER_KEYS, type OrdersTableProps } from "./OrdersTable";
export { PaymentsPage } from "./PaymentsPage";
export { OrderDetailPage } from "./OrderDetailPage";
export { ExportButton } from "./ExportButton";
export { OptionalRangeFilter } from "./OptionalRange";
export { DeltaCell, ReferenceCell, linkHref } from "./ledger-cells";
export { useCursorList, useLocalFilters, useResource, useUrlFilters, type FilterStore, type ListState, type ResourceState } from "./list-state";
export * from "./labels";
