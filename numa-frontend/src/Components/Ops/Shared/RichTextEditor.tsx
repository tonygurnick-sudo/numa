import React, { useRef, useEffect, useCallback, useImperativeHandle, forwardRef, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useEditor, EditorContent, ReactRenderer, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import { TextStyle, Color, FontFamily } from '@tiptap/extension-text-style';
import { TableKit } from '@tiptap/extension-table';
import Mention from '@tiptap/extension-mention';
import type { SuggestionOptions, SuggestionProps, SuggestionKeyDownProps } from '@tiptap/suggestion';
import type { Node as PMNode } from '@tiptap/pm/model';
import { micromark } from 'micromark';
import { gfm, gfmHtml } from 'micromark-extension-gfm';
import { useAlert, usePrompt } from '../../../Providers/ConfirmContext';
import { cleanPastedHtml, sanitizeRichTextHtml } from '../../../utils/sanitizeRichText';

interface RichTextEditorProps {
  value: string;
  onSave: (html: string) => void;
  onChange?: (html: string) => void;
  onImageUpload?: (file: File) => Promise<string>;
  /**
   * Called when a pasted image exceeds {@link LARGE_PASTED_IMAGE_BYTES}. The editor
   * blocks the inline insert; the consumer is expected to route the file to an
   * attachment-style upload path. If omitted, large images fall through to the
   * default paste behaviour (inline base64).
   */
  onLargeImagePaste?: (file: File) => void;
  placeholder?: string;
  minHeight?: number;
  disabled?: boolean;
  onFileAttach?: (file: File) => void;
  mentionOptions?: { id: string; display: string }[];
}

/**
 * Size above which a pasted image is treated as too large to embed inline as
 * base64. DynamoDB items are capped at 400KB; ~200KB leaves room for the rest
 * of the ticket fields, indexes, and base64 expansion overhead.
 */
export const LARGE_PASTED_IMAGE_BYTES = 200 * 1024;

export interface RichTextEditorHandle {
  /** Read current content and call onSave if it changed. */
  flush: () => void;
}

/**
 * Shared "prose" stylesheet for rendered rich-text content. Used by both the
 * live editor surface and the read-only {@link RichTextDisplay} so the two can
 * never drift. Scoped to `.rich-text-editor-content`. Tuned to mirror the
 * Customer Success Portal dashboard's markdown typography — proper heading
 * hierarchy, real inline-code / code-block styling, blockquotes, and roomy
 * list/table spacing — rather than the cramped default we had before.
 */
const RICH_TEXT_CONTENT_CSS = `
  .rich-text-editor-content { overflow-wrap: break-word; word-break: break-word; }
  .rich-text-editor-content > *:first-child { margin-top: 0; }
  .rich-text-editor-content > *:last-child { margin-bottom: 0; }
  .rich-text-editor-content p { margin: 0 0 0.65em 0; }
  .rich-text-editor-content h1,
  .rich-text-editor-content h2,
  .rich-text-editor-content h3,
  .rich-text-editor-content h4 { font-weight: 600; line-height: 1.3; color: #111827; letter-spacing: -0.01em; }
  .rich-text-editor-content h1 { font-size: 1.45em; font-weight: 700; margin: 1.1em 0 0.5em; }
  .rich-text-editor-content h2 { font-size: 1.25em; margin: 1em 0 0.45em; }
  .rich-text-editor-content h3 { font-size: 1.1em; margin: 0.9em 0 0.4em; }
  .rich-text-editor-content h4 { font-size: 1em; margin: 0.8em 0 0.35em; }
  .rich-text-editor-content ul,
  .rich-text-editor-content ol { padding-left: 1.5em; margin: 0 0 0.65em 0; }
  .rich-text-editor-content ul { list-style: disc; }
  .rich-text-editor-content ol { list-style: decimal; }
  .rich-text-editor-content li { margin: 0.2em 0; }
  .rich-text-editor-content li > p { margin: 0; }
  .rich-text-editor-content a { color: #6366f1; text-decoration: underline; text-underline-offset: 2px; }
  .rich-text-editor-content a:hover { color: #4f46e5; }
  .rich-text-editor-content strong, .rich-text-editor-content b { font-weight: 700; }
  .rich-text-editor-content code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.85em; background: #f3f4f6; color: #be123c;
    padding: 0.12em 0.4em; border-radius: 4px; border: 1px solid #e5e7eb;
  }
  .rich-text-editor-content pre {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.85em; line-height: 1.5; background: #f8fafc; border: 1px solid #e5e7eb;
    border-radius: 8px; padding: 12px 14px; overflow-x: auto; margin: 0 0 0.7em 0;
  }
  .rich-text-editor-content pre code { background: none; border: none; padding: 0; color: inherit; font-size: inherit; }
  .rich-text-editor-content blockquote {
    margin: 0 0 0.7em 0; padding: 0.2em 0 0.2em 1em; border-left: 3px solid #d1d5db; color: #4b5563;
  }
  .rich-text-editor-content hr { border: none; border-top: 1px solid #e5e7eb; margin: 1em 0; }
  .rich-text-editor-content table { border-collapse: collapse; max-width: 100%; width: 100%; margin: 0.5em 0 0.7em; table-layout: fixed; font-size: 0.95em; }
  .rich-text-editor-content th { background: #f9fafb; font-weight: 600; text-align: left; }
  .rich-text-editor-content td, .rich-text-editor-content th { border: 1px solid #e5e7eb; padding: 7px 10px; word-break: break-word; vertical-align: top; }
  .rich-text-editor-content img { max-width: 100% !important; height: auto !important; display: block; border-radius: 6px; margin: 0.3em 0; }
  .rich-text-editor-content .ops-mention { color: #3b82f6; font-weight: 600; }
`;

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Convert raw plain text to safe paragraph HTML (blank lines split paragraphs,
 *  single newlines become hard breaks). Used for paste-as-plain-text. */
function plainTextToHtml(text: string): string {
  const blocks = text.split(/\n{2,}/).map((b) => `<p>${escapeHtml(b).replace(/\n/g, '<br>')}</p>`);
  return blocks.join('') || '<p></p>';
}

/** Heuristic: does this plain text look like markdown worth auto-formatting?
 *  Deliberately keyed on strong signals to avoid mangling prose that merely
 *  contains a stray asterisk. */
function looksLikeMarkdown(text: string): boolean {
  const signals = [
    /^#{1,6}\s/m, // headings
    /\*\*[^*\n]+\*\*/, // bold
    /`[^`\n]+`/, // inline code
    /^\s*[-*+]\s+/m, // bullet list
    /^\s*\d+\.\s+/m, // ordered list
    /\[[^\]]+\]\([^)\s]+\)/, // links
    /^>\s/m, // blockquote
    /^```/m, // fenced code
    /^\|.+\|.*$/m, // table row
  ];
  return signals.some((re) => re.test(text));
}

