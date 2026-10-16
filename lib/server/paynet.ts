import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { forwardRaw, MAX_BODY_BYTES, readTextCapped, type ForwardResult } from "./click-forward";
import { ensureMigrated, queryOne } from "./db";
import { env, paynetConfigured } from "./env";
import { log } from "./log";
import { recordPaymentEvent } from "./payment-events";
import { createPaidPaynetOrder, findPaynetOrder, MAX_TOPUP_SOUM, MIN_TOPUP_SOUM, paynetStatement } from "./payments";
import { clientIp } from "./ratelimit";

/**
 * Paynet (UZPAYNET) provider endpoint — JSON-RPC 2.0, we are the «Поставщик» (docs/payments/PAYNET.md is the spec).
 *
 * One request = read the body ONCE (64 KB cap) → parse ONCE → Bandlik.uz forward decision (BEFORE our auth: Bandlik
 * authenticates with its own credentials) → IP allow-list (403 / 601) → HTTP Basic (401 / 412) → method. Every call that
 * passed auth is written to `payment_events` (params redacted, response code) and every call gets one log line
 * (method, serviceId, ms, code) — the Authorization header and the password are never logged or stored.
 *
 * Money: PerformTransaction inserts the order and credits it in ONE transaction (`createPaidPaynetOrder`); a repeated or
 * concurrent `transactionId` is a 201 and credits nothing. CancelTransaction never cancels (owner: payments are final).
 */

// ───────────────────────────── protocol constants

export const PAYNET_ERR = {
  PARSE: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603,
  NOT_POST: -32300,
  NOT_REFUNDABLE: 77,
  TXN_EXISTS: 201,
  TXN_NOT_FOUND: 203,
  CLIENT_NOT_FOUND: 302,
  SERVICE_NOT_FOUND: 305,
  BAD_CLIENT_ID: 401,
  MISSING_FIELD: 411,
  AUTH: 412,
  BAD_AMOUNT: 413,
  BAD_DATE: 414,
  AMOUNT_TOO_LARGE: 415,
  PAYER_BLOCKED: 501,
  ACCESS_DENIED: 601,
} as const;

const MESSAGES: Record<number, string> = {
  [PAYNET_ERR.PARSE]: "Ошибка разбора JSON",
  [PAYNET_ERR.INVALID_REQUEST]: "Неверный JSON-RPC запрос",
  [PAYNET_ERR.METHOD_NOT_FOUND]: "Запрашиваемый метод не найден",
  [PAYNET_ERR.INVALID_PARAMS]: "Отсутствуют или неверны обязательные параметры",
  [PAYNET_ERR.INTERNAL]: "Системная ошибка",
  [PAYNET_ERR.NOT_POST]: "Метод запроса не POST",
  [PAYNET_ERR.NOT_REFUNDABLE]: "Платежи не подлежат отмене (payments are non-refundable)",
  [PAYNET_ERR.TXN_EXISTS]: "Транзакция уже существует",
  [PAYNET_ERR.TXN_NOT_FOUND]: "Транзакция не найдена",
  [PAYNET_ERR.CLIENT_NOT_FOUND]: "Клиент не найден",
  [PAYNET_ERR.SERVICE_NOT_FOUND]: "Услуга не найдена",
  [PAYNET_ERR.BAD_CLIENT_ID]: "Неверный формат идентификатора клиента",
  [PAYNET_ERR.MISSING_FIELD]: "Не задан один или несколько обязательных параметров",
  [PAYNET_ERR.AUTH]: "Неверный логин или пароль",
  [PAYNET_ERR.BAD_AMOUNT]: "Неверная сумма",
  [PAYNET_ERR.BAD_DATE]: "Неверный формат даты и времени",
  [PAYNET_ERR.AMOUNT_TOO_LARGE]: "Сумма превышает максимальный лимит",
  [PAYNET_ERR.PAYER_BLOCKED]: "Транзакции запрещены для данного плательщика",
  [PAYNET_ERR.ACCESS_DENIED]: "Доступ запрещен",
};

