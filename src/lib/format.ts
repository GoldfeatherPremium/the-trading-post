export const usdt = (cents: number) =>
  `${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`;

export const usdtShort = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

export function countdown(until: number): string {
  const diff = until - Date.now();
  if (diff <= 0) return "expired";
  const s = Math.floor(diff / 1000);
  const days = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (days > 0) return `${days}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export const dateTime = (ts: number) =>
  new Date(ts).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export const ORDER_STATUS_META: Record<string, { label: string; cls: string }> = {
  awaiting_payment: { label: "Awaiting payment", cls: "bg-yellow-500/15 text-yellow-400" },
  paid: { label: "Paid", cls: "bg-blue-500/15 text-blue-400" },
  delivering: { label: "Delivering", cls: "bg-blue-500/15 text-blue-400" },
  delivered: { label: "Delivered", cls: "bg-accent/15 text-accent" },
  completed: { label: "Completed · warranty", cls: "bg-accent/15 text-accent" },
  released: { label: "Released", cls: "bg-accent/20 text-accent" },
  disputed: { label: "Disputed", cls: "bg-destructive/15 text-destructive" },
  refunded: { label: "Refunded", cls: "bg-destructive/15 text-destructive" },
  cancelled: { label: "Cancelled", cls: "bg-muted text-muted-foreground" },
  expired: { label: "Expired", cls: "bg-muted text-muted-foreground" },
};

export const PRODUCT_STATUS_META: Record<string, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "bg-muted text-muted-foreground" },
  pending_review: { label: "Pending review", cls: "bg-yellow-500/15 text-yellow-400" },
  active: { label: "Active", cls: "bg-accent/15 text-accent" },
  rejected: { label: "Rejected", cls: "bg-destructive/15 text-destructive" },
  paused: { label: "Paused", cls: "bg-muted text-muted-foreground" },
  out_of_stock: { label: "Out of stock", cls: "bg-yellow-500/15 text-yellow-400" },
};

export const GENERIC_STATUS_CLS: Record<string, string> = {
  pending: "bg-yellow-500/15 text-yellow-400",
  approved: "bg-accent/15 text-accent",
  sent: "bg-accent/20 text-accent",
  confirmed: "bg-accent/15 text-accent",
  confirming: "bg-blue-500/15 text-blue-400",
  rejected: "bg-destructive/15 text-destructive",
  open: "bg-destructive/15 text-destructive",
  seller_responded: "bg-yellow-500/15 text-yellow-400",
  resolved: "bg-accent/15 text-accent",
  expired: "bg-muted text-muted-foreground",
};
