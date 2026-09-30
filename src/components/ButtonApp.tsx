"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PublicState } from "@/server/public-state.ts";
import { api, loadPrefs, prefersReducedMotion, savePrefs, track, type Prefs } from "@/lib/client.ts";
import { useAccount } from "@/lib/useAccount.ts";
import { useLiveState, useServerNow, type Connection } from "@/lib/useLiveState.ts";
import { formatClock, formatCount, inr, timeAgo } from "@/shared/format.ts";
import { Stage } from "./Stage.tsx";
import { Roll } from "./Roll.tsx";
import { ExperienceOverlay, type OpenExperience } from "./ExperienceOverlay.tsx";
import { TakeoverSheet } from "./TakeoverSheet.tsx";
import { HistoryDrawer } from "./HistoryDrawer.tsx";
import { HowItWorks } from "./HowItWorks.tsx";
import { AccountDrawer, AnalyticsDrawer } from "./AccountDrawer.tsx";
import { ReportDialog, ShareDialog } from "./ReportShare.tsx";

type Panel = null | "takeover" | "history" | "how" | "account" | "analytics" | "report" | "share";

const EXPERIENCE_WORDS: Record<string, string> = {
  link: "see a link preview",
  youtube: "watch a video",
  video: "watch a video",
  image: "see a poster",
  message: "read a message",
};

