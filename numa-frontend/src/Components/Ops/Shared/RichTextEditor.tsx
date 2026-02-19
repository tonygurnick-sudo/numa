import React, { useRef, useEffect, useCallback, useImperativeHandle, forwardRef } from 'react';
import { useTranslation } from 'react-i18next';

interface RichTextEditorProps {
  value: string;
  onSave: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
  disabled?: boolean;
}

export interface RichTextEditorHandle {
  /** Read current content and call onSave if it changed. */
  flush: () => void;
}

type FormatCmd =
  | 'bold'
  | 'italic'
  | 'underline'
  | 'insertUnorderedList'
  | 'insertOrderedList'
  | 'createLink'
  | 'removeFormat'
  | 'formatBlock';

/**
 * Minimal rich-text editor using contentEditable + execCommand.
 * Matches Ian's POC toolbar: B I U | • 1. | Link | Clear.
 *
 * Does NOT auto-save. The parent must call `ref.flush()` (e.g. from a
 * Save button) to persist the current content via `onSave`.
 * Content is stored as HTML.
 */
export const RichTextEditor = forwardRef<RichTextEditorHandle, RichTextEditorProps>(function RichTextEditor(
  { value, onSave, placeholder = 'Add a description…', minHeight = 120, disabled = false },
  ref,
) {
  const { t } = useTranslation('ops');
  const editorRef = useRef<HTMLDivElement>(null);
  // Track the last value we set so we don't clobber the cursor on external re-renders
  const lastSavedRef = useRef<string>(value);
  // Saved selection range — used by the Style dropdown so it can re-apply the
  // selection after the native <select> steals focus.
  const selectionRef = useRef<Range | null>(null);
  // Whether the editor has been initialised with its first value
  const initializedRef = useRef(false);

  // Seed the editor on first mount or if value changes externally
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    if (!initializedRef.current) {
      // First mount — always set content
      el.innerHTML = value;
      lastSavedRef.current = value;
      initializedRef.current = true;
    } else if (value !== lastSavedRef.current) {
      // External value change (e.g. ticket reloaded) — update content
      el.innerHTML = value;
      lastSavedRef.current = value;
    }
  }, [value]);

  const exec = useCallback(
    (cmd: FormatCmd, val?: string) => {
      if (disabled) return;
      document.execCommand(cmd, false, val);
    },
    [disabled],
  );

  const handleLink = useCallback(() => {
    const url = window.prompt('Enter URL:', 'https://');
    if (url) exec('createLink', url);
  }, [exec]);

  const saveSelection = useCallback(() => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      selectionRef.current = sel.getRangeAt(0);
    }
  }, []);

  const restoreSelection = useCallback(() => {
    const sel = window.getSelection();
    if (sel && selectionRef.current) {
      sel.removeAllRanges();
      sel.addRange(selectionRef.current);
    }
  }, []);

  /** Read current editor HTML, normalising empty content to ''. */
  const readClean = useCallback((): string | null => {
    const el = editorRef.current;
    if (!el) return null;
    const html = el.innerHTML;
    return html === '<br>' || html === '<div><br></div>' || html === '<p><br></p>' ? '' : html;
  }, []);

  /** Read current content and call onSave if it changed since last save. */
  const flush = useCallback(() => {
    const clean = readClean();
    if (clean === null) return;
    if (clean !== lastSavedRef.current) {
      lastSavedRef.current = clean;
      onSave(clean);
    }
  }, [readClean, onSave]);

  // Expose flush() to the parent via ref
  useImperativeHandle(ref, () => ({ flush }), [flush]);

  const toolbarBtn = (title: string, content: React.ReactNode, onClick: () => void) => (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => {
        e.preventDefault(); // Don't steal focus from editor
        onClick();
      }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 28,
        height: 28,
        border: 'none',
        borderRadius: 4,
        background: 'transparent',
        color: '#374151',
        fontSize: '0.8rem',
        cursor: disabled ? 'default' : 'pointer',
        fontFamily: 'inherit',
        opacity: disabled ? 0.4 : 1,
      }}
      onMouseEnter={(e) => {
        if (!disabled) (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#e5e7eb';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent';
      }}
    >
      {content}
    </button>
  );

  const divider = (
    <span style={{ width: 1, height: 18, backgroundColor: '#e5e7eb', display: 'inline-block', margin: '0 4px' }} />
  );

  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden', opacity: disabled ? 0.7 : 1 }}>
      {/* Toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          padding: '4px 6px',
          borderBottom: '1px solid #e5e7eb',
          backgroundColor: '#f9fafb',
        }}
      >
        {/* Block format / heading dropdown */}
        <select
          title="Text style"
          onMouseDown={saveSelection}
          onChange={(e) => {
            const val = e.target.value;
            if (val) {
              restoreSelection();
              exec('formatBlock', val);
            }
            e.target.value = '';
          }}
          style={{
            height: 28,
            border: '1px solid #e5e7eb',
            borderRadius: 4,
            background: '#fff',
            color: '#374151',
            fontSize: '0.75rem',
            cursor: disabled ? 'default' : 'pointer',
            opacity: disabled ? 0.4 : 1,
            paddingLeft: 4,
            paddingRight: 2,
          }}
          disabled={disabled}
          defaultValue=""
        >
          <option value="" disabled>
            {t('editor.styleLabel')}
          </option>
          <option value="p">{t('editor.normal')}</option>
          <option value="h1">{t('editor.heading1')}</option>
          <option value="h2">{t('editor.heading2')}</option>
          <option value="h3">{t('editor.heading3')}</option>
        </select>
        {divider}
        {toolbarBtn('Bold (Ctrl+B)', <strong style={{ fontSize: '0.85rem' }}>B</strong>, () => exec('bold'))}
        {toolbarBtn('Italic (Ctrl+I)', <em style={{ fontSize: '0.85rem', fontStyle: 'italic' }}>I</em>, () =>
          exec('italic'),
        )}
        {toolbarBtn(
          'Underline (Ctrl+U)',
          <span style={{ fontSize: '0.85rem', textDecoration: 'underline' }}>U</span>,
          () => exec('underline'),
        )}
        {divider}
        {toolbarBtn('Bullet list', <i className="bi bi-list-ul" />, () => exec('insertUnorderedList'))}
        {toolbarBtn('Numbered list', <i className="bi bi-list-ol" />, () => exec('insertOrderedList'))}
        {divider}
        {toolbarBtn('Insert link', <i className="bi bi-link-45deg" />, handleLink)}
        {toolbarBtn('Clear formatting', <i className="bi bi-type" />, () => exec('removeFormat'))}
      </div>

      {/* Editable content area */}
      <div
        ref={editorRef}
        contentEditable={!disabled}
        suppressContentEditableWarning
        data-placeholder={placeholder}
        style={{
          minHeight,
          padding: '10px 14px',
          fontSize: '0.9rem',
          lineHeight: 1.6,
          color: '#111827',
          outline: 'none',
          backgroundColor: '#fff',
        }}
        className="rich-text-editor-content"
      />

      {/* Inline style for placeholder */}
      <style>{`
        .rich-text-editor-content:empty::before {
          content: attr(data-placeholder);
          color: #9ca3af;
          pointer-events: none;
        }
        .rich-text-editor-content ul { padding-left: 1.4em; list-style: disc; }
        .rich-text-editor-content ol { padding-left: 1.4em; list-style: decimal; }
        .rich-text-editor-content a { color: #6366f1; text-decoration: underline; }
        .rich-text-editor-content strong, .rich-text-editor-content b { font-weight: 700; }
        .rich-text-editor-content p { margin: 0 0 0.4em 0; }
        .rich-text-editor-content p:last-child { margin-bottom: 0; }
        .rich-text-editor-content h1 { font-size: 1.4em; font-weight: 700; margin: 0.3em 0 0.2em; }
        .rich-text-editor-content h2 { font-size: 1.2em; font-weight: 600; margin: 0.3em 0 0.2em; }
        .rich-text-editor-content h3 { font-size: 1.05em; font-weight: 600; margin: 0.2em 0 0.15em; }
      `}</style>
    </div>
  );
});

