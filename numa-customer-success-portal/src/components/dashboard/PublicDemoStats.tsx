import { Alert, Badge, Button, Card, Col, ProgressBar, Row, Spinner } from 'react-bootstrap';
import { ArrowRight, ChatDots, ChatLeftText, CurrencyDollar, Globe } from 'react-bootstrap-icons';
import { useNavigate } from 'react-router-dom';
import type { PublicDemoStats as Stats } from '@/services/publicDemoService';

interface PublicDemoStatsProps {
  stats: Stats[];
  loading: boolean;
  error?: string;
}

function getCostVariant(ratio: number): string {
  if (ratio >= 0.85) return 'danger';
  if (ratio >= 0.6) return 'warning';
  return 'success';
}

function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

function DemoClientCard({ stat }: { stat: Stats }) {
  const navigate = useNavigate();
  const ratio = stat.dailyLimitUsd > 0 ? stat.todayCostUsd / stat.dailyLimitUsd : 0;
  const pct = Math.min(Math.round(ratio * 100), 100);
  const variant = getCostVariant(ratio);

  return (
    <Card className="border-0 shadow-sm h-100">
      <Card.Body className="p-4">
        <div className="d-flex align-items-center mb-3">
          <Globe className="text-primary me-2" size={20} />
          <h6 className="mb-0 fw-bold">Public Demo</h6>
          <Badge bg="primary" className="ms-2">
            {stat.clientName}
          </Badge>
          <Button
            variant="primary"
            size="sm"
            className="ms-auto d-flex align-items-center"
            onClick={() => navigate(`/public-demo-conversations/${stat.clientName}`)}
          >
            View Conversations
            <ArrowRight className="ms-1" size={14} />
          </Button>
        </div>

        <Row className="g-4">
          {/* Today's Cost */}
          <Col md={4}>
            <div className="text-muted small text-uppercase fw-medium mb-2">Today's Spend</div>
            <div className="d-flex align-items-baseline mb-2">
              <span className={`fs-4 fw-bold text-${variant}`}>{formatUsd(stat.todayCostUsd)}</span>
              <span className="text-muted small ms-1">/ {formatUsd(stat.dailyLimitUsd)}</span>
            </div>
            <ProgressBar
              now={pct}
              variant={variant}
              style={{ height: '8px' }}
              label={pct >= 20 ? `${pct}%` : undefined}
            />
            {ratio >= 1 && <div className="text-danger small mt-1 fw-medium">Daily limit reached</div>}
          </Col>

          {/* 30-Day Conversations */}
          <Col md={2}>
            <div className="text-muted small text-uppercase fw-medium mb-2">Conversations</div>
            <div className="d-flex align-items-center">
              <ChatLeftText className="text-primary me-2" size={18} />
              <span className="fs-4 fw-bold text-primary">{stat.thirtyDayUniqueConversations.toLocaleString()}</span>
            </div>
          </Col>

          {/* 30-Day Messages */}
          <Col md={2}>
            <div className="text-muted small text-uppercase fw-medium mb-2">Messages</div>
            <div className="d-flex align-items-center">
              <ChatDots className="text-info me-2" size={18} />
              <span className="fs-4 fw-bold text-info">{stat.thirtyDayMessages.toLocaleString()}</span>
            </div>
          </Col>

          {/* 30-Day Cost */}
          <Col md={4}>
            <div className="text-muted small text-uppercase fw-medium mb-2">30-Day Cost</div>
            <div className="d-flex align-items-center">
              <CurrencyDollar className="text-success me-2" size={18} />
              <span className="fs-4 fw-bold text-success">{formatUsd(stat.thirtyDayCostUsd)}</span>
            </div>
          </Col>
        </Row>
      </Card.Body>
    </Card>
  );
}

export function PublicDemoStats({ stats, loading, error }: PublicDemoStatsProps) {
  if (loading) {
    return (
      <Card className="border-0 shadow-sm">
        <Card.Body className="p-4 text-center">
          <Spinner animation="border" size="sm" className="me-2" />
          <span className="text-muted">Loading public demo stats...</span>
        </Card.Body>
      </Card>
    );
  }

  if (error) {
    return (
      <Alert variant="warning" className="mb-0">
        <strong>Public Demo:</strong> {error}
      </Alert>
    );
  }

  if (stats.length === 0) return null;

  return (
    <>
      {stats.map((stat) => (
        <DemoClientCard key={stat.clientName} stat={stat} />
      ))}
    </>
  );
}
