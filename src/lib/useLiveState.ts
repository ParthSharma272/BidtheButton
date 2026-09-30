"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PublicState } from "@/server/public-state.ts";
import type { ReignCounters } from "@/server/analytics.ts";
import { api, getClientId } from "./client.ts";

export type Connection = "connecting" | "live" | "reconnecting" | "offline";

/**
 * Live public state.
 *
 * - SSE pushes new state on every takeover; every (re)connect also refetches
 *   /api/state, so a missed message can't leave a stale owner on screen.
 * - While disconnected, `connection` is not "live" and the UI marks ownership
 *   as unconfirmed instead of presenting it as current.
 * - `clockOffset` aligns the reign timer with server time.
 */
export function useLiveState(initial: PublicState) {
  const [state, setState] = useState<PublicState>(initial);
  const [connection, setConnection] = useState<Connection>("connecting");
  const [clockOffset, setClockOffset] = useState(0);
  const versionRef = useRef(initial.version);
  const reignIdRef = useRef<string | null>(initial.reign?.id ?? null);

  const apply = useCallback((next: PublicState) => {
    // Never go backwards: a slow response must not overwrite a newer takeover.
    if (next.version < versionRef.current) return;
    versionRef.current = next.version;
    reignIdRef.current = next.reign?.id ?? null;
    setClockOffset(next.serverTime - Date.now());
    setState(next);
  }, []);

  const reconcile = useCallback(async () => {
    try {
      apply(await api<PublicState>("/api/state"));
      return true;
    } catch {
      return false;
    }
  }, [apply]);

  useEffect(() => {
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let closed = false;

    const connect = () => {
      if (closed) return;
      es = new EventSource("/api/stream");
      es.addEventListener("open", () => {
        setConnection("live");
        void reconcile();
      });
      es.addEventListener("state", (ev) => apply(JSON.parse((ev as MessageEvent).data)));
      es.addEventListener("presence", (ev) => {
        const { watching } = JSON.parse((ev as MessageEvent).data) as { watching: number };
        setState((s) => ({ ...s, watching }));
      });
      es.addEventListener("metrics", (ev) => {
        const { reignId, counters } = JSON.parse((ev as MessageEvent).data) as { reignId: string; counters: ReignCounters };
        setState((s) => (s.reign?.id === reignId ? { ...s, counters } : s));
      });
      es.addEventListener("error", () => {
        setConnection(navigator.onLine ? "reconnecting" : "offline");
        // EventSource retries by itself; if it gave up (CLOSED), rebuild it.
        if (es?.readyState === EventSource.CLOSED) {
          es.close();
          retry = setTimeout(connect, 3000);
        }
      });
    };
    connect();

    const onOnline = () => {
      setConnection("reconnecting");
      void reconcile();
    };
    const onOffline = () => setConnection("offline");
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    // Safety net in case a proxy silently drops the stream.
    const poll = setInterval(() => void reconcile(), 60_000);

    return () => {
      closed = true;
      es?.close();
      if (retry) clearTimeout(retry);
      clearInterval(poll);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [apply, reconcile]);

  // Presence heartbeat: visible pages only, one client id across tabs.
  useEffect(() => {
    const clientId = getClientId();
    const beat = () => {
      void fetch("/api/presence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, visible: document.visibilityState === "visible", reignId: reignIdRef.current }),
        keepalive: true,
      }).catch(() => {});
    };
    beat();
    const t = setInterval(beat, initial.platform.heartbeatMs);
    const onVis = () => beat();
    const onHide = () => {
      try {
        navigator.sendBeacon?.("/api/presence/leave", new Blob([JSON.stringify({ clientId })], { type: "application/json" }));
      } catch {}
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", onHide);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", onHide);
    };
  }, [initial.platform.heartbeatMs]);

  return { state, connection, clockOffset, reconcile };
}

/** A ticking "now" aligned to server time. Ticks once a second. */
export function useServerNow(offset: number) {
  const [now, setNow] = useState(() => Date.now() + offset);
  useEffect(() => {
    setNow(Date.now() + offset);
    const t = setInterval(() => setNow(Date.now() + offset), 1000);
    return () => clearInterval(t);
  }, [offset]);
  return now;
}
