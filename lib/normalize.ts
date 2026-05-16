import type { Event, Urgency } from "./types";

function safeInt(v: any): number {
  const n = parseInt(String(v ?? 0));
  return Number.isFinite(n) ? n : 0;
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
    return {
      name: ((t.title as string) || "").trim(),
      remaining,
      quantity,
      price: safeInt(t.price),
      max_per_order: safeInt(t.max_per_order),
      sold_out: remaining === 0,
    };
  });

  const total_remaining = cats.reduce((s, c) => s + c.remaining, 0);
  const total_capacity  = cats.reduce((s, c) => s + c.quantity, 0);
  const pct_sold = total_capacity ? ((total_capacity - total_remaining) / total_capacity) * 100 : 0;

  let urgency: Urgency = "available";
  if (total_capacity === 0) urgency = "unknown";
  else if (total_remaining === 0) urgency = "sold_out";
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
