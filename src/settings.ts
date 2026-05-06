/**
 * Values you are likely to tweak: prompts, LLM sizing, how much Pepper to pull,
 * how long deals stay “seen”, and Telegram wording.
 * Stable wiring lives in the other modules; buying profile stays in `config.ts`.
 */

// ─── LLM digest ───────────────────────────────────────────────────────────

export const OPENROUTER_DIGEST_TEMPERATURE = 0.3;

/** Max deals sent in one prompt (context / cost). */
export const OPENROUTER_MAX_DEALS_IN_PROMPT = 80;

/** Parsed picks capped to this many after the model responds. */
export const OPENROUTER_TOP_PICKS = 5;

/**
 * System prompt for the daily digest (Polish). Edit rules / JSON shape here.
 */
export const LLM_DIGEST_SYSTEM_PROMPT = `Jesteś asystentem polującym na okazje na pepper.pl dla użytkownika o sprecyzowanych zainteresowaniach.

Otrzymasz profil zainteresowań i listę aktualnych ofert. Wybierz TOP 5 ofert najlepiej dopasowanych do profilu.

Zasady:
- Uwzględniaj również oferty o niskiej temperaturze - świeże okazje znikają szybko, nim społeczność zdąży zagłosować.
- Pomijaj kategorie wymienione w EXCLUDE.
- Dla heavy discounts (>70%) ignoruj jeśli to gry lub programy - tam takie obniżki są codziennością.
- Zwróć ŚCIŚLE JSON wg schematu. Bez markdown, bez \`\`\`, bez komentarzy.

Schemat odpowiedzi:
{
  "picks": [
    { "thread_id": <number z listy>, "reason": "<1-2 zdania po polsku, dlaczego to dobra oferta. NIE PISZ 'ponieważ pasuje do profilu' lub 'ponieważ jest w kategorii' tylko dlaczego to dobra oferta ogólnie>" }
  ]
}`;

// ─── Pepper fetch depth ───────────────────────────────────────────────────

export const PEPPER_FETCH_LIMIT_NEW = 80;

export const PEPPER_FETCH_LIMIT_HOT = 50;

// ─── Dedupe ───────────────────────────────────────────────────────────────

/** Drop "seen" entries older than this many days. */
export const SEEN_TTL_DAYS = 30;

// ─── Telegram copy (digest + hunter) ───────────────────────────────────────

export const BOT_ERROR_EMOJI = '❌';

export const DIGEST_DATE_LOCALE = 'pl-PL';

export const DIGEST_DATE_OPTIONS = { dateStyle: 'full' } as const satisfies Intl.DateTimeFormatOptions;

export const DIGEST_PRICE_UNKNOWN_LABEL = 'cena w opisie';

export const DIGEST_ERROR_TITLE = 'Pepper Bot — błąd digestu';

/** `{{date}}` is replaced with a formatted date string. */
export const DIGEST_HEADER_TEMPLATE = '🌶️ <b>Pepper — TOP 5 na {{date}}</b>\n\n';

export function formatDigestHeader(formattedDate: string): string {
  return DIGEST_HEADER_TEMPLATE.replace('{{date}}', formattedDate);
}

export const HUNTER_ALERT_EMOJI = '🚨';

export const HUNTER_ALERT_SUBJECT_TAG = 'OKAZJA';

export const HUNTER_CONFIG_ERROR_TITLE = 'Hunter — błąd konfiguracji';
