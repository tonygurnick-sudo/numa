// ChatFileUpload.jsx
import { Modal } from 'react-bootstrap';
import { S3UploadModule } from '../Modules/S3UploadModule';
import { UploadStatusRow } from './UploadStatusRow';
import { useAuth } from '../Providers/AuthProvider';
import { useNumaRequest } from '../Providers/NumaRequestContext';
import { processFile } from '../utils/fileProcessing';

const ChatFileUpload = ({
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
  resetInactivityTimer = () => {},
}) => {
  const { numaChatDynamoUtils, user, getCredentials, bedrockRuntimeClient: _bedrockRuntimeClient } = useAuth();
  const { numaPost } = useNumaRequest();

  const handleUploadComplete = async (fileArray) => {
    // Validate input
    if (!fileArray || !Array.isArray(fileArray) || fileArray.length === 0) {
      console.log('No files were selected for upload');
      return;
    }

    setIsFileProcessing(true);
    onHide();

    try {
      const previewName = fileArray[0]?.fileName || '';
      const cid = await ensureConversationReady(previewName);
      if (!conversationId) {
        // Reset the new chat flag when creating conversation from file upload
        resetUserNewChatFlag();
      }

      // Reset inactivity timer so we don't bounce back to the new-chat suggestion view
      resetInactivityTimer();

      // Create auth context to pass to process function
      const authContext = { user };

      // Show a single generic processing message with spinner
      const processingMessageId = Date.now();
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: <UploadStatusRow text={`Processing ${fileArray.length} file(s)...`} showSpinner={true} />,
          status: 'processingFile',
          ephemeralId: processingMessageId,
        },
      ]);

      const results = [];
      const errors = [];

      // Process all files
      for (let i = 0; i < fileArray.length; i++) {
        const fileObj = fileArray[i];
        if (!fileObj || !fileObj.filePath || !fileObj.fileName) {
          errors.push(`Invalid file object at index ${i}`);
          continue;
        }

        const { filePath: s3Key, fileName, fileType, s3Bucket } = fileObj;

        try {
          const processedFile = await processFile({ s3Key, s3Bucket, fileName }, authContext, getCredentials, numaPost);

          // Store the result
          results.push(processedFile);

          // Add file message to DynamoDB
          await numaChatDynamoUtils.addFileMessage({
            conversationId: cid,
            userId: sub,
            fileName: fileName,
            fileType: fileType,
            s3Key: s3Key,
            s3Bucket: s3Bucket,
            extractedContentS3Key: processedFile.extractedContentS3Key,
          });

          // Add individual success message for this file
          setMessages((prev) => [
            ...prev,
            {
              role: 'assistant',
              content: `Successfully processed "${fileName}".`,
            },
          ]);
        } catch (error) {
          console.error(`Error processing file ${fileName}:`, error);
          errors.push(`${fileName}: ${error.message}`);

          // Add individual error message for this file
          setMessages((prev) => [
            ...prev,
            {
              role: 'system',
              content: `Failed to process "${fileName}": ${error.message}`,
            },
          ]);
        }
      }

      // Remove initial processing message
      setMessages((prev) => prev.filter((msg) => msg.ephemeralId !== processingMessageId));

      // Update the conversation meta so the chat appears immediately in sidebar
      try {
        const uploadedNames = fileArray
          .map((f) => f?.fileName)
          .filter(Boolean)
          .slice(0, 2)
          .join(', ');
        const moreCount = Math.max(0, fileArray.length - 2);
        let latestMessage: string;
        if (moreCount > 0) {
          latestMessage = `Uploaded ${uploadedNames} and ${moreCount} more`;
        } else {
          latestMessage = `Uploaded ${uploadedNames}`;
        }
        await numaChatDynamoUtils.updateMetaItem(cid, sub, {
          latestTimestamp: Date.now(),
          latestMessage,
        });
      } catch (e) {
        console.error('Failed to update meta after file upload:', e);
      }

      // Refresh sidebar to show new/updated conversation
      refreshSidebar();
    } catch (error) {
      console.error('Error processing uploaded files:', error);
      setMessages((prev) => [
        ...prev,
        {
          role: 'system',
          content: `Error while processing files: ${error.message}`,
        },
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
        <S3UploadModule
          task={{
            id: 'chatFileUpload',
            parameters: {
              allowedFileTypes: [
                // PDF
                'application/pdf',
                // Documents
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
                'text/plain',
                // Spreadsheets
                'text/csv',
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // xlsx
                // Images
                'image/jpeg',
                'image/png',
                'image/tiff',
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
          // @ts-ignore S3UploadModule passes selected files to onComplete
          onComplete={handleUploadComplete}
          onNotComplete={() => {}}
          onChange={() => {}}
        />
        <div className="supported-file-types">
          <h6>Supported File Types:</h6>
          <ul>
            <li>PDF (pdf)</li>
            <li>Documents (docx, txt)</li>
            <li>Spreadsheets (csv, xlsx)</li>
            <li>Images (jpg, jpeg, png, tiff)</li>
            <li>Audio/Video (mp3, mp4, wav, flac, ogg, amr, webm, m4a)</li>
            <li>Markdown (md)</li>
            <li>Other (json, xml, html, py, js, ts)</li>
          </ul>
        </div>
      </Modal.Body>
    </Modal>
  );
};

export { ChatFileUpload };
