/**
 * Bootstrap the first admin owner, or break-glass reset an admin
 * (docs/admin/02-plan.md §3.2, §15.1).
 *
 * Usage (in the worker container):
 *   npm run admin:create -- --telegram-id <id> --role owner
 *   npm run admin:create -- --user-id <id> --role admin
 *
 * The person must have logged in to the site once (the user row must exist).
 * Creates the admin account as `pending`, or — when it already exists —
 * resets it: role set, 2FA cleared, recovery codes deleted, every admin
 * session revoked. Prints a one-time enrollment link (30 minutes) that only
 * opens for that user while logged in. One audit row is written with
 * `admin_id = NULL` and `meta.via = "cli"`. Safe to re-run.
 */
import { hostname } from "node:os";
import { ensureMigrated, pool } from "../lib/server/db.ts";
import { cliUpsertAdmin } from "../lib/server/admin-accounts.ts";
import { ROLES, isRole } from "../lib/server/admin-rbac.ts";

const USAGE = `Usage: npm run admin:create -- (--telegram-id <id> | --user-id <id>) --role <${ROLES.join("|")}>`;

function parseArgs(argv: string[]): { telegramId?: string; userId?: string; role?: string } {
  const out: { telegramId?: string; userId?: string; role?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === "--telegram-id" || flag === "--user-id" || flag === "--role") {
      if (!value || value.startsWith("--")) throw new Error(`${flag} needs a value`);
      if (flag === "--telegram-id") out.telegramId = value;
      else if (flag === "--user-id") out.userId = value;
      else out.role = value;
      i++;
    } else {
      throw new Error(`unknown argument: ${flag}`);
    }
  }
  return out;
}

async function main(): Promise<number> {
  let args: ReturnType<typeof parseArgs>;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    console.error(USAGE);
    return 2;
  }
  if ((args.telegramId === undefined) === (args.userId === undefined) || !isRole(args.role)) {
    console.error(USAGE);
    return 2;
  }
  await ensureMigrated();
  const res = await cliUpsertAdmin({
    telegramId: args.telegramId,
    userId: args.userId,
    role: args.role,
    host: hostname(),
  });
  console.log(res.created ? `Admin account #${res.adminId} created (pending).` : `Admin account #${res.adminId} reset to pending.`);
  if (!res.created) console.log(`2FA cleared, recovery codes deleted, ${res.revokedSessions} admin session(s) revoked.`);
  console.log("");
  console.log("Open this link while logged in to the site as that user (valid until " + res.expiresAt + "):");
  console.log(res.enrollUrl);
  return 0;
}

let code = 1;
try {
  code = await main();
} catch (e) {
  console.error("admin:create failed:", e instanceof Error ? e.message : String(e));
  code = 1;
} finally {
  await pool()
    .end()
    .catch(() => {});
}
process.exit(code);
