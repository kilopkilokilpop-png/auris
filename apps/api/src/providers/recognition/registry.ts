import type { Env } from '../../config/env.js';
import { AcrCloudProvider } from './AcrCloudProvider.js';
import { AuddProvider } from './AuddProvider.js';
import { MockRecognition } from './MockRecognition.js';
import { FallbackRecognition, type RecognitionProvider } from './RecognitionProvider.js';

export function createRecognition(env: Env): RecognitionProvider {
  const list: RecognitionProvider[] = [];
  for (const id of env.RECOGNITION_PROVIDERS.split(',').map((s) => s.trim()).filter(Boolean)) {
    if (id === 'mock') list.push(new MockRecognition());
    else if (id === 'audd') {
      if (!env.AUDD_API_TOKEN) throw new Error('AUDD_API_TOKEN is required for audd');
      list.push(new AuddProvider(env.AUDD_API_TOKEN));
    } else if (id === 'acrcloud') {
      if (!env.ACRCLOUD_HOST || !env.ACRCLOUD_ACCESS_KEY || !env.ACRCLOUD_ACCESS_SECRET) throw new Error('ACRCLOUD_HOST/ACCESS_KEY/ACCESS_SECRET are required for acrcloud');
      list.push(new AcrCloudProvider({ host: env.ACRCLOUD_HOST, key: env.ACRCLOUD_ACCESS_KEY, secret: env.ACRCLOUD_ACCESS_SECRET }));
    } else throw new Error(`Unknown recognition provider "${id}"`);
  }
  if (!list.length) throw new Error('RECOGNITION_PROVIDERS is empty');
  return list.length === 1 ? list[0]! : new FallbackRecognition(list);
}