/** GetStatement row cap. */
export const STATEMENT_MAX_ROWS = 50_000;
/** Tashkent = GMT+5, no DST. */
const TZ_OFFSET_MS = 5 * 3_600_000;
const TIEN_PER_SOUM = 100;

type RpcId = string | number | null;
type Body = Record<string, unknown>;

/** A Paynet error answer; `orderId` / `providerTxn` (when known) go to the `payment_events` row. */
class RpcError extends Error {
  constructor(
    readonly code: number,
    readonly ctx: { detail?: string; orderId?: string | null; providerTxn?: string | null } = {},
  ) {
    super(MESSAGES[code] ?? "Ошибка");
  }
}

// ───────────────────────────── pure helpers (exported for tests)

export function rpcResult(id: RpcId, result: unknown): Body {
  return { jsonrpc: "2.0", id, result };
}

export function rpcError(id: RpcId, code: number, message = MESSAGES[code] ?? "Ошибка"): Body {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

/** `YYYY-MM-DD HH:mm:ss` in Tashkent time (GMT+5). */
export function formatTashkent(ms: number): string {
  return new Date(ms + TZ_OFFSET_MS).toISOString().slice(0, 19).replace("T", " ");
}

/** Strict `YYYY-MM-DD HH:mm:ss` (Tashkent time) → epoch ms; null when malformed or not a real date/time. */
export function parseTashkent(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(v);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number) as [number, number, number, number, number, number];
  if (mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || s > 59) return null;
  const utc = Date.UTC(y, mo - 1, d, h, mi, s);
  // Rejects 2026-02-30 and the like (Date.UTC rolls them over).
  if (new Date(utc).getUTCDate() !== d || new Date(utc).getUTCMonth() !== mo - 1) return null;
  return utc - TZ_OFFSET_MS;
}

/** «Adham B.»: the first token + the initial of the second; one token as is; nothing → «SlaydX». */
export function maskName(name: unknown): string {
  const parts = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "SlaydX";
  if (parts.length === 1) return parts[0]!;
  const initial = Array.from(parts[1]!)[0]!.toLocaleUpperCase();
  return `${parts[0]} ${initial}.`;
}

/** An integer serviceId (number or digit string), else null. */
export function toServiceId(v: unknown): number | null {
  if (typeof v === "number") return Number.isSafeInteger(v) ? v : null;
  if (typeof v === "string" && /^\d{1,15}$/.test(v)) return Number(v);
  return null;
}

/** Paynet's `transactionId` (positive safe integer; a digit string is accepted) → canonical digits, else null. */
export function toTransactionId(v: unknown): string | null {
  let n: number;
  if (typeof v === "number") n = v;
  else if (typeof v === "string" && /^\d{1,16}$/.test(v)) n = Number(v);
  else return null;
  return Number.isSafeInteger(n) && n > 0 ? String(n) : null;
}

/**
 * Bandlik.uz (vakant3) owns this request: its serviceId is in PAYNET_VAKANT_SERVICE_IDS and NOT in ours (ours win on a config overlap).
 * Routing is by serviceId ONLY: Check / Cancel / GetStatement carry no payer field, so a payer-prefix rule would split one payment's
 * follow-up calls between two systems. Bandlik therefore needs its own Paynet serviceId. Decided on the SAME parsed object the handler
 * would use.
 */
export function isVakantPaynet(body: unknown, vakantServiceIds: readonly number[], ownServiceIds: readonly number[] = []): boolean {
  if (!isPlainObject(body) || !isPlainObject(body.params)) return false;
  const sid = toServiceId(body.params.serviceId);
  return sid !== null && vakantServiceIds.includes(sid) && !ownServiceIds.includes(sid);
}

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest();

