# THE BUTTON

**One button. One owner. The internet is watching.**
Own the button. Make this page yours. Until someone pays more.

A single live page. Whoever last paid the most owns it: their approved campaign restyles the whole page, and the big button opens their "Button Experience". Anyone can press for free. Anyone can take over by paying at least the displayed minimum.

> **Demo mode is on by default.** Payments go through a mock gateway that moves no money. Seeded owners and their past activity are labelled "Demo" everywhere.

---

## Quick start

```bash
npm install
cp .env.example .env.local     # optional, defaults are fine for the demo
npm run reset                  # creates data/app.db and seeds the demo
npm run dev                    # http://localhost:3000
npm test                       # 35 focused tests
```

Requires Node 22.6+ (the CLI scripts use `--experimental-strip-types`).

### Demo accounts (password `demo1234`)

| Email | Role |
|---|---|
| `you@demo.test` | Buyer "Kiran": an approved playful-creator campaign ready to buy with, plus one in the review queue |
| `admin@demo.test` | Moderator: approve/reject, reports, suspend, refunds, audit log at `/admin` |
| `nova@demo.test`, `luna@demo.test`, `orbit@demo.test` | The three fictional brands |

### Try the core loop

1. Open `/`. NOVA COLA owns the page (floating products). Press the button, then close the poster overlay.
2. **Take over** → sign in as `you@demo.test` → pick *Kiran's Corner* → enter an amount → review the total and rules → **Approve test payment**.
3. Open a second browser window. Both switch to Kiran's page without a refresh, with a takeover announcement.
4. **How it works → Simulate a rival takeover (demo)**: a seeded brand buys through the same quote → checkout → signed-webhook path. Kiran gets a "you lost control" notification.
5. In the gateway, **More test scenarios** covers a declined card, a delayed webhook and a duplicated webhook.
6. `/studio`: edit the campaign with the desktop/mobile preview. `/admin`: moderation.

---

## What's in here

```
src/
  server/                 all business logic (no Next.js imports; unit-tested)
    schema.sql            database schema (SQLite; money is integer paise)
    db.ts                 connection, migrations, IMMEDIATE transactions, audit
    pricing.ts            minimum-price formula, tax breakdown, CPM/CPC/CTR
    campaign-schema.ts    zod schema: the ONLY shape owner customisation can take
    campaigns.ts          drafts, review, approval, suspension, live-edit publishing
    ownership.ts          the single place ownership changes (versioned CAS)
    payments/
      machine.ts          payment state machine + buyer-facing copy
      service.ts          quotes, checkout, webhook application, refunds, recovery
      providers/          mock (demo) and razorpay (unverified) adapters
    analytics.ts          events, dedupe, bot filter, presence, owner analytics
    public-state.ts       public snapshot, Book of Owners, records
    moderation.ts, uploads.ts, ratelimit.ts, bus.ts (SSE fan-out), jobs.ts
    cli/                  migrate, seed, recover
  app/                    pages + API routes (thin wrappers over src/server)
  components/             Stage (owner renderer), ButtonApp, Studio, Admin, sheets
  shared/templates.ts     the six starting templates
public/demo/              fictional brand art + generated teaser video
tests/                    ownership races, stale quotes, webhooks, refunds, publishing, analytics
```

Payment, ownership, campaign publishing and analytics are separate modules. Route handlers only parse input and call them.

---

## How the important parts work

### Pricing
`minimum_next = max(previous + ₹1, ceil_to_rupee(previous × 1.10))`; the first price is ₹10. All amounts are integer paise. GST (and an optional fee) is added on top and shown before payment. The next minimum is based on the purchase amount only, not tax.

### Purchase flow and payment reliability
```
sign in → campaign (must already be APPROVED) → amount → quote (pinned to ownership version)
       → review total + rules + explicit consent → checkout (payment row + provider order)
       → provider webhook (signature-verified) → ONE IMMEDIATE transaction:
            dedupe event ▸ transition payment ▸ activate reign   or   ▸ refund_pending
       → after commit: broadcast new owner  /  ask provider to refund
```
- **Server-authoritative version.** `ownership_state.version` goes up on every takeover. A quote records the version it was priced against. Activation re-checks it with a compare-and-set, so a delayed webhook for an old quote can't displace a newer owner. That payment is refunded instead.
- **Exactly one owner.** A partial unique index (`idx_one_active_reign`) makes a second open reign impossible at the storage layer.
- **Idempotent webhooks.** `payment_events(provider, provider_event_id)` is UNIQUE. Redeliveries return the original outcome.
- **No silent price changes.** Checkout refuses if the consented total differs from the quote. A stale quote returns the new minimum, and the UI requires fresh consent.
- **Browser is never proof.** The UI polls `/api/payments/:id`; only a verified provider event changes state.
- **Captured but not activatable** (outbid, campaign suspended, amount mismatch, late capture after failure) → `refund_pending` → provider refund → `refunded`. The buyer sees the status.
- **Recovery job** (every 30s in-process, or `npm run recover`): retries refunds, finalises captured-but-unfinalised payments, voids abandoned checkouts, expires quotes.
- The current owner stays live throughout. Checkout never holds a lock.

State machine (`src/server/payments/machine.ts`):
```
created → processing → captured → settled
   │           │          └────→ refund_pending → refunded
   └───────────┴──→ failed | voided
settled → refund_pending   (admin refund only; history is kept)
```

