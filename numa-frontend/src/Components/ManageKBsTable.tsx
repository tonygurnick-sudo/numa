/**
 * Manage Knowledge Bases Table
 * Table component to view, edit, and delete knowledge bases
 */

import React, { useState, useEffect } from 'react';
import { Table, Button, Badge, Modal, Form, Alert, Spinner, Card } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import { knowledgeBaseService, KnowledgeBase } from '../Services/knowledgeBaseService';
import { useKnowledgeBase } from '../Providers/KnowledgeBaseProvider';

interface ManageKBsTableProps {
  refreshKey?: number;
}

interface EditKBModalProps {
  show: boolean;
  kb: KnowledgeBase | null;
  onHide: () => void;
  onSuccess: () => void;
}

function EditKBModal({ show, kb, onHide, onSuccess }: EditKBModalProps): React.JSX.Element {
  const { t } = useTranslation('common');
  const [kbName, setKbName] = useState('');
  const [viewersInput, setViewersInput] = useState('');
  const [editorsInput, setEditorsInput] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (kb) {
      setKbName(kb.kb_name);
      setIsPublic(kb.viewers.includes('*'));
      // Use viewer_emails if available, otherwise fall back to viewers (UUIDs)
      const viewersToShow =
        kb.viewer_emails && kb.viewer_emails.length > 0 ? kb.viewer_emails : kb.viewers.filter((v) => v !== '*');
      setViewersInput(kb.viewers.includes('*') ? '' : viewersToShow.join(', '));
      // Use editor_emails if available, otherwise fall back to editors (UUIDs)
      const editorsToShow = kb.editor_emails && kb.editor_emails.length > 0 ? kb.editor_emails : kb.editors;
      setEditorsInput(editorsToShow.join(', '));
    }
  }, [kb]);

  const handleClose = (): void => {
    if (!isSubmitting) {
      setError(null);
      onHide();
    }
  };

  const parseUserList = (input: string): string[] => {
    if (!input.trim()) return [];
    return input
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  };

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!kb) return;

    setError(null);
    setIsSubmitting(true);

    try {
      const viewers = isPublic ? ['*'] : parseUserList(viewersInput);
      const editors = parseUserList(editorsInput);

      await knowledgeBaseService.updateKB(kb.kb_id, {
        name: kbName !== kb.kb_name ? kbName : undefined,
        viewers,
        editors,
      });

      handleClose();
      onSuccess();
    } catch (err) {
      console.error('Error updating KB:', err);
      setError(err instanceof Error ? err.message : t('manageKBs.errors.updateFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal show={show} onHide={handleClose} backdrop={isSubmitting ? 'static' : true}>
      <Modal.Header closeButton={!isSubmitting}>
        <Modal.Title>{t('manageKBs.editModal.title')}</Modal.Title>
      </Modal.Header>

      <Form onSubmit={handleSubmit}>
        <Modal.Body>
          {error && (
            <Alert variant="danger" className="mb-3">
              <i className="bi bi-exclamation-triangle me-2"></i>
              {error}
            </Alert>
          )}

          {kb?.is_default && (
            <Alert variant="info" className="mb-3">
              <i className="bi bi-info-circle me-2"></i>
              {t('manageKBs.editModal.defaultNotice')}
            </Alert>
          )}

          <Form.Group className="mb-3">
            <Form.Label>{t('manageKBs.editModal.nameLabel')}</Form.Label>
            <Form.Control
              type="text"
              value={kbName}
              onChange={(e) => setKbName(e.target.value)}
              disabled={isSubmitting || kb?.is_default}
            />
          </Form.Group>

          <Form.Group className="mb-3">
            <Form.Check
              type="checkbox"
              label={t('manageKBs.editModal.publicLabel')}
              checked={isPublic}
              onChange={(e) => setIsPublic(e.target.checked)}
              disabled={isSubmitting}
            />
          </Form.Group>

          {!isPublic && (
            <Form.Group className="mb-3">
              <Form.Label>{t('manageKBs.editModal.viewersLabel')}</Form.Label>
              <Form.Control
                type="text"
                placeholder={t('manageKBs.editModal.viewersPlaceholder')}
                value={viewersInput}
                onChange={(e) => setViewersInput(e.target.value)}
                disabled={isSubmitting}
              />
              <Form.Text className="text-muted">{t('manageKBs.editModal.commaSeparated')}</Form.Text>
            </Form.Group>
          )}

          <Form.Group className="mb-3">
            <Form.Label>{t('manageKBs.editModal.editorsLabel')}</Form.Label>
            <Form.Control
              type="text"
              placeholder={t('manageKBs.editModal.editorsPlaceholder')}
              value={editorsInput}
              onChange={(e) => setEditorsInput(e.target.value)}
              disabled={isSubmitting}
            />
            <Form.Text className="text-muted">{t('manageKBs.editModal.commaSeparated')}</Form.Text>
          </Form.Group>
        </Modal.Body>

        <Modal.Footer>
          <Button variant="secondary" onClick={handleClose} disabled={isSubmitting}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" type="submit" disabled={isSubmitting}>
            {isSubmitting ? (
              <>
                <span className="spinner-border spinner-border-sm me-2" />
                {t('manageKBs.editModal.saving')}
              </>
            ) : (
              t('manageKBs.editModal.saveChanges')
            )}
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
}

export function ManageKBsTable({ refreshKey = 0 }: ManageKBsTableProps): React.JSX.Element {
  const { t } = useTranslation('common');
  const { refreshKBs } = useKnowledgeBase();
  const [kbs, setKbs] = useState<KnowledgeBase[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedKB, setSelectedKB] = useState<KnowledgeBase | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const loadKBDetails = async (): Promise<void> => {
    setIsLoading(true);
    setError(null);

    try {
      // Get user's accessible KBs
      const userKBs = await knowledgeBaseService.listUserKBs();

      // Fetch full details for each KB (only for editors)
      const detailsPromises = userKBs
        .filter((kb) => kb.role === 'EDITOR')
        .map((kb) =>
          knowledgeBaseService.getKB(kb.kb_id).catch((err) => {
            console.error(`Error fetching KB ${kb.kb_id}:`, err);
            return null;
          }),
        );

      const kbDetails = (await Promise.all(detailsPromises)).filter((kb) => kb !== null) as KnowledgeBase[];
      setKbs(kbDetails);
    } catch (err) {
      console.error('Error loading KBs:', err);
      setError(err instanceof Error ? err.message : t('manageKBs.errors.loadFailed'));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadKBDetails();
  }, [refreshKey]);

  const handleEdit = (kb: KnowledgeBase): void => {
    setSelectedKB(kb);
    setShowEditModal(true);
  };

  const handleDelete = (kb: KnowledgeBase): void => {
    setSelectedKB(kb);
    setShowDeleteModal(true);
  };

  const handleEditSuccess = (): void => {
    loadKBDetails();
    refreshKBs();
  };

  const confirmDelete = async (): Promise<void> => {
    if (!selectedKB) return;

    setIsDeleting(true);

    try {
      await knowledgeBaseService.deleteKB(selectedKB.kb_id);
      setShowDeleteModal(false);
      setSelectedKB(null);
      loadKBDetails();
      refreshKBs();
    } catch (err) {
      console.error('Error deleting KB:', err);
      setError(err instanceof Error ? err.message : t('manageKBs.errors.deleteFailed'));
    } finally {
      setIsDeleting(false);
    }
  };

  if (isLoading && kbs.length === 0) {
    return (
      <Card>
        <Card.Body className="text-center py-5">
          <Spinner animation="border" />
          <p className="mt-3 text-muted mb-0">{t('manageKBs.loading')}</p>
        </Card.Body>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <Card.Header>
          <Card.Title className="mb-0">{t('manageKBs.title')}</Card.Title>
        </Card.Header>
        <Card.Body>
          {error && (
            <Alert variant="danger" dismissible onClose={() => setError(null)}>
              <i className="bi bi-exclamation-triangle me-2"></i>
              {error}
            </Alert>
          )}

          {kbs.length === 0 ? (
            <div className="text-center py-4">
              <i className="bi bi-inbox display-4 text-muted"></i>
              <p className="text-muted mt-3 mb-0">{t('manageKBs.empty')}</p>
            </div>
          ) : (
            <div className="table-responsive">
              <Table hover>
                <thead>
                  <tr>
                    <th>{t('manageKBs.columns.name')}</th>
                    <th>{t('manageKBs.columns.status')}</th>
                    <th>{t('manageKBs.columns.viewers')}</th>
                    <th>{t('manageKBs.columns.editors')}</th>
                    <th>{t('manageKBs.columns.documents')}</th>
                    <th>{t('manageKBs.columns.created')}</th>
                    <th>{t('manageKBs.columns.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {kbs.map((kb) => (
                    <tr key={kb.kb_id}>
                      <td>
                        <div className="d-flex align-items-center">
                          <i className="bi bi-folder2-open me-2 text-primary"></i>
                          <strong>{kb.kb_name}</strong>
                          {kb.is_default && (
                            <Badge bg="info" className="ms-2">
                              {t('manageKBs.badges.default')}
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td>
                        <Badge bg={kb.status === 'ACTIVE' ? 'success' : 'secondary'}>
                          {t('manageKBs.status', { status: kb.status })}
                        </Badge>
                      </td>
                      <td>
                        {kb.viewers.includes('*') ? (
                          <Badge bg="info">{t('manageKBs.badges.allUsers')}</Badge>
                        ) : (
                          <span>{t('manageKBs.viewersCount', { count: kb.viewers.length })}</span>
                        )}
                      </td>
                      <td>{t('manageKBs.editorsCount', { count: kb.editors.length })}</td>
                      <td>{kb.document_count}</td>
                      <td>{new Date(kb.created_at).toLocaleDateString(i18n.language)}</td>
                      <td>
                        <div className="d-flex gap-2">
                          <Button variant="outline-primary" size="sm" onClick={() => handleEdit(kb)}>
                            <i className="bi bi-pencil"></i>
                          </Button>
                          {!kb.is_default && (
                            <Button variant="outline-danger" size="sm" onClick={() => handleDelete(kb)}>
                              <i className="bi bi-trash"></i>
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
        </Card.Body>
      </Card>

      <EditKBModal
        show={showEditModal}
        kb={selectedKB}
        onHide={() => setShowEditModal(false)}
        onSuccess={handleEditSuccess}
      />

      <Modal show={showDeleteModal} onHide={() => !isDeleting && setShowDeleteModal(false)}>
        <Modal.Header closeButton={!isDeleting}>
          <Modal.Title>{t('manageKBs.deleteModal.title')}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Alert variant="warning">
            <i className="bi bi-exclamation-triangle me-2"></i>
            {t('manageKBs.deleteModal.confirm', { name: selectedKB?.kb_name || '' })}
          </Alert>
          <p className="mb-0">{t('manageKBs.deleteModal.willDo')}</p>
          <ul>
            <li>{t('manageKBs.deleteModal.steps.archive')}</li>
            <li>{t('manageKBs.deleteModal.steps.inaccessible')}</li>
            <li>{t('manageKBs.deleteModal.steps.preserve')}</li>
          </ul>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowDeleteModal(false)} disabled={isDeleting}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" onClick={confirmDelete} disabled={isDeleting}>
            {isDeleting ? (
              <>
                <span className="spinner-border spinner-border-sm me-2" />
                {t('manageKBs.deleteModal.deleting')}
              </>
            ) : (
              t('common.delete')
            )}
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  );
}
