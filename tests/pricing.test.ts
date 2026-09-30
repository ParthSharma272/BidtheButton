import { describe, expect, it } from "vitest";
import { minimumNextPurchasePaise, parseRupeesToPaise, priceBreakdown, ctr, cpmPaise } from "../src/server/pricing.ts";

describe("pricing", () => {
  it("first ownership costs ₹10", () => {
    expect(minimumNextPurchasePaise(0)).toBe(1000);
  });
  it("₹1,000 → ₹1,100 and ₹1,500 → ₹1,650", () => {
    expect(minimumNextPurchasePaise(100_000)).toBe(110_000);
    expect(minimumNextPurchasePaise(150_000)).toBe(165_000);
  });
  it("always at least ₹1 more, rounded up to a whole rupee", () => {
    expect(minimumNextPurchasePaise(1000)).toBe(1100); // ₹10 → ₹11
    expect(minimumNextPurchasePaise(500)).toBe(600); // ₹5 → ₹6 (₹1 floor beats 10%)
    expect(minimumNextPurchasePaise(1_234_500)).toBe(1_358_000); // ₹12,345 ×1.1 = 13,579.5 → 13,580
  });
  it("adds tax on top in integer paise", () => {
    const b = priceBreakdown(242_000);
    expect(b.taxPaise).toBe(43_560);
    expect(b.totalPaise).toBe(285_560);
    expect(Number.isInteger(b.totalPaise)).toBe(true);
  });
  it("parses rupee input strictly", () => {
    expect(parseRupeesToPaise("₹1,100")).toBe(110_000);
    expect(parseRupeesToPaise("12.5")).toBe(1250);
    expect(parseRupeesToPaise("-5")).toBeNull();
    expect(parseRupeesToPaise("1e3")).toBeNull();
    expect(parseRupeesToPaise("abc")).toBeNull();
  });
  it("financial ratios are zero-safe", () => {
    expect(ctr(0, 0)).toEqual({ rate: null, denominator: 0 });
    expect(cpmPaise(1000, 0)).toBeNull();
  });
});
