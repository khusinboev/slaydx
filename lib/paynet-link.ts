/**
 * The Paynet app link with the payer and the amount filled in (owner 2026-11-01): the base is the
 * merchant link `PAYNET_APP_URL` (`https://app.paynet.uz/?m=<merchant>`); `c` carries the payer id
 * (the SlaydX ID the provider endpoint reads as `client_id`) and `a` the amount in TIYIN — the
 * parameters Paynet app links use (`?m=…&c=…&a=…`). Prefilling the id also prevents the 2026-10-31
 * incident (an amount typed into the id field). Returns null for a base that is not an https URL.
 */
export function paynetPayLink(base: string, payerId: string, amountSoum: number): string | null {
  let u: URL;
  try {
    u = new URL(base);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  u.searchParams.set("c", payerId);
  if (Number.isSafeInteger(amountSoum) && amountSoum > 0) u.searchParams.set("a", String(amountSoum * 100));
  else u.searchParams.delete("a");
  return u.toString();
}
