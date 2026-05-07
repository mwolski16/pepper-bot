import { beforeEach, describe, expect, it, vi } from 'vitest';

const sampleDeal = {
  thread_id: 42,
  title: 'Deal',
  share_link: 'https://www.pepper.pl/x',
  temperature: 5,
  is_expired: false,
};

const hoisted = vi.hoisted(() => ({
  pickTop5Mock: vi.fn(),
  markSeen: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/pepper.js', () => ({
  fetchAllRelevant: vi.fn().mockResolvedValue([{ ...sampleDeal }]),
}));

vi.mock('../src/filter.js', () => ({
  baseFilter: vi.fn((deals: unknown[]) => deals),
}));

vi.mock('../src/dedupe.js', () => ({
  filterUnseen: vi.fn(async () => ({
    unseen: [{ ...sampleDeal }],
    markSeen: hoisted.markSeen,
  })),
}));

vi.mock('../src/llm.js', async () => {
  const actual = await vi.importActual<typeof import('../src/llm.js')>('../src/llm.js');
  return { ...actual, pickTop5: hoisted.pickTop5Mock };
});

describe('runDigest', () => {
  beforeEach(async () => {
    vi.resetModules();
    hoisted.pickTop5Mock.mockReset();
    hoisted.markSeen.mockClear();
  });

  it('does not mark seen when OpenRouter free models are exhausted', async () => {
    const { OpenRouterFreeModelsExhaustedError } = await import('../src/llm.js');
    hoisted.pickTop5Mock.mockRejectedValue(new OpenRouterFreeModelsExhaustedError('upstream'));
    const send = vi.fn().mockResolvedValue(undefined);
    const { runDigest } = await import('../src/digest.js');
    await runDigest({
      notifier: { send, name: 'test' },
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toMatch(/OpenRouter|nie oznaczam/i);
    expect(hoisted.markSeen).not.toHaveBeenCalled();
  });
});