export function ButtonApp({ initial }: { initial: PublicState }) {
  const { state, connection, clockOffset } = useLiveState(initial);
  const account = useAccount();
  const now = useServerNow(clockOffset);
  const [panel, setPanel] = useState<Panel>(null);
  const [exp, setExp] = useState<OpenExperience | null>(null);
  const [expNotice, setExpNotice] = useState<string | null>(null);
  const [announce, setAnnounce] = useState<{ brand: string; amount: number; ordinal: number; key: number } | null>(null);
  const [prefs, setPrefs] = useState<Prefs>({ sound: false, motion: "system" });
  const [reduced, setReduced] = useState(false);
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    const p = loadPrefs();
    setPrefs(p);
    setReduced(prefersReducedMotion(p));
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(prefersReducedMotion(loadPrefs()));
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  const updatePrefs = (p: Prefs) => {
    setPrefs(p);
    savePrefs(p);
    setReduced(prefersReducedMotion(p));
  };

  const reign = state.reign;
  const cfg = reign?.config ?? null;
  // The server-rendered state is fresh; only a dropped stream makes it unconfirmed.
  const live = connection === "live" || connection === "connecting";

  // ---------------------------------------------------------------- takeover moment
  const lastReignId = useRef(initial.reign?.id ?? null);
  useEffect(() => {
    const id = reign?.id ?? null;
    if (id === lastReignId.current) return;
    lastReignId.current = id;
    if (!reign) return;
    const brand = reign.suspended ? "A new owner" : reign.config?.brand.name ?? reign.owner.name;
    setAnnounce({ brand, amount: reign.amountPaise, ordinal: reign.ordinal, key: Date.now() });
    const t = setTimeout(() => setAnnounce(null), reduced ? 4500 : 3400);
    if (exp && exp.reignId !== id) setExpNotice(`${brand} just took over THE BUTTON. Finish here — their page will be waiting when you close this.`);
    void account.refresh();
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reign?.id]);

  // ---------------------------------------------------------------- campaign view
  const viewed = useRef(new Set<string>());
  useEffect(() => {
    if (!reign || reign.suspended || viewed.current.has(reign.id)) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      if (timer) clearTimeout(timer);
      if (document.visibilityState !== "visible") return;
      timer = setTimeout(() => {
        if (document.visibilityState === "visible" && !viewed.current.has(reign.id)) {
          viewed.current.add(reign.id);
          track("campaign_view", reign.id);
        }
      }, state.platform.minViewMs);
    };
    arm();
    document.addEventListener("visibilitychange", arm);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", arm);
    };
  }, [reign, state.platform.minViewMs]);

  // ---------------------------------------------------------------- press
  const press = useCallback(() => {
    if (!reign || !reign.config || reign.suspended) return;
    track("button_press", reign.id);
    track("experience_view", reign.id);
    setExpNotice(null);
    setExp({ reignId: reign.id, ordinal: reign.ordinal, ownerName: reign.owner.name, config: reign.config, openedAt: Date.now() });
  }, [reign]);

  const closeExperience = useCallback(() => {
    setExp((cur) => {
      if (cur) track("experience_time", cur.reignId, Date.now() - cur.openedAt);
      return null;
    });
    setExpNotice(null);
  }, []);

  // Counters pulse briefly when they change (real events only).
  const prevCounters = useRef(state.counters);
  useEffect(() => {
    if (prevCounters.current && state.counters && JSON.stringify(prevCounters.current) !== JSON.stringify(state.counters)) {
      setPulse(true);
      const t = setTimeout(() => setPulse(false), 600);
      prevCounters.current = state.counters;
      return () => clearTimeout(t);
    }
    prevCounters.current = state.counters;
  }, [state.counters]);

  const rival = async () => {
    try {
      await api("/api/demo/rival", { json: {} });
      setPanel(null);
    } catch (e) {
      alertLive((e as Error).message);
    }
  };

  const isMine = !!(account.user && reign && reign.owner.id === account.user.id);
  const unread = account.notifications.filter((n) => !n.read).length;

  return (
    <div className={`app ${reduced ? "reduce-motion" : ""} ${live ? "" : "is-unconfirmed"} ${state.platform.demoMode ? "has-ribbon" : ""}`}>
      <a className="skip-link" href="#main-button-area">
        Skip to the button
      </a>

      {state.platform.demoMode && (
        <div className="demo-ribbon" role="note">
          <strong>Demo mode</strong> Test payments only. No real money moves.
        </div>
      )}

      {/* Owner environment */}
      <main className="stage-wrap" aria-label="Current campaign">
        <div className="stage-transition" key={reign?.id ?? "none"}>
          <Stage
            config={cfg}
            suspended={reign?.suspended}
            mode="live"
            reducedMotion={reduced}
            onPress={press}
            emptyState={
              <>
                <p className="neutral-kicker">Unclaimed</p>
                <h1 className="stage-headline">Nobody owns THE BUTTON yet.</h1>
                <p className="stage-subhead">Be the first. It's {inr(state.minNextPaise)} to make this whole page yours — until someone pays more.</p>
              </>
            }
            underButton={
              cfg && !reign?.suspended ? (
                <p className="press-hint" id="press-hint">
                  <span className="press-hint-free">Free</span>
                  Press to {EXPERIENCE_WORDS[cfg.experience.type]} from {cfg.brand.name}
                </p>
              ) : null
            }
          />
        </div>
      </main>

      {/* ---------------- Platform chrome. Owners cannot style or cover anything below. ---------------- */}
      <header className="topbar platform">
        <div className="plate plate-brand">
          <span className="logo-dome" aria-hidden="true" />
          <span className="wordmark">THE BUTTON</span>
          <span className="plate-rule" aria-hidden="true" />
          <LiveIndicator watching={state.watching} connection={connection} />
        </div>
        <nav className="plate plate-nav" aria-label="Site">
          <button className="nav-btn" onClick={() => setPanel("history")}>
            History
          </button>
          <button className="nav-btn" onClick={() => setPanel("how")} aria-label="How it works">
            <span className="long-label">How it works</span>
            <span className="short-label" aria-hidden="true">
              How
            </span>
          </button>
          <button className="nav-btn nav-account" onClick={() => setPanel("account")} aria-label={account.user ? `Account: ${account.user.display_name}` : "Sign in"}>
            {account.user ? <span className="avatar">{account.user.display_name.slice(0, 1).toUpperCase()}</span> : "Sign in"}
            {unread > 0 && (
              <span className="badge" aria-label={`${unread} unread`}>
                {unread}
              </span>
            )}
          </button>
        </nav>
      </header>

      {connection !== "live" && connection !== "connecting" && (
        <div className="conn-banner platform" role="status">
          <span className="led led-amber" aria-hidden="true" />
          {connection === "offline" ? "You're offline." : "Reconnecting…"} Showing the last confirmed owner and numbers.
        </div>
      )}

      <section className="dock plate platform" aria-label="Ownership and pricing" id="main-button-area">
        <p className="disclosure">
          <span className="tag">Paid placement</span>
          {reign ? (
            <>
              <span className="disclosure-text">
                Takeover <span className="mono">No. {reign.ordinal}</span> · owned by <strong>{reign.owner.name}</strong>
              </span>
              {reign.owner.verified && (
                <span className="verified" title="Identity verified by THE BUTTON">
                  <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 2l2.4 2.1 3.2-.3.9 3.1 2.8 1.6-1.2 3 1.2 3-2.8 1.6-.9 3.1-3.2-.3L12 22l-2.4-2.1-3.2.3-.9-3.1-2.8-1.6 1.2-3-1.2-3 2.8-1.6.9-3.1 3.2.3z" fill="currentColor" />
                    <path d="M8 12.5l2.6 2.5L16 9.5" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" />
                  </svg>
                  Verified
                </span>
              )}
              {reign.isDemo && <span className="tag tag-demo">Demo</span>}
            </>
          ) : (
            <span className="disclosure-text">Unclaimed. The first owner sets the price.</span>
          )}
        </p>
        <div className="dock-body">
          <dl className={`stats ${pulse ? "is-pulse" : ""}`}>
            <Stat label="Held for" value={reign ? formatClock(now - reign.startedAt) : "—"} plain />
            <Stat label="Paid" value={reign ? inr(reign.amountPaise) : "—"} />
            <Stat label="Views" value={state.counters ? formatCount(state.counters.views) : "—"} />
            <Stat label="Presses" value={state.counters ? formatCount(state.counters.presses) : "—"} />
            <Stat label="Link clicks" value={state.counters ? formatCount(state.counters.outboundClicks) : "—"} />
            <Stat label="Takeovers" value={formatCount(state.takeoverCount)} />
          </dl>
          <div className="takeover">
            <div className="takeover-price">
              <span className="eng">{isMine ? "Raise from" : "Take over from"}</span>
              <Roll value={inr(state.minNextPaise)} className="takeover-amount" />
            </div>
            <button className="takeover-btn" onClick={() => setPanel("takeover")}>
              <span className="led" aria-hidden="true" />
              {isMine ? "Raise your price" : "Take over"}
              <span className="sr-only"> for {inr(state.minNextPaise)} or more</span>
            </button>
          </div>
        </div>
        <p className="takeover-note">Pressing the big button is free. Taking over replaces this page for everyone until someone pays more.</p>
      </section>

      <footer className="footbar platform">
        <RecentStrip recent={state.recent} now={now} currentOrdinal={reign?.ordinal} onOpen={() => setPanel("history")} />
        <div className="plate controls" role="group" aria-label="Page controls">
          <button className="ctrl-btn" onClick={() => setPanel("share")} disabled={!reign}>
            Share
          </button>
          <button className="ctrl-btn" onClick={() => setPanel("report")} disabled={!reign}>
            Report
          </button>
          <button className="ctrl-btn ctrl-toggle" aria-pressed={prefs.sound} onClick={() => updatePrefs({ ...prefs, sound: !prefs.sound })}>
            <span className="switch" aria-hidden="true" />
            Sound
          </button>
          <button className="ctrl-btn ctrl-toggle" aria-pressed={!reduced} onClick={() => updatePrefs({ ...prefs, motion: reduced ? "full" : "reduced" })}>
            <span className="switch" aria-hidden="true" />
            Motion
          </button>
        </div>
      </footer>

      {announce && (
        <div className="announce platform" role="status" aria-live="assertive" key={announce.key}>
          <div className="announce-band">
            <span className="announce-kicker">
              <span className="led" aria-hidden="true" /> New owner · Takeover No. {announce.ordinal}
            </span>
            <strong className="announce-title">{announce.brand}</strong>
            <span className="announce-sub">
              now owns THE BUTTON · purchased for <span className="mono">{inr(announce.amount)}</span>
            </span>
          </div>
        </div>
      )}

      <div className="sr-only" aria-live="polite" id="live-region" />

      <ExperienceOverlay
        exp={exp}
        onClose={closeExperience}
        sound={prefs.sound}
        onToggleSound={() => updatePrefs({ ...prefs, sound: !prefs.sound })}
        takeoverNotice={expNotice}
        onTrack={(t, id, v) => track(t, id, v)}
        reducedMotion={reduced}
      />
      <TakeoverSheet
        open={panel === "takeover"}
        onClose={() => setPanel(null)}
        state={state}
        user={account.user}
        onAuthChanged={() => void account.refresh()}
      />
      <HistoryDrawer open={panel === "history"} onClose={() => setPanel(null)} version={state.version} />
      <HowItWorks open={panel === "how"} onClose={() => setPanel(null)} state={state} onRival={state.platform.demoMode ? rival : undefined} />
      <AccountDrawer
        open={panel === "account"}
        onClose={() => setPanel(null)}
        user={account.user}
        notifications={account.notifications}
        onAuthChanged={() => void account.refresh()}
        onLogout={() => void account.logout()}
        onOpenAnalytics={() => setPanel("analytics")}
        state={state}
      />
      <AnalyticsDrawer open={panel === "analytics"} onClose={() => setPanel(null)} version={state.version} />
      <ReportDialog open={panel === "report"} onClose={() => setPanel(null)} reign={reign} />
      <ShareDialog open={panel === "share"} onClose={() => setPanel(null)} reign={reign} isMine={isMine} />
    </div>
  );
}

