/**
 * Knowledge Base Selector Component
 * Dropdown to select which KB to query in chat
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Dropdown, Badge, Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { useKnowledgeBase } from '../Providers/KnowledgeBaseProvider';
import { createPortal } from 'react-dom';

interface KnowledgeBaseSelectorProps {
  variant?: 'default' | 'compact';
  className?: string;
}

export function KnowledgeBaseSelector({
  variant = 'default',
  className = '',
}: KnowledgeBaseSelectorProps): React.JSX.Element {
  const { t } = useTranslation('knowledgeBase');
  const { selectedKB, availableKBs, isLoadingKBs, selectKBById, refreshKBs } = useKnowledgeBase();
  const getKbLabel = useCallback(
    (kb?: { kb_id: string; kb_name: string }) => {
      if (!kb) return '';
      return kb.kb_id === 'company' ? t('selector.companyKbName') : kb.kb_name;
    },
    [t]
  );

  const handleToggle = useCallback(
    (nextShow: boolean) => {
      if (nextShow) {
        refreshKBs().catch((err) => {
          console.warn('KB refresh failed while opening selector:', err);
        });
      }
    },
    [refreshKBs]
  );

  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const el = document.createElement('div');
    document.body.appendChild(el);
    setPortalContainer(el);
    return () => {
      document.body.removeChild(el);
    };
  }, []);

  const PortalMenu = useMemo(
    () =>
      React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<'div'>>((props, ref) => {
        if (!portalContainer) return <div {...props} ref={ref} />;
        return createPortal(<div {...props} ref={ref} />, portalContainer);
      }),
    [portalContainer]
  );

  const isCompact = variant === 'compact';

  if (isLoadingKBs && availableKBs.length === 0) {
    return (
      <div className={`kb-selector-loading ${className}`}>
        <Spinner animation="border" size="sm" />
        <span className="ms-2">{t('selector.loadingMessage')}</span>
      </div>
    );
  }

  return (
    <div className={`kb-selector ${isCompact ? 'kb-selector-compact' : ''} ${className}`}>
      {!isCompact && (
        <label className="kb-selector-label">
          <i className="bi bi-database me-1"></i>
          {t('selector.label')}
        </label>
      )}
      <Dropdown className="kb-selector-dropdown" onToggle={handleToggle}>
        <Dropdown.Toggle variant={isCompact ? 'outline-secondary' : 'primary'} size="sm" id="kb-selector-dropdown">
          {isLoadingKBs && <Spinner animation="border" size="sm" className="me-2" />}
          {selectedKB ? (
            <>
              <i className="bi bi-folder2-open me-1"></i>
              {getKbLabel(selectedKB)}
              {selectedKB.kb_id === 'company' && (
                <Badge bg="info" className="ms-2">
                  {t('selector.defaultBadge')}
                </Badge>
              )}
              <Badge bg="secondary" className="ms-2">
                {t(`roles.${selectedKB.role.toLowerCase()}`)}
              </Badge>
            </>
          ) : (
            <span className="text-muted">{t('selector.selectPlaceholder')}</span>
          )}
        </Dropdown.Toggle>

        <Dropdown.Menu
          as={PortalMenu}
          popperConfig={{
            modifiers: [
              { name: 'preventOverflow', options: { boundary: 'viewport' } },
              { name: 'flip', options: { fallbackPlacements: ['top-start', 'bottom-end', 'top-end'] } },
            ],
          }}
        >
          <Dropdown.Header>{t('selector.header')}</Dropdown.Header>
          {availableKBs.length === 0 ? (
            <Dropdown.Item disabled>{t('selector.empty')}</Dropdown.Item>
          ) : (
            availableKBs.map((kb) => (
              <Dropdown.Item
                key={kb.kb_id}
                active={selectedKB?.kb_id === kb.kb_id}
                onClick={() => selectKBById(kb.kb_id)}
              >
                <div className="d-flex justify-content-between align-items-center">
                  <div>
                    <i className="bi bi-folder2-open me-2"></i>
                    {getKbLabel(kb)}
                    {kb.kb_id === 'company' && (
                      <Badge bg="info" className="ms-2">
                        {t('selector.defaultBadge')}
                      </Badge>
                    )}
                  </div>
                  <Badge bg="secondary">{t(`roles.${kb.role.toLowerCase()}`)}</Badge>
                </div>
              </Dropdown.Item>
            ))
          )}
          <Dropdown.Divider />
          <Dropdown.Item onClick={() => refreshKBs()}>
            <i className="bi bi-arrow-clockwise me-2"></i>
            {t('selector.refresh')}
          </Dropdown.Item>
        </Dropdown.Menu>
      </Dropdown>
    </div>
  );
}
