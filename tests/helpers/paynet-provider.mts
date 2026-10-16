/**
 * Lets a throwaway test database hold `provider = 'paynet'` rows.
 *
 * The Paynet backend widens the `payment_orders.provider` / `payment_events.provider` CHECKs in its own
 * migration (`050_paynet.sql`). The admin / wallet work is tested on a branch that may not have that
 * migration yet, so this helper applies the same widening to the TEST database when it is missing and
 * does nothing once the migration has run. It never touches anything but CHECK constraints on those two tables.
 */
type Query = (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;

const TABLES = ["payment_orders", "payment_events"] as const;

export async function allowPaynetProvider(query: Query): Promise<void> {
  for (const table of TABLES) {
    const res = await query(
      `SELECT c.conname AS name, pg_get_constraintdef(c.oid) AS def
         FROM pg_constraint c
        WHERE c.conrelid = $1::regclass AND c.contype = 'c' AND pg_get_constraintdef(c.oid) LIKE '%provider%'`,
      [table],
    );
    const stale = res.rows.filter((r) => !String(r.def).includes("paynet"));
    for (const r of stale) {
      await query(`ALTER TABLE ${table} DROP CONSTRAINT "${String(r.name)}"`);
    }
    if (stale.length > 0) {
      await query(`ALTER TABLE ${table} ADD CONSTRAINT ${table}_provider_check CHECK (provider IN ('click', 'payme', 'paynet'))`);
    }
  }
}
