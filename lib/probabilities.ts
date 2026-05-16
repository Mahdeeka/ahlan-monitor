/**
 * AFC Asian Cup 2027 knockout-matchup probability forecaster.
 *
 * Model:
 *   - Each group plays a full 6-match round-robin (per real format).
 *   - Each match: outcome (W/D/L) sampled from a draw-aware Elo model.
 *     Saudi Arabia gets +70 host advantage on top of base Elo at every match.
 *   - Goals sampled from a Skellam-like model so we can break ties on GD.
 *   - Group standings: 1st by points, then by goal difference, then random
 *     tiebreak (real format uses head-to-head etc., we approximate).
 *   - 4 best 3rd-placed teams advance, ranked across all 6 third-place
 *     finishers by (points, GD), then assigned to R16 slots via the OFFICIAL
 *     24-team AFC/UEFA third-place advancement table (15 cases).
 *   - R16/QF/SF/Final winners sampled match-by-match.
 *
 * Output is a precomputed cache: for each KO slug, the top-N most likely
 * matchups (with %), and for each team the probability it appears in that
 * match slot.
 *
 * 10,000 simulations are run once at module load (~200ms server-side) with a
 * fixed seed so results are deterministic and identical across requests.
 */

import { TEAMS, GROUPS, type Team, type GroupId } from "./teams";

/* ─── Bracket structure (matches ahlan.sa published slot labels) ─────── */

export type BracketKind = "R16" | "QF" | "SF" | "FINAL";

export type BracketSlot = {
  match: number;
  kind: BracketKind;
  positions: [string, string];
};

export const SLUG_BRACKET: Record<string, BracketSlot> = {
  // R16 (assigned slot numbers based on ahlan.sa fixture order)
  "afc-cup-2a-vs-2c":              { match: 37, kind: "R16", positions: ["2A", "2C"] },
  "afc-cup-27-1b-vs-3acd-38":      { match: 38, kind: "R16", positions: ["1B", "3ACD"] },
  "afc-cup-27-1d-vsbef-39":        { match: 39, kind: "R16", positions: ["1D", "3BEF"] },
  "afc-cup-27-1a-vs-3cde-40":      { match: 40, kind: "R16", positions: ["1A", "3CDE"] },
  "afc-cup-27-1f-vs-2e-41":        { match: 41, kind: "R16", positions: ["1F", "2E"] },
  "afc-cup-2b-v-2f-42":            { match: 42, kind: "R16", positions: ["2B", "2F"] },
  "afc-cup-27-1e-vs-2d-43":        { match: 43, kind: "R16", positions: ["1E", "2D"] },
  "afc-cup-27-1c-vs-3abf-44":      { match: 44, kind: "R16", positions: ["1C", "3ABF"] },
  // QF — depend on R16 winners
  "afc-cup-27-w37-v-w39-45":       { match: 45, kind: "QF", positions: ["W37", "W39"] },
  "afc-cup-27-w38-v-w41-46":       { match: 46, kind: "QF", positions: ["W38", "W41"] },
  "afc-cup-27-w44-v-w43-47":       { match: 47, kind: "QF", positions: ["W44", "W43"] },
  "afc-cup-27-w40-v-w42-48":       { match: 48, kind: "QF", positions: ["W40", "W42"] },
  // SF
  "afc-cup-27-w45-v-w46-49":       { match: 49, kind: "SF", positions: ["W45", "W46"] },
  "afc-cup-27-w47-v-w48-50":       { match: 50, kind: "SF", positions: ["W47", "W48"] },
  // FINAL ("-50" slug suffix from ahlan.sa, real match number 51)
  "afc-cup-27-final-50":           { match: 51, kind: "FINAL", positions: ["W49", "W50"] },
};

/* ─── Official AFC/UEFA 24-team third-place advancement table ─────────── */

/**
 * Indexed by the sorted string of advancing-group letters (e.g. "ABCD").
 * Each entry maps {1A, 1B, 1C, 1D} -> the group letter whose 3rd team
 * they will play in the Round of 16. (1E and 1F never play 3rd teams.)
 *
 * This is the official table used in UEFA Euro 2016+ and AFC Asian Cup 2023.
 */
