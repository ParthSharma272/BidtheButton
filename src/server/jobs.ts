import { getDb } from "./db.ts";
import { publish } from "./bus.ts";
import { reignCounters, samplePeak, watchingNow } from "./analytics.ts";
import { getOwnershipState } from "./ownership.ts";
import { runPaymentRecovery } from "./payments/service.ts";

/**
 * Background loops, started once per process:
 *  - every 2s: broadcast reign counters if any event was recorded
 *  - every 5s: broadcast "watching now" and sample the reign's peak audience
 *  - every 30s: payment recovery + housekeeping
 */

const g = globalThis as unknown as { __button_jobs?: { started: boolean; metricsDirty: boolean; lastWatching: number } };
const state = (g.__button_jobs ??= { started: false, metricsDirty: false, lastWatching: -1 });

export function markMetricsDirty() {
  state.metricsDirty = true;
}

export function startJobs() {
  if (state.started) return;
  state.started = true;

  setInterval(() => {
    if (!state.metricsDirty) return;
    state.metricsDirty = false;
    try {
      const s = getOwnershipState();
      if (s.current_reign_id) publish({ type: "metrics", payload: { reignId: s.current_reign_id, counters: reignCounters(s.current_reign_id) } });
    } catch (e) {
      console.error("[jobs] metrics", e);
    }
  }, 2000).unref?.();

  setInterval(() => {
    try {
      const n = watchingNow();
      samplePeak(getOwnershipState().current_reign_id, n);
      if (n !== state.lastWatching) {
        state.lastWatching = n;
        publish({ type: "presence", payload: { watching: n } });
      }
    } catch (e) {
      console.error("[jobs] presence", e);
    }
  }, 5000).unref?.();

  const housekeeping = async () => {
    try {
      const db = getDb();
      const stats = await runPaymentRecovery(db);
      const now = Date.now();
      db.prepare("DELETE FROM presence WHERE last_seen < ?").run(now - 60 * 60 * 1000);
      db.prepare("DELETE FROM event_dedupe WHERE created_at < ?").run(now - 24 * 60 * 60 * 1000);
      db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(now);
      if (stats.finalized || stats.refunds || stats.voided) console.log("[jobs] payment recovery", stats);
    } catch (e) {
      console.error("[jobs] housekeeping", e);
    }
  };
  setInterval(housekeeping, 30_000).unref?.();
  void housekeeping();
}
