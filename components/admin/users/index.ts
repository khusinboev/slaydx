/**
 * Users module of the admin panel (WP2): S4 list and S5 user page.
 *
 * The user page embeds WP3's `GenerationsTable` and WP4's `OrdersTable` with
 * `fixedFilters={{ userId }}`; its "Hisob" tab uses this module's own
 * `UserLedgerTable` (users.view) because support has no finance.view.
 */
export { UsersPage, USER_FILTER_KEYS, userParamsFrom } from "./UsersPage";
export { UserDetail } from "./UserDetail";
export { UserLedgerTable } from "./UserLedgerTable";
export { UserSessionsTab } from "./UserSessionsTab";
export { BlockDialog, MessageDialog, RevokeSessionsDialog, type UserTarget } from "./UserDialogs";
export { PROFILE_LABEL, SORT_LABEL, deviceLabel } from "./labels";
