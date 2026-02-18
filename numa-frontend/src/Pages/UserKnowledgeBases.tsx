/**
 * User Knowledge Bases Landing Page
 * Displays a grid of user KBs for selection
 */

import React, { useState, useMemo } from 'react';
import { Button, Form, InputGroup } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LayoutDashboard } from '../Layouts/LayoutDashboard';
import { PageHeader } from '../Components/PageHeader';
import { CreateKBModal } from '../Components/CreateKBModal';
import { StickyToolbar } from '../Components/StickyToolbar';
import { useKnowledgeBase } from '../Providers/KnowledgeBaseProvider';
import type { UserKB } from '../Services/knowledgeBaseService';
import { SYSTEM_KB_IDS } from '../constants/knowledgeBase';

type FilterType = 'all' | 'shared' | 'personal';

export function UserKnowledgeBases(): React.JSX.Element {
  const { t } = useTranslation('knowledgeBase');
  const navigate = useNavigate();
  const [showCreateKBModal, setShowCreateKBModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<FilterType>('all');
  const { availableKBs, isLoadingKBs, refreshKBs } = useKnowledgeBase();

  // System KBs are managed separately and should not appear in user-managed KB pages.
  const userKBs = availableKBs.filter((kb) => !SYSTEM_KB_IDS.has(kb.kb_id));

  // Helper function to determine if a KB is shared
  function isKBShared(kb: UserKB): boolean {
    if (kb.role === 'VIEWER') return true;
    return kb.is_shared ?? false;
  }

  // Filter and search KBs
  const filteredKBs = useMemo(() => {
    let result = userKBs;

    // Apply filter
    if (filter === 'shared') {
      result = result.filter((kb) => isKBShared(kb));
    } else if (filter === 'personal') {
      result = result.filter((kb) => !isKBShared(kb));
    }

    // Apply search
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter((kb) => kb.kb_name?.toLowerCase().includes(query));
    }

    return result;
  }, [userKBs, filter, searchQuery]);

  return (
    <div className="dashboard user-knowledge-bases">
      <PageHeader
        title={t('userKnowledgeBases.title')}
        subtitle={t('userKnowledgeBases.subtitle')}
        actions={
          <>
            <Button variant="secondary" onClick={refreshKBs} disabled={isLoadingKBs}>
              <i className="bi bi-arrow-clockwise me-1"></i>
              {t('userKnowledgeBases.actions.refresh')}
            </Button>
            <Button variant="primary" onClick={() => setShowCreateKBModal(true)}>
              <i className="bi bi-plus-circle me-2"></i>
              {t('userKnowledgeBases.create')}
            </Button>
          </>
        }
      />

      <LayoutDashboard>
        <StickyToolbar className="kb-toolbar">
          <div className="d-flex flex-wrap gap-3 mb-0 align-items-center justify-content-between">
            <div className="d-flex gap-3 align-items-center" style={{ minWidth: 0 }}>
              <InputGroup className="kb-search-group" style={{ maxWidth: '400px', minWidth: '200px', width: '300px' }}>
                <InputGroup.Text className="kb-search-icon">
                  <i className="bi bi-search"></i>
                </InputGroup.Text>
                <Form.Control
                  className="kb-search-input"
                  type="text"
                  placeholder={t('userKnowledgeBases.search.placeholder')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </InputGroup>
              <Form.Select
                style={{ maxWidth: '140px', minWidth: '100px', width: '120px' }}
                value={filter}
                onChange={(e) => setFilter(e.target.value as FilterType)}
              >
                <option value="all">{t('userKnowledgeBases.filters.all')}</option>
                <option value="shared">{t('userKnowledgeBases.filters.shared')}</option>
                <option value="personal">{t('userKnowledgeBases.filters.personal')}</option>
              </Form.Select>
            </div>
            <div className="text-muted flex-shrink-0 kb-count" style={{ whiteSpace: 'nowrap' }}>
              {t('userKnowledgeBases.count', { count: filteredKBs.length })}
            </div>
          </div>
        </StickyToolbar>

        {isLoadingKBs ? (
          <div className="text-center p-5">
            <div className="spinner-border text-primary">
              <span className="visually-hidden">{t('userKnowledgeBases.loading')}</span>
            </div>
            <p className="mt-3 text-muted">{t('userKnowledgeBases.loadingMessage')}</p>
          </div>
        ) : filteredKBs.length === 0 ? (
          <div className="text-center p-5 bg-light rounded">
            <i className="bi bi-search display-4 text-muted"></i>
            <h5 className="mt-3 text-muted">{t('userKnowledgeBases.empty.title')}</h5>
            <p className="text-muted">{t('userKnowledgeBases.empty.subtitle')}</p>
          </div>
        ) : (
          <div className="row g-4 user-kb-grid">
            {filteredKBs.map((kb) => {
              const isShared = isKBShared(kb);
              return (
                <div key={kb.kb_id} className="col-12 col-sm-6 col-md-4 col-lg-3">
                  <div
                    className="card kb-card h-100 shadow-sm"
                    onClick={() => navigate(`/user-knowledge-bases/${kb.kb_id}`)}
                    style={{
                      borderColor: kb.role === 'OWNER' ? 'var(--brand-primary)' : 'var(--color-text-muted)',
                      cursor: 'pointer',
                    }}
                  >
                    <div className="card-body d-flex flex-column">
                      <div className="kb-card-header">
                        <div
                          className="kb-card-icon"
                          style={{
                            background:
                              kb.role === 'OWNER'
                                ? 'linear-gradient(135deg, var(--color-primary) 0%, var(--color-magenta-700) 100%)'
                                : 'linear-gradient(135deg, var(--color-text-muted) 0%, var(--color-secondary) 100%)',
                          }}
                        >
                          <i
                            className={`bi ${isShared ? 'bi-folder-plus' : 'bi-folder'} text-white`}
                            style={{ fontSize: '24px' }}
                          ></i>
                        </div>
                        <div className="kb-card-title-container">
                          <h5 className="kb-card-title">{kb.kb_name}</h5>
                        </div>
                      </div>
                      <div className="d-flex gap-2 flex-wrap mb-3" style={{ marginTop: '10px', marginBottom: '10px' }}>
                        <span
                          className={`badge text-uppercase ${kb.role === 'OWNER' ? 'badge-outline-primary' : 'badge-outline'}`}
                        >
                          {kb.role}
                        </span>
                        <span className={`badge ${isShared ? 'badge-outline' : 'badge-outline-primary'}`}>
                          {isShared ? t('userKnowledgeBases.badges.shared') : t('userKnowledgeBases.badges.personal')}
                        </span>
                      </div>
                      <div className="mt-auto">
                        {kb.document_count !== undefined && kb.document_count !== null && (
                          <div className="d-flex justify-content-between align-items-center text-muted small mb-2">
                            <span>
                              <i className="bi bi-file-earmark me-1"></i>
                              {t('userKnowledgeBases.documents', { count: kb.document_count })}
                            </span>
                          </div>
                        )}
                        {kb.created_at && (
                          <div className="text-muted small">
                            <i className="bi bi-calendar me-1"></i>
                            {t('userKnowledgeBases.created', {
                              date: new Date(kb.created_at).toLocaleDateString('en-NZ'),
                            })}
                          </div>
                        )}
                        <div className="mt-3 pt-3 border-top">
                          <span className="text-primary small fw-semibold">
                            {t('userKnowledgeBases.actions.viewDetails')}
                            <i className="bi bi-arrow-right ms-1"></i>
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </LayoutDashboard>

      {/* Create KB Modal */}
      <CreateKBModal
        show={showCreateKBModal}
        onHide={() => setShowCreateKBModal(false)}
        onSuccess={() => {
          refreshKBs();
          setShowCreateKBModal(false);
        }}
      />
    </div>
  );
}
