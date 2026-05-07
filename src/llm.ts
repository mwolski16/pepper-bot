import type { Deal, Pick } from './types.js';
import { INTERESTS } from './config.js';
import {
  LLM_DIGEST_SYSTEM_PROMPT,
  OPENROUTER_DIGEST_TEMPERATURE,
  OPENROUTER_MAX_DEAL_DESCRIPTION_CHARS,
  OPENROUTER_MAX_DEALS_IN_PROMPT,
  OPENROUTER_TOP_PICKS,
} from './settings.js';
import {
  OPENROUTER_FREE_MODELS_ROUTER_ID,
  fetchRankedFreeModelIds,
  isOpenRouterFreeModelsRouter,
  isOpenRouterRouterModel,
  logRankedFreeModelsSummary,
} from './openrouter-free-models.js';

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_REFERER = 'https://github.com/yourname/pepper-bot';
const APP_TITLE = 'Pepper Bot';
const MAX_429_RETRIES = 4;
const RETRY_BASE_MS = 2000;
/** Extra delay spread so concurrent cron jobs don't retry in lockstep. */
const RETRY_JITTER_MS_MAX = 600;
const JSON_FENCE = /^```json\s*|```\s*$/g;

/** Thrown when every candidate in the free-model cascade failed with retryable/unavailable HTTP statuses. */
export class OpenRouterFreeModelsExhaustedError extends Error {
  readonly lastErrorText: string;

  constructor(lastErrorText: string) {
    super(`OpenRouter: all free models failed (last error): ${lastErrorText}`);
    this.name = 'OpenRouterFreeModelsExhaustedError';
    this.lastErrorText = lastErrorText;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function backoffWithJitterMs(attempt: number): number {
  const base = RETRY_BASE_MS * 2 ** attempt;
  const jitter = Math.floor(Math.random() * RETRY_JITTER_MS_MAX);
  return base + jitter;
}

function parsePicksFromJson(json: unknown): Pick[] {
  const choices = (json as { choices?: Array<{ message?: { content?: string } }> }).choices;
  const content = choices?.[0]?.message?.content ?? '';
  const cleaned = content.replace(JSON_FENCE, '').trim();
  const parsed = JSON.parse(cleaned) as { picks?: Pick[] };
  return Array.isArray(parsed.picks) ? parsed.picks.slice(0, OPENROUTER_TOP_PICKS) : [];
}

function clipDealDescription(raw: string | undefined, maxLen: number): string | undefined {
  if (!raw) return undefined;
  const oneLine = raw.replace(/\s+/g, ' ').trim();
  if (!oneLine) return undefined;
  if (oneLine.length <= maxLen) return oneLine;
  return oneLine.slice(0, maxLen) + '…';
}

function dedupeIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

async function buildModelCascade(
  apiKey: string,
  onProgress?: (message: string) => void | Promise<void>,
): Promise<string[]> {
  const ranked = await fetchRankedFreeModelIds(apiKey, onProgress);
  logRankedFreeModelsSummary(ranked);

  const explicit = process.env.OPENROUTER_MODEL?.trim() ?? '';
  const fallbackCsv = process.env.OPENROUTER_MODEL_FALLBACK?.trim();
  const fromEnv = fallbackCsv ? fallbackCsv.split(',').map((s) => s.trim()).filter(Boolean) : [];

  if (explicit && isOpenRouterFreeModelsRouter(explicit)) {
    return dedupeIds([explicit, ...fromEnv, ...ranked]);
  }

  if (explicit && !isOpenRouterRouterModel(explicit)) {
    return dedupeIds([explicit, ...fromEnv, ...ranked]);
  }

  if (explicit && isOpenRouterRouterModel(explicit)) {
    console.warn(
      `[openrouter] OPENROUTER_MODEL=${explicit} is a router; using ranked :free models instead (only ${OPENROUTER_FREE_MODELS_ROUTER_ID} is supported as a router here).`,
    );
  }

  return dedupeIds([...fromEnv, ...ranked]);
}

function shouldRetryThisModel(status: number): boolean {
  return status === 429 || status === 503 || status === 502;
}

function shouldTryNextModel(status: number): boolean {
  return status === 429 || status === 404 || status === 503 || status === 502;
}

export type LlmProgress = (message: string) => void | Promise<void>;

export async function pickTop5(deals: Deal[], options?: { onProgress?: LlmProgress }): Promise<Pick[]> {
  const onProgress = options?.onProgress;
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set');

  await onProgress?.('OpenRouter: budowanie kolejki modeli…');
  const models = await buildModelCascade(apiKey, onProgress);

  const trimmed = deals.slice(0, OPENROUTER_MAX_DEALS_IN_PROMPT).map((d) => ({
    thread_id: d.thread_id,
    title: d.title,
    description: clipDealDescription(d.description, OPENROUTER_MAX_DEAL_DESCRIPTION_CHARS),
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

Wybierz do 5 najlepszych ofert albo zwróć "picks": [], jeśli nic nie jest naprawdę warte — nie dobijaj listy. Nie wybieraj gier wideo (PC/konsole, kody, DLC, preorderki, subskrypcje typu Game Pass jeśli chodzi tylko o gry); gry planszowe z profilu — w porządku. Nie wybieraj samodzielnych padów/kontrolerów pod konsole. W polu "reason" opieraj się na tytule i "description"; bez fraz typu „pasuje do zainteresowań”. Zwróć JSON.`;

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
      await onProgress?.(
        `OpenRouter: POST /chat/completions — model ${model}${attempt > 0 ? ` (próba ${attempt + 1}/${MAX_429_RETRIES})` : ''}…`,
      );
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
        const resolvedModel = (json as { model?: string }).model;
        console.log(
          `[openrouter] digest completed with model: ${resolvedModel ? `${resolvedModel} (requested ${model})` : model}`,
        );
        await onProgress?.(`OpenRouter: OK (${model}), parsowanie JSON…`);
        return parsePicksFromJson(json);
      }

      const errText = await res.text();
      lastErrorText = errText;

      if (shouldRetryThisModel(res.status) && attempt < MAX_429_RETRIES - 1) {
        const waitMs = backoffWithJitterMs(attempt);
        console.warn(
          `[openrouter] ${model}: HTTP ${res.status}. Retry ${attempt + 1}/${MAX_429_RETRIES} in ${waitMs}ms…`,
        );
        await onProgress?.(`OpenRouter: HTTP ${res.status} — czekam ${waitMs} ms i ponawiam…`);
        await sleep(waitMs);
        continue;
      }

      if (shouldTryNextModel(res.status)) {
        console.warn(`[openrouter] ${model}: HTTP ${res.status}, trying next model.`);
        await onProgress?.(`OpenRouter: HTTP ${res.status} dla ${model} — następny model.`);
        break;
      }

      throw new Error(`OpenRouter ${res.status}: ${errText}`);
    }
  }

  throw new OpenRouterFreeModelsExhaustedError(lastErrorText);
}