const THIRD_PLACE_TABLE: Record<string, Record<"1A" | "1B" | "1C" | "1D", GroupId>> = {
  "ABCD": { "1A": "C", "1B": "D", "1C": "A", "1D": "B" },
  "ABCE": { "1A": "C", "1B": "A", "1C": "B", "1D": "E" },
  "ABCF": { "1A": "C", "1B": "A", "1C": "B", "1D": "F" },
  "ABDE": { "1A": "D", "1B": "A", "1C": "B", "1D": "E" },
  "ABDF": { "1A": "D", "1B": "A", "1C": "B", "1D": "F" },
  "ABEF": { "1A": "E", "1B": "A", "1C": "B", "1D": "F" },
  "ACDE": { "1A": "C", "1B": "D", "1C": "A", "1D": "E" },
  "ACDF": { "1A": "C", "1B": "D", "1C": "A", "1D": "F" },
  "ACEF": { "1A": "C", "1B": "A", "1C": "F", "1D": "E" },
  "ADEF": { "1A": "D", "1B": "A", "1C": "F", "1D": "E" },
  "BCDE": { "1A": "C", "1B": "D", "1C": "B", "1D": "E" },
  "BCDF": { "1A": "C", "1B": "D", "1C": "B", "1D": "F" },
  "BCEF": { "1A": "E", "1B": "C", "1C": "B", "1D": "F" },
  "BDEF": { "1A": "E", "1B": "D", "1C": "B", "1D": "F" },
  "CDEF": { "1A": "C", "1B": "D", "1C": "F", "1D": "E" },
};

/* ─── PRNG ──────────────────────────────────────────────────────────────── */

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ─── Elo match model ───────────────────────────────────────────────────── */

const HOST_BONUS = 70; // Saudi Arabia gets +70 Elo at every match (host)

function effectiveElo(t: Team): number {
  return t.elo + (t.isHost ? HOST_BONUS : 0);
}

/** Probabilities of (W, D, L) for team A vs team B. */
function matchProbs(a: Team, b: Team): { aWin: number; draw: number; bWin: number } {
  const diff = effectiveElo(a) - effectiveElo(b);
  const expectedA = 1 / (1 + Math.pow(10, -diff / 400)); // 0..1
  // Draw probability peaks around 27% for even matches, falls to ~5% for big gaps
  let drawP = 0.27 - 0.20 * Math.abs(expectedA - 0.5);
  drawP = Math.max(0.05, Math.min(0.30, drawP));
  const aWin = (1 - drawP) * expectedA;
  const bWin = (1 - drawP) * (1 - expectedA);
  return { aWin, draw: drawP, bWin };
}

type MatchResult = { aGoals: number; bGoals: number };

/** Sample a match result: outcome via Elo, goals via tiny Poisson-ish model. */
function sampleMatch(a: Team, b: Team, rand: () => number): MatchResult {
  const { aWin, draw } = matchProbs(a, b);
  const r = rand();
  // Goal-scoring rate roughly tied to Elo gap
  const diff = effectiveElo(a) - effectiveElo(b);
  const expA = 1 / (1 + Math.pow(10, -diff / 400));
  const lamA = 0.9 + 1.7 * expA;        // higher for favorite
  const lamB = 0.9 + 1.7 * (1 - expA);

  if (r < aWin) {
    // A wins: aGoals > bGoals
    return resolveWinner(lamA, lamB, rand);
  } else if (r < aWin + draw) {
    // Draw: aGoals == bGoals
    const g = samplePoisson(Math.min(lamA, lamB), rand);
    return { aGoals: g, bGoals: g };
  } else {
    // B wins
    const flipped = resolveWinner(lamB, lamA, rand);
    return { aGoals: flipped.bGoals, bGoals: flipped.aGoals };
  }
}

/** Force aGoals > bGoals using rejection sampling. */
function resolveWinner(lamA: number, lamB: number, rand: () => number): MatchResult {
  for (let i = 0; i < 8; i++) {
    const a = samplePoisson(lamA, rand);
    const b = samplePoisson(lamB, rand);
    if (a > b) return { aGoals: a, bGoals: b };
  }
  // Fallback: pad
  return { aGoals: 1 + Math.floor(rand() * 2), bGoals: 0 };
}

function samplePoisson(lambda: number, rand: () => number): number {
  // Knuth's algorithm
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rand();
  } while (p > L);
  return k - 1;
}

/* ─── Group simulation ─────────────────────────────────────────────────── */

type GroupResult = {
  standings: Team[];   // sorted 1st → 4th
  points: Map<string, number>;
  gd: Map<string, number>;
  gf: Map<string, number>;
};

