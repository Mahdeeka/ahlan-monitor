/**
 * Real AFC Asian Cup 2027 stadium capacities.
 *
 * Source: Sitecore CMS Tournament page metadata, verified 2026-05-23.
 *   GraphQL: { item(path: "/sitecore/content/FanID Platform/FanID/Home/Tournaments/AFC-Asian-Cup-2027") }
 *
 * The keys are the venue names returned by webook's eventDetail API. Note that
 * the API spelling differs from the Sitecore CMS canonical names (e.g. "Fahad"
 * vs "Fahd", "Sport City" vs "Sports City"), so both variants are mapped here.
 *
 * These give the bot real stadium scale to compare against ahlan's drip-restock
 * placeholder capacities (3-50 tickets per category). With this lookup:
 *   "FINAL: 0/3 in current drop"  → "FINAL: 0/3 in current drop (stadium: 72,000)"
 */

export interface VenueInfo {
  city: string;
  capacity: number;
  /** Number of AFC 27 matches scheduled at this venue (from full schedule). */
  afcMatches: number;
}

/**
 * Maps the EXACT venue_name string returned by webook's eventDetail API.
 * If a new stadium variant appears, add it here.
 */
export const VENUE_BY_NAME: Record<string, VenueInfo> = {
  // FINAL is here. Note API spells "Fahad" not "Fahd".
  "King Fahad Sports Stadium":                       { city: "Riyadh",    capacity: 72000, afcMatches: 8 },
  "King Fahd Sports City Stadium":                   { city: "Riyadh",    capacity: 72000, afcMatches: 8 },

  "King Abdullah Sport City Stadium":                { city: "Jeddah",    capacity: 60000, afcMatches: 8 },
  "King Abdullah Sports City Stadium":               { city: "Jeddah",    capacity: 60000, afcMatches: 8 },

  "Aramco Stadium":                                  { city: "Al Khobar", capacity: 45000, afcMatches: 7 },
  "Aramco stadium":                                  { city: "Al Khobar", capacity: 45000, afcMatches: 7 },

  "Kingdom Arena":                                   { city: "Riyadh",    capacity: 26000, afcMatches: 6 },

  "King Saud University Stadium":                    { city: "Riyadh",    capacity: 26000, afcMatches: 6 },

  "Prince Abdullah Al-Faisal Stadium":               { city: "Jeddah",    capacity: 26000, afcMatches: 5 },
  "Prince Abdullah Al Faisal Sports City Stadium":   { city: "Jeddah",    capacity: 26000, afcMatches: 5 },
  "Prince Abdullah Al-Faisal Sports City Stadium":   { city: "Jeddah",    capacity: 26000, afcMatches: 5 },

  "Imam Mohammed Ibn Saud University Stadium":       { city: "Riyadh",    capacity: 25000, afcMatches: 6 },

  "Al Shabab Stadium":                               { city: "Riyadh",    capacity: 13000, afcMatches: 5 },
};

/** Total seating across all 8 AFC venues. */
export const AFC_TOTAL_STADIUM_CAPACITY =
  72000 + 60000 + 45000 + 26000 + 26000 + 26000 + 25000 + 13000;
//  ^ FINAL  KASC   Aramco Kingdom KSU   PAFS  IMIS    AlShabab
//  = 293,000 seats across 8 stadiums in 3 cities (Riyadh 34, Jeddah 13, Khobar 7)

/**
 * Look up real stadium capacity by venue name returned from eventDetail.
 * Returns undefined for pack/virtual venues (venue_name = "Saudi Arabia" etc.).
 */
export function lookupVenue(venueName: string | null | undefined): VenueInfo | undefined {
  if (!venueName) return undefined;
  // Direct match first (cheapest case)
  if (VENUE_BY_NAME[venueName]) return VENUE_BY_NAME[venueName];
  // Tolerant fallback: case-insensitive, ignore extra whitespace
  const norm = venueName.trim().toLowerCase().replace(/\s+/g, " ");
  for (const [k, v] of Object.entries(VENUE_BY_NAME)) {
    if (k.trim().toLowerCase().replace(/\s+/g, " ") === norm) return v;
  }
  return undefined;
}
