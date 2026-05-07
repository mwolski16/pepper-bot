# Pepper.pl Deal Bot — Setup Guide

Personalized pepper.pl deal recommendations via Telegram, powered by a free OpenRouter LLM, running on GitHub Actions.

---

## Architecture Overview

```
┌────────────────────────────────────────────────────────────┐
│  GitHub Actions (public repo = unlimited free minutes)     │
│                                                            │
│  ┌──────────────────────┐    ┌──────────────────────────┐  │
│  │ Daily Digest         │    │ Real-time Hunter         │  │
│  │ cron: ~18:00 PL      │    │ cron: every 15 min       │  │
│  │ → uses LLM           │    │ → pure rule-based        │  │
│  │ → top 5 personalized │    │ → only fires on "crazy"  │  │
│  └──────────────────────┘    └──────────────────────────┘  │
│            │                            │                  │
│            └────────────┬───────────────┘                  │
│                         ▼                                  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Pipeline                                             │  │
│  │  pepper.pl REST API → filter → dedupe (seen.json)    │  │
│  │  → [LLM if digest] → notifier interface → Telegram   │  │
│  └──────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────┘
```

**Why public repo?** GitHub Actions on public repos = unlimited minutes. Private repos = 2,000 min/month, which a 15-min cron eats fast. Your secrets stay in GitHub Secrets, never in code, so public is safe.

**Modular notifier?** All output goes through a `Notifier` interface. Today: Telegram. Tomorrow: swap in Discord/email/SMS by writing one new file and changing one env var. Zero changes to digest/hunter logic.

---

## Prerequisites

- Node.js 20+ installed locally (for testing before push)
- GitHub account
- Telegram account
- ~15 minutes for setup

---

## Step 1: Create a Telegram Bot

