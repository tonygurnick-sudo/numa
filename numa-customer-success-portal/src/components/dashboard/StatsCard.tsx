import { Card, Badge } from 'react-bootstrap';
import { ReactNode } from 'react';

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
  gradient?: boolean;
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
  gradient = true,
  className = '',
}: StatsCardProps) {
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

  const getCardClasses = () => {
    let classes = 'h-100 border-0 shadow-sm stats-card';
    if (gradient) {
      classes += ' bg-gradient';
    }
    return classes;
  };

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

  return (
    <Card className={`${getCardClasses()} ${className}`}>
      <Card.Body className="p-4">
        <div className="d-flex justify-content-between align-items-start mb-3">
          <div className="flex-grow-1">
            <div className="text-muted small text-uppercase fw-medium mb-1">{title}</div>
            <div className={`fs-2 fw-bold ${getStatusColor()} mb-0`}>{value}</div>
            {subtitle && <div className="text-muted small mt-1">{subtitle}</div>}
          </div>

          <div className="d-flex flex-column align-items-end">
            {badge && (
              <Badge bg={badge.variant} className="mb-2">
                {badge.text}
              </Badge>
            )}
            {icon && (
              <div className={`${getStatusColor()} opacity-50`} style={{ fontSize: '1.5rem' }}>
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
