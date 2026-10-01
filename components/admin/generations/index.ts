/**
 * Generations (jobs) module of the admin panel: S6 list and S7 detail.
 *
 * Reuse contract (WP2 user detail, "Generatsiyalar" tab):
 *
 *   // server page: tool options come from the server registry, not lib/tools.ts in the client
 *   import { adminToolOptions } from "@/lib/server/admin-generations";
 *   <UserDetail tools={adminToolOptions()} ... />
 *
 *   // client component
 *   <GenerationsTable tools={tools} embedded fixedFilters={{ userId }} />
 *
 * `GenerationsTableProps`:
 *   - `tools` (required): `{ value: toolId, label: title }[]` for the tool filter and column;
 *   - `fixedFilters.userId`: pins the user (digits); the user filter and column are hidden
 *     and "Filtrlarni tozalash" keeps the pin;
 *   - `embedded`: filters, sort and paging in local state; the page URL is never touched;
 *   - `pageSize` (default 50, max 100) and `caption` (accessible table name).
 * Rows open `/admin/generations/[id]`; the CSV export button shows with `jobs.export`.
 */
export { GenerationsTable, type GenerationsTableProps, type GenerationFilters } from "./GenerationsTable";
export { GenerationsPage } from "./GenerationsPage";
export { GenerationDetail } from "./GenerationDetail";
export { GenerationStatusPill, STATUS_META } from "./shared";
