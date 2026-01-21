import { useEffect, useState } from 'react';
import { resolveToolDescriptor } from '../utils/ToolConfig';
import { useAuth } from '../Providers/AuthProvider';
import { downloadFileFromS3 } from '../utils/s3Utils';
import { getFileIconClass } from '../utils/fileUtils';
import type { AwsCredentialIdentity } from '@aws-sdk/types';
import { getIntegrationsPayload } from './helpers';
import { useTranslation } from 'react-i18next';
import type {
  IntegrationFile as IntegrationDownloadFile,
  IntegrationsFileDownloadPayload,
  ToolResultLike,
} from './helpers';

// helper functions moved to ./helpers

/**
 * File download and "Use in chat" button component
 */
const FileDownloadButton = ({
  file,
  integration: _integration,
  conversationId,
  sub,
  numaChatDynamoUtils,
  setMessages,
}: {
  file: IntegrationDownloadFile;
  integration: string;
  conversationId?: string;
  sub?: string;
  numaChatDynamoUtils?: {
    addFileMessage: (args: {
      conversationId: string;
      userId: string;
      fileName: string;
      fileType: string;
      s3Key: string;
      s3Bucket: string;
      extractedContentS3Key?: string;
    }) => Promise<unknown>;
  };
  setMessages?: (
    fn: (prev: Array<{ role: string; segments?: unknown[] }>) => Array<{ role: string; segments?: unknown[] }>,
  ) => void;
}) => {
  const { getCredentials } = useAuth() as { getCredentials: () => Promise<AwsCredentialIdentity> };
  const { t } = useTranslation('common');
  const [isDownloading, setIsDownloading] = useState(false);
  const [isAddingToChat, setIsAddingToChat] = useState(false);
  const [addedToChat, setAddedToChat] = useState(false);

  const handleDownload = async () => {
    if (isDownloading) return;

    setIsDownloading(true);
    try {
      const s3Key = file.s3Key;
      const s3Bucket = file.s3Bucket || file.extractedContentBucket;
      const region = window.sessionStorage.getItem('REGION');
      const filename = file.filename;

      if (!s3Key || !s3Bucket || !region) {
        console.error('Missing required S3 information for download', { s3Key, s3Bucket, region });
        return;
      }

      await downloadFileFromS3(s3Key, s3Bucket, region, getCredentials, filename);
    } catch (error) {
      console.error('Error downloading file from integration:', error);
    } finally {
      setIsDownloading(false);
    }
  };

  const handleUseInChat = async () => {
    if (isAddingToChat || addedToChat || !conversationId || !sub || !numaChatDynamoUtils) return;

    setIsAddingToChat(true);
    try {
      await numaChatDynamoUtils.addFileMessage({
        conversationId,
        userId: sub,
        fileName: file.filename,
        fileType: file.filetype,
        s3Key: file.s3Key,
        s3Bucket: file.s3Bucket || file.extractedContentBucket,
        extractedContentS3Key: file.extractedContentS3Key,
      });

      // Add success message to chat (matches ChatFileUpload behavior)
      if (setMessages) {
        const region = window.sessionStorage.getItem('REGION');
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            segments: [
              {
                kind: 'file_upload',
                filename: file.filename,
                type: 'success',
                s3Key: file.s3Key,
                s3Bucket: file.s3Bucket || file.extractedContentBucket,
                region: region || undefined,
              },
            ],
          },
        ]);
      }

      setAddedToChat(true);
    } catch (error) {
      console.error('Error adding file to chat:', error);
    } finally {
      setIsAddingToChat(false);
    }
  };

  const iconClass = getFileIconClass(file.filename);
  const canUseInChat = Boolean(conversationId && sub && numaChatDynamoUtils);

  return (
    <div className="integration-file-item mb-3">
      {/* File display with download action */}
      <div
        className="file-message clickable"
        onClick={handleDownload}
        style={{ cursor: isDownloading ? 'wait' : 'pointer' }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleDownload();
          }
        }}
      >
        <i className={iconClass} />
        <span className="file-name">{file.filename}</span>
        {isDownloading ? (
          <div className="spinner-border spinner-border-sm ms-2" role="status">
            <span className="visually-hidden">{t('toolRenderers.integrations.downloading')}</span>
          </div>
        ) : (
          <div className="success-indicator">
            <i className="bi bi-download" />
          </div>
        )}
      </div>

      {/* Use in chat button */}
      {canUseInChat && (
        <button
          className={`btn btn-use-in-chat ${addedToChat ? 'added' : ''} mt-2 d-inline-flex align-items-center gap-2`}
          onClick={handleUseInChat}
          disabled={isAddingToChat || addedToChat}
        >
          {addedToChat ? (
            <>
              <i className="bi bi-check-circle-fill" />
              <span>{t('toolRenderers.integrations.addedToChat')}</span>
            </>
          ) : isAddingToChat ? (
            <>
              <div className="spinner-border spinner-border-sm" role="status">
                <span className="visually-hidden">{t('toolRenderers.integrations.adding')}</span>
              </div>
              <span>{t('toolRenderers.integrations.adding')}</span>
            </>
          ) : (
            <>
              <i className="bi bi-upload" />
              <span>{t('toolRenderers.integrations.useInChat')}</span>
            </>
          )}
        </button>
      )}
    </div>
  );
};

