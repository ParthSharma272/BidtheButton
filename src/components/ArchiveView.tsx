"use client";

import { useEffect, useState } from "react";
import type { PublicReign } from "@/server/public-state.ts";
import { loadPrefs, prefersReducedMotion } from "@/lib/client.ts";
import { formatCount, formatDuration, inr } from "@/shared/format.ts";
import { Stage } from "./Stage.tsx";
import { ExperienceOverlay, type OpenExperience } from "./ExperienceOverlay.tsx";

type Archived = PublicReign & { durationMs: number; ongoing: boolean; counters: { views: number; presses: number; experienceViews: number; outboundClicks: number } };

/**
 * A dated snapshot of a past reign. It is always labelled as historical and
 * records no analytics, so sharing an old campaign can't pass it off as live.
 */
export function ArchiveView({ reign }: { reign: Archived }) {
  const [exp, setExp] = useState<OpenExperience | null>(null);
  const [reduced, setReduced] = useState(false);
  useEffect(() => setReduced(prefersReducedMotion(loadPrefs())), []);
  const fmt = (t: number) => new Date(t).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });

  return (
    <div className={`app archive ${reduced ? "reduce-motion" : ""}`}>
      <div className={`archive-banner platform ${reign.ongoing ? "is-live" : ""}`} role="note">
        {reign.ongoing ? (
          <>
            <strong>This is the current reign.</strong> Takeover #{reign.ordinal}, live since {fmt(reign.startedAt)}.{" "}
            <a href="/">Go to the live page →</a>
          </>
        ) : (
          <>
            <strong>ARCHIVED · Historical record.</strong> Takeover #{reign.ordinal} ran {fmt(reign.startedAt)} – {fmt(reign.endedAt!)}. This is not the current owner.{" "}
            <a href="/">See who owns THE BUTTON now →</a>
          </>
        )}
      </div>
      <main className="stage-wrap">
        <Stage
          config={reign.config}
          suspended={reign.suspended}
          mode="archive"
          reducedMotion={reduced}
          onPress={() => reign.config && setExp({ reignId: reign.id, ordinal: reign.ordinal, ownerName: reign.owner.name, config: reign.config, openedAt: Date.now() })}
          underButton={<p className="press-hint">Archived experience · view only</p>}
        />
      </main>
      <section className="dock platform">
        <p className="disclosure">
          <span className="disclosure-tag">{reign.ongoing ? "Paid placement" : "Archive"}</span>
          Takeover #{reign.ordinal} · owned by <strong>{reign.owner.name}</strong>
          {reign.isDemo && <span className="pill pill-demo">Demo</span>}
        </p>
        <dl className="stats">
          <div className="stat">
            <dt>{reign.ongoing ? "Holding for" : "Held for"}</dt>
            <dd className="num">{formatDuration(reign.durationMs)}</dd>
          </div>
          <div className="stat">
            <dt>Paid</dt>
            <dd className="num">{inr(reign.amountPaise)}</dd>
          </div>
          <div className="stat">
            <dt>Views</dt>
            <dd className="num">{formatCount(reign.counters.views)}</dd>
          </div>
          <div className="stat">
            <dt>Presses</dt>
            <dd className="num">{formatCount(reign.counters.presses)}</dd>
          </div>
          <div className="stat">
            <dt>CTA clicks</dt>
            <dd className="num">{formatCount(reign.counters.outboundClicks)}</dd>
          </div>
        </dl>
      </section>
      <ExperienceOverlay exp={exp} onClose={() => setExp(null)} sound={false} onToggleSound={() => {}} takeoverNotice={null} onTrack={() => {}} reducedMotion={reduced} archived />
    </div>
  );
}
