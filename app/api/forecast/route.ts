/**
 * GET /api/forecast
 *
 * Returns the tournament-wide probability forecast:
 *   - group_standings : per-group expected positions with prob_first/top2/top3
 *   - champions       : per-team tournament-win probability
 *   - generated_at    : unix timestamp
 *
 * Numbers come from 10,000 Monte Carlo simulations cached at module load.
 */
import { NextResponse } from "next/server";
import { groupStandingsForecast, championProbs } from "@/lib/probabilities";
import { TEAMS } from "@/lib/teams";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const groupStandings = groupStandingsForecast();
  const champions = championProbs();

  // Build a per-team summary too (used by some UI views)
  const team_summary = TEAMS.map(t => {
    const g = groupStandings[t.group];
    const me = g.find(s => s.code === t.code)!;
    const champ = champions.find(c => c.code === t.code);
    return {
      code: t.code,
      name: t.name,
      flag: t.flag,
      group: t.group,
      elo: t.elo,
      fifa_rank: t.fifaRank,
      is_host: !!t.isHost,
      prob_advance: me.prob_top2 + (me.prob_top3 - me.prob_top2) * (4/6), // top2 + ~4/6 of best-3rds
      prob_top2: me.prob_top2,
      prob_first: me.prob_first,
      prob_champion: champ?.prob ?? 0,
    };
  }).sort((a, b) => b.prob_champion - a.prob_champion);

  return NextResponse.json({
    generated_at: Math.floor(Date.now() / 1000),
    group_standings: groupStandings,
    champions,
    team_summary,
  }, { headers: { "Cache-Control": "no-store" } });
}
