import { fetchAllRelevant } from './pepper.js';
import { baseFilter } from './filter.js';
import { filterUnseen } from './dedupe.js';
import { pickTop5 } from './llm.js';
import { makeNotifier, esc } from './notifier.js';
import type { Deal, Pick } from './types.js';

export async function runDigest(): Promise<void> {
  const notifier = makeNotifier();
  try {
    const all = await fetchAllRelevant();
    const filtered = baseFilter(all);
    const { unseen, markSeen } = await filterUnseen(filtered);

    if (unseen.length === 0) {
      console.log('No new deals since last run.');
      return;
    }

    console.log(`Sending ${unseen.length} unseen deals to LLM…`);
    const picks = await pickTop5(unseen);

    if (picks.length === 0) {
      console.log('LLM returned no picks.');
      await markSeen();
      return;
    }

    const message = formatDigest(picks, unseen);
    await notifier.send(message);
    await markSeen();
    console.log('Digest sent.');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const msg = `❌ <b>Pepper Bot — błąd digestu</b>\n<code>${esc(message)}</code>`;
    try {
      await notifier.send(msg);
    } catch {
      console.error('Failed to send error notification:', err);
    }
    throw err;
  }
}

function formatDigest(picks: Pick[], pool: Deal[]): string {
  const byId = new Map(pool.map((d) => [d.thread_id, d]));
  const today = new Intl.DateTimeFormat('pl-PL', { dateStyle: 'full' }).format(new Date());

  let out = `🌶️ <b>Pepper — TOP 5 na ${today}</b>\n\n`;
  picks.forEach((p, i) => {
    const d = byId.get(p.thread_id);
    if (!d) return;
    const priceStr = d.price ? `${d.price.toFixed(2)} zł` : 'cena w opisie';
    const discountStr = d.discountPct ? ` (-${d.discountPct}%)` : '';
    out += `<b>${i + 1}. <a href="${d.share_link}">${esc(d.title)}</a></b>\n`;
    out += `💰 ${esc(priceStr)}${discountStr} · 🌡️ ${d.temperature}°\n`;
    out += `💭 ${esc(p.reason)}\n\n`;
  });
  return out.trim();
}
