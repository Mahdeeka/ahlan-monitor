export type Urgency = "available" | "selling_fast" | "almost_gone" | "sold_out" | "unknown";

export interface Category {
  name: string;
  remaining: number;
  quantity: number;
  price: number;
  max_per_order: number;
  sold_out: boolean;
  /** MATCH Hospitality packages (e.g. "MATCH Club Gold") are flagged so the
   *  UI can separate them from regular public tickets. Older DB rows may
   *  lack this — callers should default to deriving from name.startsWith("MATCH"). */
  is_hospitality?: boolean;
}

export interface Event {
  slug: string;
  id: string;
  title: string;
  date: string;
  date_unix: number;
  venue: string;
  city: string;
  stage: string;
  match_number: number;
  categories: Category[];
  /** Public-only totals (excludes MATCH hospitality packages) */
  total_remaining: number;
  total_capacity: number;
  pct_sold: number;
  urgency: Urgency;
  /** Hospitality (MATCH packages) side totals */
  hospitality_remaining?: number;
  hospitality_capacity?: number;
  /** Total SAR value of currently-open MATCH hospitality inventory
   *  (sum of (price + vat) × quantity). Helps surface the high-value
   *  events to monitor (KSA matches, packs, FINAL). */
  hospitality_value_sar?: number;
  /** Highest capacity ever observed for this slug — ahlan's API switches
   *  between full stadium inventory and tiny drip restocks, so this
   *  preserves the "real" stadium scale for display. */
  peak_public_capacity?: number;
  peak_total_capacity?: number;
  /** Real stadium capacity from a hardcoded venue map (see lib/venues.ts).
   *  Independent of ahlan's drip-restock placeholders. Allows the UI to show
   *  "X sold of 72,000-seat stadium" instead of "X sold of 18 (drip)". */
  venue_capacity_real?: number;
  venue_city_real?: string;
  /** Configuration flags from ahlan that we want to *watch for flips* —
   *  when any of these go from false→true, big things happen:
   *    enable_primary_resell  → resale marketplace opens for this event
   *    has_resale_tickets     → resale tickets are actually listed (separate)
   *    enable_notify_me       → wait-list opens for sold-out events */
  enable_primary_resell?: boolean;
  has_resale_tickets?: boolean;
  enable_notify_me?: boolean;
  poster: string;
  logo: string;
  error?: string;
}

export interface Summary {
  total_events: number;
  events_sold_out: number;
  events_almost_gone: number;
  events_selling_fast: number;
  events_available: number;
  total_remaining: number;
  total_capacity: number;
  pct_sold: number;
}

export interface StateSnapshot {
  last_updated: number;
  events: Event[];
  summary: Summary;
  recent_changes?: Array<{
    id: number;
    ts: number;
    slug: string;
    title: string;
    type: ChangeType;
    details: any;
  }>;
}

export type ChangeType =
  | "back_in_stock"
  | "category_sold_out"
  | "tickets_added"
  | "tickets_sold"
  | "bulk_sale"          // ≥50 tickets vanished in one snapshot interval — suspected scalper hit
  | "status_change"
  | "new_event"
  | "resale_opened"      // enable_primary_resell flipped false → true (huge — resale market opens)
  | "resale_listed"      // has_resale_tickets flipped false → true (first resale listings appear)
  | "notify_me_opened";  // enable_notify_me flipped false → true (wait-list opens)

export interface Change {
  slug: string;
  title: string;
  type: ChangeType;
  details: Record<string, any>;
  ts: number;
}

export interface Subscription {
  enabled: boolean;
  triggers: ChangeType[];
}
