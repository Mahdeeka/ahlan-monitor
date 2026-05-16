export type Urgency = "available" | "selling_fast" | "almost_gone" | "sold_out" | "unknown";

export interface Category {
  name: string;
  remaining: number;
  quantity: number;
  price: number;
  max_per_order: number;
  sold_out: boolean;
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
  total_remaining: number;
  total_capacity: number;
  pct_sold: number;
  urgency: Urgency;
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
}

export type ChangeType =
  | "back_in_stock"
  | "category_sold_out"
  | "tickets_added"
  | "tickets_sold"
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
