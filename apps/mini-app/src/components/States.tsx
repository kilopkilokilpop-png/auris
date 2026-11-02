import type { ReactNode } from 'react';

export function SkeletonRows({ n = 4 }: { n?: number }) {
  return (
    <div aria-busy="true" aria-label="Загрузка">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="row" style={{ pointerEvents: 'none' }}>
          <span className="skeleton" style={{ width: 46, height: 46 }} />
          <span style={{ flex: 1 }}>
            <span className="skeleton" style={{ display: 'block', height: 14, width: `${60 - i * 6}%` }} />
            <span className="skeleton" style={{ display: 'block', height: 12, width: '34%', marginTop: 8 }} />
          </span>
        </div>
      ))}
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="state" role="status">
      <strong>{title}</strong>
      {children ? <p>{children}</p> : null}
      {action ? <div className="btn-row">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error?: Error; onRetry?: () => void }) {
  return (
    <div className="state" role="alert">
      <strong>Не удалось загрузить</strong>
      <p>{error?.message ?? 'Попробуйте ещё раз.'}</p>
      {onRetry ? (
        <div className="btn-row">
          <button className="btn ghost" type="button" onClick={onRetry}>
            Повторить
          </button>
        </div>
      ) : null}
    </div>
  );
}
