import React, { useEffect, useRef, useState } from 'react';
import { Modal } from 'react-bootstrap';
import { S3UploadModule } from '../../Modules/S3UploadModule';
import { UploadStatusRow } from '../Status/UploadStatusRow';
import { useAuth } from '../../Providers/AuthProvider';
import { useNumaRequest } from '../../Providers/NumaRequestContext';
import { useKnowledgeBase } from '../../Providers/KnowledgeBaseProvider';
import { processFile } from '../../utils/fileProcessing';
import type { AgentSummary } from '../../types/agents';

declare global {
  interface Window {
    /** NewChat calls this to inject files AND auto-start upload (no staging). */
    __ingestAndStart?: (files: File[]) => void;
    /** Fallback cache set by NewChat when the bridge isn’t ready yet. */
    __pendingFiles?: File[];
  }
}

type ReferenceFile = {
  fileName: string;
  fileType: string;
  s3Key: string;
  s3Bucket: string;
  extractedContentS3Key?: string;
};

type AgentMeta = {
  agentId: string;
  title?: string;
  version?: string;
  icon?: string;
  agentType?: string;
  visibility?: string;
};

type FileResult = {
  filePath: string;
  fileName: string;
  fileType: string;
  s3Bucket: string;
};

type ChatMessage = {
  role: 'assistant' | 'system' | 'user';
  content: React.ReactNode | string;
  status?: string;
  ephemeralId?: number;
};

type SetMessages = ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[]);

type ChatFileUploadProps = {
  show: boolean;
  onHide: () => void;
  getAccessToken?: () => Promise<string>;
  setMessages: (updater: SetMessages) => void;
  conversationId?: string | null;
  sub: string;
  refreshSidebar: () => void;
  setIsFileProcessing: (b: boolean) => void;
  ensureConversationReady: (title?: string, agentMeta?: AgentMeta) => Promise<string>;
  resetUserNewChatFlag?: () => void;
  pendingAgent?: (AgentSummary & { referenceFiles?: ReferenceFile[] }) | null;
  currentAgent?: AgentSummary | null;
  setPendingAgent?: (a: AgentSummary | null) => void;
  resetInactivityTimer?: () => void;
  dataAnalysisAvailable?: boolean;
  dataAnalysisToolEnabled?: boolean;
  onFilesUploaded?: (files: FileResult[]) => void;
};

type UploaderRef = {
  acceptUserSelection?: (files: File[], opts?: { autoStart?: boolean }) => Promise<void> | void;
  startUpload?: () => Promise<void> | void;
} | null;

