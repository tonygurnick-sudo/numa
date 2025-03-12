// ChatFileUpload.jsx
import React, { useState } from 'react';
import { Modal } from 'react-bootstrap';
import { S3UploadModule } from '../Modules/S3UploadModule';
import { processFile } from '../utils/fileProcessing';
import { fetchFileFromS3, uploadFileToS3 } from '../utils/s3Utils';
import { useAuth } from '../Providers/AuthProvider';

const ChatFileUpload = ({
  show,
  onHide,
  onUploadSuccess,
  setMessages,
  conversationId,
  sub,
  refreshSidebar,
  setIsFileProcessing,
  createNewConversationIfNeeded,
}) => {
  const { getIdentityPoolCredentials, bedrockRuntimeClient, numaChatDynamoUtils, numaChatBedrockUtils } = useAuth();
  const [uploadedFiles, setUploadedFiles] = useState([]);

  const handleUploadComplete = async (fileArray) => {
    setIsFileProcessing(true);
    onHide();

    // We'll store ephemeral message IDs per file
    const ephemeralMessageIds = [];

    try {
      let cid = conversationId;
      if (!cid) {
        cid = await createNewConversationIfNeeded();
      }

      for (let i = 0; i < fileArray.length; i++) {
        const { filePath, fileName, fileType, s3Bucket, file } = fileArray[i];

        // Create an ephemeral message for this file
        const ephemeralId = Date.now() + i;
        ephemeralMessageIds.push(ephemeralId);
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: `Processing file ${i + 1}/${fileArray.length}: ${fileName}...`,
            status: 'processingFile',
            ephemeralId,
          },
        ]);

        try {
          const isImage = fileType?.startsWith('image/');
          if (isImage) {
            const inferredType = fileType.split('/')[1];
            const processedFile = await processFile(file, inferredType, numaChatBedrockUtils);
            if (numaChatDynamoUtils && cid) {
              await numaChatDynamoUtils.addMessage({
                conversationId: cid,
                userId: sub,
                messageType: 'image_description',
                role: 'system',
                content: processedFile.content,
                fileInfo: { fileName, fileType, description: processedFile.content },
              });
            }
          } else {
            const region = window.sessionStorage.getItem('REGION');
            let inferredFileType = fileName?.split('.').pop().toLowerCase() || fileType || '';
            const fileContent = await fetchFileFromS3(filePath, s3Bucket, region, getIdentityPoolCredentials);
            const processedFile = await processFile(fileContent, inferredFileType, numaChatBedrockUtils);
            const extractedContentS3Key = `${filePath}-processed.${processedFile.inferredType}`;
            await uploadFileToS3(processedFile, s3Bucket, extractedContentS3Key, region, getIdentityPoolCredentials);

            const fileMetadata = {
              fileName,
              fileType: processedFile.inferredType,
              s3Key: filePath,
              s3Bucket,
              extractedContentS3Key,
              contentType: processedFile.contentType,
            };
            setUploadedFiles((prev) => [...prev, fileMetadata]);
            if (numaChatDynamoUtils && cid) {
              await numaChatDynamoUtils.addFileMessage({
                conversationId: cid,
                userId: sub,
                fileName: fileMetadata.fileName,
                fileType: fileMetadata.fileType,
                s3Key: fileMetadata.s3Key,
                s3Bucket: fileMetadata.s3Bucket,
                extractedContentS3Key: fileMetadata.extractedContentS3Key,
                contentType: fileMetadata.contentType,
              });
            }
            if (onUploadSuccess) {
              onUploadSuccess([fileMetadata]);
            }
          }

          // Remove ephemeral message for this file and add success message
          setMessages((prev) => prev.filter((msg) => msg.ephemeralId !== ephemeralId));
          setMessages((prev) => [...prev, { role: 'assistant', content: `File "${fileName}" uploaded and processed.` }]);
        } catch (fileError) {
          // Handle error for individual file
          console.error(`Error processing file ${fileName}:`, fileError);

          // First remove the ephemeral processing message for this file
          setMessages((prev) => prev.filter((msg) => msg.ephemeralId !== ephemeralId));

          // Then add a single error message
          setMessages((prev) => [...prev, {
            role: 'system',
            content: `Error processing file "${fileName}": ${fileError.message}`
          }]);
        }
      }

      refreshSidebar();
    } catch (error) {
      console.error('Error processing uploaded files:', error);
      ephemeralMessageIds.forEach((eid) => {
        setMessages((prev) => prev.filter((msg) => msg.ephemeralId !== eid));
      });
      setMessages((prev) => [...prev, { role: 'system', content: `Error while processing files: ${error.message}` }]);
    } finally {
      setIsFileProcessing(false);
    }
  };

  return (
    <Modal show={show} onHide={onHide} size="lg">
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
            <li>Images (jpg, jpeg, png, gif, webp)</li>
            <li>Presentations (pptx)</li>
            <li>JSON (json)</li>
            <li>HTML (html)</li>
            <li>Markdown (md)</li>
          </ul>
        </div>
      </Modal.Body>
    </Modal>
  );
};

export { ChatFileUpload };
