/** Small inline icon set (24px grid, 1.8 stroke) – avoids an icon library. */
const PATHS = {
  home: 'M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z',
  food: 'M7 3v8m-3-8v5a3 3 0 0 0 6 0V3M7 11v10M17 21V3c-2.2 1.2-3.5 3.6-3.5 6.5V14H17',
  dumbbell: 'M6.5 6.5v11M3.5 9v6M17.5 6.5v11M20.5 9v6M6.5 12h11',
  cart: 'M3 4h2.2l2.3 11h10.7l2-8H6.5M9.5 20a1 1 0 1 0 0-.01M17.5 20a1 1 0 1 0 0-.01',
  chart: 'M4 20V4M4 20h16M8 16l4-5 3 3 5-6',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  check: 'M5 12.5 10 17.5 19.5 7',
  chevronRight: 'M9 5l7 7-7 7',
  chevronLeft: 'M15 5l-7 7 7 7',
  chevronDown: 'M5 9l7 7 7-7',
  swap: 'M7 4 3.5 7.5 7 11M3.5 7.5H17M17 13l3.5 3.5L17 20m3.5-3.5H7',
  close: 'M6 6l12 12M18 6 6 18',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  clock: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8m-7 8a7 7 0 0 1 14 0',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  info: 'M12 11v6M12 7.5h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  play: 'M8 5.5v13l10.5-6.5z',
  trophy: 'M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4m8-4h3a3 3 0 0 1-3 4m-4 3v4m-4 3h8',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14m9 2-4-4',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 17l.7 1.3L21 19l-1.3.7L19 21l-.7-1.3L17 19l1.3-.7z',
  scale: 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1m3.5 6a5 5 0 0 1 7 0L12 13',
  flame: 'M12 21a6 6 0 0 0 6-6c0-4-3-6-4-10-1.5 2-2 3.5-2 5-1-1-1.5-2-1.5-3C8 9 6 11.5 6 15a6 6 0 0 0 6 6',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6m7.4-1.6 1.6 1.2-2 3.4-1.9-.7a7 7 0 0 1-2 1.2L14.8 21h-4l-.3-2.5a7 7 0 0 1-2-1.2l-1.9.7-2-3.4 1.6-1.2a7 7 0 0 1 0-2.3L4.6 9.9l2-3.4 1.9.7a7 7 0 0 1 2-1.2L10.8 3h4l.3 2.5a7 7 0 0 1 2 1.2l1.9-.7 2 3.4-1.6 1.2a7 7 0 0 1 0 2.3',
  calendar: 'M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zm0 3h16M8 3v4m8-4v4',
  download: 'M12 4v11m-5-5 5 5 5-5M5 20h14',
  upload: 'M12 16V5m-5 5 5-5 5 5M5 20h14',
  pause: 'M8 5v14M16 5v14',
  share: 'M12 15V4M8 8l4-4 4 4M5 13v6a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-6',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  barcode: 'M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 8v8M10 8v8M13 8v8M17 8v8',
  drop: 'M12 3.5c3 3.6 6 7 6 10.5a6 6 0 0 1-12 0c0-3.5 3-6.9 6-10.5',
} as const;

export type IconName = keyof typeof PATHS;

interface IconProps {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
  label?: string;
}

export function Icon({ name, size = 22, strokeWidth = 1.8, className, label }: IconProps) {
  const filled = name === 'play';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
