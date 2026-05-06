import type { Deal } from './types.js';
import {
  HARD_EXCLUDE_CATEGORIES,
  EXCLUDE_DISCOUNT_CATEGORIES,
  HEAVY_DISCOUNT_THRESHOLD,
  WATCHLIST,
} from './config.js';

/** Drop expired & deals in hard-excluded categories. Keep low-temperature deals. */
export function baseFilter(deals: Deal[]): Deal[] {
  return deals.filter((d) => {
    if (d.is_expired) return false;
    if (d.thread_type?.name && d.thread_type.name !== 'deal' && d.thread_type.name !== 'voucher') {
      // skip discussions, polls, etc.
      return false;
    }
    const cats = d.categories ?? [];
    if (cats.some((c) => HARD_EXCLUDE_CATEGORIES.includes(c))) return false;
    return true;
  });
}

/** Hunter logic — finds "screaming deals" worth instant Telegram ping. Pure rules, no LLM. */
export function hunterMatch(deal: Deal): { match: boolean; reason: string } {
  const titleLower = deal.title.toLowerCase();
  const cats = deal.categories ?? [];

  // 1. Watchlist keyword hit
  for (const w of WATCHLIST) {
    const kwHit = w.keywords.some((kw) => titleLower.includes(kw.toLowerCase()));
    if (kwHit) {
      if (w.maxPrice === 0) {
        return { match: true, reason: `Watchlist: ${w.label}` };
      }
      if (deal.price !== null && deal.price !== undefined && deal.price <= w.maxPrice) {
        return { match: true, reason: `Watchlist: ${w.label} ≤ ${w.maxPrice} zł` };
      }
    }
  }

  // 2. Heavy discount, but not in spammy discount categories
  if (deal.discountPct && deal.discountPct >= HEAVY_DISCOUNT_THRESHOLD) {
    const inSpammyCat = cats.some((c) => EXCLUDE_DISCOUNT_CATEGORIES.includes(c));
    if (!inSpammyCat) {
      return { match: true, reason: `Heavy discount: -${deal.discountPct}%` };
    }
  }

  return { match: false, reason: '' };
}
