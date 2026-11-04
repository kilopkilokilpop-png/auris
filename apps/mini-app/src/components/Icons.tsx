import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { title?: string };

function Svg({ title, children, ...rest }: P) {
  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden={title ? undefined : true} role={title ? 'img' : undefined} {...rest}>
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

/** The AURIS mark: a dot and three sound waves fading towards the edge. */
export function LogoMark({ size = 20, fade = true }: { size?: number; fade?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" style={{ flex: 'none' }}>
      <circle cx="7.5" cy="16" r="3" fill="#F5F5F7" />
      <path d="M13 10.5a7.6 7.6 0 0 1 0 11" fill="none" stroke="#F5F5F7" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M17.6 6.6a13 13 0 0 1 0 18.8" fill="none" stroke={fade ? '#C2C2C7' : '#F5F5F7'} strokeWidth="2.6" strokeLinecap="round" />
      <path d="M22.2 2.8a18.4 18.4 0 0 1 0 26.4" fill="none" stroke={fade ? '#88888E' : '#F5F5F7'} strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}

export const IconHome = (p: P) => (
  <Svg {...p}>
    <path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" />
  </Svg>
);
export const IconWave = (p: P) => (
  <Svg {...p}>
    <path d="M3 13.5c1.8-4.5 3.6-4.5 5.4 0s3.6 4.5 5.4 0 3.6-4.5 5.4 0 1.5 2 1.8 1.6" />
  </Svg>
);
export const IconHear = (p: P) => (
  <Svg {...p}>
    <circle cx="6" cy="12" r="1.8" fill="currentColor" stroke="none" />
    <path d="M10 8.5a5 5 0 0 1 0 7" />
    <path d="M13.5 5.5a9.2 9.2 0 0 1 0 13" />
    <path d="M17 2.8a13 13 0 0 1 0 18.4" opacity="0.75" />
  </Svg>
);
export const IconUser = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4.5 20c1.3-3.6 4-5.2 7.5-5.2s6.2 1.6 7.5 5.2" />
  </Svg>
);
export const IconGear = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6" strokeDasharray="0" />
  </Svg>
);
export const IconSearch = (p: P) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.2-4.2" />
  </Svg>
);
export const IconPlay = (p: P) => (
  <Svg {...p} stroke="none">
    <path d="M7 4.8v14.4a.8.8 0 0 0 1.2.7l11.4-7.2a.8.8 0 0 0 0-1.4L8.2 4.1A.8.8 0 0 0 7 4.8z" fill="currentColor" />
  </Svg>
);
export const IconPause = (p: P) => (
  <Svg {...p} stroke="none">
    <rect x="6.5" y="4.5" width="3.6" height="15" rx="1" fill="currentColor" />
    <rect x="13.9" y="4.5" width="3.6" height="15" rx="1" fill="currentColor" />
  </Svg>
);
export const IconPrev = (p: P) => (
  <Svg {...p} stroke="none">
    <rect x="4.5" y="5" width="2.4" height="14" rx="1" fill="currentColor" />
    <path d="M19 5.9v12.2a.8.8 0 0 1-1.2.7L8.6 12.7a.8.8 0 0 1 0-1.4l9.2-6.1a.8.8 0 0 1 1.2.7z" fill="currentColor" />
  </Svg>
);
export const IconNext = (p: P) => (
  <Svg {...p} stroke="none">
    <rect x="17.1" y="5" width="2.4" height="14" rx="1" fill="currentColor" />
    <path d="M5 5.9v12.2a.8.8 0 0 0 1.2.7l9.2-6.1a.8.8 0 0 0 0-1.4L6.2 5.2A.8.8 0 0 0 5 5.9z" fill="currentColor" />
  </Svg>
);
export const IconShuffle = (p: P) => (
  <Svg {...p}>
    <path d="M3 7h3.5c4.5 0 6.5 10 11 10H21M3 17h3.5c1.6 0 2.8-1.2 3.8-2.8M13.7 9.8C14.7 8.2 15.9 7 17.5 7H21M18.5 4.5 21 7l-2.5 2.5M18.5 14.5 21 17l-2.5 2.5" />
  </Svg>
);
export const IconRepeat = (p: P) => (
  <Svg {...p}>
    <path d="M4 11V9.5A3.5 3.5 0 0 1 7.5 6H20m0 0-3-3m3 3-3 3M20 13v1.5a3.5 3.5 0 0 1-3.5 3.5H4m0 0 3 3m-3-3 3-3" />
  </Svg>
);
export const IconHeart = ({ filled, ...p }: P & { filled?: boolean }) => (
  <Svg {...p}>
    <path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.1a4.3 4.3 0 0 1 7.5 2.7C19.5 15.4 12 20 12 20z" fill={filled ? 'currentColor' : 'none'} />
  </Svg>
);
export const IconChevronDown = (p: P) => (
  <Svg {...p}>
    <path d="m7 10 5 5 5-5" />
  </Svg>
);
export const IconBack = (p: P) => (
  <Svg {...p}>
    <path d="M15 5 8 12l7 7" />
  </Svg>
);
export const IconMore = (p: P) => (
  <Svg {...p} stroke="none">
    <circle cx="6" cy="12" r="1.7" fill="currentColor" />
    <circle cx="12" cy="12" r="1.7" fill="currentColor" />
    <circle cx="18" cy="12" r="1.7" fill="currentColor" />
  </Svg>
);
export const IconClose = (p: P) => (
  <Svg {...p}>
    <path d="m6 6 12 12M18 6 6 18" />
  </Svg>
);
export const IconLock = (p: P) => (
  <Svg {...p}>
    <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
    <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
  </Svg>
);
export const IconThumbDown = (p: P) => (
  <Svg {...p}>
    <path d="M10 15v4.5a2 2 0 0 0 3.8.9L17 14V4H7.6a2 2 0 0 0-2 1.6l-1.3 7A2 2 0 0 0 6.3 15zM17 4h2.5v10H17" />
  </Svg>
);
export const IconPlus = (p: P) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
export const IconAlbum = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="2.5" />
  </Svg>
);
export const IconInfo = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 11v5.5M12 7.8v.2" />
  </Svg>
);
export const IconMic = (p: P) => (
  <Svg {...p}>
    <rect x="9" y="3.5" width="6" height="11" rx="3" />
    <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5" />
  </Svg>
);
export const IconSend = (p: P) => (
  <Svg {...p}>
    <path d="m4 12 16-7.5L13.5 20l-2.3-6.2z" />
  </Svg>
);
export const IconVolume = ({ level = 1, ...p }: P & { level?: number }) => (
  <Svg {...p}>
    <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" stroke="none" />
    {level > 0 ? <path d="M15 9.5a3.5 3.5 0 0 1 0 5" /> : <path d="m15.5 9.5 5 5m0-5-5 5" />}
    {level > 0.5 ? <path d="M17.8 6.8a7.5 7.5 0 0 1 0 10.4" /> : null}
  </Svg>
);
export const IconMinus = (p: P) => (
  <Svg {...p}>
    <path d="M5 12h14" />
  </Svg>
);
