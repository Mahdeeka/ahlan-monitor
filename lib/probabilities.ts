/**
 * Knockout matchup probability forecaster.
 *
 * Approach: deterministic Monte Carlo. We pre-sim 10,000 tournaments using a
 * simple strength-weighted Plackett-Luce model for group standings, then
 * resolve the published bracket structure to count how often each matchup
 * appears in each KO slot. Results are cached at module-load time (this runs
 * server-side and is identical across requests until strength changes).
 *
 * The bracket is the published one:
 *   R16:  #37 2A v 2C  | #38 1B v 3ACD | #39 1D v 3BEF | #40 1A v 3CDE
 *         #41 1F v 2E  | #42 2B v 2F   | #43 1E v 2D   | #44 1C v 3ABF
 *   QF:   #45 W37 v W39 | #46 W38 v W41 | #47 W44 v W43 | #48 W40 v W42
 *   SF:   #49 W45 v W46 | #50 W47 v W48
 *   F:    #51 W49 v W50  (slug suffix is "-50")
 */

import { TEAMS, GROUPS, type Team, type GroupId } from "./teams";

/** Map of slug → human-readable bracket position label. */
export const SLUG_BRACKET: Record<string, BracketSlot> = {
  // R16 — match numbers from the slug suffix
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
  // FINAL — "-50" suffix is just the ahlan.sa slug, real match number is 51
  "afc-cup-27-final-50":           { match: 51, kind: "FINAL", positions: ["W49", "W50"] },
};

export type BracketKind = "R16" | "QF" | "SF" | "FINAL";

export type BracketSlot = {
  match: number;
  kind: BracketKind;
  positions: [string, string];
};

export type MatchupProb = {
  homeCode: string;
  awayCode: string;
  prob: number;       // 0..1
  homeName: string;
  awayName: string;
  homeFlag: string;
  awayFlag: string;
};

/** ────────────────────────────────────────────────────────────────────────
 *  Monte Carlo simulation
 *  ────────────────────────────────────────────────────────────────────── */

// Deterministic PRNG so the same matchup probabilities come back every request
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Plackett-Luce sample of group standings, sorted by strength. */
function sampleGroupStandings(group: GroupId, rand: () => number): Team[] {
  const pool = TEAMS.filter(t => t.group === group).slice();
  const out: Team[] = [];
  // Each iteration: pick one team weighted by strength, then remove
  while (pool.length > 0) {
    const total = pool.reduce((s, t) => s + t.strength, 0);
    let pick = rand() * total;
    let i = 0;
    for (; i < pool.length; i++) {
      pick -= pool[i].strength;
      if (pick <= 0) break;
    }
    if (i >= pool.length) i = pool.length - 1;
    out.push(pool[i]);
    pool.splice(i, 1);
  }
  return out;
}

/** Sample a single match winner. Stronger team is more likely. */
function sampleMatchWinner(a: Team, b: Team, rand: () => number): Team {
  const ratio = a.strength / (a.strength + b.strength);
  return rand() < ratio ? a : b;
}

/** Identify the 4 best third-place teams from a tournament-wide set. */
function pickBestThirds(thirds: Map<GroupId, Team>, rand: () => number): Map<GroupId, Team | null> {
  // Sort 6 thirds by strength + small jitter
  const arr = Array.from(thirds.entries()).map(([g, t]) => ({
    g, t, score: t.strength + rand() * 8 - 4,
  }));
  arr.sort((x, y) => y.score - x.score);
  const top4 = new Set(arr.slice(0, 4).map(x => x.g));
  const result = new Map<GroupId, Team | null>();
  for (const entry of Array.from(thirds.entries())) {
    const [g, t] = entry;
    result.set(g, top4.has(g) ? t : null);
  }
  return result;
}

type SimResult = {
  positions: Record<string, Team>; // "1A","2A","3A","1B"... + "3ABF","3ACD","3BEF","3CDE"
};

