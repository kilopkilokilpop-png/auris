import { RecognitionUnavailableError, type RecognitionProvider } from './RecognitionProvider.js';

/** RECOGNITION_PROVIDERS=none — honest "not configured" instead of fake results. */
export class DisabledRecognition implements RecognitionProvider {
  readonly name = 'none';
  async recognize(): Promise<never> {
    throw new RecognitionUnavailableError('Распознавание ещё не настроено на сервере');
  }
}
