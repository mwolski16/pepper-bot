import { fetchAllRelevant } from './pepper.js';
import { baseFilter } from './filter.js';
import { filterUnseen } from './dedupe.js';
import { OpenRouterFreeModelsExhaustedError, pickTop5 } from './llm.js';
import { makeNotifier, esc } from './notifier.js';
import type { Deal, Notifier, Pick } from './types.js';
import {
  BOT_ERROR_EMOJI,
  DIGEST_DATE_LOCALE,
  DIGEST_DATE_OPTIONS,
  DIGEST_EMPTY_BODY,
  DIGEST_ERROR_TITLE,
  DIGEST_LLM_UNAVAILABLE_BODY,
  DIGEST_PRICE_UNKNOWN_LABEL,
  formatDigestHeader,
} from './settings.js';

/** Status lines for manual runs (Telegram control bot). */
export type DigestProgress = (phase: string, detail?: string) => void | Promise<void>;

export interface RunDigestOptions {
  /** Defaults to `makeNotifier()` (respects DRY_RUN). */
  notifier?: Notifier;
  onProgress?: DigestProgress;
}

export async function runDigest(options?: RunDigestOptions): Promise<void> {
  const notifier = options?.notifier ?? makeNotifier();
  const onProgress = options?.onProgress;
  try {
    await onProgress?.('Digest', 'Start — pobieranie Pepper…');
    const all = await fetchAllRelevant(onProgress);

    const filtered = baseFilter(all);
    await onProgress?.('Filtr', `Po filtrze bazowym: ${filtered.length} z ${all.length} ofert.`);

    const { unseen, markSeen } = await filterUnseen(filtered);
    await onProgress?.('Dedupe', `Nieoglądane (nowe dla Ciebie): ${unseen.length} ofert.`);

    if (unseen.length === 0) {
      console.log('No new deals since last run.');
      await onProgress?.('Digest', 'Koniec — brak nowych ofert od ostatniego skanu (seen).');
      return;
    }

    console.log(`Sending ${unseen.length} unseen deals to LLM…`);
    await onProgress?.('LLM', `Wysyłam ${unseen.length} ofert do OpenRouter…`);
    const picks = await pickTop5(unseen, {
      onProgress: onProgress
        ? async (msg) => {
            await onProgress('LLM', msg);
          }
        : undefined,
    });
    await onProgress?.('LLM', `Odpowiedź: ${picks.length} pick(ów).`);

    if (picks.length === 0) {
      console.log('LLM returned no picks; sending empty-state message.');
      await onProgress?.('Telegram', 'Wysyłka komunikatu „brak propozycji”…');
      await notifier.send(DIGEST_EMPTY_BODY);
      await markSeen();
      await onProgress?.('Digest', 'Gotowe (pusta lista picków).');
      return;
    }

    const message = formatDigest(picks, unseen);
    if (!message) {
      console.log('No valid picks resolved to deals; sending empty-state message.');
      await onProgress?.('Telegram', 'Brak poprawnych thread_id — wysyłka „brak propozycji”…');
      await notifier.send(DIGEST_EMPTY_BODY);
      await markSeen();
      await onProgress?.('Digest', 'Gotowe (picki nie mapują się na oferty).');
      return;
    }
    await onProgress?.('Telegram', 'Wysyłka digestu…');
    await notifier.send(message);
    await markSeen();
    await onProgress?.('Digest', 'Gotowe — digest wysłany.');
    console.log('Digest sent.');
  } catch (err: unknown) {
    if (err instanceof OpenRouterFreeModelsExhaustedError) {
      console.warn('[digest] OpenRouter free models exhausted:', err.lastErrorText);
      await onProgress?.('LLM', 'OpenRouter — wszystkie darmowe modele zawiodły.');
      try {
        await notifier.send(DIGEST_LLM_UNAVAILABLE_BODY);
      } catch (sendErr) {
        console.error('Failed to send LLM-unavailable notification:', sendErr);
      }
      await onProgress?.('Digest', 'Koniec — LLM niedostępny, seen bez zmian (ponów następnym razem).');
      return;
    }

    const message = err instanceof Error ? err.message : String(err);
    const msg = `${BOT_ERROR_EMOJI} <b>${DIGEST_ERROR_TITLE}</b>\n<code>${esc(message)}</code>`;
    try {
      await notifier.send(msg);
    } catch {
      console.error('Failed to send error notification:', err);
    }
    throw err;
  }
}

function formatDigest(picks: Pick[], pool: Deal[]): string | null {
  const byId = new Map(pool.map((d) => [d.thread_id, d]));
  const today = new Intl.DateTimeFormat(DIGEST_DATE_LOCALE, DIGEST_DATE_OPTIONS).format(new Date());

  let out = formatDigestHeader(today);
  let index = 0;
  picks.forEach((p) => {
    const d = byId.get(p.thread_id);
    if (!d) return;
    index += 1;
    const priceStr = d.price ? `${d.price.toFixed(2)} zł` : DIGEST_PRICE_UNKNOWN_LABEL;
    const discountStr = d.discountPct ? ` (-${d.discountPct}%)` : '';
    out += `<b>${index}. <a href="${d.share_link}">${esc(d.title)}</a></b>\n`;
    out += `💰 ${esc(priceStr)}${discountStr} · 🌡️ ${d.temperature}°\n`;
    out += `💭 ${esc(p.reason)}\n\n`;
  });
  if (index === 0) return null;
  return out.trim();
}
