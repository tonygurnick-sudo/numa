import React, { useRef, useEffect, useCallback, useImperativeHandle, forwardRef } from 'react';
import { useTranslation } from 'react-i18next';

interface RichTextEditorProps {
  value: string;
  onSave: (html: string) => void;
  onChange?: (html: string) => void;
  onImageUpload?: (file: File) => Promise<string>;
  placeholder?: string;
  minHeight?: number;
  disabled?: boolean;
  onFileAttach?: (file: File) => void;
  mentionOptions?: { id: string; display: string }[];
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
  | 'formatBlock'
  | 'foreColor'
  | 'fontName';

/**
 * Minimal rich-text editor using contentEditable + execCommand.
 * Matches Ian's POC toolbar: B I U | • 1. | Link | Clear.
 *
 * Does NOT auto-save. The parent must call `ref.flush()` (e.g. from a
 * Save button) to persist the current content via `onSave`.
 * Content is stored as HTML.
 */
export const RichTextEditor = forwardRef<RichTextEditorHandle, RichTextEditorProps>(function RichTextEditor(
  {
    value,
    onSave,
    onChange,
    onImageUpload,
    placeholder = 'Add a description…',
    minHeight = 120,
    disabled = false,
    onFileAttach,
    mentionOptions,
  },
  ref
) {
  const { t } = useTranslation('ops');
  const editorRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachInputRef = useRef<HTMLInputElement>(null);
  const [isUploadingImage, setIsUploadingImage] = React.useState(false);
  const [isHtmlMode, setIsHtmlMode] = React.useState(false);
  const [htmlValue, setHtmlValue] = React.useState(value || '');

  // Mention State
  const [mentionQuery, setMentionQuery] = React.useState<string | null>(null);
  const [mentionPos, setMentionPos] = React.useState<{ top: number; left: number } | null>(null);
  const [mentionIndex, setMentionIndex] = React.useState(0);

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
    const incoming = value || '';

    if (!initializedRef.current) {
      if (el) el.innerHTML = incoming;
      setHtmlValue(incoming);
      lastSavedRef.current = incoming;
      initializedRef.current = true;
      return;
    }

    if (isHtmlMode) {
      if (incoming !== htmlValue) {
        setHtmlValue(incoming);
        lastSavedRef.current = incoming;
      }
      return;
    }

    if (!el) return;
    const currentHtml = el.innerHTML;
    const cleanCurrent =
      currentHtml === '<br>' || currentHtml === '<div><br></div>' || currentHtml === '<p><br></p>' ? '' : currentHtml;

    // If incoming exactly matches what we just sent out via onChange, do nothing
    // so we preserve the cursor position safely.
    if (incoming === currentHtml || incoming === cleanCurrent) {
      lastSavedRef.current = incoming;
      return;
    }

    // External value change (e.g. ticket reloaded with new remote text) — update content
    if (incoming !== lastSavedRef.current) {
      el.innerHTML = incoming;
      lastSavedRef.current = incoming;
    }
  }, [value, isHtmlMode]);

  const exec = useCallback(
    (cmd: FormatCmd | 'insertImage', val?: string) => {
      if (disabled || isHtmlMode) return;
      document.execCommand(cmd, false, val);
    },
    [disabled, isHtmlMode]
  );

  const handleLink = useCallback(() => {
    const url = window.prompt('Enter URL:', 'https://');
    if (url) exec('createLink', url);
  }, [exec]);

  const handleTableInsert = useCallback(() => {
    if (disabled) return;
    const tableHtml =
      '<table style="border-collapse: collapse; width: 100%;">' +
      '<tr>' +
      '<td style="border: 1px solid #d1d5db; padding: 8px;">&nbsp;</td>' +
      '<td style="border: 1px solid #d1d5db; padding: 8px;">&nbsp;</td>' +
      '<td style="border: 1px solid #d1d5db; padding: 8px;">&nbsp;</td>' +
      '</tr>' +
      '<tr>' +
      '<td style="border: 1px solid #d1d5db; padding: 8px;">&nbsp;</td>' +
      '<td style="border: 1px solid #d1d5db; padding: 8px;">&nbsp;</td>' +
      '<td style="border: 1px solid #d1d5db; padding: 8px;">&nbsp;</td>' +
      '</tr>' +
      '</table><br>';
    document.execCommand('insertHTML', false, tableHtml);
  }, [disabled]);

