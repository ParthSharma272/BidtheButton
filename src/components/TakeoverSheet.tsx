"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PublicState } from "@/server/public-state.ts";
import type { CampaignConfig } from "@/server/campaign-schema.ts";
import { api, ApiError } from "@/lib/client.ts";
import type { Me } from "@/lib/useAccount.ts";
import { inr } from "@/shared/format.ts";
import { Sheet } from "./Sheet.tsx";
import { AuthForm } from "./AuthForm.tsx";
import { Stage } from "./Stage.tsx";

interface CampaignSummary {
  id: string;
  name: string;
  status: string;
  hasApprovedVersion: boolean;
  reviewNote: string | null;
  approved: CampaignConfig | null;
  draft: CampaignConfig;
}

interface Quote {
  quote: { id: string; expiresAt: number; ownershipVersion: number; minPaise: number };
  breakdown: { amountPaise: number; feePaise: number; taxPaise: number; totalPaise: number };
}

interface PaymentStatus {
  id: string;
  state: string;
  message: string;
  failureReason: string | null;
  totalPaise: number;
  amountPaise: number;
  isDemo: boolean;
  currentMinPaise: number;
}

type Step = "campaign" | "amount" | "review" | "pay" | "status";

export const RULES_COPY =
  "You are buying temporary control of this page. Another buyer may replace you immediately after activation. There is no guaranteed audience or ownership duration, and you receive no payout when someone takes over.";

