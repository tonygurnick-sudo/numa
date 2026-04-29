import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Button, Form, Alert, Row, Col, Badge, Container, InputGroup, Collapse } from 'react-bootstrap';
import { ArrowLeft, Search, Download, Funnel, X } from 'react-bootstrap-icons';
import { clientService } from '@/services/clientService';
import { FileExportService } from '@/utils/fileExport';
import type { Client, ClientConfig } from '@/types';
import type { ToolResultFile } from '@/types/tools';

interface MatchDetail {
  label: string;
  value?: string;
  status: 'matched' | 'missing';
}

interface SearchResult {
  clientName: string;
  matchedFields: string[];
  matchDetails: MatchDetail[];
  config: ClientConfig;
  isDev: boolean;
  accountId?: string;
}

// Predefined quick filters
// matchType: 'equals' (default) - exact match, 'exists' - field is defined and truthy
const QUICK_FILTERS = [
  { label: 'Has Agents', field: 'agents', value: true },
  { label: 'Has Integrations', field: 'pipedreamIntegrations', value: true },
  { label: 'All Prod Apps', field: 'allProdApps', value: true },
  { label: 'Dev Instances', field: 'devInstance', value: true },
  { label: 'Q Business', field: 'provisionQResources', value: true },
  { label: 'Bedrock KB', field: 'preferredKnowledgeBase', value: 'bedrock' },
  { label: 'Allows Quota Sharing', field: 'allowBedrockQuotaSharing', value: true },
  { label: 'Consuming Quota', field: 'bedrockAccount', value: true, matchType: 'exists' as const },
];

