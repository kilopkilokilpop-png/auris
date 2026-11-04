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
  liked(userId: number): Promise<Track[]>;
  like(userId: number, trackId: string): Promise<void>;
  termsAccepted(userId: number): Promise<boolean>;
  acceptTerms(userId: number): Promise<void>;
  recognize(userId: number, audio: Buffer, mime: string, filename: string): Promise<Recognition>;
  resetRecommendations(userId: number): Promise<void>;
  deleteUser(userId: number): Promise<void>;
  playlistInvite(token: string): Promise<{ title: string; owner: string; trackCount: number } | null>;
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
  async liked(userId: number) {
    return (await this.call<{ tracks: Track[] }>('GET', `/internal/likes?userId=${userId}`)).tracks;
  }
  async like(userId: number, trackId: string) {
    await this.call('POST', '/internal/likes', { userId, trackId });
  }
  async termsAccepted(userId: number) {
    return (await this.call<{ accepted: boolean }>('GET', `/internal/terms?userId=${userId}`)).accepted;
  }
  async acceptTerms(userId: number) {
    await this.call('POST', '/internal/terms/accept', { userId });
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
  async playlistInvite(token: string) {
    try {
      return await this.call<{ title: string; owner: string; trackCount: number }>('GET', `/internal/playlist-invite?token=${encodeURIComponent(token)}`);
    } catch (e) {
      if (e instanceof ApiCallError && e.code === 'NOT_FOUND') return null;
      throw e;
    }
  }
}
