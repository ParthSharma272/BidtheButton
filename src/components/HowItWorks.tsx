"use client";

import type { PublicState } from "@/server/public-state.ts";
import { inr } from "@/shared/format.ts";
import { Sheet } from "./Sheet.tsx";
import { RULES_COPY } from "./TakeoverSheet.tsx";

export function HowItWorks({ open, onClose, state, onRival }: { open: boolean; onClose: () => void; state: PublicState; onRival?: () => void }) {
  const p = state.platform;
  return (
    <Sheet open={open} onClose={onClose} title="How THE BUTTON works" side="right">
      <div className="prose">
        <p className="lede">One page. One button. One owner at a time.</p>
        <ol className="how-steps">
          <li>
            <strong>Press the button — free.</strong> It opens whatever the current owner wants to show you: a video, a poster, a message or a link preview.
            Nothing is bought, and you never leave the page unless you click their link.
          </li>
          <li>
            <strong>Take over — paid.</strong> Anyone can buy control by paying more than the current owner. The price right now is{" "}
            <strong>{inr(state.minNextPaise)}</strong> or more.
          </li>
          <li>
            <strong>Make it yours.</strong> Your approved campaign replaces the whole page — colours, type, imagery, animation and the button itself — for
            everyone watching, instantly.
          </li>
          <li>
            <strong>Until someone pays more.</strong> There's no timer. You hold control until the next valid purchase replaces you.
          </li>
        </ol>

        <h3>Pricing</h3>
        <ul>
          <li>First ownership: {inr(p.firstPricePaise)}.</li>
          <li>
            After that: the higher of the last price + {inr(p.minIncreaseAbsolutePaise)} or +{p.minIncreaseBps / 100}%, rounded up to a whole rupee. Example: if the
            owner paid ₹1,000 the next minimum is ₹1,100.
          </li>
          <li>You can pay more than the minimum. GST{p.feeBps ? " and a platform fee" : ""} is added on top and shown before you pay.</li>
        </ul>

        <h3>The rules, plainly</h3>
        <p>{RULES_COPY}</p>
        <p>Payments are for the platform's temporary advertising service. They are not transfers to the previous owner.</p>

        <h3>What the numbers mean</h3>
        <dl className="defs">
          <dt>Watching now</dt>
          <dd>An estimate of browsers with this page visible and a heartbeat in the last {Math.round(45)} seconds. Tabs in one browser count once. It is not an exact count of people.</dd>
          <dt>Views</dt>
          <dd>The campaign was on a visible screen for at least {p.minViewMs / 1000}s. Counted once per browser per 30 minutes.</dd>
          <dt>Presses</dt>
          <dd>Main button activations. Rapid repeats collapse into one.</dd>
          <dt>CTA clicks</dt>
          <dd>Visitors who explicitly opened the owner's link. These are clicks, not sales.</dd>
        </dl>

        <h3>Safety</h3>
        <p>
          Campaigns are reviewed before they can be bought. Owners pick from structured templates; they can't run code, hide the price, fake the numbers or cover the
          report button. Anyone can report a campaign; moderators can replace it with a neutral screen without erasing its history.
        </p>

        {p.demoMode && (
          <div className="notice notice-demo">
            <strong>Demo mode.</strong> Payments use a test gateway and move no money. Seeded owners and their past activity are labelled “Demo”.
            {onRival && (
              <div style={{ marginTop: 10 }}>
                <button className="btn btn-ghost" onClick={onRival}>
                  Simulate a rival takeover (demo)
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </Sheet>
  );
}