function runOneSimulation(rand: () => number): SimResult {
  const standings = new Map<GroupId, Team[]>();
  for (const g of GROUPS) standings.set(g, sampleGroupStandings(g, rand));

  const positions: Record<string, Team> = {};
  const thirds = new Map<GroupId, Team>();
  for (const entry of Array.from(standings.entries())) {
    const [g, s] = entry;
    positions[`1${g}`] = s[0];
    positions[`2${g}`] = s[1];
    positions[`3${g}`] = s[2];
    positions[`4${g}`] = s[3];
    thirds.set(g, s[2]);
  }

  // Best 4 thirds advance — assigned by AFC formula to slots based on which
  // group letters appear. We approximate: any 3rd that advances can fill the
  // "3XYZ" slot if its group letter is in {X,Y,Z}. With 4 advancing thirds
  // and 4 R16 slots demanding 3rds, we map deterministically by slot.
  const bestThirds = pickBestThirds(thirds, rand);
  const advancingThirdsByGroup = new Map<GroupId, Team>();
  for (const entry of Array.from(bestThirds.entries())) {
    const [g, t] = entry;
    if (t) advancingThirdsByGroup.set(g, t);
  }

  // Match slot to group: assign whichever advancing 3rd best fits each slot.
  // We rank slots by "specificity" (fewer eligible groups first) for stable
  // assignment.
  const thirdSlots: Array<{ key: string; groups: GroupId[] }> = [
    { key: "3ABF",  groups: ["A","B","F"] },
    { key: "3ACD",  groups: ["A","C","D"] },
    { key: "3BEF",  groups: ["B","E","F"] },
    { key: "3CDE",  groups: ["C","D","E"] },
  ];
  const usedGroups = new Set<GroupId>();
  for (const slot of thirdSlots) {
    // Find a 3rd-place advancer whose group matches and isn't used yet
    const candidate = slot.groups
      .filter(g => !usedGroups.has(g) && advancingThirdsByGroup.has(g))
      .sort((a, b) => advancingThirdsByGroup.get(b)!.strength - advancingThirdsByGroup.get(a)!.strength)[0];
    if (candidate) {
      positions[slot.key] = advancingThirdsByGroup.get(candidate)!;
      usedGroups.add(candidate);
    }
  }
  // Fill any unfilled 3rd-slot with the strongest remaining advancing 3rd
  for (const slot of thirdSlots) {
    if (!positions[slot.key]) {
      const remaining = Array.from(advancingThirdsByGroup.entries())
        .filter(([g]) => !usedGroups.has(g))
        .sort((a, b) => b[1].strength - a[1].strength);
      if (remaining[0]) {
        positions[slot.key] = remaining[0][1];
        usedGroups.add(remaining[0][0]);
      }
    }
  }

  // ── Resolve bracket ─────────────────────────────────────────────
  const get = (k: string): Team | undefined => positions[k];
  const playR16 = (slot: string): Team | null => {
    const m = R16_MATCH_BY_SLOT[slot]; if (!m) return null;
    const a = get(m.positions[0]); const b = get(m.positions[1]);
    if (!a || !b) return null;
    return sampleMatchWinner(a, b, rand);
  };
  const w37 = playR16("W37"); if (w37) positions["W37"] = w37;
  const w38 = playR16("W38"); if (w38) positions["W38"] = w38;
  const w39 = playR16("W39"); if (w39) positions["W39"] = w39;
  const w40 = playR16("W40"); if (w40) positions["W40"] = w40;
  const w41 = playR16("W41"); if (w41) positions["W41"] = w41;
  const w42 = playR16("W42"); if (w42) positions["W42"] = w42;
  const w43 = playR16("W43"); if (w43) positions["W43"] = w43;
  const w44 = playR16("W44"); if (w44) positions["W44"] = w44;

  // QF
  const qfPlay = (a?: Team, b?: Team) => (a && b) ? sampleMatchWinner(a, b, rand) : null;
  const w45 = qfPlay(positions["W37"], positions["W39"]); if (w45) positions["W45"] = w45;
  const w46 = qfPlay(positions["W38"], positions["W41"]); if (w46) positions["W46"] = w46;
  const w47 = qfPlay(positions["W44"], positions["W43"]); if (w47) positions["W47"] = w47;
  const w48 = qfPlay(positions["W40"], positions["W42"]); if (w48) positions["W48"] = w48;

  // SF
  const w49 = qfPlay(positions["W45"], positions["W46"]); if (w49) positions["W49"] = w49;
  const w50 = qfPlay(positions["W47"], positions["W48"]); if (w50) positions["W50"] = w50;

  return { positions };
}

/** R16 match → position labels (for the sim). */
const R16_MATCH_BY_SLOT: Record<string, { positions: [string, string] }> = {
  "W37": { positions: ["2A", "2C"] },
  "W38": { positions: ["1B", "3ACD"] },
  "W39": { positions: ["1D", "3BEF"] },
  "W40": { positions: ["1A", "3CDE"] },
  "W41": { positions: ["1F", "2E"] },
  "W42": { positions: ["2B", "2F"] },
  "W43": { positions: ["1E", "2D"] },
  "W44": { positions: ["1C", "3ABF"] },
};

/** Pre-cache: run N sims and tabulate, per slug, matchup frequencies. */
const N_SIMS = 6000;
const _cache = new Map<string, MatchupProb[]>();

function buildCache() {
  if (_cache.size > 0) return;
  // Tally: slug → "homeCode|awayCode" → count
  const counts: Record<string, Map<string, number>> = {};
  for (const slug of Object.keys(SLUG_BRACKET)) counts[slug] = new Map();

  const rand = mulberry32(20270201);
  for (let i = 0; i < N_SIMS; i++) {
    const sim = runOneSimulation(rand);
    for (const slug of Object.keys(SLUG_BRACKET)) {
      const slot = SLUG_BRACKET[slug];
      const a = sim.positions[slot.positions[0]];
      const b = sim.positions[slot.positions[1]];
      if (!a || !b) continue;
      // Always order alphabetically by code to merge "X vs Y" and "Y vs X"
      const [h, w] = a.code < b.code ? [a, b] : [b, a];
      const key = `${h.code}|${w.code}`;
      const map = counts[slug];
      map.set(key, (map.get(key) || 0) + 1);
    }
  }

  for (const slug of Object.keys(SLUG_BRACKET)) {
    const map = counts[slug];
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
    _cache.set(slug, arr);
  }
}

/** Return the top-N most likely matchups for a KO slug. */
export function topMatchupsForSlug(slug: string, topN = 6): MatchupProb[] {
  if (!SLUG_BRACKET[slug]) return [];
  buildCache();
  const all = _cache.get(slug) || [];
  return all.slice(0, topN);
}

/** Per-team probability of appearing in a given KO match slot. */
export function teamReachProbForSlug(slug: string): Array<{ code: string; name: string; flag: string; prob: number }> {
  if (!SLUG_BRACKET[slug]) return [];
  buildCache();
  const all = _cache.get(slug) || [];
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
