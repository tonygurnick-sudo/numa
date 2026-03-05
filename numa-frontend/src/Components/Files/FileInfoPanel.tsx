import { Offcanvas } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { getFileIcon, formatFileSize } from '../../Services/filesService';
import type { FileItem, FolderItem } from '../../Services/filesService';

interface RemoteFileInfo {
  name: string;
  size?: number;
  modified_at?: string;
  content_type?: string;
  provider?: string;
}

type InfoTarget =
  | { kind: 'file'; item: FileItem }
  | { kind: 'folder'; item: FolderItem }
  | { kind: 'remoteFile'; item: RemoteFileInfo }
  | null;

interface FileInfoPanelProps {
  target: InfoTarget;
  onClose: () => void;
}

const FileInfoPanel = ({ target, onClose }: FileInfoPanelProps) => {
  const { t } = useTranslation('files');

  const show = target !== null;

  return (
    <Offcanvas show={show} onHide={onClose} placement="end" style={{ width: 360 }}>
      <Offcanvas.Header closeButton>
        <Offcanvas.Title>{t('fileInfoPanel.title')}</Offcanvas.Title>
      </Offcanvas.Header>
      <Offcanvas.Body>
        {target && target.kind === 'file' && <FileInfoContent file={target.item} />}
        {target && target.kind === 'folder' && <FolderInfoContent folder={target.item} />}
        {target && target.kind === 'remoteFile' && <RemoteFileInfoContent file={target.item} />}
      </Offcanvas.Body>
    </Offcanvas>
  );
};

const FileInfoContent = ({ file }: { file: FileItem }) => {
  const { t } = useTranslation('files');
  const ext = file.name.includes('.') ? file.name.split('.').pop()?.toUpperCase() : '';

  return (
    <div className="d-flex flex-column gap-3">
      {/* Icon + name header */}
      <div className="text-center py-3">
        <i className={`${getFileIcon(file.name)} d-block mx-auto`} style={{ fontSize: '3rem', color: '#6c757d' }} />
        <h6 className="mt-2 mb-0 text-break">{file.name}</h6>
      </div>

      <hr className="my-0" />

      <InfoRow label={t('fileInfoPanel.name')} value={file.name} />
      <InfoRow label={t('fileInfoPanel.size')} value={formatFileSize(file.size_bytes)} />
      <InfoRow label={t('fileInfoPanel.modified')} value={new Date(file.last_modified).toLocaleString()} />
      <InfoRow label={t('fileInfoPanel.path')} value={file.parent_path || '/'} />
      {ext && <InfoRow label={t('fileInfoPanel.type')} value={`${ext} file`} />}
    </div>
  );
};

const FolderInfoContent = ({ folder }: { folder: FolderItem }) => {
  const { t } = useTranslation('files');

  return (
    <div className="d-flex flex-column gap-3">
      <div className="text-center py-3">
        <i className="bi bi-folder-fill d-block mx-auto" style={{ fontSize: '3rem', color: '#ffc107' }} />
        <h6 className="mt-2 mb-0 text-break">{folder.name}</h6>
      </div>

      <hr className="my-0" />

      <InfoRow label={t('fileInfoPanel.name')} value={folder.name} />
      <InfoRow label={t('fileInfoPanel.modified')} value={new Date(folder.updated_at).toLocaleString()} />
      <InfoRow label={t('fileInfoPanel.path')} value={folder.path || '/'} />
      <InfoRow label={t('fileInfoPanel.type')} value="Folder" />
    </div>
  );
};

const RemoteFileInfoContent = ({ file }: { file: RemoteFileInfo }) => {
  const { t } = useTranslation('files');
  const ext = file.name.includes('.') ? file.name.split('.').pop()?.toUpperCase() : '';

  return (
    <div className="d-flex flex-column gap-3">
      <div className="text-center py-3">
        <i className={`${getFileIcon(file.name)} d-block mx-auto`} style={{ fontSize: '3rem', color: '#6c757d' }} />
        <h6 className="mt-2 mb-0 text-break">{file.name}</h6>
      </div>

      <hr className="my-0" />

      <InfoRow label={t('fileInfoPanel.name')} value={file.name} />
      {file.size != null && <InfoRow label={t('fileInfoPanel.size')} value={formatFileSize(file.size)} />}
      {file.modified_at && (
        <InfoRow label={t('fileInfoPanel.modified')} value={new Date(file.modified_at).toLocaleString()} />
      )}
      {file.provider && <InfoRow label={t('fileInfoPanel.source')} value={file.provider} />}
      {ext && <InfoRow label={t('fileInfoPanel.type')} value={`${ext} file`} />}
    </div>
  );
};

const InfoRow = ({ label, value }: { label: string; value: string }) => (
  <div>
    <div className="text-muted small fw-semibold">{label}</div>
    <div className="text-break" style={{ fontSize: 14 }}>
      {value}
    </div>
  </div>
);

export type { InfoTarget };
export default FileInfoPanel;
