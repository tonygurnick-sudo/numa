import { Badge } from 'react-bootstrap';
import { CheckCircle, ExclamationTriangle, XCircle, Clock } from 'react-bootstrap-icons';
import { useAuth } from '@/contexts/AuthContext';

export interface SystemStatus {
  overall: 'healthy' | 'warning' | 'error';
  services: {
    name: string;
    status: 'healthy' | 'warning' | 'error';
    message?: string;
  }[];
  lastChecked?: string;
}

interface WelcomeBannerProps {
  systemStatus?: SystemStatus;
  onQuickAction?: (action: string) => void;
}

export function WelcomeBanner({ systemStatus, onQuickAction: _onQuickAction }: WelcomeBannerProps) {
  const { user } = useAuth();

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'healthy':
        return <CheckCircle className="text-success me-2" />;
      case 'warning':
        return <ExclamationTriangle className="text-warning me-2" />;
      case 'error':
        return <XCircle className="text-danger me-2" />;
      default:
        return <Clock className="text-muted me-2" />;
    }
  };

  const getStatusVariant = (status: string) => {
    switch (status) {
      case 'healthy':
        return 'success';
      case 'warning':
        return 'warning';
      case 'error':
        return 'danger';
      default:
        return 'secondary';
    }
  };

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  };

  const getUserName = () => {
    if (!user?.name) return user?.email?.split('@')[0] || 'User';
    return user.name.split(' ')[0]; // First name only
  };

  const defaultSystemStatus: SystemStatus = {
    overall: 'healthy',
    services: [
      { name: 'Client Configs', status: 'healthy' },
      { name: 'Deployments', status: 'healthy' },
      { name: 'Analytics', status: 'healthy' },
    ],
    lastChecked: new Date().toISOString(),
  };

  const status = systemStatus || defaultSystemStatus;

  return (
    <div className="welcome-banner mb-4 d-flex align-items-center justify-content-between flex-wrap gap-3">
      <div>
        <h3
          className="mb-1"
          style={{
            fontFamily: 'var(--nd-font-display)',
            fontWeight: 500,
            letterSpacing: '-0.015em',
            color: 'var(--nd-text)',
            fontSize: '1.6rem',
          }}
        >
          {getGreeting()}, {getUserName()}
        </h3>
        <div className="d-flex align-items-center flex-wrap gap-2 small" style={{ color: 'var(--nd-text-faint)' }}>
          <span className="d-flex align-items-center">
            {getStatusIcon(status.overall)}
            <span>
              {status.overall === 'healthy'
                ? 'All Systems Operational'
                : status.overall === 'warning'
                  ? 'Minor Issues Detected'
                  : 'Service Disruption'}
            </span>
          </span>
          {status.lastChecked && (
            <span aria-hidden="true" style={{ color: 'var(--nd-border-strong, rgba(31,31,31,0.18))' }}>
              ·
            </span>
          )}
          {status.lastChecked && (
            <span title="Last status check">
              updated {new Date(status.lastChecked).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
      </div>

      <div className="d-flex gap-2 flex-wrap">
        {status.services.map((service, index) => (
          <Badge
            key={index}
            bg={getStatusVariant(service.status)}
            title={service.message || `${service.name}: ${service.status}`}
          >
            {service.name}
          </Badge>
        ))}
      </div>

      {status.overall !== 'healthy' && (
        <div className="w-100 small mt-1" style={{ color: 'var(--nd-warn)' }}>
          {status.services
            .filter((s) => s.status !== 'healthy')
            .map((s) => s.message || `${s.name} experiencing issues`)
            .join(' • ')}
        </div>
      )}
    </div>
  );
}

export default WelcomeBanner;
