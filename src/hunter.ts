import { fetchAllRelevant } from './pepper.js';
import { baseFilter, hunterMatch } from './filter.js';
import { filterUnseen } from './dedupe.js';
import { makeNotifier, esc } from './notifier.js';
import type { Deal, Notifier } from './types.js';
import {
  BOT_ERROR_EMOJI,
  DIGEST_PRICE_UNKNOWN_LABEL,
  HUNTER_ALERT_EMOJI,
  HUNTER_ALERT_SUBJECT_TAG,
  HUNTER_CONFIG_ERROR_TITLE,
} from './settings.js';

const NOTIFY_AUTH_ERROR = /401|403|TELEGRAM/i;

export type HunterProgress = (phase: string, detail?: string) => void | Promise<void>;

export interface RunHunterOptions {
  notifier?: Notifier;
  onProgress?: HunterProgress;
}

export async function runHunter(options?: RunHunterOptions): Promise<void> {
  const notifier = options?.notifier ?? makeNotifier();
  const onProgress = options?.onProgress;
  try {
    await onProgress?.('Hunter', 'Start — pobieranie Pepper…');
    const all = await fetchAllRelevant(onProgress);

    const filtered = baseFilter(all);
    await onProgress?.('Filtr', `Po filtrze bazowym: ${filtered.length} z ${all.length} ofert.`);

    const { unseen, markSeen } = await filterUnseen(filtered);
    await onProgress?.('Dedupe', `Nieoglądane: ${unseen.length} ofert.`);

    const hits: Array<{ deal: Deal; reason: string }> = [];
    for (const d of unseen) {
      const m = hunterMatch(d);
      if (m.match) hits.push({ deal: d, reason: m.reason });
    }

    if (hits.length === 0) {
      console.log(`Hunter scanned ${unseen.length} unseen deals, 0 hits.`);
      await onProgress?.('Hunter', `Koniec — 0 trafień (przeskanowano ${unseen.length} nieoglądanych).`);
      await markSeen();
      return;
    }

    await onProgress?.('Telegram', `Wysyłam ${hits.length} alert(ów)…`);
    for (const { deal, reason } of hits) {
      await notifier.send(formatAlert(deal, reason));
    }
    await markSeen();
    await onProgress?.('Hunter', `Gotowe — ${hits.length} alert(ów).`);
    console.log(`Hunter alerts sent: ${hits.length}`);
  } catch (err: unknown) {
    // Hunters fail silently EXCEPT on auth/config errors — we don't want spam from transient API issues
    console.error('Hunter error:', err);
    const errMsg = err instanceof Error ? err.message : String(err);
    await onProgress?.('Błąd', errMsg);
    if (NOTIFY_AUTH_ERROR.test(errMsg)) {
      try {
        await notifier.send(
          `${BOT_ERROR_EMOJI} <b>${HUNTER_CONFIG_ERROR_TITLE}</b>\n<code>${esc(errMsg)}</code>`,
        );
      } catch {
        /* swallow */
      }
    }
    throw err;
  }
}

function formatAlert(deal: Deal, reason: string): string {
  const priceStr = deal.price ? `${deal.price.toFixed(2)} zł` : DIGEST_PRICE_UNKNOWN_LABEL;
  const discountStr = deal.discountPct ? ` (-${deal.discountPct}%)` : '';
  return (
    `${HUNTER_ALERT_EMOJI} <b>${HUNTER_ALERT_SUBJECT_TAG} — ${esc(reason)}</b>\n` +
    `<b><a href="${deal.share_link}">${esc(deal.title)}</a></b>\n` +
    `💰 ${esc(priceStr)}${discountStr} · 🌡️ ${deal.temperature}°`
  );
}
