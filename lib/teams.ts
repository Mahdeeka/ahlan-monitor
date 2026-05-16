/**
 * AFC Asian Cup 2027 team registry.
 *
 * `strength` is an Elo-like 0-100 rating derived from FIFA rankings, AFC
 * coefficients, and recent Asian Cup form. It's used only to estimate group-
 * stage finish probabilities for the knockout matchup forecaster.
 *
 * Group composition was reverse-engineered from the published 36 group-stage
 * fixtures on ahlan.sa (see eventList -> match titles).
 */

export type GroupId = "A" | "B" | "C" | "D" | "E" | "F";

export type Team = {
  code: string;          // 3-letter (or playoff descriptor)
  name: string;          // Display name
  flag: string;          // Emoji
  fifaRank: number | null;
  strength: number;      // 0-100, used for probability model
  group: GroupId;
};

export const TEAMS: Team[] = [
  // Group A — Riyadh/Mecca cluster
  { code: "KSA", name: "Saudi Arabia",    flag: "🇸🇦", fifaRank: 58,  strength: 72, group: "A" },
  { code: "PLS", name: "Palestine",       flag: "🇵🇸", fifaRank: 95,  strength: 48, group: "A" },
  { code: "OMA", name: "Oman",            flag: "🇴🇲", fifaRank: 76,  strength: 56, group: "A" },
  { code: "KUW", name: "Kuwait",          flag: "🇰🇼", fifaRank: 138, strength: 38, group: "A" },

  // Group B
  { code: "BHR", name: "Bahrain",         flag: "🇧🇭", fifaRank: 80,  strength: 54, group: "B" },
  { code: "PRK", name: "DPR Korea",       flag: "🇰🇵", fifaRank: 120, strength: 44, group: "B" },
  { code: "UZB", name: "Uzbekistan",      flag: "🇺🇿", fifaRank: 57,  strength: 70, group: "B" },
  { code: "JOR", name: "Jordan",          flag: "🇯🇴", fifaRank: 70,  strength: 65, group: "B" },

  // Group C
  { code: "SYR", name: "Syria",           flag: "🇸🇾", fifaRank: 94,  strength: 50, group: "C" },
  { code: "KGZ", name: "Kyrgyz Republic", flag: "🇰🇬", fifaRank: 100, strength: 43, group: "C" },
  { code: "IRN", name: "Iran",            flag: "🇮🇷", fifaRank: 21,  strength: 88, group: "C" },
  { code: "CHN", name: "China PR",        flag: "🇨🇳", fifaRank: 88,  strength: 52, group: "C" },

  // Group D
  { code: "AUS", name: "Australia",       flag: "🇦🇺", fifaRank: 25,  strength: 86, group: "D" },
  { code: "SGP", name: "Singapore",       flag: "🇸🇬", fifaRank: 157, strength: 32, group: "D" },
  { code: "TJK", name: "Tajikistan",      flag: "🇹🇯", fifaRank: 107, strength: 45, group: "D" },
  { code: "IRQ", name: "Iraq",            flag: "🇮🇶", fifaRank: 58,  strength: 73, group: "D" },

  // Group E
  { code: "KOR", name: "Korea Republic",  flag: "🇰🇷", fifaRank: 22,  strength: 87, group: "E" },
  { code: "TBD", name: "Lebanon / Yemen", flag: "🇱🇧", fifaRank: 110, strength: 42, group: "E" },
  { code: "UAE", name: "United Arab Emirates", flag: "🇦🇪", fifaRank: 63, strength: 67, group: "E" },
  { code: "VIE", name: "Vietnam",         flag: "🇻🇳", fifaRank: 115, strength: 47, group: "E" },

  // Group F
  { code: "QAT", name: "Qatar",           flag: "🇶🇦", fifaRank: 37,  strength: 80, group: "F" },
  { code: "THA", name: "Thailand",        flag: "🇹🇭", fifaRank: 95,  strength: 48, group: "F" },
  { code: "JPN", name: "Japan",           flag: "🇯🇵", fifaRank: 17,  strength: 92, group: "F" },
  { code: "IDN", name: "Indonesia",       flag: "🇮🇩", fifaRank: 126, strength: 41, group: "F" },
];

/** Look up a team by its 3-letter code (case-insensitive). */
export function teamByCode(code: string): Team | undefined {
  const upper = code.toUpperCase();
  return TEAMS.find(t => t.code === upper);
}

/** All teams in a group, sorted by strength (strongest first). */
export function groupTeams(group: GroupId): Team[] {
  return TEAMS.filter(t => t.group === group).sort((a, b) => b.strength - a.strength);
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
