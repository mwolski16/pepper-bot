import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

import { readFile, writeFile } from 'node:fs/promises';
import { filterUnseen } from '../src/dedupe.js';

const readFileMock = vi.mocked(readFile);
const writeFileMock = vi.mocked(writeFile);

describe('filterUnseen', () => {
  const NOW = 1_700_000_000_000;

  beforeEach(() => {
    readFileMock.mockReset();
    writeFileMock.mockReset();
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
  });

  it('treats all deals as unseen when store file is missing', async () => {
    readFileMock.mockRejectedValue(new Error('ENOENT'));

    const deals = [{ thread_id: 1 }, { thread_id: 2 }];
    const { unseen, markSeen } = await filterUnseen(deals);

    expect(unseen).toEqual(deals);
    await markSeen();
    expect(writeFileMock).toHaveBeenCalled();
    const saved = JSON.parse(writeFileMock.mock.calls[0][1] as string);
    expect(saved.seen).toHaveLength(2);
    expect(saved.seen.map((e: { id: number }) => e.id).sort()).toEqual([1, 2]);
  });

  it('filters already seen thread ids', async () => {
    readFileMock.mockResolvedValue(
      JSON.stringify({
        seen: [{ id: 1, ts: NOW }],
      }),
    );

    const { unseen } = await filterUnseen([{ thread_id: 1 }, { thread_id: 2 }]);
    expect(unseen).toEqual([{ thread_id: 2 }]);
  });

  it('prunes expired seen entries by TTL before filtering', async () => {
    const oldTs = NOW - 31 * 24 * 60 * 60 * 1000;
    readFileMock.mockResolvedValue(
      JSON.stringify({
        seen: [{ id: 1, ts: oldTs }],
      }),
    );

    const { unseen } = await filterUnseen([{ thread_id: 1 }]);
    expect(unseen).toEqual([{ thread_id: 1 }]);
  });
});
