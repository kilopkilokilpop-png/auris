import type { ErrorCode } from '@auris/shared';

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly statusCode = 400,
    readonly extra: { botLink?: string; retryAfterSec?: number } = {},
  ) {
    super(message);
  }
}