/**
 * Read-only renderer for rich text. Handles both plain text (legacy) and HTML.
 */
export function RichTextDisplay({ html, placeholder }: { html: string; placeholder?: string }): React.JSX.Element {
  const isHtml = /<[a-z][\s\S]*>/i.test(html);
  if (!html) {
    return (
      <span className="text-muted" style={{ fontSize: '0.9rem' }}>
        {placeholder ?? 'No description'}
      </span>
    );
  }
  if (isHtml) {
    return (
      <>
        <div
          className="rich-text-editor-content"
          style={{ fontSize: '0.9rem', lineHeight: 1.6, color: '#111827' }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
        <style>{`
          .rich-text-editor-content ul { padding-left: 1.4em; list-style: disc; }
          .rich-text-editor-content ol { padding-left: 1.4em; list-style: decimal; }
          .rich-text-editor-content a { color: #6366f1; text-decoration: underline; }
          .rich-text-editor-content strong, .rich-text-editor-content b { font-weight: 700; }
          .rich-text-editor-content p { margin: 0 0 0.4em 0; }
          .rich-text-editor-content p:last-child { margin-bottom: 0; }
          .rich-text-editor-content h1 { font-size: 1.4em; font-weight: 700; margin: 0.3em 0 0.2em; }
          .rich-text-editor-content h2 { font-size: 1.2em; font-weight: 600; margin: 0.3em 0 0.2em; }
          .rich-text-editor-content h3 { font-size: 1.05em; font-weight: 600; margin: 0.2em 0 0.15em; }
        `}</style>
      </>
    );
  }
  return (
    <span
      style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '0.9rem', lineHeight: 1.6, color: '#111827' }}
    >
      {html}
    </span>
  );
}
