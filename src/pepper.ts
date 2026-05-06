import type { Deal } from './types.js';
import { PEPPER_FETCH_LIMIT_HOT, PEPPER_FETCH_LIMIT_NEW } from './settings.js';

const REST_BASE = 'https://www.pepper.pl/rest_api/v2';
const SITE = 'https://www.pepper.pl';
// Pepper omits thread JSON in SSR for /promocje when the UA looks like a bot.
const DEFAULT_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const THREAD_PROPS_MARKER = '"props":{"thread":';
const ARTICLE_OPEN_RE = /<article[^>]*id="thread_(\d+)"[^>]*>/g;
const HTML_MAX_PAGES = 10;
const HTML_PER_PAGE_EST = 30;

function userAgent(): string {
  return process.env.PEPPER_USER_AGENT?.trim() || DEFAULT_UA;
}

function buildThreadsUrl(orderBy: 'new' | 'hot', limit: number): string {
  const params = new URLSearchParams({ order_by: orderBy, limit: String(limit) });
  const sig = process.env.PEPPER_API_SIGNATURE?.trim();
  if (sig) params.set('signature', sig);
  return `${REST_BASE}/threads?${params.toString()}`;
}

async function fetchThreadsRest(orderBy: 'new' | 'hot', limit = 50): Promise<Deal[]> {
  const url = buildThreadsUrl(orderBy, limit);
  const res = await fetch(url, {
    headers: { 'User-Agent': userAgent(), Accept: 'application/json' },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Pepper API ${orderBy} failed: ${res.status} ${text}`);
  }
  const json: unknown = await res.json();
  const obj = json as Record<string, unknown> | unknown[];
  const arr: unknown[] = Array.isArray(obj) ? obj : ((obj as Record<string, unknown>).data ?? (obj as Record<string, unknown>).items ?? []) as unknown[];
  return arr.map((raw) => normalize(raw as Record<string, unknown>));
}

/** Extract JSON object starting at `{`, respecting strings and escapes. */
function parseJsonObjectAt(html: string, start: number): { end: number; value: Record<string, unknown> } | null {
  if (html[start] !== '{') return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (inStr) {
      if (esc) {
        esc = false;
        continue;
      }
      if (c === '\\') {
        esc = true;
        continue;
      }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        const slice = html.slice(start, i + 1);
        try {
          return { end: i + 1, value: JSON.parse(slice) as Record<string, unknown> };
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function shareLinkFallback(threadId: number): string {
  return `${SITE}/promocje/${threadId}`;
}

function parseThreadFromArticleHtml(articleHtml: string): Deal | null {
  const m = articleHtml.indexOf(THREAD_PROPS_MARKER);
  if (m === -1) return null;
  const jsonStart = m + THREAD_PROPS_MARKER.length;
  const parsed = parseJsonObjectAt(articleHtml, jsonStart);
  if (!parsed) return null;
  const t = parsed.value;
  const threadId = Number(t.threadId);
  if (!Number.isFinite(threadId)) return null;
  const price = typeof t.price === 'number' ? t.price : null;
  const rawOld = t.nextBestPrice;
  const oldPrice = typeof rawOld === 'number' && rawOld > 0 ? rawOld : null;
  const discountPct =
    price !== null && oldPrice !== null && oldPrice > price
      ? Math.round(((oldPrice - price) / oldPrice) * 100)
      : null;
  const mg = t.mainGroup as { threadGroupUrlName?: string; threadGroupName?: string } | undefined;
  const categories = mg ? [mg.threadGroupUrlName || mg.threadGroupName].filter(Boolean) as string[] : [];
  const typeStr = typeof t.type === 'string' ? t.type.toLowerCase() : 'deal';
  const merchant = t.merchant as { merchantName?: string } | undefined;
  return {
    thread_id: threadId,
    title: (t.title as string) ?? '',
    description: undefined,
    price,
    next_best_price: oldPrice,
    temperature: typeof t.temperature === 'number' ? t.temperature : 0,
    vote_count: undefined,
    comment_count: typeof t.commentCount === 'number' ? t.commentCount : undefined,
    is_expired: !!t.isExpired,
    is_new: !!t.isNew,
    share_link: (t.shareableLink as string) || shareLinkFallback(threadId),
    merchant: merchant ? { merchant_name: merchant.merchantName } : null,
    groups: mg ? [{ group_name: mg.threadGroupName, group_url_name: mg.threadGroupUrlName }] : [],
    thread_type: { name: typeStr },
    discountPct,
    categories,
  };
}

function parseListingHtml(html: string): Deal[] {
  const deals: Deal[] = [];
  const re = new RegExp(ARTICLE_OPEN_RE.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const articleStart = match.index;
    const closeIdx = html.indexOf('</article>', articleStart);
    if (closeIdx === -1) break;
    const articleHtml = html.slice(articleStart, closeIdx + '</article>'.length);
    const deal = parseThreadFromArticleHtml(articleHtml);
    if (deal) deals.push(deal);
  }
  return deals;
}

async function fetchThreadsHtml(orderBy: 'new' | 'hot', limit: number): Promise<Deal[]> {
  const basePath = orderBy === 'new' ? '/promocje-nowe' : '/promocje';
  const maxPages = Math.min(HTML_MAX_PAGES, Math.max(1, Math.ceil(limit / HTML_PER_PAGE_EST)));
  const collected: Deal[] = [];
  const ua = userAgent();
  for (let page = 1; page <= maxPages && collected.length < limit; page++) {
    const url = page === 1 ? `${SITE}${basePath}` : `${SITE}${basePath}?page=${page}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': ua,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'pl-PL,pl;q=0.9',
      },
    });
    if (!res.ok) {
      throw new Error(`Pepper HTML ${orderBy} page ${page} failed: ${res.status}`);
    }
    const html = await res.text();
    const chunk = parseListingHtml(html);
    if (chunk.length === 0 && page === 1) {
      throw new Error(`Pepper HTML ${orderBy}: no threads parsed (layout changed?)`);
    }
    for (const d of chunk) {
      collected.push(d);
      if (collected.length >= limit) break;
    }
    if (chunk.length < HTML_PER_PAGE_EST) break;
  }
  return collected.slice(0, limit);
}

