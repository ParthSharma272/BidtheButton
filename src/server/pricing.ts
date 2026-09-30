import { config } from "./config.ts";

/**
 * All money is integer paise. No floating point ever touches a stored amount.
 */

const PAISE_PER_RUPEE = 100;

/** Rounds a paise amount UP to the next whole rupee. */
export function ceilToWholeRupee(paise: number): number {
  return Math.ceil(paise / PAISE_PER_RUPEE) * PAISE_PER_RUPEE;
}

/**
 * minimum_next_purchase = max(previous + ₹1, ceil(previous × 1.10))
 *
 * The percentage leg is rounded up to the next whole rupee, matching the
 * displayed price. When nobody has owned the button yet, the first price is a
 * flat configurable amount.
 */
export function minimumNextPurchasePaise(previousPaise: number): number {
  if (previousPaise <= 0) return config.firstPricePaise;

  const absoluteLeg = previousPaise + config.minIncreaseAbsolutePaise;

  // previous × (1 + bps/10000), computed with integers, rounded up.
  const scaled = previousPaise * (10_000 + config.minIncreaseBps);
  const percentageLeg = ceilToWholeRupee(Math.ceil(scaled / 10_000));

  return Math.max(absoluteLeg, percentageLeg);
}

export interface PriceBreakdown {
  /** The ownership purchase amount. This is what the next minimum is based on. */
  amountPaise: number;
  feePaise: number;
  taxPaise: number;
  /** What the buyer's card is actually charged. */
  totalPaise: number;
  currency: "INR";
}

/**
 * Fees and tax are added ON TOP of the purchase amount and are shown before
 * confirmation. The next owner's minimum is derived from `amountPaise` only —
 * buyers never compete on each other's tax.
 */
export function priceBreakdown(amountPaise: number): PriceBreakdown {
  if (!Number.isInteger(amountPaise) || amountPaise <= 0) {
    throw new Error("amountPaise must be a positive integer");
  }
  const feePaise = Math.round((amountPaise * config.feeBps) / 10_000);
  const taxPaise = Math.round(((amountPaise + feePaise) * config.taxBps) / 10_000);
  return {
    amountPaise,
    feePaise,
    taxPaise,
    totalPaise: amountPaise + feePaise + taxPaise,
    currency: "INR",
  };
}

/** Human formatting. Uses the buyer-facing grouping for INR. */
export function formatPaise(paise: number, opts: { symbol?: boolean } = {}): string {
  const symbol = opts.symbol ?? true;
  const rupees = paise / PAISE_PER_RUPEE;
  const hasPaise = paise % PAISE_PER_RUPEE !== 0;
  const body = new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: hasPaise ? 2 : 0,
    maximumFractionDigits: hasPaise ? 2 : 0,
  }).format(rupees);
  return symbol ? `₹${body}` : body;
}

/** Parses a rupee string from a form into integer paise. Rejects junk. */
export function parseRupeesToPaise(input: string | number): number | null {
  const raw = String(input).trim().replace(/[₹,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) return null;
  const paise = Math.round(Number(raw) * PAISE_PER_RUPEE);
  if (!Number.isSafeInteger(paise) || paise <= 0) return null;
  return paise;
}

/** Cost per thousand campaign views, zero-safe. */
export function cpmPaise(amountPaise: number, views: number): number | null {
  if (views <= 0) return null;
  return Math.round((amountPaise / views) * 1000);
}

/** Cost per outbound click, zero-safe. */
export function cpcPaise(amountPaise: number, clicks: number): number | null {
  if (clicks <= 0) return null;
  return Math.round(amountPaise / clicks);
}

/** CTR as a fraction, plus its denominator so the UI can show it honestly. */
export function ctr(outboundClicks: number, experienceViews: number): { rate: number | null; denominator: number } {
  if (experienceViews <= 0) return { rate: null, denominator: 0 };
  return { rate: outboundClicks / experienceViews, denominator: experienceViews };
}
