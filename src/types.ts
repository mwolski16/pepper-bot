export interface Deal {
  thread_id: number;
  title: string;
  description?: string;
  price?: number | null;
  next_best_price?: number | null;
  temperature: number;
  vote_count?: number;
  comment_count?: number;
  is_expired: boolean;
  is_new?: boolean;
  share_link: string;
  merchant?: { merchant_name?: string } | null;
  groups?: Array<{ group_name?: string; group_url_name?: string }>;
  thread_type?: { name?: string };
  // Computed fields we add
  discountPct?: number | null;
  categories?: string[];
}

export interface Pick {
  thread_id: number;
  reason: string;
}

export interface Notifier {
  send(text: string): Promise<void>;
  name: string;
}
