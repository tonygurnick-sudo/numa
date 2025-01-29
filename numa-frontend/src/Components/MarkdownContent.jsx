import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export const MarkdownContent = ({ content }) => {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        table: ({node, ...props}) => (
          <table className="table table-striped table-bordered" {...props} />
        ),
        thead: ({node, ...props}) => (
          <thead className="table-light" {...props} />
        ),
        // Add support for code blocks
        code: ({node, inline, ...props}) => (
          inline ?
            <code className="px-1 py-1 bg-light rounded" {...props} /> :
            <pre className="bg-light p-3 rounded">
              <code {...props} />
            </pre>
        )
      }}
    >
      {content}
    </ReactMarkdown>
  );
};
