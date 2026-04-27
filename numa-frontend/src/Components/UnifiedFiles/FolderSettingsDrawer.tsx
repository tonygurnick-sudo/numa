import React, { useState, useEffect, useCallback } from 'react';
import { Offcanvas, Button, Form, Alert, Badge, Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { knowledgeBaseService, KnowledgeBase } from '../../Services/knowledgeBaseService';

interface FolderSettingsDrawerProps {
  show: boolean;
  onHide: () => void;
  kbId: string;
  kbName: string;
  onDeleted?: () => void;
}

export function FolderSettingsDrawer({
  show,
  onHide,
  kbId,
  kbName,
  onDeleted,
}: FolderSettingsDrawerProps): React.JSX.Element {
  const { t } = useTranslation('unifiedFiles');
  const [kbDetails, setKbDetails] = useState<KnowledgeBase | null>(null);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState('');

  const loadDetails = useCallback(async () => {
    if (!show || !kbId) return;
    setLoading(true);
    try {
      const details = await knowledgeBaseService.getKB(kbId);
      setKbDetails(details);
    } catch {
      // Details not critical, show what we have
    } finally {
      setLoading(false);
    }
  }, [show, kbId]);

  useEffect(() => {
    loadDetails();
  }, [loadDetails]);

  const handleDelete = async () => {
    if (deleteConfirmName !== kbName) return;
    setDeleting(true);
    try {
      await knowledgeBaseService.deleteKB(kbId);
      onHide();
      onDeleted?.();
    } catch {
      // Error handling
    } finally {
      setDeleting(false);
    }
  };

  const getVisibilityLabel = (): string => {
    if (!kbDetails) return '';
    if (kbDetails.viewers.includes('*') && kbDetails.editors.includes('*')) return t('folderSettings.publicEditor');
    if (kbDetails.viewers.includes('*')) return t('folderSettings.public');
    if (kbDetails.is_shared) return t('folderSettings.shared');
    return t('folderSettings.personal');
  };

  return (
    <Offcanvas show={show} onHide={onHide} placement="end">
      <Offcanvas.Header closeButton>
        <Offcanvas.Title>
          <i className="bi bi-gear me-2" />
          {t('folderSettings.title')}
        </Offcanvas.Title>
      </Offcanvas.Header>
      <Offcanvas.Body>
        {loading ? (
          <div className="text-center py-4">
            <Spinner animation="border" size="sm" />
          </div>
        ) : (
          <>
            <Form.Group className="mb-3">
              <Form.Label className="fw-semibold">{t('folderSettings.nameLabel')}</Form.Label>
              <Form.Control type="text" value={kbName} disabled />
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label className="fw-semibold">{t('folderSettings.visibility')}</Form.Label>
              <div>
                <Badge bg="secondary">{getVisibilityLabel()}</Badge>
              </div>
            </Form.Group>

            {kbDetails && kbDetails.is_shared && (
              <>
                <Form.Group className="mb-3">
                  <Form.Label className="fw-semibold">{t('folderSettings.viewers')}</Form.Label>
                  <div className="d-flex flex-wrap gap-1">
                    {kbDetails.viewers.length > 0 ? (
                      kbDetails.viewers
                        .filter((v) => v !== '*')
                        .map((viewer) => (
                          <Badge key={viewer} bg="light" text="dark" className="border">
                            {viewer}
                          </Badge>
                        ))
                    ) : (
                      <span className="text-muted small">{t('folderSettings.noViewers')}</span>
                    )}
                  </div>
                </Form.Group>

                <Form.Group className="mb-3">
                  <Form.Label className="fw-semibold">{t('folderSettings.editors')}</Form.Label>
                  <div className="d-flex flex-wrap gap-1">
                    {kbDetails.editors.length > 0 ? (
                      kbDetails.editors
                        .filter((e) => e !== '*')
                        .map((editor) => (
                          <Badge key={editor} bg="light" text="dark" className="border">
                            {editor}
                          </Badge>
                        ))
                    ) : (
                      <span className="text-muted small">{t('folderSettings.noEditors')}</span>
                    )}
                  </div>
                </Form.Group>
              </>
            )}

            <hr />

            {!showDeleteConfirm ? (
              <Button variant="outline-danger" size="sm" onClick={() => setShowDeleteConfirm(true)}>
                <i className="bi bi-trash me-2" />
                {t('folderSettings.delete')}
              </Button>
            ) : (
              <Alert variant="danger">
                <p className="small mb-2">{t('folderSettings.deleteWarning')}</p>
                <Form.Control
                  type="text"
                  size="sm"
                  placeholder={kbName}
                  value={deleteConfirmName}
                  onChange={(e) => setDeleteConfirmName(e.target.value)}
                  className="mb-2"
                />
                <div className="d-flex gap-2">
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={deleteConfirmName !== kbName || deleting}
                    onClick={handleDelete}
                  >
                    {deleting ? t('folderSettings.deleting') : t('folderSettings.delete')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setShowDeleteConfirm(false);
                      setDeleteConfirmName('');
                    }}
                  >
                    {t('folderSettings.close')}
                  </Button>
                </div>
              </Alert>
            )}
          </>
        )}
      </Offcanvas.Body>
    </Offcanvas>
  );
}
