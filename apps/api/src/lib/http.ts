export class UpstreamError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export async function fetchJson<T>(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 8000);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal, headers: { accept: 'application/json', ...init.headers } });
    if (!res.ok) throw new UpstreamError(`HTTP ${res.status}`, res.status);
    return (await res.json()) as T;
  } catch (e) {
    if (e instanceof UpstreamError) throw e;
    throw new UpstreamError((e as Error).name === 'AbortError' ? 'timeout' : (e as Error).message);
  } finally {
    clearTimeout(timer);
  }
}

/** Tiny TTL cache to stay well inside upstream quotas. */
export class TtlCache<V> {
  private map = new Map<string, { v: V; exp: number }>();
  constructor(
    private ttlMs: number,
    private max = 2000,
  ) {}
  get(k: string): V | undefined {
    const e = this.map.get(k);
    if (!e) return undefined;
    if (e.exp < Date.now()) {
      this.map.delete(k);
      return undefined;
    }
    return e.v;
  }
  set(k: string, v: V) {
    if (this.map.size >= this.max) this.map.delete(this.map.keys().next().value as string);
    this.map.set(k, { v, exp: Date.now() + this.ttlMs });
  }
  delete(k: string) {
    this.map.delete(k);
  }
  async wrap(k: string, fn: () => Promise<V>): Promise<V> {
    const hit = this.get(k);
    if (hit !== undefined) return hit;
    const v = await fn();
    this.set(k, v);
    return v;
  }
}

/** Sliding window limiter for outbound calls (e.g. Deezer: 50 req / 5 s). */
export class OutboundLimiter {
  private stamps: number[] = [];
  constructor(
    private max: number,
    private windowMs: number,
  ) {}
  async take(): Promise<void> {
    for (;;) {
      const now = Date.now();
      this.stamps = this.stamps.filter((s) => now - s < this.windowMs);
      if (this.stamps.length < this.max) {
        this.stamps.push(now);
        return;
      }
      await new Promise((r) => setTimeout(r, this.windowMs - (now - this.stamps[0]!) + 5));
    }
  }
}