function isSignatureMissingError(message: string): boolean {
  return (
    /signature_missing/i.test(message) ||
    /Pepper API (new|hot) failed: 401\b/.test(message)
  );
}

async function fetchThreads(orderBy: 'new' | 'hot', limit = 50): Promise<Deal[]> {
  try {
    return await fetchThreadsRest(orderBy, limit);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isSignatureMissingError(msg)) {
      console.warn(`[pepper] REST failed (${orderBy}): falling back to HTML listings.`);
      return fetchThreadsHtml(orderBy, limit);
    }
    throw e;
  }
}

function normalize(raw: Record<string, unknown>): Deal {
  const price = typeof raw.price === 'number' ? raw.price : null;
  const oldPrice = typeof raw.next_best_price === 'number' ? raw.next_best_price : null;
  const discountPct =
    price && oldPrice && oldPrice > price
      ? Math.round(((oldPrice - price) / oldPrice) * 100)
      : null;
  const groups = (raw.groups ?? []) as Array<{ group_url_name?: string; group_name?: string }>;
  const categories = groups
    .map((g) => g.group_url_name || g.group_name)
    .filter(Boolean) as string[];
  const tid = raw.thread_id as number;
  return {
    thread_id: tid,
    title: (raw.title as string) ?? '',
    description: raw.description as string | undefined,
    price,
    next_best_price: oldPrice,
    temperature: (raw.temperature as number) ?? 0,
    vote_count: raw.vote_count as number | undefined,
    comment_count: raw.comment_count as number | undefined,
    is_expired: !!raw.is_expired,
    is_new: !!raw.is_new,
    share_link: (raw.share_link as string) ?? shareLinkFallback(tid),
    merchant: (raw.merchant as Deal['merchant']) ?? null,
    groups: raw.groups as Deal['groups'],
    thread_type: raw.thread_type as Deal['thread_type'],
    discountPct,
    categories,
  };
}

/** Fetches both new + hot, deduplicates by thread_id. Maximizes coverage. */
export async function fetchAllRelevant(): Promise<Deal[]> {
  const [newD, hotD] = await Promise.all([
    fetchThreads('new', PEPPER_FETCH_LIMIT_NEW),
    fetchThreads('hot', PEPPER_FETCH_LIMIT_HOT),
  ]);
  const seen = new Set<number>();
  const merged: Deal[] = [];
  for (const d of [...hotD, ...newD]) {
    if (!seen.has(d.thread_id)) {
      seen.add(d.thread_id);
      merged.push(d);
    }
  }
  return merged;
}
