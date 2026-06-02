import React, { useMemo, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import type { AwsCredentialIdentity } from '@aws-sdk/types';
import {
  WorkspaceChatInlineFileReference,
  type FileReference,
} from '../WorkspaceChat/WorkspaceChatInlineFileReference';
import {
  WorkspaceChatInlineFolderReference,
  type FolderReference,
} from '../WorkspaceChat/WorkspaceChatInlineFolderReference';
import {
  WorkspaceChatInlineKBSource,
  buildKBSourceReference,
  type KBSourceReference,
} from '../WorkspaceChat/WorkspaceChatInlineKBSource';
import { downloadFileFromS3 } from '../../utils/s3Utils';

// Hoisted outside component to prevent ReactMarkdown re-parsing on every render
const REMARK_PLUGINS = [remarkBreaks, remarkGfm];

const S3_PREFIX = 'numa-chat/workspace';

interface WorkspaceChatMarkdownProps {
  content: string;
  conversationId: string;
  userSub: string;
  bucket: string;
  region: string;
  onOpenFilePreview?: (ref: FileReference) => void;
  onOpenFolderPreview?: (ref: FolderReference) => void;
  getCredentials?: () => Promise<AwsCredentialIdentity>;
}

/**
 * Build S3 key from a workspace-relative path
 * Handles paths like /workdir/outputs/file.md or workdir/uploads/file.csv
 */
const buildS3KeyForPath = (relativePath: string, userSub: string, conversationId: string): string => {
  let normalized = relativePath.trim();
  if (normalized.startsWith('./')) {
    normalized = normalized.slice(2);
  }
  normalized = normalized.replace(/^\/+/, '');
  // Strip workdir/ prefix if present (EFS path vs S3 path)
  normalized = normalized.replace(/^workdir\//, '');

  // chat-workflows/ is globally persistent (user level)
  if (normalized.startsWith('chat-workflows/')) {
    return `${S3_PREFIX}/${userSub}/${normalized}`;
  }
  // Everything else is conversation-specific
  return `${S3_PREFIX}/${userSub}/conversations/${conversationId}/${normalized}`;
};

/**
 * Normalize a file path referenced in <file:path> by stripping prefixes
 */
const normalizeRelativePath = (raw: string): string => {
  let p = raw.trim();
  if (p.toLowerCase().startsWith('file:')) p = p.slice(5);
  if (p.toLowerCase().startsWith('folder:')) p = p.slice(7);
  p = p.replace(/^\.\//, '');
  p = p.replace(/^\/+/, '');
  return p;
};

// Pattern to match file, folder, and kb-source references
// Supports both <file:path> and file:/path formats (with or without angle brackets)
// Also supports <kb-source:s3://bucket/key> for knowledge base source documents
// Additionally matches bare /workdir/... paths as a fallback
const FILE_FOLDER_KB_PATTERN =
  /(?:<file:([^>]+)>|<folder:([^>]+)>|<kb-source:([^>]+)>|file:\/([^\s\])<>]+)|folder:\/([^\s\])<>]+)|kb-source:([^\s\])<>]+)|(\/workdir\/[^\s)\]>,]+))/g;

/**
 * Parse text content and return an array of text and reference parts
 */
interface TextPart {
  type: 'text';
  content: string;
}

interface FileRefPart {
  type: 'file';
  ref: FileReference;
}

interface FolderRefPart {
  type: 'folder';
  ref: FolderReference;
}

interface KBSourcePart {
  type: 'kb-source';
  ref: KBSourceReference;
}

type ContentPart = TextPart | FileRefPart | FolderRefPart | KBSourcePart;

/**
 * Clean up path for display by stripping workdir/ prefix
 */
