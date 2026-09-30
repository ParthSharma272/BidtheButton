"use client";

import type { CSSProperties } from "react";

/**
 * Mechanical counter. Each digit is a strip of 0–9 that rolls to its value, so
 * a price or count visibly turns over when real data changes. Place values are
 * keyed from the right, so "₹999" → "₹1,099" rolls the existing columns and
 * adds new ones. Reduced motion disables the roll via the global rule.
 */
export function Roll({ value, className = "" }: { value: string; className?: string }) {
  const chars = value.split("");
  return (
    <span className={`roll ${className}`}>
      <span className="sr-only">{value}</span>
      <span className="roll-track" aria-hidden="true">
        {chars.map((c, i) => {
          const place = chars.length - i;
          if (!/\d/.test(c))
            return (
              <span key={`s${place}`} className="roll-static">
                {c}
              </span>
            );
          return (
            <span key={`d${place}`} className="roll-col" style={{ "--d": Number(c), "--k": place } as CSSProperties}>
              <span className="roll-strip">
                {DIGITS.map((d) => (
                  <span key={d}>{d}</span>
                ))}
              </span>
            </span>
          );
        })}
      </span>
    </span>
  );
}

const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
