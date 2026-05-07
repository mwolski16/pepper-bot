import { describe, expect, it } from 'vitest';
import type { Deal } from '../src/types.js';
import {
  baseFilter,
  dealFullText,
  hunterMatch,
  isBoardGameText,
  isExcludedIphoneAccessoryDeal,
  isStandaloneConsoleControllerText,
  isVideoGameDeal,
  relevancePrefilterKeep,
} from '../src/filter.js';
import { HEAVY_DISCOUNT_THRESHOLD } from '../src/config.js';

function deal(overrides: Partial<Deal> & Pick<Deal, 'thread_id' | 'title'>): Deal {
  return {
    share_link: 'https://www.pepper.pl/p/1',
    temperature: 0,
    is_expired: false,
    thread_type: { name: 'deal' },
    ...overrides,
  };
}

describe('dealFullText', () => {
  it('joins title and description with newline', () => {
    expect(dealFullText(deal({ thread_id: 1, title: 'A', description: 'B' }))).toBe('A\nB');
  });

  it('uses title only when description missing', () => {
    expect(dealFullText(deal({ thread_id: 1, title: 'Only' }))).toBe('Only');
  });
});

describe('isVideoGameDeal', () => {
  it('returns true for steam category', () => {
    expect(isVideoGameDeal(deal({ thread_id: 1, title: 'Thing', categories: ['steam'] }))).toBe(true);
  });

  it('returns false for board game hint in text', () => {
    const d = deal({
      thread_id: 1,
      title: 'Catan promo',
      description: 'board game night',
      categories: ['steam'],
    });
    expect(isBoardGameText(dealFullText(d))).toBe(true);
    expect(isVideoGameDeal(d)).toBe(false);
  });

  it('returns true for steam key in text', () => {
    expect(
      isVideoGameDeal(deal({ thread_id: 1, title: 'Klucz Steam do gry XYZ' })),
    ).toBe(true);
  });

  it('returns false for unrelated hardware', () => {
    expect(isVideoGameDeal(deal({ thread_id: 1, title: 'Monitor 27"' }))).toBe(false);
  });
});

describe('isStandaloneConsoleControllerText', () => {
  it('detects solo Xbox pad', () => {
    expect(isStandaloneConsoleControllerText('Kontroler bezprzewodowy Xbox Series')).toBe(true);
  });

  it('returns false when bundle mentions konsola in zestaw pattern', () => {
    expect(
      isStandaloneConsoleControllerText('Kontroler Xbox zestaw z konsolą'),
    ).toBe(false);
  });

  it('returns false for midi to avoid false positives', () => {
    expect(isStandaloneConsoleControllerText('midi kontroler xbox')).toBe(false);
  });
});

describe('iPhone accessory rules', () => {
  it('excludes generic iPhone case without 14 Pro', () => {
    const d = deal({
      thread_id: 1,
      title: 'Etui na iPhone 15',
    });
    expect(isExcludedIphoneAccessoryDeal(d)).toBe(true);
  });

  it('keeps iPhone 14 Pro accessory', () => {
    const d = deal({
      thread_id: 1,
      title: 'Etui iPhone 14 Pro Max',
    });
    expect(isExcludedIphoneAccessoryDeal(d)).toBe(false);
  });
});

describe('relevancePrefilterKeep', () => {
  it('drops video games', () => {
    expect(
      relevancePrefilterKeep(deal({ thread_id: 1, title: 'Steam key', categories: ['steam'] })),
    ).toBe(false);
  });

  it('keeps allowed deal', () => {
    expect(
      relevancePrefilterKeep(deal({ thread_id: 1, title: 'Mechanical keyboard' })),
    ).toBe(true);
  });
});

describe('baseFilter', () => {
  it('drops expired', () => {
    const out = baseFilter([deal({ thread_id: 1, title: 'X', is_expired: true })]);
    expect(out).toHaveLength(0);
  });

  it('drops non-deal thread types', () => {
    const out = baseFilter([
      deal({ thread_id: 1, title: 'X', thread_type: { name: 'discussion' } }),
    ]);
    expect(out).toHaveLength(0);
  });

  it('keeps voucher type', () => {
    const d = deal({ thread_id: 1, title: 'Voucher', thread_type: { name: 'voucher' } });
    expect(baseFilter([d])).toEqual([d]);
  });

  it('drops hard-excluded categories', () => {
    const out = baseFilter([
      deal({ thread_id: 1, title: 'X', categories: ['kosmetyki'] }),
    ]);
    expect(out).toHaveLength(0);
  });

  it('applies relevance prefilter', () => {
    const out = baseFilter([
      deal({ thread_id: 1, title: 'Gra PC', categories: ['gry-pc'] }),
    ]);
    expect(out).toHaveLength(0);
  });
});

describe('hunterMatch', () => {
  it('matches watchlist keyword with any price when maxPrice is 0', () => {
    const r = hunterMatch(
      deal({ thread_id: 1, title: 'Promka Xbox Series X zestaw' }),
    );
    expect(r.match).toBe(true);
    expect(r.reason).toContain('Watchlist');
  });

  it('skips watchlist when standalone controller', () => {
    const r = hunterMatch(
      deal({
        thread_id: 1,
        title: 'Kontroler Xbox Series X',
        description: 'pad bezprzewodowy xbox',
      }),
    );
    expect(r.match).toBe(false);
  });

  it('matches heavy discount outside spammy categories', () => {
    const r = hunterMatch(
      deal({
        thread_id: 1,
        title: 'Monitor',
        discountPct: HEAVY_DISCOUNT_THRESHOLD,
        categories: ['elektronika'],
      }),
    );
    expect(r.match).toBe(true);
    expect(r.reason).toContain('Heavy discount');
  });

  it('ignores heavy discount in excluded discount categories', () => {
    const r = hunterMatch(
      deal({
        thread_id: 1,
        title: 'Game',
        discountPct: 99,
        categories: ['gry-pc'],
      }),
    );
    expect(r.match).toBe(false);
  });
});
