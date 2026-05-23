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
  /** Highest capacity ever observed for this slug — ahlan's API switches
   *  between full stadium inventory and tiny drip restocks, so this
   *  preserves the "real" stadium scale for display. */
  peak_public_capacity?: number;
  peak_total_capacity?: number;
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
  | "new_event";

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
