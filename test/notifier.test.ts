import { describe, expect, it, vi } from 'vitest';
import { esc, sendTelegramHtml } from '../src/notifier.js';

describe('esc', () => {
  it('escapes HTML special characters', () => {
    expect(esc('a < b & c > d')).toBe('a &lt; b &amp; c &gt; d');
  });
});

describe('sendTelegramHtml', () => {
  it('POSTs JSON body to Telegram API', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await sendTelegramHtml('TOKEN', 'CHAT', 'hello');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.telegram.org/botTOKEN/sendMessage');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' });
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      chat_id: 'CHAT',
      text: 'hello',
      parse_mode: 'HTML',
      disable_web_page_preview: false,
    });
  });

  it('throws on non-OK response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('bad', { status: 401 })),
    );

    await expect(sendTelegramHtml('T', 'C', 'x')).rejects.toThrow('Telegram 401');
  });
});