1. Open Telegram, search for **@BotFather**, start a chat.
2. Send `/newbot`. Pick a name (e.g. `Pepper Hunter`) and a username (must end in `bot`, e.g. `pepper_hunter_xyz_bot`).
3. BotFather replies with a **token** like `1234567890:AAH...`. **Save it.** This is `TELEGRAM_BOT_TOKEN`.
4. Now you need your own **chat ID** (where the bot will send messages):
   - Send any message to your new bot first (otherwise it can't message you).
   - Open this URL in a browser, replacing `<TOKEN>`:
     ```
     https://api.telegram.org/bot<TOKEN>/getUpdates
     ```
   - In the JSON response, find `"chat":{"id":123456789,...}`. That number is your `TELEGRAM_CHAT_ID`.

If `getUpdates` is empty, you didn't message the bot first. Do that, then refresh.

---

## Step 2: Get OpenRouter API Key

1. Go to <https://openrouter.ai>, sign up.
2. Settings → Keys → **Create Key**. Save it as `OPENROUTER_API_KEY`.
3. Free tier defaults: 50 requests/day. We need ~1/day for the digest, so this is fine. (If you ever buy $10 of credits, the cap rises to 1000/day, but you don't need that.)

We'll use `openrouter/auto` with a `:free` filter via the model ID `google/gemini-2.5-flash-lite:free` as the default — it handles Polish well. You can swap models in env later.

---

## Step 3: Sanity-check the Pepper.pl API

Before writing code, verify the endpoint works from your terminal:

```bash
curl -s 'https://www.pepper.pl/rest_api/v2/threads?order_by=new&limit=2' \
  -H 'Accept: application/json' | head -200
```

You should see JSON with a `data` array of threads. Note the field names — if anything differs from what we use in `pepper.ts` below, adjust the type. Common fields: `thread_id`, `title`, `temperature`, `is_expired`, `price`, `next_best_price`, `share_link`, `groups`, `merchant`.

If it returns HTML (Cloudflare challenge) instead of JSON, add a real `User-Agent` header (we do this in code).

---

## Step 4: Project Setup

```bash
mkdir pepper-bot && cd pepper-bot
git init
npm init -y
npm i -D typescript tsx @types/node
npx tsc --init --target ES2022 --module nodenext --moduleResolution nodenext \
  --strict --esModuleInterop --skipLibCheck --resolveJsonModule \
  --outDir dist --rootDir src
```

Edit `package.json` and add:

```json
{
  "type": "module",
  "scripts": {
    "digest": "tsx src/index.ts digest",
    "hunter": "tsx src/index.ts hunter",
    "test:dry": "DRY_RUN=1 tsx src/index.ts digest"
  }
}
```

Create the directory structure:

```bash
mkdir -p src data .github/workflows
touch data/seen.json
echo '{"seen":[]}' > data/seen.json
```

Create `.gitignore`:

```
node_modules/
.env
dist/
```

Create `.env.example` (committed) and `.env` (local, gitignored):

```
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
OPENROUTER_API_KEY=
OPENROUTER_MODEL=google/gemini-2.5-flash-lite:free
NOTIFIER=telegram
DRY_RUN=0
```

---

## Step 5: The Code

### `src/types.ts` — shared types

```ts
export interface Deal {
  thread_id: number;
  title: string;
  description?: string;
  price?: number | null;
  next_best_price?: number | null;
  temperature: number;
  vote_count?: number;
  comment_count?: number;
  is_expired: boolean;
  is_new?: boolean;
  share_link: string;
  merchant?: { merchant_name?: string } | null;
  groups?: Array<{ group_name?: string; group_url_name?: string }>;
  thread_type?: { name?: string };
  // Computed fields we add
  discountPct?: number | null;
  categories?: string[];
}

export interface Pick {
  thread_id: number;
  reason: string;
}

export interface Notifier {
  send(text: string): Promise<void>;
  name: string;
}
```

### `src/config.ts` — your interest profile (edit freely)

This is the file you'll iterate on. Categories are matched fuzzily by the LLM — don't worry about exact names.

```ts
export const INTERESTS = {
  high: [
    'Xbox Series X / Series S, kontrolery Xbox, akcesoria Xbox',
    'Drukarki 3D, filament PLA/PETG/PETG-CF, części do drukarek (hotendy, dysze, łoża)',
    'Mechaniczne klawiatury, myszki gamingowe (Logitech, Razer, SteelSeries), słuchawki gamingowe',
    'Monitory ultrawide / 144Hz+ / IPS / OLED do gamingu i pracy',
    'Akcesoria do MacBooka (huby USB-C, etui, stacje dokujące)',
    'Książki o programowaniu, frontend, TypeScript, system design',
    'Gry planszowe (strategiczne, eurogry)',
  ],
  medium: [
    'Gadżety FC Barcelona (oryginalne koszulki, akcesoria)',
    'Steam Deck i akcesoria',
    'Narzędzia developerskie, subskrypcje SaaS dla deweloperów',
    'Konsole i gry retro',
  ],
  exclude: [
    'Produkty dla dzieci, zabawki, pieluchy',
    'Kosmetyki, perfumy, makijaż',
    'Spożywka, alkohol, napoje, słodycze',
    'Banki, ubezpieczenia, kredyty, karty kredytowe',
    'Suplementy diety, leki',
    'Ubrania damskie, bielizna, biżuteria',
    'Wycieczki zorganizowane, all-inclusive',
  ],
};

// Hunter watchlist — keyword triggers for instant Telegram ping (rule-based, no LLM).
// Keywords are matched case-insensitive against title.
// `maxPrice` in PLN; `0` means "any price acceptable, just ping".
export const WATCHLIST: Array<{ keywords: string[]; maxPrice: number; label: string }> = [
  { keywords: ['xbox series x'], maxPrice: 1800, label: 'Xbox Series X' },
  { keywords: ['xbox series s'], maxPrice: 800, label: 'Xbox Series S' },
  { keywords: ['bambu lab', 'bambulab'], maxPrice: 0, label: 'Bambu Lab printer' },
  { keywords: ['prusa', 'mk4', 'mk3s'], maxPrice: 0, label: 'Prusa printer' },
  // Add more as you discover what you want to track
];

// Deals get auto-flagged "crazy" if discount >= this percent AND not in EXCLUDE_DISCOUNT_CATEGORIES
export const HEAVY_DISCOUNT_THRESHOLD = 70;

// Categories where we ignore "heavy discount" rule (because it's spammy in those categories)
export const EXCLUDE_DISCOUNT_CATEGORIES = [
  'gry-pc', 'gry', 'gaming', 'steam', 'epic',
  'elektronika', 'gry-konsolowe', 'oprogramowanie',
];

// Hard categories to drop entirely (defensive layer before LLM)
export const HARD_EXCLUDE_CATEGORIES = [
  'dzieci', 'kosmetyki', 'spozywcze', 'alkohol',
  'finanse', 'ubezpieczenia', 'moda',
];
```

### `src/pepper.ts` — pepper.pl API client

```ts
import type { Deal } from './types.js';

const BASE = 'https://www.pepper.pl/rest_api/v2';
const UA = 'Mozilla/5.0 (compatible; PepperBot/1.0; personal use)';

async function fetchThreads(orderBy: 'new' | 'hot', limit = 50): Promise<Deal[]> {
  const url = `${BASE}/threads?order_by=${orderBy}&limit=${limit}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`Pepper API ${orderBy} failed: ${res.status} ${await res.text()}`);
  }
  const json: any = await res.json();
  // Defensive: API responds either {data:[...]} or directly an array depending on endpoint
  const arr: any[] = Array.isArray(json) ? json : json.data ?? json.items ?? [];
  return arr.map(normalize);
}

