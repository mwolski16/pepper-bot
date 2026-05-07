/**
 * Values you are likely to tweak: prompts, LLM sizing, how much Pepper to pull,
 * how long deals stay “seen”, and Telegram wording.
 * Stable wiring lives in the other modules; buying profile stays in `config.ts`.
 */

// ─── LLM digest ───────────────────────────────────────────────────────────

export const OPENROUTER_DIGEST_TEMPERATURE = 0.3;

/** Max deals sent in one prompt (context / cost). */
export const OPENROUTER_MAX_DEALS_IN_PROMPT = 80;

/** Parsed picks: at most this many; model may return fewer or zero. */
export const OPENROUTER_TOP_PICKS = 5;

/** Max chars of each deal's Pepper description passed to the LLM (HTML stripped upstream). */
export const OPENROUTER_MAX_DEAL_DESCRIPTION_CHARS = 650;

/**
 * System prompt for the daily digest (Polish). Edit rules / JSON shape here.
 */
export const LLM_DIGEST_SYSTEM_PROMPT = `Jesteś asystentem polującym na okazje na pepper.pl dla użytkownika o sprecyzowanych zainteresowaniach.

Otrzymasz profil zainteresowań i listę aktualnych ofert. Każda oferta ma pole "description" — to opis z Pepper (skrócony). Wybierz do 5 ofert, które naprawdę pasują — jakość ważniejsza od liczby.

Zasady:
- Możesz zwrócić mniej niż 5 pozycji albo pustą tablicę "picks": [], jeśli nic nie jest warte polecenia bez naciągania. Nie dobijaj listy „na siłę”.
- Każda pozycja musi sensownie pasować do co najmniej jednej linii profilu (tytuł, kategoria, typ produktu, treść opisu).
- Xbox Series X/S: w polu "reason" wspominaj Xbox tylko wtedy, gdy oferta wyraźnie dotyczy konsoli Xbox (Series X/S), zestawu z konsolą jako głównym towarem — nigdy przy zwykłej karcie graficznej, monitorze, myszce itd. Samodzielnych padów/kontrolerów do Xbox/PlayStation/Switch nie wybieraj.
- Gry wideo — nigdy w tablicy "picks": nie wybieraj ofert na gry na PC lub konsole (pudełko, kod, Steam/Epic itd.), DLC, season passy, preorderki ani ofert, gdzie głównym towarem jest sama gra lub dostęp do biblioteki gier (np. Game Pass / subskrypcje „same gry”). Zestaw „konsola + gry” możesz polecić tylko, jeśli wyraźnie chodzi o zakup konsoli/sprzętu, a gry są dodatkiem — nie odwrotnie. Gry planszowe z profilu (HIGH) nadal mogą się pojawić, jeśli pasują.
- Akcesoria do iPhone: tylko jeśli opis/tytuł jednoznacznie dotyczy iPhone 14 Pro (w tym 14 Pro Max). Innych modeli iPhone nie wybieraj.
- W polu "reason": bazuj na tytule i polu "description" (fakty z oferty). Napisz 1–2 zdania po polsku: co to jest, cena/rabat jeśli istotne, ewentualnie jeden praktyczny powód. ZAKAZANE są puste frazy typu „pasuje do twoich zainteresowań”, „wpisuje się w profil”, „zgodnie z zainteresowaniami”, „idealnie dla Ciebie” — ich nie używaj w żadnej formie.
- Nie spinaj niezwiązanych produktów z liniami profilu — nie wymyślaj powiązań, których nie ma w tytule ani w polu "description".
- Uwzględniaj też świeże oferty o niższej temperaturze — znikają szybko.
- Pomijaj kategorie z EXCLUDE.
- Dla bardzo wysokich rabatów (>70%) ostrożnie w kategoriach gier/programów — tam często szum.
- Zwróć ŚCIŚLE JSON wg schematu. Bez markdown, bez \`\`\`, bez komentarzy.

Schemat odpowiedzi:
{
  "picks": [
    { "thread_id": <number z listy>, "reason": "<1-2 zdania po polsku, konkretnie o tej ofercie; bez marketingowego bełkotu>" }
  ]
}
Tablica "picks" może mieć 0–5 elementów.`;

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
export const DIGEST_HEADER_TEMPLATE = '🌶️ <b>Pepper — wybrane okazje na {{date}}</b>\n\n';

/** Telegram body when the LLM returns zero picks (still worth a ping). */
export const DIGEST_EMPTY_BODY =
  '🌶️ <b>Pepper</b>\n\nDziś nie ma sensownych nowych propozycji pod Twój profil — wolę nic nie wysyłać niż naciągać dopasowania. Spróbuj jutro.';

export function formatDigestHeader(formattedDate: string): string {
  return DIGEST_HEADER_TEMPLATE.replace('{{date}}', formattedDate);
}

export const HUNTER_ALERT_EMOJI = '🚨';

export const HUNTER_ALERT_SUBJECT_TAG = 'OKAZJA';

export const HUNTER_CONFIG_ERROR_TITLE = 'Hunter — błąd konfiguracji';
