import { useState } from 'react';

/** Image fades in once decoded; a soft gradient placeholder stays if it fails. */
export function Cover({ src, alt = '', className = '' }: { src?: string; alt?: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  return (
    <span className={`cover ${className}`}>
      {src && !failed ? (
        <img src={src} alt={alt} loading="lazy" decoding="async" className={loaded ? 'loaded' : ''} onLoad={() => setLoaded(true)} onError={() => setFailed(true)} />
      ) : null}
    </span>
  );
}
