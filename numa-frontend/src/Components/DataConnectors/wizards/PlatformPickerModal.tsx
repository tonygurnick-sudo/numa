// MERGE: kept dev version — uses gap-2 spacing and maxHeight 520 vs base commit's gap-1/420.
import { useMemo, useState } from 'react';
import { Badge, Button, Form, Modal } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';
import { CONNECTOR_REGISTRY, getConnectorCategories } from '../connectorRegistry';
import type { ConnectorTemplate } from '../connectorRegistry';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PlatformPickerModalProps {
  show: boolean;
  onHide: () => void;
  onSelect: (connector: ConnectorTemplate) => void;
  configuredIds: Set<string>;
}

// ---------------------------------------------------------------------------
// Auth type badge helper
// ---------------------------------------------------------------------------

const AUTH_BADGE_LABELS: Record<string, { label: string; variant: string }> = {
  oauth2: { label: 'OAuth 2.0', variant: 'primary' },
  'api-key': { label: 'API Key', variant: 'info' },
  token: { label: 'Token', variant: 'info' },
  'username-password': { label: 'Login', variant: 'warning' },
  'contact-required': { label: 'Contact Required', variant: 'secondary' },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const PlatformPickerModal = ({ show, onHide, onSelect, configuredIds }: PlatformPickerModalProps) => {
  const { t } = useTranslation('integrations');
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const categories = useMemo(() => getConnectorCategories(), []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return CONNECTOR_REGISTRY.filter((c) => {
      if (activeCategory && c.category !== activeCategory) return false;
      if (!q) return true;
      return (
        c.displayName.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q) ||
        c.category.toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q)
      );
    });
  }, [search, activeCategory]);

  const handleSelect = (connector: ConnectorTemplate) => {
    setSearch('');
    setActiveCategory(null);
    onSelect(connector);
  };

  const handleHide = () => {
    setSearch('');
    setActiveCategory(null);
    onHide();
  };

  return (
    <Modal show={show} onHide={handleHide} size="lg" centered>
      <Modal.Header closeButton>
        <Modal.Title>{t('dataConnectors.picker.title')}</Modal.Title>
      </Modal.Header>

      <Modal.Body>
        {/* Search bar */}
        <div className="position-relative mb-3">
          <Search size={16} className="position-absolute top-50 translate-middle-y ms-3 text-muted" />
          <Form.Control
            type="text"
            placeholder={t('dataConnectors.picker.search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ paddingLeft: '2.25rem' }}
          />
        </div>

        {/* Category filter pills */}
        <div className="d-flex flex-wrap gap-2 mb-3">
          <Button
            variant={activeCategory === null ? 'primary' : 'outline-secondary'}
            size="sm"
            className="rounded-pill"
            onClick={() => setActiveCategory(null)}
          >
            {t('dataConnectors.picker.categoryAll')}
          </Button>
          {categories.map((cat) => (
            <Button
              key={cat}
              variant={activeCategory === cat ? 'primary' : 'outline-secondary'}
              size="sm"
              className="rounded-pill"
              onClick={() => setActiveCategory(cat)}
            >
              {cat}
            </Button>
          ))}
        </div>

        {/* Platform grid */}
        <div className="row g-3" style={{ maxHeight: 520, overflowY: 'auto' }}>
          {filtered.length === 0 && (
            <div className="col-12 text-center text-muted py-4">{t('dataConnectors.picker.noResults')}</div>
          )}
          {filtered.map((connector) => {
            const isConfigured = configuredIds.has(connector.id);
            const badgeInfo = AUTH_BADGE_LABELS[connector.authType];
            return (
              <div key={connector.id} className="col-md-6 col-lg-4">
                <div
                  className="border rounded p-3 h-100 d-flex flex-column cursor-pointer"
                  style={{ cursor: 'pointer', transition: 'border-color 0.15s' }}
                  onClick={() => handleSelect(connector)}
                  onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#0d6efd')}
                  onMouseLeave={(e) => (e.currentTarget.style.borderColor = '')}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && handleSelect(connector)}
                >
                  <div className="d-flex align-items-center gap-2 mb-2">
                    <i className={connector.icon} style={{ fontSize: '1.25rem' }} />
                    <strong className="small">{connector.displayName}</strong>
                    {isConfigured && (
                      <Badge bg="success" className="ms-auto" style={{ fontSize: '0.65rem' }}>
                        {t('dataConnectors.oauth.configured')}
                      </Badge>
                    )}
                  </div>
                  <p className="text-muted small mb-2 flex-grow-1" style={{ fontSize: '0.8rem' }}>
                    {connector.description}
                  </p>
                  <div className="d-flex gap-1 flex-wrap">
                    {badgeInfo && (
                      <Badge bg={badgeInfo.variant} className="fw-normal" style={{ fontSize: '0.65rem' }}>
                        {badgeInfo.label}
                      </Badge>
                    )}
                    <Badge bg="light" text="dark" className="fw-normal" style={{ fontSize: '0.65rem' }}>
                      {connector.category}
                    </Badge>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Modal.Body>

      <Modal.Footer>
        <Button variant="secondary" onClick={handleHide}>
          {t('dataConnectors.wizard.cancel')}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};
