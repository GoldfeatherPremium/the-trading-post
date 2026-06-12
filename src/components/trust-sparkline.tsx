import { useQuery } from "@tanstack/react-query";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { getSellerTrustHistory } from "@/lib/api/trust";

/**
 * Compact 30-day trust score sparkline. Shows current score, delta vs the
 * oldest sample in the window, and an inline SVG line. Renders nothing when
 * there's no history yet (a single point can't form a trend).
 */
export function TrustSparkline({
  userId,
  currentScore,
  days = 30,
  className,
}: {
  userId: string;
  currentScore: number;
  days?: number;
  className?: string;
}) {
  const { data } = useQuery({
    queryKey: ["trustHistory", userId, days],
    queryFn: () => getSellerTrustHistory({ data: { userId, days } }),
    staleTime: 5 * 60_000,
  });
  const points = data?.points ?? [];
  if (points.length < 2) return null;

  const scores = points.map((p) => p.score);
  const min = Math.min(...scores, currentScore);
  const max = Math.max(...scores, currentScore);
  const range = Math.max(1, max - min);
  const w = 90;
  const h = 24;
  const path = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * w;
      const y = h - ((p.score - min) / range) * h;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const first = points[0].score;
  const last = points[points.length - 1].score;
  const delta = Math.round((last - first) * 10) / 10;
  const Trend = delta > 0.2 ? TrendingUp : delta < -0.2 ? TrendingDown : Minus;
  const trendCls =
    delta > 0.2
      ? "text-emerald-400"
      : delta < -0.2
        ? "text-destructive"
        : "text-muted-foreground";

  return (
    <div
      className={`inline-flex items-center gap-2 bg-secondary/60 border border-border rounded-full px-2.5 py-1 ${className ?? ""}`}
      title={`Trust trend over the last ${days} days`}
    >
      <svg width={w} height={h} className="opacity-90">
        <path d={path} fill="none" stroke="currentColor" strokeWidth={1.5} className="text-primary" />
      </svg>
      <span className={`inline-flex items-center gap-0.5 text-[10px] font-mono font-bold ${trendCls}`}>
        <Trend className="size-3" />
        {delta > 0 ? `+${delta}` : delta}
      </span>
    </div>
  );
}