/** HTTP Basic against the configured login/password, constant time (sha256 digests); false when not configured. */
export function paynetBasicAuthorized(header: string | null | undefined, username: string, password: string): boolean {
  if (!username || !password) return false;
  const [scheme, encoded, extra] = String(header ?? "").trim().split(/\s+/);
  if (scheme?.toLowerCase() !== "basic" || !encoded || extra !== undefined) return false;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return false;
  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  const sep = decoded.indexOf(":");
  if (sep < 0) return false;
  const userOk = timingSafeEqual(sha256(decoded.slice(0, sep)), sha256(username));
  const passOk = timingSafeEqual(sha256(decoded.slice(sep + 1)), sha256(password));
  return userOk && passOk;
}

function ipv4ToInt(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const o = m.slice(1).map(Number);
  if (o.some((x) => x > 255)) return null;
  return ((o[0]! << 24) >>> 0) + (o[1]! << 16) + (o[2]! << 8) + o[3]!;
}

/** IPv4 / IPv4-CIDR allow-list match (an IPv4-mapped IPv6 client address counts as IPv4); other entries match exactly. */
export function ipAllowed(ip: string, list: readonly string[]): boolean {
  const client = ip.trim().toLowerCase().replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/, "");
  const c4 = ipv4ToInt(client);
  for (const raw of list) {
    const entry = raw.trim().toLowerCase();
    if (!entry) continue;
    const slash = entry.indexOf("/");
    if (slash < 0) {
      if (entry === client) return true;
      continue;
    }
    const net = ipv4ToInt(entry.slice(0, slash));
    const bitsText = entry.slice(slash + 1);
    if (net === null || c4 === null || !/^\d{1,2}$/.test(bitsText) || Number(bitsText) > 32) continue;
    const bits = Number(bitsText);
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    if (((c4 & mask) >>> 0) === ((net & mask) >>> 0)) return true;
  }
  return false;
}

function isPlainObject(v: unknown): v is Body {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

// ───────────────────────────── envelope

type Envelope = { id: RpcId; method: string; params: Body };
type Parsed =
  | { ok: true; rpc: Envelope; json: unknown }
  | { ok: false; code: number; id: RpcId; json: unknown };

function idOf(v: unknown): RpcId {
  return typeof v === "string" || (typeof v === "number" && Number.isFinite(v)) ? v : null;
}

/** ONE parse of the raw body: a single JSON-RPC 2.0 object with string `method`, string|number `id`, object `params`. */
export function parseEnvelope(raw: string | null): Parsed {
  if (raw === null) return { ok: false, code: PAYNET_ERR.INVALID_REQUEST, id: null, json: undefined };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, code: PAYNET_ERR.PARSE, id: null, json: undefined };
  }
  if (!isPlainObject(json)) return { ok: false, code: PAYNET_ERR.INVALID_REQUEST, id: null, json };
  const id = idOf(json.id);
  if (json.jsonrpc !== "2.0" || typeof json.method !== "string" || id === null || !isPlainObject(json.params)) {
    return { ok: false, code: PAYNET_ERR.INVALID_REQUEST, id, json };
  }
  return { ok: true, rpc: { id, method: json.method, params: json.params }, json };
}

// ───────────────────────────── methods

type MethodOut = { result: unknown; orderId?: string | null; providerTxn?: string | null };

function requireParams(p: Body, names: readonly string[]): void {
  for (const n of names) {
    if (p[n] === undefined || p[n] === null) throw new RpcError(PAYNET_ERR.INVALID_PARAMS, { detail: `missing ${n}` });
  }
}

function requireOurService(p: Body): number {
  const sid = toServiceId(p.serviceId);
  if (sid === null || !env.paynet.serviceIds.includes(sid)) throw new RpcError(PAYNET_ERR.SERVICE_NOT_FOUND);
  return sid;
}

function requireTransactionId(p: Body): string {
  const t = toTransactionId(p.transactionId);
  if (t === null) throw new RpcError(PAYNET_ERR.INVALID_PARAMS, { detail: "transactionId" });
  return t;
}

