"use client";

import { useCallback, useEffect, useState } from "react";
import type { CampaignConfig } from "@/server/campaign-schema.ts";
import { api } from "@/lib/client.ts";
import { useAccount } from "@/lib/useAccount.ts";
import { inr, timeAgo } from "@/shared/format.ts";
import { AuthForm } from "./AuthForm.tsx";
import { Stage } from "./Stage.tsx";

interface Queue {
  pending: { id: string; name: string; draft_json: string; config_json: string | null; submitted_at: number; owner: string; email: string; is_demo: number }[];
  reports: { id: string; reason: string; detail: string | null; campaign_id: string; campaign_name: string; campaign_status: string; ordinal: number | null; live: number; created_at: number }[];
  suspended: { id: string; name: string; review_note: string | null; suspended_at: number; owner: string }[];
  payments: { id: string; state: string; amount_paise: number; total_paise: number; failure_reason: string | null; provider: string; is_demo: number; updated_at: number; buyer: string }[];
  auditLog: { id: number; ts: number; action: string; subject_type: string; subject_id: string; detail_json: string | null; actor_user_id: string | null }[];
}

export function Admin() {
  const account = useAccount();
  const [q, setQ] = useState<Queue | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    api<Queue>("/api/admin/queue")
      .then((d) => {
        setQ(d);
        setErr(null);
      })
      .catch((e) => setErr(e.message));
  }, []);

  useEffect(() => {
    if (account.user?.role === "admin") {
      load();
      const t = setInterval(load, 8000);
      return () => clearInterval(t);
    }
  }, [account.user, load]);

  const act = async (id: string, action: string) => {
    try {
      await api(`/api/admin/campaigns/${id}`, { json: { action, note: notes[id] ?? "" } });
      load();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const resolve = async (id: string, status: "actioned" | "dismissed") => {
    await api(`/api/admin/reports/${id}`, { json: { status, resolution: notes[id] ?? "" } }).catch((e) => setErr(e.message));
    load();
  };
  const refund = async (id: string) => {
    if (!confirm("Refund this payment in full? Ownership history is kept.")) return;
    await api(`/api/admin/payments/${id}`, { json: {} }).catch((e) => setErr(e.message));
    load();
  };

  if (!account.loaded) return <div className="plain-page">Loading…</div>;
  if (!account.user || account.user.role !== "admin")
    return (
      <div className="plain-page narrow">
        <a href="/" className="back">
          ← THE BUTTON
        </a>
        <h1>Moderation</h1>
        {account.user ? <p className="form-error">Administrators only.</p> : <AuthForm demoMode onDone={() => void account.refresh()} />}
      </div>
    );

  return (
    <div className="plain-page admin">
      <a href="/" className="back">
        ← THE BUTTON
      </a>
      <h1>Moderation</h1>
      {err && <p className="form-error">{err}</p>}
      {!q ? (
        <p className="muted">Loading queue…</p>
      ) : (
        <>
          <section>
            <h2>Awaiting review ({q.pending.length})</h2>
            {q.pending.length === 0 && <p className="muted">Nothing waiting.</p>}
            <div className="review-list">
              {q.pending.map((c) => {
                const cfg = JSON.parse(c.draft_json) as CampaignConfig;
                const e = cfg.experience;
                const url = e.type === "link" ? e.url : e.ctaUrl;
                return (
                  <article key={c.id} className="review-card">
                    <div className="review-thumb">
                      <Stage config={cfg} mode="thumb" />
                    </div>
                    <div className="review-meta">
                      <strong>{c.name}</strong> <span className="muted small">by {c.owner} ({c.email}) · {timeAgo(c.submitted_at)}</span>
                      {c.is_demo ? <span className="pill pill-demo">Demo</span> : null}
                      <dl className="review-fields">
                        <dt>Brand</dt>
                        <dd>{cfg.brand.name}</dd>
                        <dt>Headline</dt>
                        <dd>{cfg.headline}</dd>
                        <dt>Subhead</dt>
                        <dd>{cfg.subhead ?? "—"}</dd>
                        <dt>Experience</dt>
                        <dd>
                          {e.type} {"title" in e && e.title ? `· ${e.title}` : ""}
                        </dd>
                        <dt>Destination</dt>
                        <dd>{url ? <code>{url}</code> : "—"}</dd>
                        <dt>Media</dt>
                        <dd className="small">
                          {[cfg.brand.logoUrl, ...cfg.decor.assets.map((a) => a.url)].filter(Boolean).map((u) => (
                            <code key={u}>{u} </code>
                          ))}
                        </dd>
                        {c.config_json && (
                          <>
                            <dt>Note</dt>
                            <dd>Edit to an already-approved campaign. The approved version stays live until you decide.</dd>
                          </>
                        )}
                      </dl>
                      <input placeholder="Note to owner (required to reject)" value={notes[c.id] ?? ""} onChange={(ev) => setNotes({ ...notes, [c.id]: ev.target.value })} />
                      <div className="row">
                        <button className="btn btn-primary btn-sm" onClick={() => act(c.id, "approve")}>
                          Approve
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => act(c.id, "reject")}>
                          Reject
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          <section>
            <h2>Open reports ({q.reports.length})</h2>
            {q.reports.length === 0 && <p className="muted">No open reports.</p>}
            <table className="admin-table">
              <tbody>
                {q.reports.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <strong>{r.reason.replace(/_/g, " ")}</strong>
                      <div className="small muted">{r.detail}</div>
                    </td>
                    <td>
                      {r.campaign_name} {r.ordinal && <a href={`/r/${r.ordinal}`}>#{r.ordinal}</a>} {r.live ? <span className="pill pill-live">Live</span> : null}
                    </td>
                    <td className="small muted">{timeAgo(r.created_at)}</td>
                    <td>
                      <input placeholder="Reason / resolution" value={notes[r.id] ?? ""} onChange={(ev) => setNotes({ ...notes, [r.id]: ev.target.value, [r.campaign_id]: ev.target.value })} />
                      <div className="row">
                        {r.campaign_status !== "suspended" && (
                          <button
                            className="btn btn-danger btn-sm"
                            onClick={async () => {
                              await act(r.campaign_id, "suspend");
                              await resolve(r.id, "actioned");
                            }}
                          >
                            Suspend campaign
                          </button>
                        )}
                        <button className="btn btn-ghost btn-sm" onClick={() => resolve(r.id, "dismissed")}>
                          Dismiss
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section>
            <h2>Suspended campaigns</h2>
            {q.suspended.length === 0 && <p className="muted">None.</p>}
            <ul>
              {q.suspended.map((s) => (
                <li key={s.id}>
                  <strong>{s.name}</strong> by {s.owner} — {s.review_note} ({timeAgo(s.suspended_at)}){" "}
                  <button className="btn btn-ghost btn-sm" onClick={() => act(s.id, "reinstate")}>
                    Reinstate
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2>Recent payments</h2>
            <div className="table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Buyer</th>
                    <th>State</th>
                    <th>Amount</th>
                    <th>Total</th>
                    <th>Reason</th>
                    <th>Updated</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {q.payments.map((p) => (
                    <tr key={p.id}>
                      <td>
                        {p.buyer} {p.is_demo ? <span className="pill pill-demo">Test</span> : null}
                      </td>
                      <td>
                        <span className={`pill pill-pay-${p.state}`}>{p.state}</span>
                      </td>
                      <td className="num">{inr(p.amount_paise)}</td>
                      <td className="num">{inr(p.total_paise)}</td>
                      <td className="small">{p.failure_reason ?? ""}</td>
                      <td className="small muted">{timeAgo(p.updated_at)}</td>
                      <td>
                        {p.state === "settled" && (
                          <button className="btn btn-ghost btn-sm" onClick={() => refund(p.id)}>
                            Refund
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h2>Audit log</h2>
            <div className="table-wrap">
              <table className="admin-table audit">
                <tbody>
                  {q.auditLog.map((a) => (
                    <tr key={a.id}>
                      <td className="small muted">{new Date(a.ts).toLocaleString("en-IN")}</td>
                      <td>
                        <code>{a.action}</code>
                      </td>
                      <td className="small">
                        {a.subject_type}:{a.subject_id}
                      </td>
                      <td className="small muted">
                        <code>{a.detail_json}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
