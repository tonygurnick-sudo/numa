import { Alert, Badge, Row, Col } from 'react-bootstrap';
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
    <Alert
      variant="light"
      className="border-0 shadow-sm mb-4 welcome-banner"
      style={{
        background: 'linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%)',
        borderLeft: '4px solid var(--bs-primary)',
      }}
    >
      <Row className="align-items-center">
        <Col lg={12}>
          <div className="d-flex align-items-center justify-content-between">
            <div>
              <h5 className="alert-heading mb-2">
                {getGreeting()}, {getUserName()}
              </h5>
              <div className="d-flex align-items-center">
                {getStatusIcon(status.overall)}
                <span className="me-3">
                  System Status:{' '}
                  <strong
                    className={`text-${
                      getStatusVariant(status.overall) === 'success'
                        ? 'success'
                        : getStatusVariant(status.overall) === 'warning'
                          ? 'warning'
                          : 'danger'
                    }`}
                  >
                    {status.overall === 'healthy'
                      ? 'All Systems Operational'
                      : status.overall === 'warning'
                        ? 'Minor Issues Detected'
                        : 'Service Disruption'}
                  </strong>
                </span>

                <div className="d-flex gap-2">
                  {status.services.map((service, index) => (
                    <Badge
                      key={index}
                      bg={getStatusVariant(service.status)}
                      className="px-2"
                      title={service.message || `${service.name}: ${service.status}`}
                    >
                      {service.name}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {status.overall !== 'healthy' && (
            <div className="mt-2 small text-muted">
              {status.services
                .filter((s) => s.status !== 'healthy')
                .map((s) => s.message || `${s.name} experiencing issues`)
                .join(' • ')}
            </div>
          )}
        </Col>
      </Row>

      {status.lastChecked && (
        <div className="text-muted small mt-2 border-top pt-2">
          Status last updated: {new Date(status.lastChecked).toLocaleString()}
        </div>
      )}
    </Alert>
  );
}

export default WelcomeBanner;
