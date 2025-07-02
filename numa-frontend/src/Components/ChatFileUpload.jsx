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
  setMessages,
  conversationId,
  sub,
  refreshSidebar,
  setIsFileProcessing,
  createNewConversationIfNeeded,
}) => {
  const { numaChatDynamoUtils, user, getCredentials } = useAuth();
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
      // Ensure we have a conversation ID
      let cid = conversationId;
      if (!cid) {
        cid = await createNewConversationIfNeeded();
      }

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
          task={{ id: 'chatFileUpload' }}
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
            <li>Images (jpg, jpeg, png)</li>
            <li>Markdown (md)</li>
            <li>Other (json, xml, html, tiff, py, js, ts)</li>
          </ul>
        </div>
      </Modal.Body>
    </Modal>
  );
};

export { ChatFileUpload };
