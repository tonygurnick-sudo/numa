import React, { useState, useCallback, useRef } from 'react';
import { Button, Form, Card, Badge, Table, ProgressBar } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { useNumaRequest } from '../../../Providers/NumaRequestContext';
import * as OpsService from '../../../Services/OpsService';
import type { Document as OpsDocument, DocTypeEntry, CreateDocumentPayload } from '../../../types/ops';

interface DocumentSectionProps {
  entityType: 'customer' | 'supplier';
  entityId: string;
  documents?: OpsDocument[];
  documentTypes?: DocTypeEntry[];
}

/** Default document type list used when `documentTypes` prop is not provided. */
const DEFAULT_DOCUMENT_TYPES: DocTypeEntry[] = [
  { id: 'contract', name: 'Contract' },
  { id: 'proposal', name: 'Proposal' },
  { id: 'sla', name: 'SLA' },
  { id: 'quote', name: 'Quote' },
  { id: 'invoice', name: 'Invoice' },
  { id: 'certificate', name: 'Certificate' },
  { id: 'other', name: 'Other' },
];

/**
 * Convert a byte count to a human-readable string (e.g. "1.2 KB", "3.4 MB").
 */
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/**
 * DocumentSection renders a table of uploaded documents for a customer or
 * supplier. It supports uploading new documents through a presigned-URL flow,
 * and deleting existing documents.
 */
