import { readFile, writeFile } from 'node:fs/promises';
import { SEEN_TTL_DAYS } from './settings.js';

const SEEN_JSON_PATH = 'data/seen.json';

interface SeenStore {
  seen: Array<{ id: number; ts: number }>;
}

async function load(): Promise<SeenStore> {
  try {
    const raw = await readFile(SEEN_JSON_PATH, 'utf-8');
    return JSON.parse(raw) as SeenStore;
  } catch {
    return { seen: [] };
  }
}

async function save(store: SeenStore): Promise<void> {
  await writeFile(SEEN_JSON_PATH, JSON.stringify(store, null, 2));
}

function prune(store: SeenStore): SeenStore {
  const cutoff = Date.now() - SEEN_TTL_DAYS * 24 * 60 * 60 * 1000;
  return { seen: store.seen.filter((e) => e.ts > cutoff) };
}

export async function filterUnseen<T extends { thread_id: number }>(
  deals: T[],
): Promise<{ unseen: T[]; markSeen: () => Promise<void> }> {
  const store = prune(await load());
  const seenIds = new Set(store.seen.map((e) => e.id));
  const unseen = deals.filter((d) => !seenIds.has(d.thread_id));

  return {
    unseen,
    markSeen: async () => {
      const now = Date.now();
      for (const d of unseen) store.seen.push({ id: d.thread_id, ts: now });
      await save(store);
    },
  };
}
