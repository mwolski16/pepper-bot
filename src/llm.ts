import type { Deal, Pick } from './types.js';
import { INTERESTS } from './config.js';
import {
  LLM_DIGEST_SYSTEM_PROMPT,
  OPENROUTER_DIGEST_TEMPERATURE,
  OPENROUTER_MAX_DEALS_IN_PROMPT,
  OPENROUTER_TOP_PICKS,
} from './settings.js';

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_FREE_MODEL = 'google/gemini-2.5-flash-lite:free';
const DEFAULT_REFERER = 'https://github.com/yourname/pepper-bot';
const APP_TITLE = 'Pepper Bot';
const MAX_429_RETRIES = 3;
const RETRY_BASE_MS = 2000;
const JSON_FENCE = /^```json\s*|```\s*$/g;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function parsePicksFromJson(json: unknown): Pick[] {
  const choices = (json as { choices?: Array<{ message?: { content?: string } }> }).choices;
  const content = choices?.[0]?.message?.content ?? '';
  const cleaned = content.replace(JSON_FENCE, '').trim();
  const parsed = JSON.parse(cleaned) as { picks?: Pick[] };
  return Array.isArray(parsed.picks) ? parsed.picks.slice(0, OPENROUTER_TOP_PICKS) : [];
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
  const cascade = [
    primary,
    ...fromEnv.filter((m) => m !== primary),
    ...autoGemini.filter((m) => m !== primary),
  ];
  const models = [...new Set(cascade)];

  const trimmed = deals.slice(0, OPENROUTER_MAX_DEALS_IN_PROMPT).map((d) => ({
    thread_id: d.thread_id,
    title: d.title,
    price: d.price,
    discountPct: d.discountPct,
    temperature: d.temperature,
    categories: d.categories,
    merchant: d.merchant?.merchant_name,
  }));

  const user = `PROFIL ZAINTERESOWAŃ:
HIGH: ${INTERESTS.high.join(' | ')}
MEDIUM: ${INTERESTS.medium.join(' | ')}
EXCLUDE: ${INTERESTS.exclude.join(' | ')}

OFERTY (${trimmed.length} szt.):
${JSON.stringify(trimmed, null, 1)}

Wybierz TOP 5 i zwróć JSON.`;

  const referer = process.env.OPENROUTER_HTTP_REFERER ?? DEFAULT_REFERER;

  const body = {
    messages: [
      { role: 'system', content: LLM_DIGEST_SYSTEM_PROMPT },
      { role: 'user', content: user },
    ],
    response_format: { type: 'json_object' } as const,
    temperature: OPENROUTER_DIGEST_TEMPERATURE,
  };

  let lastErrorText = '';

  for (const model of models) {
    for (let attempt = 0; attempt < MAX_429_RETRIES; attempt++) {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': referer,
          'X-Title': APP_TITLE,
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
        const waitMs = RETRY_BASE_MS * 2 ** attempt;
        console.warn(
          `[openrouter] ${model}: HTTP 429 (rate limit). Retry ${attempt + 1}/${MAX_429_RETRIES} in ${waitMs}ms…`,
        );
        if (attempt < MAX_429_RETRIES - 1) {
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
