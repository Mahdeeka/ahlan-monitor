import type { Event, Urgency } from "./types";

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
  const cats = tickets.map(t => {
    const remaining = safeInt(t.remaining);
    const quantity = safeInt(t.quantity);
    const name = ((t.title as string) || "").trim();
    // Trust ahlan's sold_out flag — they often return remaining>0 while
    // flagging the category sold_out (drip-restock placeholder).
    const apiSoldOut = !!t.sold_out;
    const isSoldOut = apiSoldOut || (remaining === 0 && quantity > 0);
    const effectiveRemaining = apiSoldOut ? 0 : remaining;
    return {
      name,
      remaining: effectiveRemaining,
      quantity,
      price: safeInt(t.price),
      max_per_order: safeInt(t.max_per_order),
      sold_out: isSoldOut,
      is_hospitality: isHospitality(name),
    };
  });

  // Public-only totals (hospitality packages excluded)
  const publicCats = cats.filter(c => !c.is_hospitality);
  const hospCats   = cats.filter(c => c.is_hospitality);
  const total_remaining = publicCats.reduce((s, c) => s + c.remaining, 0);
  const total_capacity  = publicCats.reduce((s, c) => s + c.quantity, 0);
  const hospitality_remaining = hospCats.reduce((s, c) => s + c.remaining, 0);
  const hospitality_capacity  = hospCats.reduce((s, c) => s + c.quantity, 0);
  const pct_sold = total_capacity ? ((total_capacity - total_remaining) / total_capacity) * 100 : 0;

  const publicCount = publicCats.length;
  const publicSoldOut = publicCats.filter(c => c.sold_out).length;

  let urgency: Urgency = "available";
  if (publicCount === 0 && total_capacity === 0) urgency = "unknown";
  else if (publicCount > 0 && publicSoldOut === publicCount) urgency = "sold_out";
  else if (total_capacity > 0 && total_remaining === 0) urgency = "sold_out";
  else if (pct_sold >= 90) urgency = "almost_gone";
  else if (pct_sold >= 70) urgency = "selling_fast";

  const numStr = slug.split("-").pop() || "";
  return {
    slug,
    id: data?._id || "",
    title: data?.title || slug,
    date: data?.start_date_time_str || "",
    date_unix: safeInt(data?.start_date_time),
    venue: data?.venue_name || "",
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
