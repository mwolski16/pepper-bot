import 'dotenv/config';
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
