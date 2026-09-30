"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import type { CampaignConfig } from "@/server/campaign-schema.ts";
import { fontStack } from "@/server/config.ts";
import { Sheet } from "./Sheet.tsx";
import { BrandMark, safeMedia } from "./Stage.tsx";

/**
 * The "Button Experience". It is bound to the reign that was on screen when
 * the visitor pressed, not to whatever is live now, so a takeover mid-video
 * neither interrupts the visitor nor steals the previous owner's credit.
 */

export interface OpenExperience {
  reignId: string;
  ordinal: number;
  ownerName: string;
  config: CampaignConfig;
  openedAt: number;
}

function destination(cfg: CampaignConfig): { url: string; host: string; label: string } | null {
  const e = cfg.experience;
  const url = e.type === "link" ? e.url : e.ctaUrl;
  const label = e.type === "link" ? e.ctaLabel : e.ctaLabel || "Visit";
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return null;
    return { url: u.toString(), host: u.hostname.replace(/^www\./, ""), label };
  } catch {
    return null;
  }
}

export function ExperienceOverlay({
  exp,
  onClose,
  sound,
  onToggleSound,
  takeoverNotice,
  onTrack,
  reducedMotion,
  archived,
}: {
  exp: OpenExperience | null;
  onClose: () => void;
  sound: boolean;
  onToggleSound: () => void;
  takeoverNotice: string | null;
  onTrack: (type: string, reignId: string, value?: number) => void;
  reducedMotion: boolean;
  archived?: boolean;
}) {
  return (
    <Sheet open={!!exp} onClose={onClose} side="full" className="experience-sheet" labelledBy="exp-title">
      {exp && (
        <ExperienceBody exp={exp} onClose={onClose} sound={sound} onToggleSound={onToggleSound} takeoverNotice={takeoverNotice} onTrack={onTrack} reducedMotion={reducedMotion} archived={archived} />
      )}
    </Sheet>
  );
}

function ExperienceBody({
  exp,
  onClose,
  sound,
  onToggleSound,
  takeoverNotice,
  onTrack,
  reducedMotion,
  archived,
}: {
  exp: OpenExperience;
  onClose: () => void;
  sound: boolean;
  onToggleSound: () => void;
  takeoverNotice: string | null;
  onTrack: (type: string, reignId: string, value?: number) => void;
  reducedMotion: boolean;
  archived?: boolean;
}) {
  const cfg = exp.config;
  const e = cfg.experience;
  const dest = destination(cfg);
  const videoRef = useRef<HTMLVideoElement>(null);
  const started = useRef(false);

  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = !sound;
  }, [sound]);

  const style = {
    "--c-primary": cfg.theme.palette.primary,
    "--c-accent": cfg.theme.palette.accent,
    "--c-text": cfg.theme.palette.text,
    "--c-muted": cfg.theme.palette.muted,
    "--c-surface": cfg.theme.palette.surface,
    "--btn-bg": cfg.button.color,
    "--btn-fg": cfg.button.textColor,
    "--f-body": fontStack(cfg.theme.font),
    "--f-head": fontStack(cfg.theme.headlineFont ?? cfg.theme.font),
  } as CSSProperties;

  const title = "title" in e ? e.title : undefined;

  return (
    <div className={`experience tpl-${cfg.template} exp-${e.type}`} style={style}>
      <header className="experience-bar">
        <div className="experience-owner">
          <BrandMark config={cfg} size={28} />
          <div>
            <div className="experience-brand">{cfg.brand.name}</div>
            <div className="experience-disclosure">
              {archived ? "Archived campaign" : "Paid placement"} · Takeover #{exp.ordinal} · by {exp.ownerName}
            </div>
          </div>
        </div>
        <div className="experience-actions">
          {(e.type === "video" || e.type === "youtube") && (
            <button type="button" className="chip-btn" onClick={onToggleSound} aria-pressed={sound}>
              {sound ? "Sound on" : "Sound off"}
            </button>
          )}
          <button type="button" className="chip-btn chip-close" onClick={onClose} autoFocus>
            Close <kbd>Esc</kbd>
          </button>
        </div>
      </header>

      {takeoverNotice && (
        <div className="experience-notice" role="status">
          {takeoverNotice}
        </div>
      )}

      <div className="experience-main">
        {e.type === "youtube" && (
          <div className="exp-media exp-16x9">
            <iframe
              src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(e.videoId)}?autoplay=1&mute=${sound ? 0 : 1}&rel=0&modestbranding=1&playsinline=1`}
              title={e.title}
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              referrerPolicy="strict-origin-when-cross-origin"
              sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
            />
          </div>
        )}

        {e.type === "video" && safeMedia(e.videoUrl) && (
          <div className="exp-media exp-16x9">
            <video
              ref={videoRef}
              src={safeMedia(e.videoUrl)!}
              poster={safeMedia(e.posterUrl) ?? undefined}
              controls
              autoPlay
              muted={!sound}
              playsInline
              preload="metadata"
              onPlay={() => {
                if (!started.current) {
                  started.current = true;
                  onTrack("video_start", exp.reignId);
                }
              }}
              onEnded={() => onTrack("video_complete", exp.reignId)}
            />
          </div>
        )}

        {e.type === "image" && safeMedia(e.imageUrl) && (
          <figure className="exp-poster">
            <img src={safeMedia(e.imageUrl)!} alt={e.title} />
          </figure>
        )}

        {e.type === "link" && (
          <article className="exp-link-card">
            {safeMedia(e.imageUrl) && <img src={safeMedia(e.imageUrl)!} alt="" className="exp-link-image" />}
            <div className="exp-link-body">
              <div className="exp-link-host">{dest?.host}</div>
              <h2 id="exp-title">{e.title}</h2>
              {e.description && <p>{e.description}</p>}
            </div>
          </article>
        )}

        {e.type === "message" && (
          <div className={`exp-message ${reducedMotion ? "" : "animate"}`}>
            {e.title && (
              <h2 id="exp-title" className="exp-message-title">
                {e.title}
              </h2>
            )}
            <p className="exp-message-body">
              {e.body.split(" ").map((w, i) => (
                <span key={i} style={{ "--w": i } as CSSProperties}>
                  {w}{" "}
                </span>
              ))}
            </p>
          </div>
        )}

        {e.type !== "link" && e.type !== "message" && (
          <div className="exp-caption">
            <h2 id="exp-title">{title}</h2>
            {"description" in e && e.description && <p>{e.description}</p>}
          </div>
        )}

        {dest && (
          <div className="exp-cta-row">
            <a
              className="exp-cta"
              href={dest.url}
              target="_blank"
              rel="noopener noreferrer nofollow ugc"
              onClick={() => {
                if (!archived) onTrack("outbound_click", exp.reignId);
              }}
            >
              {dest.label} <span aria-hidden="true">↗</span>
            </a>
            <p className="exp-dest">
              Opens <strong>{dest.host}</strong> in a new tab · run by the campaign owner, not THE BUTTON
            </p>
          </div>
        )}
        {cfg.socials.length > 0 && (
          <ul className="exp-socials" aria-label={`${cfg.brand.name} elsewhere`}>
            {cfg.socials.map((so) => {
              let host = "";
              try {
                host = new URL(so.url).hostname.replace(/^www\./, "");
              } catch {
                return null;
              }
              return (
                <li key={so.url}>
                  <a href={so.url} target="_blank" rel="noopener noreferrer nofollow ugc" onClick={() => !archived && onTrack("outbound_click", exp.reignId)}>
                    {so.platform} <span className="muted">· {host}</span>
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