function normalize(raw: any): Deal {
  const price = typeof raw.price === 'number' ? raw.price : null;
  const oldPrice = typeof raw.next_best_price === 'number' ? raw.next_best_price : null;
  const discountPct =
    price && oldPrice && oldPrice > price
      ? Math.round(((oldPrice - price) / oldPrice) * 100)
      : null;
  const categories = (raw.groups ?? [])
    .map((g: any) => g.group_url_name || g.group_name)
    .filter(Boolean);
  return {
    thread_id: raw.thread_id,
    title: raw.title ?? '',
    description: raw.description,
    price,
    next_best_price: oldPrice,
    temperature: raw.temperature ?? 0,
    vote_count: raw.vote_count,
    comment_count: raw.comment_count,
    is_expired: !!raw.is_expired,
    is_new: !!raw.is_new,
    share_link: raw.share_link ?? `https://www.pepper.pl/promocje/${raw.thread_id}`,
    merchant: raw.merchant ?? null,
    groups: raw.groups ?? [],
    thread_type: raw.thread_type,
    discountPct,
    categories,
  };
}

/** Fetches both new + hot, deduplicates by thread_id. Maximizes coverage. */
export async function fetchAllRelevant(): Promise<Deal[]> {
  const [newD, hotD] = await Promise.all([
    fetchThreads('new', 80),
    fetchThreads('hot', 50),
  ]);
  const seen = new Set<number>();
  const merged: Deal[] = [];
  for (const d of [...hotD, ...newD]) {
    if (!seen.has(d.thread_id)) {
      seen.add(d.thread_id);
      merged.push(d);
    }
  }
  return merged;
}
```

### `src/filter.ts` — exclude expired, hard-excluded categories, hunter rules

```ts
import type { Deal } from './types.js';
import {
  HARD_EXCLUDE_CATEGORIES,
  EXCLUDE_DISCOUNT_CATEGORIES,
  HEAVY_DISCOUNT_THRESHOLD,
  WATCHLIST,
} from './config.js';

/** Drop expired & deals in hard-excluded categories. Keep low-temperature deals. */
export function baseFilter(deals: Deal[]): Deal[] {
  return deals.filter((d) => {
    if (d.is_expired) return false;
    if (d.thread_type?.name && d.thread_type.name !== 'deal' && d.thread_type.name !== 'voucher') {
      // skip discussions, polls, etc.
      return false;
    }
    const cats = d.categories ?? [];
    if (cats.some((c) => HARD_EXCLUDE_CATEGORIES.includes(c))) return false;
    return true;
  });
}

