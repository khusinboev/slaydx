/**
 * Client side of the public-offer gate (D6). The server answers 403 `offer_required` to a generation
 * submit or a payment order when the user has not accepted the current offer. `lib/api-client.ts request`
 * catches that ONCE for every caller: it asks this module to show the acceptance dialog
 * (`components/overlays/OfferDialog.tsx`, mounted in `Providers`), and when the user accepts it retries the
 * very same request. A dismissed dialog rethrows the original error.
 */

export const OFFER_REQUIRED_CODE = "offer_required";

/** Shows the dialog; resolves `true` once the user accepted (the server recorded it), `false` when dismissed. */
export type OfferAsker = () => Promise<boolean>;

let asker: OfferAsker | null = null;
let pending: Promise<boolean> | null = null;

/** The mounted dialog host registers itself here; returns the unregister function. */
export function setOfferAsker(fn: OfferAsker | null): () => void {
  asker = fn;
  return () => {
    if (asker === fn) asker = null;
  };
}

/**
 * Asks the user to accept the offer. Parallel requests that were all refused share ONE dialog. With no host
 * mounted (a test, a page without providers) resolves `false`, so the caller shows the server's message.
 */
export function askOffer(): Promise<boolean> {
  if (!asker) return Promise.resolve(false);
  pending ??= asker().finally(() => {
    pending = null;
  });
  return pending;
}

export function isOfferRequired(status: number, data: Record<string, unknown>): boolean {
  return status === 403 && data.code === OFFER_REQUIRED_CODE;
}
