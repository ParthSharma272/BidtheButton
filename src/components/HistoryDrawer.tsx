"use client";

import { useEffect, useState } from "react";
import type { CampaignConfig } from "@/server/campaign-schema.ts";
import { api } from "@/lib/client.ts";
import { formatCount, formatDuration, inr } from "@/shared/format.ts";
import { Sheet } from "./Sheet.tsx";
import { Stage } from "./Stage.tsx";

interface HistoryReign {
  id: string;
  ordinal: number;
  owner: { name: string; verified: boolean };
  config: CampaignConfig | null;
  suspended: boolean;
  amountPaise: number;
  startedAt: number;
  endedAt: number | null;
  durationMs: number;
  ongoing: boolean;
  isDemo: boolean;
  counters: { views: number; presses: number; experienceViews: number; outboundClicks: number };
}

interface RecordEntry {
  ordinal: number;
  owner: string;
  brand: string;
  value: number;
  ongoing: boolean;
}

interface Records {
  longestReign: RecordEntry | null;
  highestPurchase: RecordEntry | null;
  mostViewed: RecordEntry | null;
  mostClicked: RecordEntry | null;
  mostTakeovers: { owner: string; value: number } | null;
}

export function HistoryDrawer({ open, onClose, version }: { open: boolean; onClose: () => void; version: number }) {
  const [data, setData] = useState<{ reigns: HistoryReign[]; records: Records } | null>(null);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState<"book" | "records">("book");

  useEffect(() => {
    if (!open) return;
    setError(false);
    api<{ reigns: HistoryReign[]; records: Records }>("/api/history")
      .then(setData)
      .catch(() => setError(true));
  }, [open, version]);

  const fmtDate = (t: number) => new Date(t).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <Sheet open={open} onClose={onClose} title="Book of Owners" side="right" wide>
      <div className="seg" role="tablist" aria-label="History view">
        <button role="tab" aria-selected={tab === "book"} onClick={() => setTab("book")}>
          Every reign
        </button>
        <button role="tab" aria-selected={tab === "records"} onClick={() => setTab("records")}>
          Records
        </button>
      </div>

      {error && <p className="form-error">Couldn't load history. Try again in a moment.</p>}
      {!data && !error && <p className="muted">Loading the book…</p>}

      {data && tab === "book" && (
        <ol className="book">
          {data.reigns.length === 0 && <li className="muted">No one has owned THE BUTTON yet.</li>}
          {data.reigns.map((r) => (
            <li key={r.id} className={`book-entry ${r.ongoing ? "is-live" : ""}`}>
              <a className="book-thumb" href={`/r/${r.ordinal}`} aria-label={`Open archived page for takeover #${r.ordinal}`}>
                <Stage config={r.config} suspended={r.suspended} mode="thumb" />
              </a>
              <div className="book-meta">
                <div className="book-title">
                  <span className="book-ordinal">#{r.ordinal}</span>
                  <strong>{r.suspended ? "Suspended campaign" : r.config?.brand.name}</strong>
                  {r.ongoing ? <span className="pill pill-live">Live now</span> : <span className="pill">Completed</span>}
                  {r.isDemo && <span className="pill pill-demo">Demo</span>}
                </div>
                <div className="muted small">
                  by {r.owner.name}
                  {r.owner.verified && " ✓"} · {fmtDate(r.startedAt)} → {r.endedAt ? fmtDate(r.endedAt) : "now"}
                </div>
                <dl className="book-stats">
                  <div>
                    <dt>Paid</dt>
                    <dd className="num">{inr(r.amountPaise)}</dd>
                  </div>
                  <div>
                    <dt>{r.ongoing ? "Holding" : "Held"}</dt>
                    <dd className="num">{formatDuration(r.durationMs)}</dd>
                  </div>
                  <div>
                    <dt>Views</dt>
                    <dd className="num">{formatCount(r.counters.views)}</dd>
                  </div>
                  <div>
                    <dt>Presses</dt>
                    <dd className="num">{formatCount(r.counters.presses)}</dd>
                  </div>
                  <div>
                    <dt>CTA clicks</dt>
                    <dd className="num">{formatCount(r.counters.outboundClicks)}</dd>
                  </div>
                </dl>
                {r.ongoing && <p className="small muted">Ongoing: these numbers are still counting.</p>}
              </div>
            </li>
          ))}
        </ol>
      )}

      {data && tab === "records" && (
        <div className="records">
          <RecordCard title="Longest reign" e={data.records.longestReign} value={(v) => formatDuration(v)} />
          <RecordCard title="Highest purchase" e={data.records.highestPurchase} value={(v) => inr(v)} />
          <RecordCard title="Most viewed reign" e={data.records.mostViewed} value={(v) => `${formatCount(v)} views`} />
          <RecordCard title="Most clicked campaign" e={data.records.mostClicked} value={(v) => `${formatCount(v)} CTA clicks`} />
          <div className="record-card">
            <h3>Most takeovers by one account</h3>
            {data.records.mostTakeovers ? (
              <>
                <div className="record-value num">{data.records.mostTakeovers.value}</div>
                <div className="muted small">{data.records.mostTakeovers.owner}</div>
              </>
            ) : (
              <p className="muted">No takeovers yet.</p>
            )}
          </div>
          <p className="muted small">Records marked “ongoing” belong to the current reign and can still change.</p>
        </div>
      )}
    </Sheet>
  );
}

function RecordCard({ title, e, value }: { title: string; e: RecordEntry | null; value: (v: number) => string }) {
  return (
    <div className="record-card">
      <h3>{title}</h3>
      {e ? (
        <>
          <div className="record-value num">{value(e.value)}</div>
          <div className="small">
            <a href={`/r/${e.ordinal}`}>
              #{e.ordinal} · {e.brand}
            </a>{" "}
            <span className="muted">by {e.owner}</span> {e.ongoing && <span className="pill pill-live">Ongoing</span>}
          </div>
        </>
      ) : (
        <p className="muted">Not enough data yet.</p>
      )}
    </div>
  );
}
