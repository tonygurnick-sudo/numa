import React, { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';

// Keep TABLE_STYLES for bootstrap classes
const TABLE_STYLES = {
  table: 'table table-striped table-bordered',
  thead: 'table-light',
};

const MarkdownDocument = ({ textContent, copied, handleCopy }) => {
  return (
    <div className="markdown-document">
      <div className="markdown-document-header">
        <i className="bi bi-file-earmark-text" />
        Document
      </div>

      <button
        className="markdown-pre-copy-button"
        onClick={() => handleCopy(textContent)}
        style={{ top: '5px', right: '10px', zIndex: 10 }}
      >
        {copied ? 'Copied!' : 'Copy'}
        {copied ? <i className="bi bi-check-circle" /> : <i className="bi bi-clipboard" />}
      </button>

      <div className="markdown-document-content">
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkBreaks]}
          components={{
            h1: ({ children, ...props }) => (
              <h1 className="markdown-h1" {...props}>
                {children}
              </h1>
            ),
            h2: ({ children, ...props }) => (
              <h2 className="markdown-h2" {...props}>
                {children}
              </h2>
            ),
            h3: ({ children, ...props }) => (
              <h3 className="markdown-h3" {...props}>
                {children}
              </h3>
            ),
            h4: ({ children, ...props }) => (
              <h4 className="markdown-h4" {...props}>
                {children}
              </h4>
            ),
            h5: ({ children, ...props }) => (
              <h5 className="markdown-h5" {...props}>
                {children}
              </h5>
            ),
            h6: ({ children, ...props }) => (
              <h6 className="markdown-h6" {...props}>
                {children}
              </h6>
            ),
            p: ({ ...props }) => <p className="markdown-paragraph" {...props} />,
          }}
        >
          {textContent}
        </ReactMarkdown>
      </div>
    </div>
  );
};

const CodeBlock = ({ textContent, language, copied, handleCopy }) => {
  return (
    <div className="markdown-code-container">
      <button className="markdown-pre-copy-button" onClick={() => handleCopy(textContent)}>
        {copied ? 'Copied!' : 'Copy'}
        {copied ? <i className="bi bi-check-circle" /> : <i className="bi bi-clipboard" />}
      </button>
      <SyntaxHighlighter
        style={oneDark}
        language={language || 'plaintext'}
        PreTag="div"
        className="markdown-pre-block"
        wrapLines={true}
      >
        {textContent}
      </SyntaxHighlighter>
    </div>
  );
};

type MarkdownErrorBoundaryProps = React.PropsWithChildren<{}>;
type MarkdownErrorBoundaryState = { hasError: boolean };

class MarkdownErrorBoundary extends React.Component<MarkdownErrorBoundaryProps, MarkdownErrorBoundaryState> {
  constructor(props: MarkdownErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  // (optional but correct for an error boundary)
  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ color: 'red', padding: '1rem' }}>
          Error rendering markdown content. Please check the markdown syntax.
        </div>
      );
    }

    return <>{this.props.children}</>;
  }
}

interface MarkdownContentProps {
  content: string;
}

const MarkdownContent = React.memo(({ content }: MarkdownContentProps) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = (text: string) => {
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
          <div className="markdown-paragraph" style={{ maxWidth: '1100px' }} {...props}>
            {children}
          </div>
        );
      },
      code: ({ inline, className, children, ...props }) => {
        const match = /language-(\w+)/.exec(className || '');
        const textContent = String(children).replace(/\n$/, '');

        if (inline) {
          return (
            <code className="markdown-code-inline" {...props}>
              {children}
            </code>
          );
        }

        // If the code block is single-line (no newline chars), render as inline
        if (!inline && !textContent.includes('\n')) {
          return (
            <code className="markdown-code-inline" {...props}>
              {textContent}
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
      h1: ({ children, ...props }) => (
        <h1 className="markdown-h1" {...props}>
          {children}
        </h1>
      ),
      h2: ({ children, ...props }) => (
        <h2 className="markdown-h2" {...props}>
          {children}
        </h2>
      ),
      h3: ({ children, ...props }) => (
        <h3 className="markdown-h3" {...props}>
          {children}
        </h3>
      ),
      h4: ({ children, ...props }) => (
        <h4 className="markdown-h4" {...props}>
          {children}
        </h4>
      ),
      h5: ({ children, ...props }) => (
        <h5 className="markdown-h5" {...props}>
          {children}
        </h5>
      ),
      h6: ({ children, ...props }) => (
        <h6 className="markdown-h6" {...props}>
          {children}
        </h6>
      ),
    }),
    [copied],
  );

  return (
    <MarkdownErrorBoundary>
      <div className="markdown-body">
        <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={markdownComponents}>
          {content}
        </ReactMarkdown>
      </div>
    </MarkdownErrorBoundary>
  );
});

MarkdownContent.displayName = 'MarkdownContent';

export { MarkdownContent };