/** Hunter logic — finds "screaming deals" worth instant Telegram ping. Pure rules, no LLM. */
export function hunterMatch(deal: Deal): { match: boolean; reason: string } {
  const titleLower = deal.title.toLowerCase();
  const cats = deal.categories ?? [];

  // 1. Watchlist keyword hit
  for (const w of WATCHLIST) {
    const kwHit = w.keywords.some((kw) => titleLower.includes(kw.toLowerCase()));
    if (kwHit) {
      if (w.maxPrice === 0) {
        return { match: true, reason: `Watchlist: ${w.label}` };
      }
      if (deal.price !== null && deal.price !== undefined && deal.price <= w.maxPrice) {
        return { match: true, reason: `Watchlist: ${w.label} ≤ ${w.maxPrice} zł` };
      }
    }
  }

  // 2. Heavy discount, but not in spammy discount categories
  if (deal.discountPct && deal.discountPct >= HEAVY_DISCOUNT_THRESHOLD) {
    const inSpammyCat = cats.some((c) => EXCLUDE_DISCOUNT_CATEGORIES.includes(c));
    if (!inSpammyCat) {
      return { match: true, reason: `Heavy discount: -${deal.discountPct}%` };
    }
  }

  return { match: false, reason: '' };
}
```

### `src/dedupe.ts` — JSON-file persistence (committed back by Action)

```ts
import { readFile, writeFile } from 'node:fs/promises';

const PATH = 'data/seen.json';
const TTL_DAYS = 30;

interface SeenStore {
  seen: Array<{ id: number; ts: number }>;
}

async function load(): Promise<SeenStore> {
  try {
    const raw = await readFile(PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { seen: [] };
  }
}

async function save(store: SeenStore): Promise<void> {
  await writeFile(PATH, JSON.stringify(store, null, 2));
}

function prune(store: SeenStore): SeenStore {
  const cutoff = Date.now() - TTL_DAYS * 24 * 60 * 60 * 1000;
  return { seen: store.seen.filter((e) => e.ts > cutoff) };
}

export async function filterUnseen<T extends { thread_id: number }>(
  deals: T[],
): Promise<{ unseen: T[]; markSeen: () => Promise<void> }> {
  const store = prune(await load());
  const seenIds = new Set(store.seen.map((e) => e.id));
  const unseen = deals.filter((d) => !seenIds.has(d.thread_id));

  return {
    unseen,
    markSeen: async () => {
      const now = Date.now();
      for (const d of unseen) store.seen.push({ id: d.thread_id, ts: now });
      await save(store);
    },
  };
}
```

### `src/llm.ts` — OpenRouter client + prompt

```ts
import type { Deal, Pick } from './types.js';
import { INTERESTS } from './config.js';

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

export async function pickTop5(deals: Deal[]): Promise<Pick[]> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL ?? 'google/gemini-2.5-flash-lite:free';
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set');

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

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/yourname/pepper-bot',
      'X-Title': 'Pepper Bot',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3,
    }),
  });

  if (!res.ok) {
    throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
  }

  const json: any = await res.json();
  const content = json.choices?.[0]?.message?.content ?? '';
  const cleaned = content.replace(/^```json\s*|```\s*$/g, '').trim();
  const parsed = JSON.parse(cleaned);
  return Array.isArray(parsed.picks) ? parsed.picks.slice(0, 5) : [];
}
```

### `src/notifier.ts` — Notifier interface + Telegram impl + factory

```ts
import type { Notifier } from './types.js';

class TelegramNotifier implements Notifier {
  name = 'telegram';
  constructor(
    private token: string,
    private chatId: string,
  ) {}

