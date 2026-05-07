import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Deal } from '../src/types.js';

function digestFreeModel(id: string, contextLength: number) {
  return {
    id,
    context_length: contextLength,
    architecture: { output_modalities: ['text'] as string[] },
    supported_parameters: ['response_format'] as string[],
    top_provider: { context_length: contextLength, max_completion_tokens: 128 },
  };
}

function minimalDeal(overrides: Partial<Deal> = {}): Deal {
  return {
    thread_id: 1,
    title: 'Test deal',
    share_link: 'https://www.pepper.pl/1',
    temperature: 10,
    is_expired: false,
    ...overrides,
  };
}

function modelsResponse(models: ReturnType<typeof digestFreeModel>[]) {
  return new Response(JSON.stringify({ data: models }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function chatResponse(content: string, status = 200) {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content } }],
    }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );
}

describe('pickTop5', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    vi.stubEnv('OPENROUTER_API_KEY', 'test-api-key');
    vi.stubEnv('OPENROUTER_MODEL', '');
    vi.stubEnv('OPENROUTER_MODEL_FALLBACK', '');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('throws when OPENROUTER_API_KEY is missing', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { pickTop5 } = await import('../src/llm.js');
    await expect(pickTop5([minimalDeal()])).rejects.toThrow('OPENROUTER_API_KEY not set');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('parses picks from plain JSON content', async () => {
    const picksJson = JSON.stringify({
      picks: [{ thread_id: 1, reason: 'Dobry deal' }],
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(modelsResponse([digestFreeModel('alpha/model:free', 8000)]))
      .mockResolvedValueOnce(chatResponse(picksJson));
    vi.stubGlobal('fetch', fetchMock);

    const { pickTop5 } = await import('../src/llm.js');
    const picks = await pickTop5([minimalDeal()]);
    expect(picks).toEqual([{ thread_id: 1, reason: 'Dobry deal' }]);
  });

  it('strips fenced markdown from JSON content', async () => {
    const inner = JSON.stringify({
      picks: [{ thread_id: 2, reason: 'OK' }],
    });
    const fenced = '```json\n' + inner + '\n```';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(modelsResponse([digestFreeModel('beta/model:free', 9000)]))
      .mockResolvedValueOnce(chatResponse(fenced));
    vi.stubGlobal('fetch', fetchMock);

    const { pickTop5 } = await import('../src/llm.js');
    const picks = await pickTop5([minimalDeal({ thread_id: 2 })]);
    expect(picks).toEqual([{ thread_id: 2, reason: 'OK' }]);
  });

  it('trims picks to OPENROUTER_TOP_PICKS', async () => {
    const many = Array.from({ length: 6 }, (_, i) => ({
      thread_id: i + 1,
      reason: `r${i}`,
    }));
    const picksJson = JSON.stringify({ picks: many });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(modelsResponse([digestFreeModel('gamma/model:free', 7000)]))
      .mockResolvedValueOnce(chatResponse(picksJson));
    vi.stubGlobal('fetch', fetchMock);

    const { pickTop5 } = await import('../src/llm.js');
    const picks = await pickTop5(many.map((p) => minimalDeal({ thread_id: p.thread_id })));
    expect(picks).toHaveLength(5);
    expect(picks[0].thread_id).toBe(1);
  });

  it('retries the same model after 429 using backoff', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const picksJson = JSON.stringify({
      picks: [{ thread_id: 1, reason: 'Po retry' }],
    });
    let completionAttempts = 0;
    const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/v1/models')) {
        return modelsResponse([digestFreeModel('retry/model:free', 6000)]);
      }
      if (url.includes('chat/completions')) {
        completionAttempts += 1;
        if (completionAttempts === 1) {
          return new Response('busy', { status: 429 });
        }
        return chatResponse(picksJson);
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { pickTop5 } = await import('../src/llm.js');
    const promise = pickTop5([minimalDeal()]);

    await vi.advanceTimersByTimeAsync(2500);
    const picks = await promise;

    expect(picks).toEqual([{ thread_id: 1, reason: 'Po retry' }]);
    expect(completionAttempts).toBeGreaterThanOrEqual(2);
  });

  it('prefers openrouter/free first when OPENROUTER_MODEL is set', async () => {
    vi.stubEnv('OPENROUTER_MODEL', 'openrouter/free');
    const picksJson = JSON.stringify({
      picks: [{ thread_id: 1, reason: 'via router' }],
    });
    let firstChatModel: string | undefined;
    const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/v1/models')) {
        return modelsResponse([digestFreeModel('ranked/model:free', 5000)]);
      }
      if (url.includes('chat/completions')) {
        const body = init?.body ? JSON.parse(init.body as string) : {};
        if (firstChatModel === undefined) firstChatModel = body.model;
        return chatResponse(picksJson);
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { pickTop5 } = await import('../src/llm.js');
    await pickTop5([minimalDeal()]);
    expect(firstChatModel).toBe('openrouter/free');
  });

  it('throws OpenRouterFreeModelsExhaustedError when every model returns 429', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/v1/models')) {
        return modelsResponse([digestFreeModel('only/model:free', 6000)]);
      }
      if (url.includes('chat/completions')) {
        return new Response('rate limited', { status: 429 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { pickTop5, OpenRouterFreeModelsExhaustedError } = await import('../src/llm.js');
    const promise = pickTop5([minimalDeal()]);
    const assertion = expect(promise).rejects.toThrow(OpenRouterFreeModelsExhaustedError);
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
  });

  it('skips generic router OPENROUTER_MODEL and uses ranked free models', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubEnv('OPENROUTER_MODEL', 'openrouter/auto');
    const picksJson = JSON.stringify({
      picks: [{ thread_id: 1, reason: 'ranked' }],
    });
    let firstChatModel: string | undefined;
    const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/v1/models')) {
        return modelsResponse([
          digestFreeModel('first/model:free', 6000),
          digestFreeModel('second/model:free', 5000),
        ]);
      }
      if (url.includes('chat/completions')) {
        const body = init?.body ? JSON.parse(init.body as string) : {};
        if (firstChatModel === undefined) firstChatModel = body.model;
        return chatResponse(picksJson);
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { pickTop5 } = await import('../src/llm.js');
    await pickTop5([minimalDeal()]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('openrouter/auto'));
    expect(firstChatModel).toBe('first/model:free');
    warn.mockRestore();
  });

  it('tries next model when first returns 404', async () => {
    const models = [
      digestFreeModel('first/model:free', 3000),
      digestFreeModel('second/model:free', 2000),
    ];
    const picksJson = JSON.stringify({
      picks: [{ thread_id: 1, reason: 'Drugi model' }],
    });
    const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/v1/models')) {
        return modelsResponse(models);
      }
      if (url.includes('chat/completions')) {
        const body = init?.body ? JSON.parse(init.body as string) : {};
        if (body.model === 'first/model:free') {
          return new Response('missing', { status: 404 });
        }
        return chatResponse(picksJson);
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { pickTop5 } = await import('../src/llm.js');
    const picks = await pickTop5([minimalDeal()]);
    expect(picks).toEqual([{ thread_id: 1, reason: 'Drugi model' }]);
  });
});