export function DocumentSection({
  entityType,
  entityId,
  documents: documentsProp,
  documentTypes,
}: DocumentSectionProps): React.JSX.Element {
  const { t } = useTranslation('ops');
  const { numaPost, numaDelete } = useNumaRequest();

  // ── Local state ───────────────────────────────────────────────────────────

  const [localDocuments, setLocalDocuments] = useState<OpsDocument[]>(documentsProp ?? []);
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  // Upload form fields
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [docType, setDocType] = useState<string>((documentTypes ?? DEFAULT_DOCUMENT_TYPES)[0]?.id ?? 'other');
  const [notes, setNotes] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Available types derived from the prop or the default list.
  const typeList = documentTypes ?? DEFAULT_DOCUMENT_TYPES;

  // Keep in sync with parent if prop changes.
  React.useEffect(() => {
    if (documentsProp) {
      setLocalDocuments(documentsProp);
    }
  }, [documentsProp]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const resetForm = () => {
    setSelectedFile(null);
    setDocType(typeList[0]?.id ?? 'other');
    setNotes('');
    setUploadProgress(0);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleUpload = useCallback(async () => {
    if (!selectedFile) return;
    setUploading(true);
    setUploadProgress(10);

    try {
      // Step 1: Get a presigned upload URL from the backend.
      const { uploadUrl, s3Key } = await OpsService.getPresignedUrl(numaPost, {
        context: entityType,
        contextId: entityId,
        fileName: selectedFile.name,
      });

      setUploadProgress(30);

      // Step 2: Upload the file directly to S3 via the presigned URL.
      const uploadResponse = await fetch(uploadUrl, {
        method: 'PUT',
        body: selectedFile,
        headers: { 'Content-Type': selectedFile.type || 'application/octet-stream' },
      });

      if (!uploadResponse.ok) {
        throw new Error(`S3 upload failed: ${uploadResponse.statusText}`);
      }

      setUploadProgress(70);

      // Step 3: Register the document record in the backend.
      const payload: CreateDocumentPayload = {
        type: docType,
        name: selectedFile.name,
        s3Key,
        s3Bucket: 'numa-ops-documents',
        size: selectedFile.size,
        notes: notes.trim() || null,
      };

      let created: OpsDocument;
      if (entityType === 'customer') {
        created = await OpsService.createCustomerDocument(numaPost, entityId, payload);
      } else {
        created = await OpsService.createSupplierDocument(numaPost, entityId, payload);
      }

      setUploadProgress(100);
      setLocalDocuments((prev) => [created, ...prev]);
      resetForm();
      setShowUploadForm(false);
    } catch (err) {
      console.error('[DocumentSection] Upload failed', err);
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  }, [selectedFile, docType, notes, entityType, entityId, numaPost]);

  const handleDelete = useCallback(
    async (documentId: string) => {
      // Only customer documents have a delete endpoint.
      if (entityType !== 'customer') return;

      if (!window.confirm(t('documents.deleteConfirm'))) return;

      try {
        await OpsService.deleteCustomerDocument(numaDelete, entityId, documentId);
        setLocalDocuments((prev) => prev.filter((d) => d.id !== documentId));
      } catch (err) {
        console.error('[DocumentSection] Failed to delete document', err);
      }
    },
    [entityType, entityId, numaDelete, t],
  );

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };

  /** Look up the display name for a document type ID, falling back to the raw string. */
  const resolveTypeName = (typeId: string) => {
    const entry = typeList.find((dt) => dt.id === typeId);
    return entry?.name ?? typeId.charAt(0).toUpperCase() + typeId.slice(1);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Header + Upload button */}
      <div className="d-flex justify-content-between align-items-center mb-2">
        <span className="fw-semibold small">{t('crm.documents')}</span>
        {!showUploadForm && (
          <Button variant="outline-primary" size="sm" onClick={() => setShowUploadForm(true)}>
            <i className="bi bi-upload me-1" />
            {t('documents.upload')}
          </Button>
        )}
      </div>

      {/* ── Upload Form ──────────────────────────────────────────────────── */}
      {showUploadForm && (
        <Card className="mb-3">
          <Card.Body className="p-2">
            <div className="row g-2">
              {/* File picker */}
              <div className="col-12">
                <Form.Label className="small mb-0">
                  {t('documents.selectFile')} <span className="text-danger">*</span>
                </Form.Label>
                <Form.Control
                  ref={fileInputRef}
                  size="sm"
                  type="file"
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                    const file = e.target.files?.[0] ?? null;
                    setSelectedFile(file);
                  }}
                />
              </div>

              {/* Document type */}
              <div className="col-sm-6">
                <Form.Label className="small mb-0">{t('documents.type')}</Form.Label>
                <Form.Select size="sm" value={docType} onChange={(e) => setDocType(e.target.value)}>
                  {typeList.map((dt) => (
                    <option key={dt.id} value={dt.id}>
                      {dt.name}
                    </option>
                  ))}
                </Form.Select>
              </div>

              {/* Notes */}
              <div className="col-sm-6">
                <Form.Label className="small mb-0">
                  {t('documents.notes')} ({t('common.optional')})
                </Form.Label>
                <Form.Control
                  size="sm"
                  as="textarea"
                  rows={1}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
            </div>

            {/* Progress bar */}
            {uploading && <ProgressBar animated now={uploadProgress} className="mt-2" style={{ height: 6 }} />}

            <div className="d-flex gap-1 justify-content-end mt-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  resetForm();
                  setShowUploadForm(false);
                }}
                disabled={uploading}
              >
                {t('common.cancel')}
              </Button>
              <Button variant="primary" size="sm" onClick={handleUpload} disabled={uploading || !selectedFile}>
                {uploading ? t('documents.uploading') : t('common.save')}
              </Button>
            </div>
          </Card.Body>
        </Card>
      )}

      {/* ── Documents Table ──────────────────────────────────────────────── */}
      {localDocuments.length === 0 && !showUploadForm && (
        <div className="text-muted small">{t('empty.noDocuments')}</div>
      )}

      {localDocuments.length > 0 && (
        <Table size="sm" hover responsive className="small mb-0">
          <thead>
            <tr>
              <th>{t('documents.name')}</th>
              <th>{t('documents.type')}</th>
              <th>{t('documents.size')}</th>
              <th>{t('documents.uploadedBy')}</th>
              <th>{t('documents.uploadedAt')}</th>
              <th style={{ width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {localDocuments.map((doc) => (
              <tr key={doc.id}>
                <td className="text-truncate" style={{ maxWidth: 200 }} title={doc.name}>
                  {doc.name}
                </td>
                <td>
                  <Badge bg="light" text="dark">
                    {resolveTypeName(doc.type)}
                  </Badge>
                </td>
                <td>{formatFileSize(doc.size)}</td>
                <td>{doc.uploadedBy}</td>
                <td>{formatDate(doc.uploadedAt)}</td>
                <td>
                  {entityType === 'customer' && (
                    <Button
                      variant="link"
                      size="sm"
                      className="p-0 text-danger"
                      onClick={() => handleDelete(doc.id)}
                      title={t('common.delete')}
                    >
                      <i className="bi bi-trash" />
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
