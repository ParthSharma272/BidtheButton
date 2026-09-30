/**
 * Payment state machine.
 *
 *   created ──► processing ──► captured ──► settled          (ownership activated)
 *      │            │             │
 *      │            │             └──────► refund_pending ──► refunded
 *      │            │                      (stale quote, campaign no longer
 *      │            │                       eligible, amount mismatch, or
 *      │            │                       activation error)
 *      ├────────────┴──► failed            (provider declined)
 *      └────────────┴──► voided            (abandoned / expired before capture)
 *
 *   settled ──► refund_pending             (administrator-initiated refund only;
 *                                           ownership history is kept)
 *
 * Every transition is written with a compare-and-set on the current state, so a
 * delayed or duplicated provider event can never move a payment backwards.
 */

export const PAYMENT_STATES = [
  "created",
  "processing",
  "captured",
  "settled",
  "failed",
  "voided",
  "refund_pending",
  "refunded",
] as const;
export type PaymentState = (typeof PAYMENT_STATES)[number];

const TRANSITIONS: Record<PaymentState, readonly PaymentState[]> = {
  created: ["processing", "captured", "failed", "voided"],
  processing: ["captured", "failed", "voided"],
  captured: ["settled", "refund_pending"],
  settled: ["refund_pending"],
  refund_pending: ["refunded"],
  failed: [],
  voided: [],
  refunded: [],
};

export function canTransition(from: PaymentState, to: PaymentState): boolean {
  return TRANSITIONS[from].includes(to);
}

export const TERMINAL_STATES: readonly PaymentState[] = ["settled", "failed", "voided", "refunded"];

/** Human-readable status shown to the buyer. */
export function describeState(state: PaymentState, failureReason?: string | null): string {
  switch (state) {
    case "created":
      return "Waiting for payment";
    case "processing":
      return "Payment is processing";
    case "captured":
      return "Payment received — activating ownership";
    case "settled":
      return "Ownership activated";
    case "failed":
      return "Payment was declined. You were not charged.";
    case "voided":
      return "Payment was cancelled. You were not charged.";
    case "refund_pending":
      return `Ownership could not be activated${failureReason ? ` (${FAILURE_COPY[failureReason] ?? failureReason})` : ""}. A full refund is in progress.`;
    case "refunded":
      return `Ownership could not be activated${failureReason ? ` (${FAILURE_COPY[failureReason] ?? failureReason})` : ""}. Your payment has been refunded in full.`;
  }
}

export const FAILURE_COPY: Record<string, string> = {
  outbid_before_activation: "someone else took over before your payment completed",
  campaign_not_eligible: "your campaign is no longer eligible",
  amount_mismatch: "the amount received did not match your quote",
  activation_error: "an internal error occurred",
  admin_refund: "refunded by an administrator",
};