export function TakeoverSheet({
  open,
  onClose,
  state,
  user,
  onAuthChanged,
}: {
  open: boolean;
  onClose: () => void;
  state: PublicState;
  user: Me | null;
  onAuthChanged: () => void;
}) {
  const [step, setStep] = useState<Step>("campaign");
  const [campaigns, setCampaigns] = useState<CampaignSummary[] | null>(null);
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [payment, setPayment] = useState<{ id: string; provider: string; totalPaise: number } | null>(null);
  const [status, setStatus] = useState<PaymentStatus | null>(null);
  const [staleNotice, setStaleNotice] = useState<string | null>(null);
  const minRupees = state.minNextPaise / 100;

  const loadCampaigns = useCallback(async () => {
    try {
      const r = await api<{ campaigns: CampaignSummary[] }>("/api/campaigns");
      setCampaigns(r.campaigns);
      const ready = r.campaigns.find((c) => c.hasApprovedVersion && c.status !== "suspended");
      setCampaignId((cur) => cur ?? ready?.id ?? null);
    } catch {
      setCampaigns([]);
    }
  }, []);

  useEffect(() => {
    if (open && user) void loadCampaigns();
    if (open) {
      setStep((s) => (s === "status" && status && ["settled", "refunded", "failed", "voided"].includes(status.state) ? "campaign" : s));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, user]);

  useEffect(() => {
    if (open && !amount) setAmount(String(minRupees));
  }, [open, amount, minRupees]);

  // If ownership changes while the buyer is reviewing, the quote is stale:
  // surface the new price and require fresh consent.
  const quotedVersion = quote?.quote.ownershipVersion;
  useEffect(() => {
    if (quotedVersion === undefined || step !== "review") return;
    if (state.version !== quotedVersion) {
      setStaleNotice(`Someone took over while you were reviewing. The minimum is now ${inr(state.minNextPaise)}.`);
      setQuote(null);
      setAccepted(false);
      setAmount(String(Math.max(Number(amount) || 0, state.minNextPaise / 100)));
      setStep("amount");
    }
  }, [state.version, state.minNextPaise, quotedVersion, step, amount]);

  const selected = campaigns?.find((c) => c.id === campaignId) ?? null;

  const getQuote = async () => {
    if (!campaignId) return;
    setBusy(true);
    setError(null);
    try {
      const q = await api<Quote>("/api/quotes", { json: { campaignId, amount } });
      setQuote(q);
      setAccepted(false);
      setStaleNotice(null);
      setStep("review");
    } catch (e) {
      const err = e as ApiError;
      setError(err.message + (err.data?.minPaise ? ` Current minimum: ${inr(err.data.minPaise)}.` : ""));
    } finally {
      setBusy(false);
    }
  };

  const pay = async () => {
    if (!quote) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ paymentId: string; provider: string; totalPaise: number; clientData: Record<string, unknown> }>("/api/checkout", {
        json: { quoteId: quote.quote.id, consentedTotalPaise: quote.breakdown.totalPaise, acceptedTerms: accepted },
      });
      setPayment({ id: r.paymentId, provider: r.provider, totalPaise: r.totalPaise });
      if (r.provider === "razorpay") {
        await openRazorpay(r.clientData);
        setStep("status");
      } else setStep("pay");
    } catch (e) {
      const err = e as ApiError;
      if (err.data?.code === "quote_stale" || err.data?.code === "quote_expired") {
        setStaleNotice(err.message);
        setQuote(null);
        setAccepted(false);
        if (err.data.minPaise) setAmount(String(Math.max(Number(amount) || 0, err.data.minPaise / 100)));
        setStep("amount");
      } else setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const simulate = async (outcome: string) => {
    if (!payment) return;
    setBusy(true);
    setStep("status");
    setStatus(null);
    try {
      await api("/api/payments/mock/simulate", { json: { paymentId: payment.id, outcome } });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Poll the server for the real payment outcome. The browser never decides.
  useEffect(() => {
    if (step !== "status" || !payment) return;
    let stop = false;
    const tick = async () => {
      try {
        const s = await api<PaymentStatus>(`/api/payments/${payment.id}`);
        if (stop) return;
        setStatus(s);
        if (["settled", "refunded", "failed", "voided"].includes(s.state)) return;
      } catch {}
      if (!stop) setTimeout(tick, 900);
    };
    void tick();
    return () => {
      stop = true;
    };
  }, [step, payment]);

  const close = () => {
    if (step === "pay" && payment) void api("/api/checkout/cancel", { json: { paymentId: payment.id } }).catch(() => {});
    if (step === "pay") setStep("review");
    onClose();
  };

  const restart = (keepAmount?: number) => {
    setQuote(null);
    setPayment(null);
    setStatus(null);
    setAccepted(false);
    setError(null);
    if (keepAmount) setAmount(String(keepAmount / 100));
    setStep("amount");
  };

  const secondsLeft = useCountdown(quote?.quote.expiresAt);

  return (
    <Sheet open={open} onClose={close} title="Take over THE BUTTON" side="right" className="takeover-sheet">
      <ol className="steps" aria-label="Purchase steps">
        {(["Sign in", "Campaign", "Amount", "Review", "Pay"] as const).map((label, i) => {
          const idx = !user ? 0 : { campaign: 1, amount: 2, review: 3, pay: 4, status: 4 }[step];
          return (
            <li key={label} className={i < idx ? "done" : i === idx ? "current" : ""} aria-current={i === idx ? "step" : undefined}>
              {label}
            </li>
          );
        })}
      </ol>

      <div className="price-banner">
        <div>
          <span className="label">Minimum to take over</span>
          <strong className="num">{inr(state.minNextPaise)}</strong>
        </div>
        <div className="price-banner-note">
          {state.reign ? <>Current owner paid {inr(state.lastAmountPaise)}. Next price is +10% (min ₹1), rounded up.</> : <>Nobody owns it yet. First ownership is {inr(state.platform.firstPricePaise)}.</>}
        </div>
      </div>

      {staleNotice && (
        <div className="notice notice-warn" role="alert">
          {staleNotice}
        </div>
      )}

      {!user ? (
        <AuthForm demoMode={state.platform.demoMode} onDone={onAuthChanged} intro="Sign in to buy. Browsing and pressing the button are always free." />
      ) : step === "campaign" ? (
        <section className="step-body">
          <h3>Choose the campaign that will take over the page</h3>
          <p className="muted small">Campaigns are reviewed before you can pay, so you are never charged for something that can't go live.</p>
          {campaigns === null ? (
            <p className="muted">Loading your campaigns…</p>
          ) : campaigns.length === 0 ? (
            <div className="empty">
              <p>You don't have a campaign yet.</p>
              <a className="btn btn-primary" href="/studio">
                Create one in the studio
              </a>
            </div>
          ) : (
            <div className="campaign-picks" role="radiogroup" aria-label="Your campaigns">
              {campaigns.map((c) => {
                const ok = c.hasApprovedVersion && c.status !== "suspended";
                const cfg = c.approved ?? c.draft;
                return (
                  <label key={c.id} className={`campaign-pick ${ok ? "" : "is-disabled"} ${campaignId === c.id ? "is-selected" : ""}`}>
                    <input type="radio" name="campaign" value={c.id} checked={campaignId === c.id} disabled={!ok} onChange={() => setCampaignId(c.id)} />
                    <div className="campaign-thumb">
                      <Stage config={cfg} mode="thumb" />
                    </div>
                    <div className="campaign-pick-meta">
                      <strong>{c.name}</strong>
                      <StatusPill status={c.status} approved={c.hasApprovedVersion} />
                      {c.reviewNote && <small className="muted">Moderator: {c.reviewNote}</small>}
                    </div>
                  </label>
                );
              })}
            </div>
          )}
          <div className="step-actions">
            <a className="btn btn-ghost" href="/studio">
              Open studio
            </a>
            <button className="btn btn-primary" disabled={!selected || !selected.hasApprovedVersion} onClick={() => setStep("amount")}>
              Continue
            </button>
          </div>
        </section>
      ) : step === "amount" ? (
        <section className="step-body">
          <h3>How much do you want to pay?</h3>
          <label className="field">
            <span>Your takeover amount (₹, whole rupees)</span>
            <div className="amount-input">
              <span aria-hidden="true">₹</span>
              <input inputMode="numeric" pattern="[0-9]*" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ""))} aria-describedby="amount-help" />
            </div>
            <small id="amount-help">
              At least {inr(state.minNextPaise)}. Paying more raises the price the next person must beat. Taxes are shown on the next step.
            </small>
          </label>
          <div className="quick-picks">
            {[1, 1.25, 1.5, 2].map((m) => {
              const v = Math.ceil(minRupees * m);
              return (
                <button key={m} type="button" className={`chip-btn ${Number(amount) === v ? "is-active" : ""}`} onClick={() => setAmount(String(v))}>
                  {inr(v * 100)}
                </button>
              );
            })}
          </div>
          {Number(amount) > 0 && Number(amount) * 100 >= state.minNextPaise && (
            <p className="muted small">If you win, the next takeover will cost at least {inr(nextMin(Number(amount) * 100))}.</p>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="step-actions">
            <button className="btn btn-ghost" onClick={() => setStep("campaign")}>
              Back
            </button>
            <button className="btn btn-primary" disabled={busy || !amount || Number(amount) * 100 < state.minNextPaise} onClick={getQuote}>
              {busy ? "Getting quote…" : "Review price"}
            </button>
          </div>
        </section>
      ) : step === "review" && quote ? (
        <section className="step-body">
          <h3>Review before you pay</h3>
          <table className="breakdown">
            <tbody>
              <tr>
                <th scope="row">Takeover amount</th>
                <td className="num">{inr(quote.breakdown.amountPaise)}</td>
              </tr>
              {quote.breakdown.feePaise > 0 && (
                <tr>
                  <th scope="row">Platform fee</th>
                  <td className="num">{inr(quote.breakdown.feePaise)}</td>
                </tr>
              )}
              <tr>
                <th scope="row">GST ({state.platform.taxBps / 100}%)</th>
                <td className="num">{inr(quote.breakdown.taxPaise)}</td>
              </tr>
              <tr className="total">
                <th scope="row">Total payable</th>
                <td className="num">{inr(quote.breakdown.totalPaise)}</td>
              </tr>
            </tbody>
          </table>
          <p className="muted small">
            Campaign: <strong>{selected?.name}</strong>. Quote valid for {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")} and only while
            the current owner stays the same. If someone takes over first, you'll see the new price and nothing will be charged at this price.
          </p>
          <div className="rules">
            <p>{RULES_COPY}</p>
            <p className="small">Payment is for THE BUTTON's temporary advertising service. It is not paid to the previous owner.</p>
          </div>
          <label className="check">
            <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
            <span>I understand I'm buying temporary control that can end at any moment, with no refund when someone takes over.</span>
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="step-actions">
            <button className="btn btn-ghost" onClick={() => restart()}>
              Change amount
            </button>
            <button className="btn btn-primary" disabled={!accepted || busy || secondsLeft <= 0} onClick={pay}>
              {secondsLeft <= 0 ? "Quote expired" : busy ? "Starting payment…" : `Pay ${inr(quote.breakdown.totalPaise)}`}
            </button>
          </div>
        </section>
      ) : step === "pay" && payment ? (
        <section className="step-body">
          <div className="demo-gateway" role="group" aria-labelledby="gw-title">
            <div className="demo-gateway-head">
              <span className="demo-tag">TEST MODE</span>
              <h3 id="gw-title">Demo payment gateway</h3>
            </div>
            <p className="small">
              No real money moves. Choosing an outcome makes the demo gateway send a signed webhook to the server, which verifies it and decides — the same path
              a real payment takes.
            </p>
            <div className="gw-amount num">{inr(payment.totalPaise)}</div>
            <div className="gw-actions">
              <button className="btn btn-primary" onClick={() => simulate("success")} disabled={busy} autoFocus>
                Approve test payment
              </button>
              <button className="btn btn-ghost" onClick={() => simulate("decline")} disabled={busy}>
                Decline
              </button>
            </div>
            <details className="gw-more">
              <summary>More test scenarios</summary>
              <button className="chip-btn" onClick={() => simulate("success_delayed")} disabled={busy}>
                Approve with a 4s delayed webhook
              </button>
              <button className="chip-btn" onClick={() => simulate("success_duplicate")} disabled={busy}>
                Approve and deliver the webhook twice
              </button>
            </details>
          </div>
        </section>
      ) : step === "status" ? (
        <section className="step-body" aria-live="polite">
          <PaymentStatusView status={status} onRetry={(minPaise) => restart(minPaise)} onClose={onClose} />
        </section>
      ) : null}
    </Sheet>
  );
}

function PaymentStatusView({ status, onRetry, onClose }: { status: PaymentStatus | null; onRetry: (minPaise?: number) => void; onClose: () => void }) {
  if (!status || ["created", "processing", "captured"].includes(status.state)) {
    return (
      <div className="status-card">
        <div className="spinner" aria-hidden="true" />
        <h3>{status?.message ?? "Waiting for the payment provider…"}</h3>
        <p className="muted small">We only activate ownership after the server verifies the payment with the provider. You can close this; it will still complete.</p>
      </div>
    );
  }
  if (status.state === "settled") {
    return (
      <div className="status-card status-ok">
        <h3>You own THE BUTTON.</h3>
        <p>Paid {inr(status.totalPaise)}{status.isDemo ? " (test payment)" : ""}. Your campaign is live for everyone right now — until someone pays more.</p>
        <div className="step-actions">
          <a className="btn btn-ghost" href="/studio">
            Edit campaign
          </a>
          <button className="btn btn-primary" onClick={onClose}>
            See it live
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className={`status-card ${status.state === "refunded" || status.state === "refund_pending" ? "status-warn" : "status-bad"}`}>
      <h3>{status.state === "failed" ? "Payment declined" : status.state === "voided" ? "Payment cancelled" : "Ownership not activated"}</h3>
      <p>{status.message}</p>
      {(status.state === "refund_pending" || status.state === "refunded") && (
        <p className="small muted">
          Refund status: <strong>{status.state === "refunded" ? "refunded in full" : "in progress"}</strong>
          {status.isDemo ? " (test mode — no real money moved)" : ""}.
        </p>
      )}
      <p className="small">The minimum to take over is now {inr(status.currentMinPaise)}. You'll review and confirm again before any new charge.</p>
      <div className="step-actions">
        <button className="btn btn-primary" onClick={() => onRetry(status.currentMinPaise)}>
          Review the new price
        </button>
      </div>
    </div>
  );
}

export function StatusPill({ status, approved }: { status: string; approved: boolean }) {
  const map: Record<string, string> = {
    draft: approved ? "Approved · unsaved edits" : "Draft",
    pending_review: approved ? "Approved · edit in review" : "In review",
    approved: "Approved",
    rejected: approved ? "Approved · edit rejected" : "Rejected",
    suspended: "Suspended",
  };
  return <span className={`pill pill-${status}`}>{map[status] ?? status}</span>;
}

function nextMin(paise: number) {
  return Math.max(paise + 100, Math.ceil(Math.ceil((paise * 11_000) / 10_000) / 100) * 100);
}

function useCountdown(until?: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!until) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [until]);
  return until ? Math.max(0, Math.floor((until - now) / 1000)) : 0;
}

async function openRazorpay(data: Record<string, unknown>) {
  // Requires checkout.razorpay.com in the CSP (added when PAYMENT_PROVIDER=razorpay).
  await new Promise<void>((resolve, reject) => {
    if ((window as any).Razorpay) return resolve();
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Could not load Razorpay"));
    document.head.appendChild(s);
  });
  const rz = new (window as any).Razorpay({ key: data.keyId, order_id: data.orderId, amount: data.amount, currency: data.currency, name: "THE BUTTON" });
  rz.open();
}
