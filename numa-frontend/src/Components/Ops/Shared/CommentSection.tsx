import React, { useState, useEffect, useCallback } from 'react';
import Button from 'react-bootstrap/Button';
import Spinner from 'react-bootstrap/Spinner';
import { useTranslation } from 'react-i18next';
import { useNumaRequest } from '../../../Providers/NumaRequestContext';
import { useAuth } from '../../../Providers/AuthProvider';
import { useConfirm } from '../../../Providers/ConfirmContext';
import * as OpsService from '../../../Services/OpsService';
import type { Comment } from '../../../types/ops';
import { RichTextEditor } from './RichTextEditor';
import { sanitizeRichTextHtml } from '../../../utils/sanitizeRichText';
import { StaffAvatar } from './StaffAvatar';
import { ImageLightbox } from './ImageLightbox';
import { useOps } from '../OpsContext';

/**
 * Checks whether an HTML string has no visible text content.
 * Strips all tags and checks if any non-whitespace characters remain.
 * Handles common contentEditable artefacts like <div></div>, <p><br></p>, etc.
 */
function isHtmlEmpty(html: string): boolean {
  if (!html) return true;
  const stripped = html.replace(/<[^>]*>/g, '').trim();
  return stripped.length === 0;
}

interface CommentSectionProps {
  ticketId: string;
}

/**
 * Computes a relative time string like "2h ago" or "3d ago" from an ISO date string.
 */
function relativeTime(dateStr: string, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);

  if (years > 0) return t('comments.timeAgo.yearsAgo', { count: years });
  if (months > 0) return t('comments.timeAgo.monthsAgo', { count: months });
  if (weeks > 0) return t('comments.timeAgo.weeksAgo', { count: weeks });
  if (days > 0) return t('comments.timeAgo.daysAgo', { count: days });
  if (hours > 0) return t('comments.timeAgo.hoursAgo', { count: hours });
  if (minutes > 0) return t('comments.timeAgo.minutesAgo', { count: minutes });
  return t('comments.timeAgo.justNow');
}

/**
 * Displays a list of comments for a ticket with the ability to add, edit, and delete comments.
 * Comments are sorted ascending by creation date.
 * The current user can edit or delete their own comments inline.
 */
