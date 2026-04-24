import { useState, useCallback, useEffect, useMemo } from 'react';
import { Container, Card, Table, Button, Spinner, Dropdown, Row, Col, Form } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Search, Trash2, Pencil, Bot, Clock } from 'lucide-react';
import { useAuth } from '../Providers/AuthProvider';
import { PageHeader } from '../Components/PageHeader';
import { StickyToolbar } from '../Components/StickyToolbar';
import type { AttributeValue } from '@aws-sdk/client-dynamodb';

const PAGE_SIZE = 50;

type ConversationMeta = {
  conversation_id: string;
  conversationName?: string | null;
  latestTimestamp: number;
  agentId?: string | null;
  agentTitle?: string | null;
  isAgentConversation?: boolean;
  isWorkspaceConversation?: boolean;
};

const ChatHistoryPage = () => {
  const { t, i18n } = useTranslation('chat');
  const navigate = useNavigate();
  const { user, numaChatDynamoUtils } = useAuth();
  const sub = user?.decoded_tokens?.idToken?.sub;

  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationMeta[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [cursor, setCursor] = useState<Record<string, AttributeValue> | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterAgent, setFilterAgent] = useState('all');
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');

  const fetchConversations = useCallback(async () => {
    if (!numaChatDynamoUtils || !user) return;
    setIsLoading(true);
    setHasMore(true);
    setCursor(null);
    try {
      const userId = sub || 'anonymous';
      let startTimestamp: number | undefined;
      let endTimestamp: number | undefined;

      // When date filters change, we pass them directly down to the DynamoDB query
      if (filterStartDate) {
        startTimestamp = new Date(`${filterStartDate}T00:00:00`).getTime();
      }
      if (filterEndDate) {
        endTimestamp = new Date(`${filterEndDate}T23:59:59.999`).getTime();
      }

      const result = await numaChatDynamoUtils.getUserConversationsMetaPaginated(userId, PAGE_SIZE, null, {
        startTimestamp,
        endTimestamp,
      });
      const sorted = [...result.conversations].sort(
        (a, b) => (b.latestTimestamp as number) - (a.latestTimestamp as number)
      ) as ConversationMeta[];
      setConversations(sorted);
      setCursor(result.lastEvaluatedKey);
      setHasMore(result.hasMore);
      setLocalError(null);
    } catch (error) {
      console.error('Failed to load history on standalone page:', error);
      setLocalError(t('history.loadFailed', 'Failed to load conversations.'));
    } finally {
      setIsLoading(false);
    }
  }, [numaChatDynamoUtils, user, sub, t, filterStartDate, filterEndDate]);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  const loadMoreConversations = useCallback(async () => {
    if (!numaChatDynamoUtils || !user || isLoadingMore || !hasMore || !cursor) return;
    setIsLoadingMore(true);
    try {
      const userId = sub || 'anonymous';
      let startTimestamp: number | undefined;
      let endTimestamp: number | undefined;

      if (filterStartDate) {
        startTimestamp = new Date(`${filterStartDate}T00:00:00`).getTime();
      }
      if (filterEndDate) {
        endTimestamp = new Date(`${filterEndDate}T23:59:59.999`).getTime();
      }

      const result = await numaChatDynamoUtils.getUserConversationsMetaPaginated(userId, PAGE_SIZE, cursor, {
        startTimestamp,
        endTimestamp,
      });
      const newItems = [...result.conversations].sort(
        (a, b) => (b.latestTimestamp as number) - (a.latestTimestamp as number)
      ) as ConversationMeta[];
      setConversations((prev) => [...prev, ...newItems]);
      setCursor(result.lastEvaluatedKey);
      setHasMore(result.hasMore);
    } catch (error) {
      console.error('Error loading more conversations:', error);
      setHasMore(false);
    } finally {
      setIsLoadingMore(false);
    }
  }, [numaChatDynamoUtils, user, sub, cursor, isLoadingMore, hasMore, filterStartDate, filterEndDate]);

  const handleRename = async (conversationId: string, currentName?: string | null) => {
    const newName = prompt(t('history.renamePrompt', 'Enter a new name:'), currentName || '');
    if (newName === null) return;
    if (!numaChatDynamoUtils) return;
    try {
      await numaChatDynamoUtils.updateConversationName(conversationId, sub, newName, 'manual');
      fetchConversations();
    } catch (error) {
      console.error('Error renaming conversation:', error);
      setLocalError(t('history.renameFailed', 'Failed to rename conversation.'));
    }
  };

  const handleDelete = async (conversationId: string) => {
    if (!numaChatDynamoUtils) return;
    if (!window.confirm(t('history.deleteConfirm', 'Are you sure you want to delete this conversation?'))) return;
    try {
      await numaChatDynamoUtils.deleteConversation(conversationId, sub);
      fetchConversations();
    } catch (error) {
      console.error('Error deleting conversation:', error);
      setLocalError(t('history.deleteFailed', 'Failed to delete conversation.'));
    }
  };

  const formatDateTime = (timestamp: number) => {
    try {
      return new Date(timestamp).toLocaleString(i18n.language, {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      });
    } catch {
      return '';
    }
  };

  const agentOptions = useMemo(() => {
    const agents = new Set<string>();
    conversations.forEach((c) => {
      if (c.agentTitle) agents.add(c.agentTitle);
    });
    return Array.from(agents).sort();
  }, [conversations]);

  const filteredConversations = conversations.filter((c) => {
    const name = (c.conversationName || t('history.untitled', 'Untitled')).toLowerCase();
    const agent = (c.agentTitle || '').toLowerCase();
    const matchesSearch = name.includes(searchTerm.toLowerCase()) || agent.includes(searchTerm.toLowerCase());

    const matchesAgent = filterAgent === 'all' || c.agentTitle === filterAgent;

    let matchesDate = true;
    if (filterStartDate || filterEndDate) {
      const convoyDateStr = new Date(c.latestTimestamp);
      const year = convoyDateStr.getFullYear();
      const month = String(convoyDateStr.getMonth() + 1).padStart(2, '0');
      const day = String(convoyDateStr.getDate()).padStart(2, '0');
      const formattedDate = `${year}-${month}-${day}`;

      if (filterStartDate && formattedDate < filterStartDate) {
        matchesDate = false;
      }
      if (filterEndDate && formattedDate > filterEndDate) {
        matchesDate = false;
      }
    }

    return matchesSearch && matchesAgent && matchesDate;
  });

  return (
    <div className="dashboard job-history-page" data-testid="layout-dashboard">
      <PageHeader
        title={t('chatHistory', 'Recent Chats')}
        subtitle={t('chatHistory.subtitle', 'View your conversation history')}
        actionsClassName="job-history-header-actions"
        actions={
          <Button
            variant="secondary"
            onClick={fetchConversations}
            disabled={isLoading}
            className="standard-refresh-btn ms-auto"
          >
            {isLoading ? (
              <>
                <Spinner animation="border" size="sm" className="me-2" />
                <span className="standard-refresh-btn__label">{t('history.loading', 'Loading...')}</span>
              </>
            ) : (
              <>
                <Clock size={16} className="standard-refresh-btn__icon" aria-hidden="true" />
                <span className="standard-refresh-btn__label">{t('history.refresh', 'Refresh')}</span>
              </>
            )}
          </Button>
        }
      />
      <Container fluid className="job-history-content mt-4">
        <StickyToolbar className="job-history-toolbar">
          <Row className="g-3 align-items-end mb-0 job-history-toolbar-row">
            <Col md={5}>
              <Form.Group className="job-history-search-group">
                <div className="position-relative">
                  <Form.Control
                    type="text"
                    placeholder={t('history.searchPlaceholder', 'Find a chat...')}
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    aria-label={t('history.searchPlaceholder', 'Find a chat...')}
                    className="job-history-search-input"
                  />
                  <Search className="job-history-search-icon" />
                </div>
              </Form.Group>
            </Col>
            <Col md={3}>
              <Form.Group>
                <Form.Select
                  value={filterAgent}
                  onChange={(e) => setFilterAgent(e.target.value)}
                  className="job-history-filter-select"
                  aria-label={t('history.filters.agent', 'Filter by agent')}
                >
                  <option value="all">{t('history.filters.allAgents', 'All Agents')}</option>
                  {agentOptions.map((agentName) => (
                    <option key={agentName} value={agentName}>
                      {agentName}
                    </option>
                  ))}
                </Form.Select>
              </Form.Group>
            </Col>
            <Col md={4}>
              <Form.Group>
                <div className="d-flex align-items-center">
                  <Form.Control
                    type="date"
                    value={filterStartDate}
                    onChange={(e) => setFilterStartDate(e.target.value)}
                    className="job-history-filter-select me-2"
                    aria-label={t('history.filters.startDate', 'Filter from start date')}
                  />
                  <span className="me-2 text-muted fw-medium">-</span>
                  <Form.Control
                    type="date"
                    value={filterEndDate}
                    onChange={(e) => setFilterEndDate(e.target.value)}
                    className="job-history-filter-select"
                    aria-label={t('history.filters.endDate', 'Filter to end date')}
                  />
                </div>
              </Form.Group>
            </Col>
          </Row>
        </StickyToolbar>

        {localError && <div className="alert alert-danger mx-3 mt-3">{localError}</div>}

        <Card className="job-history-table-card mt-3">
          <Card.Body className="p-0">
            {isLoading && conversations.length === 0 ? (
              <div className="text-center p-4">
                <div className="spinner-border text-primary">
                  <span className="visually-hidden">{t('history.loading', 'Loading...')}</span>
                </div>
              </div>
            ) : filteredConversations.length === 0 ? (
              <div className="text-center bg-light rounded p-4">
                <p className="mb-0 text-muted">{t('history.empty', 'No conversations found.')}</p>
              </div>
            ) : (
              <div className="table-responsive file-table-container scrollable">
                <Table hover className="mb-0 file-table auto-layout job-history-table">
                  <thead className="sticky-table-header numa-table-header">
                    <tr>
                      <th style={{ width: '40%' }}>{t('history.headers.name', 'Conversation')}</th>
                      <th>{t('history.headers.agent', 'Agent')}</th>
                      <th>{t('history.headers.lastUpdated', 'Last Updated')}</th>
                      <th style={{ width: '150px' }} className="text-end">
                        {t('history.headers.actions', 'Actions')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredConversations.map((convo) => (
                      <tr key={convo.conversation_id} className="align-middle">
                        <td>
                          <div className="fw-medium text-break">
                            {convo.conversationName || t('history.untitled', 'Untitled')}
                          </div>
                        </td>
                        <td>
                          {convo.isAgentConversation && convo.agentTitle ? (
                            <div className="d-flex align-items-center">
                              <Bot size={14} className="me-2" />
                              {convo.agentTitle}
                            </div>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td>
                          <div className="text-muted small">{formatDateTime(convo.latestTimestamp)}</div>
                        </td>
                        <td className="text-end align-middle pe-3">
                          <Button
                            variant="primary"
                            size="sm"
                            className="me-2"
                            onClick={() => {
                              sessionStorage.setItem('currentConversationId-v2', convo.conversation_id);
                              sessionStorage.setItem(
                                'isWorkspaceConversation-v2',
                                convo.isWorkspaceConversation === false ? 'false' : 'true'
                              );
                              // Flag this as an explicit selection so useConversationManager
                              // honors it unconditionally (bypassing inactivity + top-100-meta gates).
                              sessionStorage.setItem('pendingConversationSelect-v2', '1');
                              navigate('/chat');
                            }}
                          >
                            {t('history.actions.resume', 'Open')}
                          </Button>
                          <Dropdown align="end" className="d-inline-block">
                            <Dropdown.Toggle variant="light" size="sm" className="btn-icon">
                              <span className="visually-hidden">{t('history.actions', 'Actions')}</span>
                            </Dropdown.Toggle>
                            <Dropdown.Menu>
                              <Dropdown.Item
                                onClick={() => handleRename(convo.conversation_id, convo.conversationName)}
                              >
                                <Pencil size={14} className="me-2" />
                                {t('history.actions.rename', 'Rename')}
                              </Dropdown.Item>
                              <Dropdown.Divider />
                              <Dropdown.Item
                                onClick={() => handleDelete(convo.conversation_id)}
                                className="text-danger"
                              >
                                <Trash2 size={14} className="me-2" />
                                {t('history.actions.delete', 'Delete')}
                              </Dropdown.Item>
                            </Dropdown.Menu>
                          </Dropdown>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
                {hasMore && (
                  <div className="text-center p-3 border-top bg-light">
                    <Button variant="link" onClick={loadMoreConversations} disabled={isLoadingMore}>
                      {isLoadingMore ? <Spinner animation="border" size="sm" /> : t('history.loadMore', 'Load More')}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </Card.Body>
        </Card>
      </Container>
    </div>
  );
};

export default ChatHistoryPage;
