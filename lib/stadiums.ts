/**
 * Stadium reference data for AFC Asian Cup 2027 (Saudi Arabia).
 * Capacities are official 2027-renovated figures published by SAFF / FIFA.
 *
 * Use `stadiumInfo(venueName)` — it does a fuzzy match on the venue string
 * the ahlan.sa API returns (which is inconsistent: "King Fahad Sports Stadium"
 * vs "King Saud University Stadium" vs "Prince Abdullah al Faisal Stadium" etc.)
 */
export type StadiumInfo = {
  key: string;
  name: string;
  city: string;
  capacity: number;
  /** Match aliases used by ahlan.sa API */
  aliases: string[];
};

export const STADIUMS: StadiumInfo[] = [
  {
    key: "king-fahad-riyadh",
    name: "King Fahad Sports City Stadium",
    city: "Riyadh",
    capacity: 70200, // post-2027 renovation
    aliases: [
      "king fahad sports stadium", "king fahad sports city stadium",
      "king fahd sports stadium", "king fahd stadium",
    ],
  },
  {
    key: "king-saud-riyadh",
    name: "King Saud University Stadium",
    city: "Riyadh",
    capacity: 27000,
    aliases: ["king saud university stadium", "ksu stadium"],
  },
  {
    key: "prince-faisal-riyadh",
    name: "Prince Faisal bin Fahad Stadium",
    city: "Riyadh",
    capacity: 22000,
    aliases: ["prince faisal bin fahad stadium", "prince faisal stadium"],
  },
  {
    key: "kingdom-arena-riyadh",
    name: "Kingdom Arena",
    city: "Riyadh",
    capacity: 27000,
    aliases: ["kingdom arena"],
  },
  {
    key: "king-abdullah-jeddah",
    name: "King Abdullah Sports City Stadium",
    city: "Jeddah",
    capacity: 62345,
    aliases: [
      "king abdullah sports city stadium", "king abdullah stadium",
      "jeddah stadium", "al-jawhara stadium",
    ],
  },
  {
    key: "prince-abdullah-jeddah",
    name: "Prince Abdullah al-Faisal Stadium",
    city: "Jeddah",
    capacity: 27000,
    aliases: ["prince abdullah al faisal stadium", "prince abdullah stadium"],
  },
  {
    key: "king-abdul-aziz-mecca",
    name: "King Abdulaziz Sports City Stadium",
    city: "Mecca",
    capacity: 38000,
    aliases: ["king abdulaziz sports city", "king abdul aziz sports city"],
  },
  {
    key: "prince-mohamed-buraidah",
    name: "Prince Mohamed bin Fahd Stadium",
    city: "Dammam",
    capacity: 26000,
    aliases: ["prince mohamed bin fahd stadium", "prince mohammed stadium"],
  },
  {
    key: "prince-saud-abha",
    name: "Prince Sultan bin Abdul Aziz Sports City",
    city: "Abha",
    capacity: 25000,
    aliases: ["prince sultan bin abdul aziz", "abha stadium"],
  },
  {
    key: "prince-abdullah-al-jood-buraidah",
    name: "Al-Awwal Park",
    city: "Riyadh",
    capacity: 25000,
    aliases: ["al-awwal park", "al awwal park", "al-awwal stadium"],
  },
];

const UNKNOWN: StadiumInfo = {
  key: "unknown",
  name: "Stadium",
  city: "",
  capacity: 0,
  aliases: [],
};

export function stadiumInfo(venue: string | undefined | null): StadiumInfo {
  if (!venue) return UNKNOWN;
  const v = venue.toLowerCase().trim();
  for (const s of STADIUMS) {
    if (s.name.toLowerCase() === v) return s;
    for (const a of s.aliases) {
      if (v.includes(a) || a.includes(v)) return s;
    }
  }
  // Soft match on first significant words
  const head = v.split(/\s+/).slice(0, 3).join(" ");
  for (const s of STADIUMS) {
    if (s.name.toLowerCase().startsWith(head) || head.startsWith(s.name.toLowerCase().split(/\s+/)[0])) {
      return s;
    }
  }
  return { ...UNKNOWN, name: venue };
}