function simulateGroup(teams: Team[], rand: () => number): GroupResult {
  const points = new Map<string, number>(teams.map(t => [t.code, 0]));
  const gd = new Map<string, number>(teams.map(t => [t.code, 0]));
  const gf = new Map<string, number>(teams.map(t => [t.code, 0]));

  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      const a = teams[i], b = teams[j];
      const res = sampleMatch(a, b, rand);
      if (res.aGoals > res.bGoals)      { points.set(a.code, points.get(a.code)! + 3); }
      else if (res.bGoals > res.aGoals) { points.set(b.code, points.get(b.code)! + 3); }
      else {
        points.set(a.code, points.get(a.code)! + 1);
        points.set(b.code, points.get(b.code)! + 1);
      }
      gd.set(a.code, gd.get(a.code)! + (res.aGoals - res.bGoals));
      gd.set(b.code, gd.get(b.code)! + (res.bGoals - res.aGoals));
      gf.set(a.code, gf.get(a.code)! + res.aGoals);
      gf.set(b.code, gf.get(b.code)! + res.bGoals);
    }
  }

  const standings = [...teams].sort((x, y) => {
    const dp = points.get(y.code)! - points.get(x.code)!;
    if (dp !== 0) return dp;
    const dgd = gd.get(y.code)! - gd.get(x.code)!;
    if (dgd !== 0) return dgd;
    const dgf = gf.get(y.code)! - gf.get(x.code)!;
    if (dgf !== 0) return dgf;
    return rand() - 0.5;
  });

  return { standings, points, gd, gf };
}

/* ─── Tournament simulation ────────────────────────────────────────────── */

type SimResult = {
  positions: Record<string, Team>;        // "1A","2A","3A","4A","1B"... + R16/QF/SF/FINAL "W37"…"W50"
  groupStandings: Record<GroupId, GroupResult>;
};

const R16_MATCH_BY_SLOT: Record<string, [string, string]> = {
  "W37": ["2A", "2C"],
  "W38": ["1B", "3ACD"],
  "W39": ["1D", "3BEF"],
  "W40": ["1A", "3CDE"],
  "W41": ["1F", "2E"],
  "W42": ["2B", "2F"],
  "W43": ["1E", "2D"],
  "W44": ["1C", "3ABF"],
};

function runOneSimulation(rand: () => number): SimResult {
  // 1) Simulate groups
  const groupStandings: Record<string, GroupResult> = {};
  for (const g of GROUPS) {
    const teams = TEAMS.filter(t => t.group === g);
    groupStandings[g] = simulateGroup(teams, rand);
  }
  const positions: Record<string, Team> = {};
  type ThirdEntry = { group: GroupId; team: Team; points: number; gd: number };
  const thirds: ThirdEntry[] = [];
  for (const g of GROUPS) {
    const s = groupStandings[g].standings;
    positions[`1${g}`] = s[0];
    positions[`2${g}`] = s[1];
    positions[`3${g}`] = s[2];
    positions[`4${g}`] = s[3];
    thirds.push({
      group: g,
      team: s[2],
      points: groupStandings[g].points.get(s[2].code)!,
      gd:     groupStandings[g].gd.get(s[2].code)!,
    });
  }

  // 2) Pick 4 best thirds globally — by points, then GD, then random
  thirds.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.gd !== a.gd) return b.gd - a.gd;
    return rand() - 0.5;
  });
  const advancingThirds = thirds.slice(0, 4);
  const advancingGroups = advancingThirds.map(t => t.group).sort().join("");
  const thirdMapping = THIRD_PLACE_TABLE[advancingGroups];
  if (!thirdMapping) {
    // Shouldn't happen; defensive fallback assigns by strength
    advancingThirds.sort((a, b) => effectiveElo(b.team) - effectiveElo(a.team));
    positions["3CDE"] = advancingThirds[0].team;
    positions["3ACD"] = advancingThirds[1].team;
    positions["3ABF"] = advancingThirds[2].team;
    positions["3BEF"] = advancingThirds[3].team;
  } else {
    // Assign each 1A/1B/1C/1D the third-team from the mapped group
    const thirdByGroup = new Map(advancingThirds.map(t => [t.group, t.team] as const));
    // slot labels: 3CDE=1A's opp, 3ACD=1B's opp, 3ABF=1C's opp, 3BEF=1D's opp
    positions["3CDE"] = thirdByGroup.get(thirdMapping["1A"])!;
    positions["3ACD"] = thirdByGroup.get(thirdMapping["1B"])!;
    positions["3ABF"] = thirdByGroup.get(thirdMapping["1C"])!;
    positions["3BEF"] = thirdByGroup.get(thirdMapping["1D"])!;
  }

  // 3) Play R16
  for (const w of Object.keys(R16_MATCH_BY_SLOT)) {
    const [aLbl, bLbl] = R16_MATCH_BY_SLOT[w];
    const a = positions[aLbl]; const b = positions[bLbl];
    if (!a || !b) continue;
    const res = sampleMatch(a, b, rand);
    positions[w] = (res.aGoals >= res.bGoals && res.aGoals !== res.bGoals) ? a
                 : (res.bGoals > res.aGoals) ? b
                 : (rand() < 0.5 ? a : b); // PK shootout on draw
  }

  // 4) QF
  const qfPairs: Array<[string, string, string]> = [
    ["W45", "W37", "W39"],
    ["W46", "W38", "W41"],
    ["W47", "W44", "W43"],
    ["W48", "W40", "W42"],
  ];
  for (const [out, x, y] of qfPairs) {
    const a = positions[x]; const b = positions[y];
    if (!a || !b) continue;
    const res = sampleMatch(a, b, rand);
    positions[out] = (res.aGoals > res.bGoals) ? a
                   : (res.bGoals > res.aGoals) ? b
                   : (rand() < 0.5 ? a : b);
  }

  // 5) SF
  const sfPairs: Array<[string, string, string]> = [
    ["W49", "W45", "W46"],
    ["W50", "W47", "W48"],
  ];
  for (const [out, x, y] of sfPairs) {
    const a = positions[x]; const b = positions[y];
    if (!a || !b) continue;
    const res = sampleMatch(a, b, rand);
    positions[out] = (res.aGoals > res.bGoals) ? a
                   : (res.bGoals > res.aGoals) ? b
                   : (rand() < 0.5 ? a : b);
  }

  // 6) FINAL
  {
    const a = positions["W49"]; const b = positions["W50"];
    if (a && b) {
      const res = sampleMatch(a, b, rand);
      positions["CHAMPION"] = (res.aGoals > res.bGoals) ? a
                            : (res.bGoals > res.aGoals) ? b
                            : (rand() < 0.5 ? a : b);
    }
  }

  return { positions, groupStandings: groupStandings as Record<GroupId, GroupResult> };
}

