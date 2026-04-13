import React, { useState, useEffect, useCallback } from 'react';
import Button from 'react-bootstrap/Button';
import Spinner from 'react-bootstrap/Spinner';
import { useTranslation } from 'react-i18next';
import { useNumaRequest } from '../../../Providers/NumaRequestContext';
import { useAuth } from '../../../Providers/AuthProvider';
import * as OpsService from '../../../Services/OpsService';
import type { Comment } from '../../../types/ops';
import { RichTextEditor } from './RichTextEditor';
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
 * Calculates a simple numeric hash from a string.
 * Used to deterministically assign avatar colors to authors.
 */
function hashString(str: string | null | undefined): number {
  if (!str) return 0;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
    hash |= 0;
  }
  return Math.abs(hash);
}

/**
 * Returns a hex color deterministically derived from a name string.
 */
function avatarColor(name: string | null | undefined): string {
  const colors = [
    '#3b82f6',
    '#ef4444',
    '#22c55e',
    '#f59e0b',
    '#8b5cf6',
    '#ec4899',
    '#06b6d4',
    '#f97316',
    '#14b8a6',
    '#6366f1',
  ];
  return colors[hashString(name) % colors.length];
}

/**
 * Extracts initials from a name (first letter of first two words, uppercase).
 */
function getInitials(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
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
    if (!window.confirm(t('comments.deleteConfirm'))) return;
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

  // Get current user's display name for the input avatar
  const currentUserName: string =
    (user?.decoded_tokens?.idToken?.name as string) ?? (user?.decoded_tokens?.idToken?.email as string) ?? '';

  return (
    <div>
      {/* Add comment form — at top, Jira-style with avatar */}
      <div
        className="d-flex gap-3 mb-3 pb-3"
        style={{ borderBottom: comments.length > 0 ? '1px solid #f3f4f6' : 'none' }}
      >
        <div
          className="d-flex align-items-center justify-content-center flex-shrink-0"
          style={{
            width: 32,
            height: 32,
            borderRadius: '50%',
            backgroundColor: avatarColor(currentUserName),
            color: '#fff',
            fontSize: '0.7rem',
            fontWeight: 600,
          }}
        >
          {getInitials(currentUserName)}
        </div>
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

            return (
              <div
                key={comment.id ?? `${comment.authorId}-${comment.createdAt}`}
                className="d-flex gap-3 mb-3 pb-3"
                style={{ borderBottom: '1px solid #f3f4f6' }}
              >
                {/* Avatar */}
                <div
                  className="d-flex align-items-center justify-content-center flex-shrink-0"
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    backgroundColor: avatarColor(comment.authorName),
                    color: '#fff',
                    fontSize: '0.7rem',
                    fontWeight: 600,
                  }}
                >
                  {getInitials(comment.authorName)}
                </div>

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
                      className="mb-0"
                      style={{ fontSize: '0.875rem', color: '#374151' }}
                      dangerouslySetInnerHTML={{ __html: comment.content }}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