function requireTimestamp(v: unknown): number {
  const ms = parseTashkent(v);
  if (ms === null) throw new RpcError(PAYNET_ERR.BAD_DATE);
  return ms;
}

type Payer = { id: string; name: string; balance: number };

/** `fields[PAYNET_CLIENT_PARAM]` → the SlaydX user (411 absent, 401 malformed, 302 unknown, 501 blocked). */
async function requirePayer(p: Body): Promise<Payer> {
  const fields = p.fields;
  if (!isPlainObject(fields)) throw new RpcError(PAYNET_ERR.INVALID_PARAMS, { detail: "fields" });
  const v = fields[env.paynet.clientParam];
  if (v === undefined || v === null || v === "") throw new RpcError(PAYNET_ERR.MISSING_FIELD);
  const text = typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? String(v) : v;
  if (typeof text !== "string" || !/^\d{1,18}$/.test(text)) throw new RpcError(PAYNET_ERR.BAD_CLIENT_ID);
  // 18 digits always fit a bigint; `0000000000` is user 0, which never exists.
  const row = await queryOne<{ id: string; name: string; balance: string; is_blocked: boolean }>(
    `SELECT id, name, balance, is_blocked FROM users WHERE id = $1::bigint`,
    [text],
  );
  if (!row) throw new RpcError(PAYNET_ERR.CLIENT_NOT_FOUND);
  if (row.is_blocked) throw new RpcError(PAYNET_ERR.PAYER_BLOCKED);
  return { id: String(row.id), name: row.name, balance: Number(row.balance) };
}

/** Amount in tiyin → whole so'm within the top-up limits (413 malformed / below min / not whole so'm, 415 above max). */
function requireAmountSoum(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d{1,15}$/.test(v) ? Number(v) : NaN;
  if (!Number.isSafeInteger(n) || n <= 0 || n % TIEN_PER_SOUM !== 0) throw new RpcError(PAYNET_ERR.BAD_AMOUNT);
  const soum = n / TIEN_PER_SOUM;
  if (soum < MIN_TOPUP_SOUM) throw new RpcError(PAYNET_ERR.BAD_AMOUNT, { detail: "below minimum" });
  if (soum > MAX_TOPUP_SOUM) throw new RpcError(PAYNET_ERR.AMOUNT_TOO_LARGE);
  return soum;
}

async function getInformation(p: Body): Promise<MethodOut> {
  requireParams(p, ["serviceId", "fields"]);
  requireOurService(p);
  const payer = await requirePayer(p);
  return { result: { status: "0", timestamp: formatTashkent(Date.now()), fields: { name: maskName(payer.name), balance: payer.balance } } };
}

async function performTransaction(p: Body): Promise<MethodOut> {
  requireParams(p, ["amount", "serviceId", "transactionId", "fields"]);
  requireOurService(p);
  const transactionId = requireTransactionId(p);
  const amountSoum = requireAmountSoum(p.amount);
  const payer = await requirePayer(p);
  const out = await createPaidPaynetOrder({ userId: payer.id, amountSoum, transactionId });
  if (out.status === "duplicate") {
    const existing = await findPaynetOrder(transactionId);
    throw new RpcError(PAYNET_ERR.TXN_EXISTS, { orderId: existing?.order.id ?? null, providerTxn: transactionId });
  }
  return {
    result: {
      timestamp: formatTashkent(out.order.performTime),
      providerTrnId: out.providerTrnId,
      fields: { [env.paynet.clientParam]: payer.id, balance: out.balance },
    },
    orderId: out.order.id,
    providerTxn: transactionId,
  };
}

