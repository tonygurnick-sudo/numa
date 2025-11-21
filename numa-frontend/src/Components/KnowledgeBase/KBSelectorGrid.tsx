import React, { useState, useMemo } from 'react';
import { Row, Col, Card, Badge, Form, InputGroup } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';

interface UserKB {
  kb_id: string;
  kb_name: string;
  role: 'VIEWER' | 'EDITOR' | 'OWNER';
  document_count?: number;
  status?: string;
  created_at?: string;
  is_shared?: boolean; // Whether this KB is shared with other users
}

interface KBSelectorGridProps {
  kbs: UserKB[];
  isLoading?: boolean;
}

type FilterType = 'all' | 'shared' | 'personal';

/**
 * KBSelectorGrid Component
 * Displays a grid of KB cards for the user to select
 */
export function KBSelectorGrid({ kbs, isLoading = false }: KBSelectorGridProps): React.JSX.Element {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<FilterType>('all');

  function handleCardClick(kbId: string): void {
    navigate(`/user-knowledge-bases/${kbId}`);
  }

  // Determine if a KB is shared or personal
  // If role is VIEWER, it's definitely shared (someone else owns it)
  // If is_shared is explicitly set, use that value
  // Otherwise, default to personal for EDITOR role
  function isKBShared(kb: UserKB): boolean {
    if (kb.role === 'VIEWER') return true;
    return kb.is_shared ?? false;
  }

  // Filter and search KBs
  const filteredKBs = useMemo(() => {
    let result = kbs;

    // Apply filter
    if (filter === 'shared') {
      result = result.filter((kb) => isKBShared(kb));
    } else if (filter === 'personal') {
      result = result.filter((kb) => !isKBShared(kb));
    }

    // Apply search
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter((kb) => kb.kb_name.toLowerCase().includes(query));
    }

    return result;
  }, [kbs, filter, searchQuery]);

  if (isLoading) {
    return (
      <div className="text-center p-5">
        <div className="spinner-border text-primary">
          <span className="visually-hidden">Loading...</span>
        </div>
        <p className="mt-3 text-muted">Loading your knowledge bases...</p>
      </div>
    );
  }

  if (kbs.length === 0) {
    return (
      <div className="text-center p-5 bg-light rounded">
        <i className="bi bi-inbox display-1 text-muted"></i>
        <h4 className="mt-4 text-muted">No Knowledge Bases Yet</h4>
        <p className="text-muted">Create your first knowledge base to get started</p>
      </div>
    );
  }

  return (
    <>
      {/* Search and Filter Bar */}
      <div className="d-flex gap-3 mb-4 align-items-center">
        {/* Search Bar */}
        <InputGroup style={{ maxWidth: '400px' }}>
          <InputGroup.Text>
            <i className="bi bi-search"></i>
          </InputGroup.Text>
          <Form.Control
            type="text"
            placeholder="Search knowledge bases..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </InputGroup>

        {/* Filter Dropdown */}
        <Form.Select
          style={{ maxWidth: '200px' }}
          value={filter}
          onChange={(e) => setFilter(e.target.value as FilterType)}
        >
          <option value="all">All KBs</option>
          <option value="shared">Shared</option>
          <option value="personal">Personal</option>
        </Form.Select>

        {/* Results count */}
        <div className="text-muted ms-auto">
          {filteredKBs.length} {filteredKBs.length === 1 ? 'knowledge base' : 'knowledge bases'}
        </div>
      </div>

      {/* Empty state after filtering */}
      {filteredKBs.length === 0 ? (
        <div className="text-center p-5 bg-light rounded">
          <i className="bi bi-search display-4 text-muted"></i>
          <h5 className="mt-3 text-muted">No knowledge bases found</h5>
          <p className="text-muted">Try adjusting your search or filter</p>
        </div>
      ) : (
        <Row className="g-4">
          {filteredKBs.map((kb) => {
            const isShared = isKBShared(kb);
            return (
              <Col key={kb.kb_id} xs={12} sm={6} md={4} lg={3}>
                <Card className="kb-card h-100 shadow-sm" onClick={() => handleCardClick(kb.kb_id)}>
                  <Card.Body className="d-flex flex-column">
                    {/* Icon and Title */}
                    <div className="d-flex align-items-start mb-3">
                      <div className="kb-card-icon me-3">
                        <i
                          className={`bi ${isShared ? 'bi-folder-plus' : 'bi-folder'} text-white`}
                          style={{ fontSize: '24px' }}
                        ></i>
                      </div>
                      <div className="flex-grow-1">
                        <h5 className="mb-1" style={{ fontWeight: 600 }}>
                          {kb.kb_name}
                        </h5>
                        <div className="d-flex gap-2 flex-wrap">
                          <Badge
                            bg=""
                            className={`text-uppercase ${kb.role === 'OWNER' ? 'badge-outline-primary' : 'badge-outline'}`}
                          >
                            {kb.role}
                          </Badge>
                          <Badge bg="" className={isShared ? 'badge-outline' : 'badge-outline-primary'}>
                            {isShared ? 'Shared' : 'Personal'}
                          </Badge>
                        </div>
                      </div>
                    </div>

                    {/* Metadata */}
                    <div className="mt-auto">
                      <div className="d-flex justify-content-between align-items-center text-muted small mb-2">
                        <span>
                          <i className="bi bi-file-earmark me-1"></i>
                          {kb.document_count || 0} documents
                        </span>
                      </div>

                      {kb.created_at && (
                        <div className="text-muted small">
                          <i className="bi bi-calendar me-1"></i>
                          Created {new Date(kb.created_at).toLocaleDateString('en-NZ')}
                        </div>
                      )}

                      {/* View Details Link */}
                      <div className="mt-3 pt-3 border-top">
                        <span className="text-primary small fw-semibold">
                          View Details <i className="bi bi-arrow-right ms-1"></i>
                        </span>
                      </div>
                    </div>
                  </Card.Body>
                </Card>
              </Col>
            );
          })}
        </Row>
      )}
    </>
  );
}