export default function ConfigSearchTool() {
  const navigate = useNavigate();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [expandedClient, setExpandedClient] = useState<string | null>(null);

  // Load clients on mount
  useEffect(() => {
    loadClients();
  }, []);

  const loadClients = async () => {
    setLoading(true);
    setError(null);
    try {
      const allClients = await clientService.getAllClients();
      setClients(allClients);
    } catch (err) {
      console.error('Failed to load clients:', err);
      setError('Failed to load client configurations. Please check your permissions.');
    } finally {
      setLoading(false);
    }
  };

  // Search and filter logic
  const searchResults = useMemo((): SearchResult[] => {
    const findAppMatches = (config: ClientConfig, value: string) => {
      const apps = (config.apps || {}) as Record<string, unknown>;
      const target = value.toLowerCase();
      const matches = Object.keys(apps).filter((appName) => appName.toLowerCase().includes(target));
      const allAppsEnabled = config.allApps === true || config.allProdApps === true;
      return { matches, allAppsEnabled };
    };

    const stringifyLower = (value: unknown): string => {
      try {
        return JSON.stringify(value).toLowerCase();
      } catch {
        return '';
      }
    };

    const formatValue = (value: unknown): string => {
      if (value === undefined || value === null) return '';
      if (typeof value === 'object') return JSON.stringify(value);
      return String(value);
    };

    const unquote = (value: string): string => {
      const trimmed = value.trim();
      if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
        return trimmed.slice(1, -1);
      }
      return trimmed;
    };

    const splitFieldQuery = (expr: string): { field: string; value: string; op: '=' | '==' } | null => {
      const idxDouble = expr.indexOf('==');
      if (idxDouble !== -1) {
        const field = expr.slice(0, idxDouble).trim();
        const value = expr.slice(idxDouble + 2).trim();
        if (!field) return null;
        return { field, value, op: '==' };
      }

      const idx = expr.indexOf('=');
      if (idx === -1) return null;
      const field = expr.slice(0, idx).trim();
      const value = expr.slice(idx + 1).trim();
      if (!field) return null;
      return { field, value, op: '=' };
    };

    const rawQuery = searchQuery.trim();
    const tokens = rawQuery
      .split(/[\n,]+/)
      .map((t) => t.trim())
      .filter(Boolean);

    const results: SearchResult[] = [];

    for (const client of clients) {
      const configKeyByLower = new Map<string, string>(
        Object.keys(client.config || {}).map((k) => [k.toLowerCase(), k])
      );
      const matchedFields = new Set<string>();
      const matchDetails: MatchDetail[] = [];
      let matches = true;

      // Apply quick filters (AND logic)
      if (activeFilters.size > 0) {
        for (const filterLabel of activeFilters) {
          const filter = QUICK_FILTERS.find((f) => f.label === filterLabel);
          if (filter) {
            const configValue = client.config[filter.field as keyof ClientConfig];
            const matchType = 'matchType' in filter ? filter.matchType : 'equals';

            let filterMatched = false;
            if (matchType === 'exists') {
              // Check if field exists and is truthy
              filterMatched = configValue !== undefined && configValue !== null && configValue !== '';
            } else {
              // Default: exact value match
              filterMatched = configValue === filter.value;
            }

            if (!filterMatched) {
              matches = false;
              break;
            } else {
              matchedFields.add(filter.field);
              matchDetails.push({
                label: filter.label,
                value: formatValue(configValue),
                status: 'matched',
              });
            }
          }
        }
      }

      if (!matches) continue;

      // Apply text search
      if (tokens.length > 0) {
        for (const token of tokens) {
          const isNegative = token.startsWith('!');
          const base = isNegative ? token.slice(1).trim() : token;
          if (!base) continue;
          const query = base.trim();

          const fieldQuery = splitFieldQuery(query);
          if (fieldQuery) {
            const rawField = fieldQuery.field;
            const rawValue = unquote(fieldQuery.value);
            const fieldLower = rawField.toLowerCase();
            const valueLower = rawValue.toLowerCase();
            const resolvedField = configKeyByLower.get(fieldLower) || rawField;
            const configValue = client.config[resolvedField as keyof ClientConfig];
            const isExact = fieldQuery.op === '==';

            let fieldMatched = false;
            if (fieldLower === 'apps' || fieldLower === 'app') {
              const { matches: appMatches, allAppsEnabled } = findAppMatches(client.config, rawValue);
              fieldMatched = appMatches.length > 0 || allAppsEnabled;
              if (!isNegative && fieldMatched) {
                matchedFields.add(`apps=${rawValue}`);
                matchDetails.push({
                  label: `apps contains "${rawValue}"`,
                  value: [allAppsEnabled ? 'All apps enabled' : null, ...appMatches].filter(Boolean).join(', '),
                  status: 'matched',
                });
              }
            } else if (fieldLower === 'client' || fieldLower === 'name') {
              fieldMatched = client.name.toLowerCase().includes(valueLower);
              if (!isNegative && fieldMatched) {
                matchedFields.add(`client=${rawValue}`);
                matchDetails.push({
                  label: `Client name includes "${rawValue}"`,
                  value: client.name,
                  status: 'matched',
                });
              }
            } else {
              if (configValue !== undefined) {
                if (typeof configValue === 'boolean') {
                  fieldMatched =
                    (valueLower === 'true' && configValue === true) ||
                    (valueLower === 'false' && configValue === false);
                } else if (typeof configValue === 'number') {
                  const parsed = Number(rawValue);
                  fieldMatched = !Number.isNaN(parsed) && configValue === parsed;
                } else if (typeof configValue === 'string') {
                  const candidate = configValue.toLowerCase();
                  fieldMatched = isExact ? candidate === valueLower : candidate.includes(valueLower);
                } else {
                  fieldMatched = stringifyLower(configValue).includes(valueLower);
                }
              }
              if (!isNegative && fieldMatched) {
                matchedFields.add(`${resolvedField}${fieldQuery.op}${rawValue}`);
                matchDetails.push({
                  label: `${resolvedField}${fieldQuery.op}${rawValue}`,
                  value: formatValue(configValue),
                  status: 'matched',
                });
              }
            }

            if (isNegative) {
              if (fieldMatched) {
                matches = false;
                break;
              } else {
                matchedFields.add(`!${resolvedField}${fieldQuery.op}${rawValue}`);
                matchDetails.push({
                  label: `${resolvedField}${fieldQuery.op}${rawValue}`,
                  value: 'does not have',
                  status: 'missing',
                });
              }
            } else if (!fieldMatched) {
              matches = false;
              break;
            }
          } else {
            const queryLower = query.toLowerCase();

            // Free text search - search entire config JSON (keys + values), plus client name
            const clientNameMatches = client.name.toLowerCase().includes(queryLower);
            const configJsonStr = stringifyLower(client.config);
            const textMatched = configJsonStr.includes(queryLower) || clientNameMatches;

            if (isNegative) {
              if (textMatched) {
                matches = false;
                break;
              } else {
                matchedFields.add(`!${base}`);
                matchDetails.push({
                  label: `Contains "${base}"`,
                  value: 'does not have',
                  status: 'missing',
                });
              }
            } else {
              if (textMatched) {
                matchedFields.add(base);
                matchDetails.push({
                  label: `Contains "${base}"`,
                  value: clientNameMatches ? client.name : base,
                  status: 'matched',
                });
              } else {
                matches = false;
                break;
              }
            }
          }
        }
      }

      if (matches) {
        results.push({
          clientName: client.name,
          matchedFields: [...new Set(matchedFields)],
          matchDetails,
          config: client.config,
          isDev: client.config.devInstance === true,
          accountId: client.config.clientAccountId,
        });
      }
    }

    // Sort by client name
    return results.sort((a, b) => a.clientName.localeCompare(b.clientName));
  }, [clients, searchQuery, activeFilters]);

  const toggleFilter = (filterLabel: string) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(filterLabel)) {
        next.delete(filterLabel);
      } else {
        next.add(filterLabel);
      }
      return next;
    });
  };

  const clearFilters = () => {
    setActiveFilters(new Set());
    setSearchQuery('');
  };

  const handleExportCSV = () => {
    if (searchResults.length === 0) return;

    const headers = [
      'Client Name',
      'Is Dev',
      'Region',
      'Account ID',
      'Matched Fields',
      'Apps',
      'Agents',
      'Integrations',
      'All Prod Apps',
      'Numa Files backend',
    ];
    const rows = searchResults.map((r) => [
      r.clientName,
      r.isDev ? 'Yes' : 'No',
      r.config.region || '',
      r.accountId || '',
      (r.matchDetails.length > 0 ? r.matchDetails : r.matchedFields.map((label) => ({ label }) as MatchDetail))
        .map((md) => md.label)
        .join('; '),
      Object.keys(r.config.apps || {}).join('; '),
      r.config.agents ? 'Yes' : 'No',
      r.config.pipedreamIntegrations ? 'Yes' : 'No',
      r.config.allProdApps ? 'Yes' : 'No',
      r.config.preferredKnowledgeBase || 'bedrock',
    ]);

    const csv = [
      headers.join(','),
      ...rows.map((row) => row.map((cell) => (String(cell).includes(',') ? `"${cell}"` : cell)).join(',')),
    ].join('\n');

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const file: ToolResultFile = {
      name: `config-search-results-${timestamp}.csv`,
      content: csv,
      mimeType: 'text/csv',
      size: new Blob([csv]).size,
    };

    FileExportService.downloadFile(file);
  };

  const hasActiveSearch = Boolean(searchQuery.trim() || activeFilters.size > 0 || searchResults.length > 0);

  return (
    <Container fluid>
      {/* Header */}
      <div className="d-flex align-items-center mb-4">
        <Button variant="secondary" onClick={() => navigate('/tools')} className="me-3">
          <ArrowLeft className="me-1" />
          Back to Tools
        </Button>
        <div>
          <div className="d-flex align-items-center">
            <Search className="me-2 text-primary" size={24} />
            <h2 className="mb-0">Config Search</h2>
          </div>
          <p className="text-muted mb-0">Search client configurations by keyword or filter by feature flags</p>
        </div>
      </div>

      {error && (
        <Alert variant="danger" dismissible onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Row>
        {/* Search Panel */}
        <Col lg={4}>
          <Card className="border-0 shadow-sm mb-4">
            <Card.Header className="bg-primary text-white">
              <h5 className="mb-0">Search & Filter</h5>
            </Card.Header>
            <Card.Body>
              {/* Text Search */}
              <Form.Group className="mb-4">
                <Form.Label>Search Query</Form.Label>
                <InputGroup>
                  <Form.Control
                    type="text"
                    placeholder='e.g., "agents=true" or "production"'
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    disabled={loading}
                  />
                  {searchQuery && (
                    <Button variant="outline-secondary" onClick={() => setSearchQuery('')}>
                      <X />
                    </Button>
                  )}
                </InputGroup>
                <Form.Text className="text-muted">
                  Use <code>field=value</code> for match (strings are partial), or <code>field==value</code> for exact.
                  Field names are case-insensitive. Free text searches the full config JSON (keys + values). Prefix with{' '}
                  <code>!</code> to exclude (e.g., <code>!agents==true</code> or <code>!production</code>). Use{' '}
                  <code>apps=name</code> to match app keys. Separate multiple terms with commas or new lines (AND
                  logic).
                </Form.Text>
              </Form.Group>

              {/* Quick Filters */}
              <Form.Group className="mb-4">
                <Form.Label className="d-flex align-items-center">
                  <Funnel className="me-2" />
                  Quick Filters
                </Form.Label>
                <div className="d-flex flex-wrap gap-2">
                  {QUICK_FILTERS.map((filter) => (
                    <Badge
                      key={filter.label}
                      bg={activeFilters.has(filter.label) ? 'primary' : 'light'}
                      text={activeFilters.has(filter.label) ? 'white' : 'dark'}
                      className="cursor-pointer py-2 px-3"
                      style={{ cursor: 'pointer' }}
                      onClick={() => toggleFilter(filter.label)}
                    >
                      {filter.label}
                      {activeFilters.has(filter.label) && <X className="ms-1" size={12} />}
                    </Badge>
                  ))}
                </div>
              </Form.Group>

              {/* Actions */}
              <div className="d-grid gap-2">
                {hasActiveSearch && (
                  <Button variant="outline-secondary" onClick={clearFilters}>
                    Clear All Filters
                  </Button>
                )}
              </div>

              {/* Stats */}
              <div className="mt-4 pt-3 border-top">
                <small className="text-muted">
                  {loading ? (
                    'Loading clients...'
                  ) : (
                    <>
                      {clients.length} total clients
                      {hasActiveSearch && <> &bull; {searchResults.length} matching</>}
                    </>
                  )}
                </small>
              </div>
            </Card.Body>
          </Card>
        </Col>

        {/* Results Panel */}
        <Col lg={8}>
          <Card className="border-0 shadow-sm">
            <Card.Header className="d-flex justify-content-between align-items-center">
              <h5 className="mb-0">
                {hasActiveSearch ? `Search Results (${searchResults.length})` : 'Search Results'}
              </h5>
              {searchResults.length > 0 && (
                <Button variant="outline-success" size="sm" onClick={handleExportCSV}>
                  <Download className="me-1" />
                  Export CSV
                </Button>
              )}
            </Card.Header>
            <Card.Body>
              {loading && (
                <div className="text-center py-5">
                  <div className="spinner-border text-primary" role="status">
                    <span className="visually-hidden">Loading...</span>
                  </div>
                  <p className="mt-2 text-muted">Loading client configurations...</p>
                </div>
              )}

              {!loading && !hasActiveSearch && (
                <div className="text-center text-muted py-5">
                  <Search size={48} className="mb-3" />
                  <h5>Enter a search query or select a filter</h5>
                  <p>
                    Examples: <code>agents=true</code>, <code>allProdApps=true</code>, or search for any text
                  </p>
                </div>
              )}

              {!loading && hasActiveSearch && searchResults.length === 0 && (
                <Alert variant="info">No clients match your search criteria.</Alert>
              )}

              {!loading && searchResults.length > 0 && (
                <div className="table-responsive" style={{ maxHeight: '70vh' }}>
                  <div className="d-flex flex-column gap-3">
                    {searchResults.map((result) => {
                      const isExpanded = expandedClient === result.clientName;
                      const matchDetails =
                        result.matchDetails.length > 0
                          ? result.matchDetails
                          : result.matchedFields.map((label) => ({ label, status: 'matched' as const }));

                      return (
                        <Card key={result.clientName} className="border shadow-sm">
                          <Card.Header className="d-flex justify-content-between align-items-center">
                            <div>
                              <div className="fw-semibold d-flex align-items-center gap-2">
                                <span>{result.clientName}</span>
                                {result.isDev && (
                                  <Badge bg="warning" text="dark">
                                    Dev
                                  </Badge>
                                )}
                              </div>
                              <div className="text-muted small">
                                Region: <code>{result.config.region || 'n/a'}</code> &bull; Account:{' '}
                                <code>{result.accountId || 'n/a'}</code>
                              </div>
                            </div>
                            <div className="d-flex align-items-center gap-2">
                              <Badge bg="light" text="dark">
                                {result.config.allApps || result.config.allProdApps
                                  ? 'All apps'
                                  : `${Object.keys(result.config.apps || {}).length} app(s)`}
                              </Badge>
                              <Button
                                variant={isExpanded ? 'outline-primary' : 'primary'}
                                size="sm"
                                onClick={() => setExpandedClient(isExpanded ? null : result.clientName)}
                                aria-expanded={isExpanded}
                              >
                                {isExpanded ? 'Hide details' : 'Show details'}
                              </Button>
                            </div>
                          </Card.Header>
                          <Card.Body>
                            <div className="mb-2 fw-semibold">Matched criteria</div>
                            {matchDetails.length === 0 && (
                              <small className="text-muted">Matched via quick filters.</small>
                            )}
                            <div className="d-flex flex-column gap-2">
                              {matchDetails.map((detail, idx) => (
                                <div key={idx} className="d-flex align-items-center gap-2">
                                  <Badge bg={detail.status === 'missing' ? 'secondary' : 'success'}>
                                    {detail.status === 'missing' ? 'Does not have' : 'Matched'}
                                  </Badge>
                                  <div>
                                    <div className="fw-semibold">{detail.label}</div>
                                    {detail.value && <small className="text-muted">{detail.value}</small>}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </Card.Body>
                          <Collapse in={isExpanded}>
                            <div>
                              <Card.Footer className="bg-light">
                                <Row className="g-3">
                                  <Col md={4}>
                                    <div className="fw-semibold mb-2">Client info</div>
                                    <div className="small">
                                      <div>
                                        <strong>Client:</strong> {result.clientName}
                                      </div>
                                      <div>
                                        <strong>Account ID:</strong> {result.accountId || 'n/a'}
                                      </div>
                                      <div>
                                        <strong>Region:</strong> {result.config.region || 'n/a'}
                                      </div>
                                      <div>
                                        <strong>Domain:</strong> {result.config.customDomain || 'n/a'}
                                      </div>
                                      <div>
                                        <strong>Numa Files backend:</strong>{' '}
                                        {result.config.preferredKnowledgeBase || 'bedrock'}
                                      </div>
                                      <div>
                                        <strong>Integrations:</strong>{' '}
                                        {result.config.pipedreamIntegrations ? 'Enabled' : 'Disabled'}
                                      </div>
                                      <div>
                                        <strong>Agents:</strong> {result.config.agents ? 'Enabled' : 'Disabled'}
                                      </div>
                                      <div>
                                        <strong>All Prod Apps:</strong> {result.config.allProdApps ? 'Yes' : 'No'}
                                      </div>
                                    </div>
                                  </Col>
                                  <Col md={8}>
                                    <div className="fw-semibold mb-2">Configuration JSON</div>
                                    <pre
                                      className="bg-dark text-white p-3 rounded"
                                      style={{ maxHeight: '40vh', overflow: 'auto' }}
                                    >
                                      {JSON.stringify(result.config, null, 2)}
                                    </pre>
                                  </Col>
                                </Row>
                              </Card.Footer>
                            </div>
                          </Collapse>
                        </Card>
                      );
                    })}
                  </div>
                </div>
              )}
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </Container>
  );
}
