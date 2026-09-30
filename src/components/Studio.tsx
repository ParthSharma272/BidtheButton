"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ANIMATION_PRESETS,
  BUTTON_ANIMATIONS,
  BUTTON_SHAPES,
  campaignConfigSchema,
  parseYouTubeId,
  SOCIAL_PLATFORMS,
  type CampaignConfig,
} from "@/server/campaign-schema.ts";
import { CURATED_FONTS } from "@/server/config.ts";
import { api, ApiError } from "@/lib/client.ts";
import { useAccount } from "@/lib/useAccount.ts";
import { cloneTemplate, TEMPLATE_LIST } from "@/shared/templates.ts";
import { AuthForm } from "./AuthForm.tsx";
import { Stage } from "./Stage.tsx";
import { ExperienceOverlay, type OpenExperience } from "./ExperienceOverlay.tsx";
import { StatusPill } from "./TakeoverSheet.tsx";

interface CampaignSummary {
  id: string;
  name: string;
  status: string;
  hasApprovedVersion: boolean;
  reviewNote: string | null;
  draft: CampaignConfig;
  approved: CampaignConfig | null;
  isDemo: boolean;
}

type Section = "template" | "copy" | "style" | "background" | "button" | "decor" | "experience" | "links";
const SECTIONS: [Section, string][] = [
  ["template", "Template"],
  ["copy", "Brand & copy"],
  ["style", "Colours & type"],
  ["background", "Background"],
  ["button", "Button"],
  ["decor", "Floating images"],
  ["experience", "Button experience"],
  ["links", "Social links"],
];

