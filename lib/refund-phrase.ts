/**
 * The one sentence every failed job says about the money, on the server (`generations.error`) and in the Studio's
 * fallbacks. Future tense on purpose: the worker stores the error first and refunds right after (`failAndCleanup`), and a
 * refund that fails is retried by housekeeping (`refundUnrefundedFailed`), so «qaytarildi» could be read before it is true.
 */
export const REFUND_PHRASE = "Pul balansingizga qaytariladi";
