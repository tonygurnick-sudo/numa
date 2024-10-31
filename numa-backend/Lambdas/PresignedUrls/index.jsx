import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const s3Client = new S3Client({ region: 'us-east-1' });
const BUCKET_NAME = process.env.BUCKET_NAME;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'http://localhost:5173';

if (!BUCKET_NAME) {
  throw new Error('BUCKET_NAME environment variable is required');
}

const headers = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'OPTIONS,GET',
  'Access-Control-Allow-Headers': 'Authorization,Content-Type',
  'Content-Type': 'application/json',
};

export const handler = async (event) => {
  console.log('Event received:', JSON.stringify(event, null, 2));

  if (event.requestContext.http.method === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: '',
    };
  }

  try {
    if (event.queryStringParameters?.operation === 'list') {
      const command = new ListObjectsV2Command({
        Bucket: BUCKET_NAME,
      });

      const response = await s3Client.send(command);
      const files = response.Contents.map((item) => ({
        key: item.Key,
        size: item.Size,
        lastModified: item.LastModified,
      }));

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ files }),
      };
    }

    const fileName = event.queryStringParameters?.fileName;
    if (!fileName) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: 'fileName is required in query parameters',
        }),
      };
    }

    const fileKey = fileName;

    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: fileKey,
    });

    const presignedUrl = await getSignedUrl(s3Client, command, {
      expiresIn: 300, // 5 minutes
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        uploadUrl: presignedUrl,
        fileKey: fileKey,
      }),
    };
  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
