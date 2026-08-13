export function SessionsMark({ size = 32, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="sessions-brand-gradient" x1="8" y1="14" x2="56" y2="50" gradientUnits="userSpaceOnUse">
          <stop stopColor="#2787FF" />
          <stop offset="1" stopColor="#37E1D1" />
        </linearGradient>
      </defs>
      <rect x="17" y="7" width="34" height="13" rx="4" stroke="#6D7E9A" strokeWidth="3" />
      <path d="M32 20V27" stroke="#6D7E9A" strokeWidth="3" strokeLinecap="round" />
      <rect x="12" y="27" width="40" height="14" rx="4" stroke="url(#sessions-brand-gradient)" strokeWidth="3.5" />
      <path d="M32 41V48" stroke="#6D7E9A" strokeWidth="3" strokeLinecap="round" />
      <rect x="17" y="48" width="34" height="9" rx="3" stroke="#6D7E9A" strokeWidth="3" />
      <rect x="28.25" y="30.25" width="7.5" height="7.5" rx="1.5" transform="rotate(45 28.25 30.25)" stroke="#37E1D1" strokeWidth="2.5" />
      <path d="M12 34H7.5C5.57 34 4 35.57 4 37.5V40C4 43.31 6.69 46 10 46H26" stroke="#37E1D1" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M23 42.5L26.5 46L23 49.5" stroke="#37E1D1" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="19.5" cy="33.8" r="1.8" fill="#2787FF" />
      <path d="M40 33.8H46" stroke="#37E1D1" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

export function SessionsBrand({ compact = false }: { compact?: boolean }) {
  return (
    <span className="sessions-brand-lockup">
      <span className="sessions-brand-icon"><SessionsMark size={compact ? 28 : 32} /></span>
      <span className="sessions-wordmark">SESSIONS</span>
    </span>
  );
}
