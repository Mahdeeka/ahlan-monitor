/**
 * AFC Asian Cup 2027 team registry.
 *
 * `elo` is a football Elo rating (eloratings.net style, baseline 1500).
 * Used by the per-match Monte Carlo to compute realistic W/D/L probabilities
 * and predict group standings + knockout matchups.
 *
 * `isHost` = true → gets the host nation home-advantage boost (+60 Elo on
 * top of base rating, applied at match time).
 *
 * Group composition was reverse-engineered from the 36 published group-stage
 * fixtures on ahlan.sa (see eventList -> match titles).
 */

export type GroupId = "A" | "B" | "C" | "D" | "E" | "F";

export type Team = {
  code: string;          // 3-letter (or playoff descriptor)
  name: string;          // Display name
  flag: string;          // Emoji
  fifaRank: number | null;
  elo: number;           // Real football Elo (~1200–1850 range)
  group: GroupId;
  isHost?: boolean;
};

export const TEAMS: Team[] = [
  // ── Group A ─────────────────────────────────────────────────────────────
  { code: "KSA", name: "Saudi Arabia",          flag: "🇸🇦", fifaRank: 58,  elo: 1580, group: "A", isHost: true },
  { code: "PLS", name: "Palestine",             flag: "🇵🇸", fifaRank: 95,  elo: 1380, group: "A" },
  { code: "OMA", name: "Oman",                  flag: "🇴🇲", fifaRank: 76,  elo: 1500, group: "A" },
  { code: "KUW", name: "Kuwait",                flag: "🇰🇼", fifaRank: 138, elo: 1350, group: "A" },

  // ── Group B ─────────────────────────────────────────────────────────────
  { code: "BHR", name: "Bahrain",               flag: "🇧🇭", fifaRank: 80,  elo: 1500, group: "B" },
  { code: "PRK", name: "DPR Korea",             flag: "🇰🇵", fifaRank: 120, elo: 1350, group: "B" },
  { code: "UZB", name: "Uzbekistan",            flag: "🇺🇿", fifaRank: 57,  elo: 1610, group: "B" },
  { code: "JOR", name: "Jordan",                flag: "🇯🇴", fifaRank: 70,  elo: 1600, group: "B" }, // 2023 finalists

  // ── Group C ─────────────────────────────────────────────────────────────
  { code: "SYR", name: "Syria",                 flag: "🇸🇾", fifaRank: 94,  elo: 1490, group: "C" },
  { code: "KGZ", name: "Kyrgyz Republic",       flag: "🇰🇬", fifaRank: 100, elo: 1400, group: "C" },
  { code: "IRN", name: "Iran",                  flag: "🇮🇷", fifaRank: 21,  elo: 1750, group: "C" },
  { code: "CHN", name: "China PR",              flag: "🇨🇳", fifaRank: 88,  elo: 1480, group: "C" },

  // ── Group D ─────────────────────────────────────────────────────────────
  { code: "AUS", name: "Australia",             flag: "🇦🇺", fifaRank: 25,  elo: 1740, group: "D" },
  { code: "SGP", name: "Singapore",             flag: "🇸🇬", fifaRank: 157, elo: 1300, group: "D" },
  { code: "TJK", name: "Tajikistan",            flag: "🇹🇯", fifaRank: 107, elo: 1430, group: "D" }, // 2023 QF
  { code: "IRQ", name: "Iraq",                  flag: "🇮🇶", fifaRank: 58,  elo: 1605, group: "D" },

  // ── Group E ─────────────────────────────────────────────────────────────
  { code: "KOR", name: "Korea Republic",        flag: "🇰🇷", fifaRank: 22,  elo: 1770, group: "E" },
  { code: "TBD", name: "Lebanon / Yemen",       flag: "🇱🇧", fifaRank: 110, elo: 1380, group: "E" },
  { code: "UAE", name: "United Arab Emirates",  flag: "🇦🇪", fifaRank: 63,  elo: 1580, group: "E" },
  { code: "VIE", name: "Vietnam",               flag: "🇻🇳", fifaRank: 115, elo: 1430, group: "E" },

  // ── Group F ─────────────────────────────────────────────────────────────
  { code: "QAT", name: "Qatar",                 flag: "🇶🇦", fifaRank: 37,  elo: 1660, group: "F" }, // back-to-back champ
  { code: "THA", name: "Thailand",              flag: "🇹🇭", fifaRank: 95,  elo: 1450, group: "F" },
  { code: "JPN", name: "Japan",                 flag: "🇯🇵", fifaRank: 17,  elo: 1820, group: "F" },
  { code: "IDN", name: "Indonesia",             flag: "🇮🇩", fifaRank: 126, elo: 1430, group: "F" }, // sharp rise
];

