import { IconLock } from './Icons';

export interface SegOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
  disabledReason?: string;
}

/** Radio group with a sliding white thumb. Disabled options stay visible with a lock + reason. */
export function Segmented<T extends string>({ options, value, onChange, label, compact, onDisabled }: { options: SegOption<T>[]; value: T; onChange: (v: T) => void; label: string; compact?: boolean; onDisabled?: (o: SegOption<T>) => void }) {
  const idx = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div className={`segmented glass ${compact ? 'compact' : ''}`} role="radiogroup" aria-label={label}>
      <span className="seg-thumb" aria-hidden="true" style={{ width: `calc((100% - 8px) / ${options.length})`, transform: `translateX(${idx * 100}%)` }} />
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          className="seg-btn"
          aria-checked={o.value === value}
          aria-disabled={o.disabled || undefined}
          title={o.disabled ? o.disabledReason : undefined}
          onClick={() => (o.disabled ? onDisabled?.(o) : onChange(o.value))}
        >
          {o.disabled ? <IconLock className="icon lock" /> : null}
          {o.label}
        </button>
      ))}
    </div>
  );
}
