import type { ApiError, Recognition, Track } from '@auris/shared';

export class ApiCallError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly botLink?: string,
  ) {
    super(message);
  }
}

/** The bot never touches the DB or providers directly — it calls the API's internal routes. */
export interface AurisApi {
  touchUser(user: { id: number; first_name?: string; last_name?: string; username?: string }, botStarted: boolean): Promise<void>;
  search(userId: number, q: string): Promise<Track[]>;
  liked(userId: number): Promise<Track[]>;
  like(userId: number, trackId: string): Promise<void>;
  download(userId: number, trackId: string): Promise<{ status: 'sent' }>;
  recognize(userId: number, audio: Buffer, mime: string, filename: string): Promise<Recognition>;
  resetRecommendations(userId: number): Promise<void>;
  deleteUser(userId: number): Promise<void>;
}

export class HttpAurisApi implements AurisApi {
  constructor(
    private readonly base: string,
    private readonly secret: string,
  ) {}

  private async call<T>(method: string, path: string, body?: unknown | FormData): Promise<T> {
    const isForm = body instanceof FormData;
    const res = await fetch(this.base + path, {
      method,
      headers: { 'x-internal-secret': this.secret, ...(body && !isForm ? { 'content-type': 'application/json' } : {}) },
      body: isForm ? body : body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(90_000),
    });
    const data = (await res.json().catch(() => ({}))) as T & Partial<ApiError>;
    if (!res.ok) throw new ApiCallError(data.error?.code ?? 'INTERNAL', data.error?.message ?? `HTTP ${res.status}`, data.error?.botLink);
    return data;
  }
  async touchUser(user: { id: number; first_name?: string; last_name?: string; username?: string }, botStarted: boolean) {
    await this.call('POST', '/internal/users/touch', { user, botStarted });
  }
  async search(userId: number, q: string) {
    return (await this.call<{ tracks: Track[] }>('GET', `/internal/search?userId=${userId}&q=${encodeURIComponent(q)}`)).tracks;
  }
  async liked(userId: number) {
    return (await this.call<{ tracks: Track[] }>('GET', `/internal/likes?userId=${userId}`)).tracks;
  }
  async like(userId: number, trackId: string) {
    await this.call('POST', '/internal/likes', { userId, trackId });
  }
  async download(userId: number, trackId: string) {
    return this.call<{ status: 'sent' }>('POST', '/internal/download', { userId, trackId });
  }
  async recognize(userId: number, audio: Buffer, mime: string, filename: string) {
    const form = new FormData();
    form.set('userId', String(userId));
    form.set('audio', new Blob([new Uint8Array(audio)], { type: mime }), filename);
    return this.call<Recognition>('POST', '/internal/recognize', form);
  }
  async resetRecommendations(userId: number) {
    await this.call('POST', '/internal/reset', { userId });
  }
  async deleteUser(userId: number) {
    await this.call('POST', '/internal/delete', { userId });
  }
}
