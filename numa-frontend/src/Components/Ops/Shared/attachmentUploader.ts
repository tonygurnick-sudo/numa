import * as OpsService from '../../../Services/OpsService';
import type { CommentAttachment } from '../../../types/ops';

type NumaPost = (url: string, data?: unknown, headers?: Record<string, string>) => Promise<unknown>;

/**
 * Upload a single file to a ticket: presigned PUT to S3, then record the
 * attachment on a system comment. Used by the AttachmentsSection drop-zone
 * and by the RichTextEditor's large-image paste interceptor, keeping the
 * upload path in one place to avoid drift between entry points.
 *
 * Throws on any failure. Caller is responsible for surfacing errors.
 */
export async function uploadAttachmentToTicket(
  numaPost: NumaPost,
  ticketId: string,
  file: File
): Promise<CommentAttachment> {
  const contentType = file.type || 'application/octet-stream';

  const { uploadUrl, s3Key } = await OpsService.getPresignedUrl(numaPost, {
    context: 'ticket',
    contextId: ticketId,
    fileName: file.name,
    contentType,
  });

  const uploadResponse = await fetch(uploadUrl, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': contentType },
  });
  if (!uploadResponse.ok) throw new Error(`Upload failed: ${uploadResponse.status}`);

  const attachment: CommentAttachment = {
    name: file.name,
    s3Key,
    size: file.size,
    mimeType: contentType,
  };

  await OpsService.createComment(numaPost, ticketId, {
    content: `📎 Attached: ${file.name}`,
    attachments: [attachment],
  });

  return attachment;
}
