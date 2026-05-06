import type { Deal, Pick } from './types.js';
import { INTERESTS } from './config.js';

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

/** Stable default from the setup guide — often less congested than `openrouter/auto` free routing. */
const DEFAULT_FREE_MODEL = 'google/gemini-2.5-flash-lite:free';

const MAX_429_RETRIES_PER_MODEL = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function parsePicksFromJson(json: unknown): Pick[] {
  const choices = (json as { choices?: Array<{ message?: { content?: string } }> }).choices;
  const content = choices?.[0]?.message?.content ?? '';
  const cleaned = content.replace(/^```json\s*|```\s*$/g, '').trim();
  const parsed = JSON.parse(cleaned) as { picks?: Pick[] };
  return Array.isArray(parsed.picks) ? parsed.picks.slice(0, 5) : [];
}

export async function pickTop5(deals: Deal[]): Promise<Pick[]> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set');

  const primary = (process.env.OPENROUTER_MODEL || DEFAULT_FREE_MODEL).trim();
  const fallbackCsv = process.env.OPENROUTER_MODEL_FALLBACK?.trim();
  const fromEnv = fallbackCsv
    ? fallbackCsv.split(',').map((s) => s.trim()).filter(Boolean)
    : [];
  const autoGemini = primary !== DEFAULT_FREE_MODEL ? [DEFAULT_FREE_MODEL] : [];
  const cascade = [primary, ...fromEnv.filter((m) => m !== primary), ...autoGemini.filter((m) => m !== primary)];
  const models = [...new Set(cascade)];

  // Trim deals to essentials so prompt stays small (free models often have 8-32k context)
  const trimmed = deals.slice(0, 80).map((d) => ({
    thread_id: d.thread_id,
    title: d.title,
    price: d.price,
    discountPct: d.discountPct,
    temperature: d.temperature,
    categories: d.categories,
    merchant: d.merchant?.merchant_name,
  }));

  const system = `Jesteś asystentem polującym na okazje na pepper.pl dla użytkownika o sprecyzowanych zainteresowaniach.

Otrzymasz profil zainteresowań i listę aktualnych ofert. Wybierz TOP 5 ofert najlepiej dopasowanych do profilu.

Zasady:
- Uwzględniaj również oferty o niskiej temperaturze - świeże okazje znikają szybko, nim społeczność zdąży zagłosować.
- Pomijaj kategorie wymienione w EXCLUDE.
- Dla heavy discounts (>70%) ignoruj jeśli to gry/elektronika - tam takie obniżki są codziennością.
- Zwróć ŚCIŚLE JSON wg schematu. Bez markdown, bez \`\`\`, bez komentarzy.

Schemat odpowiedzi:
{
  "picks": [
    { "thread_id": <number z listy>, "reason": "<1-2 zdania po polsku, dlaczego ta oferta pasuje do profilu>" }
  ]
}`;

  const user = `PROFIL ZAINTERESOWAŃ:
HIGH: ${INTERESTS.high.join(' | ')}
MEDIUM: ${INTERESTS.medium.join(' | ')}
EXCLUDE: ${INTERESTS.exclude.join(' | ')}

OFERTY (${trimmed.length} szt.):
${JSON.stringify(trimmed, null, 1)}

Wybierz TOP 5 i zwróć JSON.`;

  const referer = process.env.OPENROUTER_HTTP_REFERER ?? 'https://github.com/yourname/pepper-bot';

  const body = {
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.3,
  };

  let lastErrorText = '';

  for (const model of models) {
    for (let attempt = 0; attempt < MAX_429_RETRIES_PER_MODEL; attempt++) {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': referer,
          'X-Title': 'Pepper Bot',
        },
        body: JSON.stringify({ ...body, model }),
      });

      if (res.ok) {
        const json: unknown = await res.json();
        if (model !== primary) {
          console.warn(`[openrouter] success with fallback model: ${model}`);
        }
        return parsePicksFromJson(json);
      }

      const errText = await res.text();
      lastErrorText = errText;

      if (res.status === 429) {
        const waitMs = 2000 * 2 ** attempt;
        console.warn(
          `[openrouter] ${model}: HTTP 429 (rate limit). Retry ${attempt + 1}/${MAX_429_RETRIES_PER_MODEL} in ${waitMs}ms…`,
        );
        if (attempt < MAX_429_RETRIES_PER_MODEL - 1) {
          await sleep(waitMs);
          continue;
        }
        console.warn(`[openrouter] ${model}: giving up after 429; trying next model if any.`);
        break;
      }

      throw new Error(`OpenRouter ${res.status}: ${errText}`);
    }
  }

  throw new Error(`OpenRouter 429 (all models exhausted): ${lastErrorText}`);
}
