/**
 * Fixed-window rate limiter held in process memory. Adequate for one instance;
 * multi-instance deployments should back this with Redis.
 */
const g = globalThis as unknown as { __button_rl?: Map<string, { count: number; reset: number }> };
const buckets = (g.__button_rl ??= new Map());

export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const b = buckets.get(key);
  if (!b || b.reset < now) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    if (buckets.size > 50_000) {
      for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k);
    }
    return true;
  }
  b.count++;
  return b.count <= limit;
}