const cleanDisplayPath = (path: string): string => {
  // Remove workdir/ prefix for cleaner display
  return path.replace(/^workdir\//, '');
};

const parseTextWithReferences = (text: string, userSub: string, conversationId: string): ContentPart[] => {
  const parts: ContentPart[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  // Reset regex state
  FILE_FOLDER_KB_PATTERN.lastIndex = 0;

  while ((match = FILE_FOLDER_KB_PATTERN.exec(text)) !== null) {
    // Add text before this match
    if (match.index > lastIndex) {
      parts.push({ type: 'text', content: text.substring(lastIndex, match.index) });
    }

    // Capture groups:
    // [1] = <file:path> file path
    // [2] = <folder:path> folder path
    // [3] = <kb-source:s3://...> KB source URI
    // [4] = file:/path file path (no brackets)
    // [5] = folder:/path folder path (no brackets)
    // [6] = kb-source:s3://... KB source URI (no brackets)
    // [7] = /workdir/... bare path (fallback)
    const bareWorkdirPath = match[7];
    const filePathRaw = match[1] || match[4];
    const folderPathRaw = match[2] || match[5];
    const kbSourceRaw = match[3] || match[6];

    // Handle bare /workdir/... paths - determine if file or folder by checking for extension
    if (bareWorkdirPath) {
      const rel = normalizeRelativePath(bareWorkdirPath);
      const cleanRel = cleanDisplayPath(rel);
      const fullPath = buildS3KeyForPath(rel, userSub, conversationId);
      const lastSegment = cleanRel.split('/').pop() || cleanRel;
      // Check if it has a file extension (contains a dot after the last slash)
      const hasExtension = lastSegment.includes('.') && !lastSegment.startsWith('.');

      if (hasExtension) {
        // Treat as file
        const extension = lastSegment.split('.').pop()?.toLowerCase() || '';
        parts.push({
          type: 'file',
          ref: { filename: lastSegment, fullPath, relativePath: cleanRel, extension },
        });
      } else {
        // Treat as folder
        parts.push({
          type: 'folder',
          ref: { name: lastSegment, fullPath, relativePath: cleanRel },
        });
      }
      lastIndex = match.index + match[0].length;
      continue;
    }

    if (kbSourceRaw) {
      // KB source reference - parse S3 URI
      const kbRef = buildKBSourceReference(kbSourceRaw);
      if (kbRef) {
        parts.push({
          type: 'kb-source',
          ref: kbRef,
        });
      } else {
        // Invalid S3 URI - just output as text
        parts.push({ type: 'text', content: match[0] });
      }
    } else if (folderPathRaw) {
      // Folder reference
      let rel = normalizeRelativePath(folderPathRaw);
      rel = rel.replace(/\/+$/, '');
      const cleanRel = cleanDisplayPath(rel);
      const fullPath = buildS3KeyForPath(rel, userSub, conversationId);
      const name = cleanRel.split('/').pop() || cleanRel;
      parts.push({
        type: 'folder',
        ref: { name, fullPath, relativePath: cleanRel },
      });
    } else if (filePathRaw) {
      // File reference
      const rel = normalizeRelativePath(filePathRaw);
      const cleanRel = cleanDisplayPath(rel);
      const fullPath = buildS3KeyForPath(rel, userSub, conversationId);
      const filename = cleanRel.split('/').pop() || cleanRel;
      const extension = filename.split('.').pop()?.toLowerCase() || '';
      parts.push({
        type: 'file',
        ref: { filename, fullPath, relativePath: cleanRel, extension },
      });
    }

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push({ type: 'text', content: text.substring(lastIndex) });
  }

  return parts;
};

/**
 * WorkspaceChatMarkdown - Renders markdown content with inline file/folder references
 * File/folder references are rendered as subtle inline pills with an open button
 */
export const WorkspaceChatMarkdown: React.FC<WorkspaceChatMarkdownProps> = React.memo(
  ({ content, conversationId, userSub, bucket, region, onOpenFilePreview, onOpenFolderPreview, getCredentials }) => {
    // Default handlers that do nothing if not provided
    const handleOpenFile = useCallback(
      (ref: FileReference) => {
        if (onOpenFilePreview) {
          onOpenFilePreview(ref);
        }
      },
      [onOpenFilePreview]
    );

    const handleOpenFolder = useCallback(
      (ref: FolderReference) => {
        if (onOpenFolderPreview) {
          onOpenFolderPreview(ref);
        }
      },
      [onOpenFolderPreview]
    );

    const handleDownloadFile = useCallback(
      async (ref: FileReference) => {
        if (!getCredentials || !bucket) return;
        try {
          await downloadFileFromS3(ref.fullPath, bucket, region, getCredentials, ref.filename);
        } catch (err) {
          console.error('[WorkspaceChatMarkdown] Failed to download inline file:', err);
        }
      },
      [bucket, region, getCredentials]
    );

    const downloadCallback = getCredentials && bucket ? handleDownloadFile : undefined;

    // Custom component to render text nodes with inline file/folder/kb-source references
    const TextWithReferences = useCallback(
      ({ children }: { children: React.ReactNode }) => {
        // Only process string children
        if (typeof children !== 'string') {
          return <>{children}</>;
        }

        // Check if this text contains any file/folder/kb-source references
        // Support both <file:path> and file:/path formats (ReactMarkdown may strip angle brackets)
        // Also detect bare /workdir/... paths as fallback
        const hasRef =
          children.includes('<file:') ||
          children.includes('<folder:') ||
          children.includes('<kb-source:') ||
          children.includes('file:/') ||
          children.includes('folder:/') ||
          children.includes('kb-source:') ||
          children.includes('/workdir/');
        if (!hasRef) {
          return <>{children}</>;
        }

        const parts = parseTextWithReferences(children, userSub, conversationId);

        return (
          <>
            {parts.map((part, idx) => {
              if (part.type === 'text') {
                return <React.Fragment key={idx}>{part.content}</React.Fragment>;
              } else if (part.type === 'file') {
                return (
                  <WorkspaceChatInlineFileReference
                    key={idx}
                    fileRef={part.ref}
                    onOpenPreview={handleOpenFile}
                    onDownload={downloadCallback}
                  />
                );
              } else if (part.type === 'folder') {
                return (
                  <WorkspaceChatInlineFolderReference key={idx} folderRef={part.ref} onOpenPreview={handleOpenFolder} />
                );
              } else if (part.type === 'kb-source' && getCredentials) {
                return (
                  <WorkspaceChatInlineKBSource
                    key={idx}
                    sourceRef={part.ref}
                    getCredentials={getCredentials}
                    region={region}
                  />
                );
              }
              return null;
            })}
          </>
        );
      },
      [userSub, conversationId, region, handleOpenFile, handleOpenFolder, getCredentials, downloadCallback]
    );

    // Custom components for ReactMarkdown that handle inline file/folder references
    const markdownComponents = useMemo(
      () => ({
        // Override text rendering in paragraphs
        p: ({ children, ...props }: React.HTMLAttributes<HTMLParagraphElement> & { children?: React.ReactNode }) => {
          return (
            <p {...props}>
              {React.Children.map(children, (child) => {
                if (typeof child === 'string') {
                  return <TextWithReferences>{child}</TextWithReferences>;
                }
                return child;
              })}
            </p>
          );
        },
        // Override text rendering in list items
        li: ({ children, ...props }: React.HTMLAttributes<HTMLLIElement> & { children?: React.ReactNode }) => {
          return (
            <li {...props}>
              {React.Children.map(children, (child) => {
                if (typeof child === 'string') {
                  return <TextWithReferences>{child}</TextWithReferences>;
                }
                return child;
              })}
            </li>
          );
        },
        // Override text rendering in table cells
        td: ({ children, ...props }: React.HTMLAttributes<HTMLTableCellElement> & { children?: React.ReactNode }) => {
          return (
            <td {...props}>
              {React.Children.map(children, (child) => {
                if (typeof child === 'string') {
                  return <TextWithReferences>{child}</TextWithReferences>;
                }
                return child;
              })}
            </td>
          );
        },
        // Override text rendering in headers
        h1: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement> & { children?: React.ReactNode }) => {
          return (
            <h1 {...props}>
              {React.Children.map(children, (child) => {
                if (typeof child === 'string') {
                  return <TextWithReferences>{child}</TextWithReferences>;
                }
                return child;
              })}
            </h1>
          );
        },
        h2: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement> & { children?: React.ReactNode }) => {
          return (
            <h2 {...props}>
              {React.Children.map(children, (child) => {
                if (typeof child === 'string') {
                  return <TextWithReferences>{child}</TextWithReferences>;
                }
                return child;
              })}
            </h2>
          );
        },
        h3: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement> & { children?: React.ReactNode }) => {
          return (
            <h3 {...props}>
              {React.Children.map(children, (child) => {
                if (typeof child === 'string') {
                  return <TextWithReferences>{child}</TextWithReferences>;
                }
                return child;
              })}
            </h3>
          );
        },
        // Strong/bold text
        strong: ({ children, ...props }: React.HTMLAttributes<HTMLElement> & { children?: React.ReactNode }) => {
          return (
            <strong {...props}>
              {React.Children.map(children, (child) => {
                if (typeof child === 'string') {
                  return <TextWithReferences>{child}</TextWithReferences>;
                }
                return child;
              })}
            </strong>
          );
        },
        // Emphasis/italic text
        em: ({ children, ...props }: React.HTMLAttributes<HTMLElement> & { children?: React.ReactNode }) => {
          return (
            <em {...props}>
              {React.Children.map(children, (child) => {
                if (typeof child === 'string') {
                  return <TextWithReferences>{child}</TextWithReferences>;
                }
                return child;
              })}
            </em>
          );
        },
        // Inline code - check for /workdir/ paths and render as file references
        code: ({
          children,
          className,
          ...props
        }: React.HTMLAttributes<HTMLElement> & { children?: React.ReactNode }) => {
          // Only handle inline code (not code blocks which have a className like 'language-xxx')
          if (className) {
            return (
              <code className={className} {...props}>
                {children}
              </code>
            );
          }

          const text = typeof children === 'string' ? children : '';
          // Check if this is a /workdir/... path
          if (text.startsWith('/workdir/')) {
            const rel = normalizeRelativePath(text);
            const cleanRel = cleanDisplayPath(rel);
            const fullPath = buildS3KeyForPath(rel, userSub, conversationId);
            const lastSegment = cleanRel.split('/').pop() || cleanRel;
            const hasExtension = lastSegment.includes('.') && !lastSegment.startsWith('.');

            if (hasExtension) {
              const extension = lastSegment.split('.').pop()?.toLowerCase() || '';
              return (
                <WorkspaceChatInlineFileReference
                  fileRef={{ filename: lastSegment, fullPath, relativePath: cleanRel, extension }}
                  onOpenPreview={handleOpenFile}
                  onDownload={downloadCallback}
                />
              );
            } else {
              return (
                <WorkspaceChatInlineFolderReference
                  folderRef={{ name: lastSegment, fullPath, relativePath: cleanRel }}
                  onOpenPreview={handleOpenFolder}
                />
              );
            }
          }

          // Regular inline code - pass through
          return <code {...props}>{children}</code>;
        },
        // Intercept links with file:/, folder:/, or kb-source: URLs and render as inline references
        a: ({
          href,
          children,
          ...props
        }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { children?: React.ReactNode }) => {
          // Check href first, then children (ReactMarkdown sometimes puts path in children)
          const childText = typeof children === 'string' ? children : '';

          // Check for kb-source first
          const kbSourceMatch =
            href && href.startsWith('kb-source:')
              ? href.replace(/^kb-source:/, '')
              : childText.startsWith('kb-source:')
                ? childText.replace(/^kb-source:/, '')
                : null;

          if (kbSourceMatch && getCredentials) {
            const kbRef = buildKBSourceReference(kbSourceMatch);
            if (kbRef) {
              return <WorkspaceChatInlineKBSource sourceRef={kbRef} getCredentials={getCredentials} region={region} />;
            }
          }

          const pathSource =
            href && (href.startsWith('file:/') || href.startsWith('folder:/'))
              ? href
              : childText.startsWith('file:/') || childText.startsWith('folder:/')
                ? childText
                : null;

          if (pathSource) {
            const isFolder = pathSource.startsWith('folder:/');
            const rawPath = pathSource.replace(/^(file|folder):\//, '');
            const rel = normalizeRelativePath(rawPath);
            const cleanRel = cleanDisplayPath(rel);
            const fullPath = buildS3KeyForPath(rel, userSub, conversationId);

            if (isFolder) {
              const name = cleanRel.split('/').pop() || cleanRel;
              return (
                <WorkspaceChatInlineFolderReference
                  folderRef={{ name, fullPath, relativePath: cleanRel }}
                  onOpenPreview={handleOpenFolder}
                />
              );
            } else {
              const filename = cleanRel.split('/').pop() || cleanRel;
              const extension = filename.split('.').pop()?.toLowerCase() || '';
              return (
                <WorkspaceChatInlineFileReference
                  fileRef={{ filename, fullPath, relativePath: cleanRel, extension }}
                  onOpenPreview={handleOpenFile}
                  onDownload={downloadCallback}
                />
              );
            }
          }
          // Regular link - pass through
          return (
            <a href={href} {...props}>
              {children}
            </a>
          );
        },
      }),
      [
        TextWithReferences,
        userSub,
        conversationId,
        region,
        handleOpenFile,
        handleOpenFolder,
        getCredentials,
        downloadCallback,
      ]
    );

    return (
      <div className="workspace-chat-markdown">
        <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={markdownComponents}>
          {content}
        </ReactMarkdown>
      </div>
    );
  }
);

export default WorkspaceChatMarkdown;

// Re-export types for convenience
export type { FileReference, FolderReference, KBSourceReference };