export const ChatFileUpload = ({
  show,
  onHide,
  getAccessToken: _getAccessToken,
  setMessages,
  conversationId,
  sub,
  refreshSidebar,
  setIsFileProcessing,
  ensureConversationReady,
  resetUserNewChatFlag = () => {},
  pendingAgent = null,
  currentAgent = null,
  setPendingAgent,
  resetInactivityTimer = () => {},
  dataAnalysisAvailable = true,
  dataAnalysisToolEnabled = false,
  onFilesUploaded,
}: ChatFileUploadProps) => {
  const { numaChatDynamoUtils, user, getCredentials } = useAuth();
  const { numaPost } = useNumaRequest();
  const { selectedKB, selectedKbId } = useKnowledgeBase();
  const [showCsvWarning, setShowCsvWarning] = useState(false);
  const [csvNoticeShown, setCsvNoticeShown] = useState(false);
  const csvWarningText =
    'CSV support is limited when Data Analysis is off. Enable Data Analysis in chat tools to analyze CSV files.';

  // Imperative access into S3UploadModule
  const uploadRef = useRef<UploaderRef>(null);

  // Expose a bridge while modal is open and flush any pending files
  useEffect(() => {
    if (!show) return;

    const bridge = (files: File[]) => {
      if (!files?.length) return;
      const mod = uploadRef.current;
      if (mod && typeof mod.acceptUserSelection === 'function') {
        // Route through the same path as native input selection; auto-start is handled inside
        mod.acceptUserSelection(files, { autoStart: true });
      } else {
        console.warn('[ChatFileUpload] S3UploadModule.acceptUserSelection not exposed');
      }
    };

    window.__ingestAndStart = bridge;

    // Flush fallback cache (if NewChat stashed files while we were mounting)
    const pending = window.__pendingFiles;
    if (pending?.length) {
      try {
        bridge(pending);
      } finally {
        delete window.__pendingFiles;
      }
    }

    return () => {
      if (window.__ingestAndStart === bridge) delete window.__ingestAndStart;
    };
  }, [show]);

  // Reset warning state when modal closes
  useEffect(() => {
    if (!show) {
      setShowCsvWarning(false);
      setCsvNoticeShown(false);
    }
  }, [show]);

  const handleUploadComplete = async (fileArray: FileResult[]) => {
    if (!Array.isArray(fileArray) || fileArray.length === 0) {
      console.log('No files were selected for upload');
      return;
    }

    setIsFileProcessing(true);
    onHide(); // close modal immediately — chat shows "Processing..."

    try {
      const activeAgent: AgentSummary | null = pendingAgent || currentAgent || null;
      const previewName = fileArray[0]?.fileName || '';
      const conversationWasNew = !conversationId;
      let cid: string;

      if (activeAgent) {
        const agentMeta: AgentMeta = {
          agentId: activeAgent.agentId,
          title: activeAgent.title,
          // @ts-expect-error optional custom fields may exist on agent
          version: (activeAgent as Record<string, unknown>)['version'] as string | undefined,
          // @ts-expect-error optional custom fields may exist on agent
          icon: (activeAgent as Record<string, unknown>)['icon'] as string | undefined,
          agentType: activeAgent.agentType,
          visibility: activeAgent.visibility,
        };
        cid = await ensureConversationReady(previewName, agentMeta);
      } else {
        cid = await ensureConversationReady(previewName);
      }

      if (conversationWasNew) {
        resetUserNewChatFlag();
        if (pendingAgent?.referenceFiles?.length && numaChatDynamoUtils) {
          for (const file of pendingAgent.referenceFiles) {
            try {
              await numaChatDynamoUtils.addFileMessage({
                conversationId: cid,
                userId: sub,
                fileName: file.fileName,
                fileType: file.fileType,
                s3Key: file.s3Key,
                s3Bucket: file.s3Bucket,
                extractedContentS3Key: file.extractedContentS3Key,
                messageContext: 'agent_reference',
              });
            } catch (err) {
              console.error('Error attaching agent reference file during upload:', err);
            }
          }
          setPendingAgent?.(null);
        }
      }

      resetInactivityTimer?.();

      const authContext = { user };
      const processingMessageId = Date.now();

      setMessages((prev: ChatMessage[]) => [
        ...prev,
        {
          role: 'assistant',
          content: <UploadStatusRow text={`Processing ${fileArray.length} file(s)...`} showSpinner={true} />,
          status: 'processingFile',
          ephemeralId: processingMessageId,
        },
      ]);

      for (let i = 0; i < fileArray.length; i++) {
        const fileObj = fileArray[i];
        if (!fileObj || !fileObj.filePath || !fileObj.fileName) {
          setMessages((prev: ChatMessage[]) => [...prev, { role: 'system', content: `Invalid file at index ${i}` }]);
          continue;
        }

        const { filePath: s3Key, fileName, fileType, s3Bucket } = fileObj;

        try {
          const processedFile = await processFile({ s3Key, s3Bucket, fileName }, authContext, getCredentials, numaPost);

          await numaChatDynamoUtils.addFileMessage({
            conversationId: cid,
            userId: sub,
            fileName,
            fileType,
            s3Key,
            s3Bucket,
            extractedContentS3Key: processedFile.extractedContentS3Key,
          });

          setMessages((prev: ChatMessage[]) => [
            ...prev,
            { role: 'assistant', content: `Successfully processed "${fileName}".` },
          ]);
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);

          console.error(`Error processing file ${fileName}:`, error);
          setMessages((prev: ChatMessage[]) => [
            ...prev,
            { role: 'system', content: `Failed to process "${fileName}": ${msg}` },
          ]);
        }
      }

      setMessages((prev: ChatMessage[]) => prev.filter((m) => m.ephemeralId !== processingMessageId));

      try {
        const uploadedNames = fileArray
          .map((f) => f?.fileName)
          .filter(Boolean)
          .slice(0, 2)
          .join(', ');
        const moreCount = Math.max(0, fileArray.length - 2);
        const latestMessage =
          moreCount > 0 ? `Uploaded ${uploadedNames} and ${moreCount} more` : `Uploaded ${uploadedNames}`;
        await numaChatDynamoUtils.updateMetaItem(cid, sub, {
          latestTimestamp: Date.now(),
          latestMessage,
        });
      } catch (e) {
        console.error('Failed to update meta after file upload:', e);
      }

      refreshSidebar();
      if (typeof onFilesUploaded === 'function') {
        onFilesUploaded(fileArray);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);

      console.error('Error processing uploaded files:', error);
      setMessages((prev: ChatMessage[]) => [
        ...prev,
        { role: 'system', content: `Error while processing files: ${msg}` },
      ]);
    } finally {
      setIsFileProcessing(false);
    }
  };

  return (
    <Modal show={show} onHide={onHide} size="lg" animation={false}>
      <Modal.Header closeButton>
        <Modal.Title>Upload Files</Modal.Title>
      </Modal.Header>
      <Modal.Body data-testid="upload-modal-body">
        {showCsvWarning && (
          <div className="alert alert-warning" role="alert" data-testid="csv-warning">
            {csvWarningText}
          </div>
        )}
        <S3UploadModule
          ref={uploadRef}
          task={{
            id: 'chatFileUpload',
            parameters: {
              allowedFileTypes: [
                // PDF
                'application/pdf',
                // Documents
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                'text/plain',
                // Spreadsheets
                'text/csv',
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                // Images
                'image/jpeg',
                'image/png',
                // Audio/Video
                'audio/mpeg',
                'video/mp4',
                'audio/wav',
                'audio/flac',
                'audio/ogg',
                'audio/amr',
                'video/webm',
                'audio/mp4',
                'audio/x-m4a',
                // Markdown
                'text/markdown',
                // Other text files
                'application/json',
                'text/xml',
                'application/xml',
                'text/html',
                'text/x-python',
                'application/x-python-code',
                'text/javascript',
                'application/javascript',
                'text/typescript',
                'application/typescript',
              ],
            },
          }}
          // @ts-expect-error uploader passes raw results (with filePath/fileName) to onComplete
          onComplete={handleUploadComplete}
          onNotComplete={() => {}}
          onChange={(files) => {
            // Preserve existing behavior after upload completes; do not clear the warning here
            if (!files || typeof files === 'string') return;
            if (Array.isArray(files)) {
              const hasCsv = files.some((f) => {
                const type = (f as { fileType?: string }).fileType?.toLowerCase() || '';
                const name = (f as { fileName?: string }).fileName || (f as { name?: string }).name || '';
                return type === 'text/csv' || name.toLowerCase().endsWith('.csv');
              });
              setShowCsvWarning(Boolean(hasCsv && dataAnalysisAvailable && !dataAnalysisToolEnabled));
            }
          }}
          onSelectFiles={(files) => {
            if (!files?.length) {
              setShowCsvWarning(false);
              return;
            }
            const hasCsv = files.some((f) => {
              const type = f.type?.toLowerCase() || '';
              const name = f.name?.toLowerCase() || '';
              return type === 'text/csv' || name.endsWith('.csv');
            });
            const shouldWarn = Boolean(hasCsv && dataAnalysisAvailable && !dataAnalysisToolEnabled);
            setShowCsvWarning(shouldWarn);
            if (shouldWarn && !csvNoticeShown) {
              setMessages((prev: ChatMessage[]) => [
                ...prev,
                { role: 'system', content: csvWarningText, status: 'info' },
              ]);
              setCsvNoticeShown(true);
            }
          }}
          kb_id={selectedKbId || selectedKB?.kb_id || null}
        />

        <div className="supported-file-types mt-3">
          <h6>Supported File Types:</h6>
          <ul>
            <li>PDF (pdf)</li>
            <li>Documents (docx, txt)</li>
            <li>Spreadsheets (csv, xlsx)</li>
            <li>Images (jpg, jpeg, png)</li>
            <li>Audio/Video (mp3, mp4, wav, flac, ogg, amr, webm, m4a)</li>
            <li>Markdown (md)</li>
            <li>Other (json, xml, html, py, js, ts)</li>
          </ul>
        </div>
      </Modal.Body>
    </Modal>
  );
};
