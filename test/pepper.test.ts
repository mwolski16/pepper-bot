import { beforeEach, describe, expect, it, vi } from 'vitest';

const THREAD_PROPS_MARKER = '"props":{"thread":';

describe('fetchAllRelevant', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('merges hot then new with unique thread_id', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const u = String(input);
        if (u.includes('order_by=hot')) {
          return new Response(
            JSON.stringify({
              data: [
                {
                  thread_id: 2,
                  title: 'Hot B',
                  price: 20,
                  temperature: 50,
                  is_expired: false,
                  share_link: 'https://www.pepper.pl/2',
                },
                {
                  thread_id: 1,
                  title: 'Hot A dup',
                  price: 10,
                  temperature: 40,
                  is_expired: false,
                  share_link: 'https://www.pepper.pl/1',
                },
              ],
            }),
            { status: 200 },
          );
        }
        if (u.includes('order_by=new')) {
          return new Response(
            JSON.stringify({
              data: [
                {
                  thread_id: 1,
                  title: 'New A',
                  price: 10,
                  temperature: 5,
                  is_expired: false,
                  share_link: 'https://www.pepper.pl/1',
                },
              ],
            }),
            { status: 200 },
          );
        }
        throw new Error(`unexpected URL: ${u}`);
      }),
    );

    const { fetchAllRelevant } = await import('../src/pepper.js');
    const deals = await fetchAllRelevant();
    expect(deals.map((d) => d.thread_id)).toEqual([2, 1]);
    expect(deals[1].title).toBe('Hot A dup');
  });

  it('falls back to HTML listing for new when REST returns 401 signature error', async () => {
    const thread = {
      threadId: 501,
      title: 'HTML thread',
      price: 12,
      nextBestPrice: 20,
      isExpired: false,
      isNew: true,
      commentCount: 1,
      temperature: 9,
      type: 'deal',
      shareableLink: 'https://www.pepper.pl/501',
      mainGroup: { threadGroupUrlName: 'agd', threadGroupName: 'AGD' },
    };
    const article = `<article id="thread_501">x ${THREAD_PROPS_MARKER}${JSON.stringify(thread)}</article>`;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const u = String(input);
        if (u.includes('/rest_api/v2/threads') && u.includes('order_by=new')) {
          return new Response('nope', { status: 401 });
        }
        if (u.includes('/rest_api/v2/threads') && u.includes('order_by=hot')) {
          return new Response(
            JSON.stringify({
              data: [
                {
                  thread_id: 900,
                  title: 'REST hot',
                  price: 1,
                  temperature: 0,
                  is_expired: false,
                  share_link: 'https://www.pepper.pl/900',
                },
              ],
            }),
            { status: 200 },
          );
        }
        if (u === 'https://www.pepper.pl/promocje-nowe') {
          return new Response(article, { status: 200 });
        }
        throw new Error(`unexpected URL: ${u}`);
      }),
    );

    const { fetchAllRelevant } = await import('../src/pepper.js');
    const deals = await fetchAllRelevant();
    const ids = deals.map((d) => d.thread_id);
    expect(ids).toEqual([900, 501]);
    const fromHtml = deals.find((d) => d.thread_id === 501);
    expect(fromHtml?.title).toBe('HTML thread');
  });
});
