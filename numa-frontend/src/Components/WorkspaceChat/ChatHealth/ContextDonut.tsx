import React from 'react';

interface Props {
  /** 0..1 fill ratio */
  pct: number;
  /** Pulse softly to signal imminent automatic compaction (>= 90%) */
  pulse?: boolean;
  size?: number;
}

/**
 * Neutral context-fill donut. No colour bands - colour is reserved for the
 * separate ChatHealthAlarm. The donut just fills.
 *
 * When `pulse` is true (near compaction), the ring breathes gently to signal
 * an imminent automatic event. No alarm semantics.
 */
export const ContextDonut: React.FC<Props> = ({ pct, pulse = false, size = 16 }) => {
  const safePct = Math.max(0, Math.min(1, pct));
  const radius = (size - 2) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - safePct);
  const cx = size / 2;
  const cy = size / 2;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={`chat-health-donut ${pulse ? 'chat-health-donut-pulse' : ''}`}
      aria-hidden="true"
    >
      <circle cx={cx} cy={cy} r={radius} fill="none" stroke="currentColor" strokeOpacity={0.18} strokeWidth={2} />
      <circle
        cx={cx}
        cy={cy}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${cx} ${cy})`}
        style={{ transition: 'stroke-dashoffset 400ms ease-out' }}
      />
    </svg>
  );
};
