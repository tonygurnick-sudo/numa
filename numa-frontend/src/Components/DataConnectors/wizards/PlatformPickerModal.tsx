// MERGE: kept dev version — uses gap-2 spacing and maxHeight 520 vs base commit's gap-1/420.
import { useMemo, useState } from 'react';
import { Badge, Button, Form, Modal } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';
import { CONNECTOR_REGISTRY, getConnectorCategories } from '../connectorRegistry';
import type { ConnectorTemplate } from '../connectorRegistry';
import { AuthTypeBadge } from '../AuthTypeBadge';

interface PlatformPickerModalProps {
  show: boolean;
  onHide: () => void;
  onSelect: (connector: ConnectorTemplate) => void;
  configuredIds: Set<string>;
  /** Set of connector slugs whose `ext-api-doc/<slug>/` files are deployed.
   *  Cards for any connector whose slug is NOT in this set render
   *  greyed-out and unclickable. */
  apiDocsAvailableSlugs?: Set<string>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const PlatformPickerModal = ({
  show,
  onHide,
  onSelect,
  configuredIds,
  apiDocsAvailableSlugs,
}: PlatformPickerModalProps) => {
  const { t } = useTranslation('integrations');
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const categories = useMemo(() => getConnectorCategories(), []);

  // Connectors built on Google/Microsoft/Apple platforms are exempt from the
  // ext-api-doc gating: the LLM has strong native knowledge of these APIs, so
  // their behaviour is reliable without bundled API docs.
  const DOCS_GATING_EXEMPT: ReadonlySet<string> = useMemo(() => new Set(['googledrive', 'gmail', 'onedrive']), []);

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
            // Universal docs gating: a connector is selectable only if its
            // slug has docs in the client's ext-api-doc bucket. Before the
            // parent loads the set we don't grey anything out (avoids a flash).
            const docsUnavailable =
              !!apiDocsAvailableSlugs &&
              !apiDocsAvailableSlugs.has(connector.id) &&
              !DOCS_GATING_EXEMPT.has(connector.id);
            const tooltip = docsUnavailable ? t('dataConnectors.oauth.docsUnavailable') : undefined;
            return (
              <div key={connector.id} className="col-md-6 col-lg-4">
                <div
                  className="border rounded p-3 h-100 d-flex flex-column"
                  style={{
                    cursor: docsUnavailable ? 'not-allowed' : 'pointer',
                    transition: 'border-color 0.15s',
                    opacity: docsUnavailable ? 0.45 : 1,
                    filter: docsUnavailable ? 'grayscale(100%)' : 'none',
                    pointerEvents: docsUnavailable ? 'none' : 'auto',
                  }}
                  title={tooltip}
                  onClick={() => !docsUnavailable && handleSelect(connector)}
                  onMouseEnter={(e) => {
                    if (!docsUnavailable) e.currentTarget.style.borderColor = '#0d6efd';
                  }}
                  onMouseLeave={(e) => {
                    if (!docsUnavailable) e.currentTarget.style.borderColor = '';
                  }}
                  role="button"
                  aria-disabled={docsUnavailable}
                  tabIndex={docsUnavailable ? -1 : 0}
                  onKeyDown={(e) => !docsUnavailable && e.key === 'Enter' && handleSelect(connector)}
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
                    <AuthTypeBadge authType={connector.authType} />
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
