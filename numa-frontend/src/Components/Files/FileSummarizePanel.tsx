import { useState, useEffect, useRef, useCallback } from 'react';
import { Offcanvas } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import type { FileItem, FileScope } from '../../Services/filesService';
import { buildS3Key, getFileIcon } from '../../Services/filesService';
import { useAuth } from '../../Providers/AuthProvider';
import { getEffectiveLanguage } from '../../utils/languagePreference';
import { streamWorkspaceChatAgent } from '../../Services/workspaceChatAgentService';
import type { SDKEvent } from '../../types/workspaceChatTypes';

interface FileSummarizePanelProps {
  file: FileItem | null;
  scope: FileScope;
  currentPath: string;
  onClose: () => void;
}

type SummarizeStatus = 'idle' | 'streaming' | 'success' | 'error';

const FileSummarizePanel = ({ file, scope, currentPath, onClose }: FileSummarizePanelProps) => {
  const { t } = useTranslation('files');
  const { user } = useAuth();
  const [status, setStatus] = useState<SummarizeStatus>('idle');
  const [summary, setSummary] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const abortRef = useRef<(() => void) | null>(null);

  const show = file !== null;

  const cleanup = useCallback(() => {
    if (abortRef.current) {
      abortRef.current();
      abortRef.current = null;
    }
  }, []);

  // Start summarization when file changes
  useEffect(() => {
    if (!file || !user) return;
    startSummarization(file);
    return () => cleanup();
  }, [file]);

  const startSummarization = async (targetFile: FileItem) => {
    setStatus('streaming');
    setSummary('');
    setErrorMsg('');
    cleanup();

    const userSub = (user?.decoded_tokens?.idToken?.sub as string) || '';
    const s3Key = buildS3Key(scope, targetFile.name, currentPath, userSub);
    const language = getEffectiveLanguage();

    const prompt = `Summarize the following file concisely. Respond in ${language === 'browser' ? 'English' : language}.\n\nFile: ${targetFile.name}\nS3 Key: ${s3Key}`;

    try {
      const { abort } = await streamWorkspaceChatAgent(
        {
          prompt,
          conversationId: `summarize-${crypto.randomUUID()}`,
          attachments: {
            files: [
              {
                path: s3Key,
                filename: targetFile.name,
                size: targetFile.size_bytes,
              },
            ],
          },
          hasUploads: false,
          enabledTools: [],
          enabledConnections: [],
          responseMode: 'stream',
        },
        // onEvent — accumulate text deltas
        (event: SDKEvent) => {
          if (event.type === 'StreamEvent') {
            const streamEvent = (event as { event?: { type?: string; delta?: { type?: string; text?: string } } })
              .event;
            if (
              streamEvent?.type === 'content_block_delta' &&
              streamEvent.delta?.type === 'text_delta' &&
              streamEvent.delta.text
            ) {
              setSummary((prev) => prev + streamEvent.delta!.text!);
            }
          }
        },
        // onComplete
        () => {
          setStatus('success');
          abortRef.current = null;
        },
        // onError
        (err: Error) => {
          setStatus('error');
          setErrorMsg(err.message);
          abortRef.current = null;
        }
      );

      abortRef.current = abort;
    } catch (err) {
      setStatus('error');
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const handleRetry = () => {
    if (file) startSummarization(file);
  };

  const handleClose = () => {
    cleanup();
    onClose();
  };

  return (
    <Offcanvas show={show} onHide={handleClose} placement="end" style={{ width: 450 }}>
      <Offcanvas.Header closeButton>
        <Offcanvas.Title className="d-flex align-items-center gap-2">
          <i className="bi bi-stars" />
          {t('summarizePanel.title')}
        </Offcanvas.Title>
      </Offcanvas.Header>
      <Offcanvas.Body>
        {file && (
          <div className="d-flex flex-column h-100">
            {/* File header */}
            <div className="d-flex align-items-center gap-2 mb-3 pb-3 border-bottom">
              <i className={`${getFileIcon(file.name)}`} style={{ fontSize: '1.5rem' }} />
              <span className="fw-semibold text-truncate">{file.name}</span>
            </div>

            {/* Content area */}
            <div className="flex-grow-1 overflow-auto">
              {status === 'streaming' && !summary && (
                <div className="text-center py-5">
                  <div className="spinner-border text-primary mb-3" />
                  <p className="text-muted">{t('summarizePanel.generating')}</p>
                  <p className="text-muted small">{t('summarizePanel.generatingDetail')}</p>
                </div>
              )}

              {summary && (
                <div className="summary-content" style={{ fontSize: 14, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
                  {summary}
                  {status === 'streaming' && <span className="text-muted">|</span>}
                </div>
              )}

              {status === 'error' && (
                <div className="text-center py-5">
                  <i className="bi bi-exclamation-triangle text-warning d-block mb-2" style={{ fontSize: '2rem' }} />
                  <p className="text-muted">{t('summarizePanel.error')}</p>
                  {errorMsg && <p className="text-muted small">{errorMsg}</p>}
                  <button className="btn btn-outline-primary btn-sm mt-2" onClick={handleRetry}>
                    {t('summarizePanel.retry')}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </Offcanvas.Body>
    </Offcanvas>
  );
};

export default FileSummarizePanel;
