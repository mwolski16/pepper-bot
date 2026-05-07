/**
 * Discovers `:free` chat models from OpenRouter, ranked by capability (context first).
 */

const MODELS_URL = 'https://openrouter.ai/api/v1/models';

/** Skip meta-router IDs that aggregate providers and tend to 429. */
const ROUTER_PREFIX = 'openrouter/';

/** Official free-models router — allowed as OPENROUTER_MODEL (OpenRouter picks a concrete :free model). */
export const OPENROUTER_FREE_MODELS_ROUTER_ID = 'openrouter/free';

export function isOpenRouterFreeModelsRouter(id: string): boolean {
  return id.trim() === OPENROUTER_FREE_MODELS_ROUTER_ID;
}

const CACHE_MS = 4 * 60 * 60 * 1000;

interface ApiModel {
  id: string;
  context_length?: number | null;
  architecture?: {
    output_modalities?: string[];
  } | null;
  supported_parameters?: string[] | null;
  top_provider?: {
    context_length?: number | null;
    max_completion_tokens?: number | null;
  } | null;
}

let cache: { at: number; ids: string[] } | null = null;

function isDigestCandidate(m: ApiModel): boolean {
  if (!m.id?.endsWith(':free')) return false;
  if (m.id.startsWith(ROUTER_PREFIX)) return false;
  const outs = m.architecture?.output_modalities ?? [];
  if (!outs.includes('text')) return false;
  const params = m.supported_parameters ?? [];
  if (!params.includes('response_format')) return false;
  return true;
}

function contextScore(m: ApiModel): number {
  const ctx = m.context_length ?? m.top_provider?.context_length ?? 0;
  const maxComp = m.top_provider?.max_completion_tokens ?? 0;
  return ctx * 1_000_000 + maxComp;
}

export type ModelsProgress = (message: string) => void | Promise<void>;

/**
 * Returns free model IDs sorted by descending context (then max completion tokens).
 * Results are cached for a few hours to avoid hitting /models on every cron tick.
 */
export async function fetchRankedFreeModelIds(
  apiKey: string,
  onProgress?: ModelsProgress,
): Promise<string[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) {
    await onProgress?.(`OpenRouter: lista :free modeli z cache (${cache.ids.length} id).`);
    return cache.ids;
  }

  await onProgress?.('OpenRouter: GET /api/v1/models (ranking :free)…');

  const res = await fetch(MODELS_URL, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    throw new Error(`OpenRouter models list ${res.status}: ${await res.text()}`);
  }

  const json: unknown = await res.json();
  const data = (json as { data?: ApiModel[] }).data;
  if (!Array.isArray(data)) {
    throw new Error('OpenRouter models list: unexpected response shape');
  }

  const candidates = data.filter(isDigestCandidate);
  candidates.sort((a, b) => contextScore(b) - contextScore(a));
  const ids = candidates.map((m) => m.id);

  if (ids.length === 0) {
    throw new Error(
      'OpenRouter: no :free text models with response_format support — check API or filters.',
    );
  }

  cache = { at: Date.now(), ids };
  await onProgress?.(`OpenRouter: ${ids.length} modeli z response_format do kolejki.`);
  return ids;
}

/** Log the top of the ranked list for debugging. */
export function logRankedFreeModelsSummary(ids: string[], maxShow = 12): void {
  const show = ids.slice(0, maxShow);
  console.log(
    `[openrouter] ranked free models (${ids.length} total), trying by context — top ${show.length}: ${show.join(' → ')}`,
  );
}

export function isOpenRouterRouterModel(id: string): boolean {
  return id.startsWith(ROUTER_PREFIX);
}