function alertLive(msg: string) {
  const el = document.getElementById("live-region");
  if (el) el.textContent = msg;
}

function Stat({ label, value, plain }: { label: string; value: string; plain?: boolean }) {
  return (
    <div className="stat">
      <dt>{label}</dt>
      <dd>{plain || value === "—" ? <span className="mono">{value}</span> : <Roll value={value} />}</dd>
    </div>
  );
}

function LiveIndicator({ watching, connection }: { watching: number; connection: Connection }) {
  const ok = connection === "live" || connection === "connecting";
  return (
    <div className={`live-ind ${ok ? "" : "is-down"}`} title="Browsers with this page open and visible in the last 45 seconds. An estimate, not a count of people.">
      <span className="led" aria-hidden="true" />
      <Roll value={formatCount(watching)} />
      <span className="live-label">watching</span>
    </div>
  );
}

function RecentStrip({ recent, now, currentOrdinal, onOpen }: { recent: PublicState["recent"]; now: number; currentOrdinal?: number; onOpen: () => void }) {
  if (!recent.length) return <div className="plate recent recent-empty">No owners yet</div>;
  return (
    <button className="plate recent" onClick={onOpen} aria-label="Recent owners. Open the Book of Owners">
      <span className="eng recent-label">Recent owners</span>
      <ol>
        {recent.slice(0, 4).map((r) => (
          <li key={r.ordinal}>
            <span className="recent-swatch" style={{ background: /^#[0-9a-f]{3,6}$/i.test(r.primary) ? r.primary : "#666" }} aria-hidden="true" />
            <span className="recent-brand">{r.brandName}</span>
            <span className="recent-meta">
              {inr(r.amountPaise)} · {r.ordinal === currentOrdinal ? "live" : timeAgo(r.startedAt, now)}
            </span>
          </li>
        ))}
      </ol>
      <span className="recent-more" aria-hidden="true">
        Book of Owners →
      </span>
    </button>
  );
}
