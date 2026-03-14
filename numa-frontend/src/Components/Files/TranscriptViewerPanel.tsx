import { Offcanvas } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { getFileIcon, formatFileSize } from '../../Services/filesService';
import type { TranscriptionJob, TranscriptionOutput } from '../../Services/TranscriptionService';

interface TranscriptViewerPanelProps {
  job: TranscriptionJob | null;
  output: TranscriptionOutput | null;
  loading: boolean;
  onClose: () => void;
}

const TranscriptViewerPanel = ({ job, output, loading, onClose }: TranscriptViewerPanelProps) => {
  const { t } = useTranslation('files');
  const show = job !== null;

  return (
    <Offcanvas show={show} onHide={onClose} placement="end" style={{ width: 500 }}>
      <Offcanvas.Header closeButton>
        <Offcanvas.Title className="d-flex align-items-center gap-2">
          <i className="bi bi-file-earmark-text" />
          {t('transcripts.viewer.title')}
        </Offcanvas.Title>
      </Offcanvas.Header>
      <Offcanvas.Body>
        {job && (
          <div className="d-flex flex-column h-100">
            {/* File header */}
            <div className="d-flex align-items-center gap-2 mb-3 pb-3 border-bottom">
              <i className={getFileIcon(job.fileName)} style={{ fontSize: '1.5rem' }} />
              <span className="fw-semibold text-truncate">{job.fileName}</span>
            </div>

            {/* Metadata */}
            <div className="mb-3 pb-3 border-bottom small text-muted">
              <div className="d-flex justify-content-between mb-1">
                <span>{t('transcripts.viewer.metadata.fileSize')}</span>
                <span>{formatFileSize(job.fileSize)}</span>
              </div>
              <div className="d-flex justify-content-between mb-1">
                <span>{t('transcripts.viewer.metadata.format')}</span>
                <code>{job.fileExtension}</code>
              </div>
              <div className="d-flex justify-content-between">
                <span>{t('transcripts.viewer.metadata.transcribed')}</span>
                <span>{new Date(job.createdAt).toLocaleDateString()}</span>
              </div>
            </div>

            {/* Content area */}
            <div className="flex-grow-1 overflow-auto">
              {loading && (
                <div className="text-center py-5">
                  <div className="spinner-border text-primary mb-3" />
                </div>
              )}

              {!loading && !output && (
                <div className="text-center py-5 text-muted">
                  <i className="bi bi-file-earmark-x d-block mb-2" style={{ fontSize: '2rem' }} />
                  <p>{t('transcripts.viewer.noContent')}</p>
                </div>
              )}

              {!loading && output && output.pages?.length > 0 && (
                <div style={{ fontSize: 14, lineHeight: 1.7 }}>
                  {output.pages.map((page, idx) => (
                    <div key={page.page_number}>
                      {output.pages.length > 1 && (
                        <div className="text-muted small fw-semibold mb-2 mt-1">
                          {t('transcripts.viewer.page', { num: page.page_number })}
                        </div>
                      )}
                      <div style={{ whiteSpace: 'pre-wrap' }}>{page.text}</div>
                      {idx < output.pages.length - 1 && <hr className="my-3" />}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Offcanvas.Body>
    </Offcanvas>
  );
};

export default TranscriptViewerPanel;
