import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { archivedReign } from "@/server/public-state.ts";
import { ArchiveView } from "@/components/ArchiveView.tsx";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ ordinal: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const n = Number((await params).ordinal);
  const r = Number.isInteger(n) ? archivedReign(n) : null;
  if (!r) return { title: "THE BUTTON" };
  const brand = r.suspended ? "Suspended campaign" : r.config?.brand.name;
  const title = r.ongoing ? `${brand} owns THE BUTTON` : `${brand} owned THE BUTTON (takeover #${r.ordinal}, archived)`;
  return {
    title,
    description: r.ongoing ? "Live now on THE BUTTON." : "A historical record from THE BUTTON. This is not the current owner.",
    openGraph: { title, images: [`/api/card/${r.ordinal}`] },
    twitter: { card: "summary_large_image", title, images: [`/api/card/${r.ordinal}`] },
  };
}

export default async function ArchivePage({ params }: Props) {
  const n = Number((await params).ordinal);
  const r = Number.isInteger(n) ? archivedReign(n) : null;
  if (!r) notFound();
  return <ArchiveView reign={r} />;
}