async function checkTransaction(p: Body): Promise<MethodOut> {
  requireParams(p, ["serviceId", "transactionId", "timestamp"]);
  requireOurService(p);
  const transactionId = requireTransactionId(p);
  requireTimestamp(p.timestamp);
  const found = await findPaynetOrder(transactionId);
  if (!found) {
    return { result: { transactionState: 3, providerTrnId: 0, timestamp: formatTashkent(Date.now()) }, providerTxn: transactionId };
  }
  const { order, providerTrnId } = found;
  const state = order.state === "paid" ? 1 : order.state === "cancelled" ? 2 : 3;
  const at = order.state === "cancelled" ? order.cancelTime : order.performTime || order.createTime;
  return { result: { transactionState: state, providerTrnId, timestamp: formatTashkent(at || Date.now()) }, orderId: order.id, providerTxn: transactionId };
}

async function cancelTransaction(p: Body): Promise<MethodOut> {
  requireParams(p, ["serviceId", "transactionId", "timestamp"]);
  requireOurService(p);
  const transactionId = requireTransactionId(p);
  requireTimestamp(p.timestamp);
  const found = await findPaynetOrder(transactionId);
  // Owner decision: a payment to SlaydX is final. Nothing is ever changed here.
  throw new RpcError(found ? PAYNET_ERR.NOT_REFUNDABLE : PAYNET_ERR.TXN_NOT_FOUND, { orderId: found?.order.id ?? null, providerTxn: transactionId });
}

async function getStatement(p: Body): Promise<MethodOut> {
  requireParams(p, ["serviceId", "dateFrom", "dateTo"]);
  requireOurService(p);
  const from = requireTimestamp(p.dateFrom);
  const to = requireTimestamp(p.dateTo);
  if (from > to) throw new RpcError(PAYNET_ERR.BAD_DATE, { detail: "dateFrom > dateTo" });
  // Both ends inclusive at second resolution: everything up to dateTo + 999 ms.
  const rows = await paynetStatement(from, to + 1_000, STATEMENT_MAX_ROWS);
  if (rows.length >= STATEMENT_MAX_ROWS) log("warn", "[paynet] GetStatement hit the row cap", { rows: rows.length });
  return {
    result: {
      statements: rows.map((r) => ({
        amount: r.amountSoum * TIEN_PER_SOUM,
        transactionId: Number(r.transactionId),
        providerTrnId: r.providerTrnId,
        timestamp: formatTashkent(r.performTime),
      })),
    },
  };
}

const METHODS: Record<string, (p: Body) => Promise<MethodOut>> = {
  GetInformation: getInformation,
  PerformTransaction: performTransaction,
  CheckTransaction: checkTransaction,
  CancelTransaction: cancelTransaction,
  GetStatement: getStatement,
};

// ───────────────────────────── HTTP

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

function json(body: Body, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...headers } });
}

let ipListOffWarned = false;

/** Any non-POST HTTP method: JSON-RPC -32300. */
export function paynetNotPost(method: string): Response {
  log("info", "[paynet] call", { method: `HTTP ${method}`.slice(0, 64), code: PAYNET_ERR.NOT_POST, ms: 0 });
  return json(rpcError(null, PAYNET_ERR.NOT_POST));
}