export function Studio({ demoMode }: { demoMode: boolean }) {
  const account = useAccount();
  const [campaigns, setCampaigns] = useState<CampaignSummary[] | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [draft, setDraft] = useState<CampaignConfig | null>(null);
  const [dirty, setDirty] = useState(false);
  const [section, setSection] = useState<Section>("template");
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [msg, setMsg] = useState<{ kind: "ok" | "err" | "info"; text: string } | null>(null);
  const [serverIssues, setServerIssues] = useState<{ path: string; message: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<OpenExperience | null>(null);
  const [liveReignCampaign, setLiveReignCampaign] = useState<{ campaignOwner: string; ordinal: number } | null>(null);

  const load = useCallback(async (selectId?: string) => {
    const r = await api<{ campaigns: CampaignSummary[] }>("/api/campaigns");
    setCampaigns(r.campaigns);
    const pick = r.campaigns.find((c) => c.id === selectId) ?? r.campaigns[0];
    if (pick) {
      setCurrentId(pick.id);
      setName(pick.name);
      setDraft(structuredClone(pick.draft));
      setDirty(false);
    }
  }, []);

  useEffect(() => {
    if (account.user) void load().catch(() => setCampaigns([]));
  }, [account.user, load]);

  useEffect(() => {
    api<{ reign: { owner: { id: string }; ordinal: number } | null }>("/api/state")
      .then((s) => setLiveReignCampaign(s.reign ? { campaignOwner: s.reign.owner.id, ordinal: s.reign.ordinal } : null))
      .catch(() => {});
  }, [currentId]);

  const current = campaigns?.find((c) => c.id === currentId) ?? null;

  const edit = (fn: (d: CampaignConfig) => void) => {
    setDraft((d) => {
      if (!d) return d;
      const next = structuredClone(d);
      fn(next);
      return next;
    });
    setDirty(true);
    setMsg(null);
  };

  const validation = useMemo(() => (draft ? campaignConfigSchema.safeParse(draft) : null), [draft]);
  const issues = validation && !validation.success ? validation.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) : [];

  const create = async (template: string) => {
    setBusy(true);
    try {
      const cfg = cloneTemplate(template);
      if (account.user) cfg.brand.name = account.user.display_name;
      const r = await api<{ campaign: CampaignSummary }>("/api/campaigns", { json: { name: `${account.user?.display_name ?? "My"} campaign`, config: cfg } });
      await load(r.campaign.id);
      setSection("copy");
      setMsg({ kind: "ok", text: "New draft created. Nothing is public until it's approved and you take over." });
    } catch (e) {
      setMsg({ kind: "err", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const save = async (): Promise<boolean> => {
    if (!currentId || !draft) return false;
    setBusy(true);
    setServerIssues([]);
    try {
      await api(`/api/campaigns/${currentId}`, { method: "PUT", json: { name, config: draft } });
      setDirty(false);
      await load(currentId);
      setMsg({ kind: "ok", text: "Draft saved." });
      return true;
    } catch (e) {
      const err = e as ApiError;
      setServerIssues(err.data?.issues ?? []);
      setMsg({ kind: "err", text: err.message });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!currentId) return;
    if (dirty && !(await save())) return;
    setBusy(true);
    try {
      const r = await api<{ outcome: string }>(`/api/campaigns/${currentId}/submit`, { json: {} });
      await load(currentId);
      setMsg({
        kind: "ok",
        text:
          r.outcome === "published_minor"
            ? "Cosmetic changes published. If this campaign is live, everyone sees them now."
            : r.outcome === "approved"
              ? "Approved (auto-approve is on in this environment). You can now take over with it."
              : "Submitted for review. You can take over with it once a moderator approves it. Any approved version stays live meanwhile.",
      });
    } catch (e) {
      setMsg({ kind: "err", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const switchTo = (id: string) => {
    if (dirty && !confirm("Discard unsaved changes?")) return;
    const c = campaigns?.find((x) => x.id === id);
    if (!c) return;
    setCurrentId(c.id);
    setName(c.name);
    setDraft(structuredClone(c.draft));
    setDirty(false);
    setMsg(null);
  };

  if (!account.loaded) return <div className="plain-page">Loading…</div>;
  if (!account.user)
    return (
      <div className="plain-page narrow">
        <a href="/" className="back">
          ← THE BUTTON
        </a>
        <h1>Campaign studio</h1>
        <p className="muted">Sign in to design the page you'll show the internet.</p>
        <AuthForm demoMode={demoMode} onDone={() => void account.refresh()} />
      </div>
    );

  const isLiveOwner = liveReignCampaign?.campaignOwner === account.user.id;

  return (
    <div className="studio">
      <header className="studio-bar">
        <a href="/" className="back">
          ← THE BUTTON
        </a>
        <div className="studio-title">
          <strong>Studio</strong>
          {campaigns && campaigns.length > 0 && (
            <select aria-label="Campaign" value={currentId ?? ""} onChange={(e) => switchTo(e.target.value)}>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          {current && <StatusPill status={current.status} approved={current.hasApprovedVersion} />}
        </div>
        <div className="studio-actions">
          {dirty && <span className="muted small">Unsaved changes</span>}
          <button className="btn btn-ghost" onClick={save} disabled={!draft || busy || !dirty || issues.length > 0}>
            Save draft
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={!draft || busy || issues.length > 0 || current?.status === "suspended"}>
            {current?.hasApprovedVersion ? "Publish changes" : "Submit for review"}
          </button>
        </div>
      </header>

      {msg && (
        <div className={`notice notice-${msg.kind === "err" ? "bad" : msg.kind === "ok" ? "ok" : "info"} studio-msg`} role={msg.kind === "err" ? "alert" : "status"}>
          {msg.text}
        </div>
      )}

      {campaigns && campaigns.length === 0 ? (
        <div className="studio-empty">
          <h1>Pick a starting point</h1>
          <p className="muted">Each template is a different environment, not just a colour. You can change everything afterwards.</p>
          <TemplateGrid onPick={create} busy={busy} />
        </div>
      ) : !draft || !current ? (
        <div className="plain-page">Loading your campaigns…</div>
      ) : (
        <div className="studio-body">
          <aside className="studio-panel">
            {isLiveOwner && current.hasApprovedVersion && (
              <div className="notice notice-info small">
                You own THE BUTTON. If this is your live campaign, cosmetic edits publish instantly; changes to text, links or media go to review and the approved
                version stays live meanwhile. If you're outbid, edits no longer affect the page.
              </div>
            )}
            {current.reviewNote && <div className="notice notice-warn small">Moderator note: {current.reviewNote}</div>}
            <label className="field">
              <span>Campaign name (private)</span>
              <input value={name} maxLength={60} onChange={(e) => { setName(e.target.value); setDirty(true); }} />
            </label>
            <nav className="section-tabs" aria-label="Editor sections">
              {SECTIONS.map(([id, label]) => (
                <button key={id} aria-current={section === id ? "page" : undefined} onClick={() => setSection(id)}>
                  {label}
                </button>
              ))}
            </nav>
            <div className="section-body">
              <Editor section={section} draft={draft} edit={edit} />
            </div>
            {(issues.length > 0 || serverIssues.length > 0) && (
              <div className="notice notice-bad small" role="alert">
                <strong>Fix before saving:</strong>
                <ul>
                  {[...issues, ...serverIssues].slice(0, 8).map((i, k) => (
                    <li key={k}>
                      <code>{i.path || "campaign"}</code>: {i.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <details className="new-campaign">
              <summary>Start another campaign</summary>
              <TemplateGrid onPick={create} busy={busy} compact />
            </details>
          </aside>

          <section className="studio-preview" aria-label="Preview">
            <div className="preview-toolbar">
              <div className="seg" role="tablist" aria-label="Preview device">
                <button role="tab" aria-selected={device === "desktop"} onClick={() => setDevice("desktop")}>
                  Desktop
                </button>
                <button role="tab" aria-selected={device === "mobile"} onClick={() => setDevice("mobile")}>
                  Mobile
                </button>
              </div>
              <span className="muted small">Preview uses the same renderer as the live page. Platform controls are added around it and can't be restyled.</span>
            </div>
            <PreviewFrame device={device}>
              <Stage
                config={validation?.success ? validation.data : draft}
                mode="preview"
                onPress={() => validation?.success && setPreview({ reignId: "preview", ordinal: 0, ownerName: account.user!.display_name, config: validation.data, openedAt: Date.now() })}
                underButton={<p className="press-hint">Press to preview your button experience</p>}
              />
              <div className="preview-chrome" aria-hidden="true">
                <div className="pc-top">
                  <span>THE BUTTON</span>
                  <span>● watching now</span>
                </div>
                <div className="pc-dock">
                  <span>Paid placement · owned by {account.user.display_name}</span>
                  <span className="pc-take">Take over for ₹… or more</span>
                </div>
              </div>
            </PreviewFrame>
          </section>
        </div>
      )}
      <ExperienceOverlay exp={preview} onClose={() => setPreview(null)} sound={false} onToggleSound={() => {}} takeoverNotice={null} onTrack={() => {}} reducedMotion={false} archived />
    </div>
  );
}

function TemplateGrid({ onPick, busy, compact }: { onPick: (id: string) => void; busy: boolean; compact?: boolean }) {
  return (
    <div className={`template-grid ${compact ? "compact" : ""}`}>
      {TEMPLATE_LIST.map((t) => (
        <button key={t.id} className="template-card" onClick={() => onPick(t.id)} disabled={busy}>
          <div className="template-thumb">
            <Stage config={t.defaults} mode="thumb" />
          </div>
          <strong>{t.label}</strong>
          {!compact && <span className="muted small">{t.blurb}</span>}
        </button>
      ))}
    </div>
  );
}

/** Renders children at a real device width and scales it to fit. */
function PreviewFrame({ device, children }: { device: "desktop" | "mobile"; children: React.ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const w = device === "desktop" ? 1280 : 390;
  const h = device === "desktop" ? 800 : 844;
  useLayoutEffect(() => {
    const el = outer.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setScale(Math.min(r.width / w, (r.height || 9999) / h, 1));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [w, h]);
  return (
    <div className={`preview-outer device-${device}`} ref={outer}>
      <div className="preview-device" style={{ width: w, height: h, transform: `scale(${scale})` }}>
        {children}
      </div>
      <div style={{ height: h * scale }} aria-hidden="true" />
    </div>
  );
}

// ------------------------------------------------------------------ editor sections

function Editor({ section, draft, edit }: { section: Section; draft: CampaignConfig; edit: (fn: (d: CampaignConfig) => void) => void }) {
  switch (section) {
    case "template":
      return (
        <div className="stack">
          <p className="muted small">Changing template keeps your copy, brand and experience, and swaps the environment.</p>
          <div className="template-grid compact">
            {TEMPLATE_LIST.map((t) => (
              <button
                key={t.id}
                className={`template-card ${draft.template === t.id ? "is-selected" : ""}`}
                aria-pressed={draft.template === t.id}
                onClick={() =>
                  edit((d) => {
                    const base = cloneTemplate(t.id);
                    d.template = t.id;
                    d.theme = base.theme;
                    d.button = { ...base.button, label: d.button.label };
                    d.decor = base.decor;
                  })
                }
              >
                <div className="template-thumb">
                  <Stage config={{ ...t.defaults, brand: draft.brand, headline: draft.headline }} mode="thumb" />
                </div>
                <strong>{t.label}</strong>
              </button>
            ))}
          </div>
        </div>
      );
    case "copy":
      return (
        <div className="stack">
          <Text label="Brand or display name" value={draft.brand.name} max={40} onChange={(v) => edit((d) => void (d.brand.name = v))} hint="Must be yours. Impersonation is removed." />
          <MediaField label="Logo or avatar" value={draft.brand.logoUrl} kind="image" onChange={(v) => edit((d) => void (d.brand.logoUrl = v || undefined))} />
          <Text label="Headline" value={draft.headline} max={80} onChange={(v) => edit((d) => void (d.headline = v))} />
          <Text label="Supporting message" value={draft.subhead ?? ""} max={160} multiline onChange={(v) => edit((d) => void (d.subhead = v || undefined))} />
        </div>
      );
    case "style":
      return (
        <div className="stack">
          <div className="grid-2">
            {(["primary", "accent", "text", "muted", "surface"] as const).map((k) => (
              <Color key={k} label={k[0].toUpperCase() + k.slice(1)} value={draft.theme.palette[k]} onChange={(v) => edit((d) => void (d.theme.palette[k] = v))} />
            ))}
          </div>
          <Select label="Body font" value={draft.theme.font} options={CURATED_FONTS.map((f) => [f.id, f.label])} onChange={(v) => edit((d) => void (d.theme.font = v as any))} />
          <Select
            label="Headline font"
            value={draft.theme.headlineFont ?? draft.theme.font}
            options={CURATED_FONTS.map((f) => [f.id, f.label])}
            onChange={(v) => edit((d) => void (d.theme.headlineFont = v as any))}
          />
          <ContrastNote fg={draft.theme.palette.text} bg={bgColourFor(draft)} />
        </div>
      );
    case "background": {
      const bg = draft.theme.background;
      return (
        <div className="stack">
          <Select
            label="Background type"
            value={bg.type}
            options={[
              ["solid", "Solid colour"],
              ["gradient", "Gradient"],
              ["image", "Image"],
              ["video", "Muted video"],
            ]}
            onChange={(v) =>
              edit((d) => {
                const p = d.theme.palette;
                d.theme.background =
                  v === "solid"
                    ? { type: "solid", color: p.surface }
                    : v === "gradient"
                      ? { type: "gradient", from: p.surface, to: p.primary, angle: 160 }
                      : v === "image"
                        ? { type: "image", imageUrl: "", overlay: 0.45, blurPx: 0 }
                        : { type: "video", videoUrl: "", overlay: 0.5, blurPx: 0 };
              })
            }
          />
          {bg.type === "solid" && <Color label="Colour" value={bg.color} onChange={(v) => edit((d) => void ((d.theme.background as any).color = v))} />}
          {bg.type === "gradient" && (
            <>
              <div className="grid-2">
                <Color label="From" value={bg.from} onChange={(v) => edit((d) => void ((d.theme.background as any).from = v))} />
                <Color label="To" value={bg.to} onChange={(v) => edit((d) => void ((d.theme.background as any).to = v))} />
              </div>
              <Range label="Angle" min={0} max={360} step={5} value={bg.angle} onChange={(v) => edit((d) => void ((d.theme.background as any).angle = v))} suffix="°" />
            </>
          )}
          {(bg.type === "image" || bg.type === "video") && (
            <>
              {bg.type === "image" ? (
                <MediaField label="Image" value={bg.imageUrl} kind="image" onChange={(v) => edit((d) => void ((d.theme.background as any).imageUrl = v))} />
              ) : (
                <>
                  <MediaField label="Video (MP4/WebM, always muted)" value={bg.videoUrl} kind="video" onChange={(v) => edit((d) => void ((d.theme.background as any).videoUrl = v))} />
                  <MediaField label="Poster image (shown with reduced motion)" value={bg.posterUrl} kind="image" onChange={(v) => edit((d) => void ((d.theme.background as any).posterUrl = v || undefined))} />
                </>
              )}
              <Range label="Darken overlay" min={0} max={1} step={0.05} value={bg.overlay} onChange={(v) => edit((d) => void ((d.theme.background as any).overlay = v))} />
              <Range label="Blur" min={0} max={24} step={1} value={bg.blurPx} onChange={(v) => edit((d) => void ((d.theme.background as any).blurPx = v))} suffix="px" />
            </>
          )}
        </div>
      );
    }
    case "button":
      return (
        <div className="stack">
          <Text label="Button label" value={draft.button.label} max={24} onChange={(v) => edit((d) => void (d.button.label = v))} />
          <Select label="Shape" value={draft.button.shape} options={BUTTON_SHAPES.map((s) => [s, s])} onChange={(v) => edit((d) => void (d.button.shape = v as any))} />
          <div className="grid-2">
            <Color label="Button colour" value={draft.button.color} onChange={(v) => edit((d) => void (d.button.color = v))} />
            <Color label="Label colour" value={draft.button.textColor} onChange={(v) => edit((d) => void (d.button.textColor = v))} />
          </div>
          <ContrastNote fg={draft.button.textColor} bg={draft.button.color} />
          <Select label="Idle animation" value={draft.button.animation} options={BUTTON_ANIMATIONS.map((s) => [s, s])} onChange={(v) => edit((d) => void (d.button.animation = v as any))} />
        </div>
      );
    case "decor":
      return (
        <div className="stack">
          <Select label="Motion preset" value={draft.decor.preset} options={ANIMATION_PRESETS.map((s) => [s, s])} onChange={(v) => edit((d) => void (d.decor.preset = v as any))} />
          <Range label="Motion intensity" min={0} max={1} step={0.05} value={draft.decor.intensity} onChange={(v) => edit((d) => void (d.decor.intensity = v))} />
          <p className="muted small">
            Up to 8 transparent images. They float behind platform controls and never cover them. Visitors who prefer reduced motion see them still.
            {draft.template === "neon-music" && " In this template the first image becomes the spinning album cover."}
          </p>
          {draft.decor.assets.map((a, i) => (
            <fieldset key={i} className="decor-edit">
              <legend>
                Image {i + 1}
                <button type="button" className="linkish" onClick={() => edit((d) => void d.decor.assets.splice(i, 1))}>
                  Remove
                </button>
              </legend>
              <MediaField label="Image" value={a.url} kind="image" onChange={(v) => edit((d) => void (d.decor.assets[i].url = v))} />
              <Text label="Description (for screen readers; blank if decorative)" value={a.alt ?? ""} max={80} onChange={(v) => edit((d) => void (d.decor.assets[i].alt = v || undefined))} />
              <div className="grid-2">
                <Range label="Left / right" min={-10} max={110} step={1} value={a.x} onChange={(v) => edit((d) => void (d.decor.assets[i].x = v))} suffix="%" />
                <Range label="Up / down" min={-10} max={110} step={1} value={a.y} onChange={(v) => edit((d) => void (d.decor.assets[i].y = v))} suffix="%" />
                <Range label="Size" min={2} max={60} step={1} value={a.size} onChange={(v) => edit((d) => void (d.decor.assets[i].size = v))} />
                <Range label="Rotation" min={-180} max={180} step={1} value={a.rotation} onChange={(v) => edit((d) => void (d.decor.assets[i].rotation = v))} suffix="°" />
                <Range label="Depth" min={0} max={1} step={0.05} value={a.depth} onChange={(v) => edit((d) => void (d.decor.assets[i].depth = v))} />
                <Range label="Opacity" min={0.05} max={1} step={0.05} value={a.opacity} onChange={(v) => edit((d) => void (d.decor.assets[i].opacity = v))} />
              </div>
            </fieldset>
          ))}
          {draft.decor.assets.length < 8 && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => edit((d) => void d.decor.assets.push({ url: "/demo/sticker-star.svg", x: 50, y: 20, size: 12, rotation: 0, depth: 0.5, opacity: 1 }))}
            >
              Add floating image
            </button>
          )}
        </div>
      );
    case "experience":
      return <ExperienceEditor draft={draft} edit={edit} />;
    case "links":
      return (
        <div className="stack">
          <p className="muted small">Optional profile links, shown in your button experience. https only.</p>
          {draft.socials.map((s, i) => (
            <div key={i} className="grid-2">
              <Select label="Platform" value={s.platform} options={SOCIAL_PLATFORMS.map((p) => [p, p])} onChange={(v) => edit((d) => void (d.socials[i].platform = v as any))} />
              <Text label="URL" value={s.url} max={300} onChange={(v) => edit((d) => void (d.socials[i].url = v))} />
              <button type="button" className="linkish" onClick={() => edit((d) => void d.socials.splice(i, 1))}>
                Remove
              </button>
            </div>
          ))}
          {draft.socials.length < 5 && (
            <button type="button" className="btn btn-ghost" onClick={() => edit((d) => void d.socials.push({ platform: "website", url: "https://" }))}>
              Add link
            </button>
          )}
        </div>
      );
  }
}

function ExperienceEditor({ draft, edit }: { draft: CampaignConfig; edit: (fn: (d: CampaignConfig) => void) => void }) {
  const e = draft.experience;
  const [yt, setYt] = useState(e.type === "youtube" ? `https://youtu.be/${e.videoId}` : "");
  return (
    <div className="stack">
      <Select
        label="What happens when someone presses your button"
        value={e.type}
        options={[
          ["message", "Big animated message"],
          ["link", "Link preview"],
          ["youtube", "YouTube video"],
          ["video", "Uploaded short video"],
          ["image", "Poster / image"],
        ]}
        onChange={(v) =>
          edit((d) => {
            const title = "title" in d.experience && d.experience.title ? d.experience.title : d.headline;
            d.experience =
              v === "message"
                ? { type: "message", body: d.subhead || "Hello!", title }
                : v === "link"
                  ? { type: "link", url: "https://", title, ctaLabel: "Visit" }
                  : v === "youtube"
                    ? { type: "youtube", videoId: "", title }
                    : v === "video"
                      ? { type: "video", videoUrl: "", title }
                      : { type: "image", imageUrl: "", title };
          })
        }
      />
      {e.type === "message" && (
        <>
          <Text label="Title (optional)" value={e.title ?? ""} max={80} onChange={(v) => edit((d) => void ((d.experience as any).title = v || undefined))} />
          <Text label="Message" value={e.body} max={240} multiline onChange={(v) => edit((d) => void ((d.experience as any).body = v))} />
        </>
      )}
      {e.type === "youtube" && (
        <label className="field">
          <span>YouTube link</span>
          <input
            value={yt}
            onChange={(ev) => {
              setYt(ev.target.value);
              const id = parseYouTubeId(ev.target.value);
              edit((d) => void ((d.experience as any).videoId = id ?? ""));
            }}
            placeholder="https://youtu.be/…"
          />
          <small>{e.videoId ? `Video id: ${e.videoId}` : "Paste a youtube.com or youtu.be link."} Played with youtube-nocookie.com.</small>
        </label>
      )}
      {e.type === "video" && (
        <>
          <MediaField label="Video (MP4/WebM)" value={e.videoUrl} kind="video" onChange={(v) => edit((d) => void ((d.experience as any).videoUrl = v))} />
          <MediaField label="Poster image" value={e.posterUrl} kind="image" onChange={(v) => edit((d) => void ((d.experience as any).posterUrl = v || undefined))} />
        </>
      )}
      {e.type === "image" && <MediaField label="Poster image" value={e.imageUrl} kind="image" onChange={(v) => edit((d) => void ((d.experience as any).imageUrl = v))} />}
      {e.type === "link" && (
        <>
          <Text label="Destination URL" value={e.url} max={500} onChange={(v) => edit((d) => void ((d.experience as any).url = v))} hint="Visitors see the domain before they click. We never redirect automatically." />
          <MediaField label="Preview image" value={e.imageUrl} kind="image" onChange={(v) => edit((d) => void ((d.experience as any).imageUrl = v || undefined))} />
        </>
      )}
      {e.type !== "message" && <Text label="Title" value={e.title} max={80} onChange={(v) => edit((d) => void ((d.experience as any).title = v))} />}
      {e.type !== "message" && (
        <Text label="Description" value={e.description ?? ""} max={200} multiline onChange={(v) => edit((d) => void ((d.experience as any).description = v || undefined))} />
      )}
      {e.type === "link" ? (
        <Text label="Button text" value={e.ctaLabel} max={28} onChange={(v) => edit((d) => void ((d.experience as any).ctaLabel = v))} />
      ) : (
        <div className="grid-2">
          <Text label="Call-to-action text (optional)" value={e.ctaLabel ?? ""} max={28} onChange={(v) => edit((d) => void ((d.experience as any).ctaLabel = v || undefined))} />
          <Text label="Call-to-action URL (optional)" value={e.ctaUrl ?? ""} max={500} onChange={(v) => edit((d) => void ((d.experience as any).ctaUrl = v || undefined))} />
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ inputs

function Text({ label, value, onChange, max, multiline, hint }: { label: string; value: string; onChange: (v: string) => void; max: number; multiline?: boolean; hint?: string }) {
  return (
    <label className="field">
      <span>
        {label} <em className="count">{value.length}/{max}</em>
      </span>
      {multiline ? <textarea value={value} rows={3} maxLength={max} onChange={(e) => onChange(e.target.value)} /> : <input value={value} maxLength={max} onChange={(e) => onChange(e.target.value)} />}
      {hint && <small>{hint}</small>}
    </label>
  );
}

function Color({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const valid = /^#[0-9a-fA-F]{6}$/.test(value);
  return (
    <label className="field color-field">
      <span>{label}</span>
      <div className="color-row">
        <input type="color" value={valid ? value : "#000000"} onChange={(e) => onChange(e.target.value)} aria-label={`${label} picker`} />
        <input value={value} onChange={(e) => onChange(e.target.value.trim())} maxLength={7} aria-label={`${label} hex`} spellCheck={false} />
      </div>
    </label>
  );
}

function Select({ label, value, options, onChange }: { label: string; value: string; options: (readonly [string, string])[] | [string, string][]; onChange: (v: string) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

function Range({ label, value, onChange, min, max, step, suffix = "" }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; step: number; suffix?: string }) {
  return (
    <label className="field range-field">
      <span>
        {label} <em className="count">{Number.isInteger(step) ? value : value.toFixed(2)}{suffix}</em>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

function MediaField({ label, value, onChange, kind }: { label: string; value: string | undefined; onChange: (v: string) => void; kind: "image" | "video" }) {
  const [rights, setRights] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const upload = async (file: File) => {
    setBusy(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("rights", rights ? "yes" : "no");
      const res = await fetch("/api/uploads", { method: "POST", body: fd });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Upload failed");
      onChange(j.url);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };
  return (
    <div className="field media-field">
      <span>{label}</span>
      <input value={value ?? ""} onChange={(e) => onChange(e.target.value)} placeholder="https://… or upload" spellCheck={false} />
      <div className="media-row">
        <label className="check small">
          <input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} />
          <span>I own or have the rights to use this file</span>
        </label>
        <label className={`btn btn-ghost btn-sm ${!rights || busy ? "is-disabled" : ""}`}>
          {busy ? "Uploading…" : "Upload"}
          <input
            ref={inputRef}
            type="file"
            hidden
            disabled={!rights || busy}
            accept={kind === "image" ? "image/png,image/jpeg,image/webp,image/gif" : "video/mp4,video/webm"}
            onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
          />
        </label>
      </div>
      <small>{kind === "image" ? "PNG, JPEG, WebP or GIF. Transparent PNG/WebP work best for floating images." : "MP4 or WebM, up to 8 MB."}</small>
      {err && <small className="form-error">{err}</small>}
    </div>
  );
}

// ------------------------------------------------------------------ contrast

function bgColourFor(c: CampaignConfig): string {
  const b = c.theme.background;
  return b.type === "solid" ? b.color : b.type === "gradient" ? b.from : "#000000";
}

function lum(hex: string): number | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex) ?? /^#([0-9a-f]{3})$/i.exec(hex);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((x) => x + x).join("");
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ContrastNote({ fg, bg }: { fg: string; bg: string }) {
  const a = lum(fg);
  const b = lum(bg);
  if (a === null || b === null) return null;
  const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  const ok = ratio >= 4.5;
  return (
    <p className={`small ${ok ? "muted" : "form-error"}`}>
      Contrast {ratio.toFixed(1)}:1 {ok ? "— readable." : "— too low for small text. Aim for 4.5:1 or more."}
    </p>
  );
}
