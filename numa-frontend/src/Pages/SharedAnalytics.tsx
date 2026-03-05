import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Card, Table, Badge, Row, Col, Alert, Spinner, Nav } from 'react-bootstrap';
import {
  getShareAnalytics,
  getActivity,
  ShareAnalytics as AnalyticsData,
  ActivityItem,
} from '../Services/sharedChatService';
import { buildHourlyActivity, buildDailyActivity, formatHour, formatDateShort } from '../utils/messageAnalyticsUtils';
import './SharedAnalytics.scss';

type TabKey = 'analytics' | 'activity';

/**
 * Analytics page for shared document Q&A.
 * Two tabs:
 * - Analytics: conversation summaries, sentiment, engagement scoring
 * - Activity Feed: recent visitor messages for this share
 */
export const SharedAnalytics = () => {
  const { uuid } = useParams<{ uuid: string }>();
  const { t, ready } = useTranslation('shared');
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [activeTab, setActiveTab] = useState<TabKey>('analytics');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!uuid) return;

    Promise.all([getShareAnalytics(uuid), getActivity(50).catch(() => [])])
      .then(([analyticsData, activityData]) => {
        setAnalytics(analyticsData);
        // Filter activity to only this share's items
        setActivity((activityData ?? []).filter((a) => a.share_uuid === uuid));
      })
      .catch((err) => setError(err.message || t('analytics.error')))
      .finally(() => setLoading(false));
  }, [uuid, t]);

  if (!ready || loading) {
    return (
      <div className="shared-analytics-loading">
        <Spinner animation="border" variant="primary" />
        <p>{t('analytics.loading')}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="shared-analytics-error">
        <Alert variant="danger">{error}</Alert>
        <Link to="/files" className="btn btn-primary">
          {t('analytics.backToDashboard')}
        </Link>
      </div>
    );
  }

  if (!analytics) {
    return (
      <div className="shared-analytics-error">
        <Alert variant="warning">{t('analytics.noData')}</Alert>
      </div>
    );
  }

  const hourlyData = buildHourlyActivity(analytics);
  const dailyData = buildDailyActivity(analytics);

  return (
    <div className="shared-analytics">
      <div className="analytics-header">
        <h1>{t('analytics.title')}</h1>
        <Link to={`/shared/${uuid}`} className="btn btn-outline-primary btn-sm">
          <i className="bi bi-eye me-1" />
          {t('analytics.viewShare')}
        </Link>
      </div>

      {/* Tabs */}
      <Nav
        variant="pills"
        className="analytics-tabs mb-4"
        activeKey={activeTab}
        onSelect={(k) => setActiveTab(k as TabKey)}
      >
        <Nav.Item>
          <Nav.Link eventKey="analytics">
            <i className="bi bi-bar-chart me-1" />
            {t('analytics.tabs.analytics')}
          </Nav.Link>
        </Nav.Item>
        <Nav.Item>
          <Nav.Link eventKey="activity">
            <i className="bi bi-activity me-1" />
            {t('analytics.tabs.activity')}
            {activity.length > 0 && (
              <Badge bg="primary" pill className="ms-2">
                {activity.length}
              </Badge>
            )}
          </Nav.Link>
        </Nav.Item>
      </Nav>

      {/* Analytics Tab */}
      {activeTab === 'analytics' && (
        <>
          {/* Overall Summary Card */}
          <Card className="overall-summary mb-4">
            <Card.Header>
              <h5 className="mb-0">{t('analytics.questionsSummary')}</h5>
            </Card.Header>
            <Card.Body>
              <Row className="stats-row">
                <Col md={3}>
                  <div className="stat">
                    <div className="stat-value">{analytics.overall.total_sessions}</div>
                    <div className="stat-label">{t('analytics.totalSessions')}</div>
                  </div>
                </Col>
                <Col md={3}>
                  <div className="stat">
                    <div className="stat-value">{analytics.overall.total_messages}</div>
                    <div className="stat-label">{t('analytics.totalMessages')}</div>
                  </div>
                </Col>
                <Col md={3}>
                  <div className="stat">
                    <div className="stat-value">{analytics.overall.unique_visitors}</div>
                    <div className="stat-label">{t('analytics.uniqueVisitors')}</div>
                  </div>
                </Col>
                <Col md={3}>
                  <div className="stat">
                    <SentimentBadge sentiment={analytics.overall.overall_sentiment} />
                    <div className="stat-label">{t('analytics.overallSentiment')}</div>
                  </div>
                </Col>
              </Row>
              {analytics.overall.overall_summary && (
                <div className="overall-summary-text mt-3">
                  <p className="text-muted mb-1">{t('analytics.summaryLabel')}</p>
                  <p className="mb-0">{analytics.overall.overall_summary}</p>
                </div>
              )}
            </Card.Body>
          </Card>

          {/* Engagement Card — always visible; shows pending state when no data */}
          <Card className="engagement-card mb-4">
            <Card.Header>
              <h5 className="mb-0">{t('analytics.engagement.title')}</h5>
            </Card.Header>
            <Card.Body>
              <Row>
                <Col md={3}>
                  <div className="stat">
                    {analytics.engagement && analytics.engagement.engagement_score > 0 ? (
                      <>
                        <div className="stat-value">{analytics.engagement.engagement_score}</div>
                        <div className="stat-label">{t('analytics.engagement.score')}</div>
                        <div className="progress mt-2" style={{ height: '8px' }}>
                          <div
                            className={`progress-bar ${analytics.engagement.engagement_score >= 60 ? 'bg-success' : analytics.engagement.engagement_score >= 30 ? 'bg-warning' : 'bg-danger'}`}
                            style={{ width: `${analytics.engagement.engagement_score}%` }}
                          />
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="stat-value stat-value--pending">{t('analytics.engagement.pending')}</div>
                        <div className="stat-label">{t('analytics.engagement.score')}</div>
                        <div className="progress mt-2" style={{ height: '8px' }}>
                          <div className="progress-bar bg-secondary" style={{ width: '0%' }} />
                        </div>
                      </>
                    )}
                  </div>
                </Col>
                <Col md={5}>
                  <p className="text-muted mb-2">{t('analytics.engagement.signals')}</p>
                  {analytics.engagement && analytics.engagement.interest_signals.length > 0 ? (
                    <div className="d-flex flex-wrap gap-1">
                      {analytics.engagement.interest_signals.map((signal) => (
                        <Badge key={signal} bg="info" className="fw-normal">
                          {signal}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <p className="text-muted fst-italic mb-0">{t('analytics.engagement.waitingForActivity')}</p>
                  )}
                </Col>
                <Col md={4}>
                  <p className="text-muted mb-2">{t('analytics.engagement.action')}</p>
                  {analytics.engagement && analytics.engagement.recommended_action ? (
                    <p className="mb-0 fst-italic">{analytics.engagement.recommended_action}</p>
                  ) : (
                    <p className="text-muted fst-italic mb-0">{t('analytics.engagement.waitingForActivity')}</p>
                  )}
                </Col>
              </Row>
            </Card.Body>
          </Card>

          {/* Daily Activity Chart */}
          <Card className="activity-chart-card mb-4">
            <Card.Header>
              <h5 className="mb-0">{t('analytics.dailyActivity')}</h5>
            </Card.Header>
            <Card.Body>
              <div className="activity-chart-bars activity-chart-bars--daily">
                {dailyData.map((day) => {
                  const maxCount = Math.max(...dailyData.map((d) => d.count), 1);
                  const height = (day.count / maxCount) * 100;
                  return (
                    <div key={day.date} className="activity-chart-bar-col" title={`${day.date}: ${day.count} messages`}>
                      <div
                        className="activity-chart-bar activity-chart-bar--daily"
                        style={{
                          height: `${height}%`,
                          minHeight: day.count > 0 ? '4px' : '0',
                        }}
                      />
                      <small className="activity-chart-label">{formatDateShort(day.date).split(' ')[0]}</small>
                    </div>
                  );
                })}
              </div>
              <small className="text-muted">{t('analytics.dailyDescription')}</small>
            </Card.Body>
          </Card>

          {/* Hourly Activity Chart */}
          <Card className="activity-chart-card mb-4">
            <Card.Header>
              <h5 className="mb-0">{t('analytics.hourlyActivity')}</h5>
            </Card.Header>
            <Card.Body>
              <div className="activity-chart-bars activity-chart-bars--hourly">
                {hourlyData.map((count, hour) => {
                  const maxCount = Math.max(...hourlyData, 1);
                  const height = (count / maxCount) * 100;
                  return (
                    <div key={hour} className="activity-chart-bar-col" title={`${formatHour(hour)}: ${count} messages`}>
                      <div
                        className="activity-chart-bar activity-chart-bar--hourly"
                        style={{
                          height: `${height}%`,
                          minHeight: count > 0 ? '4px' : '0',
                          backgroundColor: count > 0 ? undefined : '#dee2e6',
                        }}
                      />
                      {hour % 3 === 0 && (
                        <small className="activity-chart-label activity-chart-label--hourly">{formatHour(hour)}</small>
                      )}
                    </div>
                  );
                })}
              </div>
              <small className="text-muted mt-3 d-block">{t('analytics.hourlyDescription')}</small>
            </Card.Body>
          </Card>

          {/* Sessions Table */}
          <Card className="sessions-list">
            <Card.Header>
              <h5 className="mb-0">{t('analytics.conversations')}</h5>
            </Card.Header>
            <Card.Body>
              {analytics.sessions.length === 0 ? (
                <p className="text-muted text-center py-4">{t('analytics.noConversations')}</p>
              ) : (
                <Table striped hover responsive>
                  <thead>
                    <tr>
                      <th>{t('analytics.time')}</th>
                      <th>{t('analytics.messages')}</th>
                      <th>{t('analytics.sentiment')}</th>
                      <th>{t('analytics.summary')}</th>
                      <th>{t('analytics.topics')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.sessions.map((session) => (
                      <tr key={session.session_id}>
                        <td className="time-cell">{formatDate(session.first_message_at)}</td>
                        <td>{session.message_count}</td>
                        <td>
                          <SentimentBadge sentiment={session.sentiment} />
                        </td>
                        <td className="summary-cell">{session.summary}</td>
                        <td className="topics-cell">
                          {session.topics.map((topic) => (
                            <Badge key={topic} bg="secondary" className="me-1 mb-1">
                              {topic}
                            </Badge>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card.Body>
          </Card>
        </>
      )}

      {/* Activity Feed Tab */}
      {activeTab === 'activity' && (
        <>
          {/* Live Activity Feed */}
          <Card className="mb-4">
            <Card.Header>
              <h5 className="mb-0">{t('analytics.activity.title')}</h5>
            </Card.Header>
            <Card.Body>
              {activity.length === 0 ? (
                <div className="text-center py-5 text-muted">
                  <i className="bi bi-mailbox" style={{ fontSize: '2.5rem' }} />
                  <h5 className="mt-3">{t('analytics.activity.empty')}</h5>
                  <p>{t('analytics.activity.emptyMessage')}</p>
                </div>
              ) : (
                <div className="activity-list">
                  {activity.map((item, idx) => (
                    <div
                      key={`${item.session_id}-${item.timestamp}-${idx}`}
                      className="activity-item d-flex gap-3 py-3 border-bottom"
                    >
                      <div className="activity-icon">
                        {item.event_type === 'view' ? (
                          <i className="bi bi-eye text-info" style={{ fontSize: '1.25rem' }} />
                        ) : (
                          <i className="bi bi-chat-dots text-primary" style={{ fontSize: '1.25rem' }} />
                        )}
                      </div>
                      <div className="flex-grow-1">
                        <div className="d-flex align-items-center gap-2 mb-1">
                          <Badge bg={item.event_type === 'view' ? 'info' : 'primary'} className="fw-normal">
                            {item.event_type === 'view'
                              ? t('analytics.activity.viewedDocument')
                              : t('analytics.activity.askedQuestion')}
                          </Badge>
                          <span className="text-muted small">{formatDate(item.timestamp)}</span>
                        </div>
                        {item.event_type === 'message' && <p className="mb-0">{item.message_preview}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card.Body>
          </Card>

          {/* Quote Stats */}
          <Card>
            <Card.Header>
              <h5 className="mb-0">{t('analytics.quoteStats.title')}</h5>
            </Card.Header>
            <Card.Body className="p-0">
              <div className="quote-stats-list">
                <div className="quote-stat-row d-flex justify-content-between align-items-center px-4 py-3 border-bottom">
                  <span className="d-flex align-items-center gap-2">
                    <i className="bi bi-eye text-warning" />
                    {t('analytics.quoteStats.totalViews')}
                  </span>
                  <strong>{analytics.overall.view_count ?? 0}</strong>
                </div>
                <div className="quote-stat-row d-flex justify-content-between align-items-center px-4 py-3 border-bottom">
                  <span className="d-flex align-items-center gap-2">
                    <i className="bi bi-people text-info" />
                    {t('analytics.quoteStats.uniqueViewers')}
                  </span>
                  <strong>{analytics.overall.unique_visitors}</strong>
                </div>
                <div className="quote-stat-row d-flex justify-content-between align-items-center px-4 py-3 border-bottom">
                  <span className="d-flex align-items-center gap-2">
                    <i className="bi bi-chat-dots text-primary" />
                    {t('analytics.quoteStats.questionsAsked')}
                  </span>
                  <strong>{analytics.overall.total_messages}</strong>
                </div>
                <div className="quote-stat-row d-flex justify-content-between align-items-center px-4 py-3">
                  <span className="d-flex align-items-center gap-2">
                    <i className="bi bi-clock text-secondary" />
                    {t('analytics.quoteStats.timeOnPage')}
                  </span>
                  <strong>{`${analytics.overall.avg_session_duration ?? 0}m`}</strong>
                </div>
              </div>
            </Card.Body>
          </Card>
        </>
      )}
    </div>
  );
};

const SentimentBadge = ({ sentiment }: { sentiment: string }) => {
  const colors: Record<string, string> = {
    positive: 'success',
    neutral: 'secondary',
    negative: 'danger',
  };
  const icons: Record<string, string> = {
    positive: 'bi-emoji-smile',
    neutral: 'bi-emoji-neutral',
    negative: 'bi-emoji-frown',
  };

  return (
    <Badge bg={colors[sentiment] || 'secondary'} className="sentiment-badge">
      <i className={`bi ${icons[sentiment] || 'bi-emoji-neutral'} me-1`} />
      {sentiment}
    </Badge>
  );
};

function formatDate(timestamp: number | undefined): string {
  if (!timestamp) return '-';
  const ts = timestamp > 9999999999 ? timestamp : timestamp * 1000;
  return new Date(ts).toLocaleString();
}
