import { fetchAllRelevant } from './pepper.js';
import { baseFilter, hunterMatch } from './filter.js';
import { filterUnseen } from './dedupe.js';
import { makeNotifier, esc } from './notifier.js';
import type { Deal } from './types.js';

export async function runHunter(): Promise<void> {
  const notifier = makeNotifier();
  try {
    const all = await fetchAllRelevant();
    const filtered = baseFilter(all);
    const { unseen, markSeen } = await filterUnseen(filtered);

    const hits: Array<{ deal: Deal; reason: string }> = [];
    for (const d of unseen) {
      const m = hunterMatch(d);
      if (m.match) hits.push({ deal: d, reason: m.reason });
    }

    if (hits.length === 0) {
      // Silent: no Telegram message when nothing matches
      console.log(`Hunter scanned ${unseen.length} unseen deals, 0 hits.`);
      await markSeen();
      return;
    }

    for (const { deal, reason } of hits) {
      await notifier.send(formatAlert(deal, reason));
    }
    await markSeen();
    console.log(`Hunter alerts sent: ${hits.length}`);
  } catch (err: unknown) {
    // Hunters fail silently EXCEPT on auth/config errors — we don't want spam from transient API issues
    console.error('Hunter error:', err);
    const errMsg = err instanceof Error ? err.message : String(err);
    if (/401|403|TELEGRAM/i.test(errMsg)) {
      try {
        await notifier.send(`❌ <b>Hunter — błąd konfiguracji</b>\n<code>${esc(errMsg)}</code>`);
      } catch {
        /* swallow */
      }
    }
    throw err;
  }
}

function formatAlert(deal: Deal, reason: string): string {
  const priceStr = deal.price ? `${deal.price.toFixed(2)} zł` : 'cena w opisie';
  const discountStr = deal.discountPct ? ` (-${deal.discountPct}%)` : '';
  return (
    `🚨 <b>OKAZJA — ${esc(reason)}</b>\n` +
    `<b><a href="${deal.share_link}">${esc(deal.title)}</a></b>\n` +
    `💰 ${esc(priceStr)}${discountStr} · 🌡️ ${deal.temperature}°`
  );
}
