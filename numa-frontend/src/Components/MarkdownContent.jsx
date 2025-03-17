import React, { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';

const HEADER_STYLES = {
  h1: { fontSize: '1.75em', marginTop: '1rem', marginBottom: '2rem' },
  h2: { fontSize: '1.45em', marginTop: '2rem', marginBottom: '1rem' },
  h3: { fontSize: '1.25em', marginTop: '1.5rem', marginBottom: '1rem' },
  h4: { fontSize: '1.2em', marginTop: '1rem', marginBottom: '1rem' },
  h5: { fontSize: '1em', marginTop: '1rem', marginBottom: '1rem' },
  h6: { fontSize: '0.875em', marginTop: '1rem', marginBottom: '1rem' },
};

const createHeaderComponent = (tag, style, nested = false) => {
  const Component = ({ ...props }) => {
    const Tag = tag;
    const baseStyle = {
      ...style,
      fontWeight: 'bold',
    };

    if (nested) {
      return (
        <Tag
          style={{
            fontSize: style.fontSize,
            fontWeight: 'bold',
            marginBottom: '0rem',
            marginTop: '0rem',
          }}
          {...props}
        />
      );
    }

    return <Tag style={baseStyle} {...props} />;
  };
  return Component;
};

const COPY_BUTTON_STYLES = {
  position: 'absolute',
  fontSize: '12px',
  padding: '4px 8px',
  border: 'none',
  borderRadius: '4px',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: '5px',
  fontFamily: 'monospace',
};

const CopyButton = ({ copied, onClick, style }) => (
  <button
    onClick={onClick}
    style={{
      ...COPY_BUTTON_STYLES,
      background: 'rgba(255, 255, 255, 0.2)',
      color: 'white',
      ...style,
    }}
  >
    {copied ? 'Copied!' : 'Copy'}
    {copied ? <i className="bi bi-check-circle" /> : <i className="bi bi-clipboard" />}
  </button>
);

const CODE_CONTAINER_STYLES = {
  position: 'relative',
  borderRadius: '1px',
  overflow: 'hidden',
  maxWidth: '100%',
  wordBreak: 'break-word',
  fontFamily: 'monospace',
};

const MARKDOWN_DOCUMENT_STYLES = {
  border: '1px solid #ddd',
  borderRadius: '8px',
  overflow: 'hidden',
  marginBottom: '1rem',
  maxWidth: '100%',
  backgroundColor: 'white',
  position: 'relative',
  borderColor: 'black',
};

const INLINE_CODE_STYLES = {
  backgroundColor: '#f6f8fa',
  padding: '0.2em 0.4em',
  borderRadius: '3px',
  fontFamily: 'monospace',
};

const TABLE_STYLES = {
  table: 'table table-striped table-bordered',
  thead: 'table-light',
};

const SYNTAX_HIGHLIGHTER_STYLES = {
  maxHeight: '1000px',
  overflowY: 'auto',
  overflowX: 'hidden',
  borderRadius: '5px',
  padding: '1rem',
  maxWidth: '100%',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
};

const PARAGRAPH_STYLES = {
  whiteSpace: 'pre-wrap',
  overflowWrap: 'break-word',
  margin: '1em 0',
};

const MarkdownDocument = ({ textContent, copied, handleCopy }) => (
  <div style={MARKDOWN_DOCUMENT_STYLES}>
    <div
      style={{
        backgroundColor: '#4b007d',
        color: 'white',
        padding: '0.5rem 1rem',
        fontWeight: 'bold',
        display: 'flex',
        alignItems: 'center',
      }}
    >
      <i className="bi bi-file-earmark-text" style={{ marginRight: '0.5rem' }} />
      Document
    </div>

    <CopyButton
      copied={copied}
      onClick={() => handleCopy(textContent)}
      style={{ top: '5px', right: '10px', zIndex: 10 }}
    />

    <div
      style={{
        padding: '1rem',
        shadow: '0 0 10px var(--color-eggplant-200)',
        fontFamily: 'monospace',
        fontSize: '14px',
        lineHeight: '1.4',
        color: '#333',
        wordBreak: 'break-word',
      }}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: createHeaderComponent('h1', HEADER_STYLES.h1, true),
          h2: createHeaderComponent('h2', HEADER_STYLES.h2, true),
          h3: createHeaderComponent('h3', HEADER_STYLES.h3, true),
          h4: createHeaderComponent('h4', HEADER_STYLES.h4, true),
          h5: createHeaderComponent('h5', HEADER_STYLES.h5, true),
          h6: createHeaderComponent('h6', HEADER_STYLES.h6, true),
          p: ({ ...props }) => (
            <p
              style={{
                fontSize: '14px',
                margin: '0rem 0',
                lineHeight: '1.2',
                marginBottom: '0rem',
                marginTop: '0rem',
              }}
              {...props}
            />
          ),
        }}
      >
        {textContent}
      </ReactMarkdown>
    </div>
  </div>
);

const CodeBlock = ({ textContent, language, copied, handleCopy }) => (
  <div style={CODE_CONTAINER_STYLES}>
    <CopyButton copied={copied} onClick={() => handleCopy(textContent)} style={{ top: '12px', right: '10px' }} />
    <SyntaxHighlighter
      style={oneDark}
      language={language || 'plaintext'}
      PreTag="div"
      customStyle={SYNTAX_HIGHLIGHTER_STYLES}
      wrapLines={true}
    >
      {textContent}
    </SyntaxHighlighter>
  </div>
);

class MarkdownErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ color: 'red', padding: '1rem' }}>
          Error rendering markdown content. Please check the markdown syntax.
        </div>
      );
    }

    return this.props.children;
  }
}

const MarkdownContent = React.memo(({ content }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = (text) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const markdownComponents = useMemo(
    () => ({
      p: ({ children, ...props }) => {
        if (React.Children.count(children) === 1 && children[0]?.type === 'pre') {
          return children[0];
        }
        return (
          <p style={PARAGRAPH_STYLES} {...props}>
            {children}
          </p>
        );
      },
      code: ({ inline, className, children, ...props }) => {
        const match = /language-(\w+)/.exec(className || '');
        const textContent = String(children).replace(/\n$/, '');

        if (inline) {
          return (
            <code style={INLINE_CODE_STYLES} {...props}>
              {children}
            </code>
          );
        }

        if (match?.[1] === 'markdown') {
          return <MarkdownDocument textContent={textContent} copied={copied} handleCopy={handleCopy} />;
        }

        return (
          <CodeBlock
            textContent={textContent}
            language={match?.[1] || 'plaintext'}
            copied={copied}
            handleCopy={handleCopy}
          />
        );
      },
      table: ({ ...props }) => <table className={TABLE_STYLES.table} {...props} />,
      thead: ({ ...props }) => <thead className={TABLE_STYLES.thead} {...props} />,
      h1: createHeaderComponent('h1', HEADER_STYLES.h1),
      h2: createHeaderComponent('h2', HEADER_STYLES.h2),
      h3: createHeaderComponent('h3', HEADER_STYLES.h3),
      h4: createHeaderComponent('h4', HEADER_STYLES.h4),
      h5: createHeaderComponent('h5', HEADER_STYLES.h5),
      h6: createHeaderComponent('h6', HEADER_STYLES.h6),
    }),
    [copied],
  );

  return (
    <MarkdownErrorBoundary>
      <div className="markdown-body">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
          {content}
        </ReactMarkdown>
      </div>
    </MarkdownErrorBoundary>
  );
});

MarkdownContent.displayName = 'MarkdownContent';

export { MarkdownContent };