### Owner customisation is data, not code
Owners edit a zod-validated structure: template id, hex colours, curated font ids, text, media URLs (uploads, demo assets or public https), enums for shapes and animations, and numeric positions. No field accepts HTML, CSS or script. The renderer maps these to CSS custom properties and text nodes. Platform chrome (price, metrics, disclosure, report/close controls) sits in a separate layer with fixed styles and z-order. CSP is the backstop. Text is NFC-normalised and stripped of control/bidi/zero-width characters to prevent spoofing.

Six templates give six different layouts, not recolours: **floating products** (parallax product shots, bubbles, condensation), **neon music** (split layout, glowing type, spinning vinyl, equaliser), **minimal launch** (grid, rising screenshots), **playful creator** (blobs, stickers, confetti, tilted headline block), **bold poster** (scrolling type wall, hard-shadow button), **animated message** (word-by-word reveal, marquee).

### Publishing while you own the page
- The public page renders the current reign's snapshot, never the campaign row directly.
- Cosmetic edits (colours, positions, animation) publish immediately. Material edits (text, links, media, experience) go to review, and the last approved version stays live meanwhile.
- A snapshot is refreshed only in a transaction that re-checks the reign is still open and still belongs to that owner, so an outbid owner can't change the live page. History keeps what was actually shown.

### Live updates
Server-Sent Events (`/api/stream`). Every (re)connect refetches `/api/state`, and versions never go backwards on the client. While the stream is down, the page shows "Reconnecting… last confirmed state" and dims ownership numbers rather than presenting them as current.

### Metrics (defined in "How it works" too)
| Metric | Definition |
|---|---|
| Watching now | Browsers with the page **visible** and a heartbeat in the last 45s. The client id is shared across tabs. It's an estimate, not a count of people. |
| Campaign view | Campaign visible ≥ 1s; one per browser per reign per 30 min. |
| Button press | Main-button activation; repeats within 2s collapse. |
| Experience view | The overlay actually opened. |
| Outbound CTA click | Visitor explicitly clicked the owner's link (domain shown first). Never labelled as sales. |
| CTR | clicks ÷ experience views, shown with its denominator; "—" when zero. |
| Video starts/completions | Uploaded video only. YouTube embeds don't report plays to us, so they're shown as unmeasured. |

Every event carries the reign the visitor actually saw, so a takeover mid-video still credits the previous owner. Bots are filtered by user agent and endpoints are rate-limited. No IPs are stored. CPM and cost per click use the amount actually paid.

### Trust & safety
Buyer auth (scrypt + httpOnly SameSite cookies), same-origin checks on all mutations, role-based admin, magic-byte upload validation (no SVG), rights confirmation, https-only destinations with private/loopback/credential rejection (SSRF guard), YouTube-only embeds via youtube-nocookie, reports, moderation queue, suspension that shows a neutral screen without touching ownership or payment rows, and an audit log for ownership, payment, campaign and verification changes. Verification badges are admin-granted only (`POST /api/admin/users/:id {verified:true}`).

---

## Payment test mode

With `PAYMENT_PROVIDER=mock` (default):
- The Pay step shows a **TEST MODE** gateway. Its buttons call `/api/payments/mock/simulate`, which **signs a webhook with `MOCK_WEBHOOK_SECRET` and POSTs it to `/api/webhooks/mock`**, the same path a real provider uses.
- Scenarios: approve, decline, 4-second delayed webhook, duplicate webhook.
- `/api/demo/rival` makes a seeded brand take over through the full path.
- Payments are stored with `is_demo = 1`.

---

## External integrations still required for production

| Need | Status | What to do |
|---|---|---|
| **Real payments** | `razorpay.ts` adapter is written to Razorpay's documented Orders/Refunds/Webhooks API but **has not been run against a live or test account**. | Set `PAYMENT_PROVIDER=razorpay`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`; subscribe the webhook to `payment.captured`, `payment.failed`, `refund.processed`, `refund.failed`; test end-to-end in Razorpay test mode. Before relying on the abandonment voider, add an order-status lookup. GST invoicing is not implemented. |
| **Database** | SQLite (WAL, IMMEDIATE transactions). Correct for one instance. | For multiple instances, move to Postgres (`SELECT … FOR UPDATE` on `ownership_state`; the schema ports directly). |
| **Realtime fan-out** | In-process bus. | Multi-instance: back `bus.ts` with Redis pub/sub or Postgres LISTEN/NOTIFY. Rate limiting (`ratelimit.ts`) likewise needs Redis. |
| **Media storage** | Local disk (`data/uploads`), served with nosniff + sandbox CSP. | Swap `uploads.ts` for S3/R2/GCS plus a CDN; add malware/CSAM scanning. |
| **Destination safety** | Syntactic checks only (https, no private hosts, no credentials). | Add Google Safe Browsing / Web Risk lookups at submission and periodically. |
| **Email** | Not implemented; notifications are in-app. | Add a mail provider for takeover notifications, account recovery and email verification. |
| **Bot protection** | UA filter + rate limits. | Add a challenge (e.g. Turnstile) on signup/checkout if abused. |

## Optional features
- **A. Takeover notifications**: implemented in-app (the outbid owner is notified). Email/push not wired.
- **B. Shareable announcements**: `/api/card/:ordinal` (PNG, recorded data only) and `?kind=announce`.
- **C. Scheduling drafts**: campaigns can be prepared and approved ahead of time. Nothing promises future ownership.
- **D. Seasons**: config exists (`SEASONS_ENABLED=false`) but expiry logic is **not implemented**. Keep it off.
- **E. Historical gallery**: Book of Owners + `/r/:ordinal` archived permalinks, always labelled historical.