/** GFM markdown -> HTML string (no new dependency — micromark + gfm already
 *  ship in the frontend). Raw HTML in the source is escaped by default. */
function markdownToHtml(md: string): string {
  return micromark(md, { extensions: [gfm()], htmlExtensions: [gfmHtml()] });
}

/**
 * Mention node tuned for Numa Ops. We persist mentions as
 * `<span class="ops-mention" data-sub="{staffId}">@Name</span>` because the
 * numa-ops-api Lambda scans saved HTML for `data-sub="…"` to build the notify
 * list (see lambdas/node/numa-ops-api/index.ts). Overriding parseHTML lets the
 * editor round-trip both freshly-authored mentions and legacy ones written by
 * the old contentEditable editor.
 */
const OpsMention = Mention.extend({
  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-sub'),
        renderHTML: (attrs) => (attrs.id ? { 'data-sub': attrs.id as string } : {}),
      },
      label: {
        default: null,
        parseHTML: (el) => (el as HTMLElement).textContent?.replace(/^@/, '') || null,
        renderHTML: () => ({}),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'span.ops-mention' }];
  },
});

interface MentionItem {
  id: string;
  display: string;
}

interface MentionListHandle {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean;
}

interface MentionListProps {
  items: MentionItem[];
  command: (attrs: { id: string; label: string }) => void;
}

/**
 * Keyboard-navigable mention dropdown. Mirrors the look of the previous custom
 * popup (white card, indigo highlight) but is driven by Tiptap's suggestion
 * plugin instead of manual range juggling.
 */
