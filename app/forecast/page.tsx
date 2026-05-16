"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowLeft, Trophy, Sparkles, TrendingUp, Crown, Target,
  ChevronRight, Activity, Users,
} from "lucide-react";

type GroupStanding = {
  position: number; code: string; name: string; flag: string;
  prob_first: number; prob_top2: number; prob_top3: number;
  exp_points: number; exp_gd: number;
};

type Forecast = {
  generated_at: number;
  group_standings: Record<string, GroupStanding[]>;
  champions: Array<{ code: string; name: string; flag: string; prob: number }>;
  team_summary: Array<{
    code: string; name: string; flag: string; group: string;
    elo: number; fifa_rank: number | null; is_host: boolean;
    prob_advance: number; prob_top2: number; prob_first: number; prob_champion: number;
  }>;
};

type BracketSlugData = {
  slug: string;
  title: string;
  stage: string;
  bracket_positions: string;
  matchups: Array<{ homeFlag: string; homeName: string; awayFlag: string; awayName: string; prob: number }>;
  team_reach: Array<{ flag: string; name: string; prob: number }>;
};

const BRACKET_SLUGS = {
  R16: [
    { slug: "afc-cup-2a-vs-2c",          label: "M37 · 2A v 2C" },
    { slug: "afc-cup-27-1b-vs-3acd-38",  label: "M38 · 1B v 3ACD" },
    { slug: "afc-cup-27-1d-vsbef-39",    label: "M39 · 1D v 3BEF" },
    { slug: "afc-cup-27-1a-vs-3cde-40",  label: "M40 · 1A v 3CDE" },
    { slug: "afc-cup-27-1f-vs-2e-41",    label: "M41 · 1F v 2E" },
    { slug: "afc-cup-2b-v-2f-42",        label: "M42 · 2B v 2F" },
    { slug: "afc-cup-27-1e-vs-2d-43",    label: "M43 · 1E v 2D" },
    { slug: "afc-cup-27-1c-vs-3abf-44",  label: "M44 · 1C v 3ABF" },
  ],
  QF: [
    { slug: "afc-cup-27-w37-v-w39-45",   label: "QF45 · W37 v W39" },
    { slug: "afc-cup-27-w38-v-w41-46",   label: "QF46 · W38 v W41" },
    { slug: "afc-cup-27-w44-v-w43-47",   label: "QF47 · W44 v W43" },
    { slug: "afc-cup-27-w40-v-w42-48",   label: "QF48 · W40 v W42" },
  ],
  SF: [
    { slug: "afc-cup-27-w45-v-w46-49",   label: "SF49 · W45 v W46" },
    { slug: "afc-cup-27-w47-v-w48-50",   label: "SF50 · W47 v W48" },
  ],
  FINAL: [
    { slug: "afc-cup-27-final-50",        label: "FINAL" },
  ],
};

