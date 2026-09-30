"use client";

import { useState } from "react";
import type { PublicReign } from "@/server/public-state.ts";
import { api, getClientId } from "@/lib/client.ts";
import { Sheet } from "./Sheet.tsx";

const REASONS: [string, string][] = [
  ["phishing_or_scam", "Phishing or scam"],
  ["impersonation", "Impersonates someone"],
  ["malicious_link", "Malicious or deceptive link"],
  ["harassment_or_hate", "Harassment or hate"],
  ["sexual_content", "Sexual content"],
  ["violence", "Violence or threats"],
  ["copyright", "Uses content without rights"],
  ["other", "Something else"],
];

export function ReportDialog({ open, onClose, reign }: { open: boolean; onClose: () => void; reign: PublicReign | null }) {
  const [reason, setReason] = useState("");
  const [detail, setDetail] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reign) return;
    setError(null);
    try {
      await api("/api/reports", { json: { reignId: reign.id, reason, detail, clientId: getClientId() } });
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={() => {
        onClose();
        setDone(false);
        setReason("");
        setDetail("");
      }}
      title="Report this campaign"
      side="center"
    >
      {!reign ? (
        <p className="muted">There's no campaign to report right now.</p>
      ) : done ? (
        <div className="prose">
          <p>Thanks — moderators will review takeover #{reign.ordinal}. If it breaks the rules it'll be replaced with a neutral screen.</p>
        </div>
      ) : (
        <form className="form" onSubmit={submit}>
          <p className="muted small">
            Reporting takeover #{reign.ordinal} ({reign.config?.brand.name ?? "suspended"}) by {reign.owner.name}.
          </p>
          <fieldset className="radios">
            <legend>What's wrong?</legend>
            {REASONS.map(([v, l]) => (
              <label key={v}>
                <input type="radio" name="reason" value={v} checked={reason === v} onChange={() => setReason(v)} required /> {l}
              </label>
            ))}
          </fieldset>
          <label className="field">
            <span>Details (optional)</span>
            <textarea value={detail} onChange={(e) => setDetail(e.target.value)} maxLength={1000} rows={3} />
          </label>
          {error && <p className="form-error">{error}</p>}
          <button className="btn btn-primary" disabled={!reason}>
            Send report
          </button>
        </form>
      )}
    </Sheet>
  );
}

export function ShareDialog({ open, onClose, reign, isMine }: { open: boolean; onClose: () => void; reign: PublicReign | null; isMine: boolean }) {
  const [copied, setCopied] = useState<string | null>(null);
  if (!reign) return null;
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const permalink = `${origin}/r/${reign.ordinal}`;
  const card = `/api/card/${reign.ordinal}${isMine ? "" : "?kind=announce"}`;
  const text = isMine ? `I own THE BUTTON right now. Takeover #${reign.ordinal}.` : `${reign.config?.brand.name ?? "Someone"} owns THE BUTTON right now.`;

  const copy = async (v: string, what: string) => {
    try {
      await navigator.clipboard.writeText(v);
      setCopied(what);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      setCopied("Copy failed — select the text manually");
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={isMine ? "Share your reign" : "Share THE BUTTON"} side="center">
      <div className="share">
        <img className="share-card" src={card} alt={`Share card for takeover #${reign.ordinal}`} width={600} height={315} />
        <p className="muted small">The card uses recorded numbers only. The permalink always opens a dated snapshot, clearly marked if it's no longer the current owner.</p>
        <div className="share-actions">
          <button className="btn btn-primary" onClick={() => copy(origin, "Link copied")}>
            Copy page link
          </button>
          <button className="btn btn-ghost" onClick={() => copy(permalink, "Permalink copied")}>
            Copy reign permalink
          </button>
          {typeof navigator !== "undefined" && "share" in navigator && (
            <button className="btn btn-ghost" onClick={() => navigator.share({ title: "THE BUTTON", text, url: origin }).catch(() => {})}>
              Share…
            </button>
          )}
          <a className="btn btn-ghost" href={card} download={`the-button-${reign.ordinal}.png`}>
            Download card
          </a>
        </div>
        <p role="status" className="small">
          {copied}
        </p>
      </div>
    </Sheet>
  );
}