/** Look up a team by its 3-letter code (case-insensitive). */
export function teamByCode(code: string): Team | undefined {
  const upper = code.toUpperCase();
  return TEAMS.find(t => t.code === upper);
}

/** All teams in a group, sorted by Elo (strongest first). */
export function groupTeams(group: GroupId): Team[] {
  return TEAMS.filter(t => t.group === group).sort((a, b) => b.elo - a.elo);
}

/** All groups present in the tournament. */
export const GROUPS: GroupId[] = ["A", "B", "C", "D", "E", "F"];

/** Slug → team map — used to enrich group-stage matches with team data. */
export const SLUG_TEAMS: Record<string, [string, string]> = {
  "afc-cup-27-ksa-vs-pls-1":      ["KSA", "PLS"],
  "afc-cup-27-kuw-vs-oma-2":      ["KUW", "OMA"],
  "afc-cup-27-bhr-vs-prk-3":      ["BHR", "PRK"],
  "afc-cup-27-uzb-vs-jor-4":      ["UZB", "JOR"],
  "afc-cup-27-syr-vs-kgz-5":      ["SYR", "KGZ"],
  "afc-cup-27-irn-vs-chn-6":      ["IRN", "CHN"],
  "afc-cup-27-ksa-vs-pls-7":      ["AUS", "SGP"],  // title says Australia vs Singapore
  "afc-cup-27-tjk-vs-irq-8":      ["TJK", "IRQ"],
  "afc-cup-27-kor-vs-tbd-9":      ["KOR", "TBD"],
  "afc-cup-27-uae-vs-vie-10":     ["UAE", "VIE"],
  "afc-cup-27-qat-vs-tha-11":     ["QAT", "THA"],
  "afc-cup-27-jap-vs-idn-12":     ["JPN", "IDN"],
  "afc-cup-27-omn-vs-ksa-13":     ["OMA", "KSA"],
  "afc-cup-27-kor-vs-uzb-14":     ["PRK", "UZB"],  // title says DPR Korea vs Uzbekistan
  "afc-cup-27-pal-vs-kuw-15":     ["PLS", "KUW"],
  "afc-cup-27-kyr-vs-irn-16":     ["KGZ", "IRN"],
  "afc-cup-27-jor-vs-bhr-17":     ["JOR", "BHR"],
  "afc-cup-27-iraq-vs-aus-18":    ["IRQ", "AUS"],
  "afc-cup-27-sgp-vs-tjk-19":     ["SGP", "TJK"],
  "afc-cup-27-china-vs-syria-20": ["CHN", "SYR"],
  "afc-cup-27-uae-vs-tbc-21":     ["TBD", "UAE"],  // title: Lebanon/Yemen vs UAE
  "afc-cup-27-vie-vs-kor-22":     ["VIE", "KOR"],
  "afc-cup-27-tha-vs-jap-23":     ["THA", "JPN"],
  "afc-cup-27-ind-vs-aqt-24":     ["IDN", "QAT"],
  "afc-cup-27-oma-vs-ple-25":     ["OMA", "PLS"],
  "afc-cup-27-prk-vs-jor-26":     ["PRK", "JOR"],
  "afc-cup-27-ksa-vs-kuw-27":     ["KSA", "KUW"],
  "afc-cup-27-uzb-vs-bhr-28":     ["UZB", "BHR"],
  "afc-cup-27-irn-vs-syr-29":     ["IRN", "SYR"],
  "afc-cup-27-kgz-vs-chn-30":     ["KGZ", "CHN"],
  "afc-cup-27-aus-tjk-31":        ["AUS", "TJK"],
  "afc-cup-27-iraq-vs-sing-32":   ["IRQ", "SGP"],
  "afc-cup-27-kor-vs-uae-33":     ["KOR", "UAE"],
  "afc-cup-27-jpn-vs-qtr-34":     ["JPN", "QAT"],
  "afc-cup-27-tha-vs-idn-35":     ["THA", "IDN"],
  "afc-cup-27-vie-vs-tbc-36":     ["VIE", "TBD"],
};

/** Get teams confirmed for a group-stage slug; null for knockout matches. */
export function teamsForSlug(slug: string): { home: Team; away: Team } | null {
  const pair = SLUG_TEAMS[slug];
  if (!pair) return null;
  const home = teamByCode(pair[0]);
  const away = teamByCode(pair[1]);
  if (!home || !away) return null;
  return { home, away };
}
