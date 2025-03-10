import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export const fetchFileFromS3 = async (s3Key, s3Bucket, region, getIdentityPoolCredentials) => {
  const credentials = await getIdentityPoolCredentials(); // Fetch credentials from AuthProvider

  if (!credentials?.accessKeyId) {
    throw new Error('AWS Credentials are missing.');
  }

  const s3Client = new S3Client({
    region,
    credentials,
  });

  const command = new GetObjectCommand({
    Bucket: s3Bucket,
    Key: s3Key,
  });

  const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

  const response = await fetch(signedUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch file: ${response.statusText}`);
  }

  const blob = await response.blob();
  return new Blob([blob], { type: response.headers.get('content-type') });
};

export const uploadFileToS3 = async (processedFile, s3Bucket, s3Key, region, getIdentityPoolCredentials) => {
  const credentials = await getIdentityPoolCredentials();
  const s3Client = new S3Client({ region, credentials });

  // Extract file details
  const { content, contentType, inferredType } = processedFile; // Destructure the processed file

  // Determine correct MIME type
  let mimeType = 'text/plain'; // Default to text

  // Check if the file is an image (jpg, jpeg, png, gif, webp)
  const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
  if (imageExtensions.includes(inferredType)) {
    mimeType = `image/${inferredType}`;
  } else if (contentType === 'text') {
    mimeType = 'text/plain'; // Explicitly ensure text files are marked correctly
  }

  // For images, use the original content
  const uploadContent = content instanceof Blob ? content : content;

  // Upload file to S3
  const command = new PutObjectCommand({
    Bucket: s3Bucket,
    Key: s3Key,
    Body: uploadContent, // Use processed content
    ContentType: mimeType, // Correctly inferred MIME type
  });

  await s3Client.send(command);
  return `s3://${s3Bucket}/${s3Key}`;
};
