// pnpm dev — runs everything locally. Works with no .env at all (MockProvider + mock recognition, bot disabled).
import { execSync } from 'node:child_process';
import concurrently from 'concurrently';

execSync('pnpm --filter @auris/shared build', { stdio: 'inherit' });
const { result } = concurrently(
  [
    { name: 'shared', command: 'pnpm --filter @auris/shared exec tsc -p tsconfig.json --watch --preserveWatchOutput', prefixColor: 'gray' },
    { name: 'api', command: 'pnpm --filter @auris/api dev', prefixColor: 'white' },
    { name: 'bot', command: 'pnpm --filter @auris/bot dev', prefixColor: 'blue' },
    { name: 'app', command: 'pnpm --filter @auris/mini-app dev', prefixColor: 'magenta' },
  ],
  { killOthersOn: ['failure'], restartTries: 0 },
);
result.catch(() => process.exit(1));
