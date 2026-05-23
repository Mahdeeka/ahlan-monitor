import type { Event, Urgency } from "./types";
import { lookupVenue } from "./venues";

function safeInt(v: any): number {
  const n = parseInt(String(v ?? 0));
  return Number.isFinite(n) ? n : 0;
}

/**
 * MATCH Hospitality packages (e.g. "MATCH Club Gold", SAR 2600+) are
 * premium-package add-ons, NOT regular public tickets. We exclude them from
 * headline totals + the "sold out" decision so that when CAT 1 / CAT 2 /
 * Premium are all gone, the event is reported as sold out even if pricey
 * hospitality packages remain.
 */
export function isHospitality(name: string): boolean {
  return (name || "").toUpperCase().startsWith("MATCH");
}

export function classifyStage(slug: string): string {
  const s = (slug || "").toLowerCase();
  if (s.includes("final") && !s.includes("3rd")) return "FINAL";
  if (s.includes("3rd")) return "3rd Place";
  const numStr = s.split("-").pop() || "";
  const n = parseInt(numStr);
  if (Number.isFinite(n)) {
    if (n <= 36) return "Group";
    if (n === 49 || n === 50) return "Semifinal";
    if (n >= 45 && n <= 48) return "Quarterfinal";
    if (n >= 37 && n <= 44) return "Round of 16";
  }
  return "—";
}

export function normalizeEvent(slug: string, data: any): Event {
  if (data && data._error) {
    return {
      slug,
      id: "",
      title: slug,
      date: "",
      date_unix: 0,
      venue: "",
      city: "",
      stage: classifyStage(slug),
      match_number: parseInt(slug.split("-").pop() || "0") || 0,
      categories: [],
      total_remaining: 0,
      total_capacity: 0,
      pct_sold: 0,
      urgency: "unknown",
      poster: "",
      logo: "",
      error: data._error,
    };
  }

  const tickets = (data?.event_tickets || []) as any[];
  // EVENT-LEVEL sold_out flag (set by ahlan when the whole event is closed —
  // e.g. knockout placeholders like "W37 v W39" where teams aren't known yet,
  // or matches where ticketing has been pulled). When this is true, NONE of
  // the per-category remainders are actually buyable, even if the cat-level
  // sold_out flag says false. Always wins over per-category.
  const eventSoldOut = !!data?.is_soldout;
  const cats = tickets.map(t => {
    const remaining = safeInt(t.remaining);
    const quantity = safeInt(t.quantity);
    const name = ((t.title as string) || "").trim();
    // Trust ahlan's sold_out flag — they often return remaining>0 while
    // flagging the category sold_out (drip-restock placeholder). The
    // event-level is_soldout flag forces EVERY public category sold-out
    // (hospitality packs can sometimes stay live independently, so we don't
    // force those — but the UI treats the event as sold out anyway).
    const apiSoldOut = !!t.sold_out;
    const hosp = isHospitality(name);
    const isSoldOut = apiSoldOut || (remaining === 0 && quantity > 0) || (eventSoldOut && !hosp);
    // Drop the effective remaining for both: explicit cat-level sold_out
    // (drip-restock buffer) AND event-level sold_out (whole event closed).
    const effectiveRemaining = (apiSoldOut || (eventSoldOut && !hosp)) ? 0 : remaining;
    return {
      name,
      remaining: effectiveRemaining,
      quantity,
      price: safeInt(t.price),
      max_per_order: safeInt(t.max_per_order),
      sold_out: isSoldOut,
      is_hospitality: hosp,
    };
  });

  // Public-only totals (hospitality packages excluded)
  const publicCats = cats.filter(c => !c.is_hospitality);
  const hospCats   = cats.filter(c => c.is_hospitality);
  const total_remaining = publicCats.reduce((s, c) => s + c.remaining, 0);
  const total_capacity  = publicCats.reduce((s, c) => s + c.quantity, 0);
  const hospitality_remaining = hospCats.reduce((s, c) => s + c.remaining, 0);
  const hospitality_capacity  = hospCats.reduce((s, c) => s + c.quantity, 0);
  // SAR value sitting open right now in hospitality inventory. Pulled directly
  // from the raw `tickets` (not `cats`) so we have access to vat — `Category`
  // doesn't expose it.
  const hospitality_value_sar = tickets
    .filter(t => isHospitality((t.title || "").trim()))
    .reduce((s, t) => {
      const price = safeInt(t.price);
      const vat   = safeInt(t.vat);
      const qty   = safeInt(t.quantity);
      return s + (price + vat) * qty;
    }, 0);
  const pct_sold = total_capacity ? ((total_capacity - total_remaining) / total_capacity) * 100 : 0;

  const publicCount = publicCats.length;
  const publicSoldOut = publicCats.filter(c => c.sold_out).length;

  let urgency: Urgency = "available";
  if (publicCount === 0 && total_capacity === 0) urgency = "unknown";
  // Event-level sold_out wins: if ahlan flagged the whole event sold-out
  // (e.g. knockout placeholder "W37 v W39"), it's sold out regardless of
  // what the per-category remaining numbers say.
  else if (eventSoldOut) urgency = "sold_out";
  else if (publicCount > 0 && publicSoldOut === publicCount) urgency = "sold_out";
  else if (total_capacity > 0 && total_remaining === 0) urgency = "sold_out";
  else if (pct_sold >= 90) urgency = "almost_gone";
  else if (pct_sold >= 70) urgency = "selling_fast";

  const numStr = slug.split("-").pop() || "";
  const venueName = data?.venue_name || "";
  const venueInfo = lookupVenue(venueName);
  return {
    slug,
    id: data?._id || "",
    title: data?.title || slug,
    date: data?.start_date_time_str || "",
    date_unix: safeInt(data?.start_date_time),
    venue: venueName,
    city: data?.city || "",
    stage: classifyStage(slug),
    match_number: parseInt(numStr) || 0,
    categories: cats,
    total_remaining,
    total_capacity,
    pct_sold: Math.round(pct_sold * 10) / 10,
    urgency,
    hospitality_remaining,
    hospitality_capacity,
    hospitality_value_sar,
    // Real stadium capacity from hardcoded venue map. undefined for
    // pack/virtual venues (e.g. "Saudi Arabia" for Follow-My-Team packs).
    venue_capacity_real: venueInfo?.capacity,
    venue_city_real: venueInfo?.city,
    // Configuration flags we watch for flips. Currently all false for AFC 27;
    // when any flips true we log a high-priority change event.
    enable_primary_resell: !!data?.enable_primary_resell,
    has_resale_tickets:    !!data?.has_resale_tickets,
    enable_notify_me:      !!data?.enable_notify_me,
    poster: data?.poster || "",
    logo: data?.logo || "",
  };
}

export function computeSummary(events: Event[]) {
  const valid = events.filter(e => !e.error);
  const total_remaining = valid.reduce((s, e) => s + e.total_remaining, 0);
  const total_capacity  = valid.reduce((s, e) => s + e.total_capacity, 0);
  return {
    total_events: valid.length,
    events_sold_out:     valid.filter(e => e.urgency === "sold_out").length,
    events_almost_gone:  valid.filter(e => e.urgency === "almost_gone").length,
    events_selling_fast: valid.filter(e => e.urgency === "selling_fast").length,
    events_available:    valid.filter(e => e.urgency === "available").length,
    total_remaining,
    total_capacity,
    pct_sold: total_capacity ? Math.round(((total_capacity - total_remaining) / total_capacity) * 1000) / 10 : 0,
  };
}