/**
 * Renderer for integration tools with special handling for file downloads
 */
export const IntegrationsRenderer = ({
  result,
  bare: _bare = false,
  conversationId,
  sub,
  numaChatDynamoUtils,
  setMessages,
}: {
  result: ToolResultLike;
  bare?: boolean;
  conversationId?: string;
  sub?: string;
  numaChatDynamoUtils?: {
    addFileMessage: (args: {
      conversationId: string;
      userId: string;
      fileName: string;
      fileType: string;
      s3Key: string;
      s3Bucket: string;
      extractedContentS3Key?: string;
    }) => Promise<unknown>;
  };
  setMessages?: (
    fn: (prev: Array<{ role: string; segments?: unknown[] }>) => Array<{ role: string; segments?: unknown[] }>,
  ) => void;
}) => {
  const rawName = (result && (result.name || result.toolName)) || 'tool';
  const status = (result && result.status) || 'completed';
  const toolUseId = (result && result.toolUseId) || null;
  const friendlyLabel = resolveToolDescriptor(rawName).label || rawName;
  const { t } = useTranslation('common');

  // Extract payload from content structure
  const payload = getIntegrationsPayload(result) as IntegrationsFileDownloadPayload | null;

  // Developer visibility without exposing payload in UI
  useEffect(() => {
    try {
      console.log('[ToolRenderer] Integration tool result', {
        name: rawName,
        label: friendlyLabel,
        status,
        toolUseId,
        result,
        payload,
      });
    } catch {
      // no-op
    }
  }, [rawName, friendlyLabel, status, toolUseId, result, payload]);

  // Special handling for file downloads
  if (payload?.type === 'integrations-file-download') {
    const files = payload?.files || [];
    const integration = payload?.integration || 'integration';

    return (
      <div className="integrations-file-download">
        {files.length > 0 && (
          <div className="files-container">
            {files.map((file: IntegrationDownloadFile, idx: number) => (
              <FileDownloadButton
                key={idx}
                file={file}
                integration={integration}
                conversationId={conversationId}
                sub={sub}
                numaChatDynamoUtils={numaChatDynamoUtils}
                setMessages={setMessages}
              />
            ))}
          </div>
        )}
        <div className="text-muted small mt-2" style={{ fontStyle: 'italic' }}>
          {t('toolRenderers.integrations.useInChatHint')}
        </div>
      </div>
    );
  }

  // Default behavior for other integration tool results
  return null;
};
