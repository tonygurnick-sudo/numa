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

export const uploadFileToS3 = async (content, contentType, s3Bucket, s3Key, region, getIdentityPoolCredentials) => {
  const credentials = await getIdentityPoolCredentials();
  const s3Client = new S3Client({ region, credentials });

  // Upload file to S3
  const command = new PutObjectCommand({
    Bucket: s3Bucket,
    Key: s3Key,
    Body: content,
    ContentType: contentType,
  });

  await s3Client.send(command);
  return `s3://${s3Bucket}/${s3Key}`;
};