export function CommentSection({ ticketId }: CommentSectionProps): React.JSX.Element {
  const { t } = useTranslation('ops');
  const { t: tCommon } = useTranslation('common');
  const confirm = useConfirm();
  const { numaGet, numaPost, numaPut, numaDelete } = useNumaRequest();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { user } = useAuth() as { user: any };
  const { config } = useOps();

  const mentionOptions = React.useMemo(() => {
    return (config?.staff ?? []).map((s) => ({
      id: String(s.id),
      display: s.name ? String(s.name) : String(s.email),
    }));
  }, [config?.staff]);

  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [newContent, setNewContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  const handleCommentBodyClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'IMG') {
      e.preventDefault();
      const img = target as HTMLImageElement;
      if (img.src) setLightboxSrc(img.src);
    }
  }, []);

  const currentUserId: string = user?.decoded_tokens?.idToken?.sub ?? '';

  const loadComments = useCallback(async () => {
    try {
      const response = await OpsService.listComments(numaGet, ticketId);
      const sorted = [...response.comments].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      setComments(sorted);
    } catch (err) {
      console.error('[CommentSection] Failed to load comments', err);
    } finally {
      setLoading(false);
    }
  }, [numaGet, ticketId]);

  useEffect(() => {
    void loadComments();
  }, [loadComments]);

  const handleAdd = async () => {
    if (isHtmlEmpty(newContent)) return;
    setSubmitting(true);
    try {
      await OpsService.createComment(numaPost, ticketId, { content: newContent.trim() });
      setNewContent('');
      await loadComments();
    } catch (err) {
      console.error('[CommentSection] Failed to create comment', err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleEditSave = async (commentId: string) => {
    if (isHtmlEmpty(editContent)) return;
    try {
      await OpsService.updateComment(numaPut, ticketId, commentId, { content: editContent.trim() });
      setEditingId(null);
      setEditContent('');
      await loadComments();
    } catch (err) {
      console.error('[CommentSection] Failed to update comment', err);
    }
  };

  const handleDelete = async (commentId: string) => {
    const ok = await confirm({
      message: t('comments.deleteConfirm'),
      confirmLabel: tCommon('confirm.delete'),
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await OpsService.deleteComment(numaDelete, ticketId, commentId);
      await loadComments();
    } catch (err) {
      console.error('[CommentSection] Failed to delete comment', err);
    }
  };

  if (loading) {
    return (
      <div className="text-center py-3">
        <Spinner animation="border" size="sm" />
      </div>
    );
  }

  // Resolve the current user's staff record so the input avatar uses the
  // same presigned-URL pipeline as comment avatars below.
  const currentUserName: string =
    (user?.decoded_tokens?.idToken?.name as string) ?? (user?.decoded_tokens?.idToken?.email as string) ?? '';
  const currentUserEmail: string = (user?.decoded_tokens?.idToken?.email as string) ?? '';
  const currentUserStaff = (config?.staff ?? []).find((s) => s.id === currentUserId) ?? null;

  return (
    <div>
      <style>{`.ops-comment-body img { cursor: zoom-in; }`}</style>
      {/* Add comment form — at top, Jira-style with avatar */}
      <div
        className="d-flex gap-3 mb-3 pb-3"
        style={{ borderBottom: comments.length > 0 ? '1px solid #f3f4f6' : 'none' }}
      >
        <StaffAvatar staff={currentUserStaff} name={currentUserName} email={currentUserEmail} size={32} />
        <div className="flex-grow-1">
          <RichTextEditor
            value={newContent}
            onChange={(html) => setNewContent(html)}
            onSave={(html) => setNewContent(html)}
            placeholder={t('comments.placeholder')}
            minHeight={80}
            mentionOptions={mentionOptions}
          />
          <div className="d-flex justify-content-end mt-2">
            <Button
              variant="primary"
              size="sm"
              disabled={isHtmlEmpty(newContent) || submitting}
              onClick={() => void handleAdd()}
              style={{ minWidth: 80 }}
            >
              {submitting ? <Spinner animation="border" size="sm" /> : t('comments.addComment')}
            </Button>
          </div>
        </div>
      </div>

      {/* Comment list — newest first */}
      {comments.length === 0 ? (
        <p className="text-muted small mb-0">{t('empty.noComments')}</p>
      ) : (
        <div>
          {comments.map((comment) => {
            const isOwn = comment.authorId === currentUserId;
            const isEditing = editingId === comment.id;
            const authorStaff = (config?.staff ?? []).find((s) => s.id === comment.authorId) ?? null;

            return (
              <div
                key={comment.id ?? `${comment.authorId}-${comment.createdAt}`}
                className="d-flex gap-3 mb-3 pb-3"
                style={{ borderBottom: '1px solid #f3f4f6' }}
              >
                <StaffAvatar staff={authorStaff} name={comment.authorName} email={comment.authorEmail} size={32} />

                {/* Content */}
                <div className="flex-grow-1" style={{ minWidth: 0 }}>
                  <div className="d-flex align-items-center gap-2 mb-1">
                    <span className="fw-semibold" style={{ fontSize: '0.85rem' }}>
                      {comment.authorName || comment.authorEmail?.split('@')[0] || t('comments.unknownAuthor')}
                    </span>
                    {comment.isSystem && (
                      <span className="badge bg-light text-muted border" style={{ fontSize: '0.65rem' }}>
                        {t('comments.system')}
                      </span>
                    )}
                    <span className="text-muted" style={{ fontSize: '0.75rem' }}>
                      {relativeTime(comment.createdAt, t)}
                    </span>

                    {isOwn && !isEditing && (
                      <span className="ms-auto d-flex gap-2">
                        <Button
                          variant="link"
                          size="sm"
                          className="p-0 text-muted"
                          onClick={() => {
                            setEditingId(comment.id);
                            setEditContent(comment.content);
                          }}
                          title={t('common.edit')}
                        >
                          <i className="bi bi-pencil" style={{ fontSize: '0.75rem' }} />
                        </Button>
                        <Button
                          variant="link"
                          size="sm"
                          className="p-0 text-muted"
                          onClick={() => void handleDelete(comment.id)}
                          title={t('common.delete')}
                        >
                          <i className="bi bi-trash" style={{ fontSize: '0.75rem' }} />
                        </Button>
                      </span>
                    )}
                  </div>

                  {isEditing ? (
                    <div>
                      <div className="mb-2">
                        <RichTextEditor
                          value={editContent}
                          onChange={(html) => setEditContent(html)}
                          onSave={(html) => setEditContent(html)}
                          minHeight={80}
                          mentionOptions={mentionOptions}
                        />
                      </div>
                      <div className="d-flex gap-2">
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() => void handleEditSave(comment.id)}
                          disabled={!editContent.trim()}
                        >
                          {t('common.save')}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline-secondary"
                          onClick={() => {
                            setEditingId(null);
                            setEditContent('');
                          }}
                        >
                          {t('common.cancel')}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div
                      className="mb-0 rich-text-editor-content ops-comment-body"
                      style={{ fontSize: '0.875rem', color: '#374151' }}
                      onClick={handleCommentBodyClick}
                      dangerouslySetInnerHTML={{ __html: sanitizeRichTextHtml(comment.content) }}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
    </div>
  );
}
