import 'dotenv/config';
import { runDigest } from './digest.js';
import { runHunter } from './hunter.js';
import { runTelegramListener } from './telegram-listen.js';

const mode = process.argv[2];

if (mode === 'digest') {
  await runDigest();
} else if (mode === 'hunter') {
  await runHunter();
} else if (mode === 'telegram') {
  await runTelegramListener();
} else {
  console.error('Usage: tsx src/index.ts [digest|hunter|telegram]');
  process.exit(1);
}
