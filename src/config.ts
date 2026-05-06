export const INTERESTS = {
  high: [
    'Xbox Series X — szukam okazji przed GTA VI (tylko konsole / zestawy z konsolą / kontrolery Xbox; bez naciągania innej elektroniki do Xbox)',
    'PC: karty graficzne, obudowy, zasilacze, chłodzenie (sprzęt do złożenia / upgrade)',
    'filament PLA/PETG/PETG-CF, części do drukarek (hotendy, dysze, łoża)',
    'Mechaniczne klawiatury',
    'Monitory OLED do gamingu i pracy',
    'Akcesoria do MacBooka (huby USB-C, etui, stacje dokujące)',
    'Książki o programowaniu, frontend, TypeScript, system design',
    'Gry planszowe (strategiczne, eurogry)',
  ],
  medium: [
    'Gadżety FC Barcelona (oryginalne koszulki, akcesoria)',
    'Steam Deck i akcesoria',
    'Narzędzia developerskie, subskrypcje SaaS dla deweloperów',
    'Gry na PC (klasyki, promocje cyfrowe)',
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
  { keywords: ['xbox series x'], maxPrice: 0, label: 'Xbox Series X' },
];

// Deals get auto-flagged "crazy" if discount >= this percent AND not in EXCLUDE_DISCOUNT_CATEGORIES
export const HEAVY_DISCOUNT_THRESHOLD = 70;

// Categories where we ignore "heavy discount" rule (because it's spammy in those categories)
export const EXCLUDE_DISCOUNT_CATEGORIES = [
  'gry-pc', 'gry', 'gaming', 'steam', 'epic', 'gry-konsolowe', 'oprogramowanie',
];

// Hard categories to drop entirely (defensive layer before LLM)
export const HARD_EXCLUDE_CATEGORIES = [
  'dzieci', 'kosmetyki', 'spozywcze', 'alkohol',
  'finanse', 'ubezpieczenia', 'moda',
];
