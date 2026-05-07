import { afterEach, describe, expect, it, vi } from 'vitest';

describe('openrouter-free-models', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  function model(overrides: Partial<{
    id: string;
    context_length: number;
    architecture: { output_modalities: string[] } | null;
    supported_parameters: string[] | null;
    top_provider: { context_length: number | null; max_completion_tokens: number | null } | null;
  }>) {
    return {
      id: 'meta/llama-3-8b-instruct:free',
      context_length: 8192,
      architecture: { output_modalities: ['text'] as string[] },
      supported_parameters: ['response_format'] as string[],
      top_provider: { context_length: null, max_completion_tokens: 1024 },
      ...overrides,
    };
  }

  it('filters :free text models with response_format and excludes openrouter router ids', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            model({
              id: 'openrouter/auto',
              context_length: 999_999,
            }),
            model({
              id: 'vendor/small:free',
              context_length: 1000,
              top_provider: { context_length: 1000, max_completion_tokens: 512 },
            }),
            model({
              id: 'vendor/big:free',
              context_length: 2000,
              top_provider: { context_length: 2000, max_completion_tokens: 256 },
            }),
            model({
              id: 'vendor/no-format:free',
              supported_parameters: [],
            }),
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { fetchRankedFreeModelIds } = await import('../src/openrouter-free-models.js');
    const ids = await fetchRankedFreeModelIds('key');

    expect(ids[0]).toBe('vendor/big:free');
    expect(ids).toEqual(['vendor/big:free', 'vendor/small:free']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('uses in-memory cache on second call within TTL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            model({
              id: 'vendor/cached:free',
              context_length: 5000,
            }),
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { fetchRankedFreeModelIds } = await import('../src/openrouter-free-models.js');
    await fetchRankedFreeModelIds('k');
    await fetchRankedFreeModelIds('k');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws on non-OK models response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('nope', { status: 500 })),
    );
    const { fetchRankedFreeModelIds } = await import('../src/openrouter-free-models.js');
    await expect(fetchRankedFreeModelIds('k')).rejects.toThrow('OpenRouter models list 500');
  });

  it('throws when no digest candidates', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: [{ id: 'paid/model', context_length: 1e6 }] }), {
          status: 200,
        }),
      ),
    );
    const { fetchRankedFreeModelIds } = await import('../src/openrouter-free-models.js');
    await expect(fetchRankedFreeModelIds('k')).rejects.toThrow('no :free text models');
  });

  it('isOpenRouterRouterModel detects router prefix', async () => {
    const { isOpenRouterRouterModel } = await import('../src/openrouter-free-models.js');
    expect(isOpenRouterRouterModel('openrouter/foo')).toBe(true);
    expect(isOpenRouterRouterModel('google/gemini:free')).toBe(false);
  });

  it('isOpenRouterFreeModelsRouter detects free router id', async () => {
    const { isOpenRouterFreeModelsRouter } = await import('../src/openrouter-free-models.js');
    expect(isOpenRouterFreeModelsRouter('openrouter/free')).toBe(true);
    expect(isOpenRouterFreeModelsRouter(' openrouter/free ')).toBe(true);
    expect(isOpenRouterFreeModelsRouter('openrouter/auto')).toBe(false);
  });
});
