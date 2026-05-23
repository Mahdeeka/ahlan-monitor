/**
 * Canonical AFC Asian Cup 2027 event slugs.
 * Source: ahlan.sa /api/ticketing/eventList?organizationSlug=afc-asiancup-2027
 * Verified count: 51 events (36 group + 8 R16 + 4 QF + 2 SF + 1 FINAL).
 *
 * Note: this list is the fallback for the discovery API. The poller's first
 * action is to call eventList live (via Webshare proxy) so newly-added events
 * appear automatically the moment ahlan.sa publishes them.
 */
export const AFC_2027_SLUGS = [
  // Group stage (1–36)
  "afc-cup-27-ksa-vs-pls-1",   "afc-cup-27-kuw-vs-oma-2",     "afc-cup-27-bhr-vs-prk-3",
  "afc-cup-27-uzb-vs-jor-4",   "afc-cup-27-syr-vs-kgz-5",     "afc-cup-27-irn-vs-chn-6",
  "afc-cup-27-ksa-vs-pls-7",   "afc-cup-27-tjk-vs-irq-8",     "afc-cup-27-kor-vs-tbd-9",
  "afc-cup-27-uae-vs-vie-10",  "afc-cup-27-qat-vs-tha-11",    "afc-cup-27-jap-vs-idn-12",
  "afc-cup-27-omn-vs-ksa-13",  "afc-cup-27-kor-vs-uzb-14",    "afc-cup-27-pal-vs-kuw-15",
  "afc-cup-27-kyr-vs-irn-16",  "afc-cup-27-jor-vs-bhr-17",    "afc-cup-27-iraq-vs-aus-18",
  "afc-cup-27-sgp-vs-tjk-19",  "afc-cup-27-china-vs-syria-20","afc-cup-27-uae-vs-tbc-21",
  "afc-cup-27-vie-vs-kor-22",  "afc-cup-27-tha-vs-jap-23",    "afc-cup-27-ind-vs-aqt-24",
  "afc-cup-27-oma-vs-ple-25",  "afc-cup-27-prk-vs-jor-26",    "afc-cup-27-ksa-vs-kuw-27",
  "afc-cup-27-uzb-vs-bhr-28",  "afc-cup-27-irn-vs-syr-29",    "afc-cup-27-kgz-vs-chn-30",
  "afc-cup-27-aus-tjk-31",     "afc-cup-27-iraq-vs-sing-32",  "afc-cup-27-kor-vs-uae-33",
  "afc-cup-27-jpn-vs-qtr-34",  "afc-cup-27-tha-vs-idn-35",    "afc-cup-27-vie-vs-tbc-36",
  // Round of 16 (note the irregular slugs: -2a-vs-2c has no number, -2b-v-2f-42 drops the 27)
  "afc-cup-27-1b-vs-3acd-38",  "afc-cup-27-1d-vsbef-39",      "afc-cup-27-1a-vs-3cde-40",
  "afc-cup-27-1f-vs-2e-41",    "afc-cup-2b-v-2f-42",          "afc-cup-27-1e-vs-2d-43",
  "afc-cup-27-1c-vs-3abf-44",  "afc-cup-2a-vs-2c",
  // Quarter-finals
  "afc-cup-27-w37-v-w39-45",   "afc-cup-27-w38-v-w41-46",
  "afc-cup-27-w44-v-w43-47",   "afc-cup-27-w40-v-w42-48",
  // Semi-finals
  "afc-cup-27-w45-v-w46-49",   "afc-cup-27-w47-v-w48-50",
  // FINAL
  "afc-cup-27-final-50",
  // Match packs — bundle ticket products ahlan added later (auto-discovered)
  "afc-cup-27-chn-pack",
  "afc-cup-27-ksa-pack",
  "afc-cup-27-uae-pack",
];
