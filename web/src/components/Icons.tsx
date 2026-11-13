/**
 * Inline SVG icons.
 *
 * Accessibility rule from PRD Section 10: a verdict is never communicated by
 * colour alone. Every verdict colour ships with one of these shapes and a word,
 * so the three of them agree even for a colour-blind user or a bright screen
 * in daylight.
 */
type IconProps = { className?: string; strokeWidth?: number };

const base = (props: IconProps) => ({
  className: props.className ?? "h-6 w-6",
  viewBox: "0 0 24 24",
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: props.strokeWidth ?? 2.4,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
});

export const CheckIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

export const CrossIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

export const ClockIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);

export const QuestionIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.2 9.3a2.8 2.8 0 1 1 3.6 2.7c-.5.2-.8.7-.8 1.2v.6" />
    <path d="M12 17.2h.01" />
  </svg>
);

export const WarningIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M10.3 3.9 2.6 17a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    <path d="M12 9v4M12 17h.01" />
  </svg>
);

export const ShieldIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 3 5 6v5.5c0 4.3 2.9 8.3 7 9.5 4.1-1.2 7-5.2 7-9.5V6l-7-3Z" />
  </svg>
);

export const MicIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </svg>
);

export const FileIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" />
    <path d="M14 3v5h5" />
  </svg>
);

export const WaveIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 10v4M8 6v12M12 3v18M16 7v10M20 10v4" />
  </svg>
);

export const PenIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" />
  </svg>
);

export const ArrowLeftIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M19 12H5M12 19l-7-7 7-7" />
  </svg>
);

export const DownloadIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 3v12M7 11l5 5 5-5M5 21h14" />
  </svg>
);

export const ShareIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 3v13M8 7l4-4 4 4" />
    <path d="M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" />
  </svg>
);

export const StopIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </svg>
);

export const PhoneOffIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3 3l18 18" />
    <path d="M5.5 10.5a16 16 0 0 0 8 8l2.2-2.2a1.6 1.6 0 0 1 1.7-.4c1 .3 2 .5 3.1.5a1.6 1.6 0 0 1 1.5 1.6V21a1.6 1.6 0 0 1-1.7 1.6A19 19 0 0 1 2.4 5.7 1.6 1.6 0 0 1 4 4h3a1.6 1.6 0 0 1 1.6 1.5c0 1 .2 2.1.5 3.1a1.6 1.6 0 0 1-.4 1.7l-2.2 2.2" />
  </svg>
);

export const SunIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
  </svg>
);

export const MoonIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
  </svg>
);

export const ServerIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
    <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
    <line x1="6" y1="6" x2="6.01" y2="6" />
    <line x1="6" y1="18" x2="6.01" y2="18" />
  </svg>
);


export const HomeIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.5V20h5v-6h4v6h5V9.5" />
  </svg>
);

export const GearIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.8 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 2.9-1.2V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.8 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.2a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
  </svg>
);

export const ChevronRightIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m9 6 6 6-6 6" />
  </svg>
);

export const UploadIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 16V4" />
    <path d="m7 9 5-5 5 5" />
    <path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
  </svg>
);

export const KeyIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="8" cy="15" r="4" />
    <path d="m11 12 9-9" />
    <path d="m16 7 3 3" />
  </svg>
);

export const TrashIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 7h16" />
    <path d="M9 7V4h6v3" />
    <path d="M6 7l1 13h10l1-13" />
  </svg>
);

export const BotIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="4" y="8" width="16" height="11" rx="3" />
    <path d="M12 8V4" />
    <circle cx="12" cy="3.5" r="0.8" />
    <path d="M9 13v1.5M15 13v1.5" />
  </svg>
);

export const ChatIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 5h16v11H9l-5 4V5Z" />
    <path d="M8 9h8M8 12h5" />
  </svg>
);

export const ScissorsIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="6" cy="6" r="2.5" />
    <circle cx="6" cy="18" r="2.5" />
    <path d="M8 8l12 10M8 16 20 6" />
  </svg>
);

export const ShieldCheckIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 3 4.5 6v5.5c0 4.6 3.1 8.2 7.5 9.5 4.4-1.3 7.5-4.9 7.5-9.5V6L12 3Z" />
    <path d="m8.8 12 2.3 2.3 4.2-4.6" />
  </svg>
);

/** The app mark: a shield carrying a voice waveform. */
export const LogoMark = ({ className = "h-9 w-9" }: { className?: string }) => (
  <svg className={className} viewBox="0 0 40 40" aria-hidden>
    <defs>
      <linearGradient id="sv-logo" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#5b86ff" />
        <stop offset="1" stopColor="#1b4ddb" />
      </linearGradient>
    </defs>
    <path d="M20 3 6 8.5v10.2C6 27.4 11.800 33.900 20 37c8.200-3.100 14-9.600 14-18.300V8.500L20 3Z" fill="url(#sv-logo)" />
    <g stroke="#fff" strokeWidth="2.4" strokeLinecap="round">
      <path d="M12.500 17.500v5" />
      <path d="M16.250 14v12" />
      <path d="M20 11v18" />
      <path d="M23.750 15v10" />
      <path d="M27.500 18v4" />
    </g>
  </svg>
);
