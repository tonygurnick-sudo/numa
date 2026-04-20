import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Breadcrumb,
  Button,
  Card,
  Col,
  Form,
  InputGroup,
  ListGroup,
  Row,
  Spinner,
} from 'react-bootstrap';
import { ArrowLeft, ChatDots, Clock, GeoAlt, PersonFill, Robot, Search, Tools } from 'react-bootstrap-icons';
import { Link, useNavigate, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { clientService } from '@/services/clientService';
import {
  attachIpsToConversations,
  fetchConversationTrace,
  fetchProxyRequestEvents,
  listPublicDemoConversations,
} from '@/services/publicDemoConversationsService';
import type { Client } from '@/types';
import type { ConversationDetail, ConversationSummary, ParsedTraceEvent } from '@/types/publicDemoConversation';

function formatRelative(iso: string): string {
  if (!iso) return '';
  const now = Date.now();
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diffMs = now - then;
  const mins = Math.round(diffMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleString();
}

function formatAbsolute(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function MessageMarkdown({ text }: { text: string }) {
  // Render markdown while preserving line breaks. Paragraphs and list items
  // get no external margin since the bubble already has padding; inline code
  // gets a subtle tint so it pops against either bubble background.
  return (
    <div className="message-md">
      <ReactMarkdown
        components={{
          p: ({ children }) => <p className="mb-2">{children}</p>,
          ul: ({ children }) => <ul className="mb-2 ps-4">{children}</ul>,
          ol: ({ children }) => <ol className="mb-2 ps-4">{children}</ol>,
          li: ({ children }) => <li className="mb-1">{children}</li>,
          code: ({ children, ...props }) => {
            // inline vs block code
            const isInline = !props.className;
            if (isInline) {
              return (
                <code
                  style={{
                    background: 'rgba(0, 0, 0, 0.08)',
                    padding: '0.1rem 0.3rem',
                    borderRadius: 3,
                    fontSize: '0.85em',
                  }}
                >
                  {children}
                </code>
              );
            }
            return (
              <code
                style={{
                  display: 'block',
                  background: 'rgba(0, 0, 0, 0.08)',
                  padding: '0.5rem 0.75rem',
                  borderRadius: 6,
                  fontSize: '0.85em',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {children}
              </code>
            );
          },
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'inherit', textDecoration: 'underline' }}
            >
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

function EventRow({ event }: { event: ParsedTraceEvent }) {
  if (event.kind === 'user') {
    return (
      <div className="d-flex justify-content-end mb-3">
        <div
          className="p-3 rounded"
          style={{
            background: '#7c3aed',
            color: 'white',
            maxWidth: '80%',
            wordBreak: 'break-word',
          }}
        >
          <div className="small opacity-75 mb-1 d-flex align-items-center">
            <PersonFill size={12} className="me-1" />
            Visitor
            <span className="ms-2">{formatRelative(event.timestamp)}</span>
          </div>
          <MessageMarkdown text={event.text} />
        </div>
      </div>
    );
  }
  if (event.kind === 'assistant') {
    return (
      <div className="d-flex justify-content-start mb-3">
        <div
          className="p-3 rounded border"
          style={{
            background: '#f8f9fa',
            maxWidth: '85%',
            wordBreak: 'break-word',
          }}
        >
          <div className="small text-muted mb-1 d-flex align-items-center">
            <Robot size={12} className="me-1" />
            Numa
            <span className="ms-2">{formatRelative(event.timestamp)}</span>
          </div>
          <MessageMarkdown text={event.text} />
        </div>
      </div>
    );
  }
  // tool_call
  return (
    <div className="d-flex justify-content-start mb-2">
      <div
        className="px-2 py-1 rounded small d-flex align-items-center"
        style={{ background: '#eef2ff', color: '#4338ca', fontFamily: 'monospace', fontSize: '0.78rem' }}
      >
        <Tools size={12} className="me-2" />
        <span className="fw-bold me-2">{event.toolName}</span>
        <span className="text-muted text-truncate" style={{ maxWidth: '520px' }}>
          {event.paramsSummary}
        </span>
      </div>
    </div>
  );
}

export default function PublicDemoConversations() {
  const { clientName } = useParams<{ clientName: string }>();
  const navigate = useNavigate();

  const [client, setClient] = useState<Client | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // Load the client record + its conversations.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!clientName) return;
      setLoadingList(true);
      setListError(null);
      try {
        const allClients = await clientService.getAllClients();
        const match = allClients.find((c) => c.name === clientName);
        if (!match) {
          throw new Error(`Client "${clientName}" not found`);
        }
        if (!match.config.publicDemo) {
          throw new Error(`Client "${clientName}" is not flagged as a public demo`);
        }
        if (cancelled) return;
        setClient(match);
        const [list, proxyEvents] = await Promise.all([
          listPublicDemoConversations(match),
          // Best-effort — if the Insights query fails, carry on without IPs.
          fetchProxyRequestEvents(match, 30).catch((err) => {
            console.warn('[PublicDemoConversations] IP enrichment failed:', err);
            return [];
          }),
        ]);
        if (cancelled) return;
        const enriched = attachIpsToConversations(list, proxyEvents);
        setConversations(enriched);
        if (enriched.length > 0) setSelectedId(enriched[0].conversationId);
      } catch (e) {
        if (cancelled) return;
        setListError(e instanceof Error ? e.message : 'Failed to load conversations');
      } finally {
        if (!cancelled) setLoadingList(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [clientName]);

  // Load the selected conversation's trace.
  const loadDetail = useCallback(
    async (id: string) => {
      if (!client) return;
      setLoadingDetail(true);
      setDetailError(null);
      setDetail(null);
      try {
        const d = await fetchConversationTrace(client, id);
        setDetail(d);
      } catch (e) {
        setDetailError(e instanceof Error ? e.message : 'Failed to load conversation');
      } finally {
        setLoadingDetail(false);
      }
    },
    [client]
  );

  useEffect(() => {
    if (selectedId) loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter(
      (c) => c.conversationId.toLowerCase().includes(q) || (c.sourceIp ?? '').toLowerCase().includes(q)
    );
  }, [conversations, search]);

  const selectedSummary = useMemo(
    () => conversations.find((c) => c.conversationId === selectedId),
    [conversations, selectedId]
  );

  return (
    <div>
      <Breadcrumb className="mb-3">
        <Breadcrumb.Item linkAs={Link} linkProps={{ to: '/' }}>
          Dashboard
        </Breadcrumb.Item>
        <Breadcrumb.Item active>Public Demo Conversations</Breadcrumb.Item>
      </Breadcrumb>

      <div className="d-flex align-items-center mb-3">
        <Button variant="link" className="p-0 me-3" onClick={() => navigate(-1)}>
          <ArrowLeft /> Back
        </Button>
        <div>
          <h3 className="mb-0">Public Demo Conversations</h3>
          <div className="text-muted small">{clientName} · newest first · user + assistant messages and tool calls</div>
        </div>
      </div>

      {listError && (
        <Alert variant="danger" className="mb-3">
          {listError}
        </Alert>
      )}

      <Row className="g-3">
        {/* ── Left: conversation list ─────────────────────────── */}
        <Col md={5} lg={4}>
          <Card className="border-0 shadow-sm">
            <Card.Body className="p-3">
              <InputGroup className="mb-3">
                <InputGroup.Text>
                  <Search />
                </InputGroup.Text>
                <Form.Control
                  placeholder="Search by ID or IP"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </InputGroup>

              {loadingList ? (
                <div className="text-center p-4">
                  <Spinner animation="border" size="sm" />
                </div>
              ) : filtered.length === 0 ? (
                <div className="text-muted text-center p-4">
                  {conversations.length === 0 ? 'No conversations yet.' : 'No matches.'}
                </div>
              ) : (
                <ListGroup variant="flush" style={{ maxHeight: 'calc(100vh - 260px)', overflowY: 'auto' }}>
                  {filtered.map((c) => {
                    const active = c.conversationId === selectedId;
                    return (
                      <ListGroup.Item
                        key={c.conversationId}
                        action
                        active={active}
                        onClick={() => setSelectedId(c.conversationId)}
                        className="px-2 py-2"
                      >
                        <div className="d-flex justify-content-between align-items-start">
                          <div className="small fw-bold" style={{ fontFamily: 'monospace' }}>
                            {c.conversationId.slice(0, 8)}
                            <span className="opacity-50">…</span>
                          </div>
                          <Badge bg={active ? 'light' : 'secondary'} text={active ? 'dark' : undefined}>
                            {(c.traceBytes / 1024).toFixed(1)} KB
                          </Badge>
                        </div>
                        <div className={`small ${active ? '' : 'text-muted'} mt-1 d-flex align-items-center`}>
                          <Clock size={10} className="me-1" />
                          {formatRelative(c.lastModified)}
                          <span className="mx-2">·</span>
                          {formatAbsolute(c.lastModified)}
                        </div>
                        {c.sourceIp && (
                          <div
                            className={`small ${active ? '' : 'text-muted'} mt-1 d-flex align-items-center`}
                            style={{ fontFamily: 'monospace', fontSize: '0.72rem' }}
                          >
                            <GeoAlt size={10} className="me-1" />
                            {c.sourceIp}
                          </div>
                        )}
                      </ListGroup.Item>
                    );
                  })}
                </ListGroup>
              )}

              <div className="text-muted small mt-3">
                Showing {filtered.length} of {conversations.length}
              </div>
            </Card.Body>
          </Card>
        </Col>

        {/* ── Right: conversation detail ──────────────────────── */}
        <Col md={7} lg={8}>
          <Card className="border-0 shadow-sm" style={{ minHeight: 'calc(100vh - 220px)' }}>
            <Card.Body className="p-3">
              {!selectedId ? (
                <div className="text-muted text-center p-5">
                  <ChatDots size={32} className="mb-3" />
                  <div>Select a conversation to view its messages.</div>
                </div>
              ) : loadingDetail ? (
                <div className="text-center p-5">
                  <Spinner animation="border" />
                </div>
              ) : detailError ? (
                <Alert variant="danger">{detailError}</Alert>
              ) : detail ? (
                <>
                  <div className="d-flex justify-content-between align-items-center mb-3 pb-3 border-bottom">
                    <div>
                      <div className="small text-muted">Conversation</div>
                      <div className="fw-bold" style={{ fontFamily: 'monospace' }}>
                        {detail.conversationId}
                      </div>
                      {selectedSummary?.sourceIp && (
                        <div
                          className="small text-muted mt-1 d-flex align-items-center"
                          style={{ fontFamily: 'monospace' }}
                        >
                          <GeoAlt size={12} className="me-1" />
                          {selectedSummary.sourceIp}
                        </div>
                      )}
                    </div>
                    <div className="text-end">
                      <div className="small text-muted">Events</div>
                      <div className="fw-bold">
                        {detail.events.filter((e) => e.kind === 'user').length} user ·{' '}
                        {detail.events.filter((e) => e.kind === 'assistant').length} assistant ·{' '}
                        {detail.events.filter((e) => e.kind === 'tool_call').length} tool calls
                      </div>
                    </div>
                  </div>
                  <div>
                    {detail.events.length === 0 ? (
                      <div className="text-muted text-center p-4">
                        Trace has no surfaced events (user/assistant/tool).
                      </div>
                    ) : (
                      detail.events.map((ev, i) => <EventRow key={i} event={ev} />)
                    )}
                  </div>
                </>
              ) : null}
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
