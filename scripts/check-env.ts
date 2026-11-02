/**
 * pnpm check:env — every variable read by the API (EnvSchema) and the bot (BotEnvSchema)
 * must be documented in .env.example and vice versa; .env.example must parse; a local .env (if any) too.
 */
import fs from 'node:fs';
import { parse } from 'dotenv';
import { EnvSchema, parseEnv } from '../apps/api/src/config/env.ts';
import { BotEnvSchema } from '../apps/bot/src/env.ts';

const example = parse(fs.readFileSync('.env.example', 'utf8'));
const exampleKeys = new Set(Object.keys(example).filter((k) => !k.startsWith('VITE_')));
const schemaKeys = new Set([...Object.keys(EnvSchema.shape), ...Object.keys(BotEnvSchema.shape)]);
const missing = [...schemaKeys].filter((k) => !exampleKeys.has(k));
const unknown = [...exampleKeys].filter((k) => !schemaKeys.has(k));
const errors: string[] = [];
if (missing.length) errors.push(`Not documented in .env.example: ${missing.join(', ')}`);
if (unknown.length) errors.push(`In .env.example but unused: ${unknown.join(', ')}`);
try {
  parseEnv(example);
  BotEnvSchema.parse(example);
} catch (e) {
  errors.push(`.env.example does not parse: ${(e as Error).message}`);
}
if (fs.existsSync('.env')) {
  try {
    parseEnv({ ...parse(fs.readFileSync('.env', 'utf8')) });
  } catch (e) {
    errors.push(`.env is invalid: ${(e as Error).message}`);
  }
}
// Secrets must never be exposed to the client bundle (only VITE_* reaches the browser).
const leaked = Object.keys(example).filter((k) => k.startsWith('VITE_') && /TOKEN|SECRET|KEY|CLIENT_ID/.test(k));
if (leaked.length) errors.push(`Secrets must not be VITE_ variables: ${leaked.join(', ')}`);
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`env OK: ${schemaKeys.size} variables documented`);
