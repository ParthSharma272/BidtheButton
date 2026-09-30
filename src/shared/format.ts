export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec.toString().padStart(2, "0")}s`;
  return `${sec}s`;
}

/** Clock-style duration for the live reign timer. */
export function formatClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return d > 0 ? `${d}d ${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(h)}:${pad(m)}:${pad(sec)}`;
}

export function formatCount(n: number): string {
  return n.toLocaleString("en-IN");
}

/** Client-safe INR formatting (mirrors server/pricing.formatPaise). */
export function inr(paise: number): string {
  const hasPaise = paise % 100 !== 0;
  return (
    "₹" +
    new Intl.NumberFormat("en-IN", { minimumFractionDigits: hasPaise ? 2 : 0, maximumFractionDigits: hasPaise ? 2 : 0 }).format(paise / 100)
  );
}

export function timeAgo(ts: number, now = Date.now()): string {
  const s = Math.floor((now - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
