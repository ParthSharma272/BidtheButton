/**
 * In-process pub/sub used to fan server events out to SSE connections.
 *
 * This is correct for a single Node process. Running several instances needs a
 * shared channel (Redis pub/sub, Postgres LISTEN/NOTIFY) behind this same
 * interface; clients already reconcile with /api/state after every reconnect,
 * so a missed message can never leave a visitor on stale ownership.
 */

export type BusMessage =
  | { type: "ownership"; payload: unknown }
  | { type: "presence"; payload: { watching: number } }
  | { type: "metrics"; payload: unknown };

type Listener = (msg: BusMessage) => void;

const g = globalThis as unknown as { __button_bus?: Set<Listener> };
const listeners: Set<Listener> = (g.__button_bus ??= new Set());

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function publish(msg: BusMessage): void {
  for (const fn of listeners) {
    try {
      fn(msg);
    } catch {
      // A broken connection must never break the publisher.
    }
  }
}

export const listenerCount = () => listeners.size;