const MentionList = forwardRef<MentionListHandle, MentionListProps>(function MentionList({ items, command }, ref) {
  const { t } = useTranslation('ops');
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => setSelectedIndex(0), [items]);

  const selectItem = useCallback(
    (index: number) => {
      const item = items[index];
      if (item) command({ id: item.id, label: item.display });
    },
    [items, command]
  );

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (!items.length) return false;
      if (event.key === 'ArrowDown') {
        setSelectedIndex((prev) => (prev + 1) % items.length);
        return true;
      }
      if (event.key === 'ArrowUp') {
        setSelectedIndex((prev) => (prev - 1 + items.length) % items.length);
        return true;
      }
      if (event.key === 'Enter') {
        selectItem(selectedIndex);
        return true;
      }
      return false;
    },
  }));

  return (
    <div
      style={{
        backgroundColor: '#fff',
        border: '1px solid #d1d5db',
        borderRadius: '6px',
        boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
        maxHeight: '200px',
        overflowY: 'auto',
        minWidth: '200px',
        padding: '2px',
      }}
    >
      {items.length === 0 ? (
        <div style={{ padding: '8px 12px', color: '#6b7280', fontSize: '0.85rem' }}>
          {t('editor.noMatches', 'No matches')}
        </div>
      ) : (
        items.map((option, idx) => (
          <div
            key={option.id}
            onMouseDown={(e) => {
              e.preventDefault();
              selectItem(idx);
            }}
            style={{
              padding: '8px 12px',
              cursor: 'pointer',
              borderRadius: '4px',
              backgroundColor: idx === selectedIndex ? '#eef2ff' : '#fff',
              color: '#111827',
              fontSize: '0.85rem',
            }}
          >
            {option.display}
          </div>
        ))
      )}
    </div>
  );
});

/** Build the Tiptap suggestion config for the given staff list. */
function buildMentionSuggestion(options: MentionItem[]): Omit<SuggestionOptions, 'editor'> {
  return {
    items: ({ query }) => options.filter((o) => o.display.toLowerCase().includes(query.toLowerCase())).slice(0, 8),
    render: () => {
      let component: ReactRenderer<MentionListHandle, MentionListProps> | null = null;
      let popupEl: HTMLDivElement | null = null;

      const position = (props: SuggestionProps): void => {
        if (!popupEl || !props.clientRect) return;
        const rect = props.clientRect();
        if (!rect) return;
        popupEl.style.top = `${rect.bottom + 4}px`;
        popupEl.style.left = `${rect.left}px`;
      };

      return {
        onStart: (props) => {
          component = new ReactRenderer(MentionList, {
            props: { items: props.items as MentionItem[], command: props.command },
            editor: props.editor,
          });
          popupEl = document.createElement('div');
          popupEl.style.position = 'fixed';
          popupEl.style.zIndex = '9999';
          document.body.appendChild(popupEl);
          if (component.element) popupEl.appendChild(component.element);
          position(props);
        },
        onUpdate: (props) => {
          component?.updateProps({ items: props.items as MentionItem[], command: props.command });
          position(props);
        },
        onKeyDown: (props) => {
          if (props.event.key === 'Escape') {
            popupEl?.remove();
            return true;
          }
          return component?.ref?.onKeyDown(props) ?? false;
        },
        onExit: () => {
          popupEl?.remove();
          popupEl = null;
          component?.destroy();
          component = null;
        },
      };
    },
  };
}

/** Document position just inside cell (rowIdx, colIdx) of a simple table node. */
function cellInsidePos(table: PMNode, tablePos: number, rowIdx: number, colIdx: number): number {
  let pos = tablePos + 1; // step inside the table, before the first row
  for (let r = 0; r < rowIdx; r++) pos += table.child(r).nodeSize;
  let cellPos = pos + 1; // step inside the row, before the first cell
  const row = table.child(rowIdx);
  for (let c = 0; c < colIdx; c++) cellPos += row.child(c).nodeSize;
  return cellPos + 1; // step inside the cell
}

/** Locate the table node containing the current selection, if any. */
function findSelectedTable(editor: Editor): { table: PMNode; pos: number } | null {
  const $from = editor.state.selection.$from;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type.name === 'table') return { table: node, pos: $from.before(d) };
  }
  return null;
}

interface TableRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * Floating, on-table controls (Notion/Airtable style): a `+` on the right edge
 * to append a column, a `+` on the bottom edge to append a row, and a small
 * delete cluster (row / column / table) anchored to the top-right corner. The
 * `+` buttons always append at the end of the table regardless of cursor; the
 * delete buttons act on the cell the cursor is in. Rendered as an absolutely
 * positioned overlay inside the editor wrapper so it scrolls with the content.
 */
