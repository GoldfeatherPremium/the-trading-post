import { BadgeCheck, Building2, Crown, ShieldCheck, Sparkles } from "lucide-react";

type Tier = "unverified" | "verified" | "business" | "premium";

const TIERS: Record<
  Tier,
  { label: string; cls: string; Icon: typeof BadgeCheck }
> = {
  unverified: {
    label: "Unverified",
    cls: "bg-muted text-muted-foreground border-border",
    Icon: ShieldCheck,
  },
  verified: {
    label: "Verified",
    cls: "bg-blue-500/15 text-blue-400 border-blue-500/40",
    Icon: BadgeCheck,
  },
  business: {
    label: "Business",
    cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/40",
    Icon: Building2,
  },
  premium: {
    label: "Premium",
    cls: "bg-amber-500/15 text-amber-400 border-amber-500/40",
    Icon: Crown,
  },
};

const LEVELS: Record<number, { label: string; cls: string }> = {
  1: { label: "Bronze", cls: "bg-orange-700/25 text-orange-300 border-orange-700/50" },
  2: { label: "Silver", cls: "bg-slate-400/20 text-slate-200 border-slate-400/40" },
  3: { label: "Gold", cls: "bg-yellow-500/20 text-yellow-300 border-yellow-500/40" },
  4: { label: "Platinum", cls: "bg-cyan-400/20 text-cyan-200 border-cyan-400/40" },
  5: { label: "Diamond", cls: "bg-fuchsia-500/20 text-fuchsia-200 border-fuchsia-500/40" },
};

export function VerificationBadge({
  tier,
  size = "sm",
  showLabel = true,
}: {
  tier: Tier;
  size?: "xs" | "sm";
  showLabel?: boolean;
}) {
  if (tier === "unverified") return null;
  const meta = TIERS[tier];
  const Icon = meta.Icon;
  const dims = size === "xs" ? "size-3" : "size-3.5";
  const pad = size === "xs" ? "px-1.5 py-0.5 text-[9px]" : "px-2 py-0.5 text-[10px]";
  return (
    <span
      title={`${meta.label} seller`}
      className={`inline-flex items-center gap-1 rounded-full border font-bold ${meta.cls} ${pad}`}
    >
      <Icon className={dims} strokeWidth={2.5} />
      {showLabel && <span>{meta.label}</span>}
    </span>
  );
}

export function LevelBadge({
  level,
  size = "sm",
}: {
  level: number;
  size?: "xs" | "sm";
}) {
  const meta = LEVELS[Math.min(5, Math.max(1, level))] ?? LEVELS[1];
  const pad = size === "xs" ? "px-1.5 py-0.5 text-[9px]" : "px-2 py-0.5 text-[10px]";
  return (
    <span
      title={`${meta.label} tier seller`}
      className={`inline-flex items-center gap-1 rounded-full border font-bold ${meta.cls} ${pad}`}
    >
      <Sparkles className={size === "xs" ? "size-3" : "size-3.5"} strokeWidth={2.5} />
      {meta.label}
    </span>
  );
}

export function TrustScore({ score }: { score: number }) {
  const cls =
    score >= 90
      ? "text-fuchsia-300"
      : score >= 75
        ? "text-cyan-300"
        : score >= 60
          ? "text-yellow-300"
          : score >= 40
            ? "text-orange-300"
            : "text-muted-foreground";
  return (
    <span className={`font-mono text-[10px] font-bold ${cls}`} title="Trust score (0–100)">
      TS {score.toFixed(0)}
    </span>
  );
}

export function SellerBadge({
  tier,
  level,
  score,
  size = "sm",
}: {
  tier: Tier;
  level: number;
  score?: number;
  size?: "xs" | "sm";
}) {
  return (
    <span className="inline-flex items-center gap-1 flex-wrap">
      <VerificationBadge tier={tier} size={size} />
      <LevelBadge level={level} size={size} />
      {typeof score === "number" && score > 0 && <TrustScore score={score} />}
    </span>
  );
}