/* ─── Public API + cache ───────────────────────────────────────────────── */

export type MatchupProb = {
  homeCode: string;
  awayCode: string;
  prob: number;
  homeName: string;
  awayName: string;
  homeFlag: string;
  awayFlag: string;
};

export type GroupStanding = {
  position: number;
  code: string;
  name: string;
  flag: string;
  prob_first: number;
  prob_top2: number;
  prob_top3: number;
  exp_points: number;
  exp_gd: number;
};

const N_SIMS = 10000;
const _matchupCache = new Map<string, MatchupProb[]>();
let _groupStandingsCache: Record<GroupId, GroupStanding[]> | null = null;
let _championCache: Array<{ code: string; name: string; flag: string; prob: number }> = [];

function buildCache() {
  if (_matchupCache.size > 0) return;

  // Tally
  const matchupCounts: Record<string, Map<string, number>> = {};
  for (const slug of Object.keys(SLUG_BRACKET)) matchupCounts[slug] = new Map();

  // Group standings tally: groupId → teamCode → { pos1, pos2, pos3, pos4 } + sumPoints + sumGD
  const groupTally = new Map<GroupId, Map<string, { pos1: number; pos2: number; pos3: number; pos4: number; sumPts: number; sumGd: number }>>();
  for (const g of GROUPS) {
    const m = new Map<string, any>();
    for (const t of TEAMS.filter(t => t.group === g)) {
      m.set(t.code, { pos1: 0, pos2: 0, pos3: 0, pos4: 0, sumPts: 0, sumGd: 0 });
    }
    groupTally.set(g, m);
  }

  const championCount = new Map<string, number>();

  const rand = mulberry32(20270201);
  for (let i = 0; i < N_SIMS; i++) {
    const sim = runOneSimulation(rand);

    // Tally matchups per slug
    for (const slug of Object.keys(SLUG_BRACKET)) {
      const slot = SLUG_BRACKET[slug];
      const a = sim.positions[slot.positions[0]];
      const b = sim.positions[slot.positions[1]];
      if (!a || !b) continue;
      const [h, w] = a.code < b.code ? [a, b] : [b, a];
      const key = `${h.code}|${w.code}`;
      const map = matchupCounts[slug];
      map.set(key, (map.get(key) || 0) + 1);
    }

    // Tally group standings
    for (const g of GROUPS) {
      const gs = sim.groupStandings[g];
      gs.standings.forEach((t, idx) => {
        const tt = groupTally.get(g)!.get(t.code)!;
        if (idx === 0) tt.pos1++;
        if (idx === 1) tt.pos2++;
        if (idx === 2) tt.pos3++;
        if (idx === 3) tt.pos4++;
        tt.sumPts += gs.points.get(t.code)!;
        tt.sumGd  += gs.gd.get(t.code)!;
      });
    }

    // Tally champion
    const champ = sim.positions["CHAMPION"];
    if (champ) championCount.set(champ.code, (championCount.get(champ.code) || 0) + 1);
  }

  // Build cache: matchups
  for (const slug of Object.keys(SLUG_BRACKET)) {
    const map = matchupCounts[slug];
    const total = Array.from(map.values()).reduce((s, x) => s + x, 0) || 1;
    const arr: MatchupProb[] = Array.from(map.entries()).map(([k, c]) => {
      const [hc, wc] = k.split("|");
      const home = TEAMS.find(t => t.code === hc)!;
      const away = TEAMS.find(t => t.code === wc)!;
      return {
        homeCode: hc, awayCode: wc, prob: c / total,
        homeName: home.name, awayName: away.name,
        homeFlag: home.flag, awayFlag: away.flag,
      };
    }).sort((a, b) => b.prob - a.prob);
    _matchupCache.set(slug, arr);
  }

  // Build cache: group standings (expected order by prob_first desc)
  const groupCache: Record<string, GroupStanding[]> = {};
  for (const g of GROUPS) {
    const m = groupTally.get(g)!;
    const arr: GroupStanding[] = Array.from(m.entries()).map(([code, st]: [string, any]) => {
      const team = TEAMS.find(t => t.code === code)!;
      return {
        position: 0,
        code, name: team.name, flag: team.flag,
        prob_first: st.pos1 / N_SIMS,
        prob_top2:  (st.pos1 + st.pos2) / N_SIMS,
        prob_top3:  (st.pos1 + st.pos2 + st.pos3) / N_SIMS,
        exp_points: st.sumPts / N_SIMS,
        exp_gd:     st.sumGd / N_SIMS,
      };
    }).sort((a, b) => b.exp_points - a.exp_points);
    arr.forEach((s, i) => { s.position = i + 1; });
    groupCache[g] = arr;
  }
  _groupStandingsCache = groupCache as Record<GroupId, GroupStanding[]>;

  // Build cache: champion probabilities
  _championCache = Array.from(championCount.entries())
    .map(([code, c]) => {
      const t = TEAMS.find(x => x.code === code)!;
      return { code, name: t.name, flag: t.flag, prob: c / N_SIMS };
    })
    .sort((a, b) => b.prob - a.prob);
}