function TableControls({
  editor,
  wrapperRef,
}: {
  editor: Editor | null;
  wrapperRef: React.RefObject<HTMLDivElement | null>;
}): React.JSX.Element | null {
  const [rect, setRect] = useState<TableRect | null>(null);

  useEffect(() => {
    if (!editor) return;
    const update = (): void => {
      const wrapper = wrapperRef.current;
      if (!wrapper || !editor.isActive('table')) {
        setRect(null);
        return;
      }
      try {
        const dom = editor.view.domAtPos(editor.state.selection.from).node as Node;
        const el = dom.nodeType === Node.TEXT_NODE ? dom.parentElement : (dom as HTMLElement);
        const tableEl = el?.closest('table') as HTMLElement | null;
        if (!tableEl) {
          setRect(null);
          return;
        }
        const tr = tableEl.getBoundingClientRect();
        const wr = wrapper.getBoundingClientRect();
        // Difference of viewport rects is scroll-invariant, so this offset stays
        // correct as the whole editor scrolls within its container.
        setRect({ top: tr.top - wr.top, left: tr.left - wr.left, width: tr.width, height: tr.height });
      } catch {
        setRect(null);
      }
    };
    update();
    editor.on('selectionUpdate', update);
    editor.on('transaction', update);
    return () => {
      editor.off('selectionUpdate', update);
      editor.off('transaction', update);
    };
  }, [editor, wrapperRef]);

  if (!rect || !editor) return null;

  const appendAtEnd = (kind: 'row' | 'col'): void => {
    const found = findSelectedTable(editor);
    if (!found) return;
    const { table, pos } = found;
    if (kind === 'row') {
      const target = cellInsidePos(table, pos, table.childCount - 1, 0);
      editor.chain().focus().setTextSelection(target).addRowAfter().run();
    } else {
      const lastCol = table.child(0).childCount - 1;
      const target = cellInsidePos(table, pos, 0, lastCol);
      editor.chain().focus().setTextSelection(target).addColumnAfter().run();
    }
  };

  const ctrlBtn = (
    title: string,
    content: React.ReactNode,
    onClick: () => void,
    extra: React.CSSProperties
  ): React.JSX.Element => (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => {
        e.preventDefault();
        onClick();
      }}
      style={{
        position: 'absolute',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 20,
        height: 20,
        padding: 0,
        border: '1px solid #d1d5db',
        borderRadius: 5,
        background: '#fff',
        color: '#4b5563',
        fontSize: '0.7rem',
        lineHeight: 1,
        cursor: 'pointer',
        boxShadow: '0 1px 2px rgb(0 0 0 / 0.08)',
        zIndex: 4,
        ...extra,
      }}
    >
      {content}
    </button>
  );

  return (
    <>
      {/* Append column — right edge, vertically centred */}
      {ctrlBtn('Add column', <i className="bi bi-plus" />, () => appendAtEnd('col'), {
        top: rect.top + rect.height / 2 - 10,
        left: rect.left + rect.width + 4,
      })}
      {/* Append row — bottom edge, horizontally centred */}
      {ctrlBtn('Add row', <i className="bi bi-plus" />, () => appendAtEnd('row'), {
        top: rect.top + rect.height + 4,
        left: rect.left + rect.width / 2 - 10,
      })}
      {/* Delete cluster — top-right corner, above the table */}
      {ctrlBtn(
        'Delete column',
        <i className="bi bi-layout-sidebar-reverse" />,
        () => editor.chain().focus().deleteColumn().run(),
        { top: rect.top - 26, left: rect.left + rect.width - 68 }
      )}
      {ctrlBtn(
        'Delete row',
        <i className="bi bi-layout-split" style={{ transform: 'rotate(90deg)' }} />,
        () => editor.chain().focus().deleteRow().run(),
        { top: rect.top - 26, left: rect.left + rect.width - 44 }
      )}
      {ctrlBtn('Delete table', <i className="bi bi-trash" />, () => editor.chain().focus().deleteTable().run(), {
        top: rect.top - 26,
        left: rect.left + rect.width - 20,
        color: '#dc2626',
      })}
    </>
  );
}

/**
 * Rich-text editor built on Tiptap (ProseMirror). Replaces the legacy
 * contentEditable + execCommand implementation: it emits clean, predictable
 * HTML and supports markdown authoring shortcuts (`# `, `- `, `> `, `` ` ``,
 * `**bold**`, etc.) out of the box via StarterKit's input rules.
 *
 * Content is still stored as HTML, so this is a drop-in replacement — no data
 * migration is required and existing descriptions/comments render unchanged.
 *
 * Does NOT auto-save. The parent calls `ref.flush()` (e.g. on modal close) to
 * persist via `onSave`; `onChange` fires live for controlled consumers.
 */
