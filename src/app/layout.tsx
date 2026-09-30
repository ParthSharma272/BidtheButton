import type { Metadata, Viewport } from "next";
import { Inter, Space_Grotesk, Archivo, Archivo_Black, JetBrains_Mono, Martian_Mono, Nunito, Fraunces } from "next/font/google";
import "./stage.css";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const grotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-grotesk", display: "swap" });
const display = Archivo_Black({ subsets: ["latin"], weight: "400", variable: "--font-display", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });
const rounded = Nunito({ subsets: ["latin"], variable: "--font-rounded", display: "swap" });
// Platform faces: Archivo (width axis for engraved labels) and Martian Mono for every number.
const archivo = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--font-archivo", display: "swap" });
const martian = Martian_Mono({ subsets: ["latin"], axes: ["wdth"], variable: "--font-martian", display: "swap" });
const serif = Fraunces({ subsets: ["latin"], variable: "--font-serif", display: "swap" });

export const metadata: Metadata = {
  title: "THE BUTTON",
  description: "One button. One owner. The internet is watching. Own the button. Make this page yours. Until someone pays more.",
};

export const viewport: Viewport = {
  themeColor: "#e4e6e9",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={[inter.variable, grotesk.variable, display.variable, mono.variable, rounded.variable, serif.variable, archivo.variable, martian.variable].join(" ")}>
      <body>{children}</body>
    </html>
  );
}
