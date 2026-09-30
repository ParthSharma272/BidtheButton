import type { CampaignConfig, TemplateId } from "../server/campaign-schema.ts";

/**
 * Starting points for the studio. Each template is a complete, valid campaign
 * config; the owner edits from there. The template id also selects a distinct
 * stage layout in the renderer, so these are different environments, not
 * recolours of one page.
 */

export interface TemplateMeta {
  id: TemplateId;
  label: string;
  blurb: string;
  defaults: CampaignConfig;
}

export const TEMPLATE_LIST: TemplateMeta[] = [
  {
    id: "floating-products",
    label: "Floating products",
    blurb: "Product shots drift around the button in depth. Built for brands.",
    defaults: {
      template: "floating-products",
      brand: { name: "Your Brand" },
      headline: "Taste the loudest blue on the internet",
      subhead: "Press the button to see what we poured into this one.",
      theme: {
        font: "grotesk",
        headlineFont: "display",
        palette: { primary: "#0a4bff", accent: "#7fe3ff", text: "#ffffff", muted: "#b8d3ff", surface: "#06205f" },
        background: { type: "gradient", from: "#0a2a8f", via: "#0a4bff", to: "#031447", angle: 170 },
      },
      button: { label: "Crack one open", shape: "circle", color: "#ffffff", textColor: "#0a2a8f", animation: "breathe" },
      decor: {
        preset: "float",
        intensity: 0.7,
        assets: [
          { url: "/demo/nova-bottle.svg", x: 14, y: 30, size: 22, rotation: -14, depth: 0.8, opacity: 1, alt: "Bottle" },
          { url: "/demo/nova-can.svg", x: 84, y: 26, size: 18, rotation: 12, depth: 0.6, opacity: 1, alt: "Can" },
          { url: "/demo/nova-bottle.svg", x: 88, y: 76, size: 14, rotation: 22, depth: 0.3, opacity: 0.85, alt: "" },
          { url: "/demo/nova-can.svg", x: 10, y: 80, size: 12, rotation: -24, depth: 0.2, opacity: 0.8, alt: "" },
        ],
      },
      experience: { type: "message", title: "Hello, internet", body: "Tell visitors what you want them to know." },
      socials: [],
    },
  },
  {
    id: "neon-music",
    label: "Neon music release",
    blurb: "Dark stage, glowing type, spinning artwork. Built for a drop.",
    defaults: {
      template: "neon-music",
      brand: { name: "Artist Name" },
      headline: "New single out now",
      subhead: "Press play before anyone else does.",
      theme: {
        font: "grotesk",
        headlineFont: "display",
        palette: { primary: "#ff2bd6", accent: "#29f0ff", text: "#f6f0ff", muted: "#a99bc9", surface: "#120a24" },
        background: { type: "gradient", from: "#05020d", via: "#1b0636", to: "#05020d", angle: 200 },
      },
      button: { label: "Play it", shape: "circle", color: "#ff2bd6", textColor: "#0b0215", animation: "glow" },
      decor: {
        preset: "orbit",
        intensity: 0.6,
        assets: [{ url: "/demo/luna-cover.svg", x: 76, y: 46, size: 42, rotation: 0, depth: 0.4, opacity: 1, alt: "Album artwork" }],
      },
      experience: { type: "message", title: "Out now", body: "Tell visitors where to listen." },
      socials: [],
    },
  },
  {
    id: "minimal-launch",
    label: "Minimal product launch",
    blurb: "Quiet grid, crisp type, product screenshots rising into view.",
    defaults: {
      template: "minimal-launch",
      brand: { name: "Product" },
      headline: "The calmest way to ship",
      subhead: "Launching today. Press the button for a first look.",
      theme: {
        font: "inter",
        palette: { primary: "#111111", accent: "#3b5bfd", text: "#0e0e10", muted: "#5b5d66", surface: "#ffffff" },
        background: { type: "solid", color: "#f4f3ef" },
      },
      button: { label: "See the launch", shape: "pill", color: "#111111", textColor: "#ffffff", animation: "shimmer" },
      decor: {
        preset: "drift",
        intensity: 0.35,
        assets: [
          { url: "/demo/orbit-screen-1.svg", x: 18, y: 64, size: 30, rotation: -4, depth: 0.3, opacity: 1, alt: "Product screenshot" },
          { url: "/demo/orbit-screen-2.svg", x: 82, y: 60, size: 28, rotation: 5, depth: 0.5, opacity: 1, alt: "Product screenshot" },
        ],
      },
      experience: { type: "message", title: "We just launched", body: "Tell visitors what you built." },
      socials: [],
    },
  },
  {
    id: "playful-creator",
    label: "Playful creator",
    blurb: "Stickers, wobble, big colour. Built for personality.",
    defaults: {
      template: "playful-creator",
      brand: { name: "Creator" },
      headline: "New video just dropped!!",
      subhead: "Press it. You know you want to.",
      theme: {
        font: "rounded",
        headlineFont: "display",
        palette: { primary: "#ff5a1f", accent: "#ffd23f", text: "#1d1033", muted: "#4d3a6b", surface: "#fff4e0" },
        background: { type: "gradient", from: "#ffd23f", via: "#ff8fb1", to: "#8f7bff", angle: 135 },
      },
      button: { label: "Watch now", shape: "squircle", color: "#1d1033", textColor: "#ffd23f", animation: "pulse" },
      decor: {
        preset: "confetti",
        intensity: 0.8,
        assets: [
          { url: "/demo/sticker-star.svg", x: 16, y: 24, size: 14, rotation: -12, depth: 0.7, opacity: 1, alt: "" },
          { url: "/demo/sticker-heart.svg", x: 86, y: 30, size: 12, rotation: 16, depth: 0.5, opacity: 1, alt: "" },
          { url: "/demo/sticker-bolt.svg", x: 80, y: 80, size: 13, rotation: -8, depth: 0.6, opacity: 1, alt: "" },
        ],
      },
      experience: { type: "message", title: "Hiii", body: "Say something to the whole internet." },
      socials: [],
    },
  },
  {
    id: "bold-poster",
    label: "Bold poster",
    blurb: "Type as architecture. The headline fills the whole wall.",
    defaults: {
      template: "bold-poster",
      brand: { name: "Poster" },
      headline: "SAY IT LOUDER",
      subhead: "One message, the whole screen.",
      theme: {
        font: "grotesk",
        headlineFont: "display",
        palette: { primary: "#ff3b1f", accent: "#111111", text: "#111111", muted: "#3a3a3a", surface: "#f1e9da" },
        background: { type: "solid", color: "#f1e9da" },
      },
      button: { label: "Press", shape: "circle", color: "#ff3b1f", textColor: "#111111", animation: "none" },
      decor: { preset: "none", intensity: 0.3, assets: [] },
      experience: { type: "message", title: "", body: "Your message here." },
      socials: [],
    },
  },
  {
    id: "animated-message",
    label: "Animated message",
    blurb: "Your words, moving. A personal note for the whole internet.",
    defaults: {
      template: "animated-message",
      brand: { name: "Someone" },
      headline: "Hello to whoever is reading this",
      subhead: "I bought the internet's button to tell you something.",
      theme: {
        font: "serif",
        palette: { primary: "#f7c948", accent: "#7ee8c7", text: "#fbf7ef", muted: "#b9b2a4", surface: "#1b1a17" },
        background: { type: "gradient", from: "#1b1a17", to: "#2b2620", angle: 180 },
      },
      button: { label: "Read it", shape: "pill", color: "#f7c948", textColor: "#1b1a17", animation: "breathe" },
      decor: { preset: "drift", intensity: 0.4, assets: [] },
      experience: { type: "message", title: "", body: "Have a good day. Seriously." },
      socials: [],
    },
  },
];

export const templateById = (id: string) => TEMPLATE_LIST.find((t) => t.id === id) ?? TEMPLATE_LIST[0];

export const cloneTemplate = (id: string): CampaignConfig => structuredClone(templateById(id).defaults);
