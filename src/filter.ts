import type { Deal } from './types.js';
import {
  HARD_EXCLUDE_CATEGORIES,
  EXCLUDE_DISCOUNT_CATEGORIES,
  HEAVY_DISCOUNT_THRESHOLD,
  WATCHLIST,
} from './config.js';

/** Title + optional Pepper description (user-facing). */
export function dealFullText(d: Deal): string {
  const parts = [d.title, d.description].filter(Boolean) as string[];
  return parts.join('\n');
}

const BOARD_GAME_HINT =
  /\b(planszow|planszówk|board\s+game|eurogra|catan|scythe|gloomhaven|terraforming\s+mars|wingspan)\b/i;

/** Pepper category slugs that almost always mean video-game software / keys, not hardware or board games. */
const VIDEO_GAME_CATEGORIES = new Set(['gry-pc', 'steam', 'epic']);

const VIDEO_GAME_PLATFORM_TEXT =
  /\b(steam\s*key|klucz\s*steam|epic\s*games|gog\.com|game\s*pass\b|xbox\s*game\s*pass|psn\b|playstation\s*plus|ea\s*play|ubisoft\s*connect|season\s*pass\b|\bdlc\b|early\s*access)\b/i;

const VIDEO_GAME_GRA_CONTEXT =
  /\b(gry|gra)\b.*\b(xbox|playstation|ps\s*[45]|nintendo\s*switch|switch\s*\d|steam|pc\b|epic)\b/i;

const KNOWN_AA_TITLES_IN_PHYSICAL_PILES =
  /\b(mortal\s+kombat|red\s+dead|gta\b|grand\s+theft|mafia\b|fifa\b|fc\s*\d+|call\s+of\s+duty|battlefield|forza\s+horizon)\b/i;

export function isBoardGameText(text: string): boolean {
  return BOARD_GAME_HINT.test(text);
}

/** True = video game software / keys / piles of console games — drop from digest & hunter. */
export function isVideoGameDeal(d: Deal): boolean {
  const text = dealFullText(d);
  if (isBoardGameText(text)) return false;

  const cats = d.categories ?? [];
  if (cats.some((c) => VIDEO_GAME_CATEGORIES.has(c))) return true;

  if (VIDEO_GAME_PLATFORM_TEXT.test(text)) return true;
  if (VIDEO_GAME_GRA_CONTEXT.test(text)) return true;

  if (KNOWN_AA_TITLES_IN_PHYSICAL_PILES.test(text) && /\b(xbox|playstation|ps\s*[45]|nintendo\s*switch|switch\s*\d)\b/i.test(text)) {
    return true;
  }

  return false;
}

/** Console gamepads sold alone (Xbox / PlayStation / Switch). */
export function isStandaloneConsoleControllerText(text: string): boolean {
  if (/\bmidi\b/i.test(text)) return false;

  const controllerWord = /\b(kontroler|gamepad|pad\s+bezprzewodowy|\bpad\s+do\b|dualsense|dual\s*shock|joy\s*-?\s*con)\b/i.test(
    text,
  );
  const ecosystem =
    /\b(xbox|playstation|ps\s*[45]|nintendo\s+switch|switch\s*2|switch\s*oled)\b/i.test(text);
  const bundle = /\b(konsola|zestaw\s+.*\bkonsol|console\s+bundle)\b/i.test(text);

  return controllerWord && ecosystem && !bundle;
}

const IPHONE_ACCESSORY_HINT =
  /\b(etui|case|futerał|folia|szkło|szklo|hartowane|pokrowiec|bumper|mag\s*safe|magsafe|ładowark\w*|ladowark\w*)\b/i;

export function isIphoneAccessoryText(text: string): boolean {
  return /\biphone\b/i.test(text) && IPHONE_ACCESSORY_HINT.test(text);
}

export function isIphone14ProMentioned(text: string): boolean {
  return /\b(iphone\s*)?14\s*pro(\s*max)?\b/i.test(text.toLowerCase());
}

/** User only wants iPhone 14 Pro accessories; drop other models and ambiguous “iPhone case”. */
export function isExcludedIphoneAccessoryDeal(d: Deal): boolean {
  const text = dealFullText(d);
  if (!isIphoneAccessoryText(text)) return false;
  return !isIphone14ProMentioned(text);
}

/** Deterministic drops before LLM / hunter (games, solo pads, wrong iPhone SKUs). */
export function relevancePrefilterKeep(deal: Deal): boolean {
  const text = dealFullText(deal);
  if (isVideoGameDeal(deal)) return false;
  if (isStandaloneConsoleControllerText(text)) return false;
  if (isExcludedIphoneAccessoryDeal(deal)) return false;
  return true;
}

/** Drop expired & hard-excluded categories + relevance heuristics. */
export function baseFilter(deals: Deal[]): Deal[] {
  return deals.filter((d) => {
    if (d.is_expired) return false;
    if (d.thread_type?.name && d.thread_type.name !== 'deal' && d.thread_type.name !== 'voucher') {
      return false;
    }
    const cats = d.categories ?? [];
    if (cats.some((c) => HARD_EXCLUDE_CATEGORIES.includes(c))) return false;
    if (!relevancePrefilterKeep(d)) return false;
    return true;
  });
}

/**
 * Heavy-discount hunter: skip noisy buckets (games etc.) and “phone stuff” unless iPhone 14 Pro is explicit.
 */
function allowHeavyDiscountAlert(deal: Deal): boolean {
  const text = dealFullText(deal);
  if (isVideoGameDeal(deal)) return false;
  if (isStandaloneConsoleControllerText(text)) return false;
  if (isIphoneAccessoryText(text) && !isIphone14ProMentioned(text)) return false;
  return true;
}

/** Hunter logic — finds "screaming deals" worth instant Telegram ping. Pure rules, no LLM. */
export function hunterMatch(deal: Deal): { match: boolean; reason: string } {
  const titleLower = deal.title.toLowerCase();
  const full = dealFullText(deal);
  const cats = deal.categories ?? [];

  // 1. Watchlist keyword hit (but never for solo gamepads — title often contains "Xbox …")
  for (const w of WATCHLIST) {
    const kwHit = w.keywords.some((kw) => titleLower.includes(kw.toLowerCase()));
    if (!kwHit) continue;
    if (isStandaloneConsoleControllerText(full)) continue;

    if (w.maxPrice === 0) {
      return { match: true, reason: `Watchlist: ${w.label}` };
    }
    if (deal.price !== null && deal.price !== undefined && deal.price <= w.maxPrice) {
      return { match: true, reason: `Watchlist: ${w.label} ≤ ${w.maxPrice} zł` };
    }
  }

  // 2. Heavy discount, but not in spammy discount categories
  if (deal.discountPct && deal.discountPct >= HEAVY_DISCOUNT_THRESHOLD) {
    const inSpammyCat = cats.some((c) => EXCLUDE_DISCOUNT_CATEGORIES.includes(c));
    if (!inSpammyCat && allowHeavyDiscountAlert(deal)) {
      return { match: true, reason: `Heavy discount: -${deal.discountPct}%` };
    }
  }

  return { match: false, reason: '' };
}
