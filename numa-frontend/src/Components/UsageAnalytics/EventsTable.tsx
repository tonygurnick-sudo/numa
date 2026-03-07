import { useState, useEffect } from 'react';
import { Table, Form, Button, Spinner, Badge, Row, Col } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { useNumaRequest } from '../../Providers/NumaRequestContext';
import { AdminUsageAnalyticsService } from '../../Services/AdminUsageAnalyticsService';
import EventDetailsModal from './EventDetailsModal';
import type { UsageEvent } from '../../../../lib/usage-analytics-schemas';

/**
 * Paginated table for viewing usage analytics events
 * - Filters by event type and isTest flag
 * - Pagination with nextToken
 * - Click to view details in modal
 */
export default function EventsTable() {
  const { t } = useTranslation('settings');
  const { numaGet } = useNumaRequest();

  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<UsageEvent[]>([]);
  const [nextToken, setNextToken] = useState<string | undefined>();
  const [filters, setFilters] = useState({
    eventType: '',
    isTest: 'all' as 'all' | 'true' | 'false',
  });
  const [selectedEvent, setSelectedEvent] = useState<UsageEvent | null>(null);

  useEffect(() => {
    loadEvents();
  }, [filters]);

  const loadEvents = async (token?: string) => {
    setLoading(true);
    try {
      const response = await AdminUsageAnalyticsService.listEvents(
        {
          eventType: filters.eventType || undefined,
          isTest: filters.isTest !== 'all' ? filters.isTest === 'true' : undefined,
          nextToken: token,
          limit: 50,
        },
        numaGet
      );

      setEvents(response.events ?? []);
      setNextToken(response.nextToken);
    } catch (e) {
      console.error('Failed to load events', e);
      setEvents([]);
    } finally {
      setLoading(false);
    }
  };

  const loadMore = () => {
    if (nextToken) {
      loadEvents(nextToken);
    }
  };

  return (
    <>
      <Row className="mb-3">
        <Col md={4}>
          <Form.Select
            value={filters.eventType}
            onChange={(e) => setFilters({ ...filters, eventType: e.target.value })}
            aria-label={t('usageAnalytics.filters.eventType')}
          >
            <option value="">{t('usageAnalytics.filters.allTypes')}</option>
            <option value="login">{t('usageAnalytics.eventTypes.login')}</option>
            <option value="chat_message">{t('usageAnalytics.eventTypes.chatMessage')}</option>
            <option value="chat_conversation">{t('usageAnalytics.eventTypes.chatConversation')}</option>
            <option value="agent_created">{t('usageAnalytics.eventTypes.agentCreated')}</option>
            <option value="agent_executed">{t('usageAnalytics.eventTypes.agentExecuted')}</option>
            <option value="file_upload">{t('usageAnalytics.eventTypes.fileUpload')}</option>
            <option value="file_delete">{t('usageAnalytics.eventTypes.fileDelete')}</option>
            <option value="kb_created">{t('usageAnalytics.eventTypes.kbCreated')}</option>
            <option value="kb_deleted">{t('usageAnalytics.eventTypes.kbDeleted')}</option>
            <option value="kb_query">{t('usageAnalytics.eventTypes.kbQuery')}</option>
            <option value="integration_activated">{t('usageAnalytics.eventTypes.integrationActivated')}</option>
            <option value="integration_tool_call">{t('usageAnalytics.eventTypes.integrationToolCall')}</option>
            <option value="secret_accessed">{t('usageAnalytics.eventTypes.secretAccessed')}</option>
          </Form.Select>
        </Col>

        <Col md={3}>
          <Form.Select
            value={filters.isTest}
            onChange={(e) => setFilters({ ...filters, isTest: e.target.value as 'all' | 'true' | 'false' })}
            aria-label={t('usageAnalytics.filters.testFilter')}
          >
            <option value="all">{t('usageAnalytics.filters.allData')}</option>
            <option value="true">{t('usageAnalytics.filters.testOnly')}</option>
            <option value="false">{t('usageAnalytics.filters.prodOnly')}</option>
          </Form.Select>
        </Col>
      </Row>

      {loading ? (
        <div className="text-center py-5">
          <Spinner animation="border" />
        </div>
      ) : (
        <>
          <div className="table-responsive">
            <Table striped bordered hover>
              <thead>
                <tr>
                  <th>{t('usageAnalytics.table.timestamp')}</th>
                  <th>{t('usageAnalytics.table.eventType')}</th>
                  <th>{t('usageAnalytics.table.userId')}</th>
                  <th>{t('usageAnalytics.table.isTest')}</th>
                  <th>{t('usageAnalytics.table.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {events.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center text-muted py-4">
                      {t('usageAnalytics.table.noEvents')}
                    </td>
                  </tr>
                ) : (
                  events.map((event) => (
                    <tr key={event.eventId}>
                      <td>
                        {new Date(event.timestamp).toLocaleString(undefined, {
                          dateStyle: 'short',
                          timeStyle: 'medium',
                        })}
                      </td>
                      <td>
                        <code style={{ fontSize: '0.875rem' }}>{event.eventType}</code>
                      </td>
                      <td className="text-truncate" style={{ maxWidth: '200px' }} title={event.userId}>
                        {event.userName ?? event.userId}
                      </td>
                      <td>
                        {event.isTest ? (
                          <Badge bg="warning" text="dark">
                            {t('usageAnalytics.table.test')}
                          </Badge>
                        ) : (
                          <Badge bg="success">{t('usageAnalytics.table.prod')}</Badge>
                        )}
                      </td>
                      <td>
                        <Button size="sm" variant="outline-primary" onClick={() => setSelectedEvent(event)}>
                          <i className="bi bi-eye"></i>
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </Table>
          </div>

          <div className="d-flex justify-content-between align-items-center">
            <span className="text-muted small">{t('usageAnalytics.table.showing', { count: events.length })}</span>
            {nextToken && (
              <Button variant="outline-primary" onClick={loadMore}>
                {t('usageAnalytics.table.loadMore')}
              </Button>
            )}
          </div>
        </>
      )}

      <EventDetailsModal event={selectedEvent} show={!!selectedEvent} onHide={() => setSelectedEvent(null)} />
    </>
  );
}