  const _handleImageInsert = useCallback(() => {
    if (disabled) return;
    const url = window.prompt('Enter image URL:', 'https://');
    if (url) document.execCommand('insertImage', false, url);
  }, [disabled]);

  const handleFileAttach = useCallback(() => {
    if (disabled) return;
    attachInputRef.current?.click();
  }, [disabled]);

  const handleFileSelected = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (onFileAttach) {
        onFileAttach(file);
      } else {
        const badgeHtml = `<span style="display: inline-block; background: #e5e7eb; color: #374151; padding: 2px 8px; border-radius: 4px; font-size: 0.8rem; margin: 0 2px;">📎 ${file.name}</span>&nbsp;`;
        editorRef.current?.focus();
        document.execCommand('insertHTML', false, badgeHtml);
      }
      // Reset so the same file can be re-selected
      e.target.value = '';
    },
    [onFileAttach]
  );

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

  const handleInsertImage = useCallback(() => {
    if (onImageUpload && fileInputRef.current) {
      saveSelection(); // Save selection before file picker steals focus
      fileInputRef.current.click();
      return;
    }
    const url = window.prompt('Enter image URL (must be public):', 'https://');
    if (url) exec('insertImage', url);
  }, [exec, onImageUpload, saveSelection]);

  const handleImageFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !onImageUpload) return;

      setIsUploadingImage(true);
      try {
        const url = await onImageUpload(file);
        restoreSelection();
        exec('insertImage', url);
      } catch (err) {
        console.error('Failed to upload image:', err);
        window.alert('Failed to upload image.');
      } finally {
        setIsUploadingImage(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    },
    [onImageUpload, exec, restoreSelection]
  );

  /** Read current editor HTML, normalising empty content to ''. */
  const readClean = useCallback((): string | null => {
    if (isHtmlMode) {
      return htmlValue || '';
    }
    const el = editorRef.current;
    if (!el) return null;
    let html = el.innerHTML;
    if (html === '<br>' || html === '<div><br></div>' || html === '<p><br></p>') {
      html = '';
    }
    return html;
  }, [isHtmlMode, htmlValue]);

  /** Read current content and call onSave if it changed since last save. */
  const flush = useCallback(() => {
    const clean = readClean();
    if (clean === null) return;
    if (clean !== lastSavedRef.current) {
      lastSavedRef.current = clean;
      onSave(clean);
    }
  }, [readClean, onSave]);

  const checkMention = useCallback(() => {
    if (!mentionOptions?.length || isHtmlMode) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent?.slice(0, range.startOffset) || '';
      const match = /(?:^|\s)@(\w*)$/.exec(text);
      if (match) {
        setMentionQuery(match[1]);
        const rect = range.getBoundingClientRect();
        setMentionPos({ top: rect.bottom, left: rect.left });
        setMentionIndex(0); // Reset selection
        return;
      }
    }
    setMentionQuery(null);
  }, [mentionOptions, isHtmlMode]);

  const insertMention = useCallback(
    (user: { id: string; display: string }) => {
      if (!mentionOptions?.length) return;
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;

      const range = sel.getRangeAt(0);
      const node = range.startContainer;
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent?.slice(0, range.startOffset) || '';
        const match = /(?:^|\s)@(\w*)$/.exec(text);
        if (match) {
          range.setStart(node, range.startOffset - (match[1].length + 1));
          range.deleteContents();
          const html = `<span class="ops-mention" data-sub="${user.id}" style="color: #3b82f6; font-weight: 600;">@${user.display}</span>&nbsp;`;
          document.execCommand('insertHTML', false, html);
        }
      }
      setMentionQuery(null);
    },
    [mentionOptions]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (mentionQuery !== null) {
        const filtered = (mentionOptions || []).filter((o) =>
          o.display.toLowerCase().includes(mentionQuery.toLowerCase())
        );
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setMentionIndex((prev) => (prev + 1) % filtered.length);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setMentionIndex((prev) => (prev - 1 + filtered.length) % filtered.length);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          if (filtered[mentionIndex]) {
            insertMention(filtered[mentionIndex]);
          }
        } else if (e.key === 'Escape') {
          e.preventDefault();
          setMentionQuery(null);
        }
      }
    },
    [mentionQuery, mentionOptions, mentionIndex, insertMention]
  );

  const handleInput = useCallback(() => {
    const clean = readClean();
    if (clean !== null && onChange) {
      onChange(clean);
    }
    checkMention();
  }, [readClean, onChange, checkMention]);

  const handleHtmlChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const updatedHtml = e.target.value;
      setHtmlValue(updatedHtml);
      if (onChange) {
        onChange(updatedHtml);
      }
    },
    [onChange]
  );

  const toggleHtmlMode = useCallback(() => {
    setIsHtmlMode((prev) => {
      const nextMode = !prev;
      if (nextMode) {
        // visual -> HTML: read directly from DOM to avoid stale closures
        const el = editorRef.current;
        if (el) {
          let html = el.innerHTML;
          if (html === '<br>' || html === '<div><br></div>' || html === '<p><br></p>') {
            html = '';
          }
          setHtmlValue(html);
        }
      } else {
        // HTML -> visual: use functional updater to get current htmlValue
        setHtmlValue((currentHtml) => {
          const el = editorRef.current;
          if (el) el.innerHTML = currentHtml;
          return currentHtml;
        });
      }
      return nextMode;
    });
  }, []);

  // Expose flush() to the parent via ref
  useImperativeHandle(ref, () => ({ flush }), [flush]);

  const toolbarBtn = (title: string, content: React.ReactNode, onClick: () => void) => (
    <button
      type="button"
      className="ops-editor-toolbar-btn"
      title={title}
      disabled={disabled || isHtmlMode}
      onMouseDown={(e) => {
        e.preventDefault(); // Don't steal focus from editor
        onClick();
      }}
      style={{ fontSize: '0.8rem', fontFamily: 'inherit' }}
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
          flexWrap: 'wrap',
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
            cursor: disabled || isHtmlMode ? 'default' : 'pointer',
            opacity: disabled || isHtmlMode ? 0.4 : 1,
            paddingLeft: 4,
            paddingRight: 2,
          }}
          disabled={disabled || isHtmlMode}
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
        {/* Font dropdown */}
        {/* eslint-disable i18next/no-literal-string */}
        <select
          title="Font"
          onMouseDown={saveSelection}
          onChange={(e) => {
            const val = e.target.value;
            if (val) {
              restoreSelection();
              exec('fontName', val);
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
            cursor: disabled || isHtmlMode ? 'default' : 'pointer',
            opacity: disabled || isHtmlMode ? 0.4 : 1,
            paddingLeft: 4,
            paddingRight: 2,
          }}
          disabled={disabled || isHtmlMode}
          defaultValue=""
        >
          <option value="" disabled>
            Font
          </option>
          <option value="Arial">Arial</option>
          <option value="Courier New">Courier New</option>
          <option value="Georgia">Georgia</option>
          <option value="Tahoma">Tahoma</option>
          <option value="Times New Roman">Times New Roman</option>
          <option value="Verdana">Verdana</option>
        </select>
        {/* Color dropdown */}
        <select
          title="Color"
          onMouseDown={saveSelection}
          onChange={(e) => {
            const val = e.target.value;
            if (val) {
              restoreSelection();
              exec('foreColor', val);
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
            cursor: disabled || isHtmlMode ? 'default' : 'pointer',
            opacity: disabled || isHtmlMode ? 0.4 : 1,
            paddingLeft: 4,
            paddingRight: 2,
          }}
          disabled={disabled || isHtmlMode}
          defaultValue=""
        >
          <option value="" disabled>
            Color
          </option>
          <option value="#000000">Black</option>
          <option value="#6b7280">Gray</option>
          <option value="#ef4444">Red</option>
          <option value="#3b82f6">Blue</option>
          <option value="#10b981">Green</option>
        </select>
        {/* eslint-enable i18next/no-literal-string */}
        {divider}
        {toolbarBtn('Bold (Ctrl+B)', <strong style={{ fontSize: '0.85rem' }}>B</strong>, () => exec('bold'))}
        {toolbarBtn('Italic (Ctrl+I)', <em style={{ fontSize: '0.85rem', fontStyle: 'italic' }}>I</em>, () =>
          exec('italic')
        )}
        {toolbarBtn(
          'Underline (Ctrl+U)',
          <span style={{ fontSize: '0.85rem', textDecoration: 'underline' }}>U</span>,
          () => exec('underline')
        )}
        {divider}
        {toolbarBtn('Bullet list', <i className="bi bi-list-ul" />, () => exec('insertUnorderedList'))}
        {toolbarBtn('Numbered list', <i className="bi bi-list-ol" />, () => exec('insertOrderedList'))}
        {divider}
        {toolbarBtn('Insert link', <i className="bi bi-link-45deg" />, handleLink)}
        {toolbarBtn(
          'Insert image',
          isUploadingImage ? <div className="spinner-border spinner-border-sm" /> : <i className="bi bi-image" />,
          handleInsertImage
        )}
        {toolbarBtn('Clear formatting', <i className="bi bi-type" />, () => exec('removeFormat'))}
        {divider}
        {toolbarBtn('Insert table', <i className="bi bi-table" />, handleTableInsert)}
        {onFileAttach && toolbarBtn('Attach file', <i className="bi bi-paperclip" />, handleFileAttach)}

        <div style={{ flexGrow: 1 }} />
        <button
          type="button"
          title="Toggle HTML Source"
          onClick={toggleHtmlMode}
          disabled={disabled}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: 28,
            padding: '0 8px',
            border: '1px solid #d1d5db',
            borderRadius: 4,
            background: isHtmlMode ? '#e0e7ff' : '#fff',
            color: isHtmlMode ? '#4338ca' : '#374151',
            fontSize: '0.75rem',
            fontWeight: 500,
            cursor: disabled ? 'default' : 'pointer',
            fontFamily: 'inherit',
            transition: 'background-color 0.2s',
          }}
        >
          <i className="bi bi-code-slash me-1" /> HTML
        </button>
      </div>

      <input
        type="file"
        ref={fileInputRef}
        onChange={handleImageFileChange}
        accept="image/*"
        style={{ display: 'none' }}
      />

      {/* Hidden file input for file attach */}
      <input ref={attachInputRef} type="file" style={{ display: 'none' }} onChange={handleFileSelected} />

      {/* Editable content area */}
      <div style={{ position: 'relative', minHeight }}>
        {!isHtmlMode ? (
          <div
            ref={editorRef}
            contentEditable={!disabled}
            suppressContentEditableWarning
            data-placeholder={placeholder}
            onInput={handleInput}
            onKeyDown={handleKeyDown}
            onBlur={flush}
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
        ) : (
          <textarea
            value={htmlValue}
            onChange={handleHtmlChange}
            onBlur={flush}
            disabled={disabled}
            placeholder="<p>Enter HTML source here...</p>"
            style={{
              width: '100%',
              minHeight,
              padding: '10px 14px',
              fontSize: '0.85rem',
              lineHeight: 1.5,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              color: '#1f2937',
              backgroundColor: '#f8fafc',
              border: 'none',
              outline: 'none',
              resize: 'vertical',
              display: 'block',
            }}
          />
        )}
      </div>

      {mentionQuery !== null && mentionPos && (
        <div
          style={{
            position: 'fixed',
            top: mentionPos.top + 4,
            left: mentionPos.left,
            zIndex: 9999,
            backgroundColor: '#fff',
            border: '1px solid #d1d5db',
            borderRadius: '6px',
            boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
            maxHeight: '200px',
            overflowY: 'auto',
            minWidth: '200px',
          }}
        >
          {(() => {
            const filtered = (mentionOptions || []).filter((o) =>
              o.display.toLowerCase().includes(mentionQuery.toLowerCase())
            );
            if (filtered.length === 0) {
              return (
                <div style={{ padding: '8px 12px', color: '#6b7280', fontSize: '0.85rem' }}>
                  {}
                  {t('editor.noMatches', 'No matches')}
                </div>
              );
            }
            return filtered.map((option, idx) => (
              <div
                key={option.id}
                onMouseDown={(e) => {
                  e.preventDefault();
                  insertMention(option);
                }}
                style={{
                  padding: '8px 12px',
                  cursor: 'pointer',
                  backgroundColor: idx === mentionIndex ? '#f3f4f6' : '#fff',
                  color: '#111827',
                  fontSize: '0.85rem',
                }}
              >
                {option.display}
              </div>
            ));
          })()}
        </div>
      )}

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
        .rich-text-editor-content table { border-collapse: collapse; width: 100%; margin: 0.4em 0; }
        .rich-text-editor-content td, .rich-text-editor-content th { border: 1px solid #d1d5db; padding: 8px; }
        .rich-text-editor-content img { max-width: 100%; height: auto; }
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
          .rich-text-editor-content table { border-collapse: collapse; width: 100%; margin: 0.4em 0; }
          .rich-text-editor-content td, .rich-text-editor-content th { border: 1px solid #d1d5db; padding: 8px; }
          .rich-text-editor-content img { max-width: 100%; height: auto; }
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
