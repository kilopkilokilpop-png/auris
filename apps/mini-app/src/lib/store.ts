import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

/** Minimal observable store for global state (player, likes, profile, toasts). */
export class Store<T> {
  private listeners = new Set<() => void>();
  constructor(private state: T) {}
  get = () => this.state;
  set = (patch: Partial<T> | ((s: T) => Partial<T>)) => {
    const p = typeof patch === 'function' ? patch(this.state) : patch;
    this.state = { ...this.state, ...p };
    this.listeners.forEach((l) => l());
  };
  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
}

export function useStore<T, S>(store: Store<T>, select: (s: T) => S): S {
  return useSyncExternalStore(store.subscribe, () => select(store.get()));
}

export interface QueryState<T> {
  data?: T;
  error?: Error;
  loading: boolean;
  reload: () => void;
}

/** Fetch-on-mount with loading / error / reload. `key` change refetches. */
export function useQuery<T>(key: string | null, fn: () => Promise<T>): QueryState<T> {
  const [state, setState] = useState<{ data?: T; error?: Error; loading: boolean }>({ loading: key !== null });
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (key === null) {
      setState({ loading: false });
      return;
    }
    let alive = true;
    setState((s) => ({ data: s.data, loading: true }));
    fnRef.current().then(
      (data) => alive && setState({ data, loading: false }),
      (error: Error) => alive && setState({ error, loading: false }),
    );
    return () => {
      alive = false;
    };
  }, [key, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}
