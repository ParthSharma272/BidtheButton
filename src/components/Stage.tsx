"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { CampaignConfig } from "@/server/campaign-schema.ts";
import { fontStack } from "@/server/config.ts";

/**
 * Renders an owner's campaign config as a full environment.
 *
 * Owner data only ever becomes: validated hex colours in CSS custom
 * properties, curated font stacks, text nodes, and <img>/<video> sources that
 * pass `safeMedia`. No owner string is ever interpreted as markup or CSS.
 *
 * Layout uses container queries, so the studio's mobile preview renders the
 * exact same layout a phone would get.
 */

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const hex = (c: string | undefined, fb: string) => (c && HEX.test(c) ? c : fb);

export function safeMedia(url: string | undefined | null): string | null {
  if (!url) return null;
  if (url.startsWith("/api/media/") || url.startsWith("/demo/")) return url.includes("..") ? null : url;
  try {
    const u = new URL(url);
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export interface StageProps {
  config: CampaignConfig | null;
  suspended?: boolean;
  /** "live" = main page; "preview" = studio; "thumb" = static card, no motion or media. */
  mode?: "live" | "preview" | "thumb" | "archive";
  reducedMotion?: boolean;
  onPress?: () => void;
  buttonDisabled?: boolean;
  /** Extra platform node placed directly under the button (e.g. the press hint). */
  underButton?: React.ReactNode;
  emptyState?: React.ReactNode;
}

export function Stage({ config, suspended, mode = "live", reducedMotion, onPress, buttonDisabled, underButton, emptyState }: StageProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(mode !== "thumb");
  const still = reducedMotion || mode === "thumb";

  // Pause all motion and media when the stage is offscreen.
  useEffect(() => {
    const el = ref.current;
    if (!el || mode === "thumb") return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.01 });
    io.observe(el);
    return () => io.disconnect();
  }, [mode]);

  // Pointer parallax, rAF-throttled, only while visible and motion is allowed.
  useEffect(() => {
    const el = ref.current;
    if (!el || still || !visible || !config || config.decor.intensity === 0) return;
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const r = el.getBoundingClientRect();
        el.style.setProperty("--px", (((e.clientX - r.left) / r.width - 0.5) * 2).toFixed(3));
        el.style.setProperty("--py", (((e.clientY - r.top) / r.height - 0.5) * 2).toFixed(3));
      });
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(raf);
    };
  }, [still, visible, config]);

  const vars = useMemo(() => (config ? themeVars(config) : undefined), [config]);

  if (suspended) return <NeutralStage kind="suspended" onPress={onPress} thumb={mode === "thumb"} />;
  if (!config) return <NeutralStage kind="empty" thumb={mode === "thumb"}>{emptyState}</NeutralStage>;

  const t = config.template;
  const bg = config.theme.background;
  const cover = t === "neon-music" ? config.decor.assets[0] : undefined;
  const floating = t === "neon-music" ? config.decor.assets.slice(1) : config.decor.assets;

  return (
    <div
      ref={ref}
      className={`stage tpl-${t} preset-${config.decor.preset} ${still || !visible ? "is-still" : ""} mode-${mode}`}
      style={vars}
      data-template={t}
      inert={mode === "thumb"}
      aria-hidden={mode === "thumb" || undefined}
    >
      <div className="stage-bg" aria-hidden="true">
        {bg.type === "image" && safeMedia(bg.imageUrl) && (
          <img className="stage-bg-media" src={safeMedia(bg.imageUrl)!} alt="" loading="lazy" decoding="async" style={{ filter: bg.blurPx ? `blur(${bg.blurPx}px)` : undefined }} />
        )}
        {bg.type === "video" && safeMedia(bg.videoUrl) && visible && !still && (
          <video className="stage-bg-media" src={safeMedia(bg.videoUrl)!} poster={safeMedia(bg.posterUrl) ?? undefined} autoPlay muted loop playsInline preload="metadata" style={{ filter: bg.blurPx ? `blur(${bg.blurPx}px)` : undefined }} />
        )}
        {bg.type === "video" && (still || !visible) && safeMedia(bg.posterUrl) && <img className="stage-bg-media" src={safeMedia(bg.posterUrl)!} alt="" loading="lazy" />}
        {(bg.type === "image" || bg.type === "video") && <div className="stage-bg-overlay" style={{ opacity: bg.overlay }} />}
        <TemplateAtmosphere config={config} still={still || !visible} />
      </div>

      <div className="stage-decor" aria-hidden={floating.every((a) => !a.alt)}>
        {floating.map((a, i) => {
          const src = safeMedia(a.url);
          if (!src) return null;
          return (
            <div
              key={i}
              className="decor-item"
              style={
                {
                  "--x": `${a.x}%`,
                  "--y": `${a.y}%`,
                  "--size": a.size,
                  "--rot": `${a.rotation}deg`,
                  "--depth": a.depth,
                  "--i": i,
                  opacity: a.opacity,
                } as CSSProperties
              }
            >
              <img src={src} alt={a.alt ?? ""} loading="lazy" decoding="async" draggable={false} />
            </div>
          );
        })}
      </div>

      <div className="stage-content">
        {t === "bold-poster" && (
          <div className="poster-wall" aria-hidden="true">
            {Array.from({ length: 5 }, (_, i) => (
              <span key={i}>{config.headline}</span>
            ))}
          </div>
        )}

        <div className="stage-copy">
          <div className="brand-chip">
            <BrandMark config={config} />
            <span className="brand-name">{config.brand.name}</span>
          </div>
          <Headline config={config} still={still} />
          {config.subhead && <p className="stage-subhead">{config.subhead}</p>}
        </div>

        <div className="stage-button-area">
          <MainButton config={config} onPress={onPress} disabled={buttonDisabled} still={still} />
          {underButton}
        </div>

        {cover && safeMedia(cover.url) && (
          <div className="neon-cover" aria-hidden={!cover.alt}>
            <div className="vinyl" />
            <img src={safeMedia(cover.url)!} alt={cover.alt ?? ""} loading="lazy" />
          </div>
        )}
      </div>

      {t === "animated-message" && config.subhead && (
        <div className="message-marquee" aria-hidden="true">
          <div>
            {Array.from({ length: 6 }, (_, i) => (
              <span key={i}>{config.subhead} ✦ </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Headline({ config, still }: { config: CampaignConfig; still: boolean }) {
  if (config.template === "animated-message" && !still) {
    const words = config.headline.split(" ");
    return (
      <h1 className="stage-headline" aria-label={config.headline}>
        {words.map((w, i) => (
          <span key={`${w}-${i}`} className="word" style={{ "--w": i } as CSSProperties} aria-hidden="true">
            {w}{" "}
          </span>
        ))}
      </h1>
    );
  }
  return <h1 className="stage-headline">{config.headline}</h1>;
}

export function BrandMark({ config, size = 40 }: { config: CampaignConfig; size?: number }) {
  const logo = safeMedia(config.brand.logoUrl);
  if (logo) return <img className="brand-mark" src={logo} alt="" width={size} height={size} />;
  const initials = config.brand.name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <span className="brand-mark brand-monogram" style={{ width: size, height: size }} aria-hidden="true">
      {initials || "?"}
    </span>
  );
}

export function MainButton({ config, onPress, disabled, still }: { config: CampaignConfig; onPress?: () => void; disabled?: boolean; still?: boolean }) {
  const [pressed, setPressed] = useState(0);
  return (
    <button
      type="button"
      className={`main-button shape-${config.button.shape} anim-${still ? "none" : config.button.animation} ${pressed ? "is-pressed" : ""}`}
      onClick={() => {
        setPressed((n) => n + 1);
        window.setTimeout(() => setPressed(0), 450);
        onPress?.();
      }}
      disabled={disabled}
      aria-describedby="press-hint"
      aria-haspopup="dialog"
    >
      <span className="main-button-face">
        <span className="main-button-label">{config.button.label}</span>
      </span>
      {pressed > 0 && !still && <span key={pressed} className="main-button-ring" aria-hidden="true" />}
    </button>
  );
}

function TemplateAtmosphere({ config, still }: { config: CampaignConfig; still: boolean }) {
  const t = config.template;
  const particles = useMemo(() => Array.from({ length: 14 }, (_, i) => ({ i, x: (i * 37) % 100, d: 6 + ((i * 7) % 9), s: 4 + ((i * 5) % 10), delay: -((i * 13) % 10) })), []);
  if (still) return <div className={`atmo atmo-${t}`} />;
  return (
    <div className={`atmo atmo-${t}`}>
      {(t === "floating-products" || config.decor.preset === "confetti" || t === "playful-creator") &&
        particles.map((p) => (
          <span
            key={p.i}
            className={t === "floating-products" ? "bubble" : "confetto"}
            style={{ "--x": `${p.x}%`, "--d": `${p.d / Math.max(config.decor.intensity, 0.2)}s`, "--s": `${p.s}px`, "--delay": `${p.delay}s`, "--i": p.i } as CSSProperties}
          />
        ))}
      {t === "neon-music" && (
        <div className="eq">
          {Array.from({ length: 24 }, (_, i) => (
            <span key={i} style={{ "--i": i } as CSSProperties} />
          ))}
        </div>
      )}
    </div>
  );
}

function NeutralStage({ kind, onPress, children, thumb }: { kind: "suspended" | "empty"; onPress?: () => void; children?: React.ReactNode; thumb?: boolean }) {
  return (
    <div className={`stage stage-neutral ${thumb ? "mode-thumb" : ""}`} inert={thumb} aria-hidden={thumb || undefined}>
      <div className="stage-content">
        <div className="stage-copy">
          {kind === "suspended" ? (
            <>
              <p className="neutral-kicker">Platform notice</p>
              <h1 className="stage-headline">This campaign is unavailable</h1>
              <p className="stage-subhead">
                It was suspended by THE BUTTON moderators after review. Ownership and payment records are unchanged. The button returns to normal as soon as
                someone takes over or the campaign is reinstated.
              </p>
            </>
          ) : (
            children
          )}
        </div>
        {kind === "suspended" && onPress && (
          <div className="stage-button-area">
            <button type="button" className="main-button shape-circle anim-none neutral-button" disabled>
              <span className="main-button-face">
                <span className="main-button-label">Unavailable</span>
              </span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function themeVars(c: CampaignConfig): CSSProperties {
  const p = c.theme.palette;
  const bg = c.theme.background;
  let background = hex(p.surface, "#111");
  if (bg.type === "solid") background = hex(bg.color, "#111");
  else if (bg.type === "gradient")
    background = `linear-gradient(${bg.angle}deg, ${hex(bg.from, "#111")}, ${bg.via ? hex(bg.via, "#222") + ", " : ""}${hex(bg.to, "#000")})`;
  else background = hex(p.surface, "#111");

  return {
    "--c-primary": hex(p.primary, "#ffffff"),
    "--c-accent": hex(p.accent, "#ffffff"),
    "--c-text": hex(p.text, "#ffffff"),
    "--c-muted": hex(p.muted, "#bbbbbb"),
    "--c-surface": hex(p.surface, "#111111"),
    "--btn-bg": hex(c.button.color, "#ffffff"),
    "--btn-fg": hex(c.button.textColor, "#000000"),
    "--f-body": fontStack(c.theme.font),
    "--f-head": fontStack(c.theme.headlineFont ?? c.theme.font),
    "--intensity": c.decor.intensity,
    "--stage-bg": background,
  } as CSSProperties;
}