/** The whole POST: forward decision → IP → auth → method. Never throws. */
export async function handlePaynetPost(req: Request): Promise<Response> {
  const started = Date.now();
  let method: string | null = null;
  let serviceId: number | null = null;
  let code = 0;
  let detail: string | null = null;
  let forwarded: ForwardResult | null = null;
  // The one log line per call. Never the Authorization header, the password or the body.
  const finish = (res: Response): Response => {
    log(code === 0 || code === PAYNET_ERR.TXN_EXISTS ? "info" : "warn", "[paynet] call", {
      method: method?.slice(0, 64) ?? null,
      serviceId,
      code,
      http: res.status,
      ms: Date.now() - started,
      ...(detail ? { detail } : {}),
      ...(forwarded ? { forwarded: forwarded.ok ? "ok" : forwarded.reason } : {}),
    });
    return res;
  };

  const raw = await readTextCapped(req.body, MAX_BODY_BYTES);
  const parsed = parseEnvelope(raw);
  const body = parsed.json;
  if (isPlainObject(body)) {
    method = typeof body.method === "string" ? body.method : null;
    serviceId = isPlainObject(body.params) ? toServiceId(body.params.serviceId) : null;
  }
  const id = parsed.ok ? parsed.rpc.id : parsed.id;

  // 1. IP allow-list — for EVERY call, including the ones forwarded to Bandlik (SlaydX is not an open relay).
  const allowed = env.paynet.allowedIps;
  if (allowed.length) {
    if (!ipAllowed(clientIp(req), allowed)) {
      code = PAYNET_ERR.ACCESS_DENIED;
      return finish(json(rpcError(null, PAYNET_ERR.ACCESS_DENIED), 403));
    }
  } else if (!ipListOffWarned) {
    ipListOffWarned = true;
    log("warn", "[paynet] PAYNET_ALLOWED_IPS is empty: the IP allow-list is OFF");
  }

  // 2. Bandlik.uz — after the IP allow-list (Paynet's ranges are the same for every project; only the Basic credentials differ) and before
  //    our own auth (Bandlik has its own credentials); nothing is written to SlaydX tables.
  if (raw !== null && isVakantPaynet(body, env.paynet.vakantServiceIds, env.paynet.serviceIds)) {
    const headers: Record<string, string> = {};
    const ct = req.headers.get("content-type");
    if (ct) headers["content-type"] = ct;
    const auth = req.headers.get("authorization");
    if (auth) headers.authorization = auth;
    forwarded = await forwardRaw({
      channel: "paynet",
      url: env.paynet.vakantForwardUrl,
      raw,
      headers,
      logFields: { method: method?.slice(0, 64) ?? null, serviceId },
    });
    if (forwarded.ok) return finish(new Response(forwarded.text, { status: 200, headers: JSON_HEADERS }));
    code = PAYNET_ERR.INTERNAL;
    return finish(json(rpcError(id, PAYNET_ERR.INTERNAL, "forward_failed")));
  }

  // 3. HTTP Basic (not configured → every call is a 401).
  const authorized =
    paynetConfigured() && paynetBasicAuthorized(req.headers.get("authorization"), env.paynet.username, env.paynet.password);
  if (!authorized) {
    code = PAYNET_ERR.AUTH;
    return finish(json(rpcError(null, PAYNET_ERR.AUTH), 401, { "www-authenticate": 'Basic realm="paynet"' }));
  }

  // 4. Envelope and method.
  let orderId: string | null = null;
  let providerTxn: string | null = null;
  let reply: Body;
  if (!parsed.ok) {
    code = parsed.code;
    reply = rpcError(id, code);
  } else if (!Object.hasOwn(METHODS, parsed.rpc.method)) {
    code = PAYNET_ERR.METHOD_NOT_FOUND;
    reply = rpcError(id, code);
  } else {
    try {
      await ensureMigrated();
      const out = await METHODS[parsed.rpc.method]!(parsed.rpc.params);
      orderId = out.orderId ?? null;
      providerTxn = out.providerTxn ?? null;
      reply = rpcResult(id, out.result);
    } catch (e) {
      if (e instanceof RpcError) {
        code = e.code;
        orderId = e.ctx.orderId ?? null;
        providerTxn = e.ctx.providerTxn ?? null;
        detail = e.ctx.detail ?? null;
      } else {
        code = PAYNET_ERR.INTERNAL;
        log("error", "[paynet] internal error", { method, serviceId, err: e });
      }
      reply = rpcError(id, code);
    }
  }

  await recordPaymentEvent({
    provider: "paynet",
    method: method ?? "?",
    orderId,
    providerTxn: providerTxn ?? (parsed.ok ? toTransactionId(parsed.rpc.params.transactionId) : null),
    payload: parsed.ok ? parsed.rpc.params : isPlainObject(body) ? body : { raw: raw === null ? "[too large]" : raw.slice(0, 2_000) },
    responseCode: code,
  });
  return finish(json(reply));
}
