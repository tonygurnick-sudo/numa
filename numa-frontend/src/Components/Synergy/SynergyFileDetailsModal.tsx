import { Modal, Table } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { formatFileSize } from '../../Services/filesService';
import type { SynergyFile } from '../../types/synergySync';

interface SynergyFileDetailsModalProps {
  show: boolean;
  file: SynergyFile | null;
  onHide: () => void;
}

/**
 * File details panel for a Synergy file. Renders the metadata already on the
 * row object (enriched by the backend `_normalize_file`) — no extra fetch
 * needed, so it works regardless of whether the `/files/{id}` details route is
 * deployed yet.
 */
export function SynergyFileDetailsModal({ show, file, onHide }: SynergyFileDetailsModalProps): React.JSX.Element {
  const { t } = useTranslation('files');

  const rows: { label: string; value?: string | number | null }[] = file
    ? [
        { label: t('synergy.documentStatus', 'Document status'), value: file.document_status },
        { label: t('synergy.revision', 'Revision'), value: file.revision },
        { label: t('synergy.version', 'Version'), value: file.version != null ? `v${file.version}` : undefined },
        { label: t('synergy.state', 'State'), value: file.state },
        {
          label: t('synergy.checkedOut', 'Checked out'),
          value: file.is_checked_out
            ? file.checked_out_by
              ? t('remote.checkedOutBy', { name: file.checked_out_by })
              : t('remote.checkedOut', 'Checked out')
            : t('synergy.no', 'No'),
        },
        { label: t('synergy.lastChangedBy', 'Last changed by'), value: file.last_changed_by },
        {
          label: t('synergy.modified', 'Modified'),
          value: file.modified_at ? new Date(file.modified_at).toLocaleString() : undefined,
        },
        {
          label: t('synergy.created', 'Created'),
          value: file.created_on ? new Date(file.created_on).toLocaleString() : undefined,
        },
        { label: t('synergy.size', 'Size'), value: file.size != null ? formatFileSize(file.size) : file.size_readable },
        { label: t('synergy.fileType', 'Type'), value: file.file_type },
        { label: t('synergy.path', 'Path'), value: file.path },
      ].filter((r) => r.value != null && r.value !== '')
    : [];

  return (
    <Modal show={show} onHide={onHide} centered>
      <Modal.Header closeButton>
        <Modal.Title className="text-truncate" title={file?.name}>
          {file?.name ?? t('actions.fileInfo', 'File information')}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Table size="sm" borderless className="mb-0">
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <td className="text-muted" style={{ width: '40%', whiteSpace: 'nowrap' }}>
                  {r.label}
                </td>
                <td className="fw-medium" style={{ wordBreak: 'break-word' }}>
                  {r.value}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Modal.Body>
    </Modal>
  );
}
