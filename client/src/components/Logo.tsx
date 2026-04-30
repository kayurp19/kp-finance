// Custom geometric logo: nested coin/circle marks
export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-label="KP Finance logo"
    >
      <circle cx="16" cy="16" r="13" />
      <path d="M11 10v12" />
      <path d="M11 10h5a3.5 3.5 0 1 1 0 7h-5" />
      <path d="M16 17l5 5" />
    </svg>
  );
}
