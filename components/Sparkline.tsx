"use client";

import { useEffect, useState } from "react";

type Point = { t: number; r: number; q: number };

const _cache = new Map<string, Point[]>();

/**
 * Tiny inline SVG sparkline showing ticket-remaining trend over last 24h.
 * Renders nothing until data loads (no layout shift — fixed 36px height).
 */
export function Sparkline({ slug, color = "#818cf8", height = 32 }: {
  slug: string; color?: string; height?: number;
}) {
  const [points, setPoints] = useState<Point[] | null>(_cache.get(slug) || null);

  useEffect(() => {
    if (_cache.has(slug)) return;
    let alive = true;
    fetch(`/api/sparkline/${encodeURIComponent(slug)}`, { cache: "no-store" })
      .then(r => r.json())
      .then(d => {
        if (alive && Array.isArray(d?.points)) {
          _cache.set(slug, d.points);
          setPoints(d.points);
        }
      })
      .catch(() => {/* */});
    return () => { alive = false; };
  }, [slug]);

  if (!points || points.length < 2) {
    return <div style={{ height }} className="opacity-30" />;
  }

  const W = 100, H = height;
  const minR = Math.min(...points.map(p => p.r));
  const maxR = Math.max(...points.map(p => p.r));
  const range = Math.max(1, maxR - minR);
  const minT = points[0].t;
  const maxT = points[points.length - 1].t;
  const tspan = Math.max(1, maxT - minT);

  const path = points.map((p, i) => {
    const x = ((p.t - minT) / tspan) * W;
    const y = H - ((p.r - minR) / range) * (H - 4) - 2;
    return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ");

  const areaPath = path + ` L ${W} ${H} L 0 ${H} Z`;

  const direction = points[points.length - 1].r - points[0].r;
  const trend = direction > 0 ? "↑" : direction < 0 ? "↓" : "→";
  const sold = points[0].r - points[points.length - 1].r;

  return (
    <div className="flex items-end gap-2">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
           width="100%" height={H}
           className="overflow-visible flex-1 min-w-0">
        <defs>
          <linearGradient id={`spark-${slug.replace(/[^a-z0-9]/gi, "")}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <path d={areaPath} fill={`url(#spark-${slug.replace(/[^a-z0-9]/gi, "")})`} />
        <path d={path} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <div className="text-[10px] text-slate-500 tabular-nums whitespace-nowrap leading-tight">
        <div className={direction < 0 ? "text-red-400" : direction > 0 ? "text-emerald-400" : ""}>
          {trend} {sold > 0 ? `−${sold}` : sold < 0 ? `+${-sold}` : "0"}
        </div>
        <div className="opacity-70">24h</div>
      </div>
    </div>
  );
}