export default function ForecastPage() {
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [slugData, setSlugData] = useState<Record<string, BracketSlugData>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/forecast", { cache: "no-store" })
      .then(r => r.json()).then(setForecast)
      .finally(() => setLoading(false));
  }, []);

  // Lazy-fetch matchup data for each bracket slot
  useEffect(() => {
    const all = [...BRACKET_SLUGS.R16, ...BRACKET_SLUGS.QF, ...BRACKET_SLUGS.SF, ...BRACKET_SLUGS.FINAL];
    Promise.all(all.map(({ slug }) =>
      fetch(`/api/insights/${slug}`).then(r => r.json()).then(d => ({ slug, d }))
        .catch(() => ({ slug, d: null }))
    )).then(results => {
      const map: Record<string, BracketSlugData> = {};
      for (const { slug, d } of results) {
        if (!d || d.error) continue;
        map[slug] = {
          slug,
          title: d.event?.title || slug,
          stage: d.event?.stage || "",
          bracket_positions: (d.bracket?.positions || []).join(" v "),
          matchups: d.matchups || [],
          team_reach: d.team_reach_prob || [],
        };
      }
      setSlugData(map);
    });
  }, []);

  if (loading || !forecast) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 backdrop-blur-xl bg-slate-950/60 border-b border-white/5">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-4 flex items-center gap-3">
          <Link href="/" className="text-slate-400 hover:text-white transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="flex items-center gap-3">
            <Crown className="w-6 h-6 text-yellow-400" />
            <div>
              <div className="text-base sm:text-xl font-bold tracking-tight">Tournament Forecast</div>
              <div className="text-[10px] sm:text-xs text-slate-400">
                10,000 Monte Carlo simulations · per-match Elo + draws + goal diff · official AFC bracket
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 py-6 space-y-8">

        {/* ── CHAMPION ODDS ── */}
        <section>
          <h2 className="text-lg font-bold flex items-center gap-2 mb-3">
            <Trophy className="w-5 h-5 text-yellow-400" /> Champion odds
          </h2>
          <div className="glass rounded-2xl p-4">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2">
              {forecast.champions.slice(0, 18).map((c, i) => (
                <motion.div
                  key={c.code}
                  initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.015 }}
                  className={"rounded-xl p-3 border " +
                    (i === 0 ? "bg-gradient-to-br from-yellow-500/15 to-amber-600/5 border-yellow-500/40"
                      : i < 4 ? "bg-indigo-500/10 border-indigo-500/30"
                      : "bg-slate-800/30 border-white/5")}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="text-xs text-slate-400">#{i + 1}</div>
                    {i === 0 && <Crown className="w-3.5 h-3.5 text-yellow-400" />}
                  </div>
                  <div className="text-2xl mb-1">{c.flag}</div>
                  <div className="text-sm font-semibold truncate">{c.name}</div>
                  <div className="mt-1 flex items-baseline gap-1">
                    <div className="text-xl font-bold tabular-nums text-yellow-300">
                      {(c.prob * 100).toFixed(1)}%
                    </div>
                  </div>
                  <div className="w-full h-1 bg-slate-700/40 rounded-full overflow-hidden mt-1.5">
                    <div className="h-full bg-gradient-to-r from-yellow-500 to-amber-400"
                      style={{ width: `${Math.min(100, c.prob * 100 * 5)}%` }} />
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* ── GROUP STANDINGS FORECAST ── */}
        <section>
          <h2 className="text-lg font-bold flex items-center gap-2 mb-3">
            <Users className="w-5 h-5 text-indigo-400" /> Predicted group standings
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {Object.entries(forecast.group_standings).map(([g, teams]) => (
              <div key={g} className="glass rounded-2xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold text-base">Group {g}</h3>
                  <span className="text-[10px] text-slate-500">expected order</span>
                </div>
                <div className="space-y-1.5">
                  {teams.map((t) => (
                    <div key={t.code} className="flex items-center gap-2 text-sm">
                      <div className={"w-6 text-center text-xs font-semibold rounded " +
                        (t.position === 1 ? "bg-emerald-500/20 text-emerald-300"
                          : t.position === 2 ? "bg-green-500/15 text-green-300"
                          : t.position === 3 ? "bg-yellow-500/15 text-yellow-300"
                          : "bg-slate-700/30 text-slate-400")}>
                        {t.position}
                      </div>
                      <span className="text-lg">{t.flag}</span>
                      <span className="flex-1 truncate font-medium">{t.name}</span>
                      <span className="text-[10px] text-slate-500 tabular-nums">
                        {t.exp_points.toFixed(1)} pts
                      </span>
                      <div className="w-20 flex flex-col items-end">
                        <span className="text-[10px] text-emerald-400 tabular-nums">
                          {(t.prob_top2 * 100).toFixed(0)}% top 2
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── BRACKET PER-ROUND ── */}
        <section>
          <h2 className="text-lg font-bold flex items-center gap-2 mb-3">
            <Target className="w-5 h-5 text-purple-400" /> Knockout bracket forecast
          </h2>

          {(["R16", "QF", "SF", "FINAL"] as const).map(round => (
            <div key={round} className="mb-5">
              <h3 className="text-sm font-semibold text-slate-300 mb-2 sticky top-[68px] py-2 backdrop-blur bg-slate-950/40 z-10">
                <span className={"text-xs px-2 py-0.5 rounded mr-2 " +
                  (round === "FINAL" ? "bg-purple-500/20 text-purple-300"
                    : round === "SF" ? "bg-indigo-500/20 text-indigo-300"
                    : round === "QF" ? "bg-blue-500/20 text-blue-300"
                    : "bg-cyan-500/20 text-cyan-300")}>{round}</span>
                {round === "R16" ? "Round of 16" : round === "QF" ? "Quarter-finals" : round === "SF" ? "Semi-finals" : "FINAL"}
              </h3>
              <div className={"grid gap-3 " +
                (round === "R16" ? "grid-cols-1 md:grid-cols-2 xl:grid-cols-4"
                  : round === "QF" ? "grid-cols-1 md:grid-cols-2 xl:grid-cols-4"
                  : round === "SF" ? "grid-cols-1 md:grid-cols-2"
                  : "grid-cols-1")}>
                {BRACKET_SLUGS[round].map(({ slug, label }) => {
                  const d = slugData[slug];
                  return (
                    <div key={slug} className="glass rounded-xl p-3">
                      <div className="text-[10px] text-slate-500 mb-1">{label}</div>
                      <Link
                        href="/"
                        onClick={(e) => {
                          e.preventDefault();
                          if (typeof window !== "undefined") {
                            window.location.href = `/?open=${encodeURIComponent(slug)}`;
                          }
                        }}
                        className="text-sm font-semibold mb-2 hover:text-indigo-300 transition-colors flex items-center gap-1"
                      >
                        {d?.title || label} <ChevronRight className="w-3.5 h-3.5 opacity-50" />
                      </Link>
                      {d?.matchups && d.matchups.length > 0 ? (
                        <div className="space-y-1">
                          {d.matchups.slice(0, 4).map(m => (
                            <div key={`${m.homeName}-${m.awayName}`}
                              className="text-[11px] flex items-center gap-2">
                              <div className="flex-1 truncate">
                                <span>{m.homeFlag}</span> {m.homeName.slice(0, 8)} vs <span>{m.awayFlag}</span> {m.awayName.slice(0, 8)}
                              </div>
                              <div className="tabular-nums text-indigo-300 font-semibold w-10 text-right">
                                {(m.prob * 100).toFixed(1)}%
                              </div>
                            </div>
                          ))}
                          {d.matchups.length > 4 && (
                            <div className="text-[10px] text-slate-500">+{d.matchups.length - 4} more possible matchups</div>
                          )}
                        </div>
                      ) : (
                        <div className="text-[11px] text-slate-500">Loading matchups…</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </section>

        {/* ── TEAM TABLE ── */}
        <section>
          <h2 className="text-lg font-bold flex items-center gap-2 mb-3">
            <Sparkles className="w-5 h-5 text-indigo-400" /> All 24 teams · summary
          </h2>
          <div className="glass rounded-2xl p-3 overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-slate-500 border-b border-white/5">
                <tr>
                  <th className="text-left font-medium py-2 pl-2 pr-3">Team</th>
                  <th className="text-center font-medium py-2 pr-3">Group</th>
                  <th className="text-right font-medium py-2 pr-3">Elo</th>
                  <th className="text-right font-medium py-2 pr-3">FIFA</th>
                  <th className="text-right font-medium py-2 pr-3">Win Group</th>
                  <th className="text-right font-medium py-2 pr-3">Top 2</th>
                  <th className="text-right font-medium py-2 pr-3">Advance</th>
                  <th className="text-right font-medium py-2 pr-2">Win Cup</th>
                </tr>
              </thead>
              <tbody>
                {forecast.team_summary.map((t) => (
                  <tr key={t.code} className="border-b border-white/5 hover:bg-white/[0.02]">
                    <td className="py-1.5 pl-2 pr-3 flex items-center gap-2">
                      <span className="text-lg">{t.flag}</span>
                      <span className="font-medium">{t.name}</span>
                      {t.is_host && <span className="text-[9px] bg-amber-500/20 text-amber-300 px-1 rounded">HOST</span>}
                    </td>
                    <td className="text-center text-slate-400">{t.group}</td>
                    <td className="text-right tabular-nums text-slate-300">{t.elo}</td>
                    <td className="text-right tabular-nums text-slate-400">{t.fifa_rank ?? "—"}</td>
                    <td className="text-right tabular-nums">{(t.prob_first * 100).toFixed(0)}%</td>
                    <td className="text-right tabular-nums text-emerald-400">{(t.prob_top2 * 100).toFixed(0)}%</td>
                    <td className="text-right tabular-nums text-indigo-300">{(t.prob_advance * 100).toFixed(0)}%</td>
                    <td className="text-right tabular-nums font-semibold text-yellow-300">
                      {(t.prob_champion * 100).toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <div className="text-[11px] text-slate-500 pb-8 pt-2">
          Model: 10,000 Monte Carlo simulations with per-match Elo (W/D/L) +
          Poisson-style goal sampling for tie-breakers. Group standings use
          points → GD → goals for. The 4 best 3rd-placed teams advance via
          the official AFC/UEFA assignment table. Saudi Arabia gets a +70 Elo
          home-advantage bonus at every match.
        </div>
      </main>
    </div>
  );
}