export const RichTextEditor = forwardRef<RichTextEditorHandle, RichTextEditorProps>(function RichTextEditor(
  {
    value,
    onSave,
    onChange,
    onImageUpload,
    onLargeImagePaste,
    placeholder = 'Add a description…',
    minHeight = 120,
    disabled = false,
    onFileAttach,
    mentionOptions,
  },
  ref
) {
  const { t } = useTranslation('ops');
  const { t: tCommon } = useTranslation('common');
  const promptDialog = usePrompt();
  const showAlert = useAlert();

  const wrapperRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachInputRef = useRef<HTMLInputElement>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [isHtmlMode, setIsHtmlMode] = useState(false);
  const [htmlValue, setHtmlValue] = useState(value || '');

  // Track the last content we emitted/received so external re-renders don't
  // clobber the cursor, and so flush() only fires onSave on a real change.
  const lastSavedRef = useRef<string>(value || '');
  // Callbacks read through refs so the editor's mount-time config never holds a
  // stale closure of a prop that the parent re-creates each render.
  const onSaveRef = useRef(onSave);
  const onChangeRef = useRef(onChange);
  const onLargeImagePasteRef = useRef(onLargeImagePaste);
  const isHtmlModeRef = useRef(isHtmlMode);
  onSaveRef.current = onSave;
  onChangeRef.current = onChange;
  onLargeImagePasteRef.current = onLargeImagePaste;
  isHtmlModeRef.current = isHtmlMode;
  // Paste plumbing: editor instance + a "plain paste" flag set by Cmd/Ctrl+Shift+V,
  // plus a ref-delegated paste handler so editorProps never holds a stale closure.
  const editorInstanceRef = useRef<Editor | null>(null);
  const plainPasteRef = useRef(false);
  const pasteHandlerRef = useRef<(event: ClipboardEvent) => boolean>(() => false);

  // Built once on mount. placeholder/mentionOptions are stable for an editor's
  // lifetime across all consumers, so we don't recreate the editor for them.
  const extensions = useMemo(
    () => [
      StarterKit.configure({
        link: { openOnClick: false, HTMLAttributes: { rel: 'noopener noreferrer nofollow' } },
      }),
      Image.configure({ inline: false, allowBase64: true }),
      Placeholder.configure({ placeholder }),
      TextStyle,
      Color,
      FontFamily,
      TableKit.configure({ table: { resizable: false } }),
      ...(mentionOptions?.length
        ? [
            OpsMention.configure({
              HTMLAttributes: { class: 'ops-mention' },
              suggestion: buildMentionSuggestion(mentionOptions),
            }),
          ]
        : []),
    ],
    []
  );

  /** Read the editor's current HTML, normalising the empty doc to ''. */
  const readEditorHtml = useCallback((editor: Editor | null): string => {
    if (!editor) return '';
    return editor.isEmpty ? '' : editor.getHTML();
  }, []);

  const editor = useEditor({
    immediatelyRender: false,
    editable: !disabled,
    extensions,
    content: value || '',
    editorProps: {
      attributes: {
        class: 'rich-text-editor-content',
        style: `min-height:${minHeight}px;padding:10px 14px;font-size:0.9rem;line-height:1.65;color:#111827;background:#fff;`,
      },
      // Flag Cmd/Ctrl+Shift+V so the next paste comes in as plain text.
      handleKeyDown: (_view, event) => {
        plainPasteRef.current =
          event.shiftKey && (event.metaKey || event.ctrlKey) && (event.key === 'v' || event.key === 'V');
        return false;
      },
      handlePaste: (_view, event) => pasteHandlerRef.current(event),
      // Default paste path: scrub noisy inline styles so Word/Docs/dark-theme
      // pastes stop looking messy.
      transformPastedHTML: (html) => cleanPastedHtml(html),
    },
    onUpdate: ({ editor: ed }) => {
      const html = ed.isEmpty ? '' : ed.getHTML();
      onChangeRef.current?.(html);
    },
    onBlur: ({ editor: ed }) => {
      if (isHtmlModeRef.current) return;
      const html = ed.isEmpty ? '' : ed.getHTML();
      if (html !== lastSavedRef.current) {
        lastSavedRef.current = html;
        onSaveRef.current(html);
      }
    },
  });

  editorInstanceRef.current = editor;
  // Unified paste handler (reassigned each render; reads everything via refs so
  // it can live behind a stable editorProps delegate).
  pasteHandlerRef.current = (event: ClipboardEvent): boolean => {
    const ed = editorInstanceRef.current;
    if (!ed) return false;
    const cd = event.clipboardData;

    // 1. Oversized pasted image -> route to attachments instead of inlining.
    const largeHandler = onLargeImagePasteRef.current;
    if (largeHandler && cd?.items) {
      for (const item of cd.items) {
        if (item.kind !== 'file' || !item.type.startsWith('image/')) continue;
        const file = item.getAsFile();
        if (file && file.size > LARGE_PASTED_IMAGE_BYTES) {
          event.preventDefault();
          largeHandler(file);
          return true;
        }
      }
    }

    const text = cd?.getData('text/plain') ?? '';
    const html = cd?.getData('text/html') ?? '';

    // 2. Plain paste (Cmd/Ctrl+Shift+V) — drop all formatting.
    if (plainPasteRef.current) {
      plainPasteRef.current = false;
      if (!text) return false;
      event.preventDefault();
      ed.chain().focus().insertContent(plainTextToHtml(text)).run();
      return true;
    }

    // 3. Markdown auto-format — only when the clipboard isn't already rich HTML
    //    (i.e. someone pasted raw markdown text).
    const htmlHasFormatting =
      !!html && /<(strong|b|em|i|h[1-6]|ul|ol|li|a|table|code|pre|blockquote|img)\b/i.test(html);
    if (!htmlHasFormatting && text && looksLikeMarkdown(text)) {
      event.preventDefault();
      ed.chain().focus().insertContent(markdownToHtml(text)).run();
      return true;
    }

    return false; // default path — transformPastedHTML scrubs noisy styles
  };

  /** Read current content and call onSave if it changed since last save. */
  const flush = useCallback(() => {
    const clean = isHtmlMode ? htmlValue || '' : readEditorHtml(editor);
    if (clean !== lastSavedRef.current) {
      lastSavedRef.current = clean;
      onSaveRef.current(clean);
    }
  }, [editor, isHtmlMode, htmlValue, readEditorHtml]);

  useImperativeHandle(ref, () => ({ flush }), [flush]);

  // Keep editability in sync with the disabled prop.
  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);

  // Seed / re-sync from external value changes (e.g. ticket reloaded remotely)
  // without disturbing the cursor when the value merely echoes our own edits.
  useEffect(() => {
    if (!editor || isHtmlMode) return;
    const incoming = value || '';
    const current = readEditorHtml(editor);
    if (incoming === current) {
      lastSavedRef.current = incoming;
      return;
    }
    if (incoming !== lastSavedRef.current) {
      editor.commands.setContent(incoming, { emitUpdate: false });
      lastSavedRef.current = incoming;
    }
  }, [value, editor, isHtmlMode, readEditorHtml]);

  const exec = useCallback(
    (fn: (chain: ReturnType<Editor['chain']>) => ReturnType<Editor['chain']>) => {
      if (!editor || disabled || isHtmlMode) return;
      fn(editor.chain().focus()).run();
    },
    [editor, disabled, isHtmlMode]
  );

  const handleLink = useCallback(async () => {
    const url = await promptDialog({
      title: tCommon('prompt.insertLink'),
      message: t('richText.linkUrlPrompt', 'Enter URL'),
      defaultValue: 'https://',
      placeholder: 'https://example.com',
      inputType: 'url',
      required: true,
    });
    if (!url) return;
    // With a selection, link the selected text. With none, drop the URL in as a
    // ready-made link so the button isn't a no-op. (Pasting a URL also
    // auto-links via StarterKit, so this is mostly for "link this text".)
    if (editor && editor.state.selection.empty) {
      exec((c) => c.insertContent({ type: 'text', text: url, marks: [{ type: 'link', attrs: { href: url } }] }));
    } else {
      exec((c) => c.extendMarkRange('link').setLink({ href: url }));
    }
  }, [editor, exec, promptDialog, t, tCommon]);

  const handleInsertImage = useCallback(async () => {
    if (onImageUpload && fileInputRef.current) {
      fileInputRef.current.click();
      return;
    }
    const url = await promptDialog({
      title: tCommon('prompt.insertImage'),
      message: t('richText.publicImageUrlPrompt', 'Enter image URL (must be public)'),
      defaultValue: 'https://',
      placeholder: 'https://example.com/image.png',
      inputType: 'url',
      required: true,
    });
    if (url) exec((c) => c.setImage({ src: url }));
  }, [exec, onImageUpload, promptDialog, t, tCommon]);

  const handleImageFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !onImageUpload) return;
      setIsUploadingImage(true);
      try {
        const url = await onImageUpload(file);
        // An empty string means the consumer handled the file another way
        // (e.g. routed an oversized image to attachments) — don't embed.
        if (url) exec((c) => c.setImage({ src: url }));
      } catch (err) {
        console.error('Failed to upload image:', err);
        await showAlert({
          message: t('richText.imageUploadFailed', 'Failed to upload image.'),
          variant: 'error',
        });
      } finally {
        setIsUploadingImage(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    },
    [onImageUpload, exec, showAlert, t]
  );

  const handleFileAttach = useCallback(() => {
    if (disabled) return;
    attachInputRef.current?.click();
  }, [disabled]);

  const handleFileSelected = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file && onFileAttach) onFileAttach(file);
      e.target.value = '';
    },
    [onFileAttach]
  );

  const handlePastePlain = useCallback(async () => {
    const ed = editorInstanceRef.current;
    if (!ed || disabled || isHtmlMode) return;
    try {
      const text = await navigator.clipboard.readText();
      if (text) ed.chain().focus().insertContent(plainTextToHtml(text)).run();
    } catch (err) {
      console.error('Clipboard read failed:', err);
    }
  }, [disabled, isHtmlMode]);

  const toggleHtmlMode = useCallback(() => {
    if (!isHtmlMode) {
      // visual -> HTML source
      setHtmlValue(readEditorHtml(editor));
      setIsHtmlMode(true);
    } else {
      // HTML source -> visual: apply edited source back into the document
      const next = htmlValue || '';
      editor?.commands.setContent(next, { emitUpdate: false });
      const normalised = readEditorHtml(editor);
      lastSavedRef.current = normalised;
      setIsHtmlMode(false);
      onChangeRef.current?.(normalised);
    }
  }, [isHtmlMode, htmlValue, editor, readEditorHtml]);

  const handleHtmlChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setHtmlValue(e.target.value);
    onChangeRef.current?.(e.target.value);
  }, []);

  const toolbarBtn = (
    title: string,
    content: React.ReactNode,
    onClick: () => void,
    active = false
  ): React.JSX.Element => (
    <button
      type="button"
      className="ops-editor-toolbar-btn"
      title={title}
      disabled={disabled || isHtmlMode || !editor}
      onMouseDown={(e) => {
        e.preventDefault(); // Don't steal focus / selection from the editor
        onClick();
      }}
      style={{
        fontSize: '0.8rem',
        fontFamily: 'inherit',
        ...(active ? { backgroundColor: '#e0e7ff', color: '#4338ca' } : {}),
      }}
    >
      {content}
    </button>
  );

  const divider = (
    <span style={{ width: 1, height: 18, backgroundColor: '#e5e7eb', display: 'inline-block', margin: '0 4px' }} />
  );

  const selectStyle: React.CSSProperties = {
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
  };

  return (
    <div
      ref={wrapperRef}
      style={{ position: 'relative', border: '1px solid #e5e7eb', borderRadius: 8, opacity: disabled ? 0.7 : 1 }}
    >
      {/* Toolbar — sticks to the top of the nearest scroll container so it stays
          reachable while editing a long description. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          padding: '4px 6px',
          borderBottom: '1px solid #e5e7eb',
          backgroundColor: '#f9fafb',
          flexWrap: 'wrap',
          position: 'sticky',
          top: 0,
          zIndex: 5,
          borderTopLeftRadius: 7,
          borderTopRightRadius: 7,
        }}
      >
        {/* Block format / heading dropdown */}
        <select
          title="Text style"
          onChange={(e) => {
            const val = e.target.value;
            if (val === 'p') exec((c) => c.setParagraph());
            else if (val) exec((c) => c.toggleHeading({ level: Number(val.replace('h', '')) as 1 | 2 | 3 }));
            e.target.value = '';
          }}
          style={selectStyle}
          disabled={disabled || isHtmlMode || !editor}
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
          onChange={(e) => {
            const val = e.target.value;
            if (val) exec((c) => c.setFontFamily(val));
            e.target.value = '';
          }}
          style={selectStyle}
          disabled={disabled || isHtmlMode || !editor}
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
          onChange={(e) => {
            const val = e.target.value;
            if (val) exec((c) => c.setColor(val));
            e.target.value = '';
          }}
          style={selectStyle}
          disabled={disabled || isHtmlMode || !editor}
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
        {toolbarBtn(
          'Bold (Ctrl+B)',
          <strong style={{ fontSize: '0.85rem' }}>B</strong>,
          () => exec((c) => c.toggleBold()),
          editor?.isActive('bold')
        )}
        {toolbarBtn(
          'Italic (Ctrl+I)',
          <em style={{ fontSize: '0.85rem', fontStyle: 'italic' }}>I</em>,
          () => exec((c) => c.toggleItalic()),
          editor?.isActive('italic')
        )}
        {toolbarBtn(
          'Underline (Ctrl+U)',
          <span style={{ fontSize: '0.85rem', textDecoration: 'underline' }}>U</span>,
          () => exec((c) => c.toggleUnderline()),
          editor?.isActive('underline')
        )}
        {divider}
        {toolbarBtn(
          'Bullet list',
          <i className="bi bi-list-ul" />,
          () => exec((c) => c.toggleBulletList()),
          editor?.isActive('bulletList')
        )}
        {toolbarBtn(
          'Numbered list',
          <i className="bi bi-list-ol" />,
          () => exec((c) => c.toggleOrderedList()),
          editor?.isActive('orderedList')
        )}
        {toolbarBtn(
          'Code block',
          <i className="bi bi-code-square" />,
          () => exec((c) => c.toggleCodeBlock()),
          editor?.isActive('codeBlock')
        )}
        {divider}
        {toolbarBtn('Insert link', <i className="bi bi-link-45deg" />, handleLink, editor?.isActive('link'))}
        {toolbarBtn(
          'Insert image',
          isUploadingImage ? <div className="spinner-border spinner-border-sm" /> : <i className="bi bi-image" />,
          handleInsertImage
        )}
        {toolbarBtn('Clear formatting', <i className="bi bi-type" />, () => exec((c) => c.unsetAllMarks()))}
        {toolbarBtn(
          'Paste as plain text (Ctrl+Shift+V)',
          <i className="bi bi-clipboard" />,
          () => void handlePastePlain()
        )}
        {divider}
        {toolbarBtn('Insert table', <i className="bi bi-table" />, () =>
          exec((c) => c.insertTable({ rows: 2, cols: 3, withHeaderRow: true }))
        )}
        {onFileAttach && toolbarBtn('Attach file', <i className="bi bi-paperclip" />, handleFileAttach)}
        {divider}
        <button
          type="button"
          className="ops-editor-toolbar-btn"
          title="Toggle HTML Source"
          onMouseDown={(e) => {
            e.preventDefault();
            toggleHtmlMode();
          }}
          disabled={disabled || !editor}
          style={{
            fontSize: '0.8rem',
            fontFamily: 'inherit',
            color: isHtmlMode ? '#4338ca' : undefined,
            backgroundColor: isHtmlMode ? '#e0e7ff' : undefined,
          }}
        >
          <i className="bi bi-code-slash" />
        </button>
      </div>

      {/* Hidden file input for inline image upload */}
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
          <EditorContent editor={editor} />
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

      {/* On-table floating controls (add row/col, delete) */}
      {!isHtmlMode && <TableControls editor={editor} wrapperRef={wrapperRef} />}

      {/* Editor-only styles (focus, placeholder) + shared prose styles */}
      <style>{`
        .rich-text-editor-content:focus { outline: none; }
        .rich-text-editor-content p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          color: #9ca3af;
          float: left;
          height: 0;
          pointer-events: none;
        }
        ${RICH_TEXT_CONTENT_CSS}
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
          style={{ fontSize: '0.9rem', lineHeight: 1.65, color: '#111827' }}
          dangerouslySetInnerHTML={{ __html: sanitizeRichTextHtml(html) }}
        />
        <style>{RICH_TEXT_CONTENT_CSS}</style>
      </>
    );
  }
  return (
    <span
      style={{
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        fontSize: '0.9rem',
        lineHeight: 1.65,
        color: '#111827',
      }}
    >
      {html}
    </span>
  );
}