/** Return the top-N most likely matchups for a knockout slug. */
export function topMatchupsForSlug(slug: string, topN = 6): MatchupProb[] {
  if (!SLUG_BRACKET[slug]) return [];
  buildCache();
  const all = _matchupCache.get(slug) || [];
  return all.slice(0, topN);
}

/** Per-team probability of appearing in a given KO match slot. */
export function teamReachProbForSlug(slug: string): Array<{ code: string; name: string; flag: string; prob: number }> {
  if (!SLUG_BRACKET[slug]) return [];
  buildCache();
  const all = _matchupCache.get(slug) || [];
  const teamProb = new Map<string, number>();
  for (const m of all) {
    teamProb.set(m.homeCode, (teamProb.get(m.homeCode) || 0) + m.prob);
    teamProb.set(m.awayCode, (teamProb.get(m.awayCode) || 0) + m.prob);
  }
  return Array.from(teamProb.entries())
    .map(([code, prob]) => {
      const t = TEAMS.find(x => x.code === code);
      return { code, name: t?.name || code, flag: t?.flag || "🏳️", prob };
    })
    .sort((a, b) => b.prob - a.prob);
}

/** All 6 groups' forecast standings (positions, win probs, expected points/GD). */
export function groupStandingsForecast(): Record<GroupId, GroupStanding[]> {
  buildCache();
  return _groupStandingsCache!;
}

/** Per-team probability of winning the entire tournament. */
export function championProbs(): Array<{ code: string; name: string; flag: string; prob: number }> {
  buildCache();
  return _championCache;
}
