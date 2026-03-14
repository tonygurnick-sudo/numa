import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';
import * as process from 'node:process';
import { convertMdToDocx, convertMdToPdf, convertPdfToDocx, convertGenericToPdf } from './lib/converter.js';

// Initialize S3 client
const s3Client = new S3Client({});
const outputsBucket = process.env.OUTPUTS_BUCKET || '';

// Request/Response interfaces
interface ConvertRequest {
  // Action type: 'markdown' (default) for MD conversion, 'file' for direct file conversion
  action?: 'markdown' | 'file';

  // For markdown conversion
  markdown?: string;

  // For file conversion or markdown from S3
  sourceBucket?: string;
  sourceKey?: string;

  // Output format
  format: 'docx' | 'pdf';

  // Optional metadata
  title?: string;
  filename?: string;
}

interface ConvertResponse {
  success: boolean;
  downloadUrl: string;
  filename: string;
  size: number;
}

interface ErrorResponse {
  success: boolean;
  error: string;
}

/**
 * Sanitize filename for safe file system use
 */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9-_]/g, '_')
    .replace(/_+/g, '_')
    .substring(0, 100);
}

/**
 * Generate output filename
 */
function generateFilename(
  title: string | undefined,
  customFilename: string | undefined,
  format: 'docx' | 'pdf'
): string {
  if (customFilename) {
    const sanitized = sanitizeFilename(customFilename);
    // Remove extension if present, add correct one
    const base = sanitized.replace(/\.(docx|pdf)$/i, '');
    return `${base}.${format}`;
  }

  if (title) {
    const sanitized = sanitizeFilename(title);
    return `${sanitized}.${format}`;
  }

  return `document_${uuidv4().substring(0, 8)}.${format}`;
}

/**
 * Get content type for format
 */
function getContentType(format: 'docx' | 'pdf'): string {
  return format === 'docx'
    ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    : 'application/pdf';
}

/**
 * Main Lambda handler
 */
export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  console.log('Received event:', JSON.stringify(event, null, 2));

  try {
    // Parse request body
    if (!event.body) {
      return errorResponse(400, 'Request body is required');
    }

    const bodyStr = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString() : event.body;
    const request: ConvertRequest = JSON.parse(bodyStr);

    // Validate request
    if (!request.format || !['docx', 'pdf'].includes(request.format)) {
      return errorResponse(400, 'Invalid format. Must be "docx" or "pdf"');
    }

    // Determine action type (default: markdown for backwards compatibility)
    const action = request.action || 'markdown';

    let outputBuffer: Buffer;

    if (action === 'file') {
      // Direct file conversion (DOCX ↔ PDF)
      if (!request.sourceBucket || !request.sourceKey) {
        return errorResponse(400, 'sourceBucket and sourceKey required for file conversion');
      }

      // Fetch file from S3
      const getCommand = new GetObjectCommand({
        Bucket: request.sourceBucket,
        Key: request.sourceKey,
      });
      const s3Response = await s3Client.send(getCommand);
      const inputBuffer = Buffer.from((await s3Response.Body?.transformToByteArray()) || []);

      if (inputBuffer.length === 0) {
        return errorResponse(400, 'Source file is empty');
      }

      // Detect input format from S3 key extension
      const keyLower = request.sourceKey.toLowerCase();
      const LIBREOFFICE_EXTENSIONS = [
        '.doc',
        '.docx',
        '.key',
        '.numbers',
        '.odp',
        '.ods',
        '.odt',
        '.pages',
        '.ppt',
        '.pptx',
        '.rtf',
        '.xls',
      ];
      const inputFormat = keyLower.endsWith('.pdf')
        ? 'pdf'
        : LIBREOFFICE_EXTENSIONS.some((ext) => keyLower.endsWith(ext))
          ? 'libreoffice'
          : null;

      if (!inputFormat) {
        return errorResponse(400, 'Source file must be .pdf or a LibreOffice-compatible format');
      }

      console.log(`Converting file (${inputBuffer.length} bytes, ${inputFormat}) to ${request.format}`);

      // Convert based on input/output format
      if (inputFormat === 'libreoffice' && request.format === 'pdf') {
        // Extract original extension for LibreOffice (e.g. "input.pptx")
        const ext = keyLower.substring(keyLower.lastIndexOf('.'));
        outputBuffer = await convertGenericToPdf(inputBuffer, ext);
      } else if (inputFormat === 'pdf' && request.format === 'docx') {
        outputBuffer = await convertPdfToDocx(inputBuffer);
      } else if (inputFormat === request.format) {
        return errorResponse(400, `Input and output format are the same (${inputFormat})`);
      } else {
        return errorResponse(400, `Cannot convert ${inputFormat} to ${request.format}`);
      }
    } else {
      // Markdown conversion (existing behavior)
      if (!request.markdown && !(request.sourceBucket && request.sourceKey)) {
        return errorResponse(400, 'Either markdown content or sourceBucket/sourceKey is required');
      }

      // Get markdown content
      let markdown: string;
      if (request.markdown) {
        markdown = request.markdown;
      } else {
        // Fetch from S3
        const getCommand = new GetObjectCommand({
          Bucket: request.sourceBucket,
          Key: request.sourceKey,
        });
        const s3Response = await s3Client.send(getCommand);
        markdown = (await s3Response.Body?.transformToString()) || '';
      }

      if (!markdown || markdown.trim().length === 0) {
        return errorResponse(400, 'Markdown content is empty');
      }

      console.log(`Converting markdown (${markdown.length} chars) to ${request.format}`);

      // Convert based on format
      if (request.format === 'docx') {
        outputBuffer = await convertMdToDocx(markdown);
      } else {
        outputBuffer = await convertMdToPdf(markdown);
      }
    }

    console.log(`Conversion complete. Output size: ${outputBuffer.length} bytes`);

    // Generate output filename and S3 key
    const filename = generateFilename(request.title, request.filename, request.format);
    const s3Key = `document-converter/${uuidv4()}/${filename}`;

    // Upload to S3
    const putCommand = new PutObjectCommand({
      Bucket: outputsBucket,
      Key: s3Key,
      Body: outputBuffer,
      ContentType: getContentType(request.format),
      ContentDisposition: `attachment; filename="${filename}"`,
    });
    await s3Client.send(putCommand);

    console.log(`Uploaded to s3://${outputsBucket}/${s3Key}`);

    // Generate presigned URL (15 minute expiry)
    const getCommand = new GetObjectCommand({
      Bucket: outputsBucket,
      Key: s3Key,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const downloadUrl = await getSignedUrl(s3Client as any, getCommand, { expiresIn: 900 });

    // Return success response
    const response: ConvertResponse = {
      success: true,
      downloadUrl,
      filename,
      size: outputBuffer.length,
    };

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Conversion error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error occurred';
    return errorResponse(500, `Conversion failed: ${message}`);
  }
}

/**
 * Generate error response
 */
function errorResponse(statusCode: number, message: string): APIGatewayProxyResultV2 {
  const response: ErrorResponse = {
    success: false,
    error: message,
  };

  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(response),
  };
}