  async send(text: string): Promise<void> {
    const url = `https://api.telegram.org/bot${this.token}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: this.chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: false,
      }),
    });
    if (!res.ok) {
      throw new Error(`Telegram ${res.status}: ${await res.text()}`);
    }
  }
}

class ConsoleNotifier implements Notifier {
  name = 'console';
  async send(text: string): Promise<void> {
    console.log('--- NOTIFICATION ---\n' + text + '\n--- END ---');
  }
}

export function makeNotifier(): Notifier {
  if (process.env.DRY_RUN === '1') return new ConsoleNotifier();
  const kind = process.env.NOTIFIER ?? 'telegram';
  switch (kind) {
    case 'telegram': {
      const token = process.env.TELEGRAM_BOT_TOKEN;
      const chatId = process.env.TELEGRAM_CHAT_ID;
      if (!token || !chatId) throw new Error('Telegram env vars missing');
      return new TelegramNotifier(token, chatId);
    }
    case 'console':
      return new ConsoleNotifier();
    default:
      throw new Error(`Unknown notifier: ${kind}`);
  }
}

/** HTML-escape for Telegram. */
export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
```

### `src/digest.ts` — daily mode

```ts
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
  } catch (err: any) {
    const msg = `❌ <b>Pepper Bot — błąd digestu</b>\n<code>${esc(err.message ?? String(err))}</code>`;
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
```

### `src/hunter.ts` — real-time hunter mode

```ts
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
  } catch (err: any) {
    // Hunters fail silently EXCEPT on auth/config errors — we don't want spam from transient API issues
    console.error('Hunter error:', err);
    if (/401|403|TELEGRAM/i.test(err.message ?? '')) {
      try {
        await notifier.send(`❌ <b>Hunter — błąd konfiguracji</b>\n<code>${esc(err.message)}</code>`);
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
```

### `src/index.ts` — entrypoint

```ts
import { runDigest } from './digest.js';
import { runHunter } from './hunter.js';

const mode = process.argv[2];

if (mode === 'digest') {
  await runDigest();
} else if (mode === 'hunter') {
  await runHunter();
} else {
  console.error('Usage: tsx src/index.ts [digest|hunter]');
  process.exit(1);
}
```

---

## Step 6: GitHub Workflows

### `.github/workflows/digest.yml`

```yaml
name: Daily Digest

on:
  schedule:
    - cron: '0 18 * * *' # ~18:00 Europe/Warsaw (GitHub may delay a few minutes)
      timezone: Europe/Warsaw
  workflow_dispatch: # lets you trigger manually from Actions tab

jobs:
  digest:
    runs-on: ubuntu-latest
    permissions:
      contents: write       # needed to commit seen.json back
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci || npm i
      - run: npm run digest
        env:
          TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
          TELEGRAM_CHAT_ID:   ${{ secrets.TELEGRAM_CHAT_ID }}
          OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
          OPENROUTER_MODEL:   ${{ vars.OPENROUTER_MODEL || 'google/gemini-2.5-flash-lite:free' }}
          NOTIFIER:           telegram
      - uses: stefanzweifel/git-auto-commit-action@v5
        with:
          commit_message: 'chore: update seen.json (digest)'
          file_pattern: data/seen.json
```

### `.github/workflows/hunter.yml`

```yaml
name: Real-time Hunter

on:
  schedule:
    - cron: '*/15 * * * *'   # every 15 min — GitHub may delay 5-15 min under load
  workflow_dispatch:

# Prevent overlap if a run takes long
concurrency:
  group: hunter
  cancel-in-progress: false

jobs:
  hunt:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci || npm i
      - run: npm run hunter
        env:
          TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
          TELEGRAM_CHAT_ID:   ${{ secrets.TELEGRAM_CHAT_ID }}
          NOTIFIER:           telegram
      - uses: stefanzweifel/git-auto-commit-action@v5
        with:
          commit_message: 'chore: update seen.json (hunter)'
          file_pattern: data/seen.json
```

> **Note on cron timing:** GitHub schedules are best-effort. A `*/15` cron may run every 15-25 min in practice. If you need true real-time alerts, run on a tiny VPS or Cloudflare Workers later — the code stays the same, only the trigger changes.

---

## Step 7: Push to GitHub & Add Secrets

```bash
git add .
git commit -m "feat: initial pepper bot"
gh repo create pepper-bot --public --source=. --push
# OR manually: create public repo on github.com, add remote, push
```

Then in the GitHub repo:

1. **Settings → Secrets and variables → Actions → Secrets** → New repository secret. Add three:
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_CHAT_ID`
   - `OPENROUTER_API_KEY`
2. (Optional) **Variables** tab → add `OPENROUTER_MODEL` if you want to override the default without editing code.

---

## Step 8: First Run

### 8a. Local dry run (recommended first)

Create local `.env` with your real values, then:

```bash
DRY_RUN=1 npx tsx src/index.ts digest
```

You'll see deals fetched, filtered, and the formatted message printed to console (no Telegram message sent). This is your sanity check.

Then real local run:

```bash
npx tsx src/index.ts digest
```

You should get a Telegram message. If yes → push works the same way.

### 8b. Trigger workflows manually

GitHub → **Actions** tab → pick `Daily Digest` → **Run workflow**. Watch logs, confirm Telegram delivers. Repeat for `Real-time Hunter`.

---

## Step 9: Iterating

### Tuning interests

Edit `src/config.ts`. The LLM handles fuzzy matching — say "drukarki 3D" not "Bambu Lab P1S Combo specifically". Push, next digest reflects the change.

### Adding watchlist items

```ts
WATCHLIST.push({ keywords: ['ps5 pro'], maxPrice: 2500, label: 'PS5 Pro' });
```

`maxPrice: 0` = ping me regardless of price (just want to know it exists).

### Swapping notifiers later

Add `src/notifiers/discord.ts` implementing the `Notifier` interface, register it in `makeNotifier()`'s switch, set `NOTIFIER=discord` in workflow env. Done. Digest/hunter code untouched.

### Trying different free models

In OpenRouter dashboard, browse models tagged `:free`. Use free router.

Set via `OPENROUTER_MODEL` env / GitHub variable.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `Pepper API 403` | Cloudflare bot block | Already mitigated with UA header. If persists, add a 1-2s sleep before fetch, or rotate UA. |
| `OpenRouter 429` | Free tier rate limit hit | You're well under 50/day in normal use; check OpenRouter dashboard for negative balance. |
| LLM returns invalid JSON | Some free models ignore `response_format` | Lower temperature to 0.1, or switch model. |
| Telegram `400 chat not found` | Wrong `TELEGRAM_CHAT_ID` or you never messaged the bot first | Re-do Step 1.4. |
| `seen.json` keeps growing | Working as intended (TTL 30 days) | Lower `TTL_DAYS` in `dedupe.ts` if it bothers you. |
| Hunter never fires | Watchlist keywords too narrow, or threshold too aggressive | Add broader keywords; lower `HEAVY_DISCOUNT_THRESHOLD` to 60. |
| GitHub Actions skipping crons | GitHub deprioritizes inactive repos | Push a commit weekly, or run `workflow_dispatch` to keep alive. |

---

## Edge cases handled

- **Pepper.pl down** → digest workflow fails, sends Telegram error, exits non-zero. Hunter fails silently except auth errors.
- **Same deal stays hot 5 days** → `seen.json` remembers it for 30 days, won't re-recommend.
- **LLM picks an ID not in the pool** → `byId.get()` returns undefined, that pick is silently skipped.
- **Empty pool day** → digest exits cleanly without sending anything (no spam "nothing today" message). If you want a daily heartbeat, add an `else` branch.
- **Concurrent hunter runs** → `concurrency.group` prevents overlap.
- **seen.json merge conflict** between digest and hunter pushing simultaneously → `git-auto-commit-action` retries with rebase. Worst case: one run's seen entries are lost, deals get re-evaluated next run (harmless).

---

## Future extensions (not built, but architecture-ready)

- **Email notifier** — `src/notifiers/email.ts` using Resend free tier (100 emails/day).
- **Multi-user** — `INTERESTS` becomes a JSON file per user, loop in digest.
- **Smarter hunter** — pass borderline matches to a tiny LLM call (one per deal, still well under quota).
- **Web UI for interests** — host `config.ts` editor on GitHub Pages, commit on save via Octokit.
- **Migrate to VPS / Cloudflare Workers** — for sub-15-min cadence, swap GH Actions trigger only. Code is portable.

---

That's the complete system. Total runtime per digest: ~3-5 seconds. Per hunter run: ~1-2 seconds when no hits. Free tier covers it indefinitely.
