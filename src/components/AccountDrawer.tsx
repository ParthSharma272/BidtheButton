"use client";

import { useEffect, useState } from "react";
import type { PublicState } from "@/server/public-state.ts";
import { api } from "@/lib/client.ts";
import type { Me, Notification } from "@/lib/useAccount.ts";
import { formatCount, formatDuration, inr, timeAgo } from "@/shared/format.ts";
import { AuthForm } from "./AuthForm.tsx";
import { Sheet } from "./Sheet.tsx";

export function AccountDrawer({
  open,
  onClose,
  user,
  notifications,
  onAuthChanged,
  onLogout,
  onOpenAnalytics,
  state,
}: {
  open: boolean;
  onClose: () => void;
  user: Me | null;
  notifications: Notification[];
  onAuthChanged: () => void;
  onLogout: () => void;
  onOpenAnalytics: () => void;
  state: PublicState;
}) {
  const unread = notifications.filter((n) => !n.read).length;
  useEffect(() => {
    if (open && unread) void api("/api/notifications", { json: {} }).catch(() => {});
  }, [open, unread]);

  return (
    <Sheet open={open} onClose={onClose} title={user ? user.display_name : "Account"} side="right">
      {!user ? (
        <AuthForm demoMode={state.platform.demoMode} onDone={onAuthChanged} />
      ) : (
        <div className="account">
          <p className="muted small">
            {user.email}
            {user.is_demo ? " · demo account" : ""}
            {user.role === "admin" ? " · administrator" : ""}
          </p>
          {state.reign?.owner.id === user.id && <div className="notice notice-ok">You own THE BUTTON right now.</div>}
          <nav className="account-links">
            <a className="btn btn-ghost" href="/studio">
              Campaign studio
            </a>
            <button className="btn btn-ghost" onClick={onOpenAnalytics}>
              My analytics
            </button>
            {user.role === "admin" && (
              <a className="btn btn-ghost" href="/admin">
                Moderation
              </a>
            )}
            <button className="btn btn-ghost" onClick={onLogout}>
              Sign out
            </button>
          </nav>
          <h3>Notifications</h3>
          {notifications.length === 0 ? (
            <p className="muted small">You'll hear here when you lose control of the button.</p>
          ) : (
            <ul className="notifications">
              {notifications.map((n) => (
                <li key={n.id} className={n.read ? "" : "is-unread"}>
                  <strong>{n.title}</strong>
                  <span className="small">{n.body}</span>
                  <span className="muted small">{timeAgo(n.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Sheet>
  );
}

// ------------------------------------------------------------------ analytics

interface ReignStats {
  reignId: string;
  ordinal: number;
  brandName: string;
  amountPaise: number;
  startedAt: number;
  endedAt: number | null;
  durationMs: number;
  isDemo: boolean;
  views: number;
  presses: number;
  experienceViews: number;
  outboundClicks: number;
  uniqueVisitorsEstimate: number;
  ctr: { rate: number | null; denominator: number };
  avgEngagedMs: number | null;
  engagedSamples: number;
  video: { measurable: boolean; starts: number | null; completions: number | null } | null;
  peakConcurrent: { value: number; at: number } | null;
  devices: { device: string; n: number }[];
  referrers: { host: string; n: number }[];
  cpmPaise: number | null;
  cpcPaise: number | null;
  trend: { bucketMs: number; buckets: { t: number; views: number; presses: number; clicks: number }[] };
}

export function AnalyticsDrawer({ open, onClose, version }: { open: boolean; onClose: () => void; version: number }) {
  const [reigns, setReigns] = useState<ReignStats[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const load = () =>
      api<{ reigns: ReignStats[] }>("/api/analytics")
        .then((r) => {
          setReigns(r.reigns);
          setSel((s) => s ?? r.reigns[0]?.reignId ?? null);
        })
        .catch((e) => setError(e.message));
    void load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [open, version]);

  const r = reigns?.find((x) => x.reignId === sel) ?? null;

  return (
    <Sheet open={open} onClose={onClose} title="Your analytics" side="right" wide>
      <p className="muted small">Private to you. Every figure comes from recorded, bot-filtered events for the reign visitors actually saw. Nothing is estimated unless labelled.</p>
      {error && <p className="form-error">{error}</p>}
      {reigns && reigns.length === 0 && <p className="muted">You haven't owned THE BUTTON yet. Stats appear here from your first takeover.</p>}
      {reigns && reigns.length > 0 && (
        <>
          <label className="field">
            <span>Reign</span>
            <select value={sel ?? ""} onChange={(e) => setSel(e.target.value)}>
              {reigns.map((x) => (
                <option key={x.reignId} value={x.reignId}>
                  #{x.ordinal} · {x.brandName} · {x.endedAt ? "completed" : "live"}
                </option>
              ))}
            </select>
          </label>
          {r && <ReignReport r={r} all={reigns} />}
        </>
      )}
    </Sheet>
  );
}

function ReignReport({ r, all }: { r: ReignStats; all: ReignStats[] }) {
  const pct = (n: number | null) => (n === null ? "—" : `${(n * 100).toFixed(1)}%`);
  const total = r.devices.reduce((a, d) => a + d.n, 0);
  return (
    <div className="analytics">
      {r.isDemo && <div className="notice notice-demo">Demo reign — seeded data.</div>}
      <div className="kpis">
        <Kpi label="Campaign views" value={formatCount(r.views)} />
        <Kpi label="Unique visitors (est.)" value={formatCount(r.uniqueVisitorsEstimate)} hint="Distinct browsers; not people" />
        <Kpi label="Button presses" value={formatCount(r.presses)} />
        <Kpi label="Experience views" value={formatCount(r.experienceViews)} />
        <Kpi label="Outbound CTA clicks" value={formatCount(r.outboundClicks)} hint="Clicks, not sales" />
        <Kpi label="CTA click-through" value={pct(r.ctr.rate)} hint={`${r.outboundClicks} of ${r.ctr.denominator} experience views`} />
        <Kpi label="Avg. engaged time" value={r.avgEngagedMs === null ? "—" : formatDuration(r.avgEngagedMs)} hint={`${r.engagedSamples} sessions measured`} />
        <Kpi label="Peak watching" value={r.peakConcurrent ? formatCount(r.peakConcurrent.value) : "—"} hint={r.peakConcurrent ? "Sampled every 5s" : "Not sampled yet"} />
        <Kpi label="Paid" value={inr(r.amountPaise)} />
        <Kpi label="Cost / 1,000 views" value={r.cpmPaise === null ? "—" : inr(r.cpmPaise)} hint={r.cpmPaise === null ? "No views yet" : undefined} />
        <Kpi label="Cost / CTA click" value={r.cpcPaise === null ? "—" : inr(r.cpcPaise)} hint={r.cpcPaise === null ? "No clicks yet" : undefined} />
        <Kpi label={r.endedAt ? "Held for" : "Holding for"} value={formatDuration(r.durationMs)} />
      </div>

      <h3>Video</h3>
      {r.video === null ? (
        <p className="muted small">This campaign's experience isn't a video.</p>
      ) : !r.video.measurable ? (
        <p className="muted small">YouTube embeds don't report plays or completions to us, so these aren't measured.</p>
      ) : (
        <p className="small">
          {formatCount(r.video.starts ?? 0)} starts · {formatCount(r.video.completions ?? 0)} completions
        </p>
      )}

      <h3>Traffic over time</h3>
      <TrendChart trend={r.trend} />

      <div className="two-col">
        <div>
          <h3>Referral sources</h3>
          {r.referrers.length === 0 ? (
            <p className="muted small">No views yet.</p>
          ) : (
            <ul className="bars">
              {r.referrers.map((x) => (
                <li key={x.host}>
                  <span>{x.host}</span>
                  <span className="num">{formatCount(x.n)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h3>Devices (approx.)</h3>
          {total === 0 ? (
            <p className="muted small">No views yet.</p>
          ) : (
            <ul className="bars">
              {r.devices.map((d) => (
                <li key={d.device}>
                  <span>{d.device}</span>
                  <span className="num">{Math.round((d.n / total) * 100)}%</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {all.length > 1 && (
        <>
          <h3>Compared with your other reigns</h3>
          <div className="table-wrap">
            <table className="compare">
              <thead>
                <tr>
                  <th>Reign</th>
                  <th>Paid</th>
                  <th>Held</th>
                  <th>Views</th>
                  <th>CTR</th>
                  <th>CPM</th>
                </tr>
              </thead>
              <tbody>
                {all.map((x) => (
                  <tr key={x.reignId} className={x.reignId === r.reignId ? "is-current" : ""}>
                    <td>
                      #{x.ordinal} {x.brandName}
                    </td>
                    <td className="num">{inr(x.amountPaise)}</td>
                    <td className="num">{formatDuration(x.durationMs)}</td>
                    <td className="num">{formatCount(x.views)}</td>
                    <td className="num">{pct(x.ctr.rate)}</td>
                    <td className="num">{x.cpmPaise === null ? "—" : inr(x.cpmPaise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value num">{value}</div>
      {hint && <div className="kpi-hint">{hint}</div>}
    </div>
  );
}

function TrendChart({ trend }: { trend: ReignStats["trend"] }) {
  const max = Math.max(1, ...trend.buckets.map((b) => b.views));
  const w = 100 / Math.max(trend.buckets.length, 1);
  const label = trend.bucketMs >= 3_600_000 ? `${trend.bucketMs / 3_600_000}h` : `${trend.bucketMs / 60_000}m`;
  if (trend.buckets.every((b) => b.views === 0 && b.presses === 0)) return <p className="muted small">No traffic recorded yet.</p>;
  return (
    <figure className="trend">
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label={`Views per ${label} bucket`}>
        {trend.buckets.map((b, i) => (
          <rect key={i} x={i * w + w * 0.15} width={w * 0.7} y={40 - (b.views / max) * 38} height={(b.views / max) * 38} rx="0.6">
            <title>
              {new Date(b.t).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}: {b.views} views, {b.presses} presses, {b.clicks} clicks
            </title>
          </rect>
        ))}
      </svg>
      <figcaption className="muted small">
        Views per {label}. Peak bucket: {formatCount(max)}.
      </figcaption>
    </figure>
  );
}
