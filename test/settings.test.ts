import { describe, expect, it } from 'vitest';
import { DIGEST_HEADER_TEMPLATE, formatDigestHeader } from '../src/settings.js';

describe('formatDigestHeader', () => {
  it('replaces date placeholder', () => {
    const date = 'środa, 7 maja 2025';
    expect(formatDigestHeader(date)).toBe(DIGEST_HEADER_TEMPLATE.replace('{{date}}', date));
  });
});
