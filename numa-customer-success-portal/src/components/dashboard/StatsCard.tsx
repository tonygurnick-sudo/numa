import { Card, Badge, ProgressBar } from 'react-bootstrap';
import { ReactNode } from 'react';
import { Link } from 'react-router-dom';

interface StatsCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: ReactNode;
  trend?: {
    value: number;
    label: string;
    isPositive?: boolean;
  };
  status?: 'success' | 'warning' | 'danger' | 'info';
  badge?: {
    text: string;
    variant: string;
  };
  /** Optional progress bar rendered between value and subtitle. */
  progress?: {
    /** Current value, e.g. today's spend. */
    value: number;
    /** Max / cap, e.g. daily limit. */
    max: number;
    variant?: 'success' | 'warning' | 'danger' | 'info';
  };
  /** If set, the entire card becomes a clickable link (internal route). */
  link?: string;
  /** If set, the entire card becomes clickable and calls this on click. */
  onClick?: () => void;
  className?: string;
}

export function StatsCard({
  title,
  value,
  subtitle,
  icon,
  trend,
  status,
  badge,
  progress,
  link,
  onClick,
  className = '',
}: StatsCardProps) {
  // Semantic color used for icon tint + trend arrow only. The big value
  // stays neutral charcoal so cards read as a calm grid, not a green wall.
  const getStatusColor = () => {
    switch (status) {
      case 'success':
        return 'text-success';
      case 'warning':
        return 'text-warning';
      case 'danger':
        return 'text-danger';
      case 'info':
        return 'text-info';
      default:
        return 'text-primary';
    }
  };

  const getCardClasses = () => 'h-100 stats-card';

  const getTrendIcon = () => {
    if (!trend) return null;

    const isPositive = trend.isPositive ?? trend.value > 0;
    return (
      <div className={`d-flex align-items-center small ${isPositive ? 'text-success' : 'text-danger'}`}>
        <i className={`bi ${isPositive ? 'bi-arrow-up' : 'bi-arrow-down'} me-1`}></i>
        <span>
          {Math.abs(trend.value)}% {trend.label}
        </span>
      </div>
    );
  };

  const isInteractive = Boolean(link || onClick);
  const interactiveProps = isInteractive
    ? ({
        as: link ? Link : 'button',
        to: link,
        onClick,
        type: link ? undefined : 'button',
        style: {
          cursor: 'pointer',
          textAlign: 'left' as const,
          width: '100%',
          border: '1px solid var(--nd-border)',
          textDecoration: 'none',
        },
      } as unknown as Record<string, unknown>)
    : {};

  const progressRatio = progress && progress.max > 0 ? Math.min(progress.value / progress.max, 1) : 0;
  const progressPct = Math.round(progressRatio * 100);

  return (
    <Card
      className={`${getCardClasses()} ${isInteractive ? 'stats-card-interactive' : ''} ${className}`}
      {...interactiveProps}
    >
      <Card.Body className="p-4">
        <div className="d-flex justify-content-between align-items-start mb-3">
          <div className="flex-grow-1">
            <div className="text-muted small text-uppercase fw-semibold mb-1" style={{ letterSpacing: '0.06em' }}>
              {title}
            </div>
            <div
              className="stats-card-value mb-0"
              style={{
                fontFamily: 'var(--nd-font-display)',
                fontSize: '1.85rem',
                fontWeight: 500,
                color: 'var(--nd-text)',
                letterSpacing: '-0.02em',
              }}
            >
              {value}
            </div>
            {progress && (
              <div className="mt-2" title={`${progressPct}% of cap`}>
                <ProgressBar now={progressPct} variant={progress.variant || 'success'} style={{ height: '6px' }} />
              </div>
            )}
            {subtitle && <div className="text-muted small mt-1">{subtitle}</div>}
          </div>

          <div className="d-flex flex-column align-items-end">
            {badge && (
              <Badge bg={badge.variant} className="mb-2">
                {badge.text}
              </Badge>
            )}
            {icon && (
              <div className={getStatusColor()} style={{ fontSize: '1.4rem', opacity: 0.65 }}>
                {icon}
              </div>
            )}
          </div>
        </div>

        {trend && <div className="border-top pt-2">{getTrendIcon()}</div>}
      </Card.Body>
    </Card>
  );
}

export default StatsCard;
